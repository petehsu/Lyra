use crate::patch_apply::PermissionMode;
use crate::storage::{json_string, new_id, sha256_hex, trim_to_string, AiStore};
use crate::tool_runtime::catalog::{RunCommandArgs, TOOL_SHELL_RUN_COMMAND};
use crate::tool_runtime::operation::{
    tool_error, ToolFsOp, ToolOperationEnvelope, ToolResultEnvelope, TOOL_APPROVAL_REQUIRED,
    TOOL_COMMAND_REJECTED, TOOL_COMMAND_TIMEOUT, TOOL_EXECUTION_FAILED, TOOL_SCHEMA_VERSION,
};
use crate::tool_runtime::security::{redact_secrets, WorkspaceSecurity};
use crate::tool_runtime::ToolExecutionContext;
use anyhow::{anyhow, Context, Result};
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashMap};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

const DEFAULT_TIMEOUT_MS: u64 = 120_000;
const MAX_TIMEOUT_MS: u64 = 300_000;
const DEFAULT_OUTPUT_LIMIT_BYTES: usize = 64 * 1024;
const MAX_OUTPUT_LIMIT_BYTES: usize = 256 * 1024;

#[derive(Clone, Debug)]
pub struct PreparedRunCommand {
    pub args: RunCommandArgs,
    pub mode: String,
    pub argv: Vec<String>,
    pub command: String,
    pub command_hash: String,
    pub cwd: PathBuf,
    pub cwd_display: String,
    pub timeout_ms: u64,
    pub output_limit_bytes: usize,
    pub safe_direct: bool,
    pub purpose: Option<String>,
}

pub fn run_command_tool_result(
    store: &AiStore,
    session_id: &str,
    turn_id: &str,
    context: &ToolExecutionContext,
    operation: &ToolOperationEnvelope,
    permission_mode: PermissionMode,
) -> ToolResultEnvelope {
    match run_command_tool_result_inner(
        store,
        session_id,
        turn_id,
        context,
        operation,
        permission_mode,
    ) {
        Ok(result) => result,
        Err(error) => ToolResultEnvelope::failed(
            operation,
            error
                .downcast_ref::<crate::tool_runtime::operation::ToolRuntimeError>()
                .map(|error| error.code)
                .unwrap_or(TOOL_EXECUTION_FAILED),
            error.to_string(),
        ),
    }
}

fn run_command_tool_result_inner(
    store: &AiStore,
    session_id: &str,
    turn_id: &str,
    context: &ToolExecutionContext,
    operation: &ToolOperationEnvelope,
    permission_mode: PermissionMode,
) -> Result<ToolResultEnvelope> {
    let args = crate::tool_runtime::catalog::parse_args::<RunCommandArgs>(&operation.args)?;
    let prepared = prepare_run_command(context, args)?;
    if let Some(reason) = hard_rejection_reason(&prepared) {
        return Err(tool_error(TOOL_COMMAND_REJECTED, reason));
    }
    ensure_command_not_denied(store, session_id, &prepared)?;
    if permission_mode == PermissionMode::Sandbox && prepared.safe_direct == false {
        let ticket = match store.find_pending_approval_for_tool_command(
            session_id,
            TOOL_SHELL_RUN_COMMAND,
            &prepared.command_hash,
        )? {
            Some(ticket) => ticket,
            None => create_run_command_approval_ticket(
                store,
                session_id,
                turn_id,
                &operation.op_id,
                &prepared,
                "pending_user",
                "user",
            )?,
        };
        let mut result = ToolResultEnvelope::failed(
            operation,
            TOOL_APPROVAL_REQUIRED,
            "User approval is required before running this command",
        );
        result.metadata = Some(json!({
            "kind": "run_command_approval_required",
            "approvalTicketId": ticket.approval_ticket_id,
            "toolPath": TOOL_SHELL_RUN_COMMAND,
            "commandHash": prepared.command_hash,
            "command": prepared.command,
            "cwd": prepared.cwd_display,
        }));
        return Ok(result);
    }
    let approval_update =
        if permission_mode == PermissionMode::FullAccess && prepared.safe_direct == false {
            Some(("auto_approved_by_full_access", "full_access", None))
        } else {
            None
        };
    execute_prepared_run_command(
        store,
        session_id,
        turn_id,
        &operation.op_id,
        operation,
        prepared,
        approval_update,
    )
}

