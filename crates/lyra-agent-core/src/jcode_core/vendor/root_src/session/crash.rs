use super::{Session, SessionStatus, session_exists};
use crate::id::extract_session_name;
use crate::message::{ContentBlock, Role};
use anyhow::Result;
use chrono::{DateTime, Duration, Utc};
use serde::Deserialize;
use std::collections::HashSet;

fn load_memory_sessions() -> Result<Vec<Session>> {
    let store = crate::memory::agent_runtime::AgentMemoryStore::new_default()?;
    let mut sessions = Vec::new();
    for record in store.list_sessions()? {
        if let Ok(session) = Session::load(&record.session_id) {
            sessions.push(session);
        }
    }
    Ok(sessions)
}

/// Recover crashed sessions from the most recent crash window (text-only).
/// Returns new recovery session IDs (most recent first).
pub fn recover_crashed_sessions() -> Result<Vec<String>> {
    let mut sessions = load_memory_sessions()?;
    for session in &mut sessions {
        if session.detect_crash() {
            let _ = session.save();
        }
    }

    // Track existing recovery sessions to avoid duplicates
    let mut recovered_parents: HashSet<String> = HashSet::new();
    for s in &sessions {
        if s.id.starts_with("session_recovery_")
            && let Some(parent) = s.parent_id.as_ref()
        {
            recovered_parents.insert(parent.clone());
        }
    }

    let mut crashed: Vec<Session> = sessions
        .into_iter()
        .filter(|s| matches!(s.status, SessionStatus::Crashed { .. }))
        .collect();
    if crashed.is_empty() {
        return Ok(Vec::new());
    }

    let crash_window = Duration::seconds(60);
    let most_recent = crashed
        .iter()
        .map(|s| s.last_active_at.unwrap_or(s.updated_at))
        .max()
        .unwrap_or_else(Utc::now);
    crashed.retain(|s| {
        let ts = s.last_active_at.unwrap_or(s.updated_at);
        let delta = most_recent.signed_duration_since(ts);
        delta >= Duration::zero() && delta <= crash_window
    });
    crashed.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));

    let mut new_ids = Vec::new();
    for mut old in crashed {
        if recovered_parents.contains(&old.id) {
            continue;
        }

        let new_id = format!("session_recovery_{}", crate::id::new_id("rec"));
        let mut new_session =
            Session::create_with_id(new_id.clone(), Some(old.id.clone()), old.title.clone());
        new_session.custom_title = old.custom_title.clone();
        new_session.working_dir = old.working_dir.clone();
        new_session.provider_key = old.provider_key.clone();
        new_session.model = old.model.clone();
        new_session.improve_mode = old.improve_mode;
        new_session.is_canary = old.is_canary;
        new_session.is_debug = old.is_debug;
        new_session.testing_build = old.testing_build.clone();
        new_session.saved = old.saved;
        new_session.save_label = old.save_label.clone();
        new_session.provider_session_id = None;
        new_session.status = SessionStatus::Closed;

        // Add a recovery header
        new_session.add_message(
            Role::User,
            vec![ContentBlock::Text {
                text: format!(
                    "Recovered from crashed session `{}` ({})",
                    old.id,
                    old.display_name()
                ),
                cache_control: None,
            }],
        );

        for msg in old.messages.drain(..) {
            let kept_blocks: Vec<ContentBlock> = msg
                .content
                .into_iter()
                .filter(|block| matches!(block, ContentBlock::Text { .. }))
                .collect();
            if kept_blocks.is_empty() {
                continue;
            }
            new_session.add_message(msg.role, kept_blocks);
        }

        new_session.save()?;
        new_ids.push(new_id);
    }

    Ok(new_ids)
}

/// Info about crashed sessions pending batch restore
#[derive(Debug, Clone)]
pub struct CrashedSessionsInfo {
    /// Session IDs that crashed
    pub session_ids: Vec<String>,
    /// Display names of crashed sessions
    pub display_names: Vec<String>,
    /// When the most recent crash occurred
    pub most_recent_crash: DateTime<Utc>,
}

