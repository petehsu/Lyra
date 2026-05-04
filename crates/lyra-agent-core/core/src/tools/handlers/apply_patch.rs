use std::collections::BTreeSet;
use std::collections::HashMap;
use std::path::Path;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use std::time::Instant;

use crate::apply_patch;
use crate::apply_patch::InternalApplyPatchInvocation;
use crate::apply_patch::convert_apply_patch_to_protocol;
use crate::function_tool::FunctionCallError;
use crate::session::session::Session;
use crate::session::turn_context::TurnContext;
use crate::tools::context::ApplyPatchToolOutput;
use crate::tools::context::FunctionToolOutput;
use crate::tools::context::SharedTurnDiffTracker;
use crate::tools::context::ToolInvocation;
use crate::tools::context::ToolOutput;
use crate::tools::context::ToolPayload;
use crate::tools::events::ToolEmitter;
use crate::tools::events::ToolEventCtx;
use crate::tools::handlers::apply_granted_turn_permissions;
use crate::tools::handlers::parse_arguments;
use crate::tools::hook_names::HookToolName;
use crate::tools::orchestrator::ToolOrchestrator;
use crate::tools::registry::PostToolUsePayload;
use crate::tools::registry::PreToolUsePayload;
use crate::tools::registry::ToolArgumentDiffConsumer;
use crate::tools::registry::ToolHandler;
use crate::tools::registry::ToolKind;
use crate::tools::runtimes::apply_patch::ApplyPatchRequest;
use crate::tools::runtimes::apply_patch::ApplyPatchRuntime;
use crate::tools::sandboxing::ToolCtx;
use lyra_apply_patch::ApplyPatchAction;
use lyra_apply_patch::ApplyPatchArgs;
use lyra_apply_patch::ApplyPatchFileChange;
use lyra_apply_patch::Hunk;
use lyra_apply_patch::parse_patch_streaming;
use lyra_exec_server::ExecutorFileSystem;
use lyra_features::Feature;
use lyra_protocol::models::FileSystemPermissions;
use lyra_protocol::models::PermissionProfile;
use lyra_protocol::protocol::EventMsg;
use lyra_protocol::protocol::FileChange;
use lyra_protocol::protocol::PatchApplyUpdatedEvent;
use lyra_sandboxing::policy_transforms::effective_file_system_sandbox_policy;
use lyra_sandboxing::policy_transforms::merge_permission_profiles;
use lyra_sandboxing::policy_transforms::normalize_additional_permissions;
use lyra_tools::ApplyPatchToolArgs;
use lyra_utils_absolute_path::AbsolutePathBuf;

pub struct ApplyPatchHandler;

const APPLY_PATCH_ARGUMENT_DIFF_BUFFER_INTERVAL: Duration = Duration::from_millis(500);

#[derive(Default)]
struct ApplyPatchArgumentDiffConsumer {
    input: String,
    last_progress: Option<Vec<Hunk>>,
    last_sent_at: Option<Instant>,
    pending: Option<PatchApplyUpdatedEvent>,
}

impl ToolArgumentDiffConsumer for ApplyPatchArgumentDiffConsumer {
    fn consume_diff(
        &mut self,
        turn: &TurnContext,
        call_id: String,
        diff: &str,
    ) -> Option<EventMsg> {
        if !turn.features.enabled(Feature::ApplyPatchStreamingEvents) {
            return None;
        }

        self.push_delta(call_id, turn.sub_id.clone(), diff)
            .map(EventMsg::PatchApplyUpdated)
    }

    fn consume_complete(
        &mut self,
        turn: &TurnContext,
        call_id: String,
        payload: &ToolPayload,
    ) -> Option<EventMsg> {
        let patch_input = apply_patch_input(payload)?;
        self.push_complete(call_id, turn.sub_id.clone(), patch_input)
            .map(EventMsg::PatchApplyUpdated)
    }

    fn flush_on_complete(&mut self) -> Option<EventMsg> {
        self.flush_update_on_complete()
            .map(EventMsg::PatchApplyUpdated)
    }
}