pub fn run_command_operation_from_approval(
    ticket: &crate::storage::ApprovalTicketDetailRecord,
) -> Result<ToolOperationEnvelope> {
    let op_id = ticket
        .requested_action
        .get("toolOperationId")
        .and_then(Value::as_str)
        .and_then(trim_to_string)
        .unwrap_or_else(|| new_id("op"));
    Ok(ToolOperationEnvelope {
        schema_version: TOOL_SCHEMA_VERSION.to_string(),
        kind: "tool_operation".to_string(),
        op_id,
        op: ToolFsOp::Run,
        path: TOOL_SHELL_RUN_COMMAND.to_string(),
        args: ticket
            .requested_action
            .get("args")
            .cloned()
            .ok_or_else(|| anyhow!("run_command approval is missing args"))?,
    })
}

pub fn approve_run_command_ticket(
    store: &AiStore,
    session_id: &str,
    context: &ToolExecutionContext,
    ticket: &crate::storage::ApprovalTicketDetailRecord,
) -> Result<(ToolOperationEnvelope, ToolResultEnvelope)> {
    let operation = run_command_operation_from_approval(ticket)?;
    let args = crate::tool_runtime::catalog::parse_args::<RunCommandArgs>(&operation.args)?;
    let prepared = prepare_run_command(context, args)?;
    if let Some(reason) = hard_rejection_reason(&prepared) {
        return Err(tool_error(TOOL_COMMAND_REJECTED, reason));
    }
    let result = execute_prepared_run_command(
        store,
        session_id,
        &ticket.runtime_turn_id,
        &operation.op_id,
        &operation,
        prepared,
        Some((
            "approved",
            "user_approved",
            Some(ticket.approval_ticket_id.clone()),
        )),
    )?;
    Ok((operation, result))
}

pub fn command_hash_from_ticket(
    ticket: &crate::storage::ApprovalTicketDetailRecord,
) -> Option<String> {
    ticket
        .requested_action
        .get("commandHash")
        .and_then(Value::as_str)
        .and_then(trim_to_string)
}

fn execute_prepared_run_command(
    store: &AiStore,
    session_id: &str,
    turn_id: &str,
    op_id: &str,
    operation: &ToolOperationEnvelope,
    prepared: PreparedRunCommand,
    approval_update: Option<(&str, &str, Option<String>)>,
) -> Result<ToolResultEnvelope> {
    if let Some((status, approval_mode, ticket_id)) = approval_update {
        if let Some(ticket_id) = ticket_id {
            store.update_approval_ticket_status(session_id, &ticket_id, status, approval_mode)?;
        } else if store
            .find_pending_approval_for_tool_command(
                session_id,
                TOOL_SHELL_RUN_COMMAND,
                &prepared.command_hash,
            )?
            .is_none()
        {
            create_run_command_approval_ticket(
                store,
                session_id,
                turn_id,
                op_id,
                &prepared,
                status,
                approval_mode,
            )?;
        }
    }
    let started = Instant::now();
    let secret_env = materialize_secret_env(store, session_id, turn_id, op_id, &prepared)?;
    let output = run_child_process(&prepared, &secret_env)?;
    let duration_ms = i64::try_from(started.elapsed().as_millis()).unwrap_or(i64::MAX);
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    let raw = format!("{stdout}{stderr}");
    let (redacted_stdout, stdout_truncated) = redact_and_cap(&stdout, prepared.output_limit_bytes);
    let remaining = prepared
        .output_limit_bytes
        .saturating_sub(redacted_stdout.len());
    let (redacted_stderr, stderr_truncated) = redact_and_cap(&stderr, remaining);
    let truncated = stdout_truncated || stderr_truncated || raw.len() > prepared.output_limit_bytes;
    let status = if output.timed_out {
        "failed"
    } else if output.exit_code == Some(0) {
        "passed"
    } else {
        "failed"
    };
    let content = json_string(&json!({
        "status": status,
        "command": prepared.command,
        "commandHash": prepared.command_hash,
        "mode": prepared.mode,
        "cwd": prepared.cwd_display,
        "exitCode": output.exit_code,
        "timedOut": output.timed_out,
        "durationMs": duration_ms,
        "stdout": redacted_stdout,
        "stderr": redacted_stderr,
        "truncated": truncated,
    }))?;
    let mut result = if status == "passed" {
        ToolResultEnvelope::completed(operation, "Command completed", content, truncated)
    } else {
        let code = if output.timed_out {
            TOOL_COMMAND_TIMEOUT
        } else {
            TOOL_EXECUTION_FAILED
        };
        let mut result = ToolResultEnvelope::failed(
            operation,
            code,
            if output.timed_out {
                "Command timed out"
            } else {
                "Command exited unsuccessfully"
            },
        );
        result.content = content;
        result.truncated = truncated;
        result
    };
    result.metadata = Some(json!({
        "kind": "command_log",
        "toolPath": TOOL_SHELL_RUN_COMMAND,
        "status": status,
        "command": prepared.command,
        "commandHash": prepared.command_hash,
        "mode": prepared.mode,
        "cwd": prepared.cwd_display,
        "exitCode": output.exit_code,
        "timedOut": output.timed_out,
        "durationMs": duration_ms,
        "outputBytes": raw.len(),
        "purpose": prepared.purpose,
    }));
    Ok(result)
}

