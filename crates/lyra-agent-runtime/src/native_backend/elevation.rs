use super::*;

use std::sync::Mutex as StdMutex;

// ponytail: 进程内明文密码，不入 prompt context、不入任何持久化文件。
// 进程重启后丢失，需 Electron 侧从 safeStorage 重新 resolve 后通过 IPC 注入。
// 升级路径：如需跨进程持久化，改用 OS keychain crate（keyring-rs），但当前 in-memory 已满足需求。
static ELEVATION_SECRET: OnceLock<StdMutex<Option<String>>> = OnceLock::new();

fn lock() -> &'static StdMutex<Option<String>> {
    ELEVATION_SECRET.get_or_init(|| StdMutex::new(None))
}

/// 供 shell.rs 调用：取当前 in-memory 提权密码明文。
pub(crate) fn elevation_secret() -> Option<String> {
    lock().lock().ok().and_then(|guard| guard.clone())
}

/// 供 context.rs 调用：判断是否有提权密码可用（不暴露明文）。
pub(crate) fn has_elevation_secret() -> bool {
    lock().lock().is_ok_and(|guard| guard.is_some())
}

/// IPC: agent.elevation.setSecret — 存储明文密码到进程内存。
pub(crate) fn set_elevation_secret(payload: Value) -> AgentRuntimeResult<Value> {
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

/// IPC: agent.elevation.clear — 清除进程内明文密码。
pub(crate) fn clear_elevation_secret() -> AgentRuntimeResult<Value> {
    let mut guard = lock()
        .lock()
        .map_err(|_| AgentRuntimeError::Core("elevation secret lock failed".to_string()))?;
    *guard = None;
    Ok(json!({ "cleared": true }))
}

/// IPC: agent.elevation.validate — 校验密码是否正确（不存储）。
/// 运行 `sudo -S -k true`，通过 stdin 传入密码，检查退出码。
pub(crate) fn validate_sudo_password(payload: Value) -> AgentRuntimeResult<Value> {
    let password = payload
        .get("password")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| AgentRuntimeError::Core("password is required".to_string()))?;

    // Windows 没有 sudo，直接返回 unsupported
    if cfg!(target_os = "windows") {
        return Ok(json!({ "valid": false, "reason": "sudo is not available on Windows" }));
    }

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

    // 通过 stdin 传入密码 — 不出现在进程参数中
    if let Some(mut stdin) = child.stdin.take() {
        let _ = stdin.write_all(format!("{password}\n").as_bytes());
        // stdin drop 触发 EOF
    }

    let output = child
        .wait_with_output()
        .map_err(|error| AgentRuntimeError::Core(format!("failed to wait for sudo: {error}")))?;

    let valid = output.status.success();
    Ok(json!({
        "valid": valid,
        "exitCode": output.status.code(),
        // stderr 可能含诊断信息（如 "Sorry, try again."），但不含密码
        "stderr": String::from_utf8_lossy(&output.stderr).trim().to_string(),
    }))
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
