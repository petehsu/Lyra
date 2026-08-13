use super::*;

use std::sync::Mutex as StdMutex;

// --- Unix: in-memory sudo password ---
// 进程内明文密码，不入 prompt context、不入任何持久化文件。
// 进程重启后丢失，需 Electron 侧从 safeStorage 重新 resolve 后通过 IPC 注入。
static ELEVATION_SECRET: OnceLock<StdMutex<Option<String>>> = OnceLock::new();

fn lock() -> &'static StdMutex<Option<String>> {
    ELEVATION_SECRET.get_or_init(|| StdMutex::new(None))
}

// --- Windows: elevated helper pipe name ---
// When the user enables full-auto mode on Windows, the agent runtime starts
// a UAC-elevated helper process (lyrad --elevated-helper) that listens on a
// named pipe.  Commands needing elevation are sent to this pipe instead of
// using sudo.  The pipe name persists in process memory for the app lifetime.
#[cfg(target_os = "windows")]
static ELEVATED_PIPE_NAME: OnceLock<StdMutex<Option<String>>> = OnceLock::new();

#[cfg(target_os = "windows")]
fn pipe_lock() -> &'static StdMutex<Option<String>> {
    ELEVATED_PIPE_NAME.get_or_init(|| StdMutex::new(None))
}

/// 供 shell.rs 调用：取当前 in-memory 提权密码明文 (Unix)。
#[cfg(not(target_os = "windows"))]
pub(crate) fn elevation_secret() -> Option<String> {
    lock().lock().ok().and_then(|guard| guard.clone())
}

/// Windows 不使用密码提权，返回 None。
#[cfg(target_os = "windows")]
pub(crate) fn elevation_secret() -> Option<String> {
    None
}

/// 供 shell.rs Windows 分支调用：取 elevated helper 的 named pipe 名称。
#[cfg(target_os = "windows")]
pub(crate) fn elevated_pipe_name() -> Option<String> {
    pipe_lock().lock().ok().and_then(|guard| guard.clone())
}

/// 供 context.rs 调用：判断是否有提权凭据可用（不暴露明文）。
pub(crate) fn has_elevation_secret() -> bool {
    #[cfg(not(target_os = "windows"))]
    {
        lock().lock().is_ok_and(|guard| guard.is_some())
    }
    #[cfg(target_os = "windows")]
    {
        pipe_lock().lock().is_ok_and(|guard| guard.is_some())
    }
}

/// IPC: agent.elevation.setSecret — 存储明文密码到进程内存 (Unix)。
/// Windows 上为 no-op — 提权通过 UAC helper 进程实现，不存储密码。
pub(crate) fn set_elevation_secret(payload: Value) -> AgentRuntimeResult<Value> {
    #[cfg(not(target_os = "windows"))]
    {
        let secret = payload
            .get("secret")
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| AgentRuntimeError::Core("secret is required".to_string()))?;
        let mut guard = lock()
            .lock()
            .map_err(|_| AgentRuntimeError::Core("elevation secret lock failed".to_string()))?;
        *guard = Some(secret.to_string());
        Ok(json!({ "stored": true }))
    }
    #[cfg(target_os = "windows")]
    {
        // Windows: no password to store. The pipe name is set by validate_sudo_password.
        Ok(json!({ "stored": true }))
    }
}

/// IPC: agent.elevation.clear — 清除进程内提权凭据。
pub(crate) fn clear_elevation_secret() -> AgentRuntimeResult<Value> {
    #[cfg(not(target_os = "windows"))]
    {
        let mut guard = lock()
            .lock()
            .map_err(|_| AgentRuntimeError::Core("elevation secret lock failed".to_string()))?;
        *guard = None;
    }
    #[cfg(target_os = "windows")]
    {
        let mut guard = pipe_lock()
            .lock()
            .map_err(|_| AgentRuntimeError::Core("elevation pipe lock failed".to_string()))?;
        *guard = None;
    }
    Ok(json!({ "cleared": true }))
}

/// IPC: agent.elevation.validate — 校验提权是否可用。
/// Unix: 运行 `sudo -S -k true`，通过 stdin 传入密码，检查退出码。
/// Windows: 启动 UAC elevated helper 进程，等待 ready 文件确认启动成功。
pub(crate) fn validate_sudo_password(payload: Value) -> AgentRuntimeResult<Value> {
    let password = payload
        .get("password")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| AgentRuntimeError::Core("password is required".to_string()))?;

    // Windows: 启动 UAC elevated helper（password 仅用于校验非空，实际值不使用）
    #[cfg(target_os = "windows")]
    {
        let _ = password;
        return validate_windows_elevation();
    }

    // Unix: sudo -S 密码校验
    #[cfg(not(target_os = "windows"))]
    {
        use std::io::Write;
        let mut child = Command::new("sudo")
            .args(["-S", "-k", "true"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|error| {
                AgentRuntimeError::Core(format!("failed to spawn sudo for validation: {error}"))
            })?;

        if let Some(mut stdin) = child.stdin.take() {
            let _ = stdin.write_all(format!("{password}\n").as_bytes());
        }

        let output = child.wait_with_output().map_err(|error| {
            AgentRuntimeError::Core(format!("failed to wait for sudo: {error}"))
        })?;

        let valid = output.status.success();
        Ok(json!({
            "valid": valid,
            "exitCode": output.status.code(),
            "stderr": String::from_utf8_lossy(&output.stderr).trim().to_string(),
        }))
    }
}

