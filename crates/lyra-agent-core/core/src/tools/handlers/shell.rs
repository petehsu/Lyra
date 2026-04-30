use lyra_protocol::ThreadId;
use lyra_protocol::error::LyraErr;
use lyra_protocol::error::SandboxErr;
use lyra_protocol::exec_output::ExecToolCallOutput;
use lyra_protocol::models::ShellCommandToolCallParams;
use lyra_protocol::models::ShellToolCallParams;
use lyra_protocol::protocol::FileChange;
use serde_json::Value as JsonValue;
use std::collections::HashMap;
use std::path::Path;
use std::path::PathBuf;
use std::sync::Arc;

use crate::exec::ExecCapturePolicy;
use crate::exec::ExecParams;
use crate::exec_env::create_env;
use crate::exec_policy::ExecApprovalRequest;
use crate::function_tool::FunctionCallError;
use crate::maybe_emit_implicit_skill_invocation;
use crate::session::turn_context::TurnContext;
use crate::shell::Shell;
use crate::tools::context::FunctionToolOutput;
use crate::tools::context::ToolInvocation;
use crate::tools::context::ToolOutput;
use crate::tools::context::ToolPayload;
use crate::tools::events::ToolEmitter;
use crate::tools::events::ToolEventCtx;
use crate::tools::events::ToolEventFailure;
use crate::tools::events::ToolEventStage;
use crate::tools::handlers::apply_granted_turn_permissions;
use crate::tools::handlers::apply_patch::intercept_apply_patch;
use crate::tools::handlers::implicit_granted_permissions;
use crate::tools::handlers::normalize_and_validate_additional_permissions;
use crate::tools::handlers::parse_arguments;
use crate::tools::handlers::parse_arguments_with_base_path;
use crate::tools::handlers::resolve_workdir_base_path;
use crate::tools::hook_names::HookToolName;
use crate::tools::orchestrator::ToolOrchestrator;
use crate::tools::registry::PostToolUsePayload;
use crate::tools::registry::PreToolUsePayload;
use crate::tools::registry::ToolHandler;
use crate::tools::registry::ToolKind;
use crate::tools::runtimes::shell::ShellRequest;
use crate::tools::runtimes::shell::ShellRuntime;
use crate::tools::runtimes::shell::ShellRuntimeBackend;
use crate::tools::sandboxing::ToolCtx;
use crate::tools::sandboxing::ToolError;
use lyra_features::Feature;
use lyra_protocol::models::PermissionProfile;
use lyra_protocol::protocol::ExecCommandSource;
use lyra_shell_command::is_safe_command::is_known_safe_command;
use lyra_shell_command::parse_command::extract_shell_command;
use lyra_tools::ShellCommandBackendConfig;
use lyra_utils_absolute_path::AbsolutePathBuf;

pub struct ShellHandler;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ShellCommandBackend {
    Classic,
    ZshFork,
}

pub struct ShellCommandHandler {
    backend: ShellCommandBackend,
}

fn shell_payload_command(payload: &ToolPayload) -> Option<String> {
    match payload {
        ToolPayload::Function { arguments } => parse_arguments::<ShellToolCallParams>(arguments)
            .ok()
            .map(|params| lyra_shell_command::parse_command::shlex_join(&params.command)),
        ToolPayload::LocalShell { params } => Some(lyra_shell_command::parse_command::shlex_join(
            &params.command,
        )),
        _ => None,
    }
}

fn shell_command_payload_command(payload: &ToolPayload) -> Option<String> {
    let ToolPayload::Function { arguments } = payload else {
        return None;
    };

    parse_arguments::<ShellCommandToolCallParams>(arguments)
        .ok()
        .map(|params| params.command)
}

pub(crate) fn detect_shell_file_changes(
    command: &[String],
    cwd: &AbsolutePathBuf,
) -> HashMap<PathBuf, FileChange> {
    let mut paths = Vec::new();
    if let Some((_, script)) = extract_shell_command(command) {
        collect_write_paths_from_script(script, cwd, &mut paths);
    } else {
        collect_write_paths_from_tokens(command, cwd, &mut paths);
    }

    paths
        .into_iter()
        .map(|path| {
            let change = if path.exists() {
                FileChange::Update {
                    unified_diff: String::new(),
                    move_path: None,
                }
            } else {
                FileChange::Add {
                    content: String::new(),
                }
            };
            (path, change)
        })
        .collect()
}

