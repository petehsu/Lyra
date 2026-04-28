use async_channel::Receiver;
use lyra_otel::set_parent_from_w3c_trace_context;
use lyra_protocol::protocol::Submission;
use tracing::Instrument;
use tracing::info_span;

use crate::session::SteerInputError;
use crate::session::session::Session;
use crate::session::session::SessionSettingsUpdate;

use crate::config::Config;
use crate::config_loader::CloudRequirementsLoader;
use crate::config_loader::LoaderOverrides;
use crate::config_loader::load_config_layers_state;
use crate::session::spawn_review_thread;
use lyra_exec_server::LOCAL_FS;
use lyra_features::Feature;
use lyra_git_utils::RestoreGhostCommitOptions;
use lyra_git_utils::restore_ghost_commit_with_options;
use lyra_protocol::models::GhostCommit;
use lyra_protocol::models::ResponseItem;
use lyra_utils_absolute_path::AbsolutePathBuf;

use crate::review_prompts::resolve_review_request;
use crate::rollout::RolloutRecorder;
use crate::rollout::read_session_meta_line;
use crate::tasks::UndoTask;
use crate::tasks::UserShellCommandMode;
use crate::tasks::UserShellCommandTask;
use crate::tasks::execute_user_shell_command;
use lyra_mcp::collect_mcp_snapshot_from_manager;
use lyra_mcp::compute_auth_statuses;
use lyra_protocol::protocol::ErrorEvent;
use lyra_protocol::protocol::Event;
use lyra_protocol::protocol::EventMsg;
use lyra_protocol::protocol::InterAgentCommunication;
use lyra_protocol::protocol::ListSkillsResponseEvent;
use lyra_protocol::protocol::LyraErrorInfo;
use lyra_protocol::protocol::McpServerRefreshConfig;
use lyra_protocol::protocol::Op;
use lyra_protocol::protocol::ReviewDecision;
use lyra_protocol::protocol::ReviewRequest;
use lyra_protocol::protocol::RolloutItem;
use lyra_protocol::protocol::SkillErrorInfo;
use lyra_protocol::protocol::SkillsListEntry;
use lyra_protocol::protocol::ThreadMemoryMode;
use lyra_protocol::protocol::ThreadNameUpdatedEvent;
use lyra_protocol::protocol::ThreadRolledBackEvent;
use lyra_protocol::protocol::TurnAbortReason;
use lyra_protocol::protocol::WarningEvent;
use lyra_protocol::request_permissions::RequestPermissionsResponse;
use lyra_protocol::request_user_input::RequestUserInputResponse;

use crate::context_manager::is_user_turn_boundary;
use lyra_protocol::config_types::CollaborationMode;
use lyra_protocol::config_types::ModeKind;
use lyra_protocol::config_types::Settings;
use lyra_protocol::dynamic_tools::DynamicToolResponse;
use lyra_protocol::mcp::RequestId as ProtocolRequestId;
use lyra_rmcp_client::ElicitationAction;
use lyra_rmcp_client::ElicitationResponse;
use serde_json::Value;
use std::path::PathBuf;
use std::sync::Arc;
use tracing::debug;
use tracing::info;
use tracing::warn;

pub async fn interrupt(sess: &Arc<Session>) {
    sess.interrupt_task().await;
}

pub async fn clean_background_terminals(sess: &Arc<Session>) {
    sess.close_unified_exec_processes().await;
}

pub async fn override_turn_context(sess: &Session, sub_id: String, updates: SessionSettingsUpdate) {
    if let Err(err) = sess.update_settings(updates).await {
        sess.send_event_raw(Event {
            id: sub_id,
            msg: EventMsg::Error(ErrorEvent {
                message: err.to_string(),
                lyra_error_info: Some(LyraErrorInfo::BadRequest),
            }),
        })
        .await;
    }
}

pub async fn user_input_or_turn(sess: &Arc<Session>, sub_id: String, op: Op) {
    user_input_or_turn_inner(sess, sub_id, op).await;
}

