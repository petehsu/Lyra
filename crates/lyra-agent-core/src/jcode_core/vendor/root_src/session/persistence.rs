use anyhow::Result;
use chrono::{DateTime, Utc};
use std::io::{BufRead, BufReader};
use std::path::Path;
use std::time::Instant;

use super::journal::{PersistVectorMode, SessionJournalEntry, metadata_requires_snapshot};
#[cfg(any(test, feature = "legacy-session-json"))]
use super::storage_paths::{file_len_or_zero, session_journal_path_from_snapshot, session_path};
use super::{
    MAX_SESSION_JOURNAL_BYTES, RemoteStartupSessionSnapshot, Session, SessionStartupStub,
    SessionStatus, StoredMessage,
};
use crate::message::{ContentBlock, Role};
use crate::storage;

impl Session {
    #[cfg(any(test, feature = "legacy-session-json"))]
    fn apply_journal_entry(&mut self, entry: SessionJournalEntry) {
        self.apply_journal_meta(entry.meta);
        self.messages.extend(entry.append_messages);
        self.env_snapshots.extend(entry.append_env_snapshots);
        self.memory_injections
            .extend(entry.append_memory_injections);
        self.replay_events.extend(entry.append_replay_events);
        self.mark_memory_profile_dirty();
    }

    #[cfg(any(test, feature = "legacy-session-json"))]
    fn checkpoint_snapshot(&mut self, snapshot_path: &Path, journal_path: &Path) -> Result<()> {
        storage::write_json_fast(snapshot_path, self)?;
        if journal_path.exists() {
            let _ = std::fs::remove_file(journal_path);
        }
        self.reset_persist_state(true);
        Ok(())
    }