fn collect_write_paths_from_script(script: &str, cwd: &AbsolutePathBuf, paths: &mut Vec<PathBuf>) {
    if let Some(tokens) = shlex::split(script) {
        collect_write_paths_from_tokens(&tokens, cwd, paths);
    }
    collect_redirection_paths_from_script(script, cwd, paths);
}

fn collect_write_paths_from_tokens(
    tokens: &[String],
    cwd: &AbsolutePathBuf,
    paths: &mut Vec<PathBuf>,
) {
    let mut idx = 0;
    while idx < tokens.len() {
        let token = tokens[idx].as_str();
        if is_tee_command(token) {
            idx = collect_tee_paths(tokens, idx + 1, cwd, paths);
            continue;
        }

        match redirection_target(tokens, idx) {
            RedirectionTarget::Inline(path) => {
                push_static_shell_path(&path, cwd, paths);
            }
            RedirectionTarget::Next => {
                if let Some(path) = tokens.get(idx + 1) {
                    push_static_shell_path(path, cwd, paths);
                    idx += 1;
                }
            }
            RedirectionTarget::None => {}
        }

        idx += 1;
    }
}

fn collect_tee_paths(
    tokens: &[String],
    mut idx: usize,
    cwd: &AbsolutePathBuf,
    paths: &mut Vec<PathBuf>,
) -> usize {
    let mut options_done = false;
    while idx < tokens.len() {
        let token = tokens[idx].as_str();
        if is_shell_control_token(token) {
            break;
        }
        if !matches!(redirection_target(tokens, idx), RedirectionTarget::None) {
            break;
        }
        if !options_done && token == "--" {
            options_done = true;
            idx += 1;
            continue;
        }
        if !options_done && token.starts_with('-') {
            idx += 1;
            continue;
        }
        push_static_shell_path(token, cwd, paths);
        idx += 1;
    }
    idx
}

enum RedirectionTarget {
    None,
    Next,
    Inline(String),
}

fn redirection_target(tokens: &[String], idx: usize) -> RedirectionTarget {
    let token = tokens[idx].as_str();
    if matches!(token, ">" | ">>" | ">|" | "&>" | "&>>") || is_fd_redirect_token(token) {
        return RedirectionTarget::Next;
    }

    for marker in [">>|", ">>", ">|", ">"] {
        if let Some((prefix, suffix)) = token.split_once(marker)
            && (prefix.is_empty() || prefix.chars().all(|ch| ch.is_ascii_digit()) || prefix == "&")
            && !suffix.is_empty()
        {
            return RedirectionTarget::Inline(suffix.to_string());
        }
    }

    RedirectionTarget::None
}

fn is_fd_redirect_token(token: &str) -> bool {
    let Some(prefix) = token.strip_suffix('>') else {
        return false;
    };
    !prefix.is_empty() && prefix.chars().all(|ch| ch.is_ascii_digit())
}

fn collect_redirection_paths_from_script(
    script: &str,
    cwd: &AbsolutePathBuf,
    paths: &mut Vec<PathBuf>,
) {
    let bytes = script.as_bytes();
    let mut idx = 0;
    while idx < bytes.len() {
        if bytes[idx] != b'>' {
            idx += 1;
            continue;
        }
        let mut target_start = idx + 1;
        if target_start < bytes.len() && bytes[target_start] == b'>' {
            target_start += 1;
        }
        while target_start < bytes.len() && bytes[target_start].is_ascii_whitespace() {
            target_start += 1;
        }
        if target_start >= bytes.len() || matches!(bytes[target_start], b'&' | b'|' | b'>') {
            idx += 1;
            continue;
        }

        let (target, next_idx) = read_shell_path_token(script, target_start);
        if !target.is_empty() {
            push_static_shell_path(target.as_str(), cwd, paths);
        }
        idx = next_idx.max(idx + 1);
    }
}

fn read_shell_path_token(script: &str, start: usize) -> (String, usize) {
    let bytes = script.as_bytes();
    if matches!(bytes.get(start), Some(b'"' | b'\'')) {
        let quote = bytes[start];
        let mut end = start + 1;
        while end < bytes.len() && bytes[end] != quote {
            end += 1;
        }
        let token = script[start + 1..end].to_string();
        return (token, end.saturating_add(1));
    }

    let mut end = start;
    while end < bytes.len() && !bytes[end].is_ascii_whitespace() && !b";|&<>".contains(&bytes[end])
    {
        end += 1;
    }
    (script[start..end].to_string(), end)
}

