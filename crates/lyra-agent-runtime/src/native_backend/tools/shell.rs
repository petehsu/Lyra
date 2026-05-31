use super::*;

pub(crate) fn tool_shell_run(session_id: &str, input: &Value) -> NativeToolResult {
    let command = required_value_string(input, "command")?;
    if shell_command_has_control_operator(&command) {
        return Err(NativeToolFailure::new(
            "interactive_or_composite_command",
            "shell_run only accepts one non-interactive command without shell control operators",
            "Use a single command and arguments, or open a terminal session for interactive work.",
        ));
    }
    let tokens = shlex::split(&command).ok_or_else(|| {
        NativeToolFailure::new(
            "bad_command",
            "failed to parse command tokens",
            "Retry with a shell-escaped command that can be tokenized.",
        )
    })?;
    if tokens.is_empty() {
        return Err(NativeToolFailure::new(
            "bad_command",
            "command is empty",
            "Retry with a non-empty command.",
        ));
    }
    let permission_granted = input
        .get("permissionGranted")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    if command_requires_permission(&tokens) && !permission_granted {
        return Err(NativeToolFailure::new(
            "permission_required",
            "command is classified as high risk and was not executed without permission",
            "Request explicit user permission or choose a non-destructive validation command.",
        )
        .with_detail(json!({ "command": command })));
    }
    let cwd = value_string(input, "cwd").unwrap_or_else(|| ".".to_string());
    let cwd = resolve_workspace_path(session_id, &cwd, false)?;
    if !cwd.absolute.is_dir() {
        return Err(NativeToolFailure::new(
            "bad_cwd",
            "cwd must be a workspace directory",
            "Retry with a directory inside the workspace.",
        ));
    }
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
    let mut command_builder = Command::new(&tokens[0]);
    command_builder
        .args(&tokens[1..])
        .current_dir(&cwd.absolute)
        .stdin(Stdio::null())
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
    let stdout = child
        .stdout
        .take()
        .map(|reader| thread::spawn(move || read_limited_stream(reader, max_output)));
    let stderr = child
        .stderr
        .take()
        .map(|reader| thread::spawn(move || read_limited_stream(reader, max_output)));
    let started = Instant::now();
    let mut timed_out = false;
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
            let _ = child.kill();
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
    let stdout = stdout
        .and_then(|handle| handle.join().ok())
        .unwrap_or_else(|| LimitedOutput::default());
    let stderr = stderr
        .and_then(|handle| handle.join().ok())
        .unwrap_or_else(|| LimitedOutput::default());
    let exit_code = status.code();
    let content = format!(
        "command: {}\ncwd: {}\nexitCode: {:?}\ntimedOut: {}\n\nstdout:\n{}\n\nstderr:\n{}",
        command, cwd.relative, exit_code, timed_out, stdout.text, stderr.text
    );
    Ok(NativeToolSuccess {
        content,
        raw: json!({
            "command": command,
            "cwd": cwd.relative,
            "exitCode": exit_code,
            "success": status.success() && !timed_out,
            "timedOut": timed_out,
            "stdout": stdout.text,
            "stderr": stderr.text,
            "stdoutTruncated": stdout.truncated,
            "stderrTruncated": stderr.truncated,
            "stdoutBytes": stdout.total_bytes,
            "stderrBytes": stderr.total_bytes,
        }),
        recommended_next_action: if timed_out {
            Some(
                "Use a narrower command or start a terminal session for long-running work."
                    .to_string(),
            )
        } else if status.success() {
            None
        } else {
            Some("Inspect stderr/stdout and retry after fixing the command failure.".to_string())
        },
    })
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

pub(crate) fn shell_command_has_control_operator(command: &str) -> bool {
    command.contains('\n')
        || command.contains(';')
        || command.contains("&&")
        || command.contains("||")
        || command.contains('|')
        || command.contains('`')
        || command.contains("$(")
        || command.contains('>')
        || command.contains('<')
}

pub(crate) fn command_requires_permission(tokens: &[String]) -> bool {
    let executable = Path::new(&tokens[0])
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or(tokens[0].as_str())
        .to_ascii_lowercase();
    match executable.as_str() {
        "rm" | "rmdir" | "unlink" | "shutdown" | "reboot" | "halt" | "dd" | "mkfs" | "diskutil"
        | "chmod" | "chown" => true,
        "git" => tokens.get(1).is_some_and(|subcommand| {
            matches!(
                subcommand.as_str(),
                "reset" | "clean" | "checkout" | "restore"
            )
        }),
        _ => false,
    }
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
