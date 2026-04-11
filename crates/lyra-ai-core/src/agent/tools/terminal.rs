use std::collections::HashMap;
use std::path::Path;
use std::process::Command;
use std::sync::Mutex;
use std::time::Duration;

use lyra_sandbox::{
    detect_env_injection, evaluate_builtin, needs_interactive_pty, permissions::PermissionsStore,
    policy::CommandRiskLevel,
};
use lyra_terminal_core::{
    close_session as close_terminal_session, create_session as create_terminal_session,
    read_session as read_terminal_session, write_session as write_terminal_session,
    TerminalCloseRequest, TerminalCreateRequest, TerminalReadRequest, TerminalWriteRequest,
};
use once_cell::sync::Lazy;
use serde_json::{json, Value};

use super::{
    as_object, optional_bool, optional_string, required_string, AgentToolError,
    ToolExecutionContext,
};
use crate::agent::terminal_policy::{
    classify_terminal_command, rewrite_interactive_command_if_possible, TerminalCommandCategory,
    TerminalRewriteAdvice,
};

const MAX_TERMINAL_OUTPUT_BYTES: usize = 8 * 1024;
const DEFAULT_TERMINAL_TIMEOUT_MS: u64 = 30_000;
const MAX_TERMINAL_TIMEOUT_MS: u64 = 120_000;

/// Result of running a terminal command, including sandbox evaluation info.
pub struct TerminalExecResult {
    /// The command output (only present if execution succeeded).
    pub output: Option<Value>,
    /// Sandbox evaluation metadata.
    pub evaluation: TerminalEvaluation,
}

pub struct TerminalEvaluation {
    pub risk_level: CommandRiskLevel,
    pub needs_pty: bool,
    pub env_injections: Vec<String>,
    pub matched_rule: Option<String>,
    /// Whether the command was approved via permissions store.
    pub was_pre_approved: bool,
    pub interactive_category: TerminalCommandCategory,
    pub rewritable: bool,
    pub suggested_alternative: Option<String>,
    pub suggested_tool: Option<String>,
    pub mode: String,
    pub approval_pattern: Option<String>,
}

impl TerminalEvaluation {
    /// Convert to JSON metadata payload for approval-required errors.
    pub fn as_approval_metadata(
        &self,
        command: &str,
        cwd: Option<&str>,
        session_id: Option<&str>,
    ) -> Option<Value> {
        if self.risk_level.is_auto_approvable() && self.env_injections.is_empty() {
            return None;
        }
        Some(json!({
            "riskLevel": self.risk_level.label(),
            "needsPty": self.needs_pty,
            "envInjections": self.env_injections,
            "matchedRule": self.matched_rule,
            "wasPreApproved": self.was_pre_approved,
            "interactiveCategory": self.interactive_category.as_str(),
            "rewritable": self.rewritable,
            "suggestedAlternative": self.suggested_alternative,
            "suggestedTool": self.suggested_tool,
            "mode": self.mode,
            "approvalPattern": self.approval_pattern,
            "command": command,
            "cwd": cwd,
            "sessionId": session_id,
        }))
    }
}

#[derive(Clone, Debug)]
struct OneTimeApprovalGrant {
    command: Option<String>,
    session_id: Option<String>,
}

#[derive(Clone, Debug)]
struct ManagedTerminalSession {
    owner_session_id: Option<String>,
    owner_turn_id: Option<String>,
    source: String,
    mode: String,
    persist: bool,
}

static APPROVED_ONCE_GRANTS: Lazy<Mutex<HashMap<String, OneTimeApprovalGrant>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));
static MANAGED_TERMINAL_SESSIONS: Lazy<Mutex<HashMap<String, ManagedTerminalSession>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

fn register_managed_terminal_session(session_id: &str, meta: ManagedTerminalSession) {
    if let Ok(mut guard) = MANAGED_TERMINAL_SESSIONS.lock() {
        guard.insert(session_id.to_string(), meta);
    }
}

fn managed_terminal_session(session_id: &str) -> Option<ManagedTerminalSession> {
    MANAGED_TERMINAL_SESSIONS
        .lock()
        .ok()
        .and_then(|guard| guard.get(session_id).cloned())
}

fn remove_managed_terminal_session(session_id: &str) {
    if let Ok(mut guard) = MANAGED_TERMINAL_SESSIONS.lock() {
        guard.remove(session_id);
    }
}