fn is_tee_command(token: &str) -> bool {
    Path::new(token)
        .file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name == "tee")
}

fn is_shell_control_token(token: &str) -> bool {
    matches!(token, "|" | ";" | "&&" | "||")
}

fn push_static_shell_path(path: &str, cwd: &AbsolutePathBuf, paths: &mut Vec<PathBuf>) {
    let path = path.trim().trim_end_matches(';');
    if path.is_empty()
        || path == "/dev/null"
        || path == "dev/null"
        || path.starts_with('&')
        || path.contains(['$', '`', '*', '?', '[', ']', '{', '}'])
    {
        return;
    }
    let path = Path::new(path);
    let path = if path.is_absolute() {
        match AbsolutePathBuf::from_absolute_path(path) {
            Ok(path) => path.to_path_buf(),
            Err(_) => return,
        }
    } else {
        cwd.join(path).to_path_buf()
    };
    if !paths.iter().any(|existing| existing == &path) {
        paths.push(path);
    }
}

fn shell_file_change_finish_stage(out: &Result<ExecToolCallOutput, ToolError>) -> ToolEventStage {
    match out {
        Ok(output) => ToolEventStage::Success(output.clone()),
        Err(ToolError::Lyra(LyraErr::Sandbox(SandboxErr::Timeout { output })))
        | Err(ToolError::Lyra(LyraErr::Sandbox(SandboxErr::Denied { output, .. }))) => {
            ToolEventStage::Failure(ToolEventFailure::Output((**output).clone()))
        }
        Err(ToolError::Lyra(err)) => ToolEventStage::Failure(ToolEventFailure::Message(format!(
            "execution error: {err:?}"
        ))),
        Err(ToolError::Rejected(message)) => {
            ToolEventStage::Failure(ToolEventFailure::Rejected(message.clone()))
        }
    }
}

struct RunExecLikeArgs {
    tool_name: String,
    exec_params: ExecParams,
    hook_command: String,
    additional_permissions: Option<PermissionProfile>,
    prefix_rule: Option<Vec<String>>,
    session: Arc<crate::session::session::Session>,
    turn: Arc<TurnContext>,
    tracker: crate::tools::context::SharedTurnDiffTracker,
    call_id: String,
    freeform: bool,
    shell_runtime_backend: ShellRuntimeBackend,
}

