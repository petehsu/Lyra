use std::fs;
use std::path::{Path, PathBuf};

use rusqlite::{Connection, OptionalExtension, params};
use serde::de::DeserializeOwned;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

use super::clock::now_timestamp;
use super::context::{ContextLayer, ContextLayerKind, ContextSnapshot};
use super::event::{NewSessionEvent, SessionEventRecord};
use super::ids::{
    new_archive_id, new_artifact_id, new_browser_action_id, new_browser_target_id,
    new_completion_audit_id, new_context_snapshot_id, new_delivery_obligation_id,
    new_delivery_proof_id, new_event_id, new_follow_action_id, new_follow_frame_id,
    new_follow_session_id, new_policy_ref_id, new_provider_request_id, new_rollback_marker_id,
    new_runtime_turn_id, new_session_id, new_shared_memory_id, new_state_log_id, new_summary_id,
    new_tool_call_id, new_tool_result_id, new_trim_batch_id,
};
use super::projection::{AgentMemorySnapshot, TimelineProjectionItem};
use super::runtime_turn::{RuntimeTurnRecord, RuntimeTurnState, ToolResultStatus};
use super::schema::{
    AgentMemoryError, AgentMemoryResult, LARGE_PAYLOAD_INLINE_BYTES, SCHEMA_VERSION,
};
use super::session::{CreateSessionInput, SessionRecord, SessionStatus};
use super::shared::{SharedMemoryRecord, SharedMemoryStatus};
use super::trim::{TrimDecision, TrimJournalState};
use super::visibility::{
    EventRole, ModelContextPolicy, StorageEnum, UiPolicy, Visibility, is_timeline_visible,
};

#[derive(Clone, Debug)]
pub struct AgentMemoryStore {
    root: PathBuf,
}

impl AgentMemoryStore {
    pub fn new_default() -> AgentMemoryResult<Self> {
        if let Some(path) = std::env::var_os("LYRA_AGENT_MEMORY_HOME") {
            return Self::new(path);
        }
        if let Some(path) = std::env::var_os("LYRA_AGENT_HOME")
            .or_else(|| std::env::var_os("JCODE_HOME"))
            .map(PathBuf::from)
        {
            let root = if path.file_name().and_then(|name| name.to_str()) == Some("agent") {
                path.parent()
                    .map(|parent| parent.join("agent-memory"))
                    .unwrap_or_else(|| path.join("agent-memory"))
            } else {
                path.join("agent-memory")
            };
            return Self::new(root);
        }
        let home = dirs::home_dir().ok_or_else(|| {
            AgentMemoryError::recoverable("could not resolve home directory for agent memory root")
        })?;
        Self::new(home.join(".lyra").join("modules").join("agent-memory"))
    }

    pub fn new(root: impl Into<PathBuf>) -> AgentMemoryResult<Self> {
        let store = Self { root: root.into() };
        store.ensure_layout()?;
        Ok(store)
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn ensure_layout(&self) -> AgentMemoryResult<()> {
        for path in [
            self.root.join("sessions"),
            self.root.join("shared").join("projections"),
            self.root.join("artifacts").join("blobs"),
            self.root.join("artifacts").join("thumbnails"),
            self.root.join("jobs"),
            self.root.join("metrics"),
        ] {
            fs::create_dir_all(&path).map_err(|source| AgentMemoryError::io(path, source))?;
        }
        self.init_shared_truth_dbs()?;
        Ok(())
    }

    pub fn create_session(&self, input: CreateSessionInput) -> AgentMemoryResult<SessionRecord> {
        self.create_session_with_id(new_session_id(), input)
    }

    pub fn create_session_with_id(
        &self,
        session_id: impl Into<String>,
        input: CreateSessionInput,
    ) -> AgentMemoryResult<SessionRecord> {
        let timestamp = now_timestamp();
        let session_id = session_id.into();
        let session = SessionRecord {
            session_id: session_id.clone(),
            title: input
                .title
                .unwrap_or_else(|| "New Agent Session".to_string()),
            working_dir: input.working_dir,
            provider_key: input.provider_key,
            model: input.model,
            status: SessionStatus::Active,
            schema_version: SCHEMA_VERSION,
            created_at_ms: timestamp.ms,
            created_at_iso: timestamp.iso.clone(),
            updated_at_ms: timestamp.ms,
            updated_at_iso: timestamp.iso,
        };
        self.init_session_dbs(&session_id)?;
        let conn = self.session_conn(&session_id)?;
        conn.execute(
            "INSERT INTO session_meta (
                session_id, title, working_dir, provider_key, model, status, schema_version,
                created_at_ms, created_at_iso, updated_at_ms, updated_at_iso
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![
                &session.session_id,
                &session.title,
                &session.working_dir,
                &session.provider_key,
                &session.model,
                session.status.as_storage_str(),
                session.schema_version,
                session.created_at_ms,
                &session.created_at_iso,
                session.updated_at_ms,
                &session.updated_at_iso
            ],
        )?;
        Ok(session)
    }

    pub fn ensure_session_with_id(
        &self,
        session_id: &str,
        input: CreateSessionInput,
    ) -> AgentMemoryResult<SessionRecord> {
        if let Some(session) = self.read_session(session_id)? {
            return Ok(session);
        }
        self.create_session_with_id(session_id.to_string(), input)
    }

    pub fn read_session(&self, session_id: &str) -> AgentMemoryResult<Option<SessionRecord>> {
        if !self.session_dir(session_id).exists() {
            return Ok(None);
        }
        let conn = self.session_conn(session_id)?;
        let raw = conn
            .query_row(
                "SELECT session_id, title, working_dir, provider_key, model, status, schema_version,
                    created_at_ms, created_at_iso, updated_at_ms, updated_at_iso
                 FROM session_meta WHERE session_id = ?1",
                params![session_id],
                |row| {
                    Ok(RawSessionRecord {
                        session_id: row.get(0)?,
                        title: row.get(1)?,
                        working_dir: row.get(2)?,
                        provider_key: row.get(3)?,
                        model: row.get(4)?,
                        status: row.get(5)?,
                        schema_version: row.get(6)?,
                        created_at_ms: row.get(7)?,
                        created_at_iso: row.get(8)?,
                        updated_at_ms: row.get(9)?,
                        updated_at_iso: row.get(10)?,
                    })
                },
            )
            .optional()?;
        raw.map(raw_session_record).transpose()
    }

    pub fn list_sessions(&self) -> AgentMemoryResult<Vec<SessionRecord>> {
        let sessions_root = self.root.join("sessions");
        let mut sessions = Vec::new();
        if !sessions_root.exists() {
            return Ok(sessions);
        }
        let entries = fs::read_dir(&sessions_root)
            .map_err(|source| AgentMemoryError::io(sessions_root.clone(), source))?;
        for entry in entries {
            let entry = entry.map_err(|source| AgentMemoryError::io(&sessions_root, source))?;
            if !entry
                .file_type()
                .map_err(|source| AgentMemoryError::io(entry.path(), source))?
                .is_dir()
            {
                continue;
            }
            let session_id = entry.file_name().to_string_lossy().to_string();
            if let Some(session) = self.read_session(&session_id)? {
                if session.status != SessionStatus::DeletedByUser {
                    sessions.push(session);
                }
            }
        }
        sessions.sort_by(|left, right| right.updated_at_ms.cmp(&left.updated_at_ms));
        Ok(sessions)
    }

    pub fn delete_session(&self, session_id: &str) -> AgentMemoryResult<()> {
        let dir = self.session_dir(session_id);
        if dir.exists() {
            fs::remove_dir_all(&dir).map_err(|source| AgentMemoryError::io(dir, source))?;
        }
        Ok(())
    }

    pub fn update_session_status(
        &self,
        session_id: &str,
        status: SessionStatus,
    ) -> AgentMemoryResult<()> {
        let timestamp = now_timestamp();
        let conn = self.session_conn(session_id)?;
        conn.execute(
            "UPDATE session_meta
             SET status = ?1, updated_at_ms = ?2, updated_at_iso = ?3
             WHERE session_id = ?4",
            params![
                status.as_storage_str(),
                timestamp.ms,
                timestamp.iso,
                session_id
            ],
        )?;
        Ok(())
    }

    pub fn update_session_title(&self, session_id: &str, title: &str) -> AgentMemoryResult<()> {
        let timestamp = now_timestamp();
        let conn = self.session_conn(session_id)?;
        conn.execute(
            "UPDATE session_meta
             SET title = ?1, updated_at_ms = ?2, updated_at_iso = ?3
             WHERE session_id = ?4",
            params![title, timestamp.ms, timestamp.iso, session_id],
        )?;
        Ok(())
    }

    pub fn update_session_model_snapshot(
        &self,
        session_id: &str,
        working_dir: Option<&str>,
        provider_key: Option<&str>,
        model: Option<&str>,
    ) -> AgentMemoryResult<()> {
        let timestamp = now_timestamp();
        let conn = self.session_conn(session_id)?;
        conn.execute(
            "UPDATE session_meta
             SET working_dir = ?1, provider_key = ?2, model = ?3,
                 updated_at_ms = ?4, updated_at_iso = ?5
             WHERE session_id = ?6",
            params![
                working_dir,
                provider_key,
                model,
                timestamp.ms,
                timestamp.iso,
                session_id
            ],
        )?;
        Ok(())
    }

    pub fn append_event(
        &self,
        session_id: &str,
        event: NewSessionEvent,
    ) -> AgentMemoryResult<SessionEventRecord> {
        self.validate_event_visibility(&event)?;
        let timestamp = now_timestamp();
        let event_id = new_event_id();
        let payload_json = self.event_payload_for_storage(session_id, &event_id, &event.payload)?;
        let lineage_json = if event.lineage_json.is_null() {
            json!({})
        } else {
            event.lineage_json
        };
        let conn = self.event_conn(session_id)?;
        conn.execute(
            "INSERT INTO session_event (
                event_id, session_id, runtime_turn_id, kind, role, payload_json, visibility,
                model_context_policy, ui_policy, created_at_ms, created_at_iso, lineage_json
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
            params![
                &event_id,
                session_id,
                &event.runtime_turn_id,
                &event.kind,
                event.role.as_storage_str(),
                payload_json.to_string(),
                event.visibility.as_storage_str(),
                event.model_context_policy.as_storage_str(),
                event.ui_policy.as_storage_str(),
                timestamp.ms,
                &timestamp.iso,
                lineage_json.to_string()
            ],
        )?;
        conn.execute(
            "INSERT INTO event_lineage (event_id, lineage_json, created_at_ms, created_at_iso)
             VALUES (?1, ?2, ?3, ?4)",
            params![
                &event_id,
                lineage_json.to_string(),
                timestamp.ms,
                &timestamp.iso
            ],
        )?;
        if is_timeline_visible(event.visibility, event.ui_policy) {
            self.append_dialog_projection(session_id, &event_id)?;
        }
        self.touch_session(session_id)?;
        self.read_event_by_id(session_id, &event_id)?
            .ok_or_else(|| AgentMemoryError::corruption("appended event was not readable"))
    }

    pub fn read_events_by_session(
        &self,
        session_id: &str,
    ) -> AgentMemoryResult<Vec<SessionEventRecord>> {
        self.read_events_where(session_id, "", &[])
    }

    pub fn read_events_by_runtime_turn(
        &self,
        session_id: &str,
        runtime_turn_id: &str,
    ) -> AgentMemoryResult<Vec<SessionEventRecord>> {
        let conn = self.event_conn(session_id)?;
        let mut stmt = conn.prepare(
            "SELECT event_id, session_id, runtime_turn_id, kind, role, payload_json, visibility,
                model_context_policy, ui_policy, created_at_ms, created_at_iso, lineage_json
             FROM session_event
             WHERE runtime_turn_id = ?1
             ORDER BY created_at_ms, event_id",
        )?;
        let rows = stmt.query_map(params![runtime_turn_id], raw_event_from_row)?;
        rows.map(|row| raw_event_record(row?)).collect()
    }

    pub fn read_events_by_visibility(
        &self,
        session_id: &str,
        visibility: Visibility,
    ) -> AgentMemoryResult<Vec<SessionEventRecord>> {
        let conn = self.event_conn(session_id)?;
        let mut stmt = conn.prepare(
            "SELECT event_id, session_id, runtime_turn_id, kind, role, payload_json, visibility,
                model_context_policy, ui_policy, created_at_ms, created_at_iso, lineage_json
             FROM session_event
             WHERE visibility = ?1
             ORDER BY created_at_ms, event_id",
        )?;
        let rows = stmt.query_map(params![visibility.as_storage_str()], raw_event_from_row)?;
        rows.map(|row| raw_event_record(row?)).collect()
    }

    pub fn start_runtime_turn(
        &self,
        session_id: &str,
        user_message_id: Option<&str>,
        parent_runtime_turn_id: Option<&str>,
    ) -> AgentMemoryResult<RuntimeTurnRecord> {
        self.start_runtime_turn_with_id(
            session_id,
            new_runtime_turn_id(),
            user_message_id,
            parent_runtime_turn_id,
        )
    }

    pub fn start_runtime_turn_with_id(
        &self,
        session_id: &str,
        runtime_turn_id: impl Into<String>,
        user_message_id: Option<&str>,
        parent_runtime_turn_id: Option<&str>,
    ) -> AgentMemoryResult<RuntimeTurnRecord> {
        let timestamp = now_timestamp();
        let runtime_turn_id = runtime_turn_id.into();
        let record = RuntimeTurnRecord {
            runtime_turn_id: runtime_turn_id.clone(),
            session_id: session_id.to_string(),
            parent_runtime_turn_id: parent_runtime_turn_id.map(ToOwned::to_owned),
            user_message_id: user_message_id.map(ToOwned::to_owned),
            state: RuntimeTurnState::Queued,
            started_at_ms: timestamp.ms,
            started_at_iso: timestamp.iso.clone(),
            updated_at_ms: timestamp.ms,
            updated_at_iso: timestamp.iso.clone(),
            completed_at_ms: None,
            completed_at_iso: None,
            failure_kind: None,
            failure_detail_ref: None,
            latest_user_intent_ref: user_message_id.map(ToOwned::to_owned),
            active_task_ref: None,
            provider_request_ref: None,
            context_snapshot_ref: None,
            completion_audit_ref: None,
        };
        let conn = self.runtime_conn(session_id)?;
        conn.execute(
            "INSERT INTO runtime_turn (
                runtime_turn_id, session_id, parent_runtime_turn_id, user_message_id, state,
                started_at_ms, started_at_iso, updated_at_ms, updated_at_iso, completed_at_ms,
                completed_at_iso, failure_kind, failure_detail_ref, latest_user_intent_ref,
                active_task_ref, provider_request_ref, context_snapshot_ref, completion_audit_ref
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)",
            params![
                record.runtime_turn_id,
                record.session_id,
                record.parent_runtime_turn_id,
                record.user_message_id,
                record.state.as_storage_str(),
                record.started_at_ms,
                record.started_at_iso,
                record.updated_at_ms,
                record.updated_at_iso,
                record.completed_at_ms,
                record.completed_at_iso,
                record.failure_kind,
                record.failure_detail_ref,
                record.latest_user_intent_ref,
                record.active_task_ref,
                record.provider_request_ref,
                record.context_snapshot_ref,
                record.completion_audit_ref
            ],
        )?;
        self.insert_turn_state_log(
            &conn,
            &runtime_turn_id,
            RuntimeTurnState::Queued,
            "created",
            timestamp.ms,
            &timestamp.iso,
        )?;
        self.touch_session(session_id)?;
        self.read_runtime_turn(session_id, &runtime_turn_id)?
            .ok_or_else(|| AgentMemoryError::corruption("created runtime turn was not readable"))
    }

