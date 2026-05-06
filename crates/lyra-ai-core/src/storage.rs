use crate::events::RuntimeStreamEvent;
use anyhow::{anyhow, Context, Result};
use chrono::{SecondsFormat, Utc};
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;
use uuid::Uuid;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageRequest {
    #[serde(default)]
    pub storage_root: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiModelDiscoveryState {
    pub status: String,
    pub last_checked_at: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_message: Option<String>,
    pub models: Vec<AiProviderModelEntry>,
}

impl Default for AiModelDiscoveryState {
    fn default() -> Self {
        Self {
            status: "idle".to_string(),
            last_checked_at: None,
            error_message: None,
            models: Vec::new(),
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiProviderModelEntry {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context_window: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub supports_images: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub supports_tools: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub runtime_metadata: Option<Value>,
    pub source: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiProviderProfile {
    pub id: String,
    pub name: String,
    pub provider_id: String,
    pub protocol_id: String,
    pub runtime_provider_id: String,
    pub runtime_supported: bool,
    pub secret_status: String,
    pub preset_id: Option<String>,
    pub connection_config: HashMap<String, String>,
    pub auth_config: HashMap<String, String>,
    pub configured_secret_fields: Vec<String>,
    pub headers: HashMap<String, String>,
    pub model: String,
    pub model_runtime_metadata: Option<Value>,
    pub custom_models: Vec<AiProviderModelEntry>,
    pub discovery_state: AiModelDiscoveryState,
    pub is_default: bool,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSession {
    pub id: String,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub profile_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_root: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_name: Option<String>,
    pub collaboration_mode: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentTurn {
    pub id: String,
    pub session_id: String,
    pub profile_id: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub collaboration_mode: Option<String>,
    pub permission_mode: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub usage: Option<Value>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentMessageContentPart {
    pub r#type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentMessage {
    pub id: String,
    pub session_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub turn_id: Option<String>,
    pub role: String,
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content_parts: Option<Vec<AgentMessageContentPart>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_content: Option<String>,
    pub created_at: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRuntimeEvent {
    pub session_id: String,
    pub turn_id: String,
    pub phase: String,
    pub payload: Value,
    pub timestamp: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSessionDetail {
    pub session: AgentSession,
    pub pending_interactions: Vec<Value>,
    pub turns: Vec<AgentTurn>,
    pub messages: Vec<AgentMessage>,
    pub runtime_events: Vec<AgentRuntimeEvent>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct ToolResultBlobRecord {
    pub result_ref: String,
    pub runtime_turn_id: String,
    pub op_id: String,
    pub tool_path: String,
    pub status: String,
    pub content_json: String,
    pub content_sha256: String,
    pub content_bytes: i64,
    pub created_at: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolResultBlobMeta {
    pub result_ref: String,
    pub content_sha256: String,
    pub content_bytes: i64,
    pub content_preview: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PatchArtifactRefs {
    pub artifact_id: String,
    pub evidence_id: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffArtifactBlobRecord {
    pub artifact_id: String,
    pub evidence_id: Option<String>,
    pub runtime_turn_id: Option<String>,
    pub status: String,
    pub title: String,
    pub content_ref: String,
    pub metadata: Value,
    pub content: String,
    pub content_sha256: String,
    pub content_bytes: i64,
    pub created_at: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct ApprovalTicketRecord {
    pub approval_ticket_id: String,
    pub session_id: String,
    pub runtime_turn_id: String,
    pub status: String,
    pub approval_mode: String,
    pub title: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalTicketDetailRecord {
    pub approval_ticket_id: String,
    pub session_id: String,
    pub runtime_turn_id: String,
    pub status: String,
    pub approval_mode: String,
    pub title: String,
    pub risk_summary: Value,
    pub impact_scope: Value,
    pub requested_action: Value,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PatchFileBackupRef {
    pub backup_ref: String,
    pub path: String,
    pub existed: bool,
    pub content_sha256: Option<String>,
    pub content_bytes: i64,
    pub post_apply_sha256: Option<String>,
    pub post_apply_bytes: Option<i64>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PatchFileBackupRecord {
    pub backup_ref: String,
    pub session_id: String,
    pub runtime_turn_id: String,
    pub approval_ticket_id: String,
    pub source_artifact_id: String,
    pub patch_ref: String,
    pub path: String,
    pub existed: bool,
    pub content_ref: Option<String>,
    pub content_sha256: Option<String>,
    pub content_bytes: i64,
    pub post_apply_sha256: Option<String>,
    pub post_apply_bytes: Option<i64>,
}

#[derive(Clone)]
pub struct AiStore {
    pub root: PathBuf,
}

pub fn now_ms() -> i64 {
    Utc::now().timestamp_millis()
}

pub fn now_iso() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

pub fn new_id(prefix: &str) -> String {
    format!("{prefix}_{}", Uuid::new_v4())
}

pub fn resolve_storage_root(value: Option<&str>) -> Result<PathBuf> {
    if let Some(root) = value.and_then(trim_to_string) {
        return Ok(PathBuf::from(root));
    }
    if let Ok(root) = env::var("LYRA_AI_ROOT") {
        if let Some(root) = trim_to_string(&root) {
            return Ok(PathBuf::from(root));
        }
    }
    let home = dirs::home_dir().ok_or_else(|| anyhow!("home directory is unavailable"))?;
    Ok(home.join(".lyra").join("modules").join("ai"))
}

pub fn trim_to_string(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

pub fn json_string<T: Serialize>(value: &T) -> Result<String> {
    serde_json::to_string(value).context("failed to encode AI JSON field")
}

pub fn parse_json_or<T: for<'de> Deserialize<'de>>(value: String, fallback: T) -> T {
    serde_json::from_str(&value).unwrap_or(fallback)
}

impl AiStore {
    pub fn open(storage_root: Option<&str>) -> Result<Self> {
        let root = resolve_storage_root(storage_root)?;
        fs::create_dir_all(root.join("sessions"))
            .with_context(|| format!("failed to create AI storage root {}", root.display()))?;
        let store = Self { root };
        store.with_index_conn(|conn| migrate_index(conn))?;
        Ok(store)
    }

    pub fn index_path(&self) -> PathBuf {
        self.root.join("index.sqlite")
    }

    pub fn session_dir(&self, session_id: &str) -> PathBuf {
        self.root.join("sessions").join(session_id)
    }

    pub fn session_path(&self, session_id: &str) -> PathBuf {
        self.session_dir(session_id).join("session.sqlite")
    }

    pub fn with_index_conn<T>(&self, f: impl FnOnce(&Connection) -> Result<T>) -> Result<T> {
        fs::create_dir_all(&self.root)?;
        let conn = Connection::open(self.index_path()).with_context(|| {
            format!(
                "failed to open AI index database {}",
                self.index_path().display()
            )
        })?;
        configure_conn(&conn)?;
        migrate_index(&conn)?;
        f(&conn)
    }

    pub fn with_session_conn<T>(
        &self,
        session_id: &str,
        f: impl FnOnce(&Connection) -> Result<T>,
    ) -> Result<T> {
        fs::create_dir_all(self.session_dir(session_id))?;
        let path = self.session_path(session_id);
        let conn = Connection::open(&path)
            .with_context(|| format!("failed to open AI session database {}", path.display()))?;
        configure_conn(&conn)?;
        migrate_session(&conn)?;
        f(&conn)
    }

    pub fn secret_ref(&self, profile_id: &str, field_id: &str) -> Result<Option<String>> {
        self.with_index_conn(|conn| {
            conn.query_row(
                "SELECT secret_ref_id FROM profile_secret WHERE profile_id = ?1 AND field_id = ?2",
                params![profile_id, field_id],
                |row| row.get(0),
            )
            .optional()
            .context("failed to read AI profile secret ref")
        })
    }

    pub fn upsert_secret_ref(
        &self,
        profile_id: &str,
        field_id: &str,
        secret_ref_id: &str,
    ) -> Result<()> {
        let updated_at = now_ms();
        self.with_index_conn(|conn| {
            conn.execute(
                "INSERT INTO profile_secret (profile_id, field_id, secret_ref_id, updated_at)
                 VALUES (?1, ?2, ?3, ?4)
                 ON CONFLICT(profile_id, field_id) DO UPDATE SET
                   secret_ref_id = excluded.secret_ref_id,
                   updated_at = excluded.updated_at",
                params![profile_id, field_id, secret_ref_id, updated_at],
            )?;
            Ok(())
        })
    }

    pub fn delete_secret_ref(&self, profile_id: &str, field_id: &str) -> Result<Option<String>> {
        self.with_index_conn(|conn| {
            let existing = conn
                .query_row(
                    "SELECT secret_ref_id FROM profile_secret WHERE profile_id = ?1 AND field_id = ?2",
                    params![profile_id, field_id],
                    |row| row.get::<_, String>(0),
                )
                .optional()?;
            conn.execute(
                "DELETE FROM profile_secret WHERE profile_id = ?1 AND field_id = ?2",
                params![profile_id, field_id],
            )?;
            Ok(existing)
        })
    }

    pub fn read_profile(&self, profile_id: &str) -> Result<Option<AiProviderProfile>> {
        self.with_index_conn(|conn| read_profile_row(conn, profile_id))
    }

    pub fn read_profiles(&self) -> Result<Vec<AiProviderProfile>> {
        self.with_index_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT id FROM ai_profile ORDER BY is_default DESC, updated_at DESC, created_at DESC",
            )?;
            let ids = stmt.query_map([], |row| row.get::<_, String>(0))?;
            let mut profiles = Vec::new();
            for id in ids {
                if let Some(profile) = read_profile_row(conn, &id?)? {
                    profiles.push(profile);
                }
            }
            Ok(profiles)
        })
    }

    pub fn default_profile(&self) -> Result<Option<AiProviderProfile>> {
        Ok(self.read_profiles()?.into_iter().next())
    }

    pub fn upsert_profile(&self, profile: &AiProviderProfile) -> Result<()> {
        self.with_index_conn(|conn| {
            if profile.is_default {
                conn.execute("UPDATE ai_profile SET is_default = 0", [])?;
            }
            conn.execute(
                "INSERT INTO ai_profile (
                    id, name, provider_id, protocol_id, runtime_provider_id, runtime_supported,
                    preset_id, connection_config_json, auth_config_json, headers_json, model,
                    model_runtime_metadata_json, custom_models_json, discovery_state_json,
                    is_default, created_at, updated_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)
                 ON CONFLICT(id) DO UPDATE SET
                    name = excluded.name,
                    provider_id = excluded.provider_id,
                    protocol_id = excluded.protocol_id,
                    runtime_provider_id = excluded.runtime_provider_id,
                    runtime_supported = excluded.runtime_supported,
                    preset_id = excluded.preset_id,
                    connection_config_json = excluded.connection_config_json,
                    auth_config_json = excluded.auth_config_json,
                    headers_json = excluded.headers_json,
                    model = excluded.model,
                    model_runtime_metadata_json = excluded.model_runtime_metadata_json,
                    custom_models_json = excluded.custom_models_json,
                    discovery_state_json = excluded.discovery_state_json,
                    is_default = excluded.is_default,
                    updated_at = excluded.updated_at",
                params![
                    profile.id,
                    profile.name,
                    profile.provider_id,
                    profile.protocol_id,
                    profile.runtime_provider_id,
                    if profile.runtime_supported { 1_i64 } else { 0_i64 },
                    profile.preset_id,
                    json_string(&profile.connection_config)?,
                    json_string(&profile.auth_config)?,
                    json_string(&profile.headers)?,
                    profile.model,
                    profile.model_runtime_metadata.as_ref().map(Value::to_string),
                    json_string(&profile.custom_models)?,
                    json_string(&profile.discovery_state)?,
                    if profile.is_default { 1_i64 } else { 0_i64 },
                    profile.created_at,
                    profile.updated_at
                ],
            )?;
            if profile.is_default == false {
                let default_count: i64 = conn.query_row(
                    "SELECT COUNT(*) FROM ai_profile WHERE is_default = 1",
                    [],
                    |row| row.get(0),
                )?;
                if default_count == 0 {
                    conn.execute(
                        "UPDATE ai_profile SET is_default = 1 WHERE id = ?1",
                        params![profile.id],
                    )?;
                }
            }
            Ok(())
        })
    }

    pub fn delete_profile(&self, profile_id: &str) -> Result<Vec<String>> {
        self.with_index_conn(|conn| {
            let mut stmt =
                conn.prepare("SELECT secret_ref_id FROM profile_secret WHERE profile_id = ?1")?;
            let rows = stmt.query_map(params![profile_id], |row| row.get::<_, String>(0))?;
            let mut secret_refs = Vec::new();
            for row in rows {
                secret_refs.push(row?);
            }
            conn.execute(
                "DELETE FROM profile_secret WHERE profile_id = ?1",
                params![profile_id],
            )?;
            conn.execute("DELETE FROM ai_profile WHERE id = ?1", params![profile_id])?;
            conn.execute(
                "UPDATE ai_profile SET is_default = 1
                 WHERE id = (SELECT id FROM ai_profile ORDER BY updated_at DESC LIMIT 1)
                   AND (SELECT COUNT(*) FROM ai_profile WHERE is_default = 1) = 0",
                [],
            )?;
            Ok(secret_refs)
        })
    }

    pub fn upsert_session_index(&self, session: &AgentSession) -> Result<()> {
        self.with_index_conn(|conn| {
            conn.execute(
                "INSERT INTO agent_session_index (
                    id, title, profile_id, project_root, project_name, collaboration_mode, created_at, updated_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
                 ON CONFLICT(id) DO UPDATE SET
                    title = excluded.title,
                    profile_id = excluded.profile_id,
                    project_root = excluded.project_root,
                    project_name = excluded.project_name,
                    collaboration_mode = excluded.collaboration_mode,
                    updated_at = excluded.updated_at",
                params![
                    session.id,
                    session.title,
                    session.profile_id,
                    session.project_root,
                    session.project_name,
                    session.collaboration_mode,
                    session.created_at,
                    session.updated_at,
                ],
            )?;
            Ok(())
        })
    }

    pub fn list_sessions(&self) -> Result<Vec<AgentSession>> {
        self.with_index_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT id, title, profile_id, project_root, project_name, collaboration_mode, created_at, updated_at
                 FROM agent_session_index ORDER BY updated_at DESC",
            )?;
            let rows = stmt.query_map([], read_session_index_row)?;
            let mut result = Vec::new();
            for row in rows {
                result.push(row?);
            }
            Ok(result)
        })
    }

    pub fn read_session_index(&self, session_id: &str) -> Result<Option<AgentSession>> {
        self.with_index_conn(|conn| {
            conn.query_row(
                "SELECT id, title, profile_id, project_root, project_name, collaboration_mode, created_at, updated_at
                 FROM agent_session_index WHERE id = ?1",
                params![session_id],
                read_session_index_row,
            )
            .optional()
            .context("failed to read AI session index")
        })
    }

    pub fn append_message(&self, message: &AgentMessage) -> Result<()> {
        let created_iso = now_iso();
        let updated_ms = now_ms();
        let turn_index = self.next_turn_index(&message.session_id)?;
        self.with_session_conn(&message.session_id, |conn| {
            conn.execute(
                "INSERT OR REPLACE INTO session_dialog (
                    msg_id, turn_index, role, content_raw, content_parts_json, token_count, char_count,
                    created_at_ms, created_at_iso, updated_at_ms, metadata_json, stream_id, turn_id
                 ) VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6, ?7, ?8, ?9, ?10, NULL, ?11)",
                params![
                    message.id,
                    turn_index,
                    message.role,
                    message.content,
                    message
                        .content_parts
                        .as_ref()
                        .map(json_string)
                        .transpose()?,
                    message.content.chars().count() as i64,
                    message.created_at,
                    created_iso,
                    updated_ms,
                    json!({}).to_string(),
                    message.turn_id,
                ],
            )?;
            Ok(())
        })
    }

    fn next_turn_index(&self, session_id: &str) -> Result<i64> {
        self.with_session_conn(session_id, |conn| {
            let index: Option<i64> = conn
                .query_row("SELECT MAX(turn_index) FROM session_dialog", [], |row| {
                    row.get(0)
                })
                .optional()?
                .flatten();
            Ok(index.unwrap_or(0) + 1)
        })
    }

    pub fn append_or_update_assistant_message(
        &self,
        session_id: &str,
        turn_id: &str,
        content: &str,
    ) -> Result<String> {
        let existing: Option<String> = self.with_session_conn(session_id, |conn| {
            conn.query_row(
                "SELECT msg_id FROM session_dialog WHERE turn_id = ?1 AND role = 'assistant' LIMIT 1",
                params![turn_id],
                |row| row.get(0),
            )
            .optional()
            .context("failed to read assistant message")
        })?;
        let msg_id = existing.unwrap_or_else(|| new_id("msg"));
        let created_at = now_ms();
        let created_iso = now_iso();
        let turn_index = self.next_turn_index(session_id)?;
        self.with_session_conn(session_id, |conn| {
            conn.execute(
                "INSERT INTO session_dialog (
                    msg_id, turn_index, role, content_raw, content_parts_json, token_count, char_count,
                    created_at_ms, created_at_iso, updated_at_ms, metadata_json, stream_id, turn_id
                 ) VALUES (?1, ?2, 'assistant', ?3, NULL, 0, ?4, ?5, ?6, ?5, ?7, NULL, ?8)
                 ON CONFLICT(msg_id) DO UPDATE SET
                    content_raw = excluded.content_raw,
                    char_count = excluded.char_count,
                    updated_at_ms = excluded.updated_at_ms",
                params![
                    msg_id,
                    turn_index,
                    content,
                    content.chars().count() as i64,
                    created_at,
                    created_iso,
                    json!({}).to_string(),
                    turn_id
                ],
            )?;
            Ok(())
        })?;
        Ok(msg_id)
    }

    pub fn insert_turn(
        &self,
        turn: &AgentTurn,
        user_message_id: &str,
        policy_ref: Option<&str>,
    ) -> Result<()> {
        let created_iso = now_iso();
        self.with_session_conn(&turn.session_id, |conn| {
            conn.execute(
                "INSERT INTO runtime_turn (
                    runtime_turn_id, session_id, user_message_id, profile_id, status, current_state,
                    collaboration_mode, project_policy_snapshot_id, created_at_ms, created_at_iso,
                    updated_at_ms, error_code, error_message, usage_json, permission_mode
                 ) VALUES (?1, ?2, ?3, ?4, ?5, 'user_message_received', ?6, ?7, ?8, ?9, ?10, NULL, NULL, NULL, ?11)",
                params![
                    turn.id,
                    turn.session_id,
                    user_message_id,
                    turn.profile_id,
                    turn.status,
                    turn.collaboration_mode.as_deref(),
                    policy_ref,
                    turn.created_at,
                    created_iso,
                    turn.updated_at,
                    turn.permission_mode,
                ],
            )?;
            Ok(())
        })
    }

    pub fn update_turn_status(
        &self,
        session_id: &str,
        turn_id: &str,
        status: &str,
        current_state: &str,
        error_code: Option<&str>,
        error_message: Option<&str>,
    ) -> Result<()> {
        let updated_at = now_ms();
        self.with_session_conn(session_id, |conn| {
            conn.execute(
                "UPDATE runtime_turn
                 SET status = ?1, current_state = ?2, updated_at_ms = ?3, error_code = ?4, error_message = ?5
                 WHERE runtime_turn_id = ?6",
                params![status, current_state, updated_at, error_code, error_message, turn_id],
            )?;
            Ok(())
        })
    }

    pub fn append_event(
        &self,
        session_id: &str,
        turn_id: Option<&str>,
        event_type: &str,
        payload: Value,
    ) -> Result<RuntimeStreamEvent> {
        let sequence = self.with_session_conn(session_id, |conn| {
            let max_sequence: Option<i64> = conn
                .query_row("SELECT MAX(sequence) FROM runtime_event", [], |row| {
                    row.get(0)
                })
                .optional()?
                .flatten();
            Ok(max_sequence.unwrap_or(0) + 1)
        })?;
        let created_at = now_iso();
        let event = RuntimeStreamEvent::new(
            sequence,
            session_id.to_string(),
            turn_id.map(ToString::to_string),
            event_type,
            payload,
            created_at.clone(),
        );
        let created_ms = now_ms();
        self.with_session_conn(session_id, |conn| {
            conn.execute(
                "INSERT INTO runtime_event (
                    event_id, sequence, session_id, runtime_turn_id, event_type, payload_json, created_at_ms, created_at_iso
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![
                    event.event_id,
                    event.sequence,
                    event.session_id,
                    event.runtime_turn_id,
                    event.event_type,
                    event.payload.to_string(),
                    created_ms,
                    created_at,
                ],
            )?;
            Ok(())
        })?;
        Ok(event)
    }

    pub fn append_tool_result_blob(
        &self,
        session_id: &str,
        turn_id: &str,
        op_id: &str,
        tool_path: &str,
        status: &str,
        content_json: &str,
    ) -> Result<ToolResultBlobMeta> {
        let result_ref = new_id("tool_result");
        let created_at = now_ms();
        let content_bytes = content_json.len() as i64;
        let content_sha256 = sha256_hex(content_json.as_bytes());
        self.with_session_conn(session_id, |conn| {
            conn.execute(
                "INSERT INTO tool_result_blob (
                    result_ref, runtime_turn_id, op_id, tool_path, status,
                    content_json, content_sha256, content_bytes, created_at_ms
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![
                    result_ref,
                    turn_id,
                    op_id,
                    tool_path,
                    status,
                    content_json,
                    content_sha256,
                    content_bytes,
                    created_at,
                ],
            )?;
            Ok(())
        })?;
        Ok(ToolResultBlobMeta {
            result_ref,
            content_sha256,
            content_bytes,
            content_preview: preview_text(content_json, 480),
        })
    }

    pub fn append_patch_artifact_and_evidence(
        &self,
        session_id: &str,
        turn_id: &str,
        op_id: &str,
        title: &str,
        patch_ref: &str,
        metadata: Value,
        changed_files: Value,
    ) -> Result<PatchArtifactRefs> {
        let artifact_id = new_id("artifact");
        let artifact_version_id = new_id("artifact_version");
        let evidence_id = new_id("evidence");
        let created_at = now_ms();
        let created_iso = now_iso();
        self.with_session_conn(session_id, |conn| {
            conn.execute(
                "INSERT INTO artifact_record (
                    artifact_id, artifact_version_id, session_id, runtime_turn_id, kind, status,
                    title, content_ref, projection_ref, metadata_json, source_json, created_at_ms,
                    created_at_iso, updated_at_ms, updated_at_iso
                 ) VALUES (?1, ?2, ?3, ?4, 'diff', 'created', ?5, ?6, NULL, ?7, ?8, ?9, ?10, ?9, ?10)",
                params![
                    artifact_id,
                    artifact_version_id,
                    session_id,
                    turn_id,
                    title,
                    patch_ref,
                    metadata.to_string(),
                    json!({
                        "sourceType": "tool_operation",
                        "toolOperationId": op_id
                    })
                    .to_string(),
                    created_at,
                    created_iso,
                ],
            )?;
            conn.execute(
                "INSERT INTO evidence_record (
                    evidence_id, session_id, runtime_turn_id, kind, status, claim_json,
                    artifact_ids_json, tool_operation_ids_json, confidence, created_at_ms,
                    created_at_iso, stale_reason
                 ) VALUES (?1, ?2, ?3, 'not_run_record', 'active', ?4, ?5, ?6, 'medium', ?7, ?8, NULL)",
                params![
                    evidence_id,
                    session_id,
                    turn_id,
                    json!({
                        "targetKind": "runtime_objective",
                        "claim": "A patch was proposed but not applied or tested.",
                        "changedFiles": changed_files
                    })
                    .to_string(),
                    json!([artifact_id]).to_string(),
                    json!([op_id]).to_string(),
                    created_at,
                    created_iso,
                ],
            )?;
            Ok(())
        })?;
        Ok(PatchArtifactRefs {
            artifact_id,
            evidence_id,
        })
    }

    pub fn append_applied_patch_artifact_and_evidence(
        &self,
        session_id: &str,
        turn_id: &str,
        op_id: &str,
        title: &str,
        patch_ref: &str,
        metadata: Value,
        changed_files: Value,
    ) -> Result<PatchArtifactRefs> {
        let artifact_id = new_id("artifact");
        let artifact_version_id = new_id("artifact_version");
        let evidence_id = new_id("evidence");
        let created_at = now_ms();
        let created_iso = now_iso();
        self.with_session_conn(session_id, |conn| {
            conn.execute(
                "INSERT INTO artifact_record (
                    artifact_id, artifact_version_id, session_id, runtime_turn_id, kind, status,
                    title, content_ref, projection_ref, metadata_json, source_json, created_at_ms,
                    created_at_iso, updated_at_ms, updated_at_iso
                 ) VALUES (?1, ?2, ?3, ?4, 'diff', 'applied', ?5, ?6, NULL, ?7, ?8, ?9, ?10, ?9, ?10)",
                params![
                    artifact_id,
                    artifact_version_id,
                    session_id,
                    turn_id,
                    title,
                    patch_ref,
                    metadata.to_string(),
                    json!({
                        "sourceType": "tool_operation",
                        "toolOperationId": op_id
                    })
                    .to_string(),
                    created_at,
                    created_iso,
                ],
            )?;
            conn.execute(
                "INSERT INTO evidence_record (
                    evidence_id, session_id, runtime_turn_id, kind, status, claim_json,
                    artifact_ids_json, tool_operation_ids_json, confidence, created_at_ms,
                    created_at_iso, stale_reason
                 ) VALUES (?1, ?2, ?3, 'apply_patch_record', 'active', ?4, ?5, ?6, 'high', ?7, ?8, NULL)",
                params![
                    evidence_id,
                    session_id,
                    turn_id,
                    json!({
                        "targetKind": "workspace",
                        "claim": "A patch proposal was applied to workspace files.",
                        "changedFiles": changed_files
                    })
                    .to_string(),
                    json!([artifact_id]).to_string(),
                    json!([op_id]).to_string(),
                    created_at,
                    created_iso,
                ],
            )?;
            Ok(())
        })?;
        Ok(PatchArtifactRefs {
            artifact_id,
            evidence_id,
        })
    }

    pub fn append_rollback_patch_artifact_and_evidence(
        &self,
        session_id: &str,
        turn_id: &str,
        op_id: &str,
        title: &str,
        patch_ref: &str,
        metadata: Value,
        changed_files: Value,
    ) -> Result<PatchArtifactRefs> {
        let artifact_id = new_id("artifact");
        let artifact_version_id = new_id("artifact_version");
        let evidence_id = new_id("evidence");
        let created_at = now_ms();
        let created_iso = now_iso();
        self.with_session_conn(session_id, |conn| {
            conn.execute(
                "INSERT INTO artifact_record (
                    artifact_id, artifact_version_id, session_id, runtime_turn_id, kind, status,
                    title, content_ref, projection_ref, metadata_json, source_json, created_at_ms,
                    created_at_iso, updated_at_ms, updated_at_iso
                 ) VALUES (?1, ?2, ?3, ?4, 'patch_rollback', 'completed', ?5, ?6, NULL, ?7, ?8, ?9, ?10, ?9, ?10)",
                params![
                    artifact_id,
                    artifact_version_id,
                    session_id,
                    turn_id,
                    title,
                    patch_ref,
                    metadata.to_string(),
                    json!({
                        "sourceType": "tool_operation",
                        "toolOperationId": op_id
                    })
                    .to_string(),
                    created_at,
                    created_iso,
                ],
            )?;
            conn.execute(
                "INSERT INTO evidence_record (
                    evidence_id, session_id, runtime_turn_id, kind, status, claim_json,
                    artifact_ids_json, tool_operation_ids_json, confidence, created_at_ms,
                    created_at_iso, stale_reason
                 ) VALUES (?1, ?2, ?3, 'rollback_patch_record', 'active', ?4, ?5, ?6, 'high', ?7, ?8, NULL)",
                params![
                    evidence_id,
                    session_id,
                    turn_id,
                    json!({
                        "targetKind": "workspace",
                        "claim": "An applied patch was rolled back using recorded backup refs.",
                        "changedFiles": changed_files
                    })
                    .to_string(),
                    json!([artifact_id]).to_string(),
                    json!([op_id]).to_string(),
                    created_at,
                    created_iso,
                ],
            )?;
            Ok(())
        })?;
        Ok(PatchArtifactRefs {
            artifact_id,
            evidence_id,
        })
    }

    pub fn append_approval_ticket(
        &self,
        session_id: &str,
        turn_id: &str,
        status: &str,
        approval_mode: &str,
        title: &str,
        risk_summary: Value,
        impact_scope: Value,
        requested_action: Value,
    ) -> Result<ApprovalTicketRecord> {
        let approval_ticket_id = new_id("approval");
        let created_at = now_ms();
        let created_iso = now_iso();
        self.with_session_conn(session_id, |conn| {
            conn.execute(
                "INSERT INTO approval_ticket (
                    approval_ticket_id, session_id, runtime_turn_id, status, approval_mode,
                    title, risk_summary_json, impact_scope_json, requested_action_json,
                    created_at_ms, created_at_iso, updated_at_ms, updated_at_iso
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?10, ?11)",
                params![
                    approval_ticket_id,
                    session_id,
                    turn_id,
                    status,
                    approval_mode,
                    title,
                    risk_summary.to_string(),
                    impact_scope.to_string(),
                    requested_action.to_string(),
                    created_at,
                    created_iso,
                ],
            )?;
            Ok(())
        })?;
        Ok(ApprovalTicketRecord {
            approval_ticket_id,
            session_id: session_id.to_string(),
            runtime_turn_id: turn_id.to_string(),
            status: status.to_string(),
            approval_mode: approval_mode.to_string(),
            title: title.to_string(),
            created_at,
            updated_at: created_at,
        })
    }

    pub fn update_approval_ticket_status(
        &self,
        session_id: &str,
        approval_ticket_id: &str,
        status: &str,
        approval_mode: &str,
    ) -> Result<ApprovalTicketRecord> {
        let updated_at = now_ms();
        let updated_iso = now_iso();
        self.with_session_conn(session_id, |conn| {
            let existing = conn
                .query_row(
                    "SELECT approval_ticket_id, session_id, runtime_turn_id, status,
                            approval_mode, title, created_at_ms, updated_at_ms
                     FROM approval_ticket WHERE session_id = ?1 AND approval_ticket_id = ?2",
                    params![session_id, approval_ticket_id],
                    read_approval_ticket_row,
                )
                .optional()?;
            let Some(mut ticket) = existing else {
                return Err(anyhow!("approval ticket not found: {approval_ticket_id}"));
            };
            conn.execute(
                "UPDATE approval_ticket
                 SET status = ?1, approval_mode = ?2, updated_at_ms = ?3, updated_at_iso = ?4
                 WHERE session_id = ?5 AND approval_ticket_id = ?6",
                params![
                    status,
                    approval_mode,
                    updated_at,
                    updated_iso,
                    session_id,
                    approval_ticket_id
                ],
            )?;
            ticket.status = status.to_string();
            ticket.approval_mode = approval_mode.to_string();
            ticket.updated_at = updated_at;
            Ok(ticket)
        })
    }

    pub fn read_approval_ticket_detail(
        &self,
        session_id: &str,
        approval_ticket_id: &str,
    ) -> Result<Option<ApprovalTicketDetailRecord>> {
        self.with_session_conn(session_id, |conn| {
            Ok(conn
                .query_row(
                    "SELECT approval_ticket_id, session_id, runtime_turn_id, status,
                        approval_mode, title, risk_summary_json, impact_scope_json,
                        requested_action_json, created_at_ms, updated_at_ms
                 FROM approval_ticket
                 WHERE session_id = ?1 AND approval_ticket_id = ?2",
                    params![session_id, approval_ticket_id],
                    |row| {
                        let risk_json: String = row.get(6)?;
                        let impact_json: String = row.get(7)?;
                        let requested_json: String = row.get(8)?;
                        Ok(ApprovalTicketDetailRecord {
                            approval_ticket_id: row.get(0)?,
                            session_id: row.get(1)?,
                            runtime_turn_id: row.get(2)?,
                            status: row.get(3)?,
                            approval_mode: row.get(4)?,
                            title: row.get(5)?,
                            risk_summary: serde_json::from_str(&risk_json)
                                .unwrap_or_else(|_| json!({})),
                            impact_scope: serde_json::from_str(&impact_json)
                                .unwrap_or_else(|_| json!({})),
                            requested_action: serde_json::from_str(&requested_json)
                                .unwrap_or_else(|_| json!({})),
                            created_at: row.get(9)?,
                            updated_at: row.get(10)?,
                        })
                    },
                )
                .optional()?)
        })
    }

    pub fn find_pending_approval_for_tool_source(
        &self,
        session_id: &str,
        tool_path: &str,
        artifact_id: Option<&str>,
        patch_ref: Option<&str>,
    ) -> Result<Option<ApprovalTicketRecord>> {
        self.find_approval_for_tool_source(
            session_id,
            "pending_user",
            tool_path,
            artifact_id,
            patch_ref,
        )
    }

    pub fn find_denied_approval_for_tool_source(
        &self,
        session_id: &str,
        tool_path: &str,
        artifact_id: Option<&str>,
        patch_ref: Option<&str>,
    ) -> Result<Option<ApprovalTicketRecord>> {
        self.find_approval_for_tool_source(session_id, "denied", tool_path, artifact_id, patch_ref)
    }

    fn find_approval_for_tool_source(
        &self,
        session_id: &str,
        status: &str,
        tool_path: &str,
        artifact_id: Option<&str>,
        patch_ref: Option<&str>,
    ) -> Result<Option<ApprovalTicketRecord>> {
        self.with_session_conn(session_id, |conn| {
            let mut stmt = conn.prepare(
                "SELECT approval_ticket_id, session_id, runtime_turn_id, status,
                        approval_mode, title, created_at_ms, updated_at_ms,
                        requested_action_json
                 FROM approval_ticket
                 WHERE session_id = ?1 AND status = ?2
                 ORDER BY created_at_ms ASC",
            )?;
            let rows = stmt.query_map(params![session_id, status], |row| {
                Ok((read_approval_ticket_row(row)?, row.get::<_, String>(8)?))
            })?;
            for row in rows {
                let (ticket, requested_json) = row?;
                let requested: Value =
                    serde_json::from_str(&requested_json).unwrap_or_else(|_| json!({}));
                if requested.get("toolPath").and_then(Value::as_str) != Some(tool_path) {
                    continue;
                }
                let requested_artifact_id = requested
                    .get("artifactId")
                    .or_else(|| requested.get("appliedArtifactId"))
                    .and_then(Value::as_str);
                let requested_patch_ref = requested.get("patchRef").and_then(Value::as_str);
                let artifact_matches = artifact_id
                    .is_some_and(|artifact_id| requested_artifact_id == Some(artifact_id));
                let patch_matches =
                    patch_ref.is_some_and(|patch_ref| requested_patch_ref == Some(patch_ref));
                if artifact_matches || patch_matches {
                    return Ok(Some(ticket));
                }
            }
            Ok(None)
        })
    }

    pub fn read_recent_denied_approval_summaries(
        &self,
        session_id: &str,
        limit: usize,
    ) -> Result<Vec<Value>> {
        let limit = i64::try_from(limit.max(1)).unwrap_or(5);
        self.with_session_conn(session_id, |conn| {
            let mut stmt = conn.prepare(
                "SELECT approval_ticket_id, runtime_turn_id, title, approval_mode,
                        risk_summary_json, impact_scope_json, requested_action_json,
                        updated_at_ms
                 FROM approval_ticket
                 WHERE session_id = ?1 AND status = 'denied'
                 ORDER BY updated_at_ms DESC
                 LIMIT ?2",
            )?;
            let rows = stmt.query_map(params![session_id, limit], |row| {
                let risk_json: String = row.get(4)?;
                let impact_json: String = row.get(5)?;
                let requested_json: String = row.get(6)?;
                let risk_summary: Value =
                    serde_json::from_str(&risk_json).unwrap_or_else(|_| json!({}));
                let impact_scope: Value =
                    serde_json::from_str(&impact_json).unwrap_or_else(|_| json!({}));
                let requested_action: Value =
                    serde_json::from_str(&requested_json).unwrap_or_else(|_| json!({}));
                Ok(json!({
                    "approvalTicketId": row.get::<_, String>(0)?,
                    "turnId": row.get::<_, String>(1)?,
                    "title": row.get::<_, String>(2)?,
                    "approvalMode": row.get::<_, String>(3)?,
                    "status": "denied",
                    "toolPath": requested_action.get("toolPath").cloned().unwrap_or(Value::Null),
                    "artifactId": requested_action
                        .get("artifactId")
                        .or_else(|| requested_action.get("appliedArtifactId"))
                        .cloned()
                        .unwrap_or(Value::Null),
                    "patchRef": requested_action.get("patchRef").cloned().unwrap_or(Value::Null),
                    "riskSummary": risk_summary,
                    "impactScope": impact_scope,
                    "updatedAt": row.get::<_, i64>(7)?,
                }))
            })?;
            let mut result = Vec::new();
            for row in rows {
                result.push(row?);
            }
            Ok(result)
        })
    }

    pub fn append_patch_file_backup(
        &self,
        session_id: &str,
        turn_id: &str,
        approval_ticket_id: &str,
        source_artifact_id: &str,
        patch_ref: &str,
        path: &str,
        original_content: Option<&str>,
        post_apply_content: &str,
    ) -> Result<PatchFileBackupRef> {
        let backup_ref = new_id("backup");
        let backup_dir = self.session_dir(session_id).join("patch-backups");
        fs::create_dir_all(&backup_dir).with_context(|| {
            format!("failed to create patch backup dir {}", backup_dir.display())
        })?;
        let existed = original_content.is_some();
        let (content_ref, content_sha256, content_bytes) = if let Some(content) = original_content {
            let content_ref = format!("{backup_ref}.txt");
            let backup_path = backup_dir.join(&content_ref);
            fs::write(&backup_path, content).with_context(|| {
                format!("failed to write patch backup {}", backup_path.display())
            })?;
            (
                Some(content_ref),
                Some(sha256_hex(content.as_bytes())),
                content.len() as i64,
            )
        } else {
            (None, None, 0_i64)
        };
        let post_apply_sha256 = sha256_hex(post_apply_content.as_bytes());
        let post_apply_bytes = post_apply_content.len() as i64;
        let created_at = now_ms();
        let created_iso = now_iso();
        self.with_session_conn(session_id, |conn| {
            conn.execute(
                "INSERT INTO file_backup_record (
                    backup_ref, session_id, runtime_turn_id, approval_ticket_id,
                    source_artifact_id, patch_ref, path, existed, content_ref,
                    content_sha256, content_bytes, post_apply_sha256, post_apply_bytes,
                    created_at_ms, created_at_iso
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
                params![
                    backup_ref,
                    session_id,
                    turn_id,
                    approval_ticket_id,
                    source_artifact_id,
                    patch_ref,
                    path,
                    if existed { 1_i64 } else { 0_i64 },
                    content_ref,
                    content_sha256,
                    content_bytes,
                    post_apply_sha256,
                    post_apply_bytes,
                    created_at,
                    created_iso,
                ],
            )?;
            Ok(())
        })?;
        Ok(PatchFileBackupRef {
            backup_ref,
            path: path.to_string(),
            existed,
            content_sha256,
            content_bytes,
            post_apply_sha256: Some(post_apply_sha256),
            post_apply_bytes: Some(post_apply_bytes),
        })
    }

    pub fn create_timeline_checkpoint(
        &self,
        session_id: &str,
        turn_id: &str,
        user_message_id: &str,
    ) -> Result<String> {
        let checkpoint_id = new_id("checkpoint");
        let created_at = now_ms();
        let created_iso = now_iso();
        self.with_session_conn(session_id, |conn| {
            let mut stmt = conn.prepare(
                "SELECT msg_id FROM session_dialog ORDER BY created_at_ms ASC, turn_index ASC",
            )?;
            let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
            let mut visible_message_ids = Vec::new();
            for row in rows {
                visible_message_ids.push(row?);
            }
            conn.execute(
                "INSERT INTO timeline_checkpoint (
                    checkpoint_id, session_id, runtime_turn_id, user_message_id,
                    conversation_snapshot_json, created_at_ms, created_at_iso
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![
                    checkpoint_id,
                    session_id,
                    turn_id,
                    user_message_id,
                    json!({
                        "schemaVersion": "v1",
                        "visibleMessageIds": visible_message_ids,
                        "activeCursorMessageId": user_message_id,
                        "createdBeforeAgentResponse": true
                    })
                    .to_string(),
                    created_at,
                    created_iso,
                ],
            )?;
            Ok(())
        })?;
        Ok(checkpoint_id)
    }

    #[cfg(test)]
    pub fn count_rows_for_test(&self, session_id: &str, table: &str) -> Result<i64> {
        if matches!(
            table,
            "artifact_record"
                | "evidence_record"
                | "timeline_checkpoint"
                | "approval_ticket"
                | "file_backup_record"
        ) == false
        {
            return Err(anyhow!("unsupported table for test count"));
        }
        self.with_session_conn(session_id, |conn| {
            conn.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                row.get(0)
            })
            .context("failed to count AI session rows")
        })
    }

    #[allow(dead_code)]
    pub fn read_tool_result_blob(
        &self,
        session_id: &str,
        result_ref: &str,
    ) -> Result<Option<ToolResultBlobRecord>> {
        self.with_session_conn(session_id, |conn| {
            conn.query_row(
                "SELECT result_ref, runtime_turn_id, op_id, tool_path, status,
                        content_json, content_sha256, content_bytes, created_at_ms
                 FROM tool_result_blob WHERE result_ref = ?1",
                params![result_ref],
                |row| {
                    Ok(ToolResultBlobRecord {
                        result_ref: row.get(0)?,
                        runtime_turn_id: row.get(1)?,
                        op_id: row.get(2)?,
                        tool_path: row.get(3)?,
                        status: row.get(4)?,
                        content_json: row.get(5)?,
                        content_sha256: row.get(6)?,
                        content_bytes: row.get(7)?,
                        created_at: row.get(8)?,
                    })
                },
            )
            .optional()
            .context("failed to read ToolFS result blob")
        })
    }

    pub fn read_diff_artifact_blob(
        &self,
        session_id: &str,
        artifact_id: Option<&str>,
        patch_ref: Option<&str>,
    ) -> Result<Option<DiffArtifactBlobRecord>> {
        self.with_session_conn(session_id, |conn| {
            let row = if let Some(artifact_id) = artifact_id {
                conn.query_row(
                    "SELECT a.artifact_id, a.runtime_turn_id, a.title, a.content_ref, a.metadata_json,
                            b.content_json, b.content_sha256, b.content_bytes, a.created_at_ms,
                            a.status
                     FROM artifact_record a
                     JOIN tool_result_blob b ON b.result_ref = a.content_ref
                     WHERE a.session_id = ?1 AND a.kind = 'diff' AND a.artifact_id = ?2",
                    params![session_id, artifact_id],
                    read_diff_artifact_blob_row,
                )
                .optional()?
            } else if let Some(patch_ref) = patch_ref {
                conn.query_row(
                    "SELECT a.artifact_id, a.runtime_turn_id, a.title, a.content_ref, a.metadata_json,
                            b.content_json, b.content_sha256, b.content_bytes, a.created_at_ms,
                            a.status
                     FROM artifact_record a
                     JOIN tool_result_blob b ON b.result_ref = a.content_ref
                     WHERE a.session_id = ?1 AND a.kind = 'diff' AND a.content_ref = ?2
                     ORDER BY CASE WHEN a.status = 'created' THEN 0 ELSE 1 END, a.created_at_ms ASC
                     LIMIT 1",
                    params![session_id, patch_ref],
                    read_diff_artifact_blob_row,
                )
                .optional()?
            } else {
                None
            };
            let Some(mut row) = row else {
                return Ok(None);
            };
            row.evidence_id = read_evidence_id_for_artifact(conn, session_id, &row.artifact_id)?;
            Ok(Some(row))
        })
        .context("failed to read AI diff artifact")
    }

    pub fn find_applied_patch_artifact(
        &self,
        session_id: &str,
        source_artifact_id: &str,
        patch_ref: &str,
    ) -> Result<Option<DiffArtifactBlobRecord>> {
        self.with_session_conn(session_id, |conn| {
            let mut stmt = conn.prepare(
                "SELECT a.artifact_id, a.runtime_turn_id, a.title, a.content_ref, a.metadata_json,
                        b.content_json, b.content_sha256, b.content_bytes, a.created_at_ms,
                        a.status
                 FROM artifact_record a
                 JOIN tool_result_blob b ON b.result_ref = a.content_ref
                 WHERE a.session_id = ?1
                   AND a.kind = 'diff'
                   AND a.status IN ('applied', 'rolled_back')
                 ORDER BY a.created_at_ms ASC",
            )?;
            let rows = stmt.query_map(params![session_id], read_diff_artifact_blob_row)?;
            for row in rows {
                let mut record = row?;
                let metadata_patch_ref = record.metadata.get("patchRef").and_then(Value::as_str);
                let metadata_source_artifact_id = record
                    .metadata
                    .get("appliedFromArtifactId")
                    .and_then(Value::as_str);
                if record.content_ref == patch_ref
                    || metadata_patch_ref == Some(patch_ref)
                    || metadata_source_artifact_id == Some(source_artifact_id)
                {
                    record.evidence_id =
                        read_evidence_id_for_artifact(conn, session_id, &record.artifact_id)?;
                    return Ok(Some(record));
                }
            }
            Ok(None)
        })
    }

    pub fn read_patch_artifact_record(
        &self,
        session_id: &str,
        artifact_id: &str,
    ) -> Result<Option<DiffArtifactBlobRecord>> {
        self.with_session_conn(session_id, |conn| {
            let mut row = conn
                .query_row(
                    "SELECT a.artifact_id, a.runtime_turn_id, a.title, a.content_ref, a.metadata_json,
                            b.content_json, b.content_sha256, b.content_bytes, a.created_at_ms,
                            a.status
                     FROM artifact_record a
                     JOIN tool_result_blob b ON b.result_ref = a.content_ref
                     WHERE a.session_id = ?1 AND a.kind = 'diff' AND a.artifact_id = ?2",
                    params![session_id, artifact_id],
                    read_diff_artifact_blob_row,
                )
                .optional()?;
            if let Some(row) = row.as_mut() {
                row.evidence_id = read_evidence_id_for_artifact(conn, session_id, &row.artifact_id)?;
            }
            Ok(row)
        })
    }

    pub fn update_artifact_status(
        &self,
        session_id: &str,
        artifact_id: &str,
        status: &str,
    ) -> Result<()> {
        let updated_at = now_ms();
        let updated_iso = now_iso();
        self.with_session_conn(session_id, |conn| {
            let rows = conn.execute(
                "UPDATE artifact_record
                 SET status = ?1, updated_at_ms = ?2, updated_at_iso = ?3
                 WHERE session_id = ?4 AND artifact_id = ?5",
                params![status, updated_at, updated_iso, session_id, artifact_id],
            )?;
            if rows == 0 {
                return Err(anyhow!("artifact not found: {artifact_id}"));
            }
            Ok(())
        })
    }

    pub fn read_patch_file_backup(
        &self,
        session_id: &str,
        backup_ref: &str,
    ) -> Result<Option<PatchFileBackupRecord>> {
        self.with_session_conn(session_id, |conn| {
            conn.query_row(
                "SELECT backup_ref, session_id, runtime_turn_id, approval_ticket_id,
                        source_artifact_id, patch_ref, path, existed, content_ref,
                        content_sha256, content_bytes, post_apply_sha256, post_apply_bytes
                 FROM file_backup_record
                 WHERE session_id = ?1 AND backup_ref = ?2",
                params![session_id, backup_ref],
                read_patch_file_backup_row,
            )
            .optional()
            .context("failed to read patch file backup")
        })
    }

    pub fn read_patch_backup_content(&self, session_id: &str, content_ref: &str) -> Result<String> {
        let content_file_name = Path::new(content_ref)
            .file_name()
            .and_then(|value| value.to_str())
            .filter(|value| *value == content_ref)
            .ok_or_else(|| anyhow!("invalid backup content ref"))?;
        let path = self
            .session_dir(session_id)
            .join("patch-backups")
            .join(content_file_name);
        fs::read_to_string(&path)
            .with_context(|| format!("failed to read patch backup {}", path.display()))
    }

    pub fn read_session_detail(&self, session_id: &str) -> Result<Option<AgentSessionDetail>> {
        let Some(session) = self.read_session_index(session_id)? else {
            return Ok(None);
        };
        let turns = self.read_turns(session_id)?;
        let messages = self.read_messages(session_id)?;
        let runtime_events = self.read_runtime_events(session_id)?;
        let pending_interactions = self.read_pending_approval_interactions(session_id)?;
        Ok(Some(AgentSessionDetail {
            session,
            pending_interactions,
            turns,
            messages,
            runtime_events,
        }))
    }

    pub fn read_turns(&self, session_id: &str) -> Result<Vec<AgentTurn>> {
        self.with_session_conn(session_id, |conn| {
            let mut stmt = conn.prepare(
                "SELECT runtime_turn_id, session_id, profile_id, status, collaboration_mode,
                        permission_mode, error_code, error_message, usage_json, created_at_ms, updated_at_ms
                 FROM runtime_turn ORDER BY created_at_ms ASC",
            )?;
            let rows = stmt.query_map([], |row| {
                let usage_json: Option<String> = row.get(8)?;
                Ok(AgentTurn {
                    id: row.get(0)?,
                    session_id: row.get(1)?,
                    profile_id: row.get(2)?,
                    status: row.get(3)?,
                    collaboration_mode: row.get(4)?,
                    permission_mode: row.get(5)?,
                    error_code: row.get(6)?,
                    error_message: row.get(7)?,
                    usage: usage_json.and_then(|value| serde_json::from_str(&value).ok()),
                    created_at: row.get(9)?,
                    updated_at: row.get(10)?,
                })
            })?;
            let mut result = Vec::new();
            for row in rows {
                result.push(row?);
            }
            Ok(result)
        })
    }

    pub fn read_messages(&self, session_id: &str) -> Result<Vec<AgentMessage>> {
        self.with_session_conn(session_id, |conn| {
            let mut stmt = conn.prepare(
                "SELECT msg_id, role, content_raw, content_parts_json, created_at_ms, turn_id
                 FROM session_dialog ORDER BY created_at_ms ASC, turn_index ASC",
            )?;
            let rows = stmt.query_map([], |row| {
                let content_parts_json: Option<String> = row.get(3)?;
                let content: String = row.get(2)?;
                Ok(AgentMessage {
                    id: row.get(0)?,
                    session_id: session_id.to_string(),
                    turn_id: row.get(5)?,
                    role: row.get(1)?,
                    display_content: Some(content.clone()),
                    content,
                    content_parts: content_parts_json
                        .and_then(|value| serde_json::from_str(&value).ok()),
                    created_at: row.get(4)?,
                })
            })?;
            let mut result = Vec::new();
            for row in rows {
                result.push(row?);
            }
            Ok(result)
        })
    }

    pub fn read_pending_approval_interactions(&self, session_id: &str) -> Result<Vec<Value>> {
        self.with_session_conn(session_id, |conn| {
            let mut stmt = conn.prepare(
                "SELECT approval_ticket_id, session_id, runtime_turn_id, status, approval_mode,
                        title, risk_summary_json, impact_scope_json, requested_action_json,
                        created_at_ms, updated_at_ms
                 FROM approval_ticket
                 WHERE session_id = ?1 AND status = 'pending_user'
                 ORDER BY created_at_ms ASC",
            )?;
            let rows = stmt.query_map(params![session_id], |row| {
                let risk_json: String = row.get(6)?;
                let impact_json: String = row.get(7)?;
                let requested_json: String = row.get(8)?;
                let approval_ticket_id: String = row.get(0)?;
                let approval_mode: String = row.get(4)?;
                let title: String = row.get(5)?;
                let risk_summary: Value =
                    serde_json::from_str(&risk_json).unwrap_or_else(|_| json!({}));
                let impact_scope: Value =
                    serde_json::from_str(&impact_json).unwrap_or_else(|_| json!({}));
                let requested_action: Value =
                    serde_json::from_str(&requested_json).unwrap_or_else(|_| json!({}));
                let tool_path = requested_action
                    .get("toolPath")
                    .cloned()
                    .unwrap_or(Value::Null);
                let artifact_id = requested_action
                    .get("artifactId")
                    .or_else(|| requested_action.get("appliedArtifactId"))
                    .cloned()
                    .unwrap_or(Value::Null);
                let patch_ref = requested_action
                    .get("patchRef")
                    .cloned()
                    .unwrap_or(Value::Null);
                Ok(json!({
                    "id": approval_ticket_id,
                    "sessionId": row.get::<_, String>(1)?,
                    "turnId": row.get::<_, String>(2)?,
                    "kind": "tool_approval",
                    "status": "pending",
                    "payload": {
                        "approvalTicketId": approval_ticket_id,
                        "toolPath": tool_path,
                        "artifactId": artifact_id,
                        "patchRef": patch_ref,
                        "riskSummary": risk_summary,
                        "impactScope": impact_scope,
                        "requestedAction": requested_action,
                        "approvalMode": approval_mode,
                        "title": title
                    },
                    "createdAt": row.get::<_, i64>(9)?,
                    "updatedAt": row.get::<_, i64>(10)?,
                }))
            })?;
            let mut result = Vec::new();
            for row in rows {
                result.push(row?);
            }
            Ok(result)
        })
    }

    pub fn read_runtime_events(&self, session_id: &str) -> Result<Vec<AgentRuntimeEvent>> {
        self.with_session_conn(session_id, |conn| {
            let mut stmt = conn.prepare(
                "SELECT session_id, runtime_turn_id, event_type, payload_json, created_at_ms
                 FROM runtime_event ORDER BY sequence ASC",
            )?;
            let rows = stmt.query_map([], |row| {
                let payload_json: String = row.get(3)?;
                Ok(AgentRuntimeEvent {
                    session_id: row.get(0)?,
                    turn_id: row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                    phase: row.get(2)?,
                    payload: serde_json::from_str(&payload_json).unwrap_or(Value::Null),
                    timestamp: row.get(4)?,
                })
            })?;
            let mut result = Vec::new();
            for row in rows {
                result.push(row?);
            }
            Ok(result)
        })
    }
}

