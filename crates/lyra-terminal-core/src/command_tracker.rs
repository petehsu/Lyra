use crate::shell_integration::{ShellIntegrationEvent, ShellIntegrationEventKind};
use chrono::{DateTime, SecondsFormat, Utc};
use serde::Serialize;
use serde_json::{json, Value};
use uuid::Uuid;

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CommandStatus {
    Pending,
    Running,
    Completed,
    Failed,
    Cancelled,
    Unknown,
}

impl CommandStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Running => "running",
            Self::Completed => "completed",
            Self::Failed => "failed",
            Self::Cancelled => "cancelled",
            Self::Unknown => "unknown",
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ByteRange {
    pub start: u64,
    pub end: u64,
}

impl ByteRange {
    pub fn collapsed(offset: u64) -> Self {
        Self {
            start: offset,
            end: offset,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenVersionRange {
    pub start: u64,
    pub end: u64,
}

impl ScreenVersionRange {
    pub fn collapsed(version: u64) -> Self {
        Self {
            start: version,
            end: version,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptSnapshot {
    pub visible: bool,
    pub text: Option<String>,
    pub cwd: Option<String>,
    pub shell: Option<String>,
    pub branch: Option<String>,
    pub editable_input: Option<String>,
    pub captured_at: String,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandRecord {
    pub command_seq: u64,
    pub command_id: String,
    pub terminal_session_id: String,
    pub command_text: Option<String>,
    pub normalized_command_text: Option<String>,
    pub submitted_at: Option<String>,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
    pub duration_ms: Option<u64>,
    pub status: CommandStatus,
    pub exit_code: Option<i32>,
    pub signal: Option<String>,
    pub cwd_before: Option<String>,
    pub cwd_after: Option<String>,
    pub output_text_range: ByteRange,
    pub raw_output_range: ByteRange,
    pub screen_version_range: ScreenVersionRange,
    pub prompt_before: Option<PromptSnapshot>,
    pub prompt_after: Option<PromptSnapshot>,
    pub actor: Value,
    pub correlation: Value,
    pub permission_id: Option<String>,
    pub process_ids: Vec<u32>,
    pub confidence: f64,
    pub boundary_source: String,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandSummary {
    pub command_id: String,
    pub status: CommandStatus,
    pub output_text_range: ByteRange,
    pub raw_output_range: ByteRange,
    pub first_output_preview: Option<String>,
    pub last_output_preview: Option<String>,
    pub last_error_lines: Vec<String>,
    pub estimated_tokens: u64,
}

#[derive(Clone, Debug)]
pub struct CommandObservationFrame {
    pub output_text_offset: u64,
    pub raw_output_offset: u64,
    pub screen_version: u64,
    pub cwd: Option<String>,
    pub prompt: Option<PromptSnapshot>,
    pub actor: Value,
    pub correlation: Value,
    pub permission_id: Option<String>,
    pub process_ids: Vec<u32>,
}

impl Default for CommandObservationFrame {
    fn default() -> Self {
        Self {
            output_text_offset: 0,
            raw_output_offset: 0,
            screen_version: 0,
            cwd: None,
            prompt: None,
            actor: json!({ "kind": "terminal_kernel" }),
            correlation: json!({}),
            permission_id: None,
            process_ids: Vec::new(),
        }
    }
}

#[derive(Clone, Debug)]
pub struct CommandSubmission {
    pub command_id: Option<String>,
    pub command_text: Option<String>,
    pub frame: CommandObservationFrame,
    pub status: CommandStatus,
    pub confidence: f64,
    pub boundary_source: String,
}

#[derive(Clone, Debug)]
pub struct CommandCompletion {
    pub command_id: Option<String>,
    pub exit_code: Option<i32>,
    pub signal: Option<String>,
    pub frame: CommandObservationFrame,
    pub confidence: f64,
    pub boundary_source: String,
}

#[derive(Clone, Debug)]
pub struct OutputSummaryInput {
    pub command_id: String,
    pub output: String,
    pub error_lines: Vec<String>,
    pub output_text_range: ByteRange,
    pub raw_output_range: ByteRange,
}

#[derive(Clone, Debug)]
pub struct CommandTracker {
    session_id: String,
    records: Vec<CommandRecord>,
    next_command_seq: u64,
    active_command_id: Option<String>,
    pending_command_id: Option<String>,
    current_cwd: Option<String>,
    prompt_visible: bool,
    shell_integration_seen: bool,
}

impl CommandTracker {
    pub fn new(session_id: impl Into<String>) -> Self {
        Self {
            session_id: session_id.into(),
            records: Vec::new(),
            next_command_seq: 1,
            active_command_id: None,
            pending_command_id: None,
            current_cwd: None,
            prompt_visible: false,
            shell_integration_seen: false,
        }
    }

    pub fn records(&self) -> &[CommandRecord] {
        &self.records
    }

    pub fn prompt_visible(&self) -> bool {
        self.prompt_visible
    }

    pub fn shell_integration_seen(&self) -> bool {
        self.shell_integration_seen
    }

    pub fn active_command(&self) -> Option<&CommandRecord> {
        self.active_command_id
            .as_deref()
            .and_then(|command_id| self.latest_command(command_id))
    }

    pub fn latest_command(&self, command_id: &str) -> Option<&CommandRecord> {
        self.records
            .iter()
            .rev()
            .find(|record| record.command_id == command_id)
    }

    pub fn submit_command(&mut self, submission: CommandSubmission) -> String {
        let command_id = submission
            .command_id
            .or_else(|| command_id_from_correlation(&submission.frame.correlation))
            .unwrap_or_else(create_command_id);
        let output_text_range = ByteRange::collapsed(submission.frame.output_text_offset);
        let raw_output_range = ByteRange::collapsed(submission.frame.raw_output_offset);
        let screen_version_range = ScreenVersionRange::collapsed(submission.frame.screen_version);
        let now = now_iso();
        let normalized = submission
            .command_text
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToString::to_string);
        let started_at = if submission.status == CommandStatus::Running {
            Some(now.clone())
        } else {
            None
        };
        let record = CommandRecord {
            command_seq: self.take_command_seq(),
            command_id: command_id.clone(),
            terminal_session_id: self.session_id.clone(),
            command_text: submission.command_text,
            normalized_command_text: normalized,
            submitted_at: Some(now),
            started_at,
            completed_at: None,
            duration_ms: None,
            status: submission.status.clone(),
            exit_code: None,
            signal: None,
            cwd_before: submission
                .frame
                .cwd
                .clone()
                .or_else(|| self.current_cwd.clone()),
            cwd_after: None,
            output_text_range,
            raw_output_range,
            screen_version_range,
            prompt_before: submission.frame.prompt.clone(),
            prompt_after: None,
            actor: submission.frame.actor,
            correlation: merge_command_id(submission.frame.correlation, &command_id),
            permission_id: submission.frame.permission_id,
            process_ids: dedupe_process_ids(submission.frame.process_ids),
            confidence: submission.confidence,
            boundary_source: submission.boundary_source,
        };
        if matches!(
            record.status,
            CommandStatus::Pending | CommandStatus::Running
        ) {
            self.active_command_id = Some(command_id.clone());
        }
        self.records.push(record);
        command_id
    }

    pub fn start_command(&mut self, command_id: &str, frame: CommandObservationFrame) {
        let Some(previous) = self.latest_command(command_id).cloned() else {
            return;
        };
        if previous.status == CommandStatus::Running {
            return;
        }
        let now = now_iso();
        let mut next = previous;
        next.command_seq = self.take_command_seq();
        next.status = CommandStatus::Running;
        next.started_at = Some(now);
        next.output_text_range.end = frame.output_text_offset;
        next.raw_output_range.end = frame.raw_output_offset;
        next.screen_version_range.end = frame.screen_version;
        next.process_ids = dedupe_process_ids(frame.process_ids);
        next.confidence = next.confidence.max(0.4);
        next.boundary_source = "shell_or_output_start".to_string();
        self.active_command_id = Some(command_id.to_string());
        self.records.push(next);
    }

    pub fn complete_command(&mut self, completion: CommandCompletion) -> Option<String> {
        let command_id = completion
            .command_id
            .or_else(|| self.active_command_id.clone())?;
        let previous = self.latest_command(&command_id).cloned()?;
        let completed_at = now_iso();
        let status =
            status_from_exit_and_signal(completion.exit_code, completion.signal.as_deref());
        let mut next = previous.clone();
        next.command_seq = self.take_command_seq();
        next.status = status;
        next.completed_at = Some(completed_at.clone());
        next.duration_ms = previous
            .started_at
            .as_deref()
            .and_then(|started_at| duration_ms(started_at, &completed_at));
        next.exit_code = completion.exit_code;
        next.signal = completion.signal;
        next.cwd_after = completion.frame.cwd.or_else(|| self.current_cwd.clone());
        next.output_text_range.end = completion.frame.output_text_offset;
        next.raw_output_range.end = completion.frame.raw_output_offset;
        next.screen_version_range.end = completion.frame.screen_version;
        next.prompt_after = completion.frame.prompt;
        next.process_ids = merge_process_ids(next.process_ids, completion.frame.process_ids);
        next.confidence = completion.confidence;
        next.boundary_source = completion.boundary_source;
        self.records.push(next);
        if self.active_command_id.as_deref() == Some(command_id.as_str()) {
            self.active_command_id = None;
        }
        Some(command_id)
    }

    pub fn record_input_journal(
        &mut self,
        input_text: &str,
        append_newline: bool,
        frame: CommandObservationFrame,
    ) -> Option<String> {
        if !append_newline {
            return None;
        }
        let command_text = input_text.trim();
        if command_text.is_empty() {
            return None;
        }
        Some(self.submit_command(CommandSubmission {
            command_id: command_id_from_correlation(&frame.correlation),
            command_text: Some(command_text.to_string()),
            frame,
            status: CommandStatus::Pending,
            confidence: 0.35,
            boundary_source: "input_journal_newline".to_string(),
        }))
    }

    pub fn infer_started_from_output(&mut self, frame: CommandObservationFrame) -> Option<String> {
        let command_id = self.active_command_id.clone()?;
        let previous = self.latest_command(&command_id)?;
        if previous.status != CommandStatus::Pending {
            return Some(command_id);
        }
        self.start_command(&command_id, frame);
        Some(command_id)
    }

    pub fn infer_completed_from_prompt(
        &mut self,
        frame: CommandObservationFrame,
    ) -> Option<String> {
        if self.shell_integration_seen {
            return None;
        }
        self.complete_command(CommandCompletion {
            command_id: self.active_command_id.clone(),
            exit_code: None,
            signal: None,
            frame,
            confidence: 0.45,
            boundary_source: "prompt_reappearance_heuristic".to_string(),
        })
    }

    pub fn cancel_active(
        &mut self,
        signal: impl Into<String>,
        frame: CommandObservationFrame,
    ) -> Option<String> {
        self.complete_command(CommandCompletion {
            command_id: self.active_command_id.clone(),
            exit_code: None,
            signal: Some(signal.into()),
            frame,
            confidence: 0.8,
            boundary_source: "process_signal".to_string(),
        })
    }

    pub fn apply_shell_event(
        &mut self,
        event: &ShellIntegrationEvent,
        mut frame: CommandObservationFrame,
    ) -> Option<String> {
        self.shell_integration_seen = true;
        if let Some(cwd) = event.cwd.as_ref().filter(|value| !value.is_empty()) {
            self.current_cwd = Some(cwd.clone());
            frame.cwd = Some(cwd.clone());
        }
        match event.kind {
            ShellIntegrationEventKind::PromptStart | ShellIntegrationEventKind::PromptReady => {
                self.prompt_visible = true;
                None
            }
            ShellIntegrationEventKind::PromptEnd => {
                self.prompt_visible = false;
                None
            }
            ShellIntegrationEventKind::CwdChanged => None,
            ShellIntegrationEventKind::CommandId => {
                self.pending_command_id = event.command_id.clone();
                None
            }
            ShellIntegrationEventKind::CommandStart => {
                self.prompt_visible = false;
                let command_id = event
                    .command_id
                    .clone()
                    .or_else(|| self.pending_command_id.take())
                    .or_else(|| self.active_command_id.clone())
                    .unwrap_or_else(create_command_id);
                if self.latest_command(&command_id).is_none() {
                    self.submit_command(CommandSubmission {
                        command_id: Some(command_id.clone()),
                        command_text: event.command.clone(),
                        frame,
                        status: CommandStatus::Running,
                        confidence: event.confidence,
                        boundary_source: "osc_133_command_start".to_string(),
                    });
                } else {
                    self.start_command(&command_id, frame);
                }
                Some(command_id)
            }
            ShellIntegrationEventKind::CommandEnd => self.complete_command(CommandCompletion {
                command_id: event
                    .command_id
                    .clone()
                    .or_else(|| self.active_command_id.clone()),
                exit_code: event.exit_code,
                signal: event.signal.clone(),
                frame,
                confidence: event.confidence,
                boundary_source: "osc_133_command_end".to_string(),
            }),
            ShellIntegrationEventKind::Unknown => None,
        }
    }

    pub fn summarize_output(&self, input: OutputSummaryInput) -> CommandSummary {
        let latest = self.latest_command(&input.command_id);
        let lines = input
            .output
            .lines()
            .map(str::trim)
            .filter(|line| !line.is_empty())
            .map(ToString::to_string)
            .collect::<Vec<_>>();
        CommandSummary {
            command_id: input.command_id,
            status: latest
                .map(|record| record.status.clone())
                .unwrap_or(CommandStatus::Unknown),
            output_text_range: input.output_text_range,
            raw_output_range: input.raw_output_range,
            first_output_preview: lines.first().map(|line| preview(line, 240)),
            last_output_preview: lines.last().map(|line| preview(line, 240)),
            last_error_lines: input
                .error_lines
                .into_iter()
                .rev()
                .take(5)
                .collect::<Vec<_>>()
                .into_iter()
                .rev()
                .collect(),
            estimated_tokens: estimate_tokens(input.output.len() as u64),
        }
    }

    fn take_command_seq(&mut self) -> u64 {
        let value = self.next_command_seq;
        self.next_command_seq = self.next_command_seq.saturating_add(1);
        value
    }
}

pub fn prompt_snapshot(
    visible: bool,
    text: Option<String>,
    cwd: Option<String>,
    shell: Option<String>,
    branch: Option<String>,
    editable_input: Option<String>,
) -> PromptSnapshot {
    PromptSnapshot {
        visible,
        text,
        cwd,
        shell,
        branch,
        editable_input,
        captured_at: now_iso(),
    }
}

fn create_command_id() -> String {
    format!("terminal-command-{}", Uuid::new_v4())
}

fn command_id_from_correlation(correlation: &Value) -> Option<String> {
    correlation
        .get("commandId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn merge_command_id(mut correlation: Value, command_id: &str) -> Value {
    if !correlation.is_object() {
        correlation = json!({});
    }
    if let Some(object) = correlation.as_object_mut() {
        object.insert(
            "commandId".to_string(),
            Value::String(command_id.to_string()),
        );
    }
    correlation
}

fn now_iso() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

fn duration_ms(started_at: &str, completed_at: &str) -> Option<u64> {
    let start = DateTime::parse_from_rfc3339(started_at).ok()?;
    let end = DateTime::parse_from_rfc3339(completed_at).ok()?;
    u64::try_from(end.signed_duration_since(start).num_milliseconds()).ok()
}

fn status_from_exit_and_signal(exit_code: Option<i32>, signal: Option<&str>) -> CommandStatus {
    if signal.is_some() {
        return CommandStatus::Cancelled;
    }
    match exit_code {
        Some(0) => CommandStatus::Completed,
        Some(_) => CommandStatus::Failed,
        None => CommandStatus::Unknown,
    }
}

fn dedupe_process_ids(process_ids: Vec<u32>) -> Vec<u32> {
    let mut values = process_ids;
    values.sort_unstable();
    values.dedup();
    values
}

fn merge_process_ids(left: Vec<u32>, right: Vec<u32>) -> Vec<u32> {
    let mut merged = left;
    merged.extend(right);
    dedupe_process_ids(merged)
}

fn preview(value: &str, max_chars: usize) -> String {
    value.chars().take(max_chars).collect()
}

fn estimate_tokens(bytes: u64) -> u64 {
    bytes.saturating_add(3) / 4
}
