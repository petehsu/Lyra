use super::*;

use std::sync::atomic::{AtomicUsize, Ordering};

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::process::Command;
use tokio_util::sync::CancellationToken;
use tree_sitter::{Node, Parser};

/// Per-pipe drain timeout when collecting stdout/stderr after the child exits.
/// A pipe held open by a background descendant (`sleep 5 &`) blocks EOF and
/// trips this timeout — the partial output collected so far is returned and
/// `outputCollectionTimedOut` is set, matching the previous mpsc/thread
/// behaviour. No process is killed.
const OUTPUT_DRAIN_TIMEOUT: Duration = Duration::from_millis(500);

#[derive(Clone, Debug, Default)]
struct ShellCommandAst {
    executable: Option<String>,
    arguments: Vec<String>,
    executable_end: usize,
    backgrounded: bool,
}

#[derive(Clone, Debug, Default)]
struct ShellAstAnalysis {
    commands: Vec<ShellCommandAst>,
    has_write_redirect: bool,
    has_parse_error: bool,
    has_dynamic_interpreter: bool,
}

pub(crate) async fn execute_shell_tool_adapter(
    session_id: &str,
    turn_id: &str,
    cancellation: &CancellationToken,
    tool_call_id: &str,
    tool_name: &str,
    display_name: &str,
    action: &str,
    arguments: Value,
    started_at: &str,
) -> Value {
    execute_native_tool_adapter(
        session_id,
        turn_id,
        cancellation,
        tool_call_id,
        tool_name,
        display_name,
        action,
        arguments,
        started_at,
    )
    .await
}

