use std::future::Future;
use std::sync::Arc;
use std::time::Duration;

use lyra_analytics::HookRunFact;
use lyra_analytics::build_track_events_context;
use lyra_hooks::PermissionRequestDecision;
use lyra_hooks::PermissionRequestOutcome;
use lyra_hooks::PermissionRequestRequest;
use lyra_hooks::PostToolUseOutcome;
use lyra_hooks::PostToolUseRequest;
use lyra_hooks::PreToolUseOutcome;
use lyra_hooks::PreToolUseRequest;
use lyra_hooks::SessionStartOutcome;
use lyra_hooks::UserPromptSubmitOutcome;
use lyra_hooks::UserPromptSubmitRequest;
use lyra_otel::HOOK_RUN_DURATION_METRIC;
use lyra_otel::HOOK_RUN_METRIC;
use lyra_protocol::items::TurnItem;
use lyra_protocol::models::DeveloperInstructions;
use lyra_protocol::models::ResponseInputItem;
use lyra_protocol::models::ResponseItem;
use lyra_protocol::protocol::AskForApproval;
use lyra_protocol::protocol::EventMsg;
use lyra_protocol::protocol::HookCompletedEvent;
use lyra_protocol::protocol::HookEventName;
use lyra_protocol::protocol::HookRunStatus;
use lyra_protocol::protocol::HookRunSummary;
use lyra_protocol::protocol::HookSource;
use lyra_protocol::protocol::HookStartedEvent;
use lyra_protocol::user_input::UserInput;
use serde_json::Value;

use crate::event_mapping::parse_turn_item;
use crate::session::session::Session;
use crate::session::turn_context::TurnContext;
use crate::tools::sandboxing::PermissionRequestPayload;

pub(crate) struct HookRuntimeOutcome {
    pub should_stop: bool,
    pub additional_contexts: Vec<String>,
}

pub(crate) enum PendingInputHookDisposition {
    Accepted(Box<PendingInputRecord>),
    Blocked { additional_contexts: Vec<String> },
}

pub(crate) enum PendingInputRecord {
    UserMessage {
        content: Vec<UserInput>,
        response_item: ResponseItem,
        additional_contexts: Vec<String>,
    },
    ConversationItem {
        response_item: ResponseItem,
    },
}

struct ContextInjectingHookOutcome {
    hook_events: Vec<HookCompletedEvent>,
    outcome: HookRuntimeOutcome,
}

impl From<SessionStartOutcome> for ContextInjectingHookOutcome {
    fn from(value: SessionStartOutcome) -> Self {
        let SessionStartOutcome {
            hook_events,
            should_stop,
            stop_reason: _,
            additional_contexts,
        } = value;
        Self {
            hook_events,
            outcome: HookRuntimeOutcome {
                should_stop,
                additional_contexts,
            },
        }
    }
}

impl From<UserPromptSubmitOutcome> for ContextInjectingHookOutcome {
    fn from(value: UserPromptSubmitOutcome) -> Self {
        let UserPromptSubmitOutcome {
            hook_events,
            should_stop,
            stop_reason: _,
            additional_contexts,
        } = value;
        Self {
            hook_events,
            outcome: HookRuntimeOutcome {
                should_stop,
                additional_contexts,
            },
        }
    }
}

pub(crate) async fn run_pending_session_start_hooks(
    sess: &Arc<Session>,
    turn_context: &Arc<TurnContext>,
) -> bool {
    let Some(session_start_source) = sess.take_pending_session_start_source().await else {
        return false;
    };

    let request = lyra_hooks::SessionStartRequest {
        session_id: sess.conversation_id,
        cwd: turn_context.cwd.clone(),
        transcript_path: sess.hook_transcript_path().await,
        model: turn_context.model_info.slug.clone(),
        permission_mode: hook_permission_mode(turn_context),
        source: session_start_source,
    };
    let preview_runs = sess.hooks().preview_session_start(&request);
    run_context_injecting_hook(
        sess,
        turn_context,
        preview_runs,
        sess.hooks()
            .run_session_start(request, Some(turn_context.sub_id.clone())),
    )
    .await
    .record_additional_contexts(sess, turn_context)
    .await
}