pub(super) async fn user_input_or_turn_inner(sess: &Arc<Session>, sub_id: String, op: Op) {
    let (items, updates, responsesapi_client_metadata) = match op {
        Op::UserTurn {
            cwd,
            approval_policy,
            approvals_reviewer,
            sandbox_policy,
            model,
            effort,
            summary,
            service_tier,
            final_output_json_schema,
            items,
            collaboration_mode,
        } => {
            let collaboration_mode = collaboration_mode.or_else(|| {
                Some(CollaborationMode {
                    mode: ModeKind::Default,
                    settings: Settings {
                        model: model.clone(),
                        reasoning_effort: effort,
                        developer_instructions: None,
                    },
                })
            });
            (
                items,
                SessionSettingsUpdate {
                    cwd: Some(cwd),
                    approval_policy: Some(approval_policy),
                    approvals_reviewer,
                    sandbox_policy: Some(sandbox_policy),
                    windows_sandbox_level: None,
                    collaboration_mode,
                    reasoning_summary: summary,
                    model_verbosity: None,
                    service_tier,
                    developer_instructions: None,
                    dynamic_tools: None,
                    final_output_json_schema: Some(final_output_json_schema),
                    app_server_client_name: None,
                    app_server_client_version: None,
                },
                None,
            )
        }
        Op::UserInput {
            items,
            final_output_json_schema,
            responsesapi_client_metadata,
        } => (
            items,
            SessionSettingsUpdate {
                final_output_json_schema: Some(final_output_json_schema),
                ..Default::default()
            },
            responsesapi_client_metadata,
        ),
        _ => unreachable!(),
    };

    let Ok(current_context) = sess.new_turn_with_sub_id(sub_id.clone(), updates).await else {
        // new_turn_with_sub_id already emits the error event.
        return;
    };
    match sess
        .steer_input(
            items.clone(),
            /*expected_turn_id*/ None,
            responsesapi_client_metadata.clone(),
        )
        .await
    {
        Ok(_) => {
            current_context.session_telemetry.user_prompt(&items);
        }
        Err(SteerInputError::NoActiveTurn(items)) => {
            if let Some(responsesapi_client_metadata) = responsesapi_client_metadata {
                current_context
                    .turn_metadata_state
                    .set_responsesapi_client_metadata(responsesapi_client_metadata);
            }
            current_context.session_telemetry.user_prompt(&items);
            sess.refresh_mcp_servers_if_requested(&current_context)
                .await;
            sess.spawn_task(
                Arc::clone(&current_context),
                items,
                crate::tasks::RegularTask::new(),
            )
            .await;
        }
        Err(err) => {
            sess.send_event_raw(Event {
                id: sub_id,
                msg: EventMsg::Error(err.to_error_event()),
            })
            .await;
        }
    }
}

/// Records an inter-agent assistant envelope, then lets the shared pending-work scheduler
/// decide whether an idle session should start a regular turn.
pub async fn inter_agent_communication(
    sess: &Arc<Session>,
    sub_id: String,
    communication: InterAgentCommunication,
) {
    let trigger_turn = communication.trigger_turn;
    sess.enqueue_mailbox_communication(communication);
    if trigger_turn {
        sess.maybe_start_turn_for_pending_work_with_sub_id(sub_id)
            .await;
    }
}

pub async fn run_user_shell_command(sess: &Arc<Session>, sub_id: String, command: String) {
    if let Some((turn_context, cancellation_token)) =
        sess.active_turn_context_and_cancellation_token().await
    {
        let session = Arc::clone(sess);
        tokio::spawn(async move {
            execute_user_shell_command(
                session,
                turn_context,
                command,
                cancellation_token,
                UserShellCommandMode::ActiveTurnAuxiliary,
            )
            .await;
        });
        return;
    }

    let turn_context = sess.new_default_turn_with_sub_id(sub_id).await;
    sess.spawn_task(
        Arc::clone(&turn_context),
        Vec::new(),
        UserShellCommandTask::new(command),
    )
    .await;
}

pub async fn resolve_elicitation(
    sess: &Arc<Session>,
    server_name: String,
    request_id: ProtocolRequestId,
    decision: lyra_protocol::approvals::ElicitationAction,
    content: Option<Value>,
    meta: Option<Value>,
) {
    let action = match decision {
        lyra_protocol::approvals::ElicitationAction::Accept => ElicitationAction::Accept,
        lyra_protocol::approvals::ElicitationAction::Decline => ElicitationAction::Decline,
        lyra_protocol::approvals::ElicitationAction::Cancel => ElicitationAction::Cancel,
    };
    let content = match action {
        // Preserve the legacy fallback for clients that only send an action.
        ElicitationAction::Accept => Some(content.unwrap_or_else(|| serde_json::json!({}))),
        ElicitationAction::Decline | ElicitationAction::Cancel => None,
    };
    let response = ElicitationResponse {
        action,
        content,
        meta,
    };
    let request_id = match request_id {
        ProtocolRequestId::String(value) => {
            rmcp::model::NumberOrString::String(std::sync::Arc::from(value))
        }
        ProtocolRequestId::Integer(value) => rmcp::model::NumberOrString::Number(value),
    };
    if let Err(err) = sess
        .resolve_elicitation(server_name, request_id, response)
        .await
    {
        warn!(
            error = %err,
            "failed to resolve elicitation request in session"
        );
    }
}