pub(crate) async fn tool_shell_run_async(
    session_id: &str,
    turn_id: &str,
    tool_call_id: &str,
    input: &Value,
    cancellation: &CancellationToken,
) -> NativeToolResult {
    let command = required_value_string(input, "command")?;
    let wants_background =
        value_bool(input, "runInBackground", false) || value_bool(input, "background", false);
    if command.trim().is_empty() {
        return Err(NativeToolFailure::new(
            "bad_command",
            "command is empty",
            "Retry with a non-empty command.",
        ));
    }
    if command.contains('\0') {
        return Err(NativeToolFailure::new(
            "bad_command",
            "command contains a NUL byte",
            "Retry with a valid shell command string.",
        ));
    }
    let analysis = analyze_shell_command(&command);
    let permission_granted = input
        .get("permissionGranted")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let command_kind = classify_shell_analysis(&analysis);
    if shell_analysis_requires_permission(&analysis) && !permission_granted {
        return Err(NativeToolFailure::new(
            "permission_required",
            "command is classified as high risk and was not executed without permission",
            "Request explicit user permission or choose a non-destructive validation command.",
        )
        .with_detail(json!({ "command": command, "commandKind": command_kind })));
    }
    // ponytail: plan gate follows AST mutation class only. python3 -c and
    // other dynamic interpreters stay permission-gated, otherwise inspection
    // scripts are blocked during planning and executing_todo. Upgrade: parse
    // interpreter payloads if writes start bypassing the plan gate.
    if shell_requires_plan_mutation_gate(&analysis) {
        validate_plan_mutation_for_session(session_id, "shell mutation")?;
    }
    if shell_analysis_invokes_apply_patch(&analysis) {
        let patch = extract_apply_patch_payload_from_shell_command(&command).ok_or_else(|| {
            NativeToolFailure::new(
                "apply_patch_shell_transport_invalid",
                "shell command appears to invoke apply_patch, but Lyra could not extract a Codex patch payload",
                "Use edit_file or write_file instead of apply_patch.",
            )
        })?;
        return tool_apply_patch(
            session_id,
            turn_id,
            tool_call_id,
            &json!({ "patch": patch, "source": "shell_apply_patch_intercept" }),
        );
    }
    let cwd = resolve_shell_cwd(
        session_id,
        value_string(input, "cwd").or_else(|| value_string(input, "workingDir")),
    )?;
    if wants_background || shell_command_is_long_lived(&analysis) {
        return start_long_lived_in_background_terminal(
            session_id,
            turn_id,
            tool_call_id,
            &command,
            &cwd,
            command_kind,
        )
        .await;
    }
    let timeout_ms = predicted_exec_timeout(input)?;
    let max_output = value_usize(
        input,
        "maxOutputBytes",
        DEFAULT_COMMAND_OUTPUT_BYTES,
        1_000_000,
    );
    // Windows: if the elevated helper is running, route ALL commands through
    // the named pipe so they execute with admin privileges.  If the helper is
    // down or unreachable, fall through to normal (non-elevated) execution.
    // The helper is synchronous (named-pipe I/O) — run it on a blocking thread
    // to avoid stalling the async runtime.
    #[cfg(target_os = "windows")]
    {
        let session_id_win = session_id.to_string();
        let turn_id_win = turn_id.to_string();
        let tool_call_id_win = tool_call_id.to_string();
        let command_win = command.clone();
        let cwd_display = cwd.display.clone();
        let cwd_absolute = cwd.absolute.clone();
        let timeout_ms_win = timeout_ms.as_millis() as u64;
        let max_output_win = max_output;
        let input_win = input.clone();
        let command_kind_win = command_kind.to_string();
        if let Some(pipe_name) = elevated_pipe_name() {
            let pipe_name_win = pipe_name.clone();
            let helper_result = tokio::task::spawn_blocking(move || {
                try_execute_via_elevated_helper(
                    &session_id_win,
                    &turn_id_win,
                    &tool_call_id_win,
                    &command_win,
                    &ShellCwd {
                        absolute: cwd_absolute,
                        display: cwd_display,
                    },
                    timeout_ms_win,
                    max_output_win,
                    &input_win,
                    &command_kind_win,
                    &pipe_name_win,
                )
            })
            .await;
            if let Ok(Some(result)) = helper_result {
                return result;
            }
            // spawn_blocking panicked or helper returned None → fall through.
        }
    }
    // ponytail: sudo auto-resolve — 如果命令含 sudo 且进程内存中有提权密码，
    // 将 `sudo ` 替换为 `sudo -S `（从 stdin 读密码），spawn 后通过 stdin 注入。
    // 启发式检测 `sudo ` 子串，可能匹配字符串内的 sudo，但 elevation_secret 仅在
    // full_auto 模式下存在，此时用户已授权所有命令执行。
    let elevation = elevation_secret();
    let sudo_insert_at = analysis
        .commands
        .iter()
        .find(|command| command.executable.as_deref() == Some("sudo"))
        .map(|command| command.executable_end);
    let needs_sudo_stdin = elevation.is_some() && sudo_insert_at.is_some();
    let command = if needs_sudo_stdin {
        let insert_at = sudo_insert_at.expect("checked above");
        format!("{} -S{}", &command[..insert_at], &command[insert_at..])
    } else {
        command
    };
    let mut command_builder = shell_command_builder(&command);
    configure_shell_child(&mut command_builder);
    command_builder
        .current_dir(&cwd.absolute)
        .stdin(if needs_sudo_stdin {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        // `false` = do NOT kill the child if the Child handle is dropped.
        // Background descendants (`sleep 5 &`, nohup, detached) legitimately
        // outlive the tool call — matches opencode `detached: true` / zed pty.
        .kill_on_drop(false);
    apply_allowed_env(input, &mut command_builder);
    let mut child = command_builder.spawn().map_err(|error| {
        NativeToolFailure::new(
            "spawn_failed",
            format!("failed to start command: {error}"),
            "Retry with an installed executable and valid arguments.",
        )
    })?;
    // sudo -S 从 stdin 读密码 — spawn 后立即写入，drop stdin 触发 EOF
    if let Some(mut stdin) = needs_sudo_stdin.then(|| child.stdin.take()).flatten() {
        let _ = stdin
            .write_all(format!("{}\n", elevation.unwrap()).as_bytes())
            .await;
    }
    let child_process_id = child
        .id()
        .expect("tokio::process::Child::id returns Some until wait() completes");
    lyra_process_lifecycle_core::spawn_parent_death_watcher(child_process_id, true);
    // Read pipes while waiting so a loud command cannot fill the buffer and
    // deadlock, and so a prediction miss includes the output so far.
    let stdout_buf = Arc::new(Mutex::new(Vec::new()));
    let stderr_buf = Arc::new(Mutex::new(Vec::new()));
    let stdout_total = Arc::new(AtomicUsize::new(0));
    let stderr_total = Arc::new(AtomicUsize::new(0));
    let stdout_task = spawn_pipe_pump(
        child.stdout.take(),
        Arc::clone(&stdout_buf),
        Arc::clone(&stdout_total),
        max_output,
    );
    let stderr_task = spawn_pipe_pump(
        child.stderr.take(),
        Arc::clone(&stderr_buf),
        Arc::clone(&stderr_total),
        max_output,
    );
    // ponytail: timeoutMs is the model's predicted wait, not a kill timer.
    // When it elapses the process stays alive, cognition returns, and a
    // later exit notifies the same session. Ceiling: no predicted bound is
    // accepted — that would freeze the model again.
    let wait_started = Instant::now();
    let mut timed_out = false;
    let mut cancelled = false;
    let status: Option<std::process::ExitStatus> = {
        tokio::select! {
            biased;
            _ = cancellation.cancelled() => {
                cancelled = true;
                None
            }
            result = child.wait() => {
                Some(result.map_err(|error| NativeToolFailure::new(
                    "command_failed",
                    format!("failed to wait for command: {error}"),
                    "Retry the command or use a terminal session.",
                ))?)
            }
            _ = tokio::time::sleep(timeout_ms) => {
                timed_out = true;
                None
            }
        }
    };
    let elapsed_ms = wait_started.elapsed().as_millis() as u64;
    let predicted_timeout_ms = timeout_ms.as_millis() as u64;
    let still_running = timed_out || cancelled;
    let output_collection_timed_out;
    let stdout_output;
    let stderr_output;
    if still_running {
        stdout_output = snapshot_live_pipe(&stdout_buf, &stdout_total);
        stderr_output = snapshot_live_pipe(&stderr_buf, &stderr_total);
        output_collection_timed_out = false;
        follow_exec_until_exit(
            child,
            stdout_task,
            stderr_task,
            stdout_buf,
            stderr_buf,
            stdout_total,
            stderr_total,
            session_id.to_string(),
            command.clone(),
            child_process_id,
            timed_out && !cancelled,
        );
    } else {
        // 成功退出后不杀进程组。后台子进程（nohup &、detached）合法存活。
        // A descendant holding the pipe blocks EOF — stop waiting for pumps
        // after OUTPUT_DRAIN_TIMEOUT and return partial output.
        output_collection_timed_out =
            join_pipe_pumps(stdout_task, stderr_task, OUTPUT_DRAIN_TIMEOUT).await;
        stdout_output = snapshot_live_pipe(&stdout_buf, &stdout_total);
        stderr_output = snapshot_live_pipe(&stderr_buf, &stderr_total);
    }
    let exit_code = status.as_ref().and_then(|s| s.code());
    let content = format!(
        "command: {}\ndescription: {}\ncwd: {}\nkind: {}\npid: {}\npredictedTimeoutMs: {}\nelapsedMs: {}\nstillRunning: {}\nexitCode: {:?}\ntimedOut: {}\npredictionMissed: {}\nprocessGroupTerminated: {}\noutputCollectionTimedOut: {}\n\nstdout:\n{}\n\nstderr:\n{}",
        command,
        value_string(input, "description").unwrap_or_default(),
        cwd.display,
        command_kind,
        child_process_id,
        predicted_timeout_ms,
        elapsed_ms,
        still_running,
        exit_code,
        timed_out,
        timed_out,
        false,
        output_collection_timed_out,
        stdout_output.text,
        stderr_output.text
    );
    let stdout_ref = (!stdout_output.text.is_empty() || stdout_output.truncated).then(|| {
        write_tool_artifact_with_kind(
            session_id,
            turn_id,
            &format!("{tool_call_id}-stdout"),
            ToolArtifactKind::Stdout,
            &stdout_output.text,
        )
    });
    let stderr_ref = (!stderr_output.text.is_empty() || stderr_output.truncated).then(|| {
        write_tool_artifact_with_kind(
            session_id,
            turn_id,
            &format!("{tool_call_id}-stderr"),
            ToolArtifactKind::Stderr,
            &stderr_output.text,
        )
    });
    let success = status.as_ref().is_some_and(|s| s.success())
        && !timed_out
        && !cancelled
        && !output_collection_timed_out;
    Ok(NativeToolSuccess {
        content,
        raw: json!({
            "command": command,
            "cwd": cwd.display,
            "exitCode": exit_code,
            "success": success,
            "pid": child_process_id,
            "predictedTimeoutMs": predicted_timeout_ms,
            "elapsedMs": elapsed_ms,
            "stillRunning": still_running,
            "timedOut": timed_out,
            "predictionMissed": timed_out,
            "commandKind": command_kind,
            "description": value_string(input, "description"),
            "stdout": stdout_output.text,
            "stderr": stderr_output.text,
            "stdoutTruncated": stdout_output.truncated,
            "stderrTruncated": stderr_output.truncated,
            "stdoutBytes": stdout_output.total_bytes,
            "stderrBytes": stderr_output.total_bytes,
            "stdoutCollectionTimedOut": stdout_output.timed_out,
            "stderrCollectionTimedOut": stderr_output.timed_out,
            "outputCollectionTimedOut": output_collection_timed_out,
            "processGroupTerminated": false,
            "processGroupSignal": null,
            "stdoutRef": stdout_ref.flatten(),
            "stderrRef": stderr_ref.flatten(),
            "activityKind": "shell",
            "rendererHint": "shell",
        }),
        recommended_next_action: if timed_out {
            Some(prediction_miss_next_action(child_process_id))
        } else if cancelled {
            Some(
                "The turn was cancelled. The command is still running and was not killed."
                    .to_string(),
            )
        } else if output_collection_timed_out {
            Some(
                "Use write_stdin for commands that keep background processes or open output streams. Omit sessionId to create a private background terminal."
                    .to_string(),
            )
        } else if success {
            None
        } else if shell_analysis_has_command(&analysis, "git", Some("clone")) {
            Some(
                "git clone failed — likely network or auth issue. Don't retry the same clone. \
                 Check connectivity, verify the repo URL and credentials, or use a different access method."
                    .to_string(),
            )
        } else {
            Some("Inspect stderr/stdout and retry after fixing the command failure.".to_string())
        },
    })
}

/// Test-only synchronous bridge: drives `tool_shell_run_async` on the engine
/// runtime via `block_on`. The 15 test call sites stay unchanged.
#[cfg(test)]
pub(crate) fn tool_shell_run(
    session_id: &str,
    turn_id: &str,
    tool_call_id: &str,
    input: &Value,
) -> NativeToolResult {
    crate::native_backend::turn_engine::block_on(tool_shell_run_async(
        session_id,
        turn_id,
        tool_call_id,
        input,
        &CancellationToken::new(),
    ))
}

struct ShellCwd {
    absolute: PathBuf,
    display: String,
}

fn resolve_shell_cwd(
    session_id: &str,
    raw_cwd: Option<String>,
) -> Result<ShellCwd, NativeToolFailure> {
    let candidate = match raw_cwd
        .as_deref()
        .map(str::trim)
        .filter(|cwd| !cwd.is_empty())
    {
        Some(cwd) => {
            if cwd.contains('\0') {
                return Err(NativeToolFailure::new(
                    "bad_cwd",
                    "cwd contains a NUL byte",
                    "Retry with a valid directory path.",
                ));
            }
            let path = PathBuf::from(cwd);
            if path.is_absolute() {
                path
            } else {
                shell_base_dir(session_id)?.join(path)
            }
        }
        None => shell_base_dir(session_id)?,
    };
    let absolute = candidate.canonicalize().map_err(|error| {
        NativeToolFailure::new(
            "bad_cwd",
            format!("failed to resolve cwd: {error}"),
            "Retry with an existing directory.",
        )
    })?;
    if !absolute.is_dir() {
        return Err(NativeToolFailure::new(
            "bad_cwd",
            "cwd must be an existing directory",
            "Retry with an existing directory.",
        )
        .with_detail(json!({ "cwd": absolute.display().to_string() })));
    }
    Ok(ShellCwd {
        display: absolute.display().to_string(),
        absolute,
    })
}

fn shell_base_dir(session_id: &str) -> Result<PathBuf, NativeToolFailure> {
    let session_root = state()
        .lock()
        .map_err(|_| {
            NativeToolFailure::new(
                "runtime_state_unavailable",
                "agent runtime state lock failed",
                "Retry the tool call.",
            )
        })?
        .sessions
        .get(session_id)
        .and_then(|session| {
            let project_bound = session
                .snapshot
                .get("projectBound")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            let working_dir = session
                .snapshot
                .get("workingDir")
                .and_then(Value::as_str)
                .unwrap_or("")
                .trim();
            (project_bound && !working_dir.is_empty()).then(|| PathBuf::from(working_dir))
        });
    let base = match session_root {
        Some(root) => root,
        None => dirs::home_dir().ok_or_else(|| {
            NativeToolFailure::new(
                "cwd_unavailable",
                "failed to resolve user home directory",
                "Pass an explicit cwd and retry.",
            )
        })?,
    };
    base.canonicalize().map_err(|error| {
        NativeToolFailure::new(
            "bad_cwd",
            format!("failed to resolve default cwd: {error}"),
            "Bind the session to an existing project root or pass an existing cwd.",
        )
    })
}

fn shell_command_builder(command: &str) -> Command {
    #[cfg(windows)]
    {
        let shell = detect_windows_shell();
        let path = detected_shell_path();
        build_shell_command(shell, &path, command, None)
    }
    #[cfg(not(windows))]
    {
        let mut builder = Command::new("sh");
        builder.args(["-lc", command]);
        builder
    }
}

fn configure_shell_child(command: &mut Command) {
    lyra_process_lifecycle_core::configure_daemon_child_command(command.as_std_mut());
}

/// Output collected from a child pipe, bounded by `limit` bytes of buffered
/// text and a drain timeout. A background descendant holding the pipe open
/// keeps EOF pending → `timed_out = true` and the partial buffer is returned.
#[derive(Clone, Debug, Default)]
pub(crate) struct LimitedOutput {
    pub(crate) text: String,
    pub(crate) truncated: bool,
    pub(crate) total_bytes: usize,
    pub(crate) timed_out: bool,
}

fn predicted_exec_timeout(input: &Value) -> Result<Duration, NativeToolFailure> {
    input
        .get("timeoutMs")
        .or_else(|| input.get("timeout_ms"))
        .and_then(Value::as_u64)
        .filter(|value| *value > 0)
        .map(Duration::from_millis)
        .ok_or_else(|| {
            NativeToolFailure::new(
                "prediction_required",
                "exec_command needs timeout_ms: your prediction of how long this command should take.",
                "Pass timeout_ms based on the work (a gist clone is seconds; a large clone is minutes). If it is still running then, you get the output so far, the process keeps running, and you decide whether to wait, stop it, or change approach. Lyra notifies you when it later exits.",
            )
        })
}

fn prediction_miss_next_action(pid: u32) -> String {
    format!(
        "Your predicted wait elapsed; the command is still running (pid={pid}) and was not killed. You will be notified when it exits. Decide whether to wait, stop it, or change approach. Do not poll on a timer."
    )
}

fn spawn_pipe_pump<R>(
    reader: Option<R>,
    buf: Arc<Mutex<Vec<u8>>>,
    total: Arc<AtomicUsize>,
    limit: usize,
) -> tokio::task::JoinHandle<()>
where
    R: tokio::io::AsyncRead + Unpin + Send + 'static,
{
    tokio::spawn(async move {
        let Some(mut reader) = reader else {
            return;
        };
        let mut chunk = [0_u8; 8192];
        loop {
            match reader.read(&mut chunk).await {
                Ok(0) | Err(_) => break,
                Ok(count) => {
                    total.fetch_add(count, Ordering::Relaxed);
                    if let Ok(mut buffer) = buf.lock()
                        && buffer.len() < limit
                    {
                        let remaining = limit - buffer.len();
                        buffer.extend_from_slice(&chunk[..count.min(remaining)]);
                    }
                }
            }
        }
    })
}

fn snapshot_live_pipe(buf: &Mutex<Vec<u8>>, total: &AtomicUsize) -> LimitedOutput {
    let bytes = buf.lock().map(|guard| guard.clone()).unwrap_or_default();
    let total_bytes = total.load(Ordering::Relaxed);
    LimitedOutput {
        text: String::from_utf8_lossy(&bytes).to_string(),
        truncated: total_bytes > bytes.len(),
        total_bytes,
        timed_out: false,
    }
}

async fn join_pipe_pumps(
    stdout_task: tokio::task::JoinHandle<()>,
    stderr_task: tokio::task::JoinHandle<()>,
    limit: Duration,
) -> bool {
    tokio::time::timeout(limit, async {
        let _ = stdout_task.await;
        let _ = stderr_task.await;
    })
    .await
    .is_err()
}

#[allow(clippy::too_many_arguments)]
fn follow_exec_until_exit(
    mut child: tokio::process::Child,
    stdout_task: tokio::task::JoinHandle<()>,
    stderr_task: tokio::task::JoinHandle<()>,
    stdout_buf: Arc<Mutex<Vec<u8>>>,
    stderr_buf: Arc<Mutex<Vec<u8>>>,
    stdout_total: Arc<AtomicUsize>,
    stderr_total: Arc<AtomicUsize>,
    session_id: String,
    command: String,
    pid: u32,
    notify: bool,
) {
    crate::native_backend::turn_engine::runtime().spawn(async move {
        let status = child.wait().await.ok();
        let _ = join_pipe_pumps(stdout_task, stderr_task, OUTPUT_DRAIN_TIMEOUT).await;
        if !notify {
            return;
        }
        let stdout = snapshot_live_pipe(&stdout_buf, &stdout_total);
        let stderr = snapshot_live_pipe(&stderr_buf, &stderr_total);
        crate::native_backend::poke::notify_exec_command_exit(json!({
            "sessionId": session_id,
            "reason": "exec_command_exited",
            "command": {
                "commandText": command,
                "pid": pid,
                "status": if status.as_ref().is_some_and(std::process::ExitStatus::success) {
                    "completed"
                } else {
                    "exited"
                },
                "exitCode": status.as_ref().and_then(std::process::ExitStatus::code),
                "stdout": stdout.text,
                "stderr": stderr.text,
            }
        }));
    });
}

fn node_has_dynamic_syntax(node: Node<'_>) -> bool {
    if matches!(
        node.kind(),
        "variable_expansion"
            | "command_substitution"
            | "process_substitution"
            | "arithmetic_expansion"
            | "simple_expansion"
    ) {
        return true;
    }
    let mut cursor = node.walk();
    node.children(&mut cursor).any(node_has_dynamic_syntax)
}

fn static_shell_token(node: Node<'_>, source: &[u8]) -> Option<String> {
    if node_has_dynamic_syntax(node) {
        return None;
    }
    let text = node.utf8_text(source).ok()?;
    let tokens = shlex::split(text)?;
    (tokens.len() == 1).then(|| tokens[0].to_ascii_lowercase())
}

fn executable_name(value: &str) -> String {
    Path::new(value)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or(value)
        .to_ascii_lowercase()
}

fn file_redirect_writes(node: Node<'_>, source: &[u8]) -> bool {
    let Ok(text) = node.utf8_text(source) else {
        return true;
    };
    let trimmed = text.trim_start();
    let operator = trimmed.trim_start_matches(|character: char| character.is_ascii_digit());
    if let Some(destination) = operator.strip_prefix(">&") {
        let destination = destination.trim_start();
        return !(destination.starts_with('-')
            || destination
                .chars()
                .next()
                .is_some_and(|character| character.is_ascii_digit()));
    }
    let destination = operator
        .trim_start_matches(['&', '<', '>'])
        .trim()
        .split_whitespace()
        .next()
        .unwrap_or_default()
        .trim_matches(['\'', '"']);
    if redirect_destination_is_sink(destination) {
        return false;
    }
    operator.starts_with('>') || operator.starts_with("&>") || operator.starts_with("<>")
}

fn redirect_destination_is_sink(destination: &str) -> bool {
    matches!(
        destination,
        "/dev/null" | "/dev/stdout" | "/dev/stderr" | "nul" | "NUL"
    ) || destination
        .strip_prefix("/dev/fd/")
        .or_else(|| destination.strip_prefix("/proc/self/fd/"))
        .is_some_and(|fd| !fd.is_empty() && fd.chars().all(|character| character.is_ascii_digit()))
}

/// True when this command's statement is terminated with `&`.
/// Does not treat redirect tokens (`2>&1`, `&>`) as job control.
fn command_is_backgrounded(mut node: Node<'_>, source: &[u8]) -> bool {
    while let Some(parent) = node.parent() {
        let mut cursor = parent.walk();
        let children: Vec<Node<'_>> = parent.children(&mut cursor).collect();
        if let Some(index) = children.iter().position(|child| child.id() == node.id()) {
            if children
                .get(index + 1)
                .is_some_and(|sibling| sibling.utf8_text(source).ok() == Some("&"))
            {
                return true;
            }
        }
        node = parent;
    }
    false
}

fn collect_shell_ast(node: Node<'_>, source: &[u8], analysis: &mut ShellAstAnalysis) {
    if node.kind() == "command" {
        let executable_node = node.child_by_field_name("name");
        let executable = executable_node
            .and_then(|name| static_shell_token(name, source))
            .map(|name| executable_name(&name));
        let executable_end = executable_node
            .map(|name| name.end_byte())
            .unwrap_or_default();
        let mut arguments = Vec::new();
        let mut cursor = node.walk();
        for argument in node.children_by_field_name("argument", &mut cursor) {
            if let Some(argument) = static_shell_token(argument, source) {
                arguments.push(argument);
            }
        }
        analysis.commands.push(ShellCommandAst {
            executable,
            arguments,
            executable_end,
            backgrounded: command_is_backgrounded(node, source),
        });
    } else if node.kind() == "file_redirect" && file_redirect_writes(node, source) {
        analysis.has_write_redirect = true;
    }
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        collect_shell_ast(child, source, analysis);
    }
}

fn effective_shell_command(command: &ShellCommandAst) -> Option<(String, &[String])> {
    let executable = command.executable.as_deref()?;
    if executable == "sudo" {
        let index = command
            .arguments
            .iter()
            .position(|argument| !argument.starts_with('-'))?;
        return Some((
            executable_name(&command.arguments[index]),
            &command.arguments[index + 1..],
        ));
    }
    if executable == "env" {
        let index = command.arguments.iter().position(|argument| {
            !argument.starts_with('-')
                && !argument.split_once('=').is_some_and(|(name, _)| {
                    !name.is_empty()
                        && name
                            .chars()
                            .all(|character| character.is_ascii_alphanumeric() || character == '_')
                })
        })?;
        return Some((
            executable_name(&command.arguments[index]),
            &command.arguments[index + 1..],
        ));
    }
    Some((executable.to_string(), &command.arguments))
}

fn analyze_shell_command(command: &str) -> ShellAstAnalysis {
    let mut parser = Parser::new();
    if parser
        .set_language(&tree_sitter_bash::LANGUAGE.into())
        .is_err()
    {
        return ShellAstAnalysis {
            has_parse_error: true,
            ..ShellAstAnalysis::default()
        };
    }
    let Some(tree) = parser.parse(command, None) else {
        return ShellAstAnalysis {
            has_parse_error: true,
            ..ShellAstAnalysis::default()
        };
    };
    let mut analysis = ShellAstAnalysis {
        has_parse_error: tree.root_node().has_error(),
        ..ShellAstAnalysis::default()
    };
    collect_shell_ast(tree.root_node(), command.as_bytes(), &mut analysis);
    analysis.has_dynamic_interpreter = analysis.commands.iter().any(|command| {
        let Some((executable, arguments)) = effective_shell_command(command) else {
            return true;
        };
        match executable.as_str() {
            "bash" | "sh" | "zsh" => arguments.iter().any(|argument| argument == "-c"),
            "node" | "ruby" | "perl" => arguments.iter().any(|argument| argument == "-e"),
            "python" | "python3" => arguments.iter().any(|argument| argument == "-c"),
            "pwsh" | "powershell" => arguments
                .iter()
                .any(|argument| matches!(argument.as_str(), "-c" | "-command")),
            _ => false,
        }
    });
    analysis
}

fn shell_analysis_has_command(
    analysis: &ShellAstAnalysis,
    executable: &str,
    subcommand: Option<&str>,
) -> bool {
    analysis.commands.iter().any(|command| {
        effective_shell_command(command).is_some_and(|(actual, arguments)| {
            actual == executable
                && subcommand.is_none_or(|expected| {
                    arguments.first().is_some_and(|actual| actual == expected)
                })
        })
    })
}

fn shell_command_has_argument(command: &ShellCommandAst, argument: &str) -> bool {
    effective_shell_command(command)
        .is_some_and(|(_, arguments)| arguments.iter().any(|value| value == argument))
}

fn shell_analysis_invokes_apply_patch(analysis: &ShellAstAnalysis) -> bool {
    shell_analysis_has_command(analysis, "apply_patch", None)
}

fn extract_apply_patch_payload_from_shell_command(command: &str) -> Option<String> {
    let begin = command.find("*** Begin Patch")?;
    let end = command.find("*** End Patch")?;
    let end = end + "*** End Patch".len();
    command.get(begin..end).map(str::to_string)
}

fn long_lived_exec_failure() -> NativeToolFailure {
    NativeToolFailure::new(
        "use_background_terminal",
        "This command keeps running and does not exit, so exec_command cannot wait for it.",
        "Use write_stdin to start it in a background terminal. Omit sessionId to create a private terminal. Lyra notifies you when that command exits.",
    )
}

fn shell_command_is_long_lived(analysis: &ShellAstAnalysis) -> bool {
    analysis.commands.iter().any(|command| {
        if command.backgrounded {
            return false;
        }
        let Some((tool, arguments)) = effective_shell_command(command) else {
            return false;
        };
        let tool = tool.as_str();
        if matches!(
            tool,
            "vite" | "webpack-dev-server" | "nodemon" | "forever" | "pm2" | "serve" | "watch"
        ) {
            return true;
        }
        if tool == "next"
            && arguments
                .first()
                .is_some_and(|argument| matches!(argument.as_str(), "dev" | "start"))
        {
            return true;
        }
        if matches!(tool, "npm" | "pnpm" | "yarn" | "bun") {
            if arguments
                .first()
                .is_some_and(|argument| matches!(argument.as_str(), "dev" | "serve" | "start"))
            {
                return true;
            }
            if arguments.windows(2).any(|pair| {
                pair[0] == "run" && matches!(pair[1].as_str(), "dev" | "serve" | "watch" | "start")
            }) {
                return true;
            }
        }
        if matches!(tool, "python" | "python3")
            && arguments
                .windows(2)
                .any(|pair| pair[0] == "-m" && pair[1] == "http.server")
        {
            return true;
        }
        if tool == "cargo"
            && arguments
                .first()
                .is_some_and(|argument| argument == "watch")
        {
            return true;
        }
        if tool == "docker"
            && arguments.windows(2).any(|pair| pair == ["compose", "up"])
            && !arguments
                .iter()
                .any(|argument| argument == "-d" || argument == "--detach")
        {
            return true;
        }
        if matches!(tool, "docker-compose" | "podman-compose")
            && arguments.first().is_some_and(|argument| argument == "up")
            && !arguments
                .iter()
                .any(|argument| argument == "-d" || argument == "--detach")
        {
            return true;
        }
        tool == "tail"
            && arguments.iter().any(|argument| {
                argument == "-f" || argument == "--follow" || argument.starts_with("--follow=")
            })
    })
}

async fn start_long_lived_in_background_terminal(
    session_id: &str,
    turn_id: &str,
    tool_call_id: &str,
    command: &str,
    cwd: &ShellCwd,
    command_kind: &str,
) -> NativeToolResult {
    let Some(dispatcher) = host_dispatcher() else {
        return Err(long_lived_exec_failure());
    };
    let payload = attach_runtime_cancellation(
        json!({
            "text": command,
            "appendNewline": true,
            "target": "private",
            "createNew": true,
            "cwd": cwd.display,
            "title": command.chars().take(80).collect::<String>(),
        }),
        session_id,
        turn_id,
        tool_call_id,
        "terminal",
        "write",
    );
    let host = invoke_host_capability_with_timeout_async(
        dispatcher,
        "terminal.write".to_string(),
        payload,
        DEFAULT_HOST_TOOL_TIMEOUT_MS,
    )
    .await
    .map_err(|error| {
        NativeToolFailure::new(
            "use_background_terminal",
            format!("Failed to start the command in a background terminal: {error}"),
            "Retry with write_stdin, omitting sessionId to create a private terminal.",
        )
    })?;
    if let Some(message) = host
        .get("error")
        .and_then(|error| error.get("message").or(Some(error)))
        .and_then(Value::as_str)
    {
        return Err(NativeToolFailure::new(
            "use_background_terminal",
            message.to_string(),
            "Retry with write_stdin, omitting sessionId to create a private terminal.",
        ));
    }
    let terminal_session_id = host.get("sessionId").and_then(Value::as_str).unwrap_or("");
    let output = host.get("output").and_then(Value::as_str).unwrap_or("");
    let content = format!(
        "Started in a background terminal (does not block this turn).\ncommand: {command}\ncwd: {}\nkind: {command_kind}\nterminalSessionId: {terminal_session_id}\nrunning: true\n\n{output}",
        cwd.display
    );
    Ok(NativeToolSuccess {
        content,
        raw: json!({
            "command": command,
            "cwd": cwd.display,
            "commandKind": command_kind,
            "background": true,
            "running": true,
            "sessionId": terminal_session_id,
            "exitCode": Value::Null,
            "success": true,
            "stdout": output,
            "activityKind": "shell",
            "rendererHint": "shell",
            "host": host,
        }),
        recommended_next_action: Some(
            "The process is running in a background terminal. Use terminal_read to inspect output. Lyra will notify you when it exits.".to_string(),
        ),
    })
}

#[cfg(test)]
pub(crate) fn classify_shell_command(command: &str) -> &'static str {
    classify_shell_analysis(&analyze_shell_command(command))
}