fn create_run_command_approval_ticket(
    store: &AiStore,
    session_id: &str,
    turn_id: &str,
    op_id: &str,
    prepared: &PreparedRunCommand,
    status: &str,
    approval_mode: &str,
) -> Result<crate::storage::ApprovalTicketRecord> {
    store.append_approval_ticket(
        session_id,
        turn_id,
        status,
        approval_mode,
        "Run shell command",
        json!({
            "level": "high",
            "kinds": ["process"],
            "summary": format!("Run `{}` in the workspace.", prepared.command),
        }),
        json!({
            "workspace": "bound",
            "cwd": prepared.cwd_display,
            "command": prepared.command,
        }),
        json!({
            "toolPath": TOOL_SHELL_RUN_COMMAND,
            "toolOperationId": op_id,
            "commandHash": prepared.command_hash,
            "command": prepared.command,
            "cwd": prepared.cwd_display,
            "args": prepared.args,
        }),
    )
}

fn ensure_command_not_denied(
    store: &AiStore,
    session_id: &str,
    prepared: &PreparedRunCommand,
) -> Result<()> {
    if store
        .find_denied_approval_for_tool_command(
            session_id,
            TOOL_SHELL_RUN_COMMAND,
            &prepared.command_hash,
        )?
        .is_some()
    {
        return Err(tool_error(
            crate::tool_runtime::operation::TOOL_APPROVAL_DENIED,
            "user denied this command",
        ));
    }
    Ok(())
}

pub fn prepare_run_command(
    context: &ToolExecutionContext,
    args: RunCommandArgs,
) -> Result<PreparedRunCommand> {
    let security = WorkspaceSecurity::new(context.workspace_root.as_deref())?;
    let cwd = security.resolve_existing_path(args.cwd.as_deref())?;
    if cwd.is_dir() == false {
        return Err(tool_error(
            crate::tool_runtime::operation::TOOL_PATH_NOT_DIRECTORY,
            "cwd must be a workspace directory",
        ));
    }
    let mode = args
        .mode
        .as_deref()
        .and_then(trim_to_string)
        .unwrap_or_else(|| "argv".to_string());
    let argv = match mode.as_str() {
        "argv" => {
            let argv = args
                .argv
                .clone()
                .ok_or_else(|| anyhow!("argv is required"))?
                .into_iter()
                .map(|part| part.trim().to_string())
                .filter(|part| part.is_empty() == false)
                .collect::<Vec<_>>();
            if argv.is_empty() {
                return Err(anyhow!("argv is required"));
            }
            argv
        }
        "shell" => {
            let command = args
                .command
                .as_deref()
                .and_then(trim_to_string)
                .ok_or_else(|| anyhow!("command is required"))?;
            shell_argv(&command)
        }
        _ => return Err(anyhow!("mode must be argv or shell")),
    };
    let command = if mode == "shell" {
        args.command
            .as_deref()
            .and_then(trim_to_string)
            .ok_or_else(|| anyhow!("command is required"))?
    } else {
        argv.join(" ")
    };
    let timeout_ms = args
        .timeout_ms
        .unwrap_or(DEFAULT_TIMEOUT_MS)
        .clamp(1_000, MAX_TIMEOUT_MS);
    let output_limit_bytes = args
        .output_limit_bytes
        .unwrap_or(DEFAULT_OUTPUT_LIMIT_BYTES)
        .clamp(1_024, MAX_OUTPUT_LIMIT_BYTES);
    let cwd_display = security.relative_display(&cwd);
    let command_hash = sha256_hex(
        json!({
            "mode": mode,
            "argv": argv,
            "command": command,
            "cwd": cwd_display,
            "secretEnv": secret_env_fingerprint(args.secret_env.as_ref()),
        })
        .to_string()
        .as_bytes(),
    );
    let safe_direct = is_safe_direct_command(&mode, &argv, &command);
    let purpose = args
        .purpose
        .clone()
        .and_then(|value| trim_to_string(&value));
    Ok(PreparedRunCommand {
        args,
        mode,
        argv,
        command,
        command_hash,
        cwd,
        cwd_display,
        timeout_ms,
        output_limit_bytes,
        safe_direct,
        purpose,
    })
}

