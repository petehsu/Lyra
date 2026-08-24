use std::io::Write;
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use serde::Deserialize;
use serde_json::json;

use super::types::{OsintCluster, OsintHit, OsintProfile};

const OSINT_TIMEOUT: Duration = Duration::from_secs(120);

/// OSINT 扫描的错误类型 — 调用方据此决定降级策略。
#[derive(Debug)]
pub enum OsintError {
    PythonNotFound,
    BridgeScriptNotFound(String),
    SpawnFailed(String),
    Timeout,
    ParseFailed(String),
    BridgeError(String),
}

/// 运行 OSINT 扫描 — spawn Python 子进程，stdin 写 JSON 命令，stdout 读 JSON 结果。
///
/// `resources_path` 指向 desktop app 的 resources 目录（打包后）或源码 resources/ 目录。
/// 任何失败都返回 `OsintError`，调用方降级为 signals-only persona。
pub fn run_osint_scan(seed: &str, resources_path: &Path) -> Result<OsintProfile, OsintError> {
    let bridge_script = locate_bridge_script(resources_path)?;
    let python_bin = locate_python()?;

    let mut child = Command::new(&python_bin)
        .arg(&bridge_script)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| OsintError::SpawnFailed(e.to_string()))?;

    // 写入扫描命令
    let command = json!({
        "type": "scan",
        "seed": seed,
        "options": {
            "timeout": 10,
            "concurrent": 50,
            "no_nsfw": true,
            "scan_level": "basic"
        }
    });

    if let Some(ref mut stdin) = child.stdin {
        serde_json::to_writer(&mut *stdin, &command)
            .map_err(|e| OsintError::SpawnFailed(format!("stdin write failed: {e}")))?;
        stdin
            .write_all(b"\n")
            .map_err(|e| OsintError::SpawnFailed(format!("stdin newline failed: {e}")))?;
    }
    // drop stdin to signal EOF
    drop(child.stdin.take());

    // 带超时等待
    let start = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                let output = child
                    .wait_with_output()
                    .map_err(|e| OsintError::ParseFailed(format!("read output failed: {e}")))?;

                if !status.success() {
                    let stderr = String::from_utf8_lossy(&output.stderr);
                    return Err(OsintError::BridgeError(stderr.to_string()));
                }

                let stdout = String::from_utf8_lossy(&output.stdout);
                return parse_bridge_output(&stdout, seed);
            }
            Ok(None) => {
                if start.elapsed() >= OSINT_TIMEOUT {
                    let _ = child.kill();
                    return Err(OsintError::Timeout);
                }
                std::thread::sleep(Duration::from_millis(200));
            }
            Err(e) => {
                return Err(OsintError::SpawnFailed(format!("wait failed: {e}")));
            }
        }
    }
}

/// 定位 Python 解释器 — 优先 python3，fallback 到 python。
fn locate_python() -> Result<String, OsintError> {
    for candidate in ["python3", "python"] {
        if Command::new(candidate)
            .arg("--version")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .is_ok()
        {
            return Ok(candidate.to_string());
        }
    }
    Err(OsintError::PythonNotFound)
}

/// 定位 bridge script — resources_path/osint/lyra_osint_bridge.py
fn locate_bridge_script(resources_path: &Path) -> Result<String, OsintError> {
    let script = resources_path.join("osint").join("lyra_osint_bridge.py");
    if !script.exists() {
        // 也尝试 dev 模式: resources/osint/lyra_osint_bridge.py
        let dev_script = resources_path.join("lyra_osint_bridge.py");
        if dev_script.exists() {
            return Ok(dev_script.to_string_lossy().to_string());
        }
        return Err(OsintError::BridgeScriptNotFound(
            script.to_string_lossy().to_string(),
        ));
    }
    Ok(script.to_string_lossy().to_string())
}

/// 解析 Python bridge 的 JSON 输出为 OsintProfile。
fn parse_bridge_output(stdout: &str, seed: &str) -> Result<OsintProfile, OsintError> {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct BridgeOutput {
        #[serde(default)]
        profiles: Vec<BridgeHit>,
        #[serde(default)]
        correlations: Vec<BridgeCluster>,
        #[serde(default)]
        expanded_usernames: Vec<String>,
        #[serde(default)]
        errors: Vec<String>,
        #[serde(default)]
        scan_incomplete: bool,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct BridgeHit {
        site: String,
        url: String,
        status: String,
        #[serde(default)]
        confidence: u8,
        #[serde(default)]
        profile_name: Option<String>,
        #[serde(default)]
        profile_bio: Option<String>,
        #[serde(default)]
        profile_avatar: Option<String>,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct BridgeCluster {
        size: usize,
        #[serde(default)]
        reasons: Vec<String>,
        #[serde(default)]
        members: Vec<BridgeClusterMember>,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct BridgeClusterMember {
        site: String,
        username: String,
        url: String,
        #[serde(default)]
        name: Option<String>,
        #[serde(default)]
        bio: Option<String>,
    }

    // Python bridge 可能输出非 JSON 的 stderr 混合，取最后一行 JSON
    let json_line = stdout
        .lines()
        .rev()
        .find(|line| line.trim_start().starts_with('{'))
        .unwrap_or(stdout.trim());

    let parsed: BridgeOutput = serde_json::from_str(json_line)
        .map_err(|e| OsintError::ParseFailed(format!("JSON parse failed: {e}")))?;

    let hits = parsed
        .profiles
        .into_iter()
        .map(|h| OsintHit {
            site: h.site,
            url: h.url,
            status: h.status,
            confidence: h.confidence,
            profile_name: h.profile_name.filter(|s| !s.is_empty()),
            profile_bio: h.profile_bio.filter(|s| !s.is_empty()),
            profile_avatar: h.profile_avatar.filter(|s| !s.is_empty()),
        })
        .collect();

    let correlations = parsed
        .correlations
        .into_iter()
        .map(|c| OsintCluster {
            size: c.size,
            reasons: c.reasons,
            members: c
                .members
                .into_iter()
                .map(|m| super::types::ClusterMember {
                    site: m.site,
                    username: m.username,
                    url: m.url,
                    name: m.name.filter(|s| !s.is_empty()),
                    bio: m.bio.filter(|s| !s.is_empty()),
                })
                .collect(),
        })
        .collect();

    Ok(OsintProfile {
        seed: seed.to_string(),
        hits,
        correlations,
        expanded_usernames: parsed.expanded_usernames,
        scan_timestamp: chrono::Utc::now().to_rfc3339(),
        scan_incomplete: parsed.scan_incomplete,
    })
}