fn shell_requires_plan_mutation_gate(analysis: &ShellAstAnalysis) -> bool {
    classify_shell_analysis(analysis) == "mutation"
}

fn classify_shell_analysis(analysis: &ShellAstAnalysis) -> &'static str {
    if shell_analysis_mutates_artifacts(analysis) {
        "mutation"
    } else if analysis.has_parse_error || analysis.has_dynamic_interpreter {
        "unknown"
    } else if shell_analysis_has_command(analysis, "cargo", Some("test"))
        || ["npm", "pnpm", "yarn", "bun"]
            .iter()
            .any(|tool| shell_analysis_has_command(analysis, tool, Some("test")))
        || ["pytest", "vitest", "jest"]
            .iter()
            .any(|tool| shell_analysis_has_command(analysis, tool, None))
    {
        "test"
    } else if shell_analysis_has_command(analysis, "tsc", None)
        || analysis.commands.iter().any(|command| {
            effective_shell_command(command).is_some_and(|(tool, arguments)| {
                matches!(tool.as_str(), "npm" | "pnpm" | "yarn" | "bun")
                    && arguments
                        .windows(2)
                        .any(|pair| pair == ["run", "typecheck"])
            })
        })
    {
        "typecheck"
    } else if shell_analysis_has_command(analysis, "cargo", Some("clippy"))
        || analysis.commands.iter().any(|command| {
            effective_shell_command(command).is_some_and(|(tool, arguments)| {
                matches!(tool.as_str(), "eslint" | "stylelint")
                    || (matches!(tool.as_str(), "npm" | "pnpm" | "yarn" | "bun")
                        && arguments.windows(2).any(|pair| pair == ["run", "lint"]))
            })
        })
    {
        "lint"
    } else if shell_analysis_has_command(analysis, "cargo", Some("check"))
        || shell_analysis_has_command(analysis, "cargo", Some("build"))
        || analysis.commands.iter().any(|command| {
            effective_shell_command(command).is_some_and(|(tool, arguments)| {
                matches!(tool.as_str(), "npm" | "pnpm" | "yarn" | "bun")
                    && arguments.windows(2).any(|pair| pair == ["run", "build"])
            })
        })
    {
        "build"
    } else if shell_analysis_has_command(analysis, "git", None) {
        "git"
    } else if ["rg", "grep", "ag", "ack", "find", "fd", "locate"]
        .iter()
        .any(|tool| shell_analysis_has_command(analysis, tool, None))
    {
        "search"
    } else if [
        "ls", "tree", "du", "pwd", "cat", "head", "tail", "sed", "awk", "jq", "wc",
    ]
    .iter()
    .any(|tool| shell_analysis_has_command(analysis, tool, None))
    {
        "read"
    } else if ["vite", "next", "webpack", "serve"]
        .iter()
        .any(|tool| shell_analysis_has_command(analysis, tool, None))
        || analysis.commands.iter().any(|command| {
            effective_shell_command(command).is_some_and(|(tool, arguments)| {
                matches!(tool.as_str(), "npm" | "pnpm" | "yarn" | "bun")
                    && arguments.windows(2).any(|pair| {
                        pair == ["run", "dev"]
                            || pair == ["run", "serve"]
                            || pair == ["run", "watch"]
                    })
            })
        })
    {
        "server"
    } else {
        "unknown"
    }
}