/// Detect crashed sessions that can be batch restored.
/// Returns info about crashed sessions within the crash window (60 seconds),
/// excluding any that have already been recovered.
pub fn detect_crashed_sessions() -> Result<Option<CrashedSessionsInfo>> {
    let mut sessions = load_memory_sessions()?;
    for session in &mut sessions {
        if session.detect_crash() {
            let _ = session.save();
        }
    }

    // Track existing recovery sessions to avoid showing already-recovered crashes
    let mut recovered_parents: HashSet<String> = HashSet::new();
    for s in &sessions {
        if s.id.starts_with("session_recovery_")
            && let Some(parent) = s.parent_id.as_ref()
        {
            recovered_parents.insert(parent.clone());
        }
    }

    // Filter to crashed sessions that haven't been recovered
    let mut crashed: Vec<Session> = sessions
        .into_iter()
        .filter(|s| matches!(s.status, SessionStatus::Crashed { .. }))
        .filter(|s| !recovered_parents.contains(&s.id))
        .collect();

    if crashed.is_empty() {
        return Ok(None);
    }

    // Apply 60-second crash window filter
    let crash_window = Duration::seconds(60);
    let most_recent = crashed
        .iter()
        .map(|s| s.last_active_at.unwrap_or(s.updated_at))
        .max()
        .unwrap_or_else(Utc::now);

    crashed.retain(|s| {
        let ts = s.last_active_at.unwrap_or(s.updated_at);
        let delta = most_recent.signed_duration_since(ts);
        delta >= Duration::zero() && delta <= crash_window
    });

    if crashed.is_empty() {
        return Ok(None);
    }

    // Sort by most recent first
    crashed.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));

    let session_ids: Vec<String> = crashed.iter().map(|s| s.id.clone()).collect();
    let display_names: Vec<String> = crashed
        .iter()
        .map(|s| s.display_name().to_string())
        .collect();

    Ok(Some(CrashedSessionsInfo {
        session_ids,
        display_names,
        most_recent_crash: most_recent,
    }))
}

/// Lightweight session header for fast scanning (skips messages array).
/// Uses serde's `deny_unknown_fields` = false (default) so the large `messages`
/// field is silently ignored during deserialization.
#[derive(Debug, Clone, Deserialize)]
struct SessionHeader {
    id: String,
    #[serde(default)]
    parent_id: Option<String>,
    #[serde(rename = "created_at")]
    _created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
    #[serde(default)]
    short_name: Option<String>,
    #[serde(default)]
    status: SessionStatus,
    #[serde(default)]
    last_active_at: Option<DateTime<Utc>>,
}

impl SessionHeader {
    fn display_name(&self) -> &str {
        if let Some(ref name) = self.short_name {
            name
        } else if let Some(name) = extract_session_name(&self.id) {
            name
        } else {
            &self.id
        }
    }
}

/// Find recent crashed sessions for showing resume hints.
pub fn find_recent_crashed_sessions() -> Vec<(String, String)> {
    find_crashed_legacy_scan()
}

fn find_crashed_via_pid_files() -> Option<Vec<(String, String)>> {
    None
}

fn find_crashed_legacy_scan() -> Vec<(String, String)> {
    let cutoff = Utc::now() - Duration::hours(24);
    let mut recovered_parents: HashSet<String> = HashSet::new();
    let sessions = match load_memory_sessions() {
        Ok(sessions) => sessions,
        Err(_) => return Vec::new(),
    };

    for session in &sessions {
        if session.id.starts_with("session_recovery_")
            && let Some(parent) = session.parent_id.as_ref()
        {
            recovered_parents.insert(parent.clone());
        }
    }

    let mut crashed: Vec<Session> = sessions
        .into_iter()
        .filter(|s| matches!(s.status, SessionStatus::Crashed { .. }))
        .filter(|s| !recovered_parents.contains(&s.id))
        .filter(|s| {
            let ts = s.last_active_at.unwrap_or(s.updated_at);
            ts > cutoff
        })
        .collect();

    crashed.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));

    crashed
        .into_iter()
        .map(|s| {
            let name = s.display_name().to_string();
            let id = s.id.clone();
            (id, name)
        })
        .collect()
}

/// Extract the epoch-ms timestamp embedded in a session filename.
/// Handles formats like:
///   "session_fox_1772405007295.json" (memorable id)
///   "session_1772405007295_hash.json" (legacy)
///   "session_recovery_1772405007295.json"
fn extract_timestamp_from_filename(filename: &str) -> Option<u64> {
    let stem = filename.strip_suffix(".json").unwrap_or(filename);
    // Walk the underscore-separated parts and find the first one that
    // looks like a plausible epoch-ms (13+ digits, starts with '1').
    for part in stem.split('_') {
        if part.len() >= 13 && part.starts_with('1') && part.chars().all(|c| c.is_ascii_digit()) {
            return part.parse::<u64>().ok();
        }
    }
    None
}

pub(super) fn is_pid_running(pid: u32) -> bool {
    crate::platform::is_process_running(pid)
}