    pub fn transition_runtime_turn(
        &self,
        session_id: &str,
        runtime_turn_id: &str,
        state: RuntimeTurnState,
        reason: &str,
    ) -> AgentMemoryResult<()> {
        let timestamp = now_timestamp();
        let completed_at_ms = state.is_terminal().then_some(timestamp.ms);
        let completed_at_iso = state.is_terminal().then_some(timestamp.iso.clone());
        let conn = self.runtime_conn(session_id)?;
        conn.execute(
            "UPDATE runtime_turn
             SET state = ?1, updated_at_ms = ?2, updated_at_iso = ?3,
                 completed_at_ms = COALESCE(?4, completed_at_ms),
                 completed_at_iso = COALESCE(?5, completed_at_iso)
             WHERE runtime_turn_id = ?6",
            params![
                state.as_storage_str(),
                timestamp.ms,
                timestamp.iso,
                completed_at_ms,
                completed_at_iso,
                runtime_turn_id
            ],
        )?;
        self.insert_turn_state_log(
            &conn,
            runtime_turn_id,
            state,
            reason,
            timestamp.ms,
            &timestamp.iso,
        )?;
        self.touch_session(session_id)?;
        Ok(())
    }

    pub fn read_runtime_turn(
        &self,
        session_id: &str,
        runtime_turn_id: &str,
    ) -> AgentMemoryResult<Option<RuntimeTurnRecord>> {
        let conn = self.runtime_conn(session_id)?;
        let raw = conn
            .query_row(
                "SELECT runtime_turn_id, session_id, parent_runtime_turn_id, user_message_id,
                    state, started_at_ms, started_at_iso, updated_at_ms, updated_at_iso,
                    completed_at_ms, completed_at_iso, failure_kind, failure_detail_ref,
                    latest_user_intent_ref, active_task_ref, provider_request_ref,
                    context_snapshot_ref, completion_audit_ref
                 FROM runtime_turn WHERE runtime_turn_id = ?1",
                params![runtime_turn_id],
                raw_turn_from_row,
            )
            .optional()?;
        raw.map(raw_runtime_turn_record).transpose()
    }

    pub fn read_runtime_turns(
        &self,
        session_id: &str,
    ) -> AgentMemoryResult<Vec<RuntimeTurnRecord>> {
        let conn = self.runtime_conn(session_id)?;
        let mut stmt = conn.prepare(
            "SELECT runtime_turn_id, session_id, parent_runtime_turn_id, user_message_id,
                state, started_at_ms, started_at_iso, updated_at_ms, updated_at_iso,
                completed_at_ms, completed_at_iso, failure_kind, failure_detail_ref,
                latest_user_intent_ref, active_task_ref, provider_request_ref,
                context_snapshot_ref, completion_audit_ref
             FROM runtime_turn
             ORDER BY started_at_ms, runtime_turn_id",
        )?;
        let rows = stmt.query_map([], raw_turn_from_row)?;
        rows.map(|row| raw_runtime_turn_record(row?)).collect()
    }

    pub fn mark_active_turns_interrupted_by_reload(
        &self,
        session_id: &str,
    ) -> AgentMemoryResult<Vec<String>> {
        let active = self
            .read_runtime_turns(session_id)?
            .into_iter()
            .filter(|turn| !turn.state.is_terminal() && turn.state != RuntimeTurnState::Interrupted)
            .map(|turn| turn.runtime_turn_id)
            .collect::<Vec<_>>();
        if !active.is_empty() {
            let _ = self.append_event(
                session_id,
                NewSessionEvent::runtime_event(
                    "server_reloading",
                    None,
                    json!({ "interruptedTurnIds": active.clone() }),
                ),
            )?;
        }
        for turn_id in &active {
            self.transition_runtime_turn(
                session_id,
                turn_id,
                RuntimeTurnState::Interrupted,
                "server_reloading",
            )?;
            let _ = self.append_event(
                session_id,
                NewSessionEvent::runtime_event(
                    "turn_interrupted",
                    Some(turn_id.clone()),
                    json!({ "reason": "server_reloading" }),
                ),
            )?;
        }
        Ok(active)
    }

    pub fn recover_interrupted_turns_after_reload(
        &self,
        session_id: &str,
    ) -> AgentMemoryResult<Vec<String>> {
        let interrupted = self
            .read_runtime_turns(session_id)?
            .into_iter()
            .filter(|turn| turn.state == RuntimeTurnState::Interrupted)
            .map(|turn| turn.runtime_turn_id)
            .collect::<Vec<_>>();
        if !interrupted.is_empty() {
            let _ = self.append_event(
                session_id,
                NewSessionEvent::runtime_event(
                    "server_reloaded",
                    None,
                    json!({ "recoveredTurnIds": interrupted.clone() }),
                ),
            )?;
        }
        for turn_id in &interrupted {
            self.transition_runtime_turn(
                session_id,
                turn_id,
                RuntimeTurnState::RecoveringAfterReload,
                "server_reloaded",
            )?;
            let _ = self.append_event(
                session_id,
                NewSessionEvent::runtime_event(
                    "turn_recovered",
                    Some(turn_id.clone()),
                    json!({ "reason": "server_reloaded" }),
                ),
            )?;
        }
        Ok(interrupted)
    }

    pub fn record_tool_call_started(
        &self,
        session_id: &str,
        runtime_turn_id: &str,
        tool_call_id: &str,
        name: &str,
        input_json: Value,
    ) -> AgentMemoryResult<()> {
        let timestamp = now_timestamp();
        let conn = self.runtime_conn(session_id)?;
        conn.execute(
            "INSERT INTO tool_call (
                tool_call_id, runtime_turn_id, name, input_json, status, created_at_ms, created_at_iso
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT(tool_call_id) DO UPDATE SET
                name = excluded.name,
                input_json = excluded.input_json,
                status = excluded.status",
            params![
                tool_call_id,
                runtime_turn_id,
                name,
                input_json.to_string(),
                ToolResultStatus::Running.as_storage_str(),
                timestamp.ms,
                &timestamp.iso
            ],
        )?;
        let _ = self.append_event(
            session_id,
            NewSessionEvent {
                kind: "tool_call".to_string(),
                role: EventRole::Tool,
                payload: json!({
                    "toolCallId": tool_call_id,
                    "name": name,
                    "status": ToolResultStatus::Running.as_storage_str(),
                    "input": input_json
                }),
                visibility: Visibility::UserVisible,
                model_context_policy: ModelContextPolicy::IncludeAsRuntimeState,
                ui_policy: UiPolicy::ShowInTimeline,
                runtime_turn_id: Some(runtime_turn_id.to_string()),
                lineage_json: json!({ "toolCallId": tool_call_id }),
            },
        )?;
        Ok(())
    }

    pub fn append_tool_result(
        &self,
        session_id: &str,
        runtime_turn_id: &str,
        name: &str,
        status: ToolResultStatus,
        input_json: Value,
        output_json: Value,
        recommended_next_actions: Vec<String>,
    ) -> AgentMemoryResult<String> {
        let tool_call_id = new_tool_call_id();
        self.append_tool_result_for_call(
            session_id,
            runtime_turn_id,
            &tool_call_id,
            name,
            status,
            input_json,
            output_json,
            recommended_next_actions,
        )
    }

