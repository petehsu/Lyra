use super::*;

use std::io::Write;
use std::sync::mpsc;
use tree_sitter::{Node, Parser};

const OUTPUT_DRAIN_TIMEOUT: Duration = Duration::from_millis(500);
const OUTPUT_KILL_DRAIN_TIMEOUT: Duration = Duration::from_millis(500);

#[derive(Clone, Debug, Default)]
struct ShellCommandAst {
    executable: Option<String>,
    arguments: Vec<String>,
    executable_end: usize,
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

pub(crate) fn tool_shell_run(
    session_id: &str,
    turn_id: &str,
    tool_call_id: &str,
    input: &Value,
) -> NativeToolResult {
    let command = required_value_string(input, "command")?;
    if value_bool(input, "runInBackground", false) || value_bool(input, "background", false) {
        return Err(NativeToolFailure::new(
            "background_not_supported",
            "run_command does not launch background tasks in this version",
            "Use /tools/terminal/run for long-running or interactive work, or run a bounded foreground command.",
        ));
    }
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
    if command_kind == "mutation" || analysis.has_parse_error || analysis.has_dynamic_interpreter {
        validate_plan_mutation_for_session(session_id, "shell mutation")?;
        validate_artifact_mutation_for_session(session_id, turn_id)?;
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
    let timeout_ms = value_u64(
        input,
        "timeoutMs",
        DEFAULT_COMMAND_TIMEOUT_MS,
        MAX_COMMAND_TIMEOUT_MS,
    );
    let max_output = value_usize(
        input,
        "maxOutputBytes",
        DEFAULT_COMMAND_OUTPUT_BYTES,
        1_000_000,
    );
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
        .stderr(Stdio::piped());
    apply_allowed_env(input, &mut command_builder);
    let mut child = command_builder.spawn().map_err(|error| {
        NativeToolFailure::new(
            "spawn_failed",
            format!("failed to start command: {error}"),
            "Retry with an installed executable and valid arguments.",
        )
    })?;
    // sudo -S 从 stdin 读密码 — spawn 后立即写入，drop stdin 触发 EOF
    if needs_sudo_stdin {
        if let Some(mut stdin) = child.stdin.take() {
            let _ = stdin.write_all(format!("{}\n", elevation.unwrap()).as_bytes());
        }
    }
    let child_process_id = child.id();
    lyra_process_lifecycle_core::spawn_parent_death_watcher(child_process_id, true);
    let stdout = child
        .stdout
        .take()
        .map(|reader| spawn_limited_stream_reader(reader, max_output));
    let stderr = child
        .stderr
        .take()
        .map(|reader| spawn_limited_stream_reader(reader, max_output));
    let started = Instant::now();
    let mut timed_out = false;
    let mut process_group_terminated = false;
    let mut process_group_signal: Option<&'static str> = None;
    let status = loop {
        if let Some(status) = child.try_wait().map_err(|error| {
            NativeToolFailure::new(
                "command_failed",
                format!("failed to poll command: {error}"),
                "Retry the command or use a terminal session.",
            )
        })? {
            break status;
        }
        if started.elapsed() >= Duration::from_millis(timeout_ms) {
            timed_out = true;
            if terminate_shell_process_group(child_process_id, true) {
                process_group_terminated = true;
                process_group_signal = Some("kill");
            } else {
                let _ = child.kill();
            }
            break child.wait().map_err(|error| {
                NativeToolFailure::new(
                    "command_failed",
                    format!("failed to terminate timed-out command: {error}"),
                    "Use a shorter-running command or a terminal session.",
                )
            })?;
        }
        thread::sleep(Duration::from_millis(20));
    };
    if !timed_out && terminate_shell_process_group(child_process_id, false) {
        process_group_terminated = true;
        process_group_signal = Some("term");
    }
    let mut stdout = collect_stream_output(stdout.as_ref(), OUTPUT_DRAIN_TIMEOUT);
    let mut stderr = collect_stream_output(stderr.as_ref(), OUTPUT_DRAIN_TIMEOUT);
    if stdout.timed_out || stderr.timed_out {
        if terminate_shell_process_group(child_process_id, true) {
            process_group_terminated = true;
            process_group_signal = Some("kill");
        }
        if stdout.timed_out {
            stdout = collect_stream_output(stdout.receiver, OUTPUT_KILL_DRAIN_TIMEOUT);
        }
        if stderr.timed_out {
            stderr = collect_stream_output(stderr.receiver, OUTPUT_KILL_DRAIN_TIMEOUT);
        }
    }
    let output_collection_timed_out = stdout.timed_out || stderr.timed_out;
    let exit_code = status.code();
    let content = format!(
        "command: {}\ndescription: {}\ncwd: {}\nkind: {}\nexitCode: {:?}\ntimedOut: {}\nprocessGroupTerminated: {}\noutputCollectionTimedOut: {}\n\nstdout:\n{}\n\nstderr:\n{}",
        command,
        value_string(input, "description").unwrap_or_default(),
        cwd.display,
        command_kind,
        exit_code,
        timed_out,
        process_group_terminated,
        output_collection_timed_out,
        stdout.output.text,
        stderr.output.text
    );
    let stdout_ref = (!stdout.output.text.is_empty() || stdout.output.truncated).then(|| {
        write_tool_artifact_with_kind(
            session_id,
            turn_id,
            &format!("{tool_call_id}-stdout"),
            ToolArtifactKind::Stdout,
            &stdout.output.text,
        )
    });
    let stderr_ref = (!stderr.output.text.is_empty() || stderr.output.truncated).then(|| {
        write_tool_artifact_with_kind(
            session_id,
            turn_id,
            &format!("{tool_call_id}-stderr"),
            ToolArtifactKind::Stderr,
            &stderr.output.text,
        )
    });
    let success =
        status.success() && !timed_out && !process_group_terminated && !output_collection_timed_out;
    Ok(NativeToolSuccess {
        content,
        raw: json!({
            "command": command,
            "cwd": cwd.display,
            "exitCode": exit_code,
            "success": success,
            "timedOut": timed_out,
            "commandKind": command_kind,
            "description": value_string(input, "description"),
            "stdout": stdout.output.text,
            "stderr": stderr.output.text,
            "stdoutTruncated": stdout.output.truncated,
            "stderrTruncated": stderr.output.truncated,
            "stdoutBytes": stdout.output.total_bytes,
            "stderrBytes": stderr.output.total_bytes,
            "stdoutCollectionTimedOut": stdout.timed_out,
            "stderrCollectionTimedOut": stderr.timed_out,
            "outputCollectionTimedOut": output_collection_timed_out,
            "processGroupTerminated": process_group_terminated,
            "processGroupSignal": process_group_signal,
            "stdoutRef": stdout_ref.flatten(),
            "stderrRef": stderr_ref.flatten(),
            "activityKind": "shell",
            "rendererHint": "shell",
        }),
        recommended_next_action: if timed_out {
            Some(
                "Use a narrower command, increase timeoutMs, or start a terminal session for long-running work."
                    .to_string(),
            )
        } else if process_group_terminated || output_collection_timed_out {
            Some(
                "Use /tools/terminal/run for commands that keep background processes or open output streams."
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
        let mut builder = Command::new("cmd");
        builder.args(["/S", "/C", command]);
        builder
    }
    #[cfg(not(windows))]
    {
        let mut builder = Command::new("sh");
        builder.args(["-lc", command]);
        builder
    }
}

fn configure_shell_child(command: &mut Command) {
    lyra_process_lifecycle_core::configure_daemon_child_command(command);
}

fn terminate_shell_process_group(process_id: u32, force: bool) -> bool {
    #[cfg(unix)]
    {
        let signal = if force { libc::SIGKILL } else { libc::SIGTERM };
        let process_group = -(process_id as i32);
        // The shell is launched into its own process group. Sending to the group
        // clears descendants that keep stdout/stderr pipes open after the shell exits.
        unsafe { libc::kill(process_group, signal) == 0 }
    }
    #[cfg(not(unix))]
    {
        let _ = (process_id, force);
        false
    }
}

struct CollectedStreamOutput<'a> {
    output: LimitedOutput,
    timed_out: bool,
    receiver: Option<&'a mpsc::Receiver<LimitedOutput>>,
}

fn spawn_limited_stream_reader<R: Read + Send + 'static>(
    reader: R,
    limit: usize,
) -> mpsc::Receiver<LimitedOutput> {
    let (sender, receiver) = mpsc::channel();
    let _ = thread::spawn(move || {
        let _ = sender.send(read_limited_stream(reader, limit));
    });
    receiver
}

fn collect_stream_output<'a>(
    receiver: Option<&'a mpsc::Receiver<LimitedOutput>>,
    timeout: Duration,
) -> CollectedStreamOutput<'a> {
    let Some(receiver) = receiver else {
        return CollectedStreamOutput {
            output: LimitedOutput::default(),
            timed_out: false,
            receiver: None,
        };
    };
    match receiver.recv_timeout(timeout) {
        Ok(output) => CollectedStreamOutput {
            output,
            timed_out: false,
            receiver: Some(receiver),
        },
        Err(mpsc::RecvTimeoutError::Timeout) => CollectedStreamOutput {
            output: LimitedOutput::default(),
            timed_out: true,
            receiver: Some(receiver),
        },
        Err(mpsc::RecvTimeoutError::Disconnected) => CollectedStreamOutput {
            output: LimitedOutput::default(),
            timed_out: false,
            receiver: Some(receiver),
        },
    }
}

#[derive(Clone, Debug, Default)]
pub(crate) struct LimitedOutput {
    pub(crate) text: String,
    pub(crate) truncated: bool,
    pub(crate) total_bytes: usize,
}

pub(crate) fn read_limited_stream<R: Read>(mut reader: R, limit: usize) -> LimitedOutput {
    let mut buffer = [0_u8; 8192];
    let mut output = Vec::new();
    let mut total = 0;
    while let Ok(count) = reader.read(&mut buffer) {
        if count == 0 {
            break;
        }
        total += count;
        if output.len() < limit {
            let remaining = limit - output.len();
            output.extend_from_slice(&buffer[..count.min(remaining)]);
        }
    }
    LimitedOutput {
        text: String::from_utf8_lossy(&output).to_string(),
        truncated: total > output.len(),
        total_bytes: total,
    }
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

pub(crate) fn classify_shell_command(command: &str) -> &'static str {
    classify_shell_analysis(&analyze_shell_command(command))
}

pub(crate) fn shell_command_changes_state(command: &str) -> bool {
    let analysis = analyze_shell_command(command);
    shell_analysis_mutates_artifacts(&analysis)
        || analysis.has_parse_error
        || analysis.has_dynamic_interpreter
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
            "rg 'button' src/App.tsx",
        ] {
            assert_ne!(
                classify_shell_command(command),
                "mutation",
                "read-only command should not be gated as a mutation: {command}"
            );
        }
    }
}