// ---------------------------------------------------------------------------
// Active PID tracking
// ---------------------------------------------------------------------------
// Lightweight files in ~/.jcode/active_pids/<session_id> containing the PID.
// Written on mark_active(), removed on mark_closed()/mark_crashed().
// On startup we only need to scan this tiny directory (usually 0-5 files)
// instead of the entire sessions/ directory (tens of thousands of files).

fn normalize_resume_lookup_text(text: &str) -> String {
    text.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

fn session_matches_resume_title(session: &Session, normalized_query: &str) -> bool {
    if normalized_query.is_empty() {
        return false;
    }

    session
        .display_title()
        .map(normalize_resume_lookup_text)
        .is_some_and(|title| title == normalized_query || title.contains(normalized_query))
}

/// Find a session by ID, memorable name, generated title, or custom rename.
/// If the input doesn't load as a full session ID, scan recent session snapshots
/// and return the newest matching short name/title.
/// Returns the full session ID if found.
pub fn find_session_by_name_or_id(name_or_id: &str) -> Result<String> {
    // Try loading directly first so stable imported IDs like `imported_codex_*`
    // or other explicit session ids can be resumed without going through the
    // short-name matcher.
    match Session::load(name_or_id) {
        Ok(_) => return Ok(name_or_id.to_string()),
        Err(e) => {
            if session_exists(name_or_id) {
                anyhow::bail!(
                    "Session '{}' exists but failed to load (possibly corrupt):\n  {}",
                    name_or_id,
                    e
                );
            }
        }
    }

    let normalized_query = normalize_resume_lookup_text(name_or_id);
    let mut exact_matches: Vec<(String, chrono::DateTime<chrono::Utc>)> = Vec::new();
    let mut title_matches: Vec<(String, chrono::DateTime<chrono::Utc>)> = Vec::new();

    for session in load_memory_sessions()? {
        let session_id = session.id.as_str();
        if extract_session_name(session_id).is_some_and(|short| short == name_or_id) {
            exact_matches.push((session.id.clone(), session.updated_at));
            continue;
        }
        if session.short_name.as_deref() == Some(name_or_id) {
            exact_matches.push((session.id.clone(), session.updated_at));
        } else if session_matches_resume_title(&session, &normalized_query) {
            title_matches.push((session.id.clone(), session.updated_at));
        }
    }

    let matches = if exact_matches.is_empty() {
        &mut title_matches
    } else {
        &mut exact_matches
    };

    if matches.is_empty() {
        anyhow::bail!("No session found matching '{}'", name_or_id);
    }

    // Sort by updated_at descending and return the most recent match.
    matches.sort_by(|a, b| b.1.cmp(&a.1));
    Ok(matches[0].0.clone())
}

#[cfg(test)]
mod batch_crash_tests {
    use super::*;

    #[test]
    fn test_crashed_sessions_info_struct() {
        let info = CrashedSessionsInfo {
            session_ids: vec!["session_test_1".to_string(), "session_test_2".to_string()],
            display_names: vec!["fox".to_string(), "oak".to_string()],
            most_recent_crash: Utc::now(),
        };
        assert_eq!(info.session_ids.len(), 2);
        assert_eq!(info.display_names.len(), 2);
        assert_eq!(info.display_names[0], "fox");
    }

    #[test]
    fn find_session_by_name_or_id_matches_custom_title() {
        let _guard = crate::storage::lock_test_env();
        let temp = tempfile::tempdir().expect("tempdir");
        crate::env::set_var("JCODE_HOME", temp.path());

        let session_id = "session_renamecli_1770000000000";
        let mut session = Session::create_with_id(
            session_id.to_string(),
            None,
            Some("Generated planning title".to_string()),
        );
        session.status = SessionStatus::Closed;
        session.rename_title(Some("RenameTest".to_string()));
        session.save().expect("save renamed session");

        assert_eq!(
            find_session_by_name_or_id("renametest").expect("resolve custom title"),
            session_id
        );
        assert_eq!(
            find_session_by_name_or_id("Rename").expect("resolve title fragment"),
            session_id
        );

        crate::env::remove_var("JCODE_HOME");
    }

    #[test]
    fn find_session_by_name_or_id_accepts_imported_session_ids() -> anyhow::Result<()> {
        let _guard = crate::storage::lock_test_env();
        let temp = tempfile::tempdir()?;
        crate::env::set_var("JCODE_HOME", temp.path());

        let imported_id = "imported_codex_test_resume";
        let mut session =
            Session::create_with_id(imported_id.to_string(), None, Some("Imported".to_string()));
        session.status = SessionStatus::Closed;
        session.save()?;

        let resolved = find_session_by_name_or_id(imported_id)?;
        assert_eq!(resolved, imported_id);

        crate::env::remove_var("JCODE_HOME");
        Ok(())
    }
}