/// Propagate a user's exec approval decision to the session.
/// Also optionally applies an execpolicy amendment.
pub async fn exec_approval(
    sess: &Arc<Session>,
    approval_id: String,
    turn_id: Option<String>,
    decision: ReviewDecision,
) {
    let event_turn_id = turn_id.unwrap_or_else(|| approval_id.clone());
    if let ReviewDecision::ApprovedExecpolicyAmendment {
        proposed_execpolicy_amendment,
    } = &decision
    {
        match sess
            .persist_execpolicy_amendment(proposed_execpolicy_amendment)
            .await
        {
            Ok(()) => {
                sess.record_execpolicy_amendment_message(
                    &event_turn_id,
                    proposed_execpolicy_amendment,
                )
                .await;
            }
            Err(err) => {
                let message = format!("Failed to apply execpolicy amendment: {err}");
                tracing::warn!("{message}");
                let warning = EventMsg::Warning(WarningEvent { message });
                sess.send_event_raw(Event {
                    id: event_turn_id.clone(),
                    msg: warning,
                })
                .await;
            }
        }
    }
    match decision {
        ReviewDecision::Abort => {
            sess.interrupt_task().await;
        }
        other => sess.notify_approval(&approval_id, other).await,
    }
}

pub async fn patch_approval(sess: &Arc<Session>, id: String, decision: ReviewDecision) {
    match decision {
        ReviewDecision::Abort => {
            sess.interrupt_task().await;
        }
        other => sess.notify_approval(&id, other).await,
    }
}

pub async fn request_user_input_response(
    sess: &Arc<Session>,
    id: String,
    response: RequestUserInputResponse,
) {
    sess.notify_user_input_response(&id, response).await;
}

pub async fn request_permissions_response(
    sess: &Arc<Session>,
    id: String,
    response: RequestPermissionsResponse,
) {
    sess.notify_request_permissions_response(&id, response)
        .await;
}

pub async fn dynamic_tool_response(sess: &Arc<Session>, id: String, response: DynamicToolResponse) {
    sess.notify_dynamic_tool_response(&id, response).await;
}

pub async fn add_to_history(sess: &Arc<Session>, config: &Arc<Config>, text: String) {
    let id = sess.conversation_id;
    let config = Arc::clone(config);
    tokio::spawn(async move {
        if let Err(e) = crate::message_history::append_entry(&text, &id, &config).await {
            warn!("failed to append to message history: {e}");
        }
    });
}

pub async fn get_history_entry_request(
    sess: &Arc<Session>,
    config: &Arc<Config>,
    sub_id: String,
    offset: usize,
    log_id: u64,
) {
    let config = Arc::clone(config);
    let sess_clone = Arc::clone(sess);

    tokio::spawn(async move {
        // Run lookup in blocking thread because it does file IO + locking.
        let entry_opt = tokio::task::spawn_blocking(move || {
            crate::message_history::lookup(log_id, offset, &config)
        })
        .await
        .unwrap_or(None);

        let event = Event {
            id: sub_id,
            msg: EventMsg::GetHistoryEntryResponse(
                lyra_protocol::protocol::GetHistoryEntryResponseEvent {
                    offset,
                    log_id,
                    entry: entry_opt.map(|e| lyra_protocol::message_history::HistoryEntry {
                        conversation_id: e.session_id,
                        ts: e.ts,
                        text: e.text,
                    }),
                },
            ),
        };

        sess_clone.send_event_raw(event).await;
    });
}

pub async fn refresh_mcp_servers(sess: &Arc<Session>, refresh_config: McpServerRefreshConfig) {
    let mut guard = sess.pending_mcp_server_refresh_config.lock().await;
    *guard = Some(refresh_config);
}

pub async fn reload_user_config(sess: &Arc<Session>) {
    sess.reload_user_config_layer().await;
}

pub async fn list_mcp_tools(sess: &Session, config: &Arc<Config>, sub_id: String) {
    let mcp_connection_manager = sess.services.mcp_connection_manager.read().await;
    let auth = sess.services.auth_manager.auth().await;
    let mcp_servers = sess
        .services
        .mcp_manager
        .effective_servers(config, auth.as_ref())
        .await;
    let snapshot = collect_mcp_snapshot_from_manager(
        &mcp_connection_manager,
        compute_auth_statuses(mcp_servers.iter(), config.mcp_oauth_credentials_store_mode).await,
    )
    .await;
    let event = Event {
        id: sub_id,
        msg: EventMsg::McpListToolsResponse(snapshot),
    };
    sess.send_event_raw(event).await;
}

