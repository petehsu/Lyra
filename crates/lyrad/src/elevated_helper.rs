//! Windows elevated helper — a minimal named-pipe server that executes
//! shell commands with the process's elevated (admin) token.
//!
//! Started by the agent runtime via UAC (PowerShell `Start-Process -Verb RunAs`),
//! the helper stays alive for the duration of the parent process (lyrad) and
//! eliminates per-command UAC prompts.  Commands are exchanged as
//! newline-delimited JSON over a Windows named pipe restricted to the
//! current user's SID.

#[cfg(windows)]
pub fn run(pipe_name: String) -> ! {
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::Instant;
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
    use tokio::net::windows::named_pipe::ServerOptions;

    const WORKER_STACK_SIZE: usize = 8 * 1024 * 1024;
    const MAX_OUTPUT_BYTES: usize = 1_000_000;

    let runtime = match tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .thread_stack_size(WORKER_STACK_SIZE)
        .build()
    {
        Ok(rt) => rt,
        Err(error) => {
            eprintln!("elevated helper: failed to create tokio runtime: {error}");
            std::process::exit(1);
        }
    };

    runtime.block_on(async move {
        // Signal readiness so the starter (agent-runtime) knows we're listening.
        let ready_path = ready_file_path(&pipe_name);
        if let Some(parent) = ready_path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }

        let mut security = match crate::WindowsPipeSecurity::current_user() {
            Ok(s) => s,
            Err(error) => {
                eprintln!("elevated helper: failed to create pipe security: {error}");
                std::process::exit(1);
            }
        };

        // Create the first pipe instance and signal readiness.
        let server = match unsafe {
            ServerOptions::new()
                .create_with_security_attributes_raw(&pipe_name, security.as_mut_ptr())
        } {
            Ok(s) => s,
            Err(error) => {
                eprintln!("elevated helper: failed to create named pipe {pipe_name}: {error}");
                std::process::exit(1);
            }
        };

        let _ = std::fs::write(&ready_path, b"ready");
        eprintln!("lyra elevated helper listening on {pipe_name}");

        let mut current = server;
        loop {
            if let Err(error) = current.connect().await {
                eprintln!("elevated helper: pipe connect failed: {error}");
                break;
            }

            // Create the next instance before handing off the current one.
            let next = match unsafe {
                ServerOptions::new()
                    .create_with_security_attributes_raw(&pipe_name, security.as_mut_ptr())
            } {
                Ok(s) => s,
                Err(error) => {
                    eprintln!("elevated helper: failed to create pipe instance: {error}");
                    // Still serve the connected client before exiting.
                    let connected = std::mem::replace(&mut current, next_unreachable());
                    tokio::spawn(serve_connection(connected));
                    break;
                }
            };

            let connected = std::mem::replace(&mut current, next);
            tokio::spawn(serve_connection(connected));
        }
    });

    std::process::exit(0);
}

/// Placeholder to satisfy the type system in the error branch above.
#[cfg(windows)]
fn next_unreachable() -> tokio::net::windows::named_pipe::NamedPipeServer {
    // SAFETY: This function is only called in a branch that immediately breaks
    // the loop, so the returned server is never used.
    unreachable!("next_unreachable should never be called")
}

#[cfg(windows)]
async fn serve_connection(server: tokio::net::windows::named_pipe::NamedPipeServer) {
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

    let (reader, mut writer) = tokio::io::split(server);
    let mut reader = BufReader::new(reader);

    loop {
        let mut line = String::new();
        match reader.read_line(&mut line).await {
            Ok(0) => break,
            Ok(_) => {}
            Err(_) => break,
        }

        let response = match serde_json::from_str::<serde_json::Value>(line.trim()) {
            Ok(request) => {
                let command = request
                    .get("command")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or("")
                    .to_string();
                let cwd = request
                    .get("cwd")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or("")
                    .to_string();
                let timeout_ms = request
                    .get("timeoutMs")
                    .and_then(serde_json::Value::as_u64)
                    .unwrap_or(30_000);
                tokio::task::spawn_blocking(move || {
                    execute_command_blocking(&command, &cwd, timeout_ms)
                })
                .await
                .unwrap_or_else(|error| {
                    serde_json::json!({
                        "exitCode": -1,
                        "stdout": "",
                        "stderr": format!("helper thread panic: {error}"),
                        "timedOut": false,
                    })
                })
            }
            Err(error) => serde_json::json!({
                "exitCode": -1,
                "stdout": "",
                "stderr": format!("invalid request: {error}"),
                "timedOut": false,
            }),
        };

        let response_json = match serde_json::to_string(&response) {
            Ok(s) => s,
            Err(_) => continue,
        };
        if writer.write_all(response_json.as_bytes()).await.is_err() {
            break;
        }
        if writer.write_all(b"\n").await.is_err() {
            break;
        }
    }
}

/// Build a `std::process::Command` for the elevated helper using the same
/// shell detection as the agent runtime. On Windows, prefers Git Bash
/// (via `LYRA_GIT_BASH_PATH` env var set by the Electron host), falling back
/// to cmd.exe. This mirrors `shell_kind::build_shell_command` in
/// lyra-agent-runtime but is kept self-contained because lyrad is a separate
/// crate and the shell_kind module is `pub(crate)`.
#[cfg(windows)]
fn build_elevated_shell_command(command: &str, cwd: &str) -> std::process::Command {
    use std::process::Command;

    // Check for Git Bash via the env var that the Electron host sets.
    if let Ok(bash_path) = std::env::var("LYRA_GIT_BASH_PATH") {
        if std::path::Path::new(&bash_path).exists() {
            // Single-quote the command for eval, prepend cd to the POSIX cwd.
            let quoted = format!("'{}'", command.replace('\'', "'\"'\"'"));
            let script = if !cwd.is_empty() {
                let posix_cwd = windows_to_posix_path(cwd);
                let quoted_cwd = format!("'{}'", posix_cwd.replace('\'', "'\"'\"'"));
                format!("cd -- {quoted_cwd} && eval {quoted}")
            } else {
                format!("eval {quoted}")
            };
            let mut cmd = Command::new(&bash_path);
            cmd.args(["-lc", &script]);
            return cmd;
        }
    }

    // Fallback: cmd.exe (previous behavior)
    let mut cmd = Command::new("cmd");
    cmd.args(["/S", "/C", command]);
    if !cwd.is_empty() {
        cmd.current_dir(cwd);
    }
    cmd
}