impl ApplyPatchArgumentDiffConsumer {
    fn push_delta(
        &mut self,
        call_id: String,
        turn_id: String,
        delta: &str,
    ) -> Option<PatchApplyUpdatedEvent> {
        self.input.push_str(delta);

        let patch_input = apply_patch_streaming_preview_input(&self.input)?;
        let ApplyPatchArgs { hunks, .. } = parse_patch_streaming(&patch_input).ok()?;
        if hunks.is_empty() {
            return None;
        }
        if self.last_progress.as_ref() == Some(&hunks) {
            return None;
        }

        let changes = convert_apply_patch_hunks_to_protocol(&hunks);
        self.last_progress = Some(hunks);
        let event = PatchApplyUpdatedEvent {
            call_id,
            turn_id,
            changes,
        };
        let now = Instant::now();
        match self.last_sent_at {
            Some(last_sent_at)
                if now.duration_since(last_sent_at) < APPLY_PATCH_ARGUMENT_DIFF_BUFFER_INTERVAL =>
            {
                self.pending = Some(event);
                None
            }
            Some(_) | None => {
                self.pending = None;
                self.last_sent_at = Some(now);
                Some(event)
            }
        }
    }

    fn push_complete(
        &mut self,
        call_id: String,
        turn_id: String,
        patch_input: String,
    ) -> Option<PatchApplyUpdatedEvent> {
        self.input = patch_input;
        let ApplyPatchArgs { hunks, .. } = parse_patch_streaming(&self.input).ok()?;
        if hunks.is_empty() || self.last_progress.as_ref() == Some(&hunks) {
            return None;
        }

        self.pending = None;
        self.last_sent_at = Some(Instant::now());
        self.last_progress = Some(hunks.clone());
        Some(PatchApplyUpdatedEvent {
            call_id,
            turn_id,
            changes: convert_apply_patch_hunks_to_protocol(&hunks),
        })
    }

    fn flush_update_on_complete(&mut self) -> Option<PatchApplyUpdatedEvent> {
        let event = self.pending.take();
        if event.is_some() {
            self.last_sent_at = Some(Instant::now());
        }
        event
    }
}

fn apply_patch_streaming_preview_input(input: &str) -> Option<String> {
    if input.trim_start().starts_with("*** Begin Patch") {
        return Some(input.to_string());
    }
    if let Ok(args) = parse_arguments::<ApplyPatchToolArgs>(input) {
        return Some(args.input);
    }
    extract_partial_json_string_field(input, "input")
}

fn extract_partial_json_string_field(input: &str, field_name: &str) -> Option<String> {
    let key = format!("\"{field_name}\"");
    let key_start = input.find(&key)?;
    let after_key = &input[key_start + key.len()..];
    let colon = after_key.find(':')?;
    let mut chars = after_key[colon + 1..].char_indices().peekable();

    while let Some((_, ch)) = chars.peek().copied() {
        if !ch.is_whitespace() {
            break;
        }
        chars.next();
    }
    if !matches!(chars.next(), Some((_, '"'))) {
        return None;
    }

    let mut value = String::new();
    while let Some((_, ch)) = chars.next() {
        match ch {
            '"' => return Some(value),
            '\\' => {
                let Some((_, escaped)) = chars.next() else {
                    return (!value.is_empty()).then_some(value);
                };
                match escaped {
                    '"' | '\\' | '/' => value.push(escaped),
                    'b' => value.push('\u{0008}'),
                    'f' => value.push('\u{000C}'),
                    'n' => value.push('\n'),
                    'r' => value.push('\r'),
                    't' => value.push('\t'),
                    'u' => {
                        let mut code = String::with_capacity(4);
                        for _ in 0..4 {
                            let Some((_, hex)) = chars.next() else {
                                return (!value.is_empty()).then_some(value);
                            };
                            if !hex.is_ascii_hexdigit() {
                                return (!value.is_empty()).then_some(value);
                            }
                            code.push(hex);
                        }
                        if let Ok(codepoint) = u32::from_str_radix(&code, 16)
                            && let Some(decoded) = char::from_u32(codepoint)
                        {
                            value.push(decoded);
                        }
                    }
                    other => value.push(other),
                }
            }
            other => value.push(other),
        }
    }

    (!value.is_empty()).then_some(value)
}

fn apply_patch_input(payload: &ToolPayload) -> Option<String> {
    match payload {
        ToolPayload::Function { arguments } => parse_arguments::<ApplyPatchToolArgs>(arguments)
            .ok()
            .map(|args| args.input),
        ToolPayload::Custom { input } => Some(input.clone()),
        _ => None,
    }
}