fn shell_analysis_mutates_artifacts(analysis: &ShellAstAnalysis) -> bool {
    if analysis.has_write_redirect || shell_analysis_invokes_apply_patch(analysis) {
        return true;
    }
    analysis.commands.iter().any(|command| {
        let Some((executable, arguments)) = effective_shell_command(command) else {
            return false;
        };
        if matches!(
            executable.as_str(),
            "cp" | "mv"
                | "mkdir"
                | "touch"
                | "rm"
                | "rmdir"
                | "unlink"
                | "truncate"
                | "dd"
                | "tee"
                | "rustfmt"
        ) {
            return true;
        }
        if executable == "sed"
            && arguments
                .iter()
                .any(|argument| argument == "-i" || argument.starts_with("-i"))
        {
            return true;
        }
        if executable == "perl"
            && arguments.iter().any(|argument| {
                argument.starts_with('-')
                    && argument
                        .trim_start_matches('-')
                        .chars()
                        .any(|flag| flag == 'i')
            })
        {
            return true;
        }
        if executable == "git"
            && arguments.first().is_some_and(|subcommand| {
                matches!(
                    subcommand.as_str(),
                    "add"
                        | "am"
                        | "apply"
                        | "checkout"
                        | "cherry-pick"
                        | "clean"
                        | "commit"
                        | "merge"
                        | "mv"
                        | "rebase"
                        | "reset"
                        | "restore"
                        | "revert"
                        | "rm"
                        | "stash"
                )
            })
        {
            return true;
        }
        if matches!(
            executable.as_str(),
            "npm" | "pnpm" | "yarn" | "bun" | "cargo"
        ) && arguments.first().is_some_and(|subcommand| {
            matches!(
                subcommand.as_str(),
                "add" | "install" | "remove" | "uninstall" | "update"
            ) || (executable == "cargo"
                && subcommand == "fmt"
                && !arguments.iter().any(|argument| argument == "--check"))
        }) {
            return true;
        }
        (executable == "prettier" && shell_command_has_argument(command, "--write"))
            || (executable == "eslint" && shell_command_has_argument(command, "--fix"))
    })
}