pub(crate) async fn run_pre_tool_use_hooks(
    sess: &Arc<Session>,
    turn_context: &Arc<TurnContext>,
    tool_use_id: String,
    command: String,
) -> Option<String> {
    let request = PreToolUseRequest {
        session_id: sess.conversation_id,
        turn_id: turn_context.sub_id.clone(),
        cwd: turn_context.cwd.clone(),
        transcript_path: sess.hook_transcript_path().await,
        model: turn_context.model_info.slug.clone(),
        permission_mode: hook_permission_mode(turn_context),
        tool_name: "Bash".to_string(),
        tool_use_id,
        command,
    };
    let preview_runs = sess.hooks().preview_pre_tool_use(&request);
    emit_hook_started_events(sess, turn_context, preview_runs).await;

    let PreToolUseOutcome {
        hook_events,
        should_block,
        block_reason,
    } = sess.hooks().run_pre_tool_use(request).await;
    emit_hook_completed_events(sess, turn_context, hook_events).await;

    if should_block { block_reason } else { None }
}

// PermissionRequest hooks share the same preview/start/completed event flow as
// other hook types, but they return an optional decision instead of mutating
// tool input or post-run state.
pub(crate) async fn run_permission_request_hooks(
    sess: &Arc<Session>,
    turn_context: &Arc<TurnContext>,
    run_id_suffix: &str,
    payload: PermissionRequestPayload,
) -> Option<PermissionRequestDecision> {
    let request = PermissionRequestRequest {
        session_id: sess.conversation_id,
        turn_id: turn_context.sub_id.clone(),
        cwd: turn_context.cwd.to_path_buf(),
        transcript_path: sess.hook_transcript_path().await,
        model: turn_context.model_info.slug.clone(),
        permission_mode: hook_permission_mode(turn_context),
        tool_name: payload.tool_name,
        run_id_suffix: run_id_suffix.to_string(),
        command: payload.command,
        description: payload.description,
    };
    let preview_runs = sess.hooks().preview_permission_request(&request);
    emit_hook_started_events(sess, turn_context, preview_runs).await;

    let PermissionRequestOutcome {
        hook_events,
        decision,
    } = sess.hooks().run_permission_request(request).await;
    emit_hook_completed_events(sess, turn_context, hook_events).await;

    decision
}

pub(crate) async fn run_post_tool_use_hooks(
    sess: &Arc<Session>,
    turn_context: &Arc<TurnContext>,
    tool_use_id: String,
    command: String,
    tool_response: Value,
) -> PostToolUseOutcome {
    let request = PostToolUseRequest {
        session_id: sess.conversation_id,
        turn_id: turn_context.sub_id.clone(),
        cwd: turn_context.cwd.clone(),
        transcript_path: sess.hook_transcript_path().await,
        model: turn_context.model_info.slug.clone(),
        permission_mode: hook_permission_mode(turn_context),
        tool_name: "Bash".to_string(),
        tool_use_id,
        command,
        tool_response,
    };
    let preview_runs = sess.hooks().preview_post_tool_use(&request);
    emit_hook_started_events(sess, turn_context, preview_runs).await;

    let outcome = sess.hooks().run_post_tool_use(request).await;
    emit_hook_completed_events(sess, turn_context, outcome.hook_events.clone()).await;
    outcome
}