fn convert_apply_patch_hunks_to_protocol(hunks: &[Hunk]) -> HashMap<PathBuf, FileChange> {
    hunks
        .iter()
        .map(|hunk| {
            let path = hunk_source_path(hunk).to_path_buf();
            let change = match hunk {
                Hunk::AddFile { contents, .. } => FileChange::Add {
                    content: contents.clone(),
                },
                Hunk::DeleteFile { .. } => FileChange::Delete {
                    content: String::new(),
                },
                Hunk::UpdateFile {
                    chunks, move_path, ..
                } => FileChange::Update {
                    unified_diff: format_update_chunks_for_progress(chunks),
                    move_path: move_path.clone(),
                },
            };
            (path, change)
        })
        .collect()
}

fn hunk_source_path(hunk: &Hunk) -> &Path {
    match hunk {
        Hunk::AddFile { path, .. } | Hunk::DeleteFile { path } | Hunk::UpdateFile { path, .. } => {
            path
        }
    }
}

fn format_update_chunks_for_progress(chunks: &[lyra_apply_patch::UpdateFileChunk]) -> String {
    let mut unified_diff = String::new();
    for chunk in chunks {
        match &chunk.change_context {
            Some(context) => {
                unified_diff.push_str("@@ ");
                unified_diff.push_str(context);
                unified_diff.push('\n');
            }
            None => {
                unified_diff.push_str("@@");
                unified_diff.push('\n');
            }
        }
        for line in &chunk.old_lines {
            unified_diff.push('-');
            unified_diff.push_str(line);
            unified_diff.push('\n');
        }
        for line in &chunk.new_lines {
            unified_diff.push('+');
            unified_diff.push_str(line);
            unified_diff.push('\n');
        }
        if chunk.is_end_of_file {
            unified_diff.push_str("*** End of File");
            unified_diff.push('\n');
        }
    }
    unified_diff
}

fn file_paths_for_action(action: &ApplyPatchAction) -> Vec<AbsolutePathBuf> {
    let mut keys = Vec::new();
    let cwd = &action.cwd;

    for (path, change) in action.changes() {
        if let Some(key) = to_abs_path(cwd, path) {
            keys.push(key);
        }

        if let ApplyPatchFileChange::Update { move_path, .. } = change
            && let Some(dest) = move_path
            && let Some(key) = to_abs_path(cwd, dest)
        {
            keys.push(key);
        }
    }

    keys
}

fn to_abs_path(cwd: &AbsolutePathBuf, path: &Path) -> Option<AbsolutePathBuf> {
    Some(AbsolutePathBuf::resolve_path_against_base(path, cwd))
}

fn write_permissions_for_paths(
    file_paths: &[AbsolutePathBuf],
    file_system_sandbox_policy: &lyra_protocol::permissions::FileSystemSandboxPolicy,
    cwd: &AbsolutePathBuf,
) -> Option<PermissionProfile> {
    let write_paths = file_paths
        .iter()
        .map(|path| {
            path.parent()
                .unwrap_or_else(|| path.clone())
                .into_path_buf()
        })
        .filter(|path| {
            !file_system_sandbox_policy.can_write_path_with_cwd(path.as_path(), cwd.as_path())
        })
        .collect::<BTreeSet<_>>()
        .into_iter()
        .map(AbsolutePathBuf::from_absolute_path)
        .collect::<Result<Vec<_>, _>>()
        .ok()?;

    let permissions = (!write_paths.is_empty()).then_some(PermissionProfile {
        file_system: Some(FileSystemPermissions {
            read: Some(vec![]),
            write: Some(write_paths),
        }),
        ..Default::default()
    })?;

    normalize_additional_permissions(permissions).ok()
}