pub fn cleanup_transient_ai_sessions(owner_session_id: &str, owner_turn_id: &str) {
    let session_ids = MANAGED_TERMINAL_SESSIONS
        .lock()
        .map(|guard| {
            guard
                .iter()
                .filter(|(_, session)| {
                    session.source == "ai"
                        && !session.persist
                        && session.owner_session_id.as_deref() == Some(owner_session_id)
                        && session.owner_turn_id.as_deref() == Some(owner_turn_id)
                })
                .map(|(session_id, _)| session_id.clone())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    for session_id in session_ids {
        let _ = close_terminal_session(TerminalCloseRequest {
            session_id: session_id.clone(),
        });
        remove_managed_terminal_session(&session_id);
    }
}

pub fn grant_approval_once(tool_call_id: &str, metadata: &Value) {
    let command = metadata
        .get("command")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_string());
    let session_id = metadata
        .get("sessionId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_string());
    if let Ok(mut guard) = APPROVED_ONCE_GRANTS.lock() {
        guard.insert(
            tool_call_id.to_string(),
            OneTimeApprovalGrant {
                command,
                session_id,
            },
        );
    }
}

fn take_one_time_approval(
    tool_call_id: Option<&str>,
    command: Option<&str>,
    session_id: Option<&str>,
) -> bool {
    let Some(tool_call_id) = tool_call_id else {
        return false;
    };
    let Ok(mut guard) = APPROVED_ONCE_GRANTS.lock() else {
        return false;
    };
    let Some(grant) = guard.get(tool_call_id).cloned() else {
        return false;
    };
    let command_matches = match (grant.command.as_deref(), command) {
        (Some(expected), Some(actual)) => expected == actual,
        (None, _) => true,
        _ => false,
    };
    let session_matches = match (grant.session_id.as_deref(), session_id) {
        (Some(expected), Some(actual)) => expected == actual,
        (None, _) => true,
        _ => false,
    };
    if command_matches && session_matches {
        guard.remove(tool_call_id);
        true
    } else {
        false
    }
}

fn build_terminal_evaluation(
    command: &str,
    project_root: Option<&str>,
    tool_call_id: Option<&str>,
    interactive_category: TerminalCommandCategory,
    mode: &str,
    suggested_alternative: Option<String>,
    suggested_tool: Option<String>,
) -> TerminalEvaluation {
    let perms = project_root.map(PermissionsStore::load).unwrap_or_default();
    let one_time_approved = take_one_time_approval(tool_call_id, Some(command), None);
    let pre_approved = one_time_approved || perms.is_allowed(command);
    let (risk_level, matched_desc) = evaluate_builtin(command);
    let env_injections = detect_env_injection(command);
    let needs_pty = interactive_category.requires_pty() || needs_interactive_pty(command);
    let rewritable = suggested_alternative.is_some() || suggested_tool.is_some();

    TerminalEvaluation {
        risk_level,
        needs_pty,
        env_injections,
        matched_rule: matched_desc.map(String::from),
        was_pre_approved: pre_approved,
        interactive_category,
        rewritable,
        suggested_alternative,
        suggested_tool,
        mode: mode.to_string(),
        approval_pattern: Some(command.to_string()),
    }
}

fn interactive_advisory_value(
    command: &str,
    category: &TerminalCommandCategory,
    rewrite: Option<&TerminalRewriteAdvice>,
) -> Value {
    json!({
        "kind": "interactive_advisory",
        "command": command,
        "interactiveCategory": category.as_str(),
        "policy": "structured_terminal_intent_required",
        "message": "This command needs a PTY session. Use terminal.session.start when you intentionally want an interactive terminal workflow.",
        "suggestedAlternative": rewrite.and_then(|value| value.replacement_command.clone()),
        "suggestedTool": rewrite.and_then(|value| value.suggested_tool.clone()).or_else(|| Some("terminal.session.start".to_string())),
        "rewritable": rewrite.is_some(),
        "reason": rewrite.map(|value| value.reason.clone()),
    })
}

fn is_plan_mode_mutating_command(command: &str) -> bool {
    let normalized = command.trim().to_ascii_lowercase();
    [
        "rm ",
        "mv ",
        "cp ",
        "mkdir ",
        "touch ",
        "chmod ",
        "chown ",
        "git add",
        "git commit",
        "git checkout",
        "git switch",
        "git reset",
        "git merge",
        "git rebase",
        "npm install",
        "pnpm install",
        "yarn install",
        "bun install",
        "cargo build",
        "cargo test",
        "cargo run",
        "go test",
        "go build",
        "python -m pip",
        "pip install",
        "brew ",
        "apt ",
        "sudo ",
        "make ",
        "cmake ",
        "docker ",
        "kubectl apply",
    ]
    .iter()
    .any(|token| normalized == *token || normalized.contains(token))
}

/// Evaluate a command through the sandbox and execute if safe.
///
/// Replaces the old TERMINAL_BLOCKLIST approach with a layered security model:
/// 1. Check permissions store (.lyra/permissions.json) for pre-approved rules
/// 2. Evaluate against builtin rules (command classification)
/// 3. Detect environment variable injection attempts
/// 4. Determine PTY routing needs
/// 5. Execute if approved, or return evaluation for approval flow
pub fn run_terminal_exec<F>(
    input: &Value,
    scope_root: Option<&str>,
    context: ToolExecutionContext<'_>,
    mut on_progress: F,
) -> TerminalExecResult
where
    F: FnMut(&str, &str),
{
    let obj = match as_object(input) {
        Ok(o) => o,
        Err(e) => {
            return TerminalExecResult {
                output: Some(error_value(&e.to_string())),
                evaluation: TerminalEvaluation {
                    risk_level: CommandRiskLevel::Critical,
                    needs_pty: false,
                    env_injections: vec![],
                    matched_rule: None,
                    was_pre_approved: false,
                    interactive_category: TerminalCommandCategory::OneShotNonInteractive,
                    rewritable: false,
                    suggested_alternative: None,
                    suggested_tool: None,
                    mode: "exec".to_string(),
                    approval_pattern: None,
                },
            };
        }
    };
    let command = match required_string(obj, "command") {
        Ok(c) => c,
        Err(e) => {
            return TerminalExecResult {
                output: Some(error_value(&e.to_string())),
                evaluation: TerminalEvaluation {
                    risk_level: CommandRiskLevel::Critical,
                    needs_pty: false,
                    env_injections: vec![],
                    matched_rule: None,
                    was_pre_approved: false,
                    interactive_category: TerminalCommandCategory::OneShotNonInteractive,
                    rewritable: false,
                    suggested_alternative: None,
                    suggested_tool: None,
                    mode: "exec".to_string(),
                    approval_pattern: None,
                },
            };
        }
    };
    let interactive_category = classify_terminal_command(&command);
    let rewrite = rewrite_interactive_command_if_possible(&command);
    let evaluation = build_terminal_evaluation(
        &command,
        context.project_root,
        context.tool_call_id,
        interactive_category.clone(),
        "exec",
        rewrite
            .as_ref()
            .and_then(|value| value.replacement_command.clone()),
        rewrite
            .as_ref()
            .and_then(|value| value.suggested_tool.clone())
            .or_else(|| {
                if interactive_category.requires_pty() {
                    Some("terminal.session.start".to_string())
                } else {
                    None
                }
            }),
    );

    if interactive_category.requires_pty() {
        return TerminalExecResult {
            output: Some(interactive_advisory_value(
                &command,
                &interactive_category,
                rewrite.as_ref(),
            )),
            evaluation,
        };
    }

    if context.plan_mode
        && (!evaluation.risk_level.is_auto_approvable()
            || !evaluation.env_injections.is_empty()
            || is_plan_mode_mutating_command(&command))
    {
        return TerminalExecResult {
            output: Some(json!({
                "kind": "denied",
                "exitCode": -1,
                "stdout": "",
                "stderr": "plan mode only allows bounded read-only terminal inspection commands",
                "timedOut": false,
                "riskLevel": evaluation.risk_level.label(),
                "requiresApproval": false,
                "planModeReadonly": true,
            })),
            evaluation,
        };
    }

    // Step 5: Decide whether to execute or request approval
    // Pre-approved commands bypass risk checks
    if !evaluation.was_pre_approved {
        // Environment injection of critical vars → deny
        if !evaluation.env_injections.is_empty()
            && evaluation
                .env_injections
                .iter()
                .any(|v| matches_critical_env(v))
        {
            return TerminalExecResult {
                output: Some(json!({
                    "kind": "denied",
                    "exitCode": -1,
                    "stdout": "",
                    "stderr": format!("command denied: dangerous environment variable injection detected ({})", evaluation.env_injections.join(", ")),
                    "timedOut": false,
                    "riskLevel": evaluation.risk_level.label(),
                    "requiresApproval": false,
                })),
                evaluation,
            };
        }

        // Critical risk → deny unless pre-approved
        if evaluation.risk_level.is_always_denied() {
            return TerminalExecResult {
                output: Some(json!({
                    "kind": "denied",
                    "exitCode": -1,
                    "stdout": "",
                    "stderr": format!(
                        "command denied: {}",
                        evaluation
                            .matched_rule
                            .as_deref()
                            .unwrap_or("critical risk operation")
                    ),
                    "timedOut": false,
                    "riskLevel": evaluation.risk_level.label(),
                    "requiresApproval": false,
                })),
                evaluation,
            };
        }

        // High/Medium risk → needs approval (unless pre-approved)
        // Return None output to signal that approval is required upstream
        if !evaluation.risk_level.is_auto_approvable() {
            return TerminalExecResult {
                output: None,
                evaluation,
            };
        }
    }

    // Command is approved — execute it
    let cwd = obj
        .get("cwd")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .or(scope_root);
    let timeout_ms = obj
        .get("timeout_ms")
        .and_then(Value::as_u64)
        .unwrap_or(DEFAULT_TERMINAL_TIMEOUT_MS)
        .min(MAX_TERMINAL_TIMEOUT_MS);

    let exec_result =
        execute_terminal_command(&command, cwd, timeout_ms, |stdout_chunk, stderr_chunk| {
            on_progress(stdout_chunk, stderr_chunk);
        });

    let stdout = truncate_output(&exec_result.stdout);
    let stderr = truncate_output(&exec_result.stderr);

    TerminalExecResult {
        output: Some(json!({
            "kind": if exec_result.timed_out { "timed_out" } else if exec_result.exit_code == 0 { "success" } else { "failed" },
            "exitCode": exec_result.exit_code,
            "stdout": stdout,
            "stderr": stderr,
            "timedOut": exec_result.timed_out,
            "riskLevel": evaluation.risk_level.label(),
        })),
        evaluation,
    }
}

pub(super) fn run_terminal_session_start(
    input: &Value,
    context: ToolExecutionContext<'_>,
) -> Result<Value, AgentToolError> {
    let obj = as_object(input)?;
    let mode = optional_string(obj, "mode").unwrap_or_else(|| "command".to_string());
    let persist = optional_bool(obj, "persist").unwrap_or(false);
    let cols = obj.get("cols").and_then(Value::as_u64).unwrap_or(120) as u16;
    let rows = obj.get("rows").and_then(Value::as_u64).unwrap_or(40) as u16;
    let cwd = optional_string(obj, "cwd").or_else(|| context.project_root.map(str::to_string));
    let title = optional_string(obj, "title");
    let shell = optional_string(obj, "shell");
    let command = optional_string(obj, "command");
    let command_category = command
        .as_deref()
        .map(classify_terminal_command)
        .unwrap_or(TerminalCommandCategory::InteractivePrompt);

    if mode == "command" {
        let command = command
            .clone()
            .ok_or_else(|| AgentToolError::exec_failed("command is required"))?;
        let evaluation = build_terminal_evaluation(
            &command,
            context.project_root,
            context.tool_call_id,
            command_category,
            "command",
            rewrite_interactive_command_if_possible(&command)
                .as_ref()
                .and_then(|value| value.replacement_command.clone()),
            Some("terminal.session.start".to_string()),
        );
        if !evaluation.was_pre_approved {
            if !evaluation.risk_level.is_auto_approvable() {
                return Err(AgentToolError::approval_required(
                    "interactive terminal command requires user approval",
                    evaluation
                        .as_approval_metadata(&command, cwd.as_deref(), None)
                        .unwrap_or_else(|| json!({})),
                ));
            }
            if !evaluation.env_injections.is_empty()
                && evaluation
                    .env_injections
                    .iter()
                    .any(|value| matches_critical_env(value))
            {
                return Ok(json!({
                    "kind": "denied",
                    "message": format!(
                        "command denied: dangerous environment variable injection detected ({})",
                        evaluation.env_injections.join(", ")
                    ),
                }));
            }
        }
    } else if mode == "shell" {
        let approved_once = take_one_time_approval(context.tool_call_id, None, None);
        let perms = context
            .project_root
            .map(PermissionsStore::load)
            .unwrap_or_default();
        if !(approved_once || perms.is_allowed("__lyra_shell_session__")) {
            return Err(AgentToolError::approval_required(
                "interactive shell session requires user approval",
                json!({
                    "riskLevel": "high",
                    "needsPty": true,
                    "interactiveCategory": TerminalCommandCategory::InteractivePrompt.as_str(),
                    "mode": "shell",
                    "approvalPattern": "__lyra_shell_session__",
                    "suggestedTool": "terminal.session.start",
                }),
            ));
        }
    } else {
        return Err(AgentToolError::exec_failed("mode must be command or shell"));
    }

    let snapshot = create_terminal_session(TerminalCreateRequest {
        session_id: None,
        title,
        cwd,
        shell,
        cols,
        rows,
        source: Some("ai".to_string()),
        mode: Some(mode.clone()),
        command: command.clone(),
        persist: Some(persist),
    })
    .map_err(|error| AgentToolError::exec_failed(error.to_string()))?;

    register_managed_terminal_session(
        &snapshot.session_id,
        ManagedTerminalSession {
            owner_session_id: context.agent_session_id.map(str::to_string),
            owner_turn_id: context.agent_turn_id.map(str::to_string),
            source: snapshot.source.clone(),
            mode: snapshot.mode.clone(),
            persist: snapshot.persist,
        },
    );

    Ok(json!({
        "kind": "started",
        "sessionId": snapshot.session_id,
        "title": snapshot.title,
        "cwd": snapshot.cwd,
        "shell": snapshot.shell,
        "source": snapshot.source,
        "mode": snapshot.mode,
        "command": snapshot.command,
        "persist": snapshot.persist,
        "running": snapshot.running,
        "exitCode": snapshot.exit_code,
    }))
}

pub(super) fn run_terminal_session_read(input: &Value) -> Result<Value, AgentToolError> {
    let obj = as_object(input)?;
    let session_id = required_string(obj, "sessionId")?;
    let cursor = optional_string(obj, "cursor");
    let max_bytes = obj
        .get("maxBytes")
        .and_then(Value::as_u64)
        .map(|value| value as u32);
    let wait_ms = obj
        .get("waitMs")
        .and_then(Value::as_u64)
        .map(|value| value as u32);
    let response = read_terminal_session(TerminalReadRequest {
        session_id: session_id.clone(),
        cursor,
        max_bytes,
        wait_ms,
    })
    .map_err(|error| AgentToolError::exec_failed(error.to_string()))?;
    Ok(json!({
        "kind": "read",
        "sessionId": response.session_id,
        "cursor": response.cursor,
        "output": truncate_output(response.output.as_bytes()),
        "running": response.running,
        "exitCode": response.exit_code,
        "truncated": response.truncated,
        "source": response.source,
        "mode": response.mode,
    }))
}

pub(super) fn run_terminal_session_write(
    input: &Value,
    context: ToolExecutionContext<'_>,
) -> Result<Value, AgentToolError> {
    let obj = as_object(input)?;
    let session_id = required_string(obj, "sessionId")?;
    let text = optional_string(obj, "text");
    let append_newline = optional_bool(obj, "appendNewline").unwrap_or(false);
    let keys = obj.get("keys").and_then(Value::as_array).map(|items| {
        items
            .iter()
            .filter_map(Value::as_str)
            .map(str::to_string)
            .collect::<Vec<_>>()
    });
    if text.is_none() && keys.as_ref().is_none_or(|items| items.is_empty()) {
        return Err(AgentToolError::exec_failed(
            "terminal.session.write requires text or keys",
        ));
    }

    let managed = managed_terminal_session(&session_id);
    let session_mode = managed
        .as_ref()
        .map(|meta| meta.mode.as_str())
        .unwrap_or("command");

    if session_mode == "shell" {
        let command_candidate = text
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty() && append_newline)
            .map(str::to_string);
        if let Some(command) = command_candidate.as_deref() {
            let evaluation = build_terminal_evaluation(
                command,
                context.project_root,
                context.tool_call_id,
                classify_terminal_command(command),
                "shell",
                rewrite_interactive_command_if_possible(command)
                    .as_ref()
                    .and_then(|value| value.replacement_command.clone()),
                None,
            );
            let one_time_session_grant =
                take_one_time_approval(context.tool_call_id, Some(command), Some(&session_id));
            let perms = context
                .project_root
                .map(PermissionsStore::load)
                .unwrap_or_default();
            if !(one_time_session_grant || evaluation.was_pre_approved || perms.is_allowed(command))
                && !evaluation.risk_level.is_auto_approvable()
            {
                return Err(AgentToolError::approval_required(
                    "shell command requires user approval",
                    evaluation
                        .as_approval_metadata(command, context.project_root, Some(&session_id))
                        .unwrap_or_else(|| json!({})),
                ));
            }
        }
    }

    write_terminal_session(TerminalWriteRequest {
        session_id: session_id.clone(),
        data: None,
        text,
        keys,
        append_newline: Some(append_newline),
        source: Some("ai".to_string()),
    })
    .map_err(|error| AgentToolError::exec_failed(error.to_string()))?;

    Ok(json!({
        "kind": "written",
        "sessionId": session_id,
        "mode": session_mode,
    }))
}

pub(super) fn run_terminal_session_close(input: &Value) -> Result<Value, AgentToolError> {
    let obj = as_object(input)?;
    let session_id = required_string(obj, "sessionId")?;
    close_terminal_session(TerminalCloseRequest {
        session_id: session_id.clone(),
    })
    .map_err(|error| AgentToolError::exec_failed(error.to_string()))?;
    remove_managed_terminal_session(&session_id);
    Ok(json!({
        "kind": "closed",
        "sessionId": session_id,
    }))
}

fn matches_critical_env(var: &str) -> bool {
    matches!(
        var,
        "LD_PRELOAD" | "LD_LIBRARY_PATH" | "LD_AUDIT" | "DYLD_INSERT_LIBRARIES" | "DOCKER_HOST"
    )
}

fn error_value(msg: &str) -> Value {
    json!({
        "kind": "error",
        "exitCode": -1,
        "stdout": "",
        "stderr": msg,
        "timedOut": false,
    })
}

struct ExecOutput {
    exit_code: i32,
    stdout: Vec<u8>,
    stderr: Vec<u8>,
    timed_out: bool,
}

fn execute_terminal_command<F>(
    command: &str,
    cwd: Option<&str>,
    timeout_ms: u64,
    on_progress: F,
) -> ExecOutput
where
    F: FnMut(&str, &str),
{
    use std::io::BufRead;
    use std::sync::mpsc;

    let mut cmd = Command::new("sh");
    cmd.arg("-c").arg(command);

    if let Some(cwd) = cwd {
        let cwd_path = Path::new(cwd);
        if cwd_path.exists() {
            cmd.current_dir(cwd_path);
        }
    }

    cmd.env("TERM", "dumb");

    let mut child = match cmd
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
    {
        Ok(c) => c,
        Err(e) => {
            return ExecOutput {
                exit_code: -1,
                stdout: Vec::new(),
                stderr: format!("failed to spawn command: {e}").into_bytes(),
                timed_out: false,
            };
        }
    };

    let stdout_pipe = child.stdout.take();
    let stderr_pipe = child.stderr.take();
    let child_id = child.id();

    // Channel for reader threads to send output chunks back to main thread
    // (text, is_stderr)
    let (tx, rx) = mpsc::channel::<(String, bool)>();

    // Reader thread: stdout
    let stdout_handle = stdout_pipe.map(|pipe| {
        let tx = tx.clone();
        std::thread::spawn(move || {
            let mut reader = std::io::BufReader::new(pipe);
            let mut buf = Vec::new();
            let mut collected = Vec::new();
            loop {
                buf.clear();
                match reader.read_until(b'\n', &mut buf) {
                    Ok(0) => break,
                    Ok(_) => {
                        if let Ok(text) = std::str::from_utf8(&buf) {
                            let _ = tx.send((text.to_string(), false));
                        }
                        collected.extend_from_slice(&buf);
                    }
                    Err(_) => break,
                }
            }
            collected
        })
    });

    // Reader thread: stderr
    let stderr_handle = stderr_pipe.map(|pipe| {
        let tx = tx.clone();
        std::thread::spawn(move || {
            let mut reader = std::io::BufReader::new(pipe);
            let mut buf = Vec::new();
            let mut collected = Vec::new();
            loop {
                buf.clear();
                match reader.read_until(b'\n', &mut buf) {
                    Ok(0) => break,
                    Ok(_) => {
                        if let Ok(text) = std::str::from_utf8(&buf) {
                            let _ = tx.send((text.to_string(), true));
                        }
                        collected.extend_from_slice(&buf);
                    }
                    Err(_) => break,
                }
            }
            collected
        })
    });

    // Drop the original sender so rx will return RecvError when both readers finish
    drop(tx);

    // Main thread: poll child process and drain output channel
    let mut on_progress = on_progress;
    let deadline = std::time::Instant::now() + Duration::from_millis(timeout_ms);
    loop {
        // Drain all available messages from the channel (non-blocking)
        loop {
            match rx.try_recv() {
                Ok((text, is_stderr)) => {
                    if is_stderr {
                        on_progress("", &text);
                    } else {
                        on_progress(&text, "");
                    }
                }
                Err(mpsc::TryRecvError::Disconnected) => break,
                Err(mpsc::TryRecvError::Empty) => break,
            }
        }

        if std::time::Instant::now() > deadline {
            #[cfg(unix)]
            {
                let _ = Command::new("kill")
                    .arg("-9")
                    .arg(child_id.to_string())
                    .output();
            }
            // Wait for reader threads to finish after killing
            let full_stdout = stdout_handle
                .map(|h| h.join().unwrap_or_default())
                .unwrap_or_default();
            let _full_stderr = stderr_handle
                .map(|h| h.join().unwrap_or_default())
                .unwrap_or_default();
            // Drain remaining messages
            while let Ok((text, is_stderr)) = rx.try_recv() {
                if is_stderr {
                    on_progress("", &text);
                } else {
                    on_progress(&text, "");
                }
            }
            return ExecOutput {
                exit_code: -1,
                stdout: full_stdout,
                stderr: format!("command timed out after {timeout_ms}ms").into_bytes(),
                timed_out: true,
            };
        }

        let stdout_done = stdout_handle.as_ref().map_or(true, |h| h.is_finished());
        let stderr_done = stderr_handle.as_ref().map_or(true, |h| h.is_finished());

        if stdout_done && stderr_done {
            match child.try_wait() {
                Ok(Some(status)) => {
                    let full_stdout = stdout_handle
                        .map(|h| h.join().unwrap_or_default())
                        .unwrap_or_default();
                    let full_stderr = stderr_handle
                        .map(|h| h.join().unwrap_or_default())
                        .unwrap_or_default();
                    // Drain any remaining messages
                    while let Ok((text, is_stderr)) = rx.try_recv() {
                        if is_stderr {
                            on_progress("", &text);
                        } else {
                            on_progress(&text, "");
                        }
                    }
                    return ExecOutput {
                        exit_code: status.code().unwrap_or(-1),
                        stdout: full_stdout,
                        stderr: full_stderr,
                        timed_out: false,
                    };
                }
                Ok(None) => {
                    std::thread::sleep(Duration::from_millis(50));
                }
                Err(_) => {
                    let full_stdout = stdout_handle
                        .map(|h| h.join().unwrap_or_default())
                        .unwrap_or_default();
                    let full_stderr = stderr_handle
                        .map(|h| h.join().unwrap_or_default())
                        .unwrap_or_default();
                    // Drain remaining messages
                    while let Ok((text, is_stderr)) = rx.try_recv() {
                        if is_stderr {
                            on_progress("", &text);
                        } else {
                            on_progress(&text, "");
                        }
                    }
                    return ExecOutput {
                        exit_code: -1,
                        stdout: full_stdout,
                        stderr: full_stderr,
                        timed_out: false,
                    };
                }
            }
        } else {
            std::thread::sleep(Duration::from_millis(50));
        }
    }
}

fn truncate_output(bytes: &[u8]) -> String {
    let s = String::from_utf8_lossy(bytes);
    if s.len() > MAX_TERMINAL_OUTPUT_BYTES {
        let truncated = &s[..MAX_TERMINAL_OUTPUT_BYTES];
        format!("{truncated}\n... [truncated to {MAX_TERMINAL_OUTPUT_BYTES} bytes]")
    } else {
        s.into_owned()
    }
}