    #[cfg(any(test, feature = "legacy-session-json"))]
    pub fn load_from_path(path: &Path) -> Result<Self> {
        let load_start = Instant::now();
        let snapshot_bytes = file_len_or_zero(path);
        let snapshot_start = Instant::now();
        let mut session: Session = storage::read_json(path)?;
        let snapshot_ms = snapshot_start.elapsed().as_millis();
        let journal_path = session_journal_path_from_snapshot(path);
        let journal_bytes = file_len_or_zero(&journal_path);
        let journal_start = Instant::now();
        let mut journal_entries = 0usize;
        if journal_path.exists() {
            let file = std::fs::File::open(&journal_path)?;
            let reader = BufReader::new(file);
            for (line_idx, line) in reader.lines().enumerate() {
                let line = line?;
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    continue;
                }
                match serde_json::from_str::<SessionJournalEntry>(trimmed) {
                    Ok(entry) => {
                        journal_entries += 1;
                        session.apply_journal_entry(entry)
                    }
                    Err(err) => {
                        crate::logging::warn(&format!(
                            "Session journal parse failed at {} line {}: {}",
                            journal_path.display(),
                            line_idx + 1,
                            err
                        ));
                        break;
                    }
                }
            }
        }
        let journal_ms = journal_start.elapsed().as_millis();
        let finalize_start = Instant::now();
        session.reset_persist_state(path.exists());
        session.reset_provider_messages_cache();
        session.mark_memory_profile_dirty();
        let finalize_ms = finalize_start.elapsed().as_millis();
        crate::logging::info(&format!(
            "[TIMING] session_load: session={}, snapshot={}ms, journal={}ms, finalize={}ms, snapshot_bytes={}, journal_bytes={}, journal_entries={}, messages={}, env_snapshots={}, replay_events={}, total={}ms",
            session.id,
            snapshot_ms,
            journal_ms,
            finalize_ms,
            snapshot_bytes,
            journal_bytes,
            journal_entries,
            session.messages.len(),
            session.env_snapshots.len(),
            session.replay_events.len(),
            load_start.elapsed().as_millis(),
        ));
        Ok(session)
    }

    pub fn load(session_id: &str) -> Result<Self> {
        #[cfg(not(test))]
        {
            return Self::load_from_agent_memory(session_id);
        }
        #[cfg(test)]
        {
            let path = session_path(session_id)?;
            Self::load_from_path(&path)
        }
    }

    #[cfg(not(test))]
    fn load_from_agent_memory(session_id: &str) -> Result<Self> {
        let store = crate::memory::agent_runtime::AgentMemoryStore::new_default()?;
        let record = store
            .read_session(session_id)?
            .ok_or_else(|| anyhow::anyhow!("session not found: {session_id}"))?;
        let mut session =
            Session::create_with_id(record.session_id.clone(), None, Some(record.title));
        session.working_dir = record.working_dir;
        session.provider_key = record.provider_key;
        session.model = record.model;
        session.created_at = parse_memory_time(&record.created_at_iso);
        session.updated_at = parse_memory_time(&record.updated_at_iso);
        session.status = match record.status {
            crate::memory::agent_runtime::SessionStatus::Active
            | crate::memory::agent_runtime::SessionStatus::Running
            | crate::memory::agent_runtime::SessionStatus::AwaitingUser
            | crate::memory::agent_runtime::SessionStatus::Recovering => SessionStatus::Active,
            crate::memory::agent_runtime::SessionStatus::Archived => SessionStatus::Closed,
            crate::memory::agent_runtime::SessionStatus::Failed => SessionStatus::Error {
                message: "memory session failed".to_string(),
            },
            crate::memory::agent_runtime::SessionStatus::Interrupted => SessionStatus::Crashed {
                message: Some("memory session interrupted".to_string()),
            },
            crate::memory::agent_runtime::SessionStatus::DeletedByUser
            | crate::memory::agent_runtime::SessionStatus::Idle => SessionStatus::Closed,
        };
        session.archived = matches!(
            record.status,
            crate::memory::agent_runtime::SessionStatus::Archived
        );
        let messages = store
            .read_events_by_session(session_id)?
            .into_iter()
            .filter_map(memory_event_to_stored_message)
            .collect::<Vec<_>>();
        session.replace_messages(messages);
        session.reset_persist_state(true);
        session.reset_provider_messages_cache();
        Ok(session)
    }

    /// Load only the metadata needed for remote-client startup.
    ///
    /// This intentionally skips heavyweight transcript vectors so the remote
    /// client can paint quickly while the server performs the authoritative
    /// session restore + history bootstrap.
    #[cfg(not(test))]
    pub fn load_startup_stub(session_id: &str) -> Result<Self> {
        Self::load(session_id)
    }

    #[cfg(test)]
    pub fn load_startup_stub(session_id: &str) -> Result<Self> {
        let path = session_path(session_id)?;
        let reader = BufReader::new(std::fs::File::open(&path)?);
        let stub: SessionStartupStub = serde_json::from_reader(reader)?;
        Ok(Self::session_from_startup_stub(stub))
    }

    #[cfg(not(test))]
    pub fn load_for_remote_startup(session_id: &str) -> Result<Self> {
        Self::load(session_id)
    }

    #[cfg(test)]
    pub fn load_for_remote_startup(session_id: &str) -> Result<Self> {
        let path = session_path(session_id)?;
        let load_start = Instant::now();
        let snapshot_bytes = file_len_or_zero(&path);
        let snapshot_start = Instant::now();
        let reader = BufReader::new(std::fs::File::open(&path)?);
        let snapshot: RemoteStartupSessionSnapshot = serde_json::from_reader(reader)?;
        let snapshot_ms = snapshot_start.elapsed().as_millis();
        let mut session = Self::session_from_remote_startup_snapshot(snapshot);
        let journal_path = session_journal_path_from_snapshot(&path);
        let journal_bytes = file_len_or_zero(&journal_path);
        let journal_start = Instant::now();
        let mut journal_entries = 0usize;
        if journal_path.exists() {
            let file = std::fs::File::open(&journal_path)?;
            let reader = BufReader::new(file);
            for (line_idx, line) in reader.lines().enumerate() {
                let line = line?;
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    continue;
                }
                match serde_json::from_str::<SessionJournalEntry>(trimmed) {
                    Ok(entry) => {
                        journal_entries += 1;
                        session.apply_journal_meta(entry.meta);
                        session.messages.extend(entry.append_messages);
                        session.replay_events.extend(entry.append_replay_events);
                    }
                    Err(err) => {
                        crate::logging::warn(&format!(
                            "Remote startup journal parse failed at {} line {}: {}",
                            journal_path.display(),
                            line_idx + 1,
                            err
                        ));
                        break;
                    }
                }
            }
        }
        let journal_ms = journal_start.elapsed().as_millis();
        let finalize_start = Instant::now();
        session.reset_persist_state(path.exists());
        session.reset_provider_messages_cache();
        session.mark_memory_profile_dirty();
        let finalize_ms = finalize_start.elapsed().as_millis();
        crate::logging::info(&format!(
            "[TIMING] remote_startup_load: session={}, snapshot={}ms, journal={}ms, finalize={}ms, snapshot_bytes={}, journal_bytes={}, journal_entries={}, messages={}, total={}ms",
            session.id,
            snapshot_ms,
            journal_ms,
            finalize_ms,
            snapshot_bytes,
            journal_bytes,
            journal_entries,
            session.messages.len(),
            load_start.elapsed().as_millis(),
        ));
        Ok(session)
    }

    #[cfg(not(test))]
    pub fn save(&mut self) -> Result<()> {
        self.updated_at = Utc::now();
        let store = crate::memory::agent_runtime::AgentMemoryStore::new_default()?;
        store.ensure_session_with_id(
            &self.id,
            crate::memory::agent_runtime::CreateSessionInput {
                title: Some(self.display_title_or_name().to_string()),
                working_dir: self.working_dir.clone(),
                provider_key: self.provider_key.clone(),
                model: self.model.clone(),
            },
        )?;
        store.update_session_title(&self.id, self.display_title_or_name())?;
        store.update_session_model_snapshot(
            &self.id,
            self.working_dir.as_deref(),
            self.provider_key.as_deref(),
            self.model.as_deref(),
        )?;
        store.update_session_status(
            &self.id,
            if self.archived {
                crate::memory::agent_runtime::SessionStatus::Archived
            } else {
                crate::memory::agent_runtime::SessionStatus::Idle
            },
        )?;
        self.reset_persist_state(true);
        Ok(())
    }

    #[cfg(test)]
    pub fn save(&mut self) -> Result<()> {
        self.updated_at = Utc::now();
        let path = session_path(&self.id)?;
        let journal_path = session_journal_path_from_snapshot(&path);
        let start = std::time::Instant::now();
        let snapshot_bytes_before = file_len_or_zero(&path);
        let journal_bytes_before = file_len_or_zero(&journal_path);
        let current_meta = self.journal_meta();
        let metadata_needs_snapshot = self
            .persist_state
            .last_meta
            .as_ref()
            .is_some_and(|prev| metadata_requires_snapshot(prev, &current_meta));
        let vectors_need_snapshot = !self.persist_state.snapshot_exists
            || self.persist_state.messages_mode == PersistVectorMode::Full
            || self.persist_state.env_snapshots_mode == PersistVectorMode::Full
            || self.persist_state.memory_injections_mode == PersistVectorMode::Full
            || self.persist_state.replay_events_mode == PersistVectorMode::Full
            || self.messages.len() < self.persist_state.messages_len
            || self.env_snapshots.len() < self.persist_state.env_snapshots_len
            || self.memory_injections.len() < self.persist_state.memory_injections_len
            || self.replay_events.len() < self.persist_state.replay_events_len;

        let delta_messages = self
            .messages
            .len()
            .saturating_sub(self.persist_state.messages_len);
        let delta_env_snapshots = self
            .env_snapshots
            .len()
            .saturating_sub(self.persist_state.env_snapshots_len);
        let delta_memory_injections = self
            .memory_injections
            .len()
            .saturating_sub(self.persist_state.memory_injections_len);
        let delta_replay_events = self
            .replay_events
            .len()
            .saturating_sub(self.persist_state.replay_events_len);
        let (
            result,
            save_mode,
            entry_build_ms,
            append_ms,
            journal_stat_ms,
            checkpoint_ms,
            journal_bytes_after,
        ) = if metadata_needs_snapshot || vectors_need_snapshot {
            let checkpoint_start = Instant::now();
            let result = self.checkpoint_snapshot(&path, &journal_path);
            let checkpoint_ms = checkpoint_start.elapsed().as_millis();
            let journal_bytes_after = file_len_or_zero(&journal_path);
            (
                result,
                "snapshot",
                0,
                0,
                0,
                checkpoint_ms,
                journal_bytes_after,
            )
        } else {
            let entry_build_start = Instant::now();
            let entry = SessionJournalEntry {
                meta: current_meta.clone(),
                append_messages: self.messages[self.persist_state.messages_len..].to_vec(),
                append_env_snapshots: self.env_snapshots[self.persist_state.env_snapshots_len..]
                    .to_vec(),
                append_memory_injections: self.memory_injections
                    [self.persist_state.memory_injections_len..]
                    .to_vec(),
                append_replay_events: self.replay_events[self.persist_state.replay_events_len..]
                    .to_vec(),
            };
            let entry_build_ms = entry_build_start.elapsed().as_millis();
            let append_start = Instant::now();
            let append_result = storage::append_json_line_fast(&journal_path, &entry);
            let append_ms = append_start.elapsed().as_millis();
            match append_result {
                Ok(()) => {
                    self.reset_persist_state(true);
                    let journal_stat_start = Instant::now();
                    let journal_bytes_after = file_len_or_zero(&journal_path);
                    let journal_stat_ms = journal_stat_start.elapsed().as_millis();
                    if journal_bytes_after > MAX_SESSION_JOURNAL_BYTES {
                        let checkpoint_start = Instant::now();
                        let result = self.checkpoint_snapshot(&path, &journal_path);
                        let checkpoint_ms = checkpoint_start.elapsed().as_millis();
                        let journal_bytes_after = file_len_or_zero(&journal_path);
                        (
                            result,
                            "append+checkpoint",
                            entry_build_ms,
                            append_ms,
                            journal_stat_ms,
                            checkpoint_ms,
                            journal_bytes_after,
                        )
                    } else {
                        (
                            Ok(()),
                            "append",
                            entry_build_ms,
                            append_ms,
                            journal_stat_ms,
                            0,
                            journal_bytes_after,
                        )
                    }
                }
                Err(err) => {
                    crate::logging::warn(&format!(
                        "Session journal append failed for {} ({}); checkpointing full snapshot",
                        self.id, err
                    ));
                    let checkpoint_start = Instant::now();
                    let result = self.checkpoint_snapshot(&path, &journal_path);
                    let checkpoint_ms = checkpoint_start.elapsed().as_millis();
                    let journal_bytes_after = file_len_or_zero(&journal_path);
                    (
                        result,
                        "append_failed_fallback_snapshot",
                        entry_build_ms,
                        append_ms,
                        0,
                        checkpoint_ms,
                        journal_bytes_after,
                    )
                }
            }
        };
        let elapsed = start.elapsed();
        if elapsed.as_millis() > 50 {
            crate::logging::info(&format!(
                "Session save slow: total={:.0}ms mode={} metadata_snapshot={} vectors_snapshot={} entry_build={}ms append={}ms journal_stat={}ms checkpoint={}ms messages={} delta_messages={} delta_env_snapshots={} delta_memory_injections={} delta_replay_events={} snapshot_bytes_before={} journal_bytes_before={} journal_bytes_after={}",
                elapsed.as_secs_f64() * 1000.0,
                save_mode,
                metadata_needs_snapshot,
                vectors_need_snapshot,
                entry_build_ms,
                append_ms,
                journal_stat_ms,
                checkpoint_ms,
                self.messages.len(),
                delta_messages,
                delta_env_snapshots,
                delta_memory_injections,
                delta_replay_events,
                snapshot_bytes_before,
                journal_bytes_before,
                journal_bytes_after,
            ));
        }
        result
    }
}