async fn effective_patch_permissions(
    session: &Session,
    turn: &TurnContext,
    action: &ApplyPatchAction,
) -> (
    Vec<AbsolutePathBuf>,
    crate::tools::handlers::EffectiveAdditionalPermissions,
    lyra_protocol::permissions::FileSystemSandboxPolicy,
) {
    let file_paths = file_paths_for_action(action);
    let granted_permissions = merge_permission_profiles(
        session.granted_session_permissions().await.as_ref(),
        session.granted_turn_permissions().await.as_ref(),
    );
    let file_system_sandbox_policy = effective_file_system_sandbox_policy(
        &turn.file_system_sandbox_policy,
        granted_permissions.as_ref(),
    );
    let effective_additional_permissions = apply_granted_turn_permissions(
        session,
        crate::sandboxing::SandboxPermissions::UseDefault,
        write_permissions_for_paths(&file_paths, &file_system_sandbox_policy, &turn.cwd),
    )
    .await;

    (
        file_paths,
        effective_additional_permissions,
        file_system_sandbox_policy,
    )
}

impl ToolHandler for ApplyPatchHandler {
    type Output = ApplyPatchToolOutput;

    fn kind(&self) -> ToolKind {
        ToolKind::Function
    }

    fn matches_kind(&self, payload: &ToolPayload) -> bool {
        matches!(
            payload,
            ToolPayload::Function { .. } | ToolPayload::Custom { .. }
        )
    }

    async fn is_mutating(&self, _invocation: &ToolInvocation) -> bool {
        true
    }

    fn pre_tool_use_payload(&self, invocation: &ToolInvocation) -> Option<PreToolUsePayload> {
        apply_patch_input(&invocation.payload).map(|input| PreToolUsePayload {
            tool_name: HookToolName::apply_patch(),
            tool_input: serde_json::json!({ "command": input }),
        })
    }

    fn post_tool_use_payload(
        &self,
        invocation: &ToolInvocation,
        result: &Self::Output,
    ) -> Option<PostToolUsePayload> {
        let input = apply_patch_input(&invocation.payload)?;
        let tool_response =
            result.post_tool_use_response(&invocation.call_id, &invocation.payload)?;
        Some(PostToolUsePayload {
            tool_name: HookToolName::apply_patch(),
            tool_use_id: invocation.call_id.clone(),
            tool_input: serde_json::json!({ "command": input }),
            tool_response,
        })
    }

    fn create_diff_consumer(&self) -> Option<Box<dyn ToolArgumentDiffConsumer>> {
        Some(Box::<ApplyPatchArgumentDiffConsumer>::default())
    }