/// Convert a Windows path to a Git Bash POSIX path (mirrors shell_kind::windows_to_posix).
#[cfg(windows)]
fn windows_to_posix_path(windows_path: &str) -> String {
    if windows_path.starts_with("\\\\") {
        return windows_path.replace('\\', "/");
    }
    let bytes = windows_path.as_bytes();
    if bytes.len() >= 2
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && (bytes.get(2) == Some(&b'\\') || bytes.get(2) == Some(&b'/'))
    {
        let drive = bytes[0].to_ascii_lowercase() as char;
        let rest = &windows_path[2..];
        return format!("/{drive}{}", rest.replace('\\', "/"));
    }
    windows_path.replace('\\', "/")
}

/// Synchronous command execution — redirects stdout/stderr to temp files to
/// avoid pipe-buffer deadlock, then polls `try_wait` with a timeout.
#[cfg(windows)]
fn execute_command_blocking(command: &str, cwd: &str, timeout_ms: u64) -> serde_json::Value {
    use std::io::Read;
    use std::process::{Command, Stdio};
    use std::time::{Duration, Instant};

    static COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

    const MAX_OUTPUT_BYTES: usize = 1_000_000;

    let id = COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let stdout_path = std::env::temp_dir().join(format!("lyra-elev-{id}-out"));
    let stderr_path = std::env::temp_dir().join(format!("lyra-elev-{id}-err"));

    let stdout_file = match std::fs::File::create(&stdout_path) {
        Ok(f) => f,
        Err(e) => {
            return serde_json::json!({
                "exitCode": -1, "stdout": "",
                "stderr": format!("create stdout file: {e}"), "timedOut": false
            });
        }
    };
    let stderr_file = match std::fs::File::create(&stderr_path) {
        Ok(f) => f,
        Err(e) => {
            let _ = std::fs::remove_file(&stdout_path);
            return serde_json::json!({
                "exitCode": -1, "stdout": "",
                "stderr": format!("create stderr file: {e}"), "timedOut": false
            });
        }
    };

    let mut cmd = build_elevated_shell_command(command, cwd);
    cmd.stdin(Stdio::null())
        .stdout(stdout_file)
        .stderr(stderr_file);

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            let _ = std::fs::remove_file(&stdout_path);
            let _ = std::fs::remove_file(&stderr_path);
            return serde_json::json!({
                "exitCode": -1, "stdout": "",
                "stderr": format!("spawn failed: {e}"), "timedOut": false
            });
        }
    };

    let max_ms = timeout_ms.min(120_000);
    let deadline = Instant::now() + Duration::from_millis(max_ms);
    let mut timed_out = false;

    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                let stdout = read_limited(&stdout_path, MAX_OUTPUT_BYTES);
                let stderr = read_limited(&stderr_path, MAX_OUTPUT_BYTES);
                let _ = std::fs::remove_file(&stdout_path);
                let _ = std::fs::remove_file(&stderr_path);
                return serde_json::json!({
                    "exitCode": status.code().unwrap_or(-1),
                    "stdout": stdout,
                    "stderr": stderr,
                    "timedOut": false,
                });
            }
            Ok(None) => {
                if Instant::now() >= deadline {
                    let _ = child.kill();
                    let _ = child.wait();
                    timed_out = true;
                    break;
                }
                std::thread::sleep(Duration::from_millis(20));
            }
            Err(e) => {
                let _ = std::fs::remove_file(&stdout_path);
                let _ = std::fs::remove_file(&stderr_path);
                return serde_json::json!({
                    "exitCode": -1, "stdout": "",
                    "stderr": format!("wait error: {e}"), "timedOut": false
                });
            }
        }
    }

    let stdout = read_limited(&stdout_path, MAX_OUTPUT_BYTES);
    let stderr = read_limited(&stderr_path, MAX_OUTPUT_BYTES);
    let _ = std::fs::remove_file(&stdout_path);
    let _ = std::fs::remove_file(&stderr_path);
    serde_json::json!({
        "exitCode": -1, "stdout": stdout, "stderr": stderr, "timedOut": timed_out
    })
}

#[cfg(windows)]
fn read_limited(path: &std::path::Path, limit: usize) -> String {
    use std::io::Read;
    let mut file = match std::fs::File::open(path) {
        Ok(f) => f,
        Err(_) => return String::new(),
    };
    let mut buf = vec![0u8; limit];
    let n = file.read(&mut buf).unwrap_or(0);
    String::from_utf8_lossy(&buf[..n]).to_string()
}

#[cfg(windows)]
fn ready_file_path(pipe_name: &str) -> std::path::PathBuf {
    let sanitized: String = pipe_name
        .chars()
        .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '_' })
        .collect();
    std::env::temp_dir()
        .join("lyra-elevated")
        .join(format!("{sanitized}.ready"))
}

#[cfg(not(windows))]
pub fn run(_pipe_name: String) -> ! {
    eprintln!("elevated helper is only available on Windows");
    std::process::exit(1);
}