impl ShellHandler {
    fn to_exec_params(
        params: &ShellToolCallParams,
        turn_context: &TurnContext,
        thread_id: ThreadId,
    ) -> ExecParams {
        ExecParams {
            command: params.command.clone(),
            cwd: turn_context.resolve_path(params.workdir.clone()),
            expiration: params.timeout_ms.into(),
            capture_policy: ExecCapturePolicy::ShellTool,
            env: create_env(&turn_context.shell_environment_policy, Some(thread_id)),
            network: turn_context.network.clone(),
            sandbox_permissions: params.sandbox_permissions.unwrap_or_default(),
            windows_sandbox_level: turn_context.windows_sandbox_level,
            windows_sandbox_private_desktop: turn_context
                .config
                .permissions
                .windows_sandbox_private_desktop,
            justification: params.justification.clone(),
            arg0: None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use pretty_assertions::assert_eq;

    fn cwd(dir: &Path) -> AbsolutePathBuf {
        AbsolutePathBuf::from_absolute_path(dir).expect("absolute temp dir")
    }

    fn changed_paths(command: &[&str], cwd: &AbsolutePathBuf) -> Vec<PathBuf> {
        let command = command
            .iter()
            .map(|part| part.to_string())
            .collect::<Vec<_>>();
        let mut paths = detect_shell_file_changes(&command, cwd)
            .into_keys()
            .collect::<Vec<_>>();
        paths.sort();
        paths
    }

    #[test]
    fn detects_shell_redirect_and_heredoc_writes() {
        let temp = tempfile::tempdir().expect("tempdir");
        let cwd = cwd(temp.path());

        assert_eq!(
            changed_paths(&["bash", "-lc", "cat > src/app.ts <<'EOF'\nhi\nEOF"], &cwd),
            vec![temp.path().join("src/app.ts")]
        );
        assert_eq!(
            changed_paths(&["bash", "-lc", "printf hi >> notes.txt"], &cwd),
            vec![temp.path().join("notes.txt")]
        );
    }

    #[test]
    fn detects_tee_writes() {
        let temp = tempfile::tempdir().expect("tempdir");
        let cwd = cwd(temp.path());

        assert_eq!(
            changed_paths(
                &["bash", "-lc", "printf hi | tee -a out.txt >/dev/null"],
                &cwd
            ),
            vec![temp.path().join("out.txt")]
        );
        assert_eq!(
            changed_paths(&["tee", "one.txt", "two.txt"], &cwd),
            vec![temp.path().join("one.txt"), temp.path().join("two.txt")]
        );
    }

    #[test]
    fn ignores_dev_null_redirections_with_shell_terminators() {
        let temp = tempfile::tempdir().expect("tempdir");
        let cwd = cwd(temp.path());

        assert_eq!(
            changed_paths(
                &[
                    "zsh",
                    "-lc",
                    "system_profiler SPHardwareDataType 2>/dev/null; uptime",
                ],
                &cwd
            ),
            Vec::<PathBuf>::new()
        );
    }
}

impl ShellCommandHandler {
    fn shell_runtime_backend(&self) -> ShellRuntimeBackend {
        match self.backend {
            ShellCommandBackend::Classic => ShellRuntimeBackend::ShellCommandClassic,
            ShellCommandBackend::ZshFork => ShellRuntimeBackend::ShellCommandZshFork,
        }
    }

    fn resolve_use_login_shell(
        login: Option<bool>,
        allow_login_shell: bool,
    ) -> Result<bool, FunctionCallError> {
        if !allow_login_shell && login == Some(true) {
            return Err(FunctionCallError::RespondToModel(
                "login shell is disabled by config; omit `login` or set it to false.".to_string(),
            ));
        }

        Ok(login.unwrap_or(allow_login_shell))
    }

    fn base_command(shell: &Shell, command: &str, use_login_shell: bool) -> Vec<String> {
        shell.derive_exec_args(command, use_login_shell)
    }

    fn to_exec_params(
        params: &ShellCommandToolCallParams,
        session: &crate::session::session::Session,
        turn_context: &TurnContext,
        thread_id: ThreadId,
        allow_login_shell: bool,
    ) -> Result<ExecParams, FunctionCallError> {
        let shell = session.user_shell();
        let use_login_shell = Self::resolve_use_login_shell(params.login, allow_login_shell)?;
        let command = Self::base_command(shell.as_ref(), &params.command, use_login_shell);

        Ok(ExecParams {
            command,
            cwd: turn_context.resolve_path(params.workdir.clone()),
            expiration: params.timeout_ms.into(),
            capture_policy: ExecCapturePolicy::ShellTool,
            env: create_env(&turn_context.shell_environment_policy, Some(thread_id)),
            network: turn_context.network.clone(),
            sandbox_permissions: params.sandbox_permissions.unwrap_or_default(),
            windows_sandbox_level: turn_context.windows_sandbox_level,
            windows_sandbox_private_desktop: turn_context
                .config
                .permissions
                .windows_sandbox_private_desktop,
            justification: params.justification.clone(),
            arg0: None,
        })
    }
}

impl From<ShellCommandBackendConfig> for ShellCommandHandler {
    fn from(config: ShellCommandBackendConfig) -> Self {
        let backend = match config {
            ShellCommandBackendConfig::Classic => ShellCommandBackend::Classic,
            ShellCommandBackendConfig::ZshFork => ShellCommandBackend::ZshFork,
        };
        Self { backend }
    }
}

impl ToolHandler for ShellHandler {
    type Output = FunctionToolOutput;

    fn kind(&self) -> ToolKind {
        ToolKind::Function
    }

    fn matches_kind(&self, payload: &ToolPayload) -> bool {
        matches!(
            payload,
            ToolPayload::Function { .. } | ToolPayload::LocalShell { .. }
        )
    }

    async fn is_mutating(&self, invocation: &ToolInvocation) -> bool {
        match &invocation.payload {
            ToolPayload::Function { arguments } => {
                serde_json::from_str::<ShellToolCallParams>(arguments)
                    .map(|params| !is_known_safe_command(&params.command))
                    .unwrap_or(true)
            }
            ToolPayload::LocalShell { params } => !is_known_safe_command(&params.command),
            _ => true, // unknown payloads => assume mutating
        }
    }

    fn pre_tool_use_payload(&self, invocation: &ToolInvocation) -> Option<PreToolUsePayload> {
        shell_payload_command(&invocation.payload).map(|command| PreToolUsePayload {
            tool_name: HookToolName::bash(),
            tool_input: serde_json::json!({ "command": command }),
        })
    }

    fn post_tool_use_payload(
        &self,
        invocation: &ToolInvocation,
        result: &Self::Output,
    ) -> Option<PostToolUsePayload> {
        let tool_response =
            result.post_tool_use_response(&invocation.call_id, &invocation.payload)?;
        let command = shell_payload_command(&invocation.payload)?;
        Some(PostToolUsePayload {
            tool_name: HookToolName::bash(),
            tool_use_id: invocation.call_id.clone(),
            tool_input: serde_json::json!({ "command": command }),
            tool_response,
        })
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

        match payload {
            ToolPayload::Function { arguments } => {
                let cwd = resolve_workdir_base_path(&arguments, &turn.cwd)?;
                let params: ShellToolCallParams = parse_arguments_with_base_path(&arguments, &cwd)?;
                let prefix_rule = params.prefix_rule.clone();
                let exec_params =
                    Self::to_exec_params(&params, turn.as_ref(), session.conversation_id);
                Self::run_exec_like(RunExecLikeArgs {
                    tool_name: tool_name.display(),
                    exec_params,
                    hook_command: lyra_shell_command::parse_command::shlex_join(&params.command),
                    additional_permissions: params.additional_permissions.clone(),
                    prefix_rule,
                    session,
                    turn,
                    tracker,
                    call_id,
                    freeform: false,
                    shell_runtime_backend: ShellRuntimeBackend::Generic,
                })
                .await
            }
            ToolPayload::LocalShell { params } => {
                let exec_params =
                    Self::to_exec_params(&params, turn.as_ref(), session.conversation_id);
                Self::run_exec_like(RunExecLikeArgs {
                    tool_name: tool_name.display(),
                    exec_params,
                    hook_command: lyra_shell_command::parse_command::shlex_join(&params.command),
                    additional_permissions: None,
                    prefix_rule: None,
                    session,
                    turn,
                    tracker,
                    call_id,
                    freeform: false,
                    shell_runtime_backend: ShellRuntimeBackend::Generic,
                })
                .await
            }
            _ => Err(FunctionCallError::RespondToModel(format!(
                "unsupported payload for shell handler: {}",
                tool_name.display()
            ))),
        }
    }
}

impl ToolHandler for ShellCommandHandler {
    type Output = FunctionToolOutput;

    fn kind(&self) -> ToolKind {
        ToolKind::Function
    }

    fn matches_kind(&self, payload: &ToolPayload) -> bool {
        matches!(payload, ToolPayload::Function { .. })
    }

    async fn is_mutating(&self, invocation: &ToolInvocation) -> bool {
        let ToolPayload::Function { arguments } = &invocation.payload else {
            return true;
        };

        serde_json::from_str::<ShellCommandToolCallParams>(arguments)
            .map(|params| {
                let use_login_shell = match Self::resolve_use_login_shell(
                    params.login,
                    invocation.turn.tools_config.allow_login_shell,
                ) {
                    Ok(use_login_shell) => use_login_shell,
                    Err(_) => return true,
                };
                let shell = invocation.session.user_shell();
                let command = Self::base_command(shell.as_ref(), &params.command, use_login_shell);
                !is_known_safe_command(&command)
            })
            .unwrap_or(true)
    }

    fn pre_tool_use_payload(&self, invocation: &ToolInvocation) -> Option<PreToolUsePayload> {
        shell_command_payload_command(&invocation.payload).map(|command| PreToolUsePayload {
            tool_name: HookToolName::bash(),
            tool_input: serde_json::json!({ "command": command }),
        })
    }

    fn post_tool_use_payload(
        &self,
        invocation: &ToolInvocation,
        result: &Self::Output,
    ) -> Option<PostToolUsePayload> {
        let tool_response =
            result.post_tool_use_response(&invocation.call_id, &invocation.payload)?;
        let command = shell_command_payload_command(&invocation.payload)?;
        Some(PostToolUsePayload {
            tool_name: HookToolName::bash(),
            tool_use_id: invocation.call_id.clone(),
            tool_input: serde_json::json!({ "command": command }),
            tool_response,
        })
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

        let ToolPayload::Function { arguments } = payload else {
            return Err(FunctionCallError::RespondToModel(format!(
                "unsupported payload for shell_command handler: {}",
                tool_name.display()
            )));
        };

        let cwd = resolve_workdir_base_path(&arguments, &turn.cwd)?;
        let params: ShellCommandToolCallParams = parse_arguments_with_base_path(&arguments, &cwd)?;
        let workdir = turn.resolve_path(params.workdir.clone());
        maybe_emit_implicit_skill_invocation(
            session.as_ref(),
            turn.as_ref(),
            &params.command,
            &workdir,
        )
        .await;
        let prefix_rule = params.prefix_rule.clone();
        let exec_params = Self::to_exec_params(
            &params,
            session.as_ref(),
            turn.as_ref(),
            session.conversation_id,
            turn.tools_config.allow_login_shell,
        )?;
        ShellHandler::run_exec_like(RunExecLikeArgs {
            tool_name: tool_name.display(),
            exec_params,
            hook_command: params.command,
            additional_permissions: params.additional_permissions.clone(),
            prefix_rule,
            session,
            turn,
            tracker,
            call_id,
            freeform: true,
            shell_runtime_backend: self.shell_runtime_backend(),
        })
        .await
    }
}

impl ShellHandler {
    async fn run_exec_like(args: RunExecLikeArgs) -> Result<FunctionToolOutput, FunctionCallError> {
        let RunExecLikeArgs {
            tool_name,
            exec_params,
            hook_command,
            additional_permissions,
            prefix_rule,
            session,
            turn,
            tracker,
            call_id,
            freeform,
            shell_runtime_backend,
        } = args;

        let mut exec_params = exec_params;
        let Some(environment) = turn.environment.as_ref() else {
            return Err(FunctionCallError::RespondToModel(
                "shell is unavailable in this session".to_string(),
            ));
        };
        let fs = environment.get_filesystem();

        let dependency_env = session.dependency_env().await;
        if !dependency_env.is_empty() {
            exec_params.env.extend(dependency_env.clone());
        }

        let mut explicit_env_overrides = turn.shell_environment_policy.r#set.clone();
        for key in dependency_env.keys() {
            if let Some(value) = exec_params.env.get(key) {
                explicit_env_overrides.insert(key.clone(), value.clone());
            }
        }

        let exec_permission_approvals_enabled =
            session.features().enabled(Feature::ExecPermissionApprovals);
        let requested_additional_permissions = additional_permissions.clone();
        let effective_additional_permissions = apply_granted_turn_permissions(
            session.as_ref(),
            exec_params.sandbox_permissions,
            additional_permissions,
        )
        .await;
        let additional_permissions_allowed = exec_permission_approvals_enabled
            || (session.features().enabled(Feature::RequestPermissionsTool)
                && effective_additional_permissions.permissions_preapproved);
        let normalized_additional_permissions = implicit_granted_permissions(
            exec_params.sandbox_permissions,
            requested_additional_permissions.as_ref(),
            &effective_additional_permissions,
        )
        .map_or_else(
            || {
                normalize_and_validate_additional_permissions(
                    additional_permissions_allowed,
                    turn.approval_policy.value(),
                    effective_additional_permissions.sandbox_permissions,
                    effective_additional_permissions.additional_permissions,
                    effective_additional_permissions.permissions_preapproved,
                    &exec_params.cwd,
                )
            },
            |permissions| Ok(Some(permissions)),
        )
        .map_err(FunctionCallError::RespondToModel)?;

        // Approval policy guard for explicit escalation in non-OnRequest modes.
        // Sticky turn permissions have already been approved, so they should
        // continue through the normal exec approval flow for the command.
        if effective_additional_permissions
            .sandbox_permissions
            .requests_sandbox_override()
            && !effective_additional_permissions.permissions_preapproved
            && !matches!(
                turn.approval_policy.value(),
                lyra_protocol::protocol::AskForApproval::OnRequest
            )
        {
            let approval_policy = turn.approval_policy.value();
            return Err(FunctionCallError::RespondToModel(format!(
                "approval policy is {approval_policy:?}; reject command — you should not ask for escalated permissions if the approval policy is {approval_policy:?}"
            )));
        }

        // Intercept apply_patch if present.
        if let Some(output) = intercept_apply_patch(
            &exec_params.command,
            &exec_params.cwd,
            fs.as_ref(),
            session.clone(),
            turn.clone(),
            Some(&tracker),
            &call_id,
            tool_name.as_str(),
        )
        .await?
        {
            return Ok(output);
        }

        let source = ExecCommandSource::Agent;
        let emitter = ToolEmitter::shell(
            exec_params.command.clone(),
            exec_params.cwd.clone(),
            source,
            freeform,
        );
        let shell_file_changes = detect_shell_file_changes(&exec_params.command, &exec_params.cwd);
        let shell_file_change_call_id = format!("{call_id}:files");
        let shell_file_change_emitter = (!shell_file_changes.is_empty())
            .then(|| ToolEmitter::apply_patch(shell_file_changes, /*auto_approved*/ true));
        if let Some(shell_file_change_emitter) = shell_file_change_emitter.as_ref() {
            let event_ctx = ToolEventCtx::new(
                session.as_ref(),
                turn.as_ref(),
                &shell_file_change_call_id,
                Some(&tracker),
            );
            shell_file_change_emitter.begin(event_ctx).await;
        }
        let event_ctx = ToolEventCtx::new(
            session.as_ref(),
            turn.as_ref(),
            &call_id,
            /*turn_diff_tracker*/ None,
        );
        emitter.begin(event_ctx).await;

        let exec_approval_requirement = session
            .services
            .exec_policy
            .create_exec_approval_requirement_for_command(ExecApprovalRequest {
                command: &exec_params.command,
                approval_policy: turn.approval_policy.value(),
                sandbox_policy: turn.sandbox_policy.get(),
                file_system_sandbox_policy: &turn.file_system_sandbox_policy,
                sandbox_permissions: if effective_additional_permissions.permissions_preapproved {
                    lyra_protocol::models::SandboxPermissions::UseDefault
                } else {
                    effective_additional_permissions.sandbox_permissions
                },
                prefix_rule,
            })
            .await;

        let req = ShellRequest {
            command: exec_params.command.clone(),
            hook_command,
            cwd: exec_params.cwd.clone(),
            timeout_ms: exec_params.expiration.timeout_ms(),
            env: exec_params.env.clone(),
            explicit_env_overrides,
            network: exec_params.network.clone(),
            sandbox_permissions: effective_additional_permissions.sandbox_permissions,
            additional_permissions: normalized_additional_permissions,
            #[cfg(unix)]
            additional_permissions_preapproved: effective_additional_permissions
                .permissions_preapproved,
            justification: exec_params.justification.clone(),
            exec_approval_requirement,
        };
        let mut orchestrator = ToolOrchestrator::new();
        let mut runtime = {
            use ShellRuntimeBackend::*;
            match shell_runtime_backend {
                Generic => ShellRuntime::new(),
                backend @ (ShellCommandClassic | ShellCommandZshFork) => {
                    ShellRuntime::for_shell_command(backend)
                }
            }
        };
        let tool_ctx = ToolCtx {
            session: session.clone(),
            turn: turn.clone(),
            call_id: call_id.clone(),
            tool_name,
        };
        let out = orchestrator
            .run(
                &mut runtime,
                &req,
                &tool_ctx,
                &turn,
                turn.approval_policy.value(),
            )
            .await
            .map(|result| result.output);
        let event_ctx = ToolEventCtx::new(
            session.as_ref(),
            turn.as_ref(),
            &call_id,
            /*turn_diff_tracker*/ None,
        );
        let post_tool_use_response = out
            .as_ref()
            .ok()
            .map(|output| crate::tools::format_exec_output_str(output, turn.truncation_policy))
            .map(JsonValue::String);
        let shell_file_change_finish_stage = shell_file_change_emitter
            .as_ref()
            .map(|_| shell_file_change_finish_stage(&out));
        let content_result = emitter.finish(event_ctx, out).await;
        if let (Some(shell_file_change_emitter), Some(stage)) = (
            shell_file_change_emitter.as_ref(),
            shell_file_change_finish_stage,
        ) {
            let event_ctx = ToolEventCtx::new(
                session.as_ref(),
                turn.as_ref(),
                &shell_file_change_call_id,
                Some(&tracker),
            );
            shell_file_change_emitter.emit(event_ctx, stage).await;
        }
        let content = content_result?;
        Ok(FunctionToolOutput {
            body: vec![
                lyra_protocol::models::FunctionCallOutputContentItem::InputText { text: content },
            ],
            success: Some(true),
            post_tool_use_response,
        })
    }
}