    async fn handle(&self, invocation: ToolInvocation) -> Result<Self::Output, FunctionCallError> {
        let ToolInvocation {
            session,
            turn,
            tracker,
            call_id,
            tool_name,
            payload,
            ..
        } = invocation;

        let patch_input = match payload {
            ToolPayload::Function { arguments } => {
                let args: ApplyPatchToolArgs = parse_arguments(&arguments)?;
                args.input
            }
            ToolPayload::Custom { input } => input,
            _ => {
                return Err(FunctionCallError::RespondToModel(
                    "apply_patch handler received unsupported payload".to_string(),
                ));
            }
        };

        // Re-parse and verify the patch so we can compute changes and approval.
        // Avoid building temporary ExecParams/command vectors; derive directly from inputs.
        let cwd = turn.cwd.clone();
        let command = vec!["apply_patch".to_string(), patch_input.clone()];
        let Some(environment) = turn.environment.as_ref() else {
            return Err(FunctionCallError::RespondToModel(
                "apply_patch is unavailable in this session".to_string(),
            ));
        };
        let fs = environment.get_filesystem();
        let sandbox = environment
            .is_remote()
            .then(|| turn.file_system_sandbox_context(/*additional_permissions*/ None));
        match lyra_apply_patch::maybe_parse_apply_patch_verified(
            &command,
            &cwd,
            fs.as_ref(),
            sandbox.as_ref(),
        )
        .await
        {
            lyra_apply_patch::MaybeApplyPatchVerified::Body(changes) => {
                let (file_paths, effective_additional_permissions, file_system_sandbox_policy) =
                    effective_patch_permissions(session.as_ref(), turn.as_ref(), &changes).await;
                match apply_patch::apply_patch(turn.as_ref(), &file_system_sandbox_policy, changes)
                    .await
                {
                    InternalApplyPatchInvocation::Output(item) => {
                        let content = item?;
                        Ok(ApplyPatchToolOutput::from_text(content))
                    }
                    InternalApplyPatchInvocation::DelegateToRuntime(apply) => {
                        let changes = convert_apply_patch_to_protocol(&apply.action);
                        let emitter =
                            ToolEmitter::apply_patch(changes.clone(), apply.auto_approved);
                        let event_ctx = ToolEventCtx::new(
                            session.as_ref(),
                            turn.as_ref(),
                            &call_id,
                            Some(&tracker),
                        );
                        emitter.begin(event_ctx).await;

                        let req = ApplyPatchRequest {
                            action: apply.action,
                            file_paths,
                            changes,
                            exec_approval_requirement: apply.exec_approval_requirement,
                            additional_permissions: effective_additional_permissions
                                .additional_permissions,
                            permissions_preapproved: effective_additional_permissions
                                .permissions_preapproved,
                        };

                        let mut orchestrator = ToolOrchestrator::new();
                        let mut runtime = ApplyPatchRuntime::new();
                        let tool_ctx = ToolCtx {
                            session: session.clone(),
                            turn: turn.clone(),
                            call_id: call_id.clone(),
                            tool_name: tool_name.display(),
                        };
                        let out = orchestrator
                            .run(
                                &mut runtime,
                                &req,
                                &tool_ctx,
                                turn.as_ref(),
                                turn.approval_policy.value(),
                            )
                            .await
                            .map(|result| result.output);
                        let event_ctx = ToolEventCtx::new(
                            session.as_ref(),
                            turn.as_ref(),
                            &call_id,
                            Some(&tracker),
                        );
                        let content = emitter.finish(event_ctx, out).await?;
                        Ok(ApplyPatchToolOutput::from_text(content))
                    }
                }
            }
            lyra_apply_patch::MaybeApplyPatchVerified::CorrectnessError(parse_error) => {
                Err(FunctionCallError::RespondToModel(format!(
                    "apply_patch verification failed: {parse_error}"
                )))
            }
            lyra_apply_patch::MaybeApplyPatchVerified::ShellParseError(error) => {
                tracing::trace!("Failed to parse apply_patch input, {error:?}");
                Err(FunctionCallError::RespondToModel(
                    "apply_patch handler received invalid patch input".to_string(),
                ))
            }
            lyra_apply_patch::MaybeApplyPatchVerified::NotApplyPatch => {
                Err(FunctionCallError::RespondToModel(
                    "apply_patch handler received non-apply_patch input".to_string(),
                ))
            }
        }
    }
}