pub async fn list_skills(sess: &Session, sub_id: String, cwds: Vec<PathBuf>, force_reload: bool) {
    let default_cwd = {
        let state = sess.state.lock().await;
        state.session_configuration.cwd.to_path_buf()
    };
    let cwds = if cwds.is_empty() {
        vec![default_cwd]
    } else {
        cwds
    };

    let skills_manager = &sess.services.skills_manager;
    let plugins_manager = &sess.services.plugins_manager;
    let fs = sess
        .services
        .environment
        .as_ref()
        .map(|environment| environment.get_filesystem());
    let config = sess.get_config().await;
    let lyra_home = sess.lyra_home().await;
    let mut skills = Vec::new();
    let empty_cli_overrides: &[(String, toml::Value)] = &[];
    for cwd in cwds {
        let cwd_abs = match AbsolutePathBuf::relative_to_current_dir(cwd.as_path()) {
            Ok(path) => path,
            Err(err) => {
                let error_path = cwd.clone();
                skills.push(SkillsListEntry {
                    cwd,
                    skills: Vec::new(),
                    errors: vec![SkillErrorInfo {
                        path: error_path,
                        message: err.to_string(),
                    }],
                });
                continue;
            }
        };
        let config_layer_stack = match load_config_layers_state(
            LOCAL_FS.as_ref(),
            &lyra_home,
            Some(cwd_abs.clone()),
            empty_cli_overrides,
            LoaderOverrides::default(),
            CloudRequirementsLoader::default(),
        )
        .await
        {
            Ok(config_layer_stack) => config_layer_stack,
            Err(err) => {
                let error_path = cwd.clone();
                skills.push(SkillsListEntry {
                    cwd,
                    skills: Vec::new(),
                    errors: vec![SkillErrorInfo {
                        path: error_path,
                        message: err.to_string(),
                    }],
                });
                continue;
            }
        };
        let effective_skill_roots = plugins_manager
            .effective_skill_roots_for_layer_stack(
                &config_layer_stack,
                config.features.enabled(Feature::Plugins),
            )
            .await;
        let skills_input = crate::SkillsLoadInput::new(
            cwd_abs.clone(),
            effective_skill_roots,
            config_layer_stack,
            config.bundled_skills_enabled(),
        );
        let outcome = skills_manager
            .skills_for_cwd(&skills_input, force_reload, fs.clone())
            .await;
        let errors = super::errors_to_info(&outcome.errors);
        let skills_metadata = super::skills_to_info(&outcome.skills, &outcome.disabled_paths);
        skills.push(SkillsListEntry {
            cwd,
            skills: skills_metadata,
            errors,
        });
    }

    let event = Event {
        id: sub_id,
        msg: EventMsg::ListSkillsResponse(ListSkillsResponseEvent { skills }),
    };
    sess.send_event_raw(event).await;
}

pub async fn undo(sess: &Arc<Session>, sub_id: String) {
    let turn_context = sess.new_default_turn_with_sub_id(sub_id).await;
    sess.spawn_task(turn_context, Vec::new(), UndoTask::new())
        .await;
}

#[derive(Debug, Default)]
struct RollbackFileCheckpoint {
    ghost_commit: Option<GhostCommit>,
    cwd: Option<AbsolutePathBuf>,
    affected_paths: Vec<String>,
    requires_restore: bool,
}

fn rollback_file_checkpoint(items: &[RolloutItem], turn_id: &str) -> RollbackFileCheckpoint {
    let mut current_turn_id: Option<&str> = None;
    let mut seen_target = false;
    let mut checkpoint = RollbackFileCheckpoint::default();

    for item in items {
        match item {
            RolloutItem::EventMsg(EventMsg::TurnStarted(event)) => {
                current_turn_id = Some(event.turn_id.as_str());
                if event.turn_id == turn_id {
                    seen_target = true;
                }
            }
            RolloutItem::TurnContext(ctx) => {
                if ctx.turn_id.as_deref() == Some(turn_id) {
                    checkpoint.cwd = AbsolutePathBuf::from_absolute_path(ctx.cwd.clone()).ok();
                }
            }
            RolloutItem::ResponseItem(ResponseItem::GhostSnapshot { ghost_commit }) => {
                if current_turn_id == Some(turn_id) {
                    checkpoint.ghost_commit = Some(ghost_commit.clone());
                }
            }
            RolloutItem::EventMsg(EventMsg::PatchApplyBegin(event)) if seen_target => {
                checkpoint.requires_restore = true;
                for (path, change) in &event.changes {
                    checkpoint
                        .affected_paths
                        .push(path.to_string_lossy().into_owned());
                    if let lyra_protocol::protocol::FileChange::Update {
                        move_path: Some(move_path),
                        ..
                    } = change
                    {
                        checkpoint
                            .affected_paths
                            .push(move_path.to_string_lossy().into_owned());
                    }
                }
            }
            RolloutItem::EventMsg(EventMsg::ExecCommandBegin(_)) if seen_target => {
                checkpoint.requires_restore = true;
            }
            _ => {}
        }
    }

    checkpoint.affected_paths.sort();
    checkpoint.affected_paths.dedup();
    checkpoint
}

