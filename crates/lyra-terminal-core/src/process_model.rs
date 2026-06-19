use crate::signals::TerminalSignal;
use chrono::{SecondsFormat, Utc};
use serde::Serialize;
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};
use std::process::Command;

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessInfo {
    pub pid: u32,
    pub parent_pid: Option<u32>,
    pub process_group_id: Option<u32>,
    pub name: String,
    pub command: Option<String>,
    pub status: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessTreeSnapshot {
    pub captured_at: String,
    pub root_pid: Option<u32>,
    pub foreground_pid: Option<u32>,
    pub running: bool,
    pub limited: bool,
    pub limited_reason: Option<String>,
    pub process_count: u32,
    pub processes: Vec<ProcessInfo>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandProcessLink {
    pub command_id: String,
    pub process_ids: Vec<u32>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalProcessModel {
    pub session_id: String,
    pub pid: Option<u32>,
    pub foreground_pid: Option<u32>,
    pub running: bool,
    pub exit_code: Option<i32>,
    pub signal: Option<String>,
    pub limited: bool,
    pub limited_reason: Option<String>,
    pub command_links: Vec<CommandProcessLink>,
    pub last_snapshot: Option<ProcessTreeSnapshot>,
}

impl TerminalProcessModel {
    pub fn new(session_id: impl Into<String>, pid: Option<u32>) -> Self {
        Self {
            session_id: session_id.into(),
            pid,
            foreground_pid: None,
            running: pid.is_some(),
            exit_code: None,
            signal: None,
            limited: pid.is_none(),
            limited_reason: if pid.is_none() {
                Some("pty child pid unavailable".to_string())
            } else {
                None
            },
            command_links: Vec::new(),
            last_snapshot: None,
        }
    }

    pub fn mark_foreground_pid(&mut self, foreground_pid: Option<u32>) {
        self.foreground_pid = foreground_pid;
    }

    pub fn mark_remote_limited(&mut self, reason: impl Into<String>) {
        self.limited = true;
        self.limited_reason = Some(reason.into());
    }

    pub fn link_command_processes(&mut self, command_id: impl Into<String>, process_ids: Vec<u32>) {
        let command_id = command_id.into();
        let mut deduped = BTreeSet::new();
        for pid in process_ids {
            deduped.insert(pid);
        }
        if let Some(existing) = self
            .command_links
            .iter_mut()
            .find(|link| link.command_id == command_id)
        {
            existing.process_ids = deduped.into_iter().collect();
            return;
        }
        self.command_links.push(CommandProcessLink {
            command_id,
            process_ids: deduped.into_iter().collect(),
        });
    }

    pub fn record_signal(&mut self, signal: &TerminalSignal) {
        self.signal = Some(signal.name.clone());
    }

    pub fn mark_exit(&mut self, exit_code: Option<i32>, signal: Option<String>) {
        self.running = false;
        self.exit_code = exit_code;
        if signal.is_some() {
            self.signal = signal;
        }
    }

    pub fn refresh_snapshot(&mut self) -> ProcessTreeSnapshot {
        let snapshot = snapshot_process_tree(self.pid, self.foreground_pid);
        self.limited = snapshot.limited;
        self.limited_reason = snapshot.limited_reason.clone();
        self.last_snapshot = Some(snapshot.clone());
        snapshot
    }
}

pub fn snapshot_process_tree(
    root_pid: Option<u32>,
    foreground_pid: Option<u32>,
) -> ProcessTreeSnapshot {
    let Some(root_pid) = root_pid else {
        return limited_snapshot(root_pid, foreground_pid, "pty child pid unavailable");
    };
    if cfg!(windows) {
        return snapshot_windows_process_tree(root_pid, foreground_pid);
    }
    let output = Command::new("ps")
        .args(["-axo", "pid=,ppid=,pgid=,stat=,comm="])
        .output();
    let Ok(output) = output else {
        return limited_snapshot(root_pid.into(), foreground_pid, "ps command failed");
    };
    if !output.status.success() {
        return limited_snapshot(root_pid.into(), foreground_pid, "ps command failed");
    }
    let ps_text = String::from_utf8_lossy(&output.stdout);
    snapshot_from_ps(root_pid, foreground_pid, &ps_text)
}

pub fn snapshot_from_ps(
    root_pid: u32,
    foreground_pid: Option<u32>,
    ps_output: &str,
) -> ProcessTreeSnapshot {
    snapshot_from_process_list(root_pid, foreground_pid, parse_ps_output(ps_output))
}

pub fn snapshot_from_windows_process_json(
    root_pid: u32,
    foreground_pid: Option<u32>,
    process_json: &str,
) -> ProcessTreeSnapshot {
    let Ok(value) = serde_json::from_str::<Value>(process_json) else {
        return limited_snapshot(
            root_pid.into(),
            foreground_pid,
            "windows process json parse failed",
        );
    };
    let values = match value {
        Value::Array(items) => items,
        item @ Value::Object(_) => vec![item],
        _ => {
            return limited_snapshot(
                root_pid.into(),
                foreground_pid,
                "windows process json has unsupported shape",
            );
        }
    };
    let processes = values
        .iter()
        .filter_map(process_info_from_windows_value)
        .collect::<Vec<_>>();
    snapshot_from_process_list(root_pid, foreground_pid, processes)
}

fn snapshot_from_process_list(
    root_pid: u32,
    foreground_pid: Option<u32>,
    all: Vec<ProcessInfo>,
) -> ProcessTreeSnapshot {
    let mut children_by_parent = BTreeMap::<u32, Vec<u32>>::new();
    let mut process_by_pid = BTreeMap::<u32, ProcessInfo>::new();
    for process in all {
        if let Some(parent_pid) = process.parent_pid {
            children_by_parent
                .entry(parent_pid)
                .or_default()
                .push(process.pid);
        }
        process_by_pid.insert(process.pid, process);
    }

    let mut selected = BTreeSet::<u32>::new();
    let mut stack = vec![root_pid];
    while let Some(pid) = stack.pop() {
        if !selected.insert(pid) {
            continue;
        }
        if let Some(children) = children_by_parent.get(&pid) {
            stack.extend(children.iter().copied());
        }
    }

    let mut processes = selected
        .into_iter()
        .filter_map(|pid| process_by_pid.get(&pid).cloned())
        .collect::<Vec<_>>();
    processes.sort_by_key(|process| process.pid);
    let limited = processes.is_empty();

    ProcessTreeSnapshot {
        captured_at: now_iso(),
        root_pid: Some(root_pid),
        foreground_pid,
        running: processes
            .iter()
            .any(|process| process.pid == root_pid && process.status != "zombie"),
        limited,
        limited_reason: if limited {
            Some("root process not found in local process table".to_string())
        } else {
            None
        },
        process_count: processes.len().min(u32::MAX as usize) as u32,
        processes,
    }
}

fn snapshot_windows_process_tree(
    root_pid: u32,
    foreground_pid: Option<u32>,
) -> ProcessTreeSnapshot {
    let script = "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine | ConvertTo-Json -Compress";
    for program in ["powershell.exe", "pwsh.exe"] {
        let output = Command::new(program)
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-ExecutionPolicy",
                "Bypass",
                "-Command",
                script,
            ])
            .output();
        let Ok(output) = output else {
            continue;
        };
        if !output.status.success() {
            continue;
        }
        let text = String::from_utf8_lossy(&output.stdout);
        return snapshot_from_windows_process_json(root_pid, foreground_pid, &text);
    }
    limited_snapshot(
        Some(root_pid),
        foreground_pid,
        "windows process query command failed",
    )
}

fn value_u32(value: &Value, keys: &[&str]) -> Option<u32> {
    for key in keys {
        let Some(raw) = value.get(*key) else {
            continue;
        };
        if let Some(number) = raw.as_u64().and_then(|item| u32::try_from(item).ok()) {
            return Some(number);
        }
        if let Some(number) = raw
            .as_str()
            .and_then(|item| item.trim().parse::<u32>().ok())
        {
            return Some(number);
        }
    }
    None
}

fn value_string(value: &Value, keys: &[&str]) -> Option<String> {
    for key in keys {
        let Some(raw) = value.get(*key) else {
            continue;
        };
        if raw.is_null() {
            continue;
        }
        if let Some(text) = raw.as_str() {
            let trimmed = text.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        } else {
            return Some(raw.to_string());
        }
    }
    None
}

fn process_info_from_windows_value(value: &Value) -> Option<ProcessInfo> {
    let pid = value_u32(value, &["ProcessId", "processId", "pid"])?;
    let parent_pid = value_u32(value, &["ParentProcessId", "parentProcessId", "ppid"]);
    let command = value_string(value, &["CommandLine", "commandLine", "command"]);
    let name = value_string(value, &["Name", "name"])
        .or_else(|| {
            command
                .as_deref()
                .and_then(|command| command.split_whitespace().next())
                .map(|item| {
                    item.rsplit(['/', '\\'])
                        .next()
                        .unwrap_or(item)
                        .trim_matches('"')
                        .to_string()
                })
        })
        .unwrap_or_else(|| "process".to_string());
    Some(ProcessInfo {
        pid,
        parent_pid,
        process_group_id: None,
        name,
        command,
        status: "running".to_string(),
    })
}

fn parse_ps_output(ps_output: &str) -> Vec<ProcessInfo> {
    ps_output
        .lines()
        .filter_map(|line| {
            let mut parts = line.split_whitespace();
            let pid = parts.next()?.parse::<u32>().ok()?;
            let parent_pid = parts.next().and_then(|value| value.parse::<u32>().ok());
            let process_group_id = parts.next().and_then(|value| value.parse::<u32>().ok());
            let status_raw = parts.next().unwrap_or_default();
            let command = parts.collect::<Vec<_>>().join(" ");
            let name = command
                .rsplit('/')
                .next()
                .filter(|value| !value.is_empty())
                .unwrap_or(command.as_str())
                .to_string();
            Some(ProcessInfo {
                pid,
                parent_pid,
                process_group_id,
                name,
                command: if command.is_empty() {
                    None
                } else {
                    Some(command)
                },
                status: normalize_status(status_raw),
            })
        })
        .collect()
}

fn normalize_status(status: &str) -> String {
    if status.contains('Z') {
        "zombie"
    } else if status.contains('T') {
        "stopped"
    } else if status.contains('R') {
        "running"
    } else if status.contains('S') || status.contains('I') {
        "sleeping"
    } else {
        "unknown"
    }
    .to_string()
}

fn limited_snapshot(
    root_pid: Option<u32>,
    foreground_pid: Option<u32>,
    reason: &str,
) -> ProcessTreeSnapshot {
    ProcessTreeSnapshot {
        captured_at: now_iso(),
        root_pid,
        foreground_pid,
        running: root_pid.is_some(),
        limited: true,
        limited_reason: Some(reason.to_string()),
        process_count: 0,
        processes: Vec::new(),
    }
}

fn now_iso() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}
