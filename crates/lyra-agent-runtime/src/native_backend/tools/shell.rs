use super::*;

pub(crate) fn execute_shell_tool_adapter(
    session_id: &str,
    turn_id: &str,
    cancellation: &Arc<AtomicBool>,
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
}

pub(crate) fn tool_shell_run(
    session_id: &str,
    turn_id: &str,
    tool_call_id: &str,
    input: &Value,
) -> NativeToolResult {
    let command = required_value_string(input, "command")?;
    if value_bool(input, "runInBackground", false) {
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
    let permission_granted = input
        .get("permissionGranted")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let command_kind = classify_shell_command(&command);
    if shell_command_requires_permission(&command) && !permission_granted {
        return Err(NativeToolFailure::new(
            "permission_required",
            "command is classified as high risk and was not executed without permission",
            "Request explicit user permission or choose a non-destructive validation command.",
        )
        .with_detail(json!({ "command": command, "commandKind": command_kind })));
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
    let mut command_builder = shell_command_builder(&command);
    command_builder
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
        "command: {}\ndescription: {}\ncwd: {}\nkind: {}\nexitCode: {:?}\ntimedOut: {}\n\nstdout:\n{}\n\nstderr:\n{}",
        command,
        value_string(input, "description").unwrap_or_default(),
        cwd.display,
        command_kind,
        exit_code,
        timed_out,
        stdout.text,
        stderr.text
    );
    let stdout_ref = (!stdout.text.is_empty() || stdout.truncated).then(|| {
        write_tool_artifact_with_kind(
            session_id,
            turn_id,
            &format!("{tool_call_id}-stdout"),
            ToolArtifactKind::Stdout,
            &stdout.text,
        )
    });
    let stderr_ref = (!stderr.text.is_empty() || stderr.truncated).then(|| {
        write_tool_artifact_with_kind(
            session_id,
            turn_id,
            &format!("{tool_call_id}-stderr"),
            ToolArtifactKind::Stderr,
            &stderr.text,
        )
    });
    Ok(NativeToolSuccess {
        content,
        raw: json!({
            "command": command,
            "cwd": cwd.display,
            "exitCode": exit_code,
            "success": status.success() && !timed_out,
            "timedOut": timed_out,
            "commandKind": command_kind,
            "description": value_string(input, "description"),
            "stdout": stdout.text,
            "stderr": stderr.text,
            "stdoutTruncated": stdout.truncated,
            "stderrTruncated": stderr.truncated,
            "stdoutBytes": stdout.total_bytes,
            "stderrBytes": stderr.total_bytes,
            "stdoutRef": stdout_ref.flatten(),
            "stderrRef": stderr_ref.flatten(),
        }),
        recommended_next_action: if timed_out {
            Some(
                "Use a narrower command, increase timeoutMs, or start a terminal session for long-running work."
                    .to_string(),
            )
        } else if status.success() {
            None
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

pub(crate) fn shell_command_requires_permission(command: &str) -> bool {
    let lower = command.to_ascii_lowercase();
    let dangerous_patterns = [
        "rm ",
        "rm\t",
        "rm -",
        "rmdir ",
        "unlink ",
        "shutdown",
        "reboot",
        "halt",
        "mkfs",
        "diskutil",
        "chmod ",
        "chown ",
        "sudo ",
        "git reset",
        "git clean",
        "git checkout",
        "git restore",
        "npm install",
        "pnpm install",
        "yarn install",
        "bun install",
        "cargo install",
    ];
    if dangerous_patterns
        .iter()
        .any(|pattern| lower.contains(pattern))
    {
        return true;
    }
    shlex::split(command)
        .filter(|tokens| !tokens.is_empty())
        .is_some_and(|tokens| command_requires_permission(&tokens))
}

pub(crate) fn classify_shell_command(command: &str) -> &'static str {
    let lower = command.to_ascii_lowercase();
    let first = shlex::split(command)
        .and_then(|tokens| tokens.first().cloned())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if lower.contains("npm test")
        || lower.contains("pnpm test")
        || lower.contains("yarn test")
        || lower.contains("cargo test")
        || lower.contains("pytest")
        || lower.contains("vitest")
        || lower.contains("jest")
    {
        "test"
    } else if lower.contains("typecheck") || lower.contains("tsc ") || lower.ends_with("tsc") {
        "typecheck"
    } else if lower.contains("lint") || lower.contains("clippy") {
        "lint"
    } else if lower.contains("build") || lower.contains("cargo check") {
        "build"
    } else if first == "git" || lower.contains(" git ") || lower.starts_with("git ") {
        if shell_command_requires_permission(command) {
            "mutation"
        } else {
            "git"
        }
    } else if matches!(
        first.as_str(),
        "rg" | "grep" | "ag" | "ack" | "find" | "fd" | "locate"
    ) || lower.contains(" grep ")
        || lower.contains("| grep")
        || lower.contains(" rg ")
        || lower.contains("| rg")
    {
        "search"
    } else if matches!(
        first.as_str(),
        "ls" | "tree" | "du" | "pwd" | "cat" | "head" | "tail" | "sed" | "awk" | "jq" | "wc"
    ) {
        "read"
    } else if lower.contains("npm install")
        || lower.contains("pnpm install")
        || lower.contains("yarn install")
        || lower.contains("bun install")
        || lower.contains("cargo install")
    {
        "install"
    } else if lower.contains(" dev") || lower.contains("serve") || lower.contains("watch") {
        "server"
    } else if shell_command_requires_permission(command) {
        "mutation"
    } else {
        "unknown"
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