    pub fn append_tool_result_for_call(
        &self,
        session_id: &str,
        runtime_turn_id: &str,
        tool_call_id: &str,
        name: &str,
        status: ToolResultStatus,
        input_json: Value,
        output_json: Value,
        recommended_next_actions: Vec<String>,
    ) -> AgentMemoryResult<String> {
        let timestamp = now_timestamp();
        let tool_result_id = new_tool_result_id();
        let conn = self.runtime_conn(session_id)?;
        conn.execute(
            "INSERT INTO tool_call (
                tool_call_id, runtime_turn_id, name, input_json, status, created_at_ms, created_at_iso
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT(tool_call_id) DO UPDATE SET
                name = excluded.name,
                input_json = excluded.input_json,
                status = excluded.status",
            params![
                tool_call_id,
                runtime_turn_id,
                name,
                input_json.to_string(),
                status.as_storage_str(),
                timestamp.ms,
                &timestamp.iso
            ],
        )?;
        conn.execute(
            "INSERT INTO tool_result (
                tool_result_id, tool_call_id, runtime_turn_id, status, output_json,
                recommended_next_actions_json, created_at_ms, created_at_iso
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                &tool_result_id,
                tool_call_id,
                runtime_turn_id,
                status.as_storage_str(),
                output_json.to_string(),
                serde_json::to_string(&recommended_next_actions)?,
                timestamp.ms,
                &timestamp.iso
            ],
        )?;
        self.record_tool_refs(
            &conn,
            tool_call_id,
            &output_json,
            timestamp.ms,
            &timestamp.iso,
        )?;
        let _ = self.append_event(
            session_id,
            NewSessionEvent {
                kind: "tool_result".to_string(),
                role: EventRole::Tool,
                payload: json!({
                    "toolCallId": tool_call_id,
                    "toolResultId": tool_result_id.clone(),
                    "name": name,
                    "status": status.as_storage_str(),
                    "input": input_json,
                    "output": output_json,
                    "recommendedNextActions": recommended_next_actions
                }),
                visibility: Visibility::UserVisible,
                model_context_policy: ModelContextPolicy::IncludeAsRuntimeState,
                ui_policy: UiPolicy::ShowInTimeline,
                runtime_turn_id: Some(runtime_turn_id.to_string()),
                lineage_json: json!({ "toolCallId": tool_call_id }),
            },
        )?;
        if status == ToolResultStatus::UnknownAfterRecovery {
            let _ = self.append_event(
                session_id,
                NewSessionEvent::runtime_event(
                    "pending_tool_unknown_after_recovery",
                    Some(runtime_turn_id.to_string()),
                    json!({
                        "toolCallId": tool_call_id,
                        "toolResultId": tool_result_id.clone(),
                        "name": name
                    }),
                ),
            )?;
        }
        Ok(tool_result_id)
    }

    pub fn bind_provider_request(
        &self,
        session_id: &str,
        runtime_turn_id: &str,
        provider_request_ref: &str,
        context_snapshot_ref: Option<&str>,
    ) -> AgentMemoryResult<()> {
        let conn = self.runtime_conn(session_id)?;
        conn.execute(
            "UPDATE runtime_turn
             SET provider_request_ref = ?1,
                 context_snapshot_ref = COALESCE(?2, context_snapshot_ref)
             WHERE runtime_turn_id = ?3",
            params![provider_request_ref, context_snapshot_ref, runtime_turn_id],
        )?;
        Ok(())
    }

    pub fn record_provider_request_started(
        &self,
        session_id: &str,
        runtime_turn_id: &str,
        context_snapshot_ref: &str,
        tool_schema_snapshot_json: Value,
        provider_key: Option<&str>,
        model: Option<&str>,
        request_json: Value,
    ) -> AgentMemoryResult<String> {
        let timestamp = now_timestamp();
        let provider_request_id = new_provider_request_id();
        let conn = self.runtime_conn(session_id)?;
        conn.execute(
            "INSERT INTO provider_request (
                provider_request_id, runtime_turn_id, context_snapshot_ref,
                tool_schema_snapshot_json, provider_key, model, status, request_json,
                usage_json, error_json, created_at_ms, created_at_iso, completed_at_ms,
                completed_at_iso
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'started', ?7, NULL, NULL, ?8, ?9, NULL, NULL)",
            params![
                &provider_request_id,
                runtime_turn_id,
                context_snapshot_ref,
                tool_schema_snapshot_json.to_string(),
                provider_key,
                model,
                request_json.to_string(),
                timestamp.ms,
                &timestamp.iso
            ],
        )?;
        conn.execute(
            "UPDATE runtime_turn
             SET provider_request_ref = ?1, context_snapshot_ref = ?2
             WHERE runtime_turn_id = ?3",
            params![&provider_request_id, context_snapshot_ref, runtime_turn_id],
        )?;
        let _ = self.append_event(
            session_id,
            NewSessionEvent::runtime_event(
                "provider_request_started",
                Some(runtime_turn_id.to_string()),
                json!({
                    "providerRequestId": provider_request_id.clone(),
                    "contextSnapshotId": context_snapshot_ref,
                    "providerKey": provider_key,
                    "model": model
                }),
            ),
        )?;
        Ok(provider_request_id)
    }

    pub fn record_provider_request_finished(
        &self,
        session_id: &str,
        runtime_turn_id: &str,
        provider_request_id: &str,
        status: &str,
        usage_json: Option<Value>,
        error_json: Option<Value>,
    ) -> AgentMemoryResult<()> {
        let timestamp = now_timestamp();
        let usage_json_string = usage_json.as_ref().map(Value::to_string);
        let error_json_string = error_json.as_ref().map(Value::to_string);
        let conn = self.runtime_conn(session_id)?;
        conn.execute(
            "UPDATE provider_request
             SET status = ?1, usage_json = ?2, error_json = ?3,
                 completed_at_ms = ?4, completed_at_iso = ?5
             WHERE provider_request_id = ?6",
            params![
                status,
                usage_json_string.as_deref(),
                error_json_string.as_deref(),
                timestamp.ms,
                &timestamp.iso,
                provider_request_id
            ],
        )?;
        if matches!(status, "success" | "completed") {
            let completion_audit_id = new_completion_audit_id();
            conn.execute(
                "INSERT INTO completion_audit (
                    completion_audit_id, runtime_turn_id, provider_request_id, status,
                    usage_json, error_json, created_at_ms, created_at_iso
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![
                    &completion_audit_id,
                    runtime_turn_id,
                    provider_request_id,
                    status,
                    usage_json_string.as_deref(),
                    error_json_string.as_deref(),
                    timestamp.ms,
                    &timestamp.iso
                ],
            )?;
            conn.execute(
                "UPDATE runtime_turn SET completion_audit_ref = ?1 WHERE runtime_turn_id = ?2",
                params![completion_audit_id, runtime_turn_id],
            )?;
        }
        let _ = self.append_event(
            session_id,
            NewSessionEvent::runtime_event(
                "provider_request_finished",
                Some(runtime_turn_id.to_string()),
                json!({
                    "providerRequestId": provider_request_id,
                    "status": status,
                    "usage": usage_json,
                    "error": error_json
                }),
            ),
        )?;
        Ok(())
    }

    pub fn record_browser_action(
        &self,
        session_id: &str,
        runtime_turn_id: &str,
        workbench_tab_id: Option<&str>,
        lumen_target_id: Option<&str>,
        kind: &str,
        payload_json: Value,
    ) -> AgentMemoryResult<String> {
        let timestamp = now_timestamp();
        let browser_target_id = workbench_tab_id
            .map(|value| format!("workbench_tab:{value}"))
            .or_else(|| lumen_target_id.map(|value| format!("lumen_target:{value}")))
            .unwrap_or_else(new_browser_target_id);
        let browser_action_id = new_browser_action_id();
        let mut target_payload = payload_json;
        if let Value::Object(map) = &mut target_payload {
            map.insert(
                "browserTargetId".to_string(),
                json!(browser_target_id.clone()),
            );
            map.insert(
                "browserActionId".to_string(),
                json!(browser_action_id.clone()),
            );
        }
        let conn = self.runtime_conn(session_id)?;
        conn.execute(
            "INSERT INTO browser_target (
                browser_target_id, workbench_tab_id, lumen_target_id, payload_json, active,
                updated_at_ms, updated_at_iso
             ) VALUES (?1, ?2, ?3, ?4, 1, ?5, ?6)
             ON CONFLICT(browser_target_id) DO UPDATE SET
                workbench_tab_id = excluded.workbench_tab_id,
                lumen_target_id = excluded.lumen_target_id,
                payload_json = excluded.payload_json,
                active = 1,
                updated_at_ms = excluded.updated_at_ms,
                updated_at_iso = excluded.updated_at_iso",
            params![
                &browser_target_id,
                workbench_tab_id.unwrap_or("active"),
                lumen_target_id,
                target_payload.to_string(),
                timestamp.ms,
                &timestamp.iso
            ],
        )?;
        conn.execute(
            "INSERT INTO browser_action (
                browser_action_id, runtime_turn_id, browser_target_id, kind, payload_json,
                created_at_ms, created_at_iso
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                &browser_action_id,
                runtime_turn_id,
                &browser_target_id,
                kind,
                target_payload.to_string(),
                timestamp.ms,
                &timestamp.iso
            ],
        )?;
        let _ = self.append_event(
            session_id,
            NewSessionEvent {
                kind: "browser_target_updated".to_string(),
                role: EventRole::Runtime,
                payload: json!({
                    "browserTargetId": browser_target_id.clone(),
                    "browserActionId": browser_action_id.clone(),
                    "kind": kind,
                    "payload": target_payload
                }),
                visibility: Visibility::UserVisible,
                model_context_policy: ModelContextPolicy::IncludeAsRuntimeState,
                ui_policy: UiPolicy::ShowAsStatus,
                runtime_turn_id: Some(runtime_turn_id.to_string()),
                lineage_json: json!({ "browserActionId": browser_action_id.clone() }),
            },
        )?;
        Ok(browser_action_id)
    }

    pub fn record_follow_session(
        &self,
        session_id: &str,
        runtime_turn_id: &str,
        payload_json: Value,
        status: &str,
    ) -> AgentMemoryResult<String> {
        let timestamp = now_timestamp();
        let follow_session_id = new_follow_session_id();
        let conn = self.runtime_conn(session_id)?;
        conn.execute(
            "INSERT INTO follow_session (
                follow_session_id, runtime_turn_id, payload_json, status, created_at_ms,
                created_at_iso, updated_at_ms, updated_at_iso
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                &follow_session_id,
                runtime_turn_id,
                payload_json.to_string(),
                status,
                timestamp.ms,
                &timestamp.iso,
                timestamp.ms,
                &timestamp.iso
            ],
        )?;
        Ok(follow_session_id)
    }

    pub fn record_follow_action(
        &self,
        session_id: &str,
        follow_session_id: &str,
        kind: &str,
        payload_json: Value,
    ) -> AgentMemoryResult<String> {
        let timestamp = now_timestamp();
        let follow_action_id = new_follow_action_id();
        let conn = self.runtime_conn(session_id)?;
        conn.execute(
            "INSERT INTO follow_action (
                follow_action_id, follow_session_id, kind, payload_json, created_at_ms,
                created_at_iso
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                &follow_action_id,
                follow_session_id,
                kind,
                payload_json.to_string(),
                timestamp.ms,
                &timestamp.iso
            ],
        )?;
        Ok(follow_action_id)
    }

    pub fn record_follow_frame(
        &self,
        session_id: &str,
        follow_session_id: &str,
        payload_json: Value,
    ) -> AgentMemoryResult<String> {
        let timestamp = now_timestamp();
        let follow_frame_id = new_follow_frame_id();
        let conn = self.runtime_conn(session_id)?;
        conn.execute(
            "INSERT INTO follow_frame (
                follow_frame_id, follow_session_id, payload_json, created_at_ms, created_at_iso
             ) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                &follow_frame_id,
                follow_session_id,
                payload_json.to_string(),
                timestamp.ms,
                &timestamp.iso
            ],
        )?;
        Ok(follow_frame_id)
    }

    pub fn record_rollback_marker(
        &self,
        session_id: &str,
        runtime_turn_id: &str,
        payload_json: Value,
    ) -> AgentMemoryResult<String> {
        let timestamp = now_timestamp();
        let rollback_marker_id = new_rollback_marker_id();
        let conn = self.runtime_conn(session_id)?;
        conn.execute(
            "INSERT INTO rollback_marker (
                rollback_marker_id, runtime_turn_id, message_id, payload_json, created_at_ms,
                created_at_iso
             ) VALUES (?1, ?2, NULL, ?3, ?4, ?5)",
            params![
                &rollback_marker_id,
                runtime_turn_id,
                payload_json.to_string(),
                timestamp.ms,
                &timestamp.iso
            ],
        )?;
        Ok(rollback_marker_id)
    }

    pub fn record_rollback_marker_for_message(
        &self,
        session_id: &str,
        runtime_turn_id: Option<&str>,
        message_id: &str,
        payload_json: Value,
    ) -> AgentMemoryResult<String> {
        let timestamp = now_timestamp();
        let rollback_marker_id = payload_json
            .get("id")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned)
            .unwrap_or_else(new_rollback_marker_id);
        let conn = self.runtime_conn(session_id)?;
        conn.execute(
            "INSERT INTO rollback_marker (
                rollback_marker_id, runtime_turn_id, message_id, payload_json, created_at_ms,
                created_at_iso
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(rollback_marker_id) DO UPDATE SET
                runtime_turn_id = excluded.runtime_turn_id,
                message_id = excluded.message_id,
                payload_json = excluded.payload_json",
            params![
                &rollback_marker_id,
                runtime_turn_id,
                message_id,
                payload_json.to_string(),
                timestamp.ms,
                &timestamp.iso
            ],
        )?;
        Ok(rollback_marker_id)
    }

    pub fn rollback_marker_for_message(
        &self,
        session_id: &str,
        message_id: &str,
    ) -> AgentMemoryResult<Option<Value>> {
        let conn = self.runtime_conn(session_id)?;
        let raw = conn
            .query_row(
                "SELECT payload_json FROM rollback_marker
                 WHERE message_id = ?1
                 ORDER BY created_at_ms DESC, rollback_marker_id DESC
                 LIMIT 1",
                params![message_id],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        raw.map(parse_json_string).transpose()
    }

    pub fn rollback_markers(&self, session_id: &str) -> AgentMemoryResult<Vec<Value>> {
        let conn = self.runtime_conn(session_id)?;
        let mut stmt = conn.prepare(
            "SELECT payload_json FROM rollback_marker
             ORDER BY created_at_ms, rollback_marker_id",
        )?;
        let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
        rows.map(|row| parse_json_string(row?)).collect()
    }

    pub fn replace_rollback_markers_for_session(
        &self,
        session_id: &str,
        markers: &[Value],
    ) -> AgentMemoryResult<()> {
        let conn = self.runtime_conn(session_id)?;
        conn.execute("DELETE FROM rollback_marker", [])?;
        drop(conn);
        for marker in markers {
            let message_id = marker
                .get("messageId")
                .and_then(Value::as_str)
                .or_else(|| marker.get("message_id").and_then(Value::as_str))
                .unwrap_or_default();
            if message_id.is_empty() {
                continue;
            }
            let runtime_turn_id = marker
                .get("runtimeTurnId")
                .and_then(Value::as_str)
                .or_else(|| marker.get("runtime_turn_id").and_then(Value::as_str));
            self.record_rollback_marker_for_message(
                session_id,
                runtime_turn_id,
                message_id,
                marker.clone(),
            )?;
        }
        Ok(())
    }

    pub fn truncate_timeline_before_message(
        &self,
        session_id: &str,
        message_id: &str,
    ) -> AgentMemoryResult<usize> {
        let timeline = self.timeline_projection(session_id, 100_000)?;
        let Some(index) = timeline.iter().position(|event| {
            event.event_id == message_id
                || event
                    .payload_json
                    .get("messageId")
                    .and_then(Value::as_str)
                    .is_some_and(|value| value == message_id)
        }) else {
            return Err(AgentMemoryError::recoverable(format!(
                "message not found in session: {message_id}"
            )));
        };
        let removed = timeline.len().saturating_sub(index);
        let cutoff = &timeline[index];
        let conn = self.event_conn(session_id)?;
        let mut stmt = conn.prepare(
            "SELECT event_id FROM session_event
             WHERE created_at_ms > ?1 OR (created_at_ms = ?1 AND event_id >= ?2)",
        )?;
        let rows = stmt.query_map(params![cutoff.created_at_ms, &cutoff.event_id], |row| {
            row.get::<_, String>(0)
        })?;
        let event_ids = rows.collect::<Result<Vec<_>, _>>()?;
        drop(stmt);
        for event_id in &event_ids {
            conn.execute(
                "DELETE FROM event_lineage WHERE event_id = ?1",
                params![event_id],
            )?;
            conn.execute(
                "DELETE FROM event_payload WHERE event_id = ?1",
                params![event_id],
            )?;
        }
        conn.execute(
            "DELETE FROM session_event
             WHERE created_at_ms > ?1 OR (created_at_ms = ?1 AND event_id >= ?2)",
            params![cutoff.created_at_ms, &cutoff.event_id],
        )?;
        let session_conn = self.session_conn(session_id)?;
        session_conn.execute(
            "DELETE FROM session_dialog
             WHERE created_at_ms > ?1 OR (created_at_ms = ?1 AND event_id >= ?2)",
            params![cutoff.created_at_ms, &cutoff.event_id],
        )?;
        self.touch_session(session_id)?;
        Ok(removed)
    }

    pub fn record_active_todos(
        &self,
        session_id: &str,
        runtime_turn_id: &str,
        todos: &[Value],
    ) -> AgentMemoryResult<()> {
        self.record_active_todos_for_session(session_id, Some(runtime_turn_id), todos)
    }

    pub fn record_active_todos_for_session(
        &self,
        session_id: &str,
        runtime_turn_id: Option<&str>,
        todos: &[Value],
    ) -> AgentMemoryResult<()> {
        let timestamp = now_timestamp();
        let conn = self.runtime_conn(session_id)?;
        conn.execute("DELETE FROM active_todo", [])?;
        for todo in todos {
            let todo_id = todo
                .get("id")
                .and_then(Value::as_str)
                .unwrap_or("todo")
                .to_string();
            conn.execute(
                "INSERT INTO active_todo (
                    todo_id, runtime_turn_id, payload_json, created_at_ms, created_at_iso,
                    updated_at_ms, updated_at_iso
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
                 ON CONFLICT(todo_id) DO UPDATE SET
                    runtime_turn_id = excluded.runtime_turn_id,
                    payload_json = excluded.payload_json,
                    updated_at_ms = excluded.updated_at_ms,
                    updated_at_iso = excluded.updated_at_iso",
                params![
                    todo_id,
                    runtime_turn_id,
                    todo.to_string(),
                    timestamp.ms,
                    &timestamp.iso,
                    timestamp.ms,
                    &timestamp.iso
                ],
            )?;
        }
        self.record_pinned_state(
            session_id,
            "active_todos",
            json!({ "activeTodos": todos }),
            runtime_turn_id,
            todos
                .iter()
                .filter_map(|todo| {
                    todo.get("id")
                        .and_then(Value::as_str)
                        .map(ToOwned::to_owned)
                })
                .collect(),
        )?;
        let _ = self.append_event(
            session_id,
            NewSessionEvent {
                kind: "todo_updated".to_string(),
                role: EventRole::Runtime,
                payload: json!({ "activeTodos": todos }),
                visibility: Visibility::ModelContextOnly,
                model_context_policy: ModelContextPolicy::IncludeAsRuntimeState,
                ui_policy: UiPolicy::ShowAsStatus,
                runtime_turn_id: runtime_turn_id.map(ToOwned::to_owned),
                lineage_json: json!({}),
            },
        )?;
        Ok(())
    }

    pub fn record_active_process(
        &self,
        session_id: &str,
        runtime_turn_id: Option<&str>,
        pid: u32,
        kind: &str,
        payload_json: Value,
    ) -> AgentMemoryResult<()> {
        let timestamp = now_timestamp();
        let process_id = format!("session:{session_id}:pid:{pid}");
        let conn = self.runtime_conn(session_id)?;
        conn.execute(
            "INSERT INTO active_process (
                process_id, runtime_turn_id, pid, kind, payload_json, status,
                created_at_ms, created_at_iso, updated_at_ms, updated_at_iso
             ) VALUES (?1, ?2, ?3, ?4, ?5, 'active', ?6, ?7, ?8, ?9)
             ON CONFLICT(process_id) DO UPDATE SET
                runtime_turn_id = excluded.runtime_turn_id,
                pid = excluded.pid,
                kind = excluded.kind,
                payload_json = excluded.payload_json,
                status = 'active',
                updated_at_ms = excluded.updated_at_ms,
                updated_at_iso = excluded.updated_at_iso",
            params![
                &process_id,
                runtime_turn_id,
                pid as i64,
                kind,
                payload_json.to_string(),
                timestamp.ms,
                &timestamp.iso,
                timestamp.ms,
                &timestamp.iso
            ],
        )?;
        Ok(())
    }

    pub fn mark_active_process_stopped(
        &self,
        session_id: &str,
        pid: Option<u32>,
    ) -> AgentMemoryResult<()> {
        let timestamp = now_timestamp();
        let conn = self.runtime_conn(session_id)?;
        match pid {
            Some(pid) => {
                conn.execute(
                    "UPDATE active_process
                     SET status = 'stopped', updated_at_ms = ?1, updated_at_iso = ?2
                     WHERE pid = ?3 AND status = 'active'",
                    params![timestamp.ms, timestamp.iso, pid as i64],
                )?;
            }
            None => {
                conn.execute(
                    "UPDATE active_process
                     SET status = 'stopped', updated_at_ms = ?1, updated_at_iso = ?2
                     WHERE status = 'active'",
                    params![timestamp.ms, timestamp.iso],
                )?;
            }
        }
        Ok(())
    }

    pub fn active_process_session_ids(&self) -> AgentMemoryResult<Vec<String>> {
        let mut ids = Vec::new();
        for session in self.list_sessions()? {
            let conn = self.runtime_conn(&session.session_id)?;
            let count: i64 = conn.query_row(
                "SELECT COUNT(*) FROM active_process WHERE status = 'active'",
                [],
                |row| row.get(0),
            )?;
            if count > 0 {
                ids.push(session.session_id);
            }
        }
        Ok(ids)
    }

    pub fn active_session_id_by_pid(&self, pid: u32) -> AgentMemoryResult<Option<String>> {
        for session in self.list_sessions()? {
            let conn = self.runtime_conn(&session.session_id)?;
            let exists: Option<i64> = conn
                .query_row(
                    "SELECT 1 FROM active_process
                     WHERE pid = ?1 AND status = 'active'
                     LIMIT 1",
                    params![pid as i64],
                    |row| row.get(0),
                )
                .optional()?;
            if exists.is_some() {
                return Ok(Some(session.session_id));
            }
        }
        Ok(None)
    }

    pub fn record_clarification_request(
        &self,
        session_id: &str,
        runtime_turn_id: &str,
        clarification_id: &str,
        payload_json: Value,
    ) -> AgentMemoryResult<()> {
        let timestamp = now_timestamp();
        let conn = self.runtime_conn(session_id)?;
        conn.execute(
            "INSERT INTO runtime_blocker (
                blocker_id, runtime_turn_id, kind, payload_json, created_at_ms, created_at_iso,
                resolved_at_ms, resolved_at_iso
             ) VALUES (?1, ?2, 'clarification', ?3, ?4, ?5, NULL, NULL)
             ON CONFLICT(blocker_id) DO UPDATE SET
                payload_json = excluded.payload_json,
                resolved_at_ms = NULL,
                resolved_at_iso = NULL",
            params![
                clarification_id,
                runtime_turn_id,
                payload_json.to_string(),
                timestamp.ms,
                &timestamp.iso
            ],
        )?;
        let _ = self.append_event(
            session_id,
            NewSessionEvent {
                kind: "clarification_request".to_string(),
                role: EventRole::Runtime,
                payload: payload_json,
                visibility: Visibility::UserVisible,
                model_context_policy: ModelContextPolicy::IncludeAsRuntimeState,
                ui_policy: UiPolicy::ShowAsStatus,
                runtime_turn_id: Some(runtime_turn_id.to_string()),
                lineage_json: json!({ "clarificationId": clarification_id }),
            },
        )?;
        Ok(())
    }

    pub fn resolve_clarification(
        &self,
        session_id: &str,
        runtime_turn_id: &str,
        clarification_id: &str,
        payload_json: Value,
    ) -> AgentMemoryResult<()> {
        let timestamp = now_timestamp();
        let conn = self.runtime_conn(session_id)?;
        conn.execute(
            "UPDATE runtime_blocker
             SET resolved_at_ms = ?1, resolved_at_iso = ?2
             WHERE blocker_id = ?3 AND kind = 'clarification'",
            params![timestamp.ms, &timestamp.iso, clarification_id],
        )?;
        let _ = self.append_event(
            session_id,
            NewSessionEvent {
                kind: "clarification_resolved".to_string(),
                role: EventRole::Runtime,
                payload: payload_json,
                visibility: Visibility::UserVisible,
                model_context_policy: ModelContextPolicy::IncludeAsRuntimeState,
                ui_policy: UiPolicy::ShowAsStatus,
                runtime_turn_id: Some(runtime_turn_id.to_string()),
                lineage_json: json!({ "clarificationId": clarification_id }),
            },
        )?;
        Ok(())
    }

    pub fn build_context(
        &self,
        session_id: &str,
        runtime_turn_id: &str,
        model_context_window: i64,
    ) -> AgentMemoryResult<ContextSnapshot> {
        self.transition_runtime_turn(
            session_id,
            runtime_turn_id,
            RuntimeTurnState::AssemblingContext,
            "context_assembler",
        )?;
        let timestamp = now_timestamp();
        let context_snapshot_id = new_context_snapshot_id();
        let turn = self.read_runtime_turn(session_id, runtime_turn_id)?;
        let turn_count = self.read_runtime_turns(session_id)?.len() as i64;
        let head_budget = ((model_context_window / 20) / (1 + turn_count / 20)).max(1);
        let latest_user_intent = self.latest_user_visible_event(session_id, EventRole::User)?;
        let tail = self.timeline_projection(session_id, 24)?;
        let active_todos = self.active_todos(session_id)?;
        let unresolved_commitments =
            self.pinned_state_values(session_id, "unresolved_commitments")?;
        let active_follow_sessions = self.active_follow_sessions(session_id)?;
        let security_project_policy_refs = self.active_policy_refs(session_id)?;
        let delivery_obligations = self.active_delivery_obligations(session_id)?;
        let middle_anchors = self.middle_anchors(session_id, 12)?;
        let head = self.head_events(session_id, 8)?;
        let retrieved_archives = self.retrieved_archives(session_id, 16)?;
        let layers = vec![
            ContextLayer {
                kind: ContextLayerKind::SystemContract,
                priority: 1000,
                token_budget: model_context_window / 5,
                payload_json: json!({
                    "contract": "Lyra runtime provides structured state; do not infer reset, reload, recovery, todo, or provider state from raw text markers."
                }),
                source_refs: Vec::new(),
            },
            ContextLayer {
                kind: ContextLayerKind::RuntimeState,
                priority: 950,
                token_budget: model_context_window / 10,
                payload_json: json!({ "runtimeTurn": turn }),
                source_refs: vec![runtime_turn_id.to_string()],
            },
            ContextLayer {
                kind: ContextLayerKind::LatestUserIntent,
                priority: 900,
                token_budget: model_context_window / 8,
                payload_json: json!({ "event": latest_user_intent }),
                source_refs: latest_user_intent
                    .as_ref()
                    .map(|event| vec![event.event_id.clone()])
                    .unwrap_or_default(),
            },
            ContextLayer {
                kind: ContextLayerKind::Pinned,
                priority: 850,
                token_budget: model_context_window / 8,
                payload_json: json!({
                    "activeTodos": active_todos,
                    "unresolvedCommitments": unresolved_commitments,
                    "activeToolWaits": self.active_tool_waits(session_id)?,
                    "activeBrowserTargets": self.active_browser_targets(session_id)?,
                    "activeFollowSessions": active_follow_sessions,
                    "securityProjectPolicyRefs": security_project_policy_refs,
                    "deliveryObligations": delivery_obligations
                }),
                source_refs: Vec::new(),
            },
            ContextLayer {
                kind: ContextLayerKind::Tail,
                priority: 500,
                token_budget: model_context_window / 2,
                payload_json: json!({ "timeline": tail }),
                source_refs: Vec::new(),
            },
            ContextLayer {
                kind: ContextLayerKind::ToolCapabilitySnapshot,
                priority: 450,
                token_budget: model_context_window / 12,
                payload_json: json!({
                    "tools": "provider request tool schema snapshot is bound by runtime to this context snapshot"
                }),
                source_refs: Vec::new(),
            },
            ContextLayer {
                kind: ContextLayerKind::MiddleAnchors,
                priority: 400,
                token_budget: model_context_window / 12,
                source_refs: source_refs_from_values(&middle_anchors, "eventId"),
                payload_json: json!({ "anchors": middle_anchors }),
            },
            ContextLayer {
                kind: ContextLayerKind::Head,
                priority: 350,
                token_budget: head_budget,
                source_refs: source_refs_from_values(&head, "eventId"),
                payload_json: json!({ "head": head }),
            },
            ContextLayer {
                kind: ContextLayerKind::RetrievedArchives,
                priority: 300,
                token_budget: model_context_window / 10,
                source_refs: source_refs_from_values(&retrieved_archives, "archiveId"),
                payload_json: json!({ "archives": retrieved_archives }),
            },
            ContextLayer {
                kind: ContextLayerKind::SharedFrozenMemory,
                priority: 250,
                token_budget: model_context_window / 10,
                payload_json: json!({ "active": self.active_shared_memory()? }),
                source_refs: Vec::new(),
            },
        ];
        let snapshot = ContextSnapshot {
            context_snapshot_id: context_snapshot_id.clone(),
            session_id: session_id.to_string(),
            runtime_turn_id: runtime_turn_id.to_string(),
            model_context_window,
            created_at_ms: timestamp.ms,
            created_at_iso: timestamp.iso.clone(),
            layers,
        };
        let conn = self.context_conn(session_id)?;
        conn.execute(
            "INSERT INTO context_snapshot (
                context_snapshot_id, session_id, runtime_turn_id, model_context_window,
                created_at_ms, created_at_iso
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                &snapshot.context_snapshot_id,
                &snapshot.session_id,
                &snapshot.runtime_turn_id,
                snapshot.model_context_window,
                snapshot.created_at_ms,
                &snapshot.created_at_iso
            ],
        )?;
        for layer in &snapshot.layers {
            conn.execute(
                "INSERT INTO context_layer (
                    context_snapshot_id, kind, priority, token_budget, payload_json, source_refs_json
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    &context_snapshot_id,
                    layer.kind.as_storage_str(),
                    layer.priority,
                    layer.token_budget,
                    layer.payload_json.to_string(),
                    serde_json::to_string(&layer.source_refs)?
                ],
            )?;
        }
        for layer in &snapshot.layers {
            for source_ref in &layer.source_refs {
                conn.execute(
                    "INSERT OR IGNORE INTO context_source_ref (
                        context_snapshot_id, source_ref, source_kind
                     ) VALUES (?1, ?2, ?3)",
                    params![
                        &context_snapshot_id,
                        source_ref,
                        layer.kind.as_storage_str()
                    ],
                )?;
            }
        }
        let runtime_conn = self.runtime_conn(session_id)?;
        runtime_conn.execute(
            "UPDATE runtime_turn SET context_snapshot_ref = ?1 WHERE runtime_turn_id = ?2",
            params![context_snapshot_id, runtime_turn_id],
        )?;
        let _ = self.append_event(
            session_id,
            NewSessionEvent::runtime_event(
                "recovery_context_created",
                Some(runtime_turn_id.to_string()),
                json!({ "contextSnapshotId": context_snapshot_id }),
            ),
        )?;
        Ok(snapshot)
    }

    pub fn create_summary_projection(
        &self,
        session_id: &str,
        source_event_range: Option<(String, String)>,
        source_archive_refs: Vec<String>,
        created_by: &str,
        confidence: f64,
        known_omissions: Vec<String>,
        latest_user_intent_at_creation: Option<String>,
    ) -> AgentMemoryResult<String> {
        let timestamp = now_timestamp();
        let summary_id = new_summary_id();
        let conn = self.context_conn(session_id)?;
        conn.execute(
            "INSERT INTO summary_projection (
                summary_id, source_event_range_json, source_archive_refs_json, created_by,
                created_at_ms, confidence, known_omissions_json, latest_user_intent_at_creation
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                &summary_id,
                serde_json::to_string(&source_event_range)?,
                serde_json::to_string(&source_archive_refs)?,
                created_by,
                timestamp.ms,
                confidence,
                serde_json::to_string(&known_omissions)?,
                latest_user_intent_at_creation
            ],
        )?;
        Ok(summary_id)
    }

    pub fn snapshot(&self, session_id: &str) -> AgentMemoryResult<AgentMemorySnapshot> {
        let session = self.read_session(session_id)?;
        let runtime_turns = self.read_runtime_turns(session_id)?;
        let status = runtime_turns
            .iter()
            .rev()
            .find(|turn| !turn.state.is_terminal())
            .map(|turn| turn.state.as_storage_str().to_string())
            .or_else(|| {
                session
                    .as_ref()
                    .map(|session| session.status.as_storage_str().to_string())
            })
            .unwrap_or_else(|| "missing".to_string());
        Ok(AgentMemorySnapshot {
            provider_label: session
                .as_ref()
                .and_then(|session| session.provider_key.clone()),
            model_label: session.as_ref().and_then(|session| session.model.clone()),
            session,
            runtime_turns,
            timeline_projection: self.timeline_projection(session_id, 500)?,
            active_todos: self.active_todos(session_id)?,
            active_browser_targets: self.active_browser_targets(session_id)?,
            active_clarification: self.active_clarification(session_id)?,
            status,
        })
    }

    pub fn active_todos_for_session(&self, session_id: &str) -> AgentMemoryResult<Vec<Value>> {
        self.active_todos(session_id)
    }

    pub fn latest_open_runtime_turn_id(
        &self,
        session_id: &str,
    ) -> AgentMemoryResult<Option<String>> {
        Ok(self
            .read_runtime_turns(session_id)?
            .into_iter()
            .rev()
            .find(|turn| !turn.state.is_terminal())
            .map(|turn| turn.runtime_turn_id))
    }

    pub fn record_pinned_state(
        &self,
        session_id: &str,
        kind: &str,
        payload_json: Value,
        runtime_turn_id: Option<&str>,
        source_refs: Vec<String>,
    ) -> AgentMemoryResult<()> {
        let timestamp = now_timestamp();
        let conn = self.runtime_conn(session_id)?;
        conn.execute(
            "INSERT INTO pinned_state (
                kind, runtime_turn_id, payload_json, source_refs_json, active,
                created_at_ms, created_at_iso, updated_at_ms, updated_at_iso
             ) VALUES (?1, ?2, ?3, ?4, 1, ?5, ?6, ?7, ?8)
             ON CONFLICT(kind) DO UPDATE SET
                runtime_turn_id = excluded.runtime_turn_id,
                payload_json = excluded.payload_json,
                source_refs_json = excluded.source_refs_json,
                active = 1,
                updated_at_ms = excluded.updated_at_ms,
                updated_at_iso = excluded.updated_at_iso",
            params![
                kind,
                runtime_turn_id,
                payload_json.to_string(),
                serde_json::to_string(&source_refs)?,
                timestamp.ms,
                &timestamp.iso,
                timestamp.ms,
                &timestamp.iso
            ],
        )?;
        Ok(())
    }

    pub fn record_delivery_obligation(
        &self,
        session_id: &str,
        runtime_turn_id: Option<&str>,
        payload_json: Value,
        status: &str,
    ) -> AgentMemoryResult<String> {
        let timestamp = now_timestamp();
        let delivery_obligation_id = new_delivery_obligation_id();
        let conn = self.runtime_conn(session_id)?;
        conn.execute(
            "INSERT INTO delivery_obligation (
                delivery_obligation_id, runtime_turn_id, payload_json, status,
                created_at_ms, created_at_iso, updated_at_ms, updated_at_iso
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                &delivery_obligation_id,
                runtime_turn_id,
                payload_json.to_string(),
                status,
                timestamp.ms,
                &timestamp.iso,
                timestamp.ms,
                &timestamp.iso
            ],
        )?;
        Ok(delivery_obligation_id)
    }

    pub fn record_delivery_proof(
        &self,
        session_id: &str,
        delivery_obligation_id: &str,
        payload_json: Value,
    ) -> AgentMemoryResult<String> {
        let timestamp = now_timestamp();
        let delivery_proof_id = new_delivery_proof_id();
        let conn = self.runtime_conn(session_id)?;
        conn.execute(
            "INSERT INTO delivery_proof (
                delivery_proof_id, delivery_obligation_id, payload_json, created_at_ms,
                created_at_iso
             ) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                &delivery_proof_id,
                delivery_obligation_id,
                payload_json.to_string(),
                timestamp.ms,
                &timestamp.iso
            ],
        )?;
        Ok(delivery_proof_id)
    }

    pub fn record_policy_ref(
        &self,
        session_id: &str,
        runtime_turn_id: Option<&str>,
        payload_json: Value,
        status: &str,
    ) -> AgentMemoryResult<String> {
        let timestamp = now_timestamp();
        let policy_ref_id = new_policy_ref_id();
        let conn = self.runtime_conn(session_id)?;
        conn.execute(
            "INSERT INTO policy_ref (
                policy_ref_id, runtime_turn_id, payload_json, status, created_at_ms,
                created_at_iso, updated_at_ms, updated_at_iso
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                &policy_ref_id,
                runtime_turn_id,
                payload_json.to_string(),
                status,
                timestamp.ms,
                &timestamp.iso,
                timestamp.ms,
                &timestamp.iso
            ],
        )?;
        Ok(policy_ref_id)
    }

    pub fn run_adaptive_trim(
        &self,
        session_id: &str,
        token_budget: Option<i64>,
        char_budget: Option<i64>,
    ) -> AgentMemoryResult<TrimDecision> {
        let timestamp = now_timestamp();
        let trim_batch_id = new_trim_batch_id();
        let payload = json!({
            "tokenBudget": token_budget,
            "charBudget": char_budget,
            "policy": "archive_before_live_compaction"
        });
        let cut_path = self
            .session_dir(session_id)
            .join("cuts")
            .join("cut_pack_0001.sqlite");
        let conn = Connection::open(&cut_path)?;
        let events = self.read_events_by_session(session_id)?;
        let archive_candidates = events
            .iter()
            .filter(|event| {
                matches!(
                    event.visibility,
                    Visibility::UserVisible | Visibility::ModelContextOnly
                )
            })
            .take(events.len().saturating_sub(24))
            .collect::<Vec<_>>();
        conn.execute(
            "INSERT INTO trim_journal (
                trim_batch_id, state, payload_json, created_at_ms, created_at_iso,
                updated_at_ms, updated_at_iso
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                &trim_batch_id,
                TrimJournalState::PendingTrim.as_storage_str(),
                payload.to_string(),
                timestamp.ms,
                &timestamp.iso,
                timestamp.ms,
                &timestamp.iso
            ],
        )?;
        let mut seen_digests = std::collections::HashMap::<String, String>::new();
        for event in archive_candidates {
            let archive_id = new_archive_id();
            let content_raw = event.payload_json.to_string();
            let content_normalized = content_raw.split_whitespace().collect::<Vec<_>>().join(" ");
            let raw_digest = sha256_hex(content_raw.as_bytes());
            let normalized_digest = sha256_hex(content_normalized.as_bytes());
            conn.execute(
                "INSERT INTO cut_payload (
                    archive_id, source_session_id, source_event_start_id, source_event_end_id,
                    role, content_raw, content_normalized, content_kind, token_count_raw,
                    char_count_raw, token_count_normalized, char_count_normalized, raw_digest,
                    normalized_digest, trim_batch_id, lineage_json, created_at_ms, created_at_iso
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, NULL, ?9, NULL, ?10, ?11, ?12, ?13, ?14, ?15, ?16)",
                params![
                    &archive_id,
                    session_id,
                    &event.event_id,
                    &event.event_id,
                    event.role.as_storage_str(),
                    &content_raw,
                    &content_normalized,
                    &event.kind,
                    content_raw.chars().count() as i64,
                    content_normalized.chars().count() as i64,
                    &raw_digest,
                    &normalized_digest,
                    &trim_batch_id,
                    event.lineage_json.to_string(),
                    timestamp.ms,
                    &timestamp.iso
                ],
            )?;
            if let Some(source_archive_id) = seen_digests.get(&normalized_digest) {
                conn.execute(
                    "INSERT INTO cut_refs (
                        dedupe_ref_id, source_archive_id, target_archive_id, dedupe_reason,
                        similarity_score, created_at_ms, created_at_iso
                     ) VALUES (?1, ?2, ?3, 'exact', 1.0, ?4, ?5)",
                    params![
                        format!("dedupe_{archive_id}"),
                        source_archive_id,
                        &archive_id,
                        timestamp.ms,
                        &timestamp.iso
                    ],
                )?;
            } else {
                seen_digests.insert(normalized_digest, archive_id);
            }
        }
        conn.execute(
            "INSERT INTO cut_meta (
                trim_batch_id, pack_id, omitted_span_summary, state, created_at_ms, created_at_iso
             ) VALUES (?1, 'cut_pack_0001', NULL, ?2, ?3, ?4)",
            params![
                &trim_batch_id,
                TrimJournalState::Archived.as_storage_str(),
                timestamp.ms,
                &timestamp.iso
            ],
        )?;
        conn.execute(
            "INSERT OR REPLACE INTO cut_shard_map (
                trim_batch_id, pack_id, pack_path
             ) VALUES (?1, 'cut_pack_0001', ?2)",
            params![&trim_batch_id, cut_path.to_string_lossy().to_string()],
        )?;
        conn.execute(
            "UPDATE trim_journal
             SET state = ?1, updated_at_ms = ?2, updated_at_iso = ?3
             WHERE trim_batch_id = ?4",
            params![
                TrimJournalState::Archived.as_storage_str(),
                timestamp.ms,
                &timestamp.iso,
                &trim_batch_id
            ],
        )?;
        let _ = self.append_event(
            session_id,
            NewSessionEvent::runtime_event(
                "context_trimmed",
                None,
                json!({
                    "trimBatchId": trim_batch_id.clone(),
                    "state": TrimJournalState::Archived.as_storage_str()
                }),
            ),
        )?;
        let manifest_path = self
            .session_dir(session_id)
            .join("manifests")
            .join("cuts.manifest.json");
        let manifest = json!({
            "schemaVersion": SCHEMA_VERSION,
            "sessionId": session_id,
            "latestTrimBatchId": trim_batch_id,
            "packs": [{
                "packId": "cut_pack_0001",
                "path": cut_path.to_string_lossy().to_string()
            }]
        });
        fs::write(&manifest_path, serde_json::to_vec_pretty(&manifest)?)
            .map_err(|source| AgentMemoryError::io(&manifest_path, source))?;
        Ok(TrimDecision {
            trim_batch_id,
            session_id: session_id.to_string(),
            reason: "manual_or_runtime_trim".to_string(),
            token_budget,
            char_budget,
            state: TrimJournalState::Archived,
        })
    }

    pub fn search_shared_memory(
        &self,
        query: Option<&str>,
    ) -> AgentMemoryResult<Vec<SharedMemoryRecord>> {
        self.search_shared_memory_scoped(query, None)
    }

    pub fn search_shared_memory_scoped(
        &self,
        query: Option<&str>,
        scope: Option<&str>,
    ) -> AgentMemoryResult<Vec<SharedMemoryRecord>> {
        let mut records =
            self.read_shared_memory_db("shared_truth.sqlite", SharedMemoryStatus::Active)?;
        if let Some(scope) = scope.map(str::trim).filter(|scope| !scope.is_empty()) {
            records.retain(|record| record.scope == scope);
        }
        if let Some(query) = query.map(str::trim).filter(|query| !query.is_empty()) {
            let query = query.to_lowercase();
            records.retain(|record| shared_memory_matches_query(record, &query));
        }
        Ok(records)
    }

    pub fn deprecate_shared_memory(&self, memory_id: &str) -> AgentMemoryResult<bool> {
        let timestamp = now_timestamp();
        let conn = Connection::open(self.root.join("shared").join("shared_truth.sqlite"))?;
        let updated = conn.execute(
            "UPDATE memory_truth
             SET status = ?1, updated_at_ms = ?2, updated_at_iso = ?3
             WHERE memory_id = ?4 AND status = ?5",
            params![
                SharedMemoryStatus::Deprecated.as_storage_str(),
                timestamp.ms,
                timestamp.iso,
                memory_id,
                SharedMemoryStatus::Active.as_storage_str()
            ],
        )?;
        Ok(updated > 0)
    }

    pub fn infer_shared_memory_status(
        &self,
        scope: &str,
        content_json: &Value,
        evidence_refs: &[String],
        negative: bool,
    ) -> AgentMemoryResult<SharedMemoryStatus> {
        if evidence_refs.is_empty() || negative || content_json == &Value::Null {
            return Ok(SharedMemoryStatus::Candidate);
        }

        let content_digest = sha256_hex(content_json.to_string().as_bytes());
        let active_records =
            self.read_shared_memory_db("shared_truth.sqlite", SharedMemoryStatus::Active)?;
        let has_conflicting_active = active_records.iter().any(|record| {
            record.scope == scope
                && sha256_hex(record.content_json.to_string().as_bytes()) != content_digest
        });
        if has_conflicting_active {
            return Ok(SharedMemoryStatus::ConflictCandidate);
        }

        let evidence_score = (evidence_refs.len() as f64 / 3.0).min(1.0);
        let structure_score = shared_memory_structure_score(content_json);
        let score = (evidence_score * 0.7) + (structure_score * 0.3);
        if score >= 0.72 {
            Ok(SharedMemoryStatus::DelayedPromotion)
        } else {
            Ok(SharedMemoryStatus::Candidate)
        }
    }

    pub fn update_shared_memory(
        &self,
        scope: &str,
        content_json: Value,
        evidence_refs: Vec<String>,
        status: SharedMemoryStatus,
        negative: bool,
    ) -> AgentMemoryResult<SharedMemoryRecord> {
        let timestamp = now_timestamp();
        let memory_id = new_shared_memory_id();
        let evidence_refs = if evidence_refs.is_empty() {
            vec![format!("manual:{memory_id}")]
        } else {
            evidence_refs
        };
        let conn = Connection::open(self.root.join("shared").join("shared_truth.sqlite"))?;
        conn.execute(
            "INSERT INTO memory_truth (
                memory_id, scope, status, content_json, evidence_refs_json, conflict_set_id,
                negative, created_at_ms, created_at_iso, updated_at_ms, updated_at_iso
             ) VALUES (?1, ?2, ?3, ?4, ?5, NULL, ?6, ?7, ?8, ?9, ?10)",
            params![
                &memory_id,
                scope,
                status.as_storage_str(),
                content_json.to_string(),
                serde_json::to_string(&evidence_refs)?,
                if negative { 1_i64 } else { 0_i64 },
                timestamp.ms,
                &timestamp.iso,
                timestamp.ms,
                &timestamp.iso
            ],
        )?;
        Ok(SharedMemoryRecord {
            memory_id,
            scope: scope.to_string(),
            status,
            content_json,
            evidence_refs,
            conflict_set_id: None,
            negative,
            created_at_ms: timestamp.ms,
            created_at_iso: timestamp.iso.clone(),
            updated_at_ms: timestamp.ms,
            updated_at_iso: timestamp.iso,
        })
    }

    pub fn timeline_projection(
        &self,
        session_id: &str,
        limit: usize,
    ) -> AgentMemoryResult<Vec<TimelineProjectionItem>> {
        let conn = self.event_conn(session_id)?;
        let mut stmt = conn.prepare(
            "SELECT event_id, runtime_turn_id, kind, role, payload_json, created_at_ms, created_at_iso
             FROM session_event
             WHERE visibility = 'user_visible' AND ui_policy = 'show_in_timeline'
             ORDER BY created_at_ms DESC, event_id DESC
             LIMIT ?1",
        )?;
        let rows = stmt.query_map(params![limit as i64], |row| {
            Ok(RawTimelineProjectionItem {
                event_id: row.get(0)?,
                runtime_turn_id: row.get(1)?,
                kind: row.get(2)?,
                role: row.get(3)?,
                payload_json: row.get(4)?,
                created_at_ms: row.get(5)?,
                created_at_iso: row.get(6)?,
            })
        })?;
        let mut items = rows
            .map(|row| raw_timeline_projection_item(row?))
            .collect::<AgentMemoryResult<Vec<_>>>()?;
        items.reverse();
        Ok(items)
    }

    fn validate_event_visibility(&self, event: &NewSessionEvent) -> AgentMemoryResult<()> {
        if matches!(
            event.visibility,
            Visibility::Internal | Visibility::DebugOnly | Visibility::AuditOnly
        ) && matches!(event.ui_policy, UiPolicy::ShowInTimeline)
        {
            return Err(AgentMemoryError::invariant(
                "internal/debug/audit events cannot be timeline-visible",
            ));
        }
        Ok(())
    }

    fn event_payload_for_storage(
        &self,
        session_id: &str,
        event_id: &str,
        payload: &Value,
    ) -> AgentMemoryResult<Value> {
        let encoded = serde_json::to_vec(payload)?;
        let conn = self.event_conn(session_id)?;
        if encoded.len() <= LARGE_PAYLOAD_INLINE_BYTES {
            conn.execute(
                "INSERT INTO event_payload (
                    event_id, storage_kind, payload_json, artifact_id, artifact_path, byte_len
                 ) VALUES (?1, 'inline', ?2, NULL, NULL, ?3)",
                params![event_id, payload.to_string(), encoded.len() as i64],
            )?;
            return Ok(payload.clone());
        }
        let artifact_id = new_artifact_id();
        let artifact_path = self
            .root
            .join("artifacts")
            .join("blobs")
            .join(format!("{artifact_id}.json"));
        fs::write(&artifact_path, encoded)
            .map_err(|source| AgentMemoryError::io(&artifact_path, source))?;
        conn.execute(
            "INSERT INTO event_payload (
                event_id, storage_kind, payload_json, artifact_id, artifact_path, byte_len
             ) VALUES (?1, 'artifact', NULL, ?2, ?3, ?4)",
            params![
                event_id,
                artifact_id,
                artifact_path.to_string_lossy(),
                fs::metadata(&artifact_path)
                    .map_err(|source| AgentMemoryError::io(&artifact_path, source))?
                    .len() as i64
            ],
        )?;
        Ok(json!({
            "artifactRef": artifact_id,
            "contentType": "application/json"
        }))
    }

    fn append_dialog_projection(&self, session_id: &str, event_id: &str) -> AgentMemoryResult<()> {
        let event = self
            .read_event_by_id(session_id, event_id)?
            .ok_or_else(|| AgentMemoryError::corruption("missing event for dialog projection"))?;
        let conn = self.session_conn(session_id)?;
        conn.execute(
            "INSERT OR IGNORE INTO session_dialog (
                event_id, runtime_turn_id, role, kind, payload_json, created_at_ms, created_at_iso
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                event.event_id,
                event.runtime_turn_id,
                event.role.as_storage_str(),
                event.kind,
                event.payload_json.to_string(),
                event.created_at_ms,
                event.created_at_iso
            ],
        )?;
        Ok(())
    }

    fn read_event_by_id(
        &self,
        session_id: &str,
        event_id: &str,
    ) -> AgentMemoryResult<Option<SessionEventRecord>> {
        let conn = self.event_conn(session_id)?;
        let raw = conn
            .query_row(
                "SELECT event_id, session_id, runtime_turn_id, kind, role, payload_json, visibility,
                    model_context_policy, ui_policy, created_at_ms, created_at_iso, lineage_json
                 FROM session_event WHERE event_id = ?1",
                params![event_id],
                raw_event_from_row,
            )
            .optional()?;
        raw.map(raw_event_record).transpose()
    }

    fn latest_user_visible_event(
        &self,
        session_id: &str,
        role: EventRole,
    ) -> AgentMemoryResult<Option<SessionEventRecord>> {
        let conn = self.event_conn(session_id)?;
        let raw = conn
            .query_row(
                "SELECT event_id, session_id, runtime_turn_id, kind, role, payload_json, visibility,
                    model_context_policy, ui_policy, created_at_ms, created_at_iso, lineage_json
                 FROM session_event
                 WHERE role = ?1 AND visibility = 'user_visible'
                 ORDER BY created_at_ms DESC, event_id DESC
                 LIMIT 1",
                params![role.as_storage_str()],
                raw_event_from_row,
            )
            .optional()?;
        raw.map(raw_event_record).transpose()
    }

    fn read_events_where(
        &self,
        session_id: &str,
        suffix: &str,
        _params: &[&dyn rusqlite::ToSql],
    ) -> AgentMemoryResult<Vec<SessionEventRecord>> {
        let conn = self.event_conn(session_id)?;
        let query = format!(
            "SELECT event_id, session_id, runtime_turn_id, kind, role, payload_json, visibility,
                model_context_policy, ui_policy, created_at_ms, created_at_iso, lineage_json
             FROM session_event
             {suffix}
             ORDER BY created_at_ms, event_id"
        );
        let mut stmt = conn.prepare(&query)?;
        let rows = stmt.query_map([], raw_event_from_row)?;
        rows.map(|row| raw_event_record(row?)).collect()
    }

    fn insert_turn_state_log(
        &self,
        conn: &Connection,
        runtime_turn_id: &str,
        state: RuntimeTurnState,
        reason: &str,
        created_at_ms: i64,
        created_at_iso: &str,
    ) -> AgentMemoryResult<()> {
        conn.execute(
            "INSERT INTO runtime_turn_state_log (
                state_log_id, runtime_turn_id, state, reason, created_at_ms, created_at_iso
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                new_state_log_id(),
                runtime_turn_id,
                state.as_storage_str(),
                reason,
                created_at_ms,
                created_at_iso
            ],
        )?;
        Ok(())
    }

    fn record_tool_refs(
        &self,
        conn: &Connection,
        tool_call_id: &str,
        output_json: &Value,
        created_at_ms: i64,
        created_at_iso: &str,
    ) -> AgentMemoryResult<()> {
        for artifact_id in string_array_field(output_json, "artifactRefs") {
            conn.execute(
                "INSERT OR IGNORE INTO tool_artifact_ref (
                    tool_call_id, artifact_id, created_at_ms, created_at_iso
                 ) VALUES (?1, ?2, ?3, ?4)",
                params![tool_call_id, artifact_id, created_at_ms, created_at_iso],
            )?;
        }
        for evidence_id in string_array_field(output_json, "evidenceRefs") {
            conn.execute(
                "INSERT OR IGNORE INTO tool_evidence_ref (
                    tool_call_id, evidence_id, created_at_ms, created_at_iso
                 ) VALUES (?1, ?2, ?3, ?4)",
                params![tool_call_id, evidence_id, created_at_ms, created_at_iso],
            )?;
        }
        Ok(())
    }

    fn active_todos(&self, session_id: &str) -> AgentMemoryResult<Vec<Value>> {
        let conn = self.runtime_conn(session_id)?;
        let mut stmt =
            conn.prepare("SELECT payload_json FROM active_todo ORDER BY created_at_ms, todo_id")?;
        let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
        rows.map(|row| parse_json_string(row?)).collect()
    }

    fn active_browser_targets(&self, session_id: &str) -> AgentMemoryResult<Vec<Value>> {
        let conn = self.runtime_conn(session_id)?;
        let mut stmt = conn.prepare(
            "SELECT payload_json FROM browser_target WHERE active = 1 ORDER BY updated_at_ms, browser_target_id",
        )?;
        let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
        rows.map(|row| parse_json_string(row?)).collect()
    }

    fn active_clarification(&self, session_id: &str) -> AgentMemoryResult<Option<Value>> {
        let conn = self.runtime_conn(session_id)?;
        let payload = conn
            .query_row(
                "SELECT payload_json FROM runtime_blocker
                 WHERE kind = 'clarification' AND resolved_at_ms IS NULL
                 ORDER BY created_at_ms DESC
                 LIMIT 1",
                [],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        payload.map(parse_json_string).transpose()
    }

    fn active_tool_waits(&self, session_id: &str) -> AgentMemoryResult<Vec<Value>> {
        let conn = self.runtime_conn(session_id)?;
        let mut stmt = conn.prepare(
            "SELECT json_object('toolCallId', tool_call_id, 'name', name, 'input', input_json)
             FROM tool_call
             WHERE status = 'running'
             ORDER BY created_at_ms, tool_call_id",
        )?;
        let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
        rows.map(|row| parse_json_string(row?)).collect()
    }

    fn pinned_state_values(&self, session_id: &str, kind: &str) -> AgentMemoryResult<Vec<Value>> {
        let conn = self.runtime_conn(session_id)?;
        let mut stmt = conn.prepare(
            "SELECT payload_json FROM pinned_state
             WHERE kind = ?1 AND active = 1
             ORDER BY updated_at_ms DESC",
        )?;
        let rows = stmt.query_map(params![kind], |row| row.get::<_, String>(0))?;
        rows.map(|row| parse_json_string(row?)).collect()
    }

    fn active_follow_sessions(&self, session_id: &str) -> AgentMemoryResult<Vec<Value>> {
        let conn = self.runtime_conn(session_id)?;
        let mut stmt = conn.prepare(
            "SELECT json_object(
                'followSessionId', follow_session_id,
                'runtimeTurnId', runtime_turn_id,
                'status', status,
                'payload', json(payload_json),
                'updatedAt', updated_at_iso
             )
             FROM follow_session
             WHERE status NOT IN ('completed', 'cancelled', 'failed')
             ORDER BY updated_at_ms DESC, follow_session_id",
        )?;
        let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
        rows.map(|row| parse_json_string(row?)).collect()
    }

    fn active_policy_refs(&self, session_id: &str) -> AgentMemoryResult<Vec<Value>> {
        let conn = self.runtime_conn(session_id)?;
        let mut stmt = conn.prepare(
            "SELECT json_object(
                'policyRefId', policy_ref_id,
                'runtimeTurnId', runtime_turn_id,
                'status', status,
                'payload', json(payload_json),
                'updatedAt', updated_at_iso
             )
             FROM policy_ref
             WHERE status IN ('active', 'pending', 'required')
             ORDER BY updated_at_ms DESC, policy_ref_id",
        )?;
        let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
        rows.map(|row| parse_json_string(row?)).collect()
    }

    fn active_delivery_obligations(&self, session_id: &str) -> AgentMemoryResult<Vec<Value>> {
        let conn = self.runtime_conn(session_id)?;
        let mut stmt = conn.prepare(
            "SELECT json_object(
                'deliveryObligationId', delivery_obligation_id,
                'runtimeTurnId', runtime_turn_id,
                'status', status,
                'payload', json(payload_json),
                'updatedAt', updated_at_iso
             )
             FROM delivery_obligation
             WHERE status IN ('open', 'pending', 'blocked')
             ORDER BY updated_at_ms DESC, delivery_obligation_id",
        )?;
        let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
        rows.map(|row| parse_json_string(row?)).collect()
    }

    fn head_events(&self, session_id: &str, limit: usize) -> AgentMemoryResult<Vec<Value>> {
        let events = self.timeline_projection(session_id, limit)?;
        Ok(events
            .into_iter()
            .map(|event| {
                json!({
                    "eventId": event.event_id,
                    "runtimeTurnId": event.runtime_turn_id,
                    "kind": event.kind,
                    "role": event.role,
                    "payload": event.payload_json,
                    "createdAt": event.created_at_iso
                })
            })
            .collect())
    }

    fn middle_anchors(&self, session_id: &str, limit: usize) -> AgentMemoryResult<Vec<Value>> {
        let conn = self.event_conn(session_id)?;
        let mut stmt = conn.prepare(
            "SELECT event_id, runtime_turn_id, kind, role, payload_json, created_at_iso
             FROM session_event
             WHERE visibility IN ('user_visible', 'model_context_only')
             ORDER BY created_at_ms DESC, event_id DESC
             LIMIT ?1 OFFSET 24",
        )?;
        let rows = stmt.query_map(params![limit as i64], |row| {
            Ok(RawAnchorRow {
                event_id: row.get(0)?,
                runtime_turn_id: row.get(1)?,
                kind: row.get(2)?,
                role: row.get(3)?,
                payload_json: row.get(4)?,
                created_at_iso: row.get(5)?,
            })
        })?;
        rows.map(|row| {
            let row = row?;
            Ok(json!({
                "eventId": row.event_id,
                "runtimeTurnId": row.runtime_turn_id,
                "kind": row.kind,
                "role": row.role,
                "payload": parse_json_string(row.payload_json)?,
                "createdAt": row.created_at_iso
            }))
        })
        .collect()
    }

    fn retrieved_archives(&self, session_id: &str, limit: usize) -> AgentMemoryResult<Vec<Value>> {
        let path = self
            .session_dir(session_id)
            .join("cuts")
            .join("cut_pack_0001.sqlite");
        let conn = Connection::open(path)?;
        let mut stmt = conn.prepare(
            "SELECT archive_id, source_event_start_id, source_event_end_id, role,
                    content_normalized, content_kind, trim_batch_id, created_at_iso
             FROM cut_payload
             ORDER BY created_at_ms DESC, archive_id DESC
             LIMIT ?1",
        )?;
        let rows = stmt.query_map(params![limit as i64], |row| {
            Ok(json!({
                "archiveId": row.get::<_, String>(0)?,
                "sourceEventStartId": row.get::<_, String>(1)?,
                "sourceEventEndId": row.get::<_, String>(2)?,
                "role": row.get::<_, Option<String>>(3)?,
                "content": row.get::<_, String>(4)?,
                "contentKind": row.get::<_, String>(5)?,
                "trimBatchId": row.get::<_, String>(6)?,
                "createdAt": row.get::<_, String>(7)?
            }))
        })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    fn active_shared_memory(&self) -> AgentMemoryResult<Vec<SharedMemoryRecord>> {
        self.read_shared_memory_db("shared_truth.sqlite", SharedMemoryStatus::Active)
    }

    fn read_shared_memory_db(
        &self,
        file_name: &str,
        status: SharedMemoryStatus,
    ) -> AgentMemoryResult<Vec<SharedMemoryRecord>> {
        let conn = Connection::open(self.root.join("shared").join(file_name))?;
        let mut stmt = conn.prepare(
            "SELECT memory_id, scope, status, content_json, evidence_refs_json, conflict_set_id,
                negative, created_at_ms, created_at_iso, updated_at_ms, updated_at_iso
             FROM memory_truth
             WHERE status = ?1
             ORDER BY updated_at_ms DESC, memory_id",
        )?;
        let rows = stmt.query_map(params![status.as_storage_str()], |row| {
            Ok(RawSharedMemoryRecord {
                memory_id: row.get(0)?,
                scope: row.get(1)?,
                status: row.get(2)?,
                content_json: row.get(3)?,
                evidence_refs_json: row.get(4)?,
                conflict_set_id: row.get(5)?,
                negative: row.get::<_, i64>(6)? != 0,
                created_at_ms: row.get(7)?,
                created_at_iso: row.get(8)?,
                updated_at_ms: row.get(9)?,
                updated_at_iso: row.get(10)?,
            })
        })?;
        rows.map(|row| raw_shared_memory_record(row?)).collect()
    }

    fn touch_session(&self, session_id: &str) -> AgentMemoryResult<()> {
        if !self.session_dir(session_id).exists() {
            return Ok(());
        }
        let timestamp = now_timestamp();
        let conn = self.session_conn(session_id)?;
        conn.execute(
            "UPDATE session_meta SET updated_at_ms = ?1, updated_at_iso = ?2 WHERE session_id = ?3",
            params![timestamp.ms, timestamp.iso, session_id],
        )?;
        Ok(())
    }

    fn session_dir(&self, session_id: &str) -> PathBuf {
        self.root.join("sessions").join(session_id)
    }

    fn session_conn(&self, session_id: &str) -> AgentMemoryResult<Connection> {
        Connection::open(self.session_dir(session_id).join("session.sqlite")).map_err(Into::into)
    }

    fn event_conn(&self, session_id: &str) -> AgentMemoryResult<Connection> {
        Connection::open(self.session_dir(session_id).join("event_log.sqlite")).map_err(Into::into)
    }

    fn runtime_conn(&self, session_id: &str) -> AgentMemoryResult<Connection> {
        Connection::open(self.session_dir(session_id).join("runtime.sqlite")).map_err(Into::into)
    }

    fn context_conn(&self, session_id: &str) -> AgentMemoryResult<Connection> {
        Connection::open(self.session_dir(session_id).join("context.sqlite")).map_err(Into::into)
    }

    fn init_session_dbs(&self, session_id: &str) -> AgentMemoryResult<()> {
        let dir = self.session_dir(session_id);
        fs::create_dir_all(dir.join("cuts"))
            .map_err(|source| AgentMemoryError::io(dir.join("cuts"), source))?;
        fs::create_dir_all(dir.join("manifests"))
            .map_err(|source| AgentMemoryError::io(dir.join("manifests"), source))?;
        fs::create_dir_all(dir.join("projections"))
            .map_err(|source| AgentMemoryError::io(dir.join("projections"), source))?;
        self.init_session_db(session_id)?;
        self.init_event_db(session_id)?;
        self.init_runtime_db(session_id)?;
        self.init_context_db(session_id)?;
        self.init_cut_pack_db(session_id, "cut_pack_0001.sqlite")?;
        Ok(())
    }

    fn init_session_db(&self, session_id: &str) -> AgentMemoryResult<()> {
        let conn = self.session_conn(session_id)?;
        conn.execute_batch(
            "
            PRAGMA journal_mode = WAL;
            CREATE TABLE IF NOT EXISTS session_meta (
                session_id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                working_dir TEXT,
                provider_key TEXT,
                model TEXT,
                status TEXT NOT NULL,
                schema_version INTEGER NOT NULL,
                created_at_ms INTEGER NOT NULL,
                created_at_iso TEXT NOT NULL,
                updated_at_ms INTEGER NOT NULL,
                updated_at_iso TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS session_dialog (
                event_id TEXT PRIMARY KEY,
                runtime_turn_id TEXT,
                role TEXT NOT NULL,
                kind TEXT NOT NULL,
                payload_json TEXT NOT NULL,
                created_at_ms INTEGER NOT NULL,
                created_at_iso TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS session_index (
                key TEXT PRIMARY KEY,
                value_json TEXT NOT NULL,
                updated_at_ms INTEGER NOT NULL,
                updated_at_iso TEXT NOT NULL
            );
            ",
        )?;
        Ok(())
    }

    fn init_event_db(&self, session_id: &str) -> AgentMemoryResult<()> {
        let conn = self.event_conn(session_id)?;
        conn.execute_batch(
            "
            PRAGMA journal_mode = WAL;
            CREATE TABLE IF NOT EXISTS session_event (
                event_id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL,
                runtime_turn_id TEXT,
                kind TEXT NOT NULL,
                role TEXT NOT NULL,
                payload_json TEXT NOT NULL,
                visibility TEXT NOT NULL,
                model_context_policy TEXT NOT NULL,
                ui_policy TEXT NOT NULL,
                created_at_ms INTEGER NOT NULL,
                created_at_iso TEXT NOT NULL,
                lineage_json TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS event_payload (
                event_id TEXT PRIMARY KEY,
                storage_kind TEXT NOT NULL,
                payload_json TEXT,
                artifact_id TEXT,
                artifact_path TEXT,
                byte_len INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS event_lineage (
                event_id TEXT PRIMARY KEY,
                lineage_json TEXT NOT NULL,
                created_at_ms INTEGER NOT NULL,
                created_at_iso TEXT NOT NULL
            );
            CREATE TRIGGER IF NOT EXISTS session_event_no_update
            BEFORE UPDATE ON session_event
            BEGIN
                SELECT RAISE(ABORT, 'session_event is append-only');
            END;
            CREATE TRIGGER IF NOT EXISTS session_event_no_delete
            BEFORE DELETE ON session_event
            BEGIN
                SELECT RAISE(ABORT, 'session_event is append-only');
            END;
            ",
        )?;
        Ok(())
    }

    fn init_runtime_db(&self, session_id: &str) -> AgentMemoryResult<()> {
        let conn = self.runtime_conn(session_id)?;
        conn.execute_batch(
            "
            PRAGMA journal_mode = WAL;
            CREATE TABLE IF NOT EXISTS runtime_turn (
                runtime_turn_id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL,
                parent_runtime_turn_id TEXT,
                user_message_id TEXT,
                state TEXT NOT NULL,
                started_at_ms INTEGER NOT NULL,
                started_at_iso TEXT NOT NULL,
                updated_at_ms INTEGER NOT NULL,
                updated_at_iso TEXT NOT NULL,
                completed_at_ms INTEGER,
                completed_at_iso TEXT,
                failure_kind TEXT,
                failure_detail_ref TEXT,
                latest_user_intent_ref TEXT,
                active_task_ref TEXT,
                provider_request_ref TEXT,
                context_snapshot_ref TEXT,
                completion_audit_ref TEXT
            );
            CREATE TABLE IF NOT EXISTS runtime_turn_state_log (
                state_log_id TEXT PRIMARY KEY,
                runtime_turn_id TEXT NOT NULL,
                state TEXT NOT NULL,
                reason TEXT NOT NULL,
                created_at_ms INTEGER NOT NULL,
                created_at_iso TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS runtime_blocker (
                blocker_id TEXT PRIMARY KEY,
                runtime_turn_id TEXT NOT NULL,
                kind TEXT NOT NULL,
                payload_json TEXT NOT NULL,
                created_at_ms INTEGER NOT NULL,
                created_at_iso TEXT NOT NULL,
                resolved_at_ms INTEGER,
                resolved_at_iso TEXT
            );
            CREATE TABLE IF NOT EXISTS runtime_recovery_anchor (
                anchor_id TEXT PRIMARY KEY,
                runtime_turn_id TEXT NOT NULL,
                kind TEXT NOT NULL,
                payload_json TEXT NOT NULL,
                created_at_ms INTEGER NOT NULL,
                created_at_iso TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS active_process (
                process_id TEXT PRIMARY KEY,
                runtime_turn_id TEXT,
                pid INTEGER,
                kind TEXT NOT NULL,
                payload_json TEXT NOT NULL,
                status TEXT NOT NULL,
                created_at_ms INTEGER NOT NULL,
                created_at_iso TEXT NOT NULL,
                updated_at_ms INTEGER NOT NULL,
                updated_at_iso TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS tool_call (
                tool_call_id TEXT PRIMARY KEY,
                runtime_turn_id TEXT NOT NULL,
                name TEXT NOT NULL,
                input_json TEXT NOT NULL,
                status TEXT NOT NULL,
                created_at_ms INTEGER NOT NULL,
                created_at_iso TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS tool_result (
                tool_result_id TEXT PRIMARY KEY,
                tool_call_id TEXT NOT NULL,
                runtime_turn_id TEXT NOT NULL,
                status TEXT NOT NULL,
                output_json TEXT NOT NULL,
                recommended_next_actions_json TEXT NOT NULL,
                created_at_ms INTEGER NOT NULL,
                created_at_iso TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS tool_artifact_ref (
                tool_call_id TEXT NOT NULL,
                artifact_id TEXT NOT NULL,
                created_at_ms INTEGER NOT NULL,
                created_at_iso TEXT NOT NULL,
                PRIMARY KEY (tool_call_id, artifact_id)
            );
            CREATE TABLE IF NOT EXISTS tool_evidence_ref (
                tool_call_id TEXT NOT NULL,
                evidence_id TEXT NOT NULL,
                created_at_ms INTEGER NOT NULL,
                created_at_iso TEXT NOT NULL,
                PRIMARY KEY (tool_call_id, evidence_id)
            );
            CREATE TABLE IF NOT EXISTS browser_target (
                browser_target_id TEXT PRIMARY KEY,
                workbench_tab_id TEXT NOT NULL,
                lumen_target_id TEXT,
                payload_json TEXT NOT NULL,
                active INTEGER NOT NULL,
                updated_at_ms INTEGER NOT NULL,
                updated_at_iso TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS browser_action (
                browser_action_id TEXT PRIMARY KEY,
                runtime_turn_id TEXT NOT NULL,
                browser_target_id TEXT NOT NULL,
                kind TEXT NOT NULL,
                payload_json TEXT NOT NULL,
                created_at_ms INTEGER NOT NULL,
                created_at_iso TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS follow_session (
                follow_session_id TEXT PRIMARY KEY,
                runtime_turn_id TEXT NOT NULL,
                payload_json TEXT NOT NULL,
                status TEXT NOT NULL,
                created_at_ms INTEGER NOT NULL,
                created_at_iso TEXT NOT NULL,
                updated_at_ms INTEGER NOT NULL,
                updated_at_iso TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS follow_action (
                follow_action_id TEXT PRIMARY KEY,
                follow_session_id TEXT NOT NULL,
                kind TEXT NOT NULL,
                payload_json TEXT NOT NULL,
                created_at_ms INTEGER NOT NULL,
                created_at_iso TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS follow_frame (
                follow_frame_id TEXT PRIMARY KEY,
                follow_session_id TEXT NOT NULL,
                payload_json TEXT NOT NULL,
                created_at_ms INTEGER NOT NULL,
                created_at_iso TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS rollback_marker (
                rollback_marker_id TEXT PRIMARY KEY,
                runtime_turn_id TEXT,
                message_id TEXT,
                payload_json TEXT NOT NULL,
                created_at_ms INTEGER NOT NULL,
                created_at_iso TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS active_todo (
                todo_id TEXT PRIMARY KEY,
                runtime_turn_id TEXT,
                payload_json TEXT NOT NULL,
                created_at_ms INTEGER NOT NULL,
                created_at_iso TEXT NOT NULL,
                updated_at_ms INTEGER NOT NULL,
                updated_at_iso TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS pinned_state (
                kind TEXT PRIMARY KEY,
                runtime_turn_id TEXT,
                payload_json TEXT NOT NULL,
                source_refs_json TEXT NOT NULL,
                active INTEGER NOT NULL,
                created_at_ms INTEGER NOT NULL,
                created_at_iso TEXT NOT NULL,
                updated_at_ms INTEGER NOT NULL,
                updated_at_iso TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS provider_request (
                provider_request_id TEXT PRIMARY KEY,
                runtime_turn_id TEXT NOT NULL,
                context_snapshot_ref TEXT NOT NULL,
                tool_schema_snapshot_json TEXT NOT NULL,
                provider_key TEXT,
                model TEXT,
                status TEXT NOT NULL,
                request_json TEXT NOT NULL,
                usage_json TEXT,
                error_json TEXT,
                created_at_ms INTEGER NOT NULL,
                created_at_iso TEXT NOT NULL,
                completed_at_ms INTEGER,
                completed_at_iso TEXT
            );
            CREATE TABLE IF NOT EXISTS completion_audit (
                completion_audit_id TEXT PRIMARY KEY,
                runtime_turn_id TEXT NOT NULL,
                provider_request_id TEXT,
                status TEXT NOT NULL,
                usage_json TEXT,
                error_json TEXT,
                created_at_ms INTEGER NOT NULL,
                created_at_iso TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS delivery_obligation (
                delivery_obligation_id TEXT PRIMARY KEY,
                runtime_turn_id TEXT,
                payload_json TEXT NOT NULL,
                status TEXT NOT NULL,
                created_at_ms INTEGER NOT NULL,
                created_at_iso TEXT NOT NULL,
                updated_at_ms INTEGER NOT NULL,
                updated_at_iso TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS delivery_proof (
                delivery_proof_id TEXT PRIMARY KEY,
                delivery_obligation_id TEXT NOT NULL,
                payload_json TEXT NOT NULL,
                created_at_ms INTEGER NOT NULL,
                created_at_iso TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS policy_ref (
                policy_ref_id TEXT PRIMARY KEY,
                runtime_turn_id TEXT,
                payload_json TEXT NOT NULL,
                status TEXT NOT NULL,
                created_at_ms INTEGER NOT NULL,
                created_at_iso TEXT NOT NULL,
                updated_at_ms INTEGER NOT NULL,
                updated_at_iso TEXT NOT NULL
            );
            ",
        )?;
        Ok(())
    }

    fn init_context_db(&self, session_id: &str) -> AgentMemoryResult<()> {
        let conn = self.context_conn(session_id)?;
        conn.execute_batch(
            "
            PRAGMA journal_mode = WAL;
            CREATE TABLE IF NOT EXISTS context_snapshot (
                context_snapshot_id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL,
                runtime_turn_id TEXT NOT NULL,
                model_context_window INTEGER NOT NULL,
                created_at_ms INTEGER NOT NULL,
                created_at_iso TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS context_layer (
                context_snapshot_id TEXT NOT NULL,
                kind TEXT NOT NULL,
                priority INTEGER NOT NULL,
                token_budget INTEGER NOT NULL,
                payload_json TEXT NOT NULL,
                source_refs_json TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS context_source_ref (
                context_snapshot_id TEXT NOT NULL,
                source_ref TEXT NOT NULL,
                source_kind TEXT NOT NULL,
                PRIMARY KEY (context_snapshot_id, source_ref)
            );
            CREATE TABLE IF NOT EXISTS summary_projection (
                summary_id TEXT PRIMARY KEY,
                source_event_range_json TEXT,
                source_archive_refs_json TEXT NOT NULL,
                created_by TEXT NOT NULL,
                created_at_ms INTEGER NOT NULL,
                confidence REAL NOT NULL,
                known_omissions_json TEXT NOT NULL,
                latest_user_intent_at_creation TEXT
            );
            ",
        )?;
        Ok(())
    }

    fn init_cut_pack_db(&self, session_id: &str, file_name: &str) -> AgentMemoryResult<()> {
        let path = self.session_dir(session_id).join("cuts").join(file_name);
        let conn = Connection::open(path)?;
        conn.execute_batch(
            "
            PRAGMA journal_mode = WAL;
            CREATE TABLE IF NOT EXISTS cut_payload (
                archive_id TEXT PRIMARY KEY,
                source_session_id TEXT NOT NULL,
                source_event_start_id TEXT NOT NULL,
                source_event_end_id TEXT NOT NULL,
                role TEXT,
                content_raw TEXT NOT NULL,
                content_normalized TEXT NOT NULL,
                content_kind TEXT NOT NULL,
                token_count_raw INTEGER,
                char_count_raw INTEGER NOT NULL,
                token_count_normalized INTEGER,
                char_count_normalized INTEGER NOT NULL,
                raw_digest TEXT NOT NULL,
                normalized_digest TEXT NOT NULL,
                trim_batch_id TEXT NOT NULL,
                lineage_json TEXT NOT NULL,
                created_at_ms INTEGER NOT NULL,
                created_at_iso TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS cut_refs (
                dedupe_ref_id TEXT PRIMARY KEY,
                source_archive_id TEXT NOT NULL,
                target_archive_id TEXT NOT NULL,
                dedupe_reason TEXT NOT NULL,
                similarity_score REAL,
                created_at_ms INTEGER NOT NULL,
                created_at_iso TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS cut_meta (
                trim_batch_id TEXT PRIMARY KEY,
                pack_id TEXT NOT NULL,
                omitted_span_summary TEXT,
                state TEXT NOT NULL,
                created_at_ms INTEGER NOT NULL,
                created_at_iso TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS cut_shard_map (
                trim_batch_id TEXT PRIMARY KEY,
                pack_id TEXT NOT NULL,
                pack_path TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS trim_journal (
                trim_batch_id TEXT PRIMARY KEY,
                state TEXT NOT NULL,
                payload_json TEXT NOT NULL,
                created_at_ms INTEGER NOT NULL,
                created_at_iso TEXT NOT NULL,
                updated_at_ms INTEGER NOT NULL,
                updated_at_iso TEXT NOT NULL
            );
            ",
        )?;
        Ok(())
    }

    fn init_shared_truth_dbs(&self) -> AgentMemoryResult<()> {
        for file_name in ["shared_truth.sqlite", "frozen_truth.sqlite"] {
            let conn = Connection::open(self.root.join("shared").join(file_name))?;
            conn.execute_batch(
                "
                PRAGMA journal_mode = WAL;
                CREATE TABLE IF NOT EXISTS memory_truth (
                    memory_id TEXT PRIMARY KEY,
                    scope TEXT NOT NULL,
                    status TEXT NOT NULL,
                    content_json TEXT NOT NULL,
                    evidence_refs_json TEXT NOT NULL,
                    conflict_set_id TEXT,
                    negative INTEGER NOT NULL,
                    created_at_ms INTEGER NOT NULL,
                    created_at_iso TEXT NOT NULL,
                    updated_at_ms INTEGER NOT NULL,
                    updated_at_iso TEXT NOT NULL
                );
                ",
            )?;
        }
        let conn = Connection::open(self.root.join("shared").join("conflict_sets.sqlite"))?;
        conn.execute_batch(
            "
            PRAGMA journal_mode = WAL;
            CREATE TABLE IF NOT EXISTS conflict_set (
                conflict_set_id TEXT PRIMARY KEY,
                status TEXT NOT NULL,
                payload_json TEXT NOT NULL,
                created_at_ms INTEGER NOT NULL,
                created_at_iso TEXT NOT NULL,
                updated_at_ms INTEGER NOT NULL,
                updated_at_iso TEXT NOT NULL
            );
            ",
        )?;
        Ok(())
    }
}

#[derive(Debug)]
struct RawAnchorRow {
    event_id: String,
    runtime_turn_id: Option<String>,
    kind: String,
    role: String,
    payload_json: String,
    created_at_iso: String,
}

#[derive(Debug)]
struct RawSessionRecord {
    session_id: String,
    title: String,
    working_dir: Option<String>,
    provider_key: Option<String>,
    model: Option<String>,
    status: String,
    schema_version: i64,
    created_at_ms: i64,
    created_at_iso: String,
    updated_at_ms: i64,
    updated_at_iso: String,
}

fn raw_session_record(raw: RawSessionRecord) -> AgentMemoryResult<SessionRecord> {
    Ok(SessionRecord {
        session_id: raw.session_id,
        title: raw.title,
        working_dir: raw.working_dir,
        provider_key: raw.provider_key,
        model: raw.model,
        status: parse_storage_enum(raw.status)?,
        schema_version: raw.schema_version,
        created_at_ms: raw.created_at_ms,
        created_at_iso: raw.created_at_iso,
        updated_at_ms: raw.updated_at_ms,
        updated_at_iso: raw.updated_at_iso,
    })
}

#[derive(Debug)]
struct RawSessionEventRecord {
    event_id: String,
    session_id: String,
    runtime_turn_id: Option<String>,
    kind: String,
    role: String,
    payload_json: String,
    visibility: String,
    model_context_policy: String,
    ui_policy: String,
    created_at_ms: i64,
    created_at_iso: String,
    lineage_json: String,
}

fn raw_event_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<RawSessionEventRecord> {
    Ok(RawSessionEventRecord {
        event_id: row.get(0)?,
        session_id: row.get(1)?,
        runtime_turn_id: row.get(2)?,
        kind: row.get(3)?,
        role: row.get(4)?,
        payload_json: row.get(5)?,
        visibility: row.get(6)?,
        model_context_policy: row.get(7)?,
        ui_policy: row.get(8)?,
        created_at_ms: row.get(9)?,
        created_at_iso: row.get(10)?,
        lineage_json: row.get(11)?,
    })
}

fn raw_event_record(raw: RawSessionEventRecord) -> AgentMemoryResult<SessionEventRecord> {
    Ok(SessionEventRecord {
        event_id: raw.event_id,
        session_id: raw.session_id,
        runtime_turn_id: raw.runtime_turn_id,
        kind: raw.kind,
        role: parse_storage_enum(raw.role)?,
        payload_json: parse_json_string(raw.payload_json)?,
        visibility: parse_storage_enum(raw.visibility)?,
        model_context_policy: parse_storage_enum(raw.model_context_policy)?,
        ui_policy: parse_storage_enum(raw.ui_policy)?,
        created_at_ms: raw.created_at_ms,
        created_at_iso: raw.created_at_iso,
        lineage_json: parse_json_string(raw.lineage_json)?,
    })
}

#[derive(Debug)]
struct RawRuntimeTurnRecord {
    runtime_turn_id: String,
    session_id: String,
    parent_runtime_turn_id: Option<String>,
    user_message_id: Option<String>,
    state: String,
    started_at_ms: i64,
    started_at_iso: String,
    updated_at_ms: i64,
    updated_at_iso: String,
    completed_at_ms: Option<i64>,
    completed_at_iso: Option<String>,
    failure_kind: Option<String>,
    failure_detail_ref: Option<String>,
    latest_user_intent_ref: Option<String>,
    active_task_ref: Option<String>,
    provider_request_ref: Option<String>,
    context_snapshot_ref: Option<String>,
    completion_audit_ref: Option<String>,
}

fn raw_turn_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<RawRuntimeTurnRecord> {
    Ok(RawRuntimeTurnRecord {
        runtime_turn_id: row.get(0)?,
        session_id: row.get(1)?,
        parent_runtime_turn_id: row.get(2)?,
        user_message_id: row.get(3)?,
        state: row.get(4)?,
        started_at_ms: row.get(5)?,
        started_at_iso: row.get(6)?,
        updated_at_ms: row.get(7)?,
        updated_at_iso: row.get(8)?,
        completed_at_ms: row.get(9)?,
        completed_at_iso: row.get(10)?,
        failure_kind: row.get(11)?,
        failure_detail_ref: row.get(12)?,
        latest_user_intent_ref: row.get(13)?,
        active_task_ref: row.get(14)?,
        provider_request_ref: row.get(15)?,
        context_snapshot_ref: row.get(16)?,
        completion_audit_ref: row.get(17)?,
    })
}

fn raw_runtime_turn_record(raw: RawRuntimeTurnRecord) -> AgentMemoryResult<RuntimeTurnRecord> {
    Ok(RuntimeTurnRecord {
        runtime_turn_id: raw.runtime_turn_id,
        session_id: raw.session_id,
        parent_runtime_turn_id: raw.parent_runtime_turn_id,
        user_message_id: raw.user_message_id,
        state: parse_storage_enum(raw.state)?,
        started_at_ms: raw.started_at_ms,
        started_at_iso: raw.started_at_iso,
        updated_at_ms: raw.updated_at_ms,
        updated_at_iso: raw.updated_at_iso,
        completed_at_ms: raw.completed_at_ms,
        completed_at_iso: raw.completed_at_iso,
        failure_kind: raw.failure_kind,
        failure_detail_ref: raw.failure_detail_ref,
        latest_user_intent_ref: raw.latest_user_intent_ref,
        active_task_ref: raw.active_task_ref,
        provider_request_ref: raw.provider_request_ref,
        context_snapshot_ref: raw.context_snapshot_ref,
        completion_audit_ref: raw.completion_audit_ref,
    })
}

#[derive(Debug)]
struct RawTimelineProjectionItem {
    event_id: String,
    runtime_turn_id: Option<String>,
    kind: String,
    role: String,
    payload_json: String,
    created_at_ms: i64,
    created_at_iso: String,
}

fn raw_timeline_projection_item(
    raw: RawTimelineProjectionItem,
) -> AgentMemoryResult<TimelineProjectionItem> {
    Ok(TimelineProjectionItem {
        event_id: raw.event_id,
        runtime_turn_id: raw.runtime_turn_id,
        kind: raw.kind,
        role: parse_storage_enum(raw.role)?,
        payload_json: parse_json_string(raw.payload_json)?,
        created_at_ms: raw.created_at_ms,
        created_at_iso: raw.created_at_iso,
    })
}

#[derive(Debug)]
struct RawSharedMemoryRecord {
    memory_id: String,
    scope: String,
    status: String,
    content_json: String,
    evidence_refs_json: String,
    conflict_set_id: Option<String>,
    negative: bool,
    created_at_ms: i64,
    created_at_iso: String,
    updated_at_ms: i64,
    updated_at_iso: String,
}

fn raw_shared_memory_record(raw: RawSharedMemoryRecord) -> AgentMemoryResult<SharedMemoryRecord> {
    Ok(SharedMemoryRecord {
        memory_id: raw.memory_id,
        scope: raw.scope,
        status: parse_storage_enum(raw.status)?,
        content_json: parse_json_string(raw.content_json)?,
        evidence_refs: serde_json::from_str(&raw.evidence_refs_json)?,
        conflict_set_id: raw.conflict_set_id,
        negative: raw.negative,
        created_at_ms: raw.created_at_ms,
        created_at_iso: raw.created_at_iso,
        updated_at_ms: raw.updated_at_ms,
        updated_at_iso: raw.updated_at_iso,
    })
}

fn shared_memory_matches_query(record: &SharedMemoryRecord, query: &str) -> bool {
    record.memory_id.to_lowercase().contains(query)
        || record.scope.to_lowercase().contains(query)
        || record
            .content_json
            .to_string()
            .to_lowercase()
            .contains(query)
        || record
            .evidence_refs
            .iter()
            .any(|evidence| evidence.to_lowercase().contains(query))
}

fn shared_memory_structure_score(value: &Value) -> f64 {
    fn walk(value: &Value, counts: &mut (usize, usize)) {
        match value {
            Value::Null => {}
            Value::Bool(_) | Value::Number(_) | Value::String(_) => counts.0 += 1,
            Value::Array(items) => {
                counts.1 += 1;
                for item in items {
                    walk(item, counts);
                }
            }
            Value::Object(map) => {
                counts.1 += 1;
                for value in map.values() {
                    walk(value, counts);
                }
            }
        }
    }

    let mut counts = (0, 0);
    walk(value, &mut counts);
    let atoms = counts.0 as f64;
    let containers = counts.1 as f64;
    ((atoms + containers).min(6.0) / 6.0).max(0.0)
}

fn parse_storage_enum<T>(value: String) -> AgentMemoryResult<T>
where
    T: DeserializeOwned,
{
    serde_json::from_value(Value::String(value)).map_err(Into::into)
}

fn parse_json_string(value: String) -> AgentMemoryResult<Value> {
    serde_json::from_str(&value).map_err(Into::into)
}

fn string_array_field(value: &Value, field: &str) -> Vec<String> {
    value
        .get(field)
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(ToOwned::to_owned)
                .collect()
        })
        .unwrap_or_default()
}

fn source_refs_from_values(values: &[Value], field: &str) -> Vec<String> {
    values
        .iter()
        .filter_map(|value| {
            value
                .get(field)
                .and_then(Value::as_str)
                .map(ToOwned::to_owned)
        })
        .collect()
}

fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("sha256:{}", hex::encode(hasher.finalize()))
}