fn rollout_contains_turn(items: &[RolloutItem], turn_id: &str) -> bool {
    items.iter().any(|item| {
        matches!(
            item,
            RolloutItem::EventMsg(EventMsg::TurnStarted(event)) if event.turn_id == turn_id
        )
    })
}

async fn restore_files_for_rollback(
    sess: &Arc<Session>,
    turn_context: &Arc<crate::session::turn_context::TurnContext>,
    rollout_items: &[RolloutItem],
    turn_id: &str,
) -> Result<Vec<String>, String> {
    let checkpoint = rollback_file_checkpoint(rollout_items, turn_id);
    if !checkpoint.requires_restore {
        return Ok(Vec::new());
    }
    let Some(ghost_commit) = checkpoint.ghost_commit else {
        return Err(format!(
            "Cannot safely rollback turn {turn_id}: no filesystem checkpoint was captured before this turn."
        ));
    };

    let repo_path = checkpoint
        .cwd
        .clone()
        .unwrap_or_else(|| turn_context.cwd.clone());
    let ghost_snapshot = turn_context.ghost_snapshot.clone();
    let restore_result = tokio::task::spawn_blocking(move || {
        let options = RestoreGhostCommitOptions::new(&repo_path).ghost_snapshot(ghost_snapshot);
        restore_ghost_commit_with_options(&options, &ghost_commit)
    })
    .await
    .map_err(|err| format!("failed to join rollback restore task: {err}"))?;

    restore_result.map_err(|err| format!("failed to restore files for rollback: {err}"))?;
    sess.services.session_telemetry.counter(
        "lyra.thread_rollback.files_restored",
        /*inc*/ 1,
        &[],
    );
    Ok(checkpoint.affected_paths)
}

pub async fn thread_rollback(
    sess: &Arc<Session>,
    sub_id: String,
    turn_id: String,
    num_turns: u32,
    restore_files: bool,
) {
    if num_turns == 0 {
        sess.send_event_raw(Event {
            id: sub_id,
            msg: EventMsg::Error(ErrorEvent {
                message: "num_turns must be >= 1".to_string(),
                lyra_error_info: Some(LyraErrorInfo::ThreadRollbackFailed),
            }),
        })
        .await;
        return;
    }

    let has_active_turn = { sess.active_turn.lock().await.is_some() };
    if has_active_turn {
        sess.send_event_raw(Event {
            id: sub_id,
            msg: EventMsg::Error(ErrorEvent {
                message: "Cannot rollback while a turn is in progress.".to_string(),
                lyra_error_info: Some(LyraErrorInfo::ThreadRollbackFailed),
            }),
        })
        .await;
        return;
    }

    let turn_context = sess.new_default_turn_with_sub_id(sub_id).await;
    let rollout_path = {
        let recorder = {
            let guard = sess.services.rollout.lock().await;
            guard.clone()
        };
        let Some(recorder) = recorder else {
            sess.send_event_raw(Event {
                id: turn_context.sub_id.clone(),
                msg: EventMsg::Error(ErrorEvent {
                    message: "thread rollback requires a persisted rollout path".to_string(),
                    lyra_error_info: Some(LyraErrorInfo::ThreadRollbackFailed),
                }),
            })
            .await;
            return;
        };
        recorder.rollout_path().to_path_buf()
    };
    if let Some(recorder) = {
        let guard = sess.services.rollout.lock().await;
        guard.clone()
    } && let Err(err) = recorder.flush().await
    {
        sess.send_event_raw(Event {
            id: turn_context.sub_id.clone(),
            msg: EventMsg::Error(ErrorEvent {
                message: format!(
                    "failed to flush rollout `{}` for rollback replay: {err}",
                    rollout_path.display()
                ),
                lyra_error_info: Some(LyraErrorInfo::ThreadRollbackFailed),
            }),
        })
        .await;
        return;
    }

    let initial_history = match RolloutRecorder::get_rollout_history(rollout_path.as_path()).await {
        Ok(history) => history,
        Err(err) => {
            sess.send_event_raw(Event {
                id: turn_context.sub_id.clone(),
                msg: EventMsg::Error(ErrorEvent {
                    message: format!(
                        "failed to load rollout `{}` for rollback replay: {err}",
                        rollout_path.display()
                    ),
                    lyra_error_info: Some(LyraErrorInfo::ThreadRollbackFailed),
                }),
            })
            .await;
            return;
        }
    };

    let rollout_items = initial_history.get_rollout_items();
    if !rollout_contains_turn(&rollout_items, &turn_id) {
        sess.send_event_raw(Event {
            id: turn_context.sub_id.clone(),
            msg: EventMsg::Error(ErrorEvent {
                message: format!("turn not found for rollback: {turn_id}"),
                lyra_error_info: Some(LyraErrorInfo::ThreadRollbackFailed),
            }),
        })
        .await;
        return;
    }

    if restore_files {
        match restore_files_for_rollback(sess, &turn_context, &rollout_items, &turn_id).await {
            Ok(_) => {}
            Err(message) => {
                sess.send_event_raw(Event {
                    id: turn_context.sub_id.clone(),
                    msg: EventMsg::Error(ErrorEvent {
                        message,
                        lyra_error_info: Some(LyraErrorInfo::ThreadRollbackFailed),
                    }),
                })
                .await;
                return;
            }
        }
    }

    let rollback_event = ThreadRolledBackEvent { num_turns };
    let rollback_msg = EventMsg::ThreadRolledBack(rollback_event.clone());
    let replay_items = rollout_items
        .into_iter()
        .chain(std::iter::once(RolloutItem::EventMsg(rollback_msg.clone())))
        .collect::<Vec<_>>();
    sess.apply_rollout_reconstruction(turn_context.as_ref(), replay_items.as_slice())
        .await;
    sess.recompute_token_usage(turn_context.as_ref()).await;

    sess.persist_rollout_items(&[RolloutItem::EventMsg(rollback_msg.clone())])
        .await;
    if let Err(err) = sess.flush_rollout().await {
        sess.send_event(
            turn_context.as_ref(),
            EventMsg::Warning(WarningEvent {
                message: format!(
                    "Rolled the thread back, but failed to save the rollback marker. Lyra will continue retrying. Error: {err}"
                ),
            }),
        )
        .await;
    }

    sess.deliver_event_raw(Event {
        id: turn_context.sub_id.clone(),
        msg: rollback_msg,
    })
    .await;
}