struct ProcessOutput {
    stdout: Vec<u8>,
    stderr: Vec<u8>,
    exit_code: Option<i64>,
    timed_out: bool,
}

fn run_child_process(
    prepared: &PreparedRunCommand,
    secret_env: &HashMap<String, String>,
) -> Result<ProcessOutput> {
    let mut command = if prepared.mode == "shell" {
        let mut command = Command::new(shell_program());
        command.args(shell_args(&prepared.command));
        command
    } else {
        let mut command = Command::new(&prepared.argv[0]);
        command.args(&prepared.argv[1..]);
        command
    };
    command
        .current_dir(&prepared.cwd)
        .env_clear()
        .envs(safe_env(prepared.args.env.as_ref(), secret_env))
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = command.spawn().with_context(|| {
        format!(
            "failed to start command `{}` in {}",
            prepared.command, prepared.cwd_display
        )
    })?;
    let deadline = Instant::now() + Duration::from_millis(prepared.timeout_ms);
    loop {
        if child.try_wait()?.is_some() {
            let output = child.wait_with_output()?;
            return Ok(ProcessOutput {
                stdout: output.stdout,
                stderr: output.stderr,
                exit_code: output.status.code().map(i64::from),
                timed_out: false,
            });
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            let output = child.wait_with_output()?;
            return Ok(ProcessOutput {
                stdout: output.stdout,
                stderr: output.stderr,
                exit_code: output.status.code().map(i64::from),
                timed_out: true,
            });
        }
        thread::sleep(Duration::from_millis(25));
    }
}

fn materialize_secret_env(
    store: &AiStore,
    session_id: &str,
    turn_id: &str,
    op_id: &str,
    prepared: &PreparedRunCommand,
) -> Result<HashMap<String, String>> {
    let mut env = HashMap::new();
    let Some(secret_env) = prepared.args.secret_env.as_ref() else {
        return Ok(env);
    };
    for (name, handle_id) in secret_env {
        if is_valid_env_name(name) == false {
            return Err(tool_error(
                TOOL_COMMAND_REJECTED,
                format!("invalid secretEnv name: {name}"),
            ));
        }
        let materialized = crate::secret_broker::materialize_handle_for_process(
            store,
            session_id,
            turn_id,
            handle_id,
            op_id,
            TOOL_SHELL_RUN_COMMAND,
            name,
        )?;
        env.insert(name.clone(), materialized.value);
    }
    Ok(env)
}

fn safe_env(
    extra: Option<&HashMap<String, String>>,
    secret_env: &HashMap<String, String>,
) -> HashMap<String, String> {
    let mut env = HashMap::new();
    for key in [
        "PATH",
        "HOME",
        "USER",
        "TMPDIR",
        "TEMP",
        "TMP",
        "CARGO_HOME",
        "RUSTUP_HOME",
        "NPM_CONFIG_CACHE",
    ] {
        if let Ok(value) = std::env::var(key) {
            env.insert(key.to_string(), value);
        }
    }
    if let Some(extra) = extra {
        for (key, value) in extra {
            if is_secret_key(key) == false
                && crate::security_gate::redaction::detect_and_redact(value)
                    .findings
                    .is_empty()
                && key
                    .chars()
                    .all(|ch| ch.is_ascii_alphanumeric() || ch == '_')
            {
                env.insert(key.clone(), value.clone());
            }
        }
    }
    for (key, value) in secret_env {
        if is_valid_env_name(key) {
            env.insert(key.clone(), value.clone());
        }
    }
    env
}

fn is_secret_key(key: &str) -> bool {
    let lower = key.to_ascii_lowercase();
    lower.contains("token")
        || lower.contains("secret")
        || lower.contains("password")
        || lower.contains("cookie")
        || lower.contains("key")
}