/// Windows: 通过 PowerShell Start-Process -Verb RunAs 启动 elevated helper。
/// 用户点击 UAC "是" → helper 启动并监听 named pipe → 写 ready 文件。
/// 用户点击 UAC "否" → PowerShell 报错 → 返回 valid:false。
#[cfg(target_os = "windows")]
fn validate_windows_elevation() -> AgentRuntimeResult<Value> {
    // 如果 helper 已在运行，直接返回成功
    if pipe_lock().lock().is_ok_and(|guard| guard.is_some()) {
        return Ok(json!({ "valid": true, "reason": "elevated helper already running" }));
    }

    let pipe_name = format!(r"\\.\pipe\lyra-elevated-{}", Uuid::new_v4());
    let exe_path = std::env::current_exe()
        .map_err(|error| AgentRuntimeError::Core(format!("failed to get current exe: {error}")))?;
    let parent_pid = std::process::id();

    // 使用 PowerShell Start-Process -Verb RunAs 触发 UAC
    let ps_command = format!(
        "try {{ Start-Process -FilePath '{}' -ArgumentList '--elevated-helper','--socket','{}','--parent-pid','{}' -Verb RunAs -ErrorAction Stop; Write-Output 'OK' }} catch {{ Write-Output $_.Exception.Message; exit 1 }}",
        exe_path.display(),
        pipe_name,
        parent_pid
    );

    let output = Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", &ps_command])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|error| {
            AgentRuntimeError::Core(format!("failed to start elevated helper: {error}"))
        })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stdout).trim().to_string();
        return Ok(json!({
            "valid": false,
            "reason": format!("UAC declined: {stderr}"),
        }));
    }

    // 等待 ready 文件（helper 启动后写入）
    let ready_path = ready_file_path(&pipe_name);
    let deadline = Instant::now() + Duration::from_secs(30);
    loop {
        if ready_path.exists() {
            break;
        }
        if Instant::now() >= deadline {
            return Ok(json!({
                "valid": false,
                "reason": "elevated helper did not start within 30 seconds",
            }));
        }
        std::thread::sleep(Duration::from_millis(100));
    }

    // 存储 pipe name 到进程内存
    let mut guard = pipe_lock()
        .lock()
        .map_err(|_| AgentRuntimeError::Core("elevation pipe lock failed".to_string()))?;
    *guard = Some(pipe_name);

    Ok(json!({ "valid": true }))
}

#[cfg(target_os = "windows")]
fn ready_file_path(pipe_name: &str) -> std::path::PathBuf {
    let sanitized: String = pipe_name
        .chars()
        .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '_' })
        .collect();
    std::env::temp_dir()
        .join("lyra-elevated")
        .join(format!("{sanitized}.ready"))
}

/// 生成注入 prompt context 的 elevation 区块（只含 ref 元数据，不含明文）。
/// 系统感知：根据 OS 类型生成不同的自然语言描述。
pub(crate) fn elevation_context_block() -> Value {
    if !has_elevation_secret() {
        return Value::Null;
    }

    let os_label = if cfg!(target_os = "macos") {
        "macOS"
    } else if cfg!(target_os = "linux") {
        "Linux"
    } else if cfg!(target_os = "windows") {
        "Windows"
    } else {
        "this system"
    };

    #[cfg(target_os = "windows")]
    {
        json!({
            "available": true,
            "kind": "lyra-sensitive-value-ref",
            "modelVisibility": "metadata_only",
            "plaintextVisibility": "host_resolved_only",
            "description": format!(
                "Your {os_label} elevated helper is running. When a command needs elevation, it is executed automatically through the elevated helper — u don't need to type any password."
            ),
            "rule": "No elevation password is stored on Windows. The elevated helper process handles privileged commands host-side only."
        })
    }
    #[cfg(not(target_os = "windows"))]
    {
        json!({
            "available": true,
            "kind": "lyra-sensitive-value-ref",
            "modelVisibility": "metadata_only",
            "plaintextVisibility": "host_resolved_only",
            "description": format!(
                "Your {os_label} sudo password is available. When a command needs elevation, it will be provided automatically — u don't need to type or reference the password urself."
            ),
            "rule": "Never attempt to reveal, print, or store the elevation password. It is resolved host-side only."
        })
    }
}