async fn persist_thread_name_update(
    sess: &Arc<Session>,
    event: ThreadNameUpdatedEvent,
) -> anyhow::Result<EventMsg> {
    let msg = EventMsg::ThreadNameUpdated(event);
    let item = RolloutItem::EventMsg(msg.clone());
    let recorder = {
        let guard = sess.services.rollout.lock().await;
        guard.clone()
    }
    .ok_or_else(|| anyhow::anyhow!("Session persistence is disabled; cannot rename thread."))?;
    recorder.persist().await?;
    recorder.record_items(std::slice::from_ref(&item)).await?;
    recorder.flush().await?;
    Ok(msg)
}

pub(super) async fn persist_thread_memory_mode_update(
    sess: &Arc<Session>,
    mode: ThreadMemoryMode,
) -> anyhow::Result<()> {
    let recorder = {
        let guard = sess.services.rollout.lock().await;
        guard.clone()
    }
    .ok_or_else(|| {
        anyhow::anyhow!("Session persistence is disabled; cannot update thread memory mode.")
    })?;
    recorder.persist().await?;
    recorder.flush().await?;

    let rollout_path = recorder.rollout_path().to_path_buf();
    let mut session_meta = read_session_meta_line(rollout_path.as_path()).await?;
    if session_meta.meta.id != sess.conversation_id {
        anyhow::bail!(
            "rollout session metadata id mismatch: expected {}, found {}",
            sess.conversation_id,
            session_meta.meta.id
        );
    }
    session_meta.meta.memory_mode = Some(
        match mode {
            ThreadMemoryMode::Enabled => "enabled",
            ThreadMemoryMode::Disabled => "disabled",
        }
        .to_string(),
    );

    let item = RolloutItem::SessionMeta(session_meta);
    recorder.record_items(std::slice::from_ref(&item)).await?;
    recorder.flush().await?;
    Ok(())
}

/// Persists the thread name in the rollout and state database, updates in-memory state, and
/// emits a `ThreadNameUpdated` event on success.
pub async fn set_thread_name(sess: &Arc<Session>, sub_id: String, name: String) {
    let Some(name) = crate::util::normalize_thread_name(&name) else {
        let event = Event {
            id: sub_id,
            msg: EventMsg::Error(ErrorEvent {
                message: "Thread name cannot be empty.".to_string(),
                lyra_error_info: Some(LyraErrorInfo::BadRequest),
            }),
        };
        sess.send_event_raw(event).await;
        return;
    };

    let updated = ThreadNameUpdatedEvent {
        thread_id: sess.conversation_id,
        thread_name: Some(name.clone()),
    };

    let msg = match persist_thread_name_update(sess, updated).await {
        Ok(msg) => msg,
        Err(err) => {
            warn!("Failed to persist thread name update to rollout: {err}");
            let event = Event {
                id: sub_id,
                msg: EventMsg::Error(ErrorEvent {
                    message: err.to_string(),
                    lyra_error_info: Some(LyraErrorInfo::Other),
                }),
            };
            sess.send_event_raw(event).await;
            return;
        }
    };

    if let Some(state_db) = sess.services.state_db.as_deref()
        && let Err(err) = state_db
            .update_thread_title(sess.conversation_id, &name)
            .await
    {
        warn!("Failed to update thread title in state db: {err}");
    }

    {
        let mut state = sess.state.lock().await;
        state.session_configuration.thread_name = Some(name.clone());
    }

    let lyra_home = sess.lyra_home().await;
    if let Err(err) =
        crate::rollout::append_thread_name(&lyra_home, sess.conversation_id, &name).await
    {
        warn!("Failed to update legacy thread name index: {err}");
    }

    sess.deliver_event_raw(Event { id: sub_id, msg }).await;
}