fn redact_and_cap(value: &str, limit: usize) -> (String, bool) {
    let redacted = redact_secrets(value);
    if redacted.len() <= limit {
        return (redacted, false);
    }
    let capped = redacted.chars().take(limit).collect::<String>();
    (capped, true)
}

fn is_safe_direct_command(mode: &str, argv: &[String], command: &str) -> bool {
    if mode == "shell" && contains_shell_metachar(command) {
        return false;
    }
    let normalized = if mode == "shell" {
        command.to_ascii_lowercase()
    } else {
        argv.iter()
            .map(|part| part.as_str())
            .collect::<Vec<_>>()
            .join(" ")
            .to_ascii_lowercase()
    };
    SAFE_PREFIXES
        .iter()
        .any(|prefix| normalized.starts_with(prefix))
}

fn hard_rejection_reason(prepared: &PreparedRunCommand) -> Option<String> {
    let normalized = prepared.command.to_ascii_lowercase();
    if let Some(reason) = raw_env_secret_rejection(prepared.args.env.as_ref()) {
        return Some(reason);
    }
    if LONG_RUNNING_MARKERS
        .iter()
        .any(|marker| normalized.contains(marker))
    {
        return Some("Long-running commands are not supported in run_command v1".to_string());
    }
    if DESTRUCTIVE_MARKERS
        .iter()
        .any(|marker| normalized.contains(marker))
    {
        return Some("Command is rejected by the destructive/system side-effect guard".to_string());
    }
    if normalized.contains("curl ") && normalized.contains('|')
        || normalized.contains("wget ") && normalized.contains('|')
    {
        return Some("Piping remote scripts is rejected".to_string());
    }
    None
}

fn raw_env_secret_rejection(env: Option<&HashMap<String, String>>) -> Option<String> {
    let env = env?;
    for (key, value) in env {
        if is_secret_key(key) {
            return Some(format!(
                "Raw env `{key}` looks secret-bearing; create a SecretHandle and pass it via secretEnv"
            ));
        }
        if crate::security_gate::redaction::detect_and_redact(value)
            .findings
            .is_empty()
            == false
        {
            return Some(format!(
                "Raw env `{key}` contains secret-like content; create a SecretHandle and pass it via secretEnv"
            ));
        }
    }
    None
}

fn is_valid_env_name(name: &str) -> bool {
    let mut chars = name.chars();
    matches!(chars.next(), Some(ch) if ch.is_ascii_alphabetic() || ch == '_')
        && chars.all(|ch| ch.is_ascii_alphanumeric() || ch == '_')
}

fn secret_env_fingerprint(secret_env: Option<&HashMap<String, String>>) -> Value {
    let Some(secret_env) = secret_env else {
        return Value::Null;
    };
    let mut values = BTreeMap::new();
    for (name, handle_id) in secret_env {
        values.insert(name.clone(), sha256_hex(handle_id.as_bytes()));
    }
    json!(values)
}

fn contains_shell_metachar(command: &str) -> bool {
    command
        .chars()
        .any(|ch| matches!(ch, '|' | '&' | ';' | '<' | '>' | '`' | '$' | '\n' | '\r'))
}

fn shell_argv(command: &str) -> Vec<String> {
    let mut argv = vec![shell_program().to_string()];
    argv.extend(shell_args(command));
    argv
}

#[cfg(windows)]
fn shell_program() -> &'static str {
    "cmd"
}

#[cfg(not(windows))]
fn shell_program() -> &'static str {
    "sh"
}

#[cfg(windows)]
fn shell_args(command: &str) -> Vec<String> {
    vec!["/C".to_string(), command.to_string()]
}

#[cfg(not(windows))]
fn shell_args(command: &str) -> Vec<String> {
    vec!["-c".to_string(), command.to_string()]
}

const SAFE_PREFIXES: &[&str] = &[
    "cargo check",
    "cargo test",
    "npm test",
    "npm run test",
    "npm run lint",
    "npm run check",
    "npm --prefix apps/desktop run test",
    "pnpm test",
    "pnpm lint",
    "pnpm check",
    "pnpm run test",
    "pnpm run lint",
    "pnpm run check",
    "yarn test",
    "yarn lint",
    "yarn check",
    "git status",
    "git diff",
];

const LONG_RUNNING_MARKERS: &[&str] = &[
    " watch",
    " --watch",
    " dev",
    " serve",
    " start",
    " tail -f",
    "webpack-dev-server",
    "vite --host",
];