fn shell_analysis_requires_permission(analysis: &ShellAstAnalysis) -> bool {
    if analysis.has_parse_error || analysis.has_dynamic_interpreter {
        return true;
    }
    analysis.commands.iter().any(|command| {
        let Some((executable, arguments)) = effective_shell_command(command) else {
            return true;
        };
        if command.executable.as_deref() == Some("sudo")
            || matches!(
                executable.as_str(),
                "rm" | "rmdir"
                    | "unlink"
                    | "shutdown"
                    | "reboot"
                    | "halt"
                    | "dd"
                    | "mkfs"
                    | "diskutil"
                    | "chmod"
                    | "chown"
                    | "apply_patch"
            )
        {
            return true;
        }
        if executable == "git"
            && arguments.first().is_some_and(|subcommand| {
                matches!(
                    subcommand.as_str(),
                    "reset" | "clean" | "checkout" | "restore"
                )
            })
        {
            return true;
        }
        matches!(
            executable.as_str(),
            "npm" | "pnpm" | "yarn" | "bun" | "cargo"
        ) && arguments
            .first()
            .is_some_and(|subcommand| matches!(subcommand.as_str(), "add" | "install" | "update"))
    })
}

pub(crate) fn shell_command_requires_permission(command: &str) -> bool {
    shell_analysis_requires_permission(&analyze_shell_command(command))
}

