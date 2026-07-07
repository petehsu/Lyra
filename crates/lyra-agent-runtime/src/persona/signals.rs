use std::fs;
use std::path::PathBuf;
use std::process::Command;

use super::types::SignalBundle;

/// Desktop-only 信号 — 由 Electron 主进程采集后传入 runtime。
///
/// 这些信号在 Rust 侧无法获取（需要 Chromium API / macOS Framework），
/// 由 `host-persona-context.ts` 采集后通过 host capability 传递。
#[derive(Clone, Debug, Default)]
pub struct DesktopSignals {
    pub browser_autofill_names: Vec<String>,
    pub browser_autofill_emails: Vec<String>,
    pub macos_contacts_name: Option<String>,
    pub macos_contacts_email: Option<String>,
    pub login_manager_hints: Vec<String>,
    pub lyra_config_email: Option<String>,
}

/// 采集本地身份信号 — 纯本地操作，无网络请求。
///
/// 所有信号采集都是 best-effort：任何一步失败都不会阻止其他信号的采集。
/// `desktop` 参数提供 Rust 侧无法获取的信号（浏览器自动填充、系统通讯录）。
pub fn collect_local_signals(desktop: DesktopSignals) -> SignalBundle {
    let os_username = read_os_username();
    let os_full_name = os_username.as_deref().and_then(read_os_full_name);
    let hostname = read_hostname();
    let (git_name, git_email, git_github_user) = read_git_global_config();
    let git_dominant_email = read_git_dominant_email();
    let git_remote_usernames = read_git_remote_usernames();
    let ssh_key_comments = read_ssh_key_comments();
    let ssh_known_hosts = read_ssh_known_hosts();
    let npm_email = read_npmrc_email();
    let pip_email = read_pypirc_email();
    let vscode_sync_email = read_vscode_settings_email();

    // ── 年龄推断信号 ──
    let home_dir_birthtime = read_home_dir_birthtime();
    let git_first_commit_date = read_git_first_commit_date();

    SignalBundle {
        os_username,
        os_full_name,
        hostname,
        git_name,
        git_email,
        git_dominant_email,
        git_github_user,
        git_remote_usernames,
        ssh_key_comments,
        ssh_known_hosts,
        npm_email,
        pip_email,
        vscode_sync_email,
        browser_autofill_names: desktop.browser_autofill_names,
        browser_autofill_emails: desktop.browser_autofill_emails,
        macos_contacts_name: desktop.macos_contacts_name,
        macos_contacts_email: desktop.macos_contacts_email,
        lyra_config_email: desktop.lyra_config_email,
        login_manager_hints: desktop.login_manager_hints,
        home_dir_birthtime,
        git_first_commit_date,
    }
}

// ── OS 层 ──