fn configure_conn(conn: &Connection) -> Result<()> {
    conn.busy_timeout(Duration::from_secs(10))
        .context("failed to configure AI database busy timeout")?;
    conn.execute_batch("PRAGMA busy_timeout = 10000;")?;
    Ok(())
}

fn migrate_index(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS ai_profile (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            provider_id TEXT NOT NULL,
            protocol_id TEXT NOT NULL,
            runtime_provider_id TEXT NOT NULL,
            runtime_supported INTEGER NOT NULL,
            preset_id TEXT,
            connection_config_json TEXT NOT NULL,
            auth_config_json TEXT NOT NULL,
            headers_json TEXT NOT NULL,
            model TEXT NOT NULL,
            model_runtime_metadata_json TEXT,
            custom_models_json TEXT NOT NULL,
            discovery_state_json TEXT NOT NULL,
            is_default INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS profile_secret (
            profile_id TEXT NOT NULL,
            field_id TEXT NOT NULL,
            secret_ref_id TEXT NOT NULL,
            updated_at INTEGER NOT NULL,
            PRIMARY KEY(profile_id, field_id)
        );
        CREATE TABLE IF NOT EXISTS agent_session_index (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            profile_id TEXT,
            project_root TEXT,
            project_name TEXT,
            collaboration_mode TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );
        ",
    )?;
    Ok(())
}