pub(crate) async fn run_user_prompt_submit_hooks(
    sess: &Arc<Session>,
    turn_context: &Arc<TurnContext>,
    prompt: String,
) -> HookRuntimeOutcome {
    let request = UserPromptSubmitRequest {
        session_id: sess.conversation_id,
        turn_id: turn_context.sub_id.clone(),
        cwd: turn_context.cwd.clone(),
        transcript_path: sess.hook_transcript_path().await,
        model: turn_context.model_info.slug.clone(),
        permission_mode: hook_permission_mode(turn_context),
        prompt,
    };
    let preview_runs = sess.hooks().preview_user_prompt_submit(&request);
    run_context_injecting_hook(
        sess,
        turn_context,
        preview_runs,
        sess.hooks().run_user_prompt_submit(request),
    )
    .await
}

pub(crate) async fn inspect_pending_input(
    sess: &Arc<Session>,
    turn_context: &Arc<TurnContext>,
    pending_input_item: ResponseInputItem,
) -> PendingInputHookDisposition {
    let response_item = ResponseItem::from(pending_input_item);
    if let Some(TurnItem::UserMessage(user_message)) = parse_turn_item(&response_item) {
        let user_prompt_submit_outcome =
            run_user_prompt_submit_hooks(sess, turn_context, user_message.message()).await;
        if user_prompt_submit_outcome.should_stop {
            PendingInputHookDisposition::Blocked {
                additional_contexts: user_prompt_submit_outcome.additional_contexts,
            }
        } else {
            PendingInputHookDisposition::Accepted(Box::new(PendingInputRecord::UserMessage {
                content: user_message.content,
                response_item,
                additional_contexts: user_prompt_submit_outcome.additional_contexts,
            }))
        }
    } else {
        PendingInputHookDisposition::Accepted(Box::new(PendingInputRecord::ConversationItem {
            response_item,
        }))
    }
}

pub(crate) async fn record_pending_input(
    sess: &Arc<Session>,
    turn_context: &Arc<TurnContext>,
    pending_input: PendingInputRecord,
) {
    match pending_input {
        PendingInputRecord::UserMessage {
            content,
            response_item,
            additional_contexts,
        } => {
            sess.record_user_prompt_and_emit_turn_item(
                turn_context.as_ref(),
                content.as_slice(),
                response_item,
            )
            .await;
            record_additional_contexts(sess, turn_context, additional_contexts).await;
        }
        PendingInputRecord::ConversationItem { response_item } => {
            sess.record_conversation_items(turn_context, std::slice::from_ref(&response_item))
                .await;
        }
    }
}

async fn run_context_injecting_hook<Fut, Outcome>(
    sess: &Arc<Session>,
    turn_context: &Arc<TurnContext>,
    preview_runs: Vec<HookRunSummary>,
    outcome_future: Fut,
) -> HookRuntimeOutcome
where
    Fut: Future<Output = Outcome>,
    Outcome: Into<ContextInjectingHookOutcome>,
{
    emit_hook_started_events(sess, turn_context, preview_runs).await;

    let outcome = outcome_future.await.into();
    emit_hook_completed_events(sess, turn_context, outcome.hook_events).await;
    outcome.outcome
}

impl HookRuntimeOutcome {
    async fn record_additional_contexts(
        self,
        sess: &Arc<Session>,
        turn_context: &Arc<TurnContext>,
    ) -> bool {
        record_additional_contexts(sess, turn_context, self.additional_contexts).await;

        self.should_stop
    }
}

pub(crate) async fn record_additional_contexts(
    sess: &Arc<Session>,
    turn_context: &Arc<TurnContext>,
    additional_contexts: Vec<String>,
) {
    let developer_messages = additional_context_messages(additional_contexts);
    if developer_messages.is_empty() {
        return;
    }

    sess.record_conversation_items(turn_context, developer_messages.as_slice())
        .await;
}

fn additional_context_messages(additional_contexts: Vec<String>) -> Vec<ResponseItem> {
    additional_contexts
        .into_iter()
        .map(|additional_context| DeveloperInstructions::new(additional_context).into())
        .collect()
}

async fn emit_hook_started_events(
    sess: &Arc<Session>,
    turn_context: &Arc<TurnContext>,
    preview_runs: Vec<HookRunSummary>,
) {
    for run in preview_runs {
        sess.send_event(
            turn_context,
            EventMsg::HookStarted(HookStartedEvent {
                turn_id: Some(turn_context.sub_id.clone()),
                run,
            }),
        )
        .await;
    }
}