fn read_os_username() -> Option<String> {
    std::env::var("USER")
        .or_else(|_| std::env::var("USERNAME"))
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

/// macOS: `dscl . -read /Users/<username> RealName`
/// Linux: `getent passwd <username>` → 解析 GECOS 第 5 字段
fn read_os_full_name(username: &str) -> Option<String> {
    if cfg!(target_os = "macos") {
        let output = Command::new("dscl")
            .args([".", "-read", &format!("/Users/{username}"), "RealName"])
            .output()
            .ok()?;
        if !output.status.success() {
            return None;
        }
        let text = String::from_utf8_lossy(&output.stdout);
        text.lines()
            .flat_map(|line| {
                let trimmed = line.trim();
                if let Some(rest) = trimmed.strip_prefix("RealName:") {
                    let val = rest.trim();
                    if !val.is_empty() {
                        return Some(val.to_string());
                    }
                }
                if trimmed == "RealName:" {
                    return None;
                }
                if !trimmed.is_empty() && !trimmed.contains(':') {
                    return Some(trimmed.to_string());
                }
                None
            })
            .next()
            .filter(|s| !s.is_empty())
    } else if cfg!(target_os = "linux") {
        let output = Command::new("getent")
            .args(["passwd", username])
            .output()
            .ok()?;
        if !output.status.success() {
            return None;
        }
        let text = String::from_utf8_lossy(&output.stdout);
        text.lines()
            .next()
            .and_then(|line| line.split(':').nth(4))
            .map(|gecos| gecos.split(',').next().unwrap_or("").trim().to_string())
            .filter(|s| !s.is_empty())
    } else {
        None
    }
}

fn read_hostname() -> Option<String> {
    Command::new("hostname")
        .output()
        .ok()
        .filter(|o| o.status.success())
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

// ── Git 层 ──

/// 读取 `git config --global` 的 user.name, user.email, github.user。
fn read_git_global_config() -> (Option<String>, Option<String>, Option<String>) {
    let read = |key: &str| -> Option<String> {
        Command::new("git")
            .args(["config", "--global", key])
            .output()
            .ok()
            .filter(|o| o.status.success())
            .and_then(|o| String::from_utf8(o.stdout).ok())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
    };
    (read("user.name"), read("user.email"), read("github.user"))
}

/// 从当前目录的 git commit history 聚合最频繁的 author email。
fn read_git_dominant_email() -> Option<String> {
    let output = Command::new("git")
        .args(["log", "--format=%ae", "--all", "-n", "500"])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout);
    let mut counts: std::collections::HashMap<&str, usize> = std::collections::HashMap::new();
    for line in text.lines() {
        let email = line.trim();
        if !email.is_empty() && email.contains('@') {
            *counts.entry(email).or_insert(0) += 1;
        }
    }
    counts
        .into_iter()
        .max_by_key(|(_, c)| *c)
        .map(|(e, _)| e.to_string())
}

/// 从 `git remote -v` 提取 GitHub/GitLab 用户名。
/// 支持 `git@github.com:username/repo.git` 和 `https://github.com/username/repo.git` 格式。
fn read_git_remote_usernames() -> Vec<String> {
    let output = match Command::new("git")
        .args(["remote", "-v"])
        .output()
    {
        Ok(o) if o.status.success() => o,
        _ => return Vec::new(),
    };
    let text = String::from_utf8_lossy(&output.stdout);
    let mut usernames = Vec::new();

    for line in text.lines() {
        // 格式: origin\tgit@github.com:username/repo.git (fetch)
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() < 2 {
            continue;
        }
        let url = parts[1];
        if let Some(name) = extract_username_from_git_url(url) {
            if !usernames.contains(&name) {
                usernames.push(name);
            }
        }
    }
    usernames
}

/// 从 git remote URL 提取用户名。
/// `git@host:username/repo.git` → `username`
/// `https://host/username/repo.git` → `username`
/// `ssh://git@host:port/username/repo.git` → `username`
fn extract_username_from_git_url(url: &str) -> Option<String> {
    let url = url.trim();

    // SCP-like: git@github.com:username/repo.git
    if let Some(colon_pos) = url.rfind(':') {
        let after_colon = &url[colon_pos + 1..];
        if let Some(slash_pos) = after_colon.find('/') {
            let username = &after_colon[..slash_pos];
            if is_valid_username(username) {
                return Some(username.to_string());
            }
        }
    }

    // URL-like: https://github.com/username/repo.git or ssh://git@host:port/username/repo.git
    if let Some(rest) = url
        .strip_prefix("https://")
        .or_else(|| url.strip_prefix("http://"))
        .or_else(|| url.strip_prefix("ssh://"))
        .or_else(|| url.strip_prefix("git://"))
    {
        // 去掉 host[:port] 部分
        let path = rest.split('/').skip(1).collect::<Vec<_>>().join("/");
        if let Some(first) = path.split('/').next() {
            if is_valid_username(first) {
                return Some(first.to_string());
            }
        }
    }

    None
}

fn is_valid_username(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 39
        && !s.contains(' ')
        && !s.contains(':')
        && !s.ends_with(".git")
}

// ── SSH 层 ──

/// 读取 `~/.ssh/*.pub` 文件，解析 comment field。
fn read_ssh_key_comments() -> Vec<String> {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    let ssh_dir = home.join(".ssh");
    let mut comments = Vec::new();

    let entries = match fs::read_dir(&ssh_dir) {
        Ok(e) => e,
        Err(_) => return comments,
    };

    for entry in entries.flatten() {
        let path = entry.path();
        let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
        if !name.ends_with(".pub") {
            continue;
        }
        if let Ok(content) = fs::read_to_string(&path) {
            let parts: Vec<&str> = content.trim().splitn(3, ' ').collect();
            if parts.len() >= 3 {
                let comment = parts[2].trim();
                if !comment.is_empty() && !comment.contains('\n') {
                    comments.push(comment.to_string());
                }
            }
        }
    }
    comments
}

/// 读取 `~/.ssh/known_hosts`，提取主机名。
/// ponytail: 只取 hostname 做归属推断，不做 key 验证。
fn read_ssh_known_hosts() -> Vec<String> {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    let path = home.join(".ssh").join("known_hosts");
    let content = match fs::read_to_string(&path) {
        Ok(c) => c,
        Err(_) => return Vec::new(),
    };

    let mut hosts = Vec::new();
    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        // 格式: hostname[,hostname2] ssh-rsa AAAA...
        // 或: [hostname]:port ssh-rsa AAAA...
        let first_field = line.split_whitespace().next().unwrap_or("");
        // 取第一个逗号前的主机名
        let host = first_field.split(',').next().unwrap_or("");
        // 去掉 [host]:port 的方括号
        let host = host.trim_start_matches('[').trim_end_matches(']');
        // 去掉 :port
        let host = host.rsplit_once(':').map(|(h, _)| h).unwrap_or(host);
        if !host.is_empty() && !hosts.contains(&host.to_string()) {
            hosts.push(host.to_string());
        }
    }
    hosts
}