fn migrate_session(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS session_dialog (
            msg_id TEXT PRIMARY KEY,
            turn_index INTEGER NOT NULL,
            role TEXT NOT NULL,
            content_raw TEXT NOT NULL,
            content_parts_json TEXT,
            token_count INTEGER NOT NULL DEFAULT 0,
            char_count INTEGER NOT NULL DEFAULT 0,
            created_at_ms INTEGER NOT NULL,
            created_at_iso TEXT NOT NULL,
            updated_at_ms INTEGER NOT NULL,
            metadata_json TEXT NOT NULL,
            stream_id TEXT,
            turn_id TEXT
        );
        CREATE TABLE IF NOT EXISTS runtime_turn (
            runtime_turn_id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            user_message_id TEXT NOT NULL,
            profile_id TEXT NOT NULL,
            status TEXT NOT NULL,
            current_state TEXT NOT NULL,
            collaboration_mode TEXT,
            permission_mode TEXT NOT NULL DEFAULT 'sandbox',
            project_policy_snapshot_id TEXT,
            created_at_ms INTEGER NOT NULL,
            created_at_iso TEXT NOT NULL,
            updated_at_ms INTEGER NOT NULL,
            error_code TEXT,
            error_message TEXT,
            usage_json TEXT
        );
        CREATE TABLE IF NOT EXISTS runtime_event (
            event_id TEXT PRIMARY KEY,
            sequence INTEGER NOT NULL,
            session_id TEXT NOT NULL,
            runtime_turn_id TEXT,
            event_type TEXT NOT NULL,
            payload_json TEXT NOT NULL,
            created_at_ms INTEGER NOT NULL,
            created_at_iso TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS runtime_event_sequence_idx ON runtime_event(sequence);
        CREATE TABLE IF NOT EXISTS tool_result_blob (
            result_ref TEXT PRIMARY KEY,
            runtime_turn_id TEXT NOT NULL,
            op_id TEXT NOT NULL,
            tool_path TEXT NOT NULL,
            status TEXT NOT NULL,
            content_json TEXT NOT NULL,
            content_sha256 TEXT NOT NULL,
            content_bytes INTEGER NOT NULL,
            created_at_ms INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS artifact_record (
            artifact_id TEXT PRIMARY KEY,
            artifact_version_id TEXT NOT NULL,
            session_id TEXT NOT NULL,
            runtime_turn_id TEXT,
            kind TEXT NOT NULL,
            status TEXT NOT NULL,
            title TEXT NOT NULL,
            content_ref TEXT NOT NULL,
            projection_ref TEXT,
            metadata_json TEXT NOT NULL,
            source_json TEXT NOT NULL,
            created_at_ms INTEGER NOT NULL,
            created_at_iso TEXT NOT NULL,
            updated_at_ms INTEGER NOT NULL,
            updated_at_iso TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS evidence_record (
            evidence_id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            runtime_turn_id TEXT,
            kind TEXT NOT NULL,
            status TEXT NOT NULL,
            claim_json TEXT NOT NULL,
            artifact_ids_json TEXT NOT NULL,
            tool_operation_ids_json TEXT NOT NULL,
            confidence TEXT NOT NULL,
            created_at_ms INTEGER NOT NULL,
            created_at_iso TEXT NOT NULL,
            stale_reason TEXT
        );
        CREATE TABLE IF NOT EXISTS approval_ticket (
            approval_ticket_id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            runtime_turn_id TEXT NOT NULL,
            status TEXT NOT NULL,
            approval_mode TEXT NOT NULL,
            title TEXT NOT NULL,
            risk_summary_json TEXT NOT NULL,
            impact_scope_json TEXT NOT NULL,
            requested_action_json TEXT NOT NULL,
            created_at_ms INTEGER NOT NULL,
            created_at_iso TEXT NOT NULL,
            updated_at_ms INTEGER NOT NULL,
            updated_at_iso TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS file_backup_record (
            backup_ref TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            runtime_turn_id TEXT NOT NULL,
            approval_ticket_id TEXT NOT NULL,
            source_artifact_id TEXT NOT NULL,
            patch_ref TEXT NOT NULL,
            path TEXT NOT NULL,
            existed INTEGER NOT NULL,
            content_ref TEXT,
            content_sha256 TEXT,
            content_bytes INTEGER NOT NULL,
            post_apply_sha256 TEXT,
            post_apply_bytes INTEGER,
            created_at_ms INTEGER NOT NULL,
            created_at_iso TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS timeline_checkpoint (
            checkpoint_id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            runtime_turn_id TEXT NOT NULL,
            user_message_id TEXT NOT NULL,
            conversation_snapshot_json TEXT NOT NULL,
            created_at_ms INTEGER NOT NULL,
            created_at_iso TEXT NOT NULL
        );
        ",
    )?;
    ensure_column(
        conn,
        "runtime_turn",
        "permission_mode",
        "TEXT NOT NULL DEFAULT 'sandbox'",
    )?;
    ensure_column(conn, "file_backup_record", "post_apply_sha256", "TEXT")?;
    ensure_column(conn, "file_backup_record", "post_apply_bytes", "INTEGER")?;
    Ok(())
}

fn ensure_column(conn: &Connection, table: &str, column: &str, definition: &str) -> Result<()> {
    let mut stmt = conn.prepare(&format!("PRAGMA table_info({table})"))?;
    let rows = stmt.query_map([], |row| row.get::<_, String>(1))?;
    for row in rows {
        if row? == column {
            return Ok(());
        }
    }
    conn.execute(
        &format!("ALTER TABLE {table} ADD COLUMN {column} {definition}"),
        [],
    )?;
    Ok(())
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
}

fn preview_text(value: &str, max_chars: usize) -> String {
    let mut preview = value.chars().take(max_chars).collect::<String>();
    if value.chars().count() > max_chars {
        preview.push_str("...");
    }
    preview
}

fn read_diff_artifact_blob_row(row: &Row<'_>) -> rusqlite::Result<DiffArtifactBlobRecord> {
    let metadata_json: String = row.get(4)?;
    Ok(DiffArtifactBlobRecord {
        artifact_id: row.get(0)?,
        runtime_turn_id: row.get(1)?,
        evidence_id: None,
        status: row.get(9)?,
        title: row.get(2)?,
        content_ref: row.get(3)?,
        metadata: serde_json::from_str(&metadata_json).unwrap_or_else(|_| json!({})),
        content: row.get(5)?,
        content_sha256: row.get(6)?,
        content_bytes: row.get(7)?,
        created_at: row.get(8)?,
    })
}

fn read_approval_ticket_row(row: &Row<'_>) -> rusqlite::Result<ApprovalTicketRecord> {
    Ok(ApprovalTicketRecord {
        approval_ticket_id: row.get(0)?,
        session_id: row.get(1)?,
        runtime_turn_id: row.get(2)?,
        status: row.get(3)?,
        approval_mode: row.get(4)?,
        title: row.get(5)?,
        created_at: row.get(6)?,
        updated_at: row.get(7)?,
    })
}

fn read_patch_file_backup_row(row: &Row<'_>) -> rusqlite::Result<PatchFileBackupRecord> {
    Ok(PatchFileBackupRecord {
        backup_ref: row.get(0)?,
        session_id: row.get(1)?,
        runtime_turn_id: row.get(2)?,
        approval_ticket_id: row.get(3)?,
        source_artifact_id: row.get(4)?,
        patch_ref: row.get(5)?,
        path: row.get(6)?,
        existed: row.get::<_, i64>(7)? != 0,
        content_ref: row.get(8)?,
        content_sha256: row.get(9)?,
        content_bytes: row.get(10)?,
        post_apply_sha256: row.get(11)?,
        post_apply_bytes: row.get(12)?,
    })
}

fn read_evidence_id_for_artifact(
    conn: &Connection,
    session_id: &str,
    artifact_id: &str,
) -> Result<Option<String>> {
    let mut stmt = conn.prepare(
        "SELECT evidence_id, artifact_ids_json
         FROM evidence_record
         WHERE session_id = ?1
         ORDER BY created_at_ms ASC",
    )?;
    let rows = stmt.query_map(params![session_id], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })?;
    for row in rows {
        let (evidence_id, artifact_ids_json) = row?;
        let artifact_ids: Vec<String> =
            serde_json::from_str(&artifact_ids_json).unwrap_or_default();
        if artifact_ids.iter().any(|id| id == artifact_id) {
            return Ok(Some(evidence_id));
        }
    }
    Ok(None)
}

fn read_profile_row(conn: &Connection, profile_id: &str) -> Result<Option<AiProviderProfile>> {
    let row = conn
        .query_row(
            "SELECT id, name, provider_id, protocol_id, runtime_provider_id, runtime_supported,
                    preset_id, connection_config_json, auth_config_json, headers_json, model,
                    model_runtime_metadata_json, custom_models_json, discovery_state_json,
                    is_default, created_at, updated_at
             FROM ai_profile WHERE id = ?1",
            params![profile_id],
            |row| {
                let connection_json: String = row.get(7)?;
                let auth_json: String = row.get(8)?;
                let headers_json: String = row.get(9)?;
                let runtime_metadata_json: Option<String> = row.get(11)?;
                let custom_models_json: String = row.get(12)?;
                let discovery_json: String = row.get(13)?;
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, i64>(5)? != 0,
                    row.get::<_, Option<String>>(6)?,
                    connection_json,
                    auth_json,
                    headers_json,
                    row.get::<_, String>(10)?,
                    runtime_metadata_json,
                    custom_models_json,
                    discovery_json,
                    row.get::<_, i64>(14)? != 0,
                    row.get::<_, i64>(15)?,
                    row.get::<_, i64>(16)?,
                ))
            },
        )
        .optional()?;
    let Some(row) = row else {
        return Ok(None);
    };
    let secret_rows = {
        let mut stmt = conn.prepare(
            "SELECT field_id, secret_ref_id FROM profile_secret WHERE profile_id = ?1 ORDER BY field_id",
        )?;
        let rows = stmt.query_map(params![profile_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;
        let mut result = Vec::new();
        for row in rows {
            result.push(row?);
        }
        result
    };
    let configured_secret_fields = secret_rows
        .iter()
        .map(|(field, _)| field.clone())
        .collect::<Vec<_>>();
    let secret_status = if configured_secret_fields.is_empty() {
        "missing"
    } else {
        "configured"
    }
    .to_string();
    Ok(Some(AiProviderProfile {
        id: row.0,
        name: row.1,
        provider_id: row.2,
        protocol_id: row.3,
        runtime_provider_id: row.4,
        runtime_supported: row.5,
        secret_status,
        preset_id: row.6,
        connection_config: parse_json_or(row.7, HashMap::new()),
        auth_config: parse_json_or(row.8, HashMap::new()),
        configured_secret_fields,
        headers: parse_json_or(row.9, HashMap::new()),
        model: row.10,
        model_runtime_metadata: row.11.and_then(|value| serde_json::from_str(&value).ok()),
        custom_models: parse_json_or(row.12, Vec::new()),
        discovery_state: parse_json_or(row.13, AiModelDiscoveryState::default()),
        is_default: row.14,
        created_at: row.15,
        updated_at: row.16,
    }))
}

fn read_session_index_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<AgentSession> {
    Ok(AgentSession {
        id: row.get(0)?,
        title: row.get(1)?,
        profile_id: row.get(2)?,
        project_root: row.get(3)?,
        project_name: row.get(4)?,
        collaboration_mode: row.get(5)?,
        created_at: row.get(6)?,
        updated_at: row.get(7)?,
    })
}

pub fn project_name_from_root(project_root: Option<&str>) -> Option<String> {
    let root = project_root.and_then(trim_to_string)?;
    Path::new(&root)
        .file_name()
        .and_then(|value| value.to_str())
        .map(ToString::to_string)
}

pub fn policy_snapshot_ref(project_root: Option<&str>) -> Option<String> {
    let root = project_root.and_then(trim_to_string)?;
    let mut hasher = Sha256::new();
    hasher.update(root.as_bytes());
    Some(format!(
        "policy_{}",
        hex_prefix(hasher.finalize().as_slice(), 8)
    ))
}

fn hex_prefix(bytes: &[u8], count: usize) -> String {
    let mut out = String::new();
    for byte in bytes.iter().take(count) {
        out.push_str(&format!("{byte:02x}"));
    }
    out
}