pub(crate) fn apply_allowed_env(input: &Value, command: &mut Command) {
    let Some(env_object) = input.get("env").and_then(Value::as_object) else {
        return;
    };
    let allowlist = input
        .get("envAllowlist")
        .and_then(Value::as_array)
        .map(|values| {
            values
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect::<HashSet<_>>()
        })
        .unwrap_or_default();
    for (key, value) in env_object {
        if !allowlist.contains(key) || !is_safe_env_key(key) {
            continue;
        }
        if let Some(value) = value.as_str() {
            command.env(key, value);
        }
    }
}

pub(crate) fn is_safe_env_key(key: &str) -> bool {
    !key.is_empty()
        && key.chars().all(|character| {
            character.is_ascii_uppercase() || character.is_ascii_digit() || character == '_'
        })
}

/// Windows only: attempt to execute a command through the elevated helper's
/// named pipe.  Returns `Some(result)` if the helper handled the command (or
/// returned an error), or `None` if the pipe is unreachable and the caller
/// should fall back to local (non-elevated) execution.
#[cfg(target_os = "windows")]
#[allow(clippy::too_many_arguments)]
fn try_execute_via_elevated_helper(
    session_id: &str,
    turn_id: &str,
    tool_call_id: &str,
    command: &str,
    cwd: &ShellCwd,
    timeout_ms: u64,
    max_output: usize,
    input: &Value,
    command_kind: &str,
    pipe_name: &str,
) -> Option<NativeToolResult> {
    use std::io::{BufRead, BufReader, Write};

    let request = json!({
        "command": command,
        "cwd": cwd.absolute.to_string_lossy(),
        "timeoutMs": timeout_ms,
    });
    let request_json = match serde_json::to_string(&request) {
        Ok(s) => s,
        Err(_) => return None,
    };

    // Open the named pipe with a brief retry window — the helper may be
    // between pipe instances when we try to connect.
    let file = {
        let deadline = Instant::now() + Duration::from_secs(2);
        loop {
            match std::fs::OpenOptions::new()
                .read(true)
                .write(true)
                .open(pipe_name)
            {
                Ok(f) => break f,
                Err(_) => {
                    if Instant::now() >= deadline {
                        return None;
                    }
                    std::thread::sleep(Duration::from_millis(50));
                }
            }
        }
    };

    // Write the request line.
    let mut file = file;
    if file
        .write_all(format!("{request_json}\n").as_bytes())
        .is_err()
    {
        return None;
    }
    if file.flush().is_err() {
        return None;
    }

    // Read the response line (synchronous — the helper enforces its own timeout).
    let mut reader = BufReader::new(file);
    let mut line = String::new();
    if reader.read_line(&mut line).is_err() {
        return None;
    }

    let response: Value = match serde_json::from_str(line.trim()) {
        Ok(v) => v,
        Err(_) => return None,
    };

    let exit_code = response.get("exitCode").and_then(Value::as_i64);
    let stdout_raw = response.get("stdout").and_then(Value::as_str).unwrap_or("");
    let stderr_raw = response.get("stderr").and_then(Value::as_str).unwrap_or("");
    let timed_out = response
        .get("timedOut")
        .and_then(Value::as_bool)
        .unwrap_or(false);

    let stdout_truncated = stdout_raw.len() > max_output;
    let stderr_truncated = stderr_raw.len() > max_output;
    let stdout_text = if stdout_truncated {
        truncate_at_char_boundary(stdout_raw, max_output).to_string()
    } else {
        stdout_raw.to_string()
    };
    let stderr_text = if stderr_truncated {
        truncate_at_char_boundary(stderr_raw, max_output).to_string()
    } else {
        stderr_raw.to_string()
    };

    let description = value_string(input, "description").unwrap_or_default();
    let content = format!(
        "command: {}\ndescription: {}\ncwd: {}\nkind: {}\nexitCode: {:?}\ntimedOut: {}\nprocessGroupTerminated: false\noutputCollectionTimedOut: false\n\nstdout:\n{}\n\nstderr:\n{}",
        command,
        description,
        cwd.display,
        command_kind,
        exit_code,
        timed_out,
        stdout_text,
        stderr_text,
    );

    let stdout_ref = (!stdout_text.is_empty() || stdout_truncated).then(|| {
        write_tool_artifact_with_kind(
            session_id,
            turn_id,
            &format!("{tool_call_id}-stdout"),
            ToolArtifactKind::Stdout,
            &stdout_text,
        )
    });
    let stderr_ref = (!stderr_text.is_empty() || stderr_truncated).then(|| {
        write_tool_artifact_with_kind(
            session_id,
            turn_id,
            &format!("{tool_call_id}-stderr"),
            ToolArtifactKind::Stderr,
            &stderr_text,
        )
    });

    let success = exit_code == Some(0) && !timed_out;
    Some(Ok(NativeToolSuccess {
        content,
        raw: json!({
            "command": command,
            "cwd": cwd.display,
            "exitCode": exit_code,
            "success": success,
            "timedOut": timed_out,
            "commandKind": command_kind,
            "description": description,
            "stdout": stdout_text,
            "stderr": stderr_text,
            "stdoutTruncated": stdout_truncated,
            "stderrTruncated": stderr_truncated,
            "stdoutBytes": stdout_raw.len(),
            "stderrBytes": stderr_raw.len(),
            "processGroupTerminated": false,
            "stdoutRef": stdout_ref.flatten(),
            "stderrRef": stderr_ref.flatten(),
            "activityKind": "shell",
            "rendererHint": "shell",
        }),
        recommended_next_action: if timed_out {
            Some(
                "Use a narrower command, increase timeoutMs, or use write_stdin to start a background terminal for long-running work."
                    .to_string(),
            )
        } else if success {
            None
        } else {
            Some("Inspect stderr/stdout and retry after fixing the command failure.".to_string())
        },
    }))
}