// ── 包管理器层 ──

/// `~/.npmrc` 中 `email =` 行。
fn read_npmrc_email() -> Option<String> {
    let home = dirs::home_dir()?;
    let path = home.join(".npmrc");
    let content = fs::read_to_string(&path).ok()?;
    for line in content.lines() {
        let trimmed = line.trim();
        if let Some(rest) = trimmed.strip_prefix("email") {
            let rest = rest.trim_start();
            if let Some(val) = rest.strip_prefix('=') {
                let val = val.trim().trim_matches(|c| c == '"' || c == '\'');
                if val.contains('@') && !val.is_empty() {
                    return Some(val.to_string());
                }
            }
        }
    }
    None
}

/// `~/.pypirc` 中 `email =` 行（可能在不同 section 下）。
fn read_pypirc_email() -> Option<String> {
    let home = dirs::home_dir()?;
    let path = home.join(".pypirc");
    let content = fs::read_to_string(&path).ok()?;
    for line in content.lines() {
        let trimmed = line.trim();
        if let Some(val) = trimmed
            .strip_prefix("email")
            .and_then(|r| r.trim_start().strip_prefix('='))
            .map(|v| v.trim().trim_matches(|c| c == '"' || c == '\''))
        {
            if val.contains('@') && !val.is_empty() {
                return Some(val.to_string());
            }
        }
    }
    None
}

// ── 编辑器层 ──

/// VS Code / Cursor 的 settings.json — 扫描 email 模式。
/// ponytail: settings.json 通常不含 email，但某些扩展（GitLens 等）可能写入。
/// 只做 best-effort regex扫描，不做完整 JSON 解析。
fn read_vscode_settings_email() -> Option<String> {
    let home = dirs::home_dir()?;
    let candidates = if cfg!(target_os = "macos") {
        vec![
            home.join("Library/Application Support/Code/User/settings.json"),
            home.join("Library/Application Support/Cursor/User/settings.json"),
        ]
    } else {
        vec![
            home.join(".config/Code/User/settings.json"),
            home.join(".config/Cursor/User/settings.json"),
        ]
    };

    for path in candidates {
        if let Ok(content) = fs::read_to_string(&path) {
            if let Some(email) = scan_for_email(&content) {
                return Some(email);
            }
        }
    }
    None
}

/// 简单 email 正则扫描 — 从任意文本中提取第一个 email 地址。
fn scan_for_email(text: &str) -> Option<String> {
    let re = regex::Regex::new(r"[\w.+-]+@[\w.-]+\.\w+").ok()?;
    re.find(text).map(|m| m.as_str().to_string())
}

// ── 年龄推断信号层 ──

/// 家目录创建时间 (epoch seconds)。
/// macOS: `stat -f "%B" ~`  (birthtime)
/// Linux: `stat -c %Y ~`    (mtime fallback — Linux birthtime 需 stat -c %W 但常为 0)
fn read_home_dir_birthtime() -> Option<i64> {
    let home = dirs::home_dir()?;
    if cfg!(target_os = "macos") {
        let output = Command::new("stat")
            .args(["-f", "%B", home.to_str()?])
            .output()
            .ok()?;
        if !output.status.success() {
            return None;
        }
        String::from_utf8_lossy(&output.stdout)
            .trim()
            .parse::<i64>()
            .ok()
            .filter(|&t| t > 0)
    } else if cfg!(target_os = "linux") {
        // ponytail: Linux birthtime (%W) 常为 0（内核不一定记录），用 mtime (%Y) 做 fallback。
        let output = Command::new("stat")
            .args(["-c", "%Y", home.to_str()?])
            .output()
            .ok()?;
        if !output.status.success() {
            return None;
        }
        String::from_utf8_lossy(&output.stdout)
            .trim()
            .parse::<i64>()
            .ok()
            .filter(|&t| t > 0)
    } else {
        None
    }
}

/// 首次 git commit 日期 (ISO8601) — 最早的 author date。
fn read_git_first_commit_date() -> Option<String> {
    let output = Command::new("git")
        .args(["log", "--format=%aI", "--all", "--reverse"])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .next()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}