#[allow(clippy::too_many_arguments)]
pub(crate) async fn intercept_apply_patch(
    command: &[String],
    cwd: &AbsolutePathBuf,
    fs: &dyn ExecutorFileSystem,
    session: Arc<Session>,
    turn: Arc<TurnContext>,
    tracker: Option<&SharedTurnDiffTracker>,
    call_id: &str,
    tool_name: &str,
) -> Result<Option<FunctionToolOutput>, FunctionCallError> {
    let sandbox = turn
        .environment
        .as_ref()
        .filter(|env| env.is_remote())
        .map(|_| turn.file_system_sandbox_context(/*additional_permissions*/ None));
    match lyra_apply_patch::maybe_parse_apply_patch_verified(command, cwd, fs, sandbox.as_ref())
        .await
    {
        lyra_apply_patch::MaybeApplyPatchVerified::Body(changes) => {
            session
                .record_model_warning(
                    format!(
                        "apply_patch was requested via {tool_name}. Use the apply_patch tool instead of exec_command."
                    ),
                    turn.as_ref(),
                )
                .await;
            let (approval_keys, effective_additional_permissions, file_system_sandbox_policy) =
                effective_patch_permissions(session.as_ref(), turn.as_ref(), &changes).await;
            match apply_patch::apply_patch(turn.as_ref(), &file_system_sandbox_policy, changes)
                .await
            {
                InternalApplyPatchInvocation::Output(item) => {
                    let content = item?;
                    Ok(Some(FunctionToolOutput::from_text(content, Some(true))))
                }
                InternalApplyPatchInvocation::DelegateToRuntime(apply) => {
                    let changes = convert_apply_patch_to_protocol(&apply.action);
                    let emitter = ToolEmitter::apply_patch(changes.clone(), apply.auto_approved);
                    let event_ctx = ToolEventCtx::new(
                        session.as_ref(),
                        turn.as_ref(),
                        call_id,
                        tracker.as_ref().copied(),
                    );
                    emitter.begin(event_ctx).await;

                    let req = ApplyPatchRequest {
                        action: apply.action,
                        file_paths: approval_keys,
                        changes,
                        exec_approval_requirement: apply.exec_approval_requirement,
                        additional_permissions: effective_additional_permissions
                            .additional_permissions,
                        permissions_preapproved: effective_additional_permissions
                            .permissions_preapproved,
                    };

                    let mut orchestrator = ToolOrchestrator::new();
                    let mut runtime = ApplyPatchRuntime::new();
                    let tool_ctx = ToolCtx {
                        session: session.clone(),
                        turn: turn.clone(),
                        call_id: call_id.to_string(),
                        tool_name: tool_name.to_string(),
                    };
                    let out = orchestrator
                        .run(
                            &mut runtime,
                            &req,
                            &tool_ctx,
                            turn.as_ref(),
                            turn.approval_policy.value(),
                        )
                        .await
                        .map(|result| result.output);
                    let event_ctx = ToolEventCtx::new(
                        session.as_ref(),
                        turn.as_ref(),
                        call_id,
                        tracker.as_ref().copied(),
                    );
                    let content = emitter.finish(event_ctx, out).await?;
                    Ok(Some(FunctionToolOutput::from_text(content, Some(true))))
                }
            }
        }
        lyra_apply_patch::MaybeApplyPatchVerified::CorrectnessError(parse_error) => {
            Err(FunctionCallError::RespondToModel(format!(
                "apply_patch verification failed: {parse_error}"
            )))
        }
        lyra_apply_patch::MaybeApplyPatchVerified::ShellParseError(error) => {
            tracing::trace!("Failed to parse apply_patch input, {error:?}");
            Ok(None)
        }
        lyra_apply_patch::MaybeApplyPatchVerified::NotApplyPatch => Ok(None),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn streaming_preview_extracts_raw_patch() {
        let input = "*** Begin Patch\n*** Add File: src/hello.txt\n+hel";

        let preview = apply_patch_streaming_preview_input(input).expect("preview input");

        assert_eq!(preview, input);
        let parsed = parse_patch_streaming(&preview).expect("partial patch should parse");
        assert_eq!(parsed.hunks.len(), 1);
    }

    #[test]
    fn streaming_preview_extracts_partial_function_arguments() {
        let input = "{\"input\":\"*** Begin Patch\\n*** Add File: src/hello.txt\\n+hel";

        let preview = apply_patch_streaming_preview_input(input).expect("preview input");

        assert!(preview.starts_with("*** Begin Patch\n*** Add File: src/hello.txt\n+hel"));
        let parsed = parse_patch_streaming(&preview).expect("partial patch should parse");
        assert_eq!(parsed.hunks.len(), 1);
    }

    #[test]
    fn streaming_preview_extracts_complete_function_arguments() {
        let input = "{\"input\":\"*** Begin Patch\\n*** Add File: src/hello.txt\\n+hello\\n*** End Patch\"}";

        let preview = apply_patch_streaming_preview_input(input).expect("preview input");

        assert!(preview.contains("+hello\n*** End Patch"));
        let parsed = parse_patch_streaming(&preview).expect("complete patch should parse");
        assert_eq!(parsed.hunks.len(), 1);
    }

    #[test]
    fn streaming_delta_preview_emits_file_change_update() {
        let mut consumer = ApplyPatchArgumentDiffConsumer::default();
        let event = consumer
            .push_delta(
                "patch-1".to_string(),
                "turn-1".to_string(),
                "*** Begin Patch\n*** Add File: src/hello.txt\n+hello\n*** End Patch",
            )
            .expect("streaming update");

        assert_eq!(event.turn_id, "turn-1");
        assert_eq!(event.changes.len(), 1);
    }

    #[test]
    fn complete_payload_skips_identical_preview_snapshot() {
        let patch = "*** Begin Patch\n*** Add File: src/hello.txt\n+hello\n*** End Patch";
        let mut consumer = ApplyPatchArgumentDiffConsumer::default();
        consumer
            .push_delta("patch-1".to_string(), "turn-1".to_string(), patch)
            .expect("streaming update");

        assert!(
            consumer
                .push_complete(
                    "patch-1".to_string(),
                    "turn-1".to_string(),
                    patch.to_string()
                )
                .is_none()
        );
    }
}