#[cfg(not(test))]
fn parse_memory_time(value: &str) -> DateTime<Utc> {
    DateTime::parse_from_rfc3339(value)
        .map(|value| value.with_timezone(&Utc))
        .unwrap_or_else(|_| Utc::now())
}

#[cfg(not(test))]
fn memory_event_to_stored_message(
    event: crate::memory::agent_runtime::SessionEventRecord,
) -> Option<StoredMessage> {
    let (role, content) = match event.kind.as_str() {
        "user_message" => (
            Role::User,
            vec![ContentBlock::Text {
                text: event
                    .payload_json
                    .get("text")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or_default()
                    .to_string(),
                cache_control: None,
            }],
        ),
        "assistant_message" => (
            Role::Assistant,
            vec![ContentBlock::Text {
                text: event
                    .payload_json
                    .get("text")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or_default()
                    .to_string(),
                cache_control: None,
            }],
        ),
        "tool_result" => {
            let tool_call_id = event
                .payload_json
                .get("toolCallId")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("tool_call")
                .to_string();
            let content = event
                .payload_json
                .get("output")
                .map(|value| {
                    value
                        .get("content")
                        .and_then(serde_json::Value::as_str)
                        .map(ToOwned::to_owned)
                        .unwrap_or_else(|| value.to_string())
                })
                .unwrap_or_default();
            (
                Role::User,
                vec![ContentBlock::ToolResult {
                    tool_use_id: tool_call_id,
                    content,
                    is_error: None,
                }],
            )
        }
        _ => return None,
    };
    Some(StoredMessage {
        id: event.event_id,
        role,
        content,
        display_role: None,
        timestamp: Some(parse_memory_time(&event.created_at_iso)),
        tool_duration_ms: None,
        token_usage: None,
    })
}