/// Truncate at a UTF-8 character boundary at or before `max_bytes`.
#[cfg(target_os = "windows")]
fn truncate_at_char_boundary(s: &str, max_bytes: usize) -> &str {
    if s.len() <= max_bytes {
        return s;
    }
    let mut end = max_bytes;
    while end > 0 && !s.is_char_boundary(end) {
        end -= 1;
    }
    &s[..end]
}

#[cfg(test)]
mod mutation_tests {
    use super::*;

    #[test]
    fn shell_mutation_classification_covers_common_write_bypasses() {
        for command in [
            "sed -i '' 's/old/new/' index.html",
            "perl -pi -e 's/old/new/' index.html",
            "printf '<h1>Hi</h1>' > index.html",
            "cat template.html | tee index.html",
            "cargo fmt",
            "pnpm install",
            "sed -n '1,5p' index.html && rm index.html",
        ] {
            assert_eq!(
                classify_shell_command(command),
                "mutation",
                "command should be gated: {command}"
            );
        }
    }

    #[test]
    fn dynamic_interpreter_inspection_is_not_plan_gated() {
        for command in [
            "python3 -c 'print(1)'",
            "ls && python3 -c 'from pathlib import Path; print(Path(\"index.html\").read_text())'",
            "node -e \"console.log(1)\"",
        ] {
            let analysis = analyze_shell_command(command);
            assert!(
                !shell_requires_plan_mutation_gate(&analysis),
                "inspection command should not be plan-gated: {command}"
            );
        }
        assert!(shell_requires_plan_mutation_gate(&analyze_shell_command(
            "printf '<h1>Hi</h1>' > index.html"
        )));
    }