/// Persists thread-level memory mode metadata for the active session.
///
/// This does not involve the model and only affects whether the thread is
/// eligible for future memory generation.
pub async fn set_thread_memory_mode(sess: &Arc<Session>, sub_id: String, mode: ThreadMemoryMode) {
    if let Err(err) = persist_thread_memory_mode_update(sess, mode).await {
        warn!("Failed to persist thread memory mode update to rollout: {err}");
        let event = Event {
            id: sub_id,
            msg: EventMsg::Error(ErrorEvent {
                message: err.to_string(),
                lyra_error_info: Some(LyraErrorInfo::Other),
            }),
        };
        sess.send_event_raw(event).await;
    }
}

pub async fn shutdown(sess: &Arc<Session>, sub_id: String) -> bool {
    sess.abort_all_tasks(TurnAbortReason::Interrupted).await;
    sess.services
        .unified_exec_manager
        .terminate_all_processes()
        .await;
    sess.auto_review_session.shutdown().await;
    info!("Shutting down Lyra instance");
    let history = sess.clone_history().await;
    let turn_count = history
        .raw_items()
        .iter()
        .filter(|item| is_user_turn_boundary(item))
        .count();
    sess.services.session_telemetry.counter(
        "lyra.conversation.turn.count",
        i64::try_from(turn_count).unwrap_or(0),
        &[],
    );

    // Gracefully flush and shutdown rollout recorder on session end so tests
    // that inspect the rollout file do not race with the background writer.
    let recorder_opt = {
        let mut guard = sess.services.rollout.lock().await;
        guard.take()
    };
    if let Some(rec) = recorder_opt
        && let Err(e) = rec.shutdown().await
    {
        warn!("failed to shutdown rollout recorder: {e}");
        let event = Event {
            id: sub_id.clone(),
            msg: EventMsg::Error(ErrorEvent {
                message: "Failed to shutdown rollout recorder".to_string(),
                lyra_error_info: Some(LyraErrorInfo::Other),
            }),
        };
        sess.send_event_raw(event).await;
    }

    let event = Event {
        id: sub_id,
        msg: EventMsg::ShutdownComplete,
    };
    sess.send_event_raw(event).await;
    sess.services
        .rollout_thread_trace
        .record_ended(lyra_rollout_trace::RolloutStatus::Completed);
    true
}

pub async fn review(
    sess: &Arc<Session>,
    config: &Arc<Config>,
    sub_id: String,
    review_request: ReviewRequest,
) {
    let turn_context = sess.new_default_turn_with_sub_id(sub_id.clone()).await;
    sess.refresh_mcp_servers_if_requested(&turn_context).await;
    match resolve_review_request(review_request, &turn_context.cwd) {
        Ok(resolved) => {
            spawn_review_thread(
                Arc::clone(sess),
                Arc::clone(config),
                turn_context.clone(),
                sub_id,
                resolved,
            )
            .await;
        }
        Err(err) => {
            let event = Event {
                id: sub_id,
                msg: EventMsg::Error(ErrorEvent {
                    message: err.to_string(),
                    lyra_error_info: Some(LyraErrorInfo::Other),
                }),
            };
            sess.send_event(&turn_context, event.msg).await;
        }
    }
}