const DESTRUCTIVE_MARKERS: &[&str] = &[
    "sudo",
    " rm ",
    "rm -",
    "rmdir ",
    "chmod ",
    "chown ",
    "mkfs",
    "diskutil",
    "mount ",
    "umount ",
    " dd ",
    "kill ",
    "pkill ",
    "launchctl",
    "systemctl",
    "npm publish",
    "pnpm publish",
    "cargo publish",
    "git push",
    "git reset --hard",
    "git clean",
    "kubectl",
    "terraform apply",
    "deploy",
];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn safe_direct_allows_test_commands_and_rejects_shell_meta() {
        assert!(is_safe_direct_command(
            "argv",
            &["cargo".to_string(), "test".to_string()],
            "cargo test"
        ));
        assert!(is_safe_direct_command(
            "shell",
            &["sh".to_string(), "-c".to_string(), "cargo test".to_string()],
            "cargo test"
        ));
        assert!(!is_safe_direct_command(
            "shell",
            &[
                "sh".to_string(),
                "-c".to_string(),
                "cargo test && rm -rf target".to_string()
            ],
            "cargo test && rm -rf target"
        ));
    }

    #[test]
    fn hard_rejection_blocks_destructive_commands() {
        let prepared = PreparedRunCommand {
            args: RunCommandArgs {
                mode: Some("argv".to_string()),
                argv: Some(vec![
                    "rm".to_string(),
                    "-rf".to_string(),
                    "target".to_string(),
                ]),
                command: None,
                cwd: None,
                env: None,
                secret_env: None,
                capsule_id: None,
                timeout_ms: None,
                output_limit_bytes: None,
                purpose: None,
            },
            mode: "argv".to_string(),
            argv: vec!["rm".to_string(), "-rf".to_string(), "target".to_string()],
            command: "rm -rf target".to_string(),
            command_hash: "hash".to_string(),
            cwd: PathBuf::new(),
            cwd_display: ".".to_string(),
            timeout_ms: DEFAULT_TIMEOUT_MS,
            output_limit_bytes: DEFAULT_OUTPUT_LIMIT_BYTES,
            safe_direct: false,
            purpose: None,
        };
        assert!(hard_rejection_reason(&prepared).is_some());
    }

    #[test]
    fn hard_rejection_blocks_raw_secret_env() {
        let prepared = PreparedRunCommand {
            args: RunCommandArgs {
                mode: Some("argv".to_string()),
                argv: Some(vec!["echo".to_string(), "ok".to_string()]),
                command: None,
                cwd: None,
                env: Some(HashMap::from([(
                    "OPENAI_API_KEY".to_string(),
                    "sk-test-secret".to_string(),
                )])),
                secret_env: None,
                capsule_id: None,
                timeout_ms: None,
                output_limit_bytes: None,
                purpose: None,
            },
            mode: "argv".to_string(),
            argv: vec!["echo".to_string(), "ok".to_string()],
            command: "echo ok".to_string(),
            command_hash: "hash".to_string(),
            cwd: PathBuf::new(),
            cwd_display: ".".to_string(),
            timeout_ms: DEFAULT_TIMEOUT_MS,
            output_limit_bytes: DEFAULT_OUTPUT_LIMIT_BYTES,
            safe_direct: true,
            purpose: None,
        };

        assert!(hard_rejection_reason(&prepared)
            .expect("secret env rejection")
            .contains("secretEnv"));
    }

    #[test]
    fn prepare_run_command_rejects_outside_cwd() {
        let temp = tempfile::tempdir().expect("tempdir");
        let workspace = temp.path().join("workspace");
        let outside = temp.path().join("outside");
        std::fs::create_dir_all(&workspace).expect("workspace");
        std::fs::create_dir_all(&outside).expect("outside");
        let context = ToolExecutionContext {
            workspace_root: Some(workspace.to_string_lossy().to_string()),
        };

        let result = prepare_run_command(
            &context,
            RunCommandArgs {
                mode: Some("argv".to_string()),
                argv: Some(vec!["echo".to_string(), "ok".to_string()]),
                command: None,
                cwd: Some(outside.to_string_lossy().to_string()),
                env: None,
                secret_env: None,
                capsule_id: None,
                timeout_ms: None,
                output_limit_bytes: None,
                purpose: None,
            },
        );

        assert!(result.is_err());
    }
}