pub(crate) async fn emit_hook_completed_events(
    sess: &Arc<Session>,
    turn_context: &Arc<TurnContext>,
    completed_events: Vec<HookCompletedEvent>,
) {
    for completed in completed_events {
        emit_hook_completed_metrics(turn_context, &completed);
        track_hook_completed_analytics(sess, turn_context, &completed);
        sess.send_event(turn_context, EventMsg::HookCompleted(completed))
            .await;
    }
}

fn emit_hook_completed_metrics(turn_context: &TurnContext, completed: &HookCompletedEvent) {
    let tags = hook_run_metric_tags(&completed.run);
    turn_context
        .session_telemetry
        .counter(HOOK_RUN_METRIC, /*inc*/ 1, &tags);
    if let Some(duration_ms) = completed.run.duration_ms
        && let Ok(duration_ms) = u64::try_from(duration_ms)
    {
        turn_context.session_telemetry.record_duration(
            HOOK_RUN_DURATION_METRIC,
            Duration::from_millis(duration_ms),
            &tags,
        );
    }
}

fn track_hook_completed_analytics(
    sess: &Arc<Session>,
    turn_context: &Arc<TurnContext>,
    completed: &HookCompletedEvent,
) {
    let (tracking, hook) =
        hook_run_analytics_payload(sess.conversation_id.to_string(), turn_context, completed);
    sess.services
        .analytics_events_client
        .track_hook_run(tracking, hook);
}

fn hook_run_analytics_payload(
    thread_id: String,
    turn_context: &TurnContext,
    completed: &HookCompletedEvent,
) -> (
    lyra_analytics::TrackEventsContext,
    HookRunFact<HookEventName, HookSource, HookRunStatus>,
) {
    (
        build_track_events_context(
            turn_context.model_info.slug.clone(),
            thread_id,
            completed
                .turn_id
                .clone()
                .unwrap_or_else(|| turn_context.sub_id.clone()),
        ),
        HookRunFact {
            event_name: completed.run.event_name,
            hook_source: completed.run.source,
            status: completed.run.status,
        },
    )
}

fn hook_run_metric_tags(run: &HookRunSummary) -> [(&'static str, &'static str); 3] {
    let hook_name = match run.event_name {
        HookEventName::PreToolUse => "PreToolUse",
        HookEventName::PermissionRequest => "PermissionRequest",
        HookEventName::PostToolUse => "PostToolUse",
        HookEventName::SessionStart => "SessionStart",
        HookEventName::UserPromptSubmit => "UserPromptSubmit",
        HookEventName::Stop => "Stop",
    };
    let hook_source = match run.source {
        HookSource::System => "system",
        HookSource::User => "user",
        HookSource::Project => "project",
        HookSource::Mdm => "mdm",
        HookSource::SessionFlags => "session_flags",
        HookSource::LegacyManagedConfigFile => "legacy_managed_config_file",
        HookSource::LegacyManagedConfigMdm => "legacy_managed_config_mdm",
        HookSource::Unknown => "unknown",
    };
    let status = match run.status {
        HookRunStatus::Running => "running",
        HookRunStatus::Completed => "completed",
        HookRunStatus::Failed => "failed",
        HookRunStatus::Blocked => "blocked",
        HookRunStatus::Stopped => "stopped",
    };

    [
        ("hook_name", hook_name),
        ("source", hook_source),
        ("status", status),
    ]
}

fn hook_permission_mode(turn_context: &TurnContext) -> String {
    match turn_context.approval_policy.value() {
        AskForApproval::Never => "bypassPermissions",
        AskForApproval::UnlessTrusted
        | AskForApproval::OnFailure
        | AskForApproval::OnRequest
        | AskForApproval::Granular(_) => "default",
    }
    .to_string()
}