    #[test]
    fn dynamic_interpreter_code_is_unknown_and_permission_gated() {
        for command in [
            "python -c \"from pathlib import Path; Path('index.html').write_text('x')\"",
            "node -e \"require('fs').writeFileSync('index.html', 'x')\"",
        ] {
            assert_eq!(classify_shell_command(command), "unknown");
            assert!(shell_command_requires_permission(command));
        }
    }

    #[test]
    fn shell_read_and_verification_commands_remain_non_mutating() {
        for command in [
            "sed -n '1,40p' index.html",
            "git config --global --list >/dev/null 2>&1 || true",
            "cargo fmt --check",
            "cargo test -p lyra-agent-runtime quality_gate --lib",
            "python3 -c 'print(1)'",
            "ls index.html && python3 -c 'from pathlib import Path; print(Path(\"index.html\").read_text())'",
        ] {
            assert_ne!(
                classify_shell_command(command),
                "mutation",
                "read-only command should not be gated as a mutation: {command}"
            );
        }
    }

    #[test]
    fn long_lived_commands_are_detected_before_exec_waits() {
        for command in [
            "npm run dev",
            "pnpm dev",
            "python3 -m http.server 8888",
            "cargo watch -x test",
            "docker compose up",
            "tail -f logs/app.log",
            "next dev",
        ] {
            assert!(
                shell_command_is_long_lived(&analyze_shell_command(command)),
                "should not wait on {command}"
            );
        }
        for command in [
            "git clone https://example.com/repo.git",
            "npm test",
            "cargo build",
            "python3 -c 'print(1)'",
            "docker compose up -d",
            "tail -n 20 logs/app.log",
            "python3 -m http.server 8888 &",
            "python3 -m http.server 8001 --bind 127.0.0.1 >/tmp/lyra-web-test.log 2>&1 & SRV=$!; sleep 1; curl -fsS http://127.0.0.1:8001/; kill $SRV",
        ] {
            assert!(
                !shell_command_is_long_lived(&analyze_shell_command(command)),
                "should wait for {command} to exit"
            );
        }
    }
}