pub(super) async fn submission_loop(
    sess: Arc<Session>,
    config: Arc<Config>,
    rx_sub: Receiver<Submission>,
) {
    // To break out of this loop, send Op::Shutdown.
    while let Ok(sub) = rx_sub.recv().await {
        debug!(?sub, "Submission");
        let dispatch_span = submission_dispatch_span(&sub);
        let should_exit = async {
            match sub.op.clone() {
                Op::Interrupt => {
                    interrupt(&sess).await;
                    false
                }
                Op::CleanBackgroundTerminals => {
                    clean_background_terminals(&sess).await;
                    false
                }
                Op::OverrideTurnContext {
                    cwd,
                    approval_policy,
                    approvals_reviewer,
                    sandbox_policy,
                    windows_sandbox_level,
                    model,
                    effort,
                    verbosity,
                    summary,
                    service_tier,
                    collaboration_mode,
                } => {
                    let collaboration_mode = if let Some(collab_mode) = collaboration_mode {
                        collab_mode
                    } else {
                        let state = sess.state.lock().await;
                        state.session_configuration.collaboration_mode.with_updates(
                            model.clone(),
                            effort,
                            /*developer_instructions*/ None,
                        )
                    };
                    override_turn_context(
                        &sess,
                        sub.id.clone(),
                        SessionSettingsUpdate {
                            cwd,
                            approval_policy,
                            approvals_reviewer,
                            sandbox_policy,
                            windows_sandbox_level,
                            collaboration_mode: Some(collaboration_mode),
                            model_verbosity: verbosity,
                            reasoning_summary: summary,
                            service_tier,
                            ..Default::default()
                        },
                    )
                    .await;
                    false
                }
                Op::UserInput { .. } | Op::UserTurn { .. } => {
                    user_input_or_turn(&sess, sub.id.clone(), sub.op).await;
                    false
                }
                Op::InterAgentCommunication { communication } => {
                    inter_agent_communication(&sess, sub.id.clone(), communication).await;
                    false
                }
                Op::ExecApproval {
                    id: approval_id,
                    turn_id,
                    decision,
                } => {
                    exec_approval(&sess, approval_id, turn_id, decision).await;
                    false
                }
                Op::PatchApproval { id, decision } => {
                    patch_approval(&sess, id, decision).await;
                    false
                }
                Op::UserInputAnswer { id, response } => {
                    request_user_input_response(&sess, id, response).await;
                    false
                }
                Op::RequestPermissionsResponse { id, response } => {
                    request_permissions_response(&sess, id, response).await;
                    false
                }
                Op::DynamicToolResponse { id, response } => {
                    dynamic_tool_response(&sess, id, response).await;
                    false
                }
                Op::AddToHistory { text } => {
                    add_to_history(&sess, &config, text).await;
                    false
                }
                Op::GetHistoryEntryRequest { offset, log_id } => {
                    get_history_entry_request(&sess, &config, sub.id.clone(), offset, log_id).await;
                    false
                }
                Op::ListMcpTools => {
                    list_mcp_tools(&sess, &config, sub.id.clone()).await;
                    false
                }
                Op::RefreshMcpServers { config } => {
                    refresh_mcp_servers(&sess, config).await;
                    false
                }
                Op::ReloadUserConfig => {
                    reload_user_config(&sess).await;
                    false
                }
                Op::ListSkills { cwds, force_reload } => {
                    list_skills(&sess, sub.id.clone(), cwds, force_reload).await;
                    false
                }
                Op::Undo => {
                    undo(&sess, sub.id.clone()).await;
                    false
                }
                Op::ThreadRollback {
                    turn_id,
                    num_turns,
                    restore_files,
                } => {
                    thread_rollback(&sess, sub.id.clone(), turn_id, num_turns, restore_files).await;
                    false
                }
                Op::SetThreadName { name } => {
                    set_thread_name(&sess, sub.id.clone(), name).await;
                    false
                }
                Op::SetThreadMemoryMode { mode } => {
                    set_thread_memory_mode(&sess, sub.id.clone(), mode).await;
                    false
                }
                Op::RunUserShellCommand { command } => {
                    run_user_shell_command(&sess, sub.id.clone(), command).await;
                    false
                }
                Op::ResolveElicitation {
                    server_name,
                    request_id,
                    decision,
                    content,
                    meta,
                } => {
                    resolve_elicitation(&sess, server_name, request_id, decision, content, meta)
                        .await;
                    false
                }
                Op::Shutdown => shutdown(&sess, sub.id.clone()).await,
                Op::Review { review_request } => {
                    review(&sess, &config, sub.id.clone(), review_request).await;
                    false
                }
                _ => false, // Ignore unknown ops; enum is non_exhaustive to allow extensions.
            }
        }
        .instrument(dispatch_span)
        .await;
        if should_exit {
            break;
        }
    }
    // Also drain cached auto_review state if the submission loop exits because
    // the channel closed without receiving an explicit shutdown op.
    sess.auto_review_session.shutdown().await;
    debug!("Agent loop exited");
}

pub(super) fn submission_dispatch_span(sub: &Submission) -> tracing::Span {
    let op_name = sub.op.kind();
    let span_name = format!("op.dispatch.{op_name}");
    let dispatch_span = info_span!(
        "submission_dispatch",
        otel.name = span_name.as_str(),
        submission.id = sub.id.as_str(),
        lyra.op = op_name
    );
    if let Some(trace) = sub.trace.as_ref()
        && !set_parent_from_w3c_trace_context(&dispatch_span, trace)
    {
        warn!(
            submission.id = sub.id.as_str(),
            "ignoring invalid submission trace carrier"
        );
    }
    dispatch_span
}
