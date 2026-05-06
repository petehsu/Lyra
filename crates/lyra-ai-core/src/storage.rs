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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active_todo: Option<AgentExecutionTodoList>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub execution_summary: Option<AgentExecutionSummary>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub verification_summary: Option<AgentVerificationSummary>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completion_audit: Option<AgentCompletionAuditSummary>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub delivery_proof: Option<AgentDeliveryProofSummary>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentExecutionTodoList {
    pub todo_list_id: String,
    pub session_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub runtime_turn_id: Option<String>,
    pub kind: String,
    pub status: String,
    pub title: String,
    pub source: Value,
    pub items: Vec<AgentTodoItem>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentTodoItem {
    pub todo_item_id: String,
    pub todo_list_id: String,
    pub status: String,
    pub title: String,
    pub actions: Vec<String>,
    pub expected_tools: Vec<String>,
    pub risk_level: String,
    pub completion_criteria: Vec<String>,
    pub evidence_refs: Vec<String>,
    pub blockers: Value,
    pub source: Value,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentExecutionSummary {
    pub execution_run_id: String,
    pub session_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub runtime_turn_id: Option<String>,
    pub todo_list_id: String,
    pub status: String,
    pub step_count: i64,
    pub completed_step_count: i64,
    pub failed_step_count: i64,
    pub blocked_step_count: i64,
    pub updated_at: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTodoItemInput {
    pub title: String,
    #[serde(default)]
    pub actions: Vec<String>,
    #[serde(default)]
    pub expected_tools: Vec<String>,
    #[serde(default = "default_medium_risk")]
    pub risk_level: String,
    #[serde(default)]
    pub completion_criteria: Vec<String>,
    #[serde(default)]
    pub source: Value,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatedTodoRefs {
    pub todo_list_id: String,
    pub execution_run_id: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TodoUpdateRecord {
    pub todo_list_id: String,
    pub todo_item_id: Option<String>,
    pub execution_run_id: String,
    pub execution_step_id: String,
    pub status: String,
    pub step_status: String,
    pub title: Option<String>,
    pub evidence_refs: Vec<String>,
    pub artifact_refs: Vec<String>,
    pub blocker: Value,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentVerificationSummary {
    pub verification_plan_id: String,
    pub session_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub runtime_turn_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub execution_run_id: Option<String>,
    pub status: String,
    pub required_run_count: i64,
    pub passed_run_count: i64,
    pub failed_run_count: i64,
    pub blocked_run_count: i64,
    pub not_run_count: i64,
    pub runs: Vec<AgentVerificationRunSummary>,
    pub updated_at: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentVerificationRunSummary {
    pub verification_run_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub verification_plan_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub execution_run_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub runtime_turn_id: Option<String>,
    pub kind: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub command: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exit_code: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub artifact_id: Option<String>,
    pub evidence_refs: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub skip_reason: Option<String>,
    pub residual_risk: Value,
    pub updated_at: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentDeliveryProofSummary {
    pub delivery_proof_id: String,
    pub session_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub runtime_turn_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub execution_run_id: Option<String>,
    pub status: String,
    pub verification_run_ids: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completion_audit_id: Option<String>,
    pub artifact_refs: Vec<String>,
    pub evidence_refs: Vec<String>,
    pub unresolved_risks: Value,
    pub summary: String,
    pub updated_at: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCompletionAuditSummary {
    pub completion_audit_id: String,
    pub session_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub runtime_turn_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub execution_run_id: Option<String>,
    pub status: String,
    pub missing_todo_item_ids: Vec<String>,
    pub missing_evidence_refs: Vec<String>,
    pub failed_verification_run_ids: Vec<String>,
    pub blocked_verification_run_ids: Vec<String>,
    pub not_run_verification_run_ids: Vec<String>,
    pub pending_approval_ticket_ids: Vec<String>,
    pub residual_risks: Value,
    pub summary: String,
    pub updated_at: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VerificationPlanRecord {
    pub verification_plan_id: String,
    pub session_id: String,
    pub runtime_turn_id: Option<String>,
    pub execution_run_id: Option<String>,
    pub status: String,
    pub required: Vec<Value>,
    pub not_run: Vec<Value>,
    pub updated_at: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandArtifactRefs {
    pub artifact_id: String,
    pub evidence_id: String,
    pub verification_plan_id: String,
    pub verification_run_id: String,
}

fn default_medium_risk() -> String {
    "medium".to_string()
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

    pub fn find_pending_approval_for_tool_command(
        &self,
        session_id: &str,
        tool_path: &str,
        command_hash: &str,
    ) -> Result<Option<ApprovalTicketRecord>> {
        self.find_approval_for_tool_command(session_id, "pending_user", tool_path, command_hash)
    }

    pub fn find_denied_approval_for_tool_command(
        &self,
        session_id: &str,
        tool_path: &str,
        command_hash: &str,
    ) -> Result<Option<ApprovalTicketRecord>> {
        self.find_approval_for_tool_command(session_id, "denied", tool_path, command_hash)
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

    fn find_approval_for_tool_command(
        &self,
        session_id: &str,
        status: &str,
        tool_path: &str,
        command_hash: &str,
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
                if requested.get("commandHash").and_then(Value::as_str) == Some(command_hash) {
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
                | "execution_todo_list"
                | "todo_item"
                | "execution_run"
                | "execution_step"
                | "verification_plan"
                | "verification_run"
                | "completion_audit"
                | "delivery_proof"
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

    pub fn create_execution_todo_list(
        &self,
        session_id: &str,
        turn_id: Option<&str>,
        kind: &str,
        title: &str,
        source: Value,
        items: &[CreateTodoItemInput],
    ) -> Result<CreatedTodoRefs> {
        if items.is_empty() {
            return Err(anyhow!("todo items are required"));
        }
        let todo_list_id = new_id("todo_list");
        let execution_run_id = new_id("execution_run");
        let now = now_ms();
        let now_iso = now_iso();
        self.with_session_conn(session_id, |conn| {
            conn.execute(
                "UPDATE execution_todo_list
                 SET status = 'superseded', updated_at_ms = ?1, updated_at_iso = ?2
                 WHERE session_id = ?3 AND status != 'superseded'",
                params![now, now_iso, session_id],
            )?;
            conn.execute(
                "INSERT INTO execution_todo_list (
                    todo_list_id, session_id, runtime_turn_id, kind, status, source_json,
                    title, created_at_ms, created_at_iso, updated_at_ms, updated_at_iso
                 ) VALUES (?1, ?2, ?3, ?4, 'active', ?5, ?6, ?7, ?8, ?7, ?8)",
                params![
                    todo_list_id,
                    session_id,
                    turn_id,
                    normalize_todo_kind(kind),
                    source.to_string(),
                    title.trim(),
                    now,
                    now_iso,
                ],
            )?;
            for item in items {
                let todo_item_id = new_id("todo_item");
                conn.execute(
                    "INSERT INTO todo_item (
                        todo_item_id, todo_list_id, status, title, actions_json,
                        expected_tools_json, risk_level, completion_criteria_json,
                        evidence_refs_json, blockers_json, source_json, created_at_ms,
                        created_at_iso, updated_at_ms, updated_at_iso
                     ) VALUES (?1, ?2, 'pending', ?3, ?4, ?5, ?6, ?7, '[]', '[]', ?8, ?9, ?10, ?9, ?10)",
                    params![
                        todo_item_id,
                        todo_list_id,
                        item.title.trim(),
                        json_string(&item.actions)?,
                        json_string(&item.expected_tools)?,
                        normalize_risk_level(&item.risk_level),
                        json_string(&item.completion_criteria)?,
                        item.source.to_string(),
                        now,
                        now_iso,
                    ],
                )?;
            }
            conn.execute(
                "INSERT INTO execution_run (
                    execution_run_id, session_id, runtime_turn_id, todo_list_id, status,
                    step_ids_json, created_at_ms, created_at_iso, updated_at_ms, updated_at_iso
                 ) VALUES (?1, ?2, ?3, ?4, 'running', '[]', ?5, ?6, ?5, ?6)",
                params![
                    execution_run_id,
                    session_id,
                    turn_id,
                    todo_list_id,
                    now,
                    now_iso,
                ],
            )?;
            Ok(())
        })?;
        Ok(CreatedTodoRefs {
            todo_list_id,
            execution_run_id,
        })
    }

    pub fn read_active_todo_list(
        &self,
        session_id: &str,
    ) -> Result<Option<AgentExecutionTodoList>> {
        self.with_session_conn(session_id, |conn| {
            let row = conn
                .query_row(
                    "SELECT todo_list_id, session_id, runtime_turn_id, kind, status,
                            title, source_json, created_at_ms, updated_at_ms
                     FROM execution_todo_list
                     WHERE session_id = ?1 AND status != 'superseded'
                     ORDER BY updated_at_ms DESC, created_at_ms DESC
                     LIMIT 1",
                    params![session_id],
                    read_todo_list_row,
                )
                .optional()?;
            let Some(mut todo) = row else {
                return Ok(None);
            };
            todo.items = read_todo_items_for_list(conn, &todo.todo_list_id)?;
            Ok(Some(todo))
        })
    }

    pub fn read_execution_summary(
        &self,
        session_id: &str,
    ) -> Result<Option<AgentExecutionSummary>> {
        self.with_session_conn(session_id, |conn| {
            let row = conn
                .query_row(
                    "SELECT execution_run_id, session_id, runtime_turn_id, todo_list_id,
                        status, updated_at_ms
                 FROM execution_run
                 WHERE session_id = ?1
                 ORDER BY updated_at_ms DESC, created_at_ms DESC
                 LIMIT 1",
                    params![session_id],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, Option<String>>(2)?,
                            row.get::<_, String>(3)?,
                            row.get::<_, String>(4)?,
                            row.get::<_, i64>(5)?,
                        ))
                    },
                )
                .optional()
                .context("failed to read execution summary")?;
            let Some((
                execution_run_id,
                session_id,
                runtime_turn_id,
                todo_list_id,
                status,
                updated_at,
            )) = row
            else {
                return Ok(None);
            };
            let counts = read_execution_step_counts(conn, &execution_run_id)?;
            Ok(Some(AgentExecutionSummary {
                execution_run_id,
                session_id,
                runtime_turn_id,
                todo_list_id,
                status,
                step_count: counts.0,
                completed_step_count: counts.1,
                failed_step_count: counts.2,
                blocked_step_count: counts.3,
                updated_at,
            }))
        })
    }

    pub fn record_tool_execution_step(
        &self,
        session_id: &str,
        turn_id: &str,
        tool_path: &str,
        op_id: &str,
        item_status: &str,
        step_status: &str,
        evidence_refs: Vec<String>,
        artifact_refs: Vec<String>,
        blocker: Value,
    ) -> Result<Option<TodoUpdateRecord>> {
        let updated_at = now_ms();
        let updated_iso = now_iso();
        self.with_session_conn(session_id, |conn| {
            let Some((execution_run_id, todo_list_id)) =
                find_execution_run_for_turn(conn, session_id, turn_id)?
            else {
                return Ok(None);
            };
            let Some(mut item) = find_todo_item_for_tool(conn, &todo_list_id, tool_path)? else {
                return Ok(None);
            };
            let merged_evidence_refs = merge_string_refs(&item.evidence_refs, &evidence_refs);
            let merged_blockers = merge_todo_blocker_json(&item.blockers, &blocker);
            conn.execute(
                "UPDATE todo_item
                 SET status = ?1, evidence_refs_json = ?2, blockers_json = ?3,
                     updated_at_ms = ?4, updated_at_iso = ?5
                 WHERE todo_item_id = ?6",
                params![
                    normalize_todo_status(item_status),
                    json_string(&merged_evidence_refs)?,
                    merged_blockers.to_string(),
                    updated_at,
                    updated_iso,
                    item.todo_item_id,
                ],
            )?;
            item.status = normalize_todo_status(item_status).to_string();
            item.evidence_refs = merged_evidence_refs;
            item.blockers = merged_blockers.clone();

            let existing_step =
                find_execution_step_for_item(conn, &execution_run_id, &item.todo_item_id)?;
            let execution_step_id = existing_step.unwrap_or_else(|| new_id("execution_step"));
            let mut tool_operation_ids = if step_exists(conn, &execution_step_id)? {
                read_step_string_refs(conn, &execution_step_id, "tool_operation_ids_json")?
            } else {
                Vec::new()
            };
            if tool_operation_ids.iter().any(|id| id == op_id) == false {
                tool_operation_ids.push(op_id.to_string());
            }
            let step_evidence_refs = merge_string_refs(
                &read_step_string_refs_or_empty(conn, &execution_step_id, "evidence_refs_json")?,
                &evidence_refs,
            );
            let step_artifact_refs = merge_string_refs(
                &read_step_string_refs_or_empty(conn, &execution_step_id, "artifact_refs_json")?,
                &artifact_refs,
            );
            if step_exists(conn, &execution_step_id)? {
                conn.execute(
                    "UPDATE execution_step
                     SET status = ?1, tool_operation_ids_json = ?2, evidence_refs_json = ?3,
                         artifact_refs_json = ?4, blocker_json = ?5,
                         updated_at_ms = ?6, updated_at_iso = ?7
                     WHERE execution_step_id = ?8",
                    params![
                        normalize_todo_status(step_status),
                        json_string(&tool_operation_ids)?,
                        json_string(&step_evidence_refs)?,
                        json_string(&step_artifact_refs)?,
                        if blocker.is_null() {
                            None::<String>
                        } else {
                            Some(blocker.to_string())
                        },
                        updated_at,
                        updated_iso,
                        execution_step_id,
                    ],
                )?;
            } else {
                conn.execute(
                    "INSERT INTO execution_step (
                        execution_step_id, execution_run_id, todo_item_id, kind, status,
                        tool_operation_ids_json, evidence_refs_json, artifact_refs_json,
                        skip_reason, blocker_json, created_at_ms, created_at_iso,
                        updated_at_ms, updated_at_iso
                     ) VALUES (?1, ?2, ?3, 'tool', ?4, ?5, ?6, ?7, NULL, ?8, ?9, ?10, ?9, ?10)",
                    params![
                        execution_step_id,
                        execution_run_id,
                        item.todo_item_id,
                        normalize_todo_status(step_status),
                        json_string(&tool_operation_ids)?,
                        json_string(&step_evidence_refs)?,
                        json_string(&step_artifact_refs)?,
                        if blocker.is_null() {
                            None::<String>
                        } else {
                            Some(blocker.to_string())
                        },
                        updated_at,
                        updated_iso,
                    ],
                )?;
                append_execution_run_step(conn, &execution_run_id, &execution_step_id)?;
            }

            let list_status = compute_todo_list_status(conn, &todo_list_id)?;
            let run_status = compute_execution_run_status(conn, &execution_run_id)?;
            conn.execute(
                "UPDATE execution_todo_list
                 SET status = ?1, updated_at_ms = ?2, updated_at_iso = ?3
                 WHERE todo_list_id = ?4",
                params![list_status, updated_at, updated_iso, todo_list_id],
            )?;
            conn.execute(
                "UPDATE execution_run
                 SET status = ?1, updated_at_ms = ?2, updated_at_iso = ?3
                 WHERE execution_run_id = ?4",
                params![run_status, updated_at, updated_iso, execution_run_id],
            )?;

            Ok(Some(TodoUpdateRecord {
                todo_list_id,
                todo_item_id: Some(item.todo_item_id),
                execution_run_id,
                execution_step_id,
                status: normalize_todo_status(item_status).to_string(),
                step_status: normalize_todo_status(step_status).to_string(),
                title: Some(item.title),
                evidence_refs: step_evidence_refs,
                artifact_refs: step_artifact_refs,
                blocker,
            }))
        })
    }

    pub fn create_verification_plan_for_changed_files(
        &self,
        session_id: &str,
        turn_id: &str,
        source_artifact_id: &str,
        changed_files: Value,
    ) -> Result<VerificationPlanRecord> {
        let verification_plan_id = new_id("verification_plan");
        let now = now_ms();
        let now_iso = now_iso();
        self.with_session_conn(session_id, |conn| {
            let execution_run_id = find_execution_run_for_turn(conn, session_id, turn_id)?
                .map(|(run_id, _)| run_id);
            let required = infer_verification_requirements(&changed_files);
            let not_run = if required.is_empty() {
                vec![json!({
                    "kind": "not_run_record",
                    "reason": "no_safe_verification_command",
                    "changedFiles": changed_files
                })]
            } else {
                Vec::new()
            };
            let status = if required.is_empty() {
                "not_run"
            } else {
                "pending"
            };
            conn.execute(
                "INSERT INTO verification_plan (
                    verification_plan_id, session_id, runtime_turn_id, execution_run_id,
                    status, title, required_json, optional_json, not_run_json, source_json,
                    created_at_ms, created_at_iso, updated_at_ms, updated_at_iso
                 ) VALUES (?1, ?2, ?3, ?4, ?5, 'Write-after verification', ?6, '[]', ?7, ?8, ?9, ?10, ?9, ?10)",
                params![
                    verification_plan_id,
                    session_id,
                    turn_id,
                    execution_run_id,
                    status,
                    json_string(&required)?,
                    json_string(&not_run)?,
                    json!({
                        "type": "apply_patch",
                        "sourceArtifactId": source_artifact_id,
                        "changedFiles": changed_files
                    })
                    .to_string(),
                    now,
                    now_iso,
                ],
            )?;
            if required.is_empty() {
                let verification_run_id = new_id("verification_run");
                conn.execute(
                    "INSERT INTO verification_run (
                        verification_run_id, verification_plan_id, session_id, runtime_turn_id,
                        execution_run_id, kind, status, command, cwd, tool_operation_id,
                        report_artifact_id, evidence_refs_json, exit_code, output_bytes,
                        failure_summary, skip_reason, residual_risk_json, created_at_ms,
                        created_at_iso, updated_at_ms, updated_at_iso
                     ) VALUES (?1, ?2, ?3, ?4, ?5, 'not_run_record', 'not_run', NULL, NULL, NULL,
                        NULL, '[]', NULL, NULL, NULL, 'No safe verification command could be inferred',
                        ?6, ?7, ?8, ?7, ?8)",
                    params![
                        verification_run_id,
                        verification_plan_id,
                        session_id,
                        turn_id,
                        execution_run_id,
                        json!({
                            "reason": "no_safe_verification_command",
                            "changedFiles": changed_files
                        })
                        .to_string(),
                        now,
                        now_iso,
                    ],
                )?;
            }
            upsert_completion_audit_and_delivery_proof(
                conn,
                session_id,
                Some(turn_id),
                execution_run_id.as_deref(),
            )?;
            Ok(VerificationPlanRecord {
                verification_plan_id,
                session_id: session_id.to_string(),
                runtime_turn_id: Some(turn_id.to_string()),
                execution_run_id,
                status: status.to_string(),
                required,
                not_run,
                updated_at: now,
            })
        })
    }

    pub fn append_command_log_artifact_and_evidence(
        &self,
        session_id: &str,
        turn_id: &str,
        op_id: &str,
        result_ref: &str,
        status: &str,
        command: &str,
        cwd: &str,
        exit_code: Option<i64>,
        output_bytes: i64,
        metadata: Value,
    ) -> Result<CommandArtifactRefs> {
        let artifact_id = new_id("artifact");
        let artifact_version_id = new_id("artifact_version");
        let evidence_id = new_id("evidence");
        let verification_run_id = new_id("verification_run");
        let now = now_ms();
        let now_iso = now_iso();
        self.with_session_conn(session_id, |conn| {
            let execution_run_id = find_execution_run_for_turn(conn, session_id, turn_id)?
                .map(|(run_id, _)| run_id);
            let verification_plan_id = ensure_verification_plan_for_command(
                conn,
                session_id,
                Some(turn_id),
                execution_run_id.as_deref(),
                command,
                cwd,
            )?;
            conn.execute(
                "INSERT INTO artifact_record (
                    artifact_id, artifact_version_id, session_id, runtime_turn_id, kind, status,
                    title, content_ref, projection_ref, metadata_json, source_json, created_at_ms,
                    created_at_iso, updated_at_ms, updated_at_iso
                 ) VALUES (?1, ?2, ?3, ?4, 'command_log', ?5, ?6, ?7, NULL, ?8, ?9, ?10, ?11, ?10, ?11)",
                params![
                    artifact_id,
                    artifact_version_id,
                    session_id,
                    turn_id,
                    status,
                    format!("Command log: {command}"),
                    result_ref,
                    metadata.to_string(),
                    json!({
                        "sourceType": "tool_operation",
                        "toolOperationId": op_id
                    })
                    .to_string(),
                    now,
                    now_iso,
                ],
            )?;
            conn.execute(
                "INSERT INTO evidence_record (
                    evidence_id, session_id, runtime_turn_id, kind, status, claim_json,
                    artifact_ids_json, tool_operation_ids_json, confidence, created_at_ms,
                    created_at_iso, stale_reason
                 ) VALUES (?1, ?2, ?3, 'verification_run', 'active', ?4, ?5, ?6, 'high', ?7, ?8, NULL)",
                params![
                    evidence_id,
                    session_id,
                    turn_id,
                    json!({
                        "targetKind": "verification",
                        "claim": "A workspace command was executed and recorded.",
                        "command": command,
                        "cwd": cwd,
                        "status": status,
                        "exitCode": exit_code
                    })
                    .to_string(),
                    json!([artifact_id]).to_string(),
                    json!([op_id]).to_string(),
                    now,
                    now_iso,
                ],
            )?;
            conn.execute(
                "INSERT INTO verification_run (
                    verification_run_id, verification_plan_id, session_id, runtime_turn_id,
                    execution_run_id, kind, status, command, cwd, tool_operation_id,
                    report_artifact_id, evidence_refs_json, exit_code, output_bytes,
                    failure_summary, skip_reason, residual_risk_json, created_at_ms,
                    created_at_iso, updated_at_ms, updated_at_iso
                 ) VALUES (?1, ?2, ?3, ?4, ?5, 'command', ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13,
                    ?14, NULL, ?15, ?16, ?17, ?16, ?17)",
                params![
                    verification_run_id,
                    verification_plan_id,
                    session_id,
                    turn_id,
                    execution_run_id,
                    normalize_verification_run_status(status),
                    command,
                    cwd,
                    op_id,
                    artifact_id,
                    json!([evidence_id]).to_string(),
                    exit_code,
                    output_bytes,
                    if status == "failed" {
                        Some("Command exited unsuccessfully")
                    } else {
                        None
                    },
                    if status == "failed" {
                        json!({ "level": "medium", "reason": "command_failed" })
                    } else {
                        json!({})
                    }
                    .to_string(),
                    now,
                    now_iso,
                ],
            )?;
            let plan_status = compute_verification_plan_status(conn, &verification_plan_id)?;
            conn.execute(
                "UPDATE verification_plan
                 SET status = ?1, updated_at_ms = ?2, updated_at_iso = ?3
                 WHERE verification_plan_id = ?4",
                params![plan_status, now, now_iso, verification_plan_id],
            )?;
            upsert_completion_audit_and_delivery_proof(
                conn,
                session_id,
                Some(turn_id),
                execution_run_id.as_deref(),
            )?;
            Ok(CommandArtifactRefs {
                artifact_id,
                evidence_id,
                verification_plan_id,
                verification_run_id,
            })
        })
    }

    pub fn read_verification_summary(
        &self,
        session_id: &str,
    ) -> Result<Option<AgentVerificationSummary>> {
        self.with_session_conn(session_id, |conn| {
            let row = conn
                .query_row(
                    "SELECT verification_plan_id, session_id, runtime_turn_id, execution_run_id,
                            status, required_json, updated_at_ms
                     FROM verification_plan
                     WHERE session_id = ?1
                     ORDER BY updated_at_ms DESC, created_at_ms DESC
                     LIMIT 1",
                    params![session_id],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, Option<String>>(2)?,
                            row.get::<_, Option<String>>(3)?,
                            row.get::<_, String>(4)?,
                            row.get::<_, String>(5)?,
                            row.get::<_, i64>(6)?,
                        ))
                    },
                )
                .optional()
                .context("failed to read verification summary")?;
            let Some((
                verification_plan_id,
                session_id,
                runtime_turn_id,
                execution_run_id,
                status,
                required_json,
                updated_at,
            )) = row
            else {
                return Ok(None);
            };
            let required = parse_json_vec_value(&required_json);
            let runs = read_verification_runs_for_plan(conn, &verification_plan_id)?;
            let passed = runs.iter().filter(|run| run.status == "passed").count() as i64;
            let failed = runs.iter().filter(|run| run.status == "failed").count() as i64;
            let blocked = runs.iter().filter(|run| run.status == "blocked").count() as i64;
            let not_run = runs.iter().filter(|run| run.status == "not_run").count() as i64;
            Ok(Some(AgentVerificationSummary {
                verification_plan_id,
                session_id,
                runtime_turn_id,
                execution_run_id,
                status,
                required_run_count: required.len() as i64,
                passed_run_count: passed,
                failed_run_count: failed,
                blocked_run_count: blocked,
                not_run_count: not_run,
                runs,
                updated_at,
            }))
        })
    }

    pub fn read_delivery_proof_summary(
        &self,
        session_id: &str,
    ) -> Result<Option<AgentDeliveryProofSummary>> {
        self.with_session_conn(session_id, |conn| {
            conn.query_row(
                "SELECT delivery_proof_id, session_id, runtime_turn_id, execution_run_id,
                        status, artifact_refs_json, evidence_refs_json,
                        verification_run_ids_json, completion_audit_id,
                        unresolved_risks_json, user_visible_summary_ref, updated_at_ms
                 FROM delivery_proof
                 WHERE session_id = ?1
                 ORDER BY updated_at_ms DESC, created_at_ms DESC
                 LIMIT 1",
                params![session_id],
                |row| {
                    let artifact_refs_json: String = row.get(5)?;
                    let evidence_refs_json: String = row.get(6)?;
                    let verification_run_ids_json: String = row.get(7)?;
                    let unresolved_risks_json: String = row.get(9)?;
                    Ok(AgentDeliveryProofSummary {
                        delivery_proof_id: row.get(0)?,
                        session_id: row.get(1)?,
                        runtime_turn_id: row.get(2)?,
                        execution_run_id: row.get(3)?,
                        status: row.get(4)?,
                        artifact_refs: parse_json_vec_string(&artifact_refs_json),
                        evidence_refs: parse_json_vec_string(&evidence_refs_json),
                        verification_run_ids: parse_json_vec_string(&verification_run_ids_json),
                        completion_audit_id: row.get(8)?,
                        unresolved_risks: serde_json::from_str(&unresolved_risks_json)
                            .unwrap_or_else(|_| json!([])),
                        summary: row.get::<_, Option<String>>(10)?.unwrap_or_else(|| {
                            "Delivery proof is pending verification.".to_string()
                        }),
                        updated_at: row.get(11)?,
                    })
                },
            )
            .optional()
            .context("failed to read delivery proof summary")
        })
    }

    pub fn read_completion_audit_summary(
        &self,
        session_id: &str,
    ) -> Result<Option<AgentCompletionAuditSummary>> {
        self.with_session_conn(session_id, |conn| {
            conn.query_row(
                "SELECT completion_audit_id, session_id, runtime_turn_id, execution_run_id,
                        status, summary_json, updated_at_ms
                 FROM completion_audit
                 WHERE session_id = ?1
                 ORDER BY updated_at_ms DESC, created_at_ms DESC
                 LIMIT 1",
                params![session_id],
                |row| {
                    let summary_json: String = row.get(5)?;
                    let summary_value: Value =
                        serde_json::from_str(&summary_json).unwrap_or_else(|_| json!({}));
                    Ok(AgentCompletionAuditSummary {
                        completion_audit_id: row.get(0)?,
                        session_id: row.get(1)?,
                        runtime_turn_id: row.get(2)?,
                        execution_run_id: row.get(3)?,
                        status: row.get(4)?,
                        missing_todo_item_ids: value_string_array(
                            &summary_value,
                            "missingTodoItemIds",
                        ),
                        missing_evidence_refs: value_string_array(
                            &summary_value,
                            "missingEvidenceRefs",
                        ),
                        failed_verification_run_ids: value_string_array(
                            &summary_value,
                            "failedVerificationRunIds",
                        ),
                        blocked_verification_run_ids: value_string_array(
                            &summary_value,
                            "blockedVerificationRunIds",
                        ),
                        not_run_verification_run_ids: value_string_array(
                            &summary_value,
                            "notRunVerificationRunIds",
                        ),
                        pending_approval_ticket_ids: value_string_array(
                            &summary_value,
                            "pendingApprovalTicketIds",
                        ),
                        residual_risks: summary_value
                            .get("residualRisks")
                            .cloned()
                            .unwrap_or_else(|| json!([])),
                        summary: summary_value
                            .get("summary")
                            .and_then(Value::as_str)
                            .unwrap_or("Completion audit is pending.")
                            .to_string(),
                        updated_at: row.get(6)?,
                    })
                },
            )
            .optional()
            .context("failed to read completion audit summary")
        })
    }

    pub fn evaluate_completion_audit_and_delivery_proof(
        &self,
        session_id: &str,
        turn_id: Option<&str>,
    ) -> Result<Option<AgentCompletionAuditSummary>> {
        self.with_session_conn(session_id, |conn| {
            let execution_run_id = match turn_id {
                Some(turn_id) => find_execution_run_for_turn(conn, session_id, turn_id)?
                    .map(|(run_id, _)| run_id),
                None => read_latest_execution_run_id(conn, session_id)?,
            };
            let updated = upsert_completion_audit_and_delivery_proof(
                conn,
                session_id,
                turn_id,
                execution_run_id.as_deref(),
            )?;
            if updated {
                read_completion_audit_summary_from_conn(conn, session_id)
            } else {
                Ok(None)
            }
        })
    }

    pub fn read_session_detail(&self, session_id: &str) -> Result<Option<AgentSessionDetail>> {
        let Some(session) = self.read_session_index(session_id)? else {
            return Ok(None);
        };
        let turns = self.read_turns(session_id)?;
        let messages = self.read_messages(session_id)?;
        let runtime_events = self.read_runtime_events(session_id)?;
        let pending_interactions = self.read_pending_approval_interactions(session_id)?;
        let active_todo = self.read_active_todo_list(session_id)?;
        let execution_summary = self.read_execution_summary(session_id)?;
        let verification_summary = self.read_verification_summary(session_id)?;
        let completion_audit = self.read_completion_audit_summary(session_id)?;
        let delivery_proof = self.read_delivery_proof_summary(session_id)?;
        Ok(Some(AgentSessionDetail {
            session,
            pending_interactions,
            turns,
            messages,
            runtime_events,
            active_todo,
            execution_summary,
            verification_summary,
            completion_audit,
            delivery_proof,
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
        CREATE TABLE IF NOT EXISTS execution_todo_list (
            todo_list_id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            runtime_turn_id TEXT,
            kind TEXT NOT NULL,
            status TEXT NOT NULL,
            source_json TEXT NOT NULL,
            title TEXT NOT NULL,
            created_at_ms INTEGER NOT NULL,
            created_at_iso TEXT NOT NULL,
            updated_at_ms INTEGER NOT NULL,
            updated_at_iso TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS todo_item (
            todo_item_id TEXT PRIMARY KEY,
            todo_list_id TEXT NOT NULL,
            status TEXT NOT NULL,
            title TEXT NOT NULL,
            actions_json TEXT NOT NULL,
            expected_tools_json TEXT NOT NULL,
            risk_level TEXT NOT NULL,
            completion_criteria_json TEXT NOT NULL,
            evidence_refs_json TEXT NOT NULL,
            blockers_json TEXT NOT NULL,
            source_json TEXT NOT NULL,
            created_at_ms INTEGER NOT NULL,
            created_at_iso TEXT NOT NULL,
            updated_at_ms INTEGER NOT NULL,
            updated_at_iso TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS execution_run (
            execution_run_id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            runtime_turn_id TEXT,
            todo_list_id TEXT NOT NULL,
            status TEXT NOT NULL,
            step_ids_json TEXT NOT NULL,
            created_at_ms INTEGER NOT NULL,
            created_at_iso TEXT NOT NULL,
            updated_at_ms INTEGER NOT NULL,
            updated_at_iso TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS execution_step (
            execution_step_id TEXT PRIMARY KEY,
            execution_run_id TEXT NOT NULL,
            todo_item_id TEXT,
            kind TEXT NOT NULL,
            status TEXT NOT NULL,
            tool_operation_ids_json TEXT NOT NULL,
            evidence_refs_json TEXT NOT NULL,
            artifact_refs_json TEXT NOT NULL,
            skip_reason TEXT,
            blocker_json TEXT,
            created_at_ms INTEGER NOT NULL,
            created_at_iso TEXT NOT NULL,
            updated_at_ms INTEGER NOT NULL,
            updated_at_iso TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS verification_plan (
            verification_plan_id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            runtime_turn_id TEXT,
            execution_run_id TEXT,
            status TEXT NOT NULL,
            title TEXT NOT NULL,
            required_json TEXT NOT NULL,
            optional_json TEXT NOT NULL,
            not_run_json TEXT NOT NULL,
            source_json TEXT NOT NULL,
            created_at_ms INTEGER NOT NULL,
            created_at_iso TEXT NOT NULL,
            updated_at_ms INTEGER NOT NULL,
            updated_at_iso TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS verification_run (
            verification_run_id TEXT PRIMARY KEY,
            verification_plan_id TEXT,
            session_id TEXT NOT NULL,
            runtime_turn_id TEXT,
            execution_run_id TEXT,
            kind TEXT NOT NULL,
            status TEXT NOT NULL,
            command TEXT,
            cwd TEXT,
            tool_operation_id TEXT,
            report_artifact_id TEXT,
            evidence_refs_json TEXT NOT NULL,
            exit_code INTEGER,
            output_bytes INTEGER,
            failure_summary TEXT,
            skip_reason TEXT,
            residual_risk_json TEXT NOT NULL,
            created_at_ms INTEGER NOT NULL,
            created_at_iso TEXT NOT NULL,
            updated_at_ms INTEGER NOT NULL,
            updated_at_iso TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS completion_audit (
            completion_audit_id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            runtime_turn_id TEXT,
            execution_run_id TEXT,
            status TEXT NOT NULL,
            summary_json TEXT NOT NULL,
            created_at_ms INTEGER NOT NULL,
            created_at_iso TEXT NOT NULL,
            updated_at_ms INTEGER NOT NULL,
            updated_at_iso TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS delivery_proof (
            delivery_proof_id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            runtime_turn_id TEXT,
            execution_run_id TEXT,
            status TEXT NOT NULL,
            objective_ref TEXT,
            changed_files_refs_json TEXT NOT NULL,
            artifact_refs_json TEXT NOT NULL,
            evidence_refs_json TEXT NOT NULL,
            verification_run_ids_json TEXT NOT NULL,
            completion_audit_id TEXT,
            side_effect_refs_json TEXT NOT NULL,
            unresolved_risks_json TEXT NOT NULL,
            user_visible_summary_ref TEXT,
            created_at_ms INTEGER NOT NULL,
            created_at_iso TEXT NOT NULL,
            updated_at_ms INTEGER NOT NULL,
            updated_at_iso TEXT NOT NULL
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

fn read_todo_list_row(row: &Row<'_>) -> rusqlite::Result<AgentExecutionTodoList> {
    let source_json: String = row.get(6)?;
    Ok(AgentExecutionTodoList {
        todo_list_id: row.get(0)?,
        session_id: row.get(1)?,
        runtime_turn_id: row.get(2)?,
        kind: row.get(3)?,
        status: row.get(4)?,
        title: row.get(5)?,
        source: serde_json::from_str(&source_json).unwrap_or_else(|_| json!({})),
        items: Vec::new(),
        created_at: row.get(7)?,
        updated_at: row.get(8)?,
    })
}

fn read_todo_item_row(row: &Row<'_>) -> rusqlite::Result<AgentTodoItem> {
    let actions_json: String = row.get(4)?;
    let expected_tools_json: String = row.get(5)?;
    let completion_criteria_json: String = row.get(7)?;
    let evidence_refs_json: String = row.get(8)?;
    let blockers_json: String = row.get(9)?;
    let source_json: String = row.get(10)?;
    Ok(AgentTodoItem {
        todo_item_id: row.get(0)?,
        todo_list_id: row.get(1)?,
        status: row.get(2)?,
        title: row.get(3)?,
        actions: parse_json_vec_string(&actions_json),
        expected_tools: parse_json_vec_string(&expected_tools_json),
        risk_level: row.get(6)?,
        completion_criteria: parse_json_vec_string(&completion_criteria_json),
        evidence_refs: parse_json_vec_string(&evidence_refs_json),
        blockers: serde_json::from_str(&blockers_json).unwrap_or_else(|_| json!([])),
        source: serde_json::from_str(&source_json).unwrap_or_else(|_| json!({})),
        created_at: row.get(11)?,
        updated_at: row.get(12)?,
    })
}

fn read_todo_items_for_list(conn: &Connection, todo_list_id: &str) -> Result<Vec<AgentTodoItem>> {
    let mut stmt = conn.prepare(
        "SELECT todo_item_id, todo_list_id, status, title, actions_json,
                expected_tools_json, risk_level, completion_criteria_json,
                evidence_refs_json, blockers_json, source_json, created_at_ms, updated_at_ms
         FROM todo_item
         WHERE todo_list_id = ?1
         ORDER BY created_at_ms ASC",
    )?;
    let rows = stmt.query_map(params![todo_list_id], read_todo_item_row)?;
    let mut result = Vec::new();
    for row in rows {
        result.push(row?);
    }
    Ok(result)
}

fn find_execution_run_for_turn(
    conn: &Connection,
    session_id: &str,
    turn_id: &str,
) -> Result<Option<(String, String)>> {
    let exact = conn
        .query_row(
            "SELECT r.execution_run_id, r.todo_list_id
         FROM execution_run r
         JOIN execution_todo_list t ON t.todo_list_id = r.todo_list_id
         WHERE r.session_id = ?1
           AND t.status != 'superseded'
           AND (r.runtime_turn_id = ?2 OR ?2 = '')
         ORDER BY r.updated_at_ms DESC, r.created_at_ms DESC
         LIMIT 1",
            params![session_id, turn_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .context("failed to find execution run for turn")?;
    if exact.is_some() {
        return Ok(exact);
    }
    conn.query_row(
        "SELECT r.execution_run_id, r.todo_list_id
         FROM execution_run r
         JOIN execution_todo_list t ON t.todo_list_id = r.todo_list_id
         WHERE r.session_id = ?1 AND t.status != 'superseded'
         ORDER BY r.updated_at_ms DESC, r.created_at_ms DESC
         LIMIT 1",
        params![session_id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )
    .optional()
    .context("failed to find latest execution run")
}

fn find_todo_item_for_tool(
    conn: &Connection,
    todo_list_id: &str,
    tool_path: &str,
) -> Result<Option<AgentTodoItem>> {
    let items = read_todo_items_for_list(conn, todo_list_id)?;
    let normalized_tool = tool_path.trim();
    Ok(items
        .into_iter()
        .filter(|item| {
            item.expected_tools
                .iter()
                .any(|tool| tool.trim() == normalized_tool)
        })
        .min_by_key(|item| todo_status_priority(&item.status)))
}

fn find_execution_step_for_item(
    conn: &Connection,
    execution_run_id: &str,
    todo_item_id: &str,
) -> Result<Option<String>> {
    conn.query_row(
        "SELECT execution_step_id
         FROM execution_step
         WHERE execution_run_id = ?1 AND todo_item_id = ?2
         ORDER BY updated_at_ms DESC, created_at_ms DESC
         LIMIT 1",
        params![execution_run_id, todo_item_id],
        |row| row.get(0),
    )
    .optional()
    .context("failed to find execution step")
}

fn step_exists(conn: &Connection, execution_step_id: &str) -> Result<bool> {
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM execution_step WHERE execution_step_id = ?1",
        params![execution_step_id],
        |row| row.get(0),
    )?;
    Ok(count > 0)
}

fn read_step_string_refs(
    conn: &Connection,
    execution_step_id: &str,
    column: &str,
) -> Result<Vec<String>> {
    let json_value: String = conn.query_row(
        &format!("SELECT {column} FROM execution_step WHERE execution_step_id = ?1"),
        params![execution_step_id],
        |row| row.get(0),
    )?;
    Ok(parse_json_vec_string(&json_value))
}

fn read_step_string_refs_or_empty(
    conn: &Connection,
    execution_step_id: &str,
    column: &str,
) -> Result<Vec<String>> {
    if step_exists(conn, execution_step_id)? {
        read_step_string_refs(conn, execution_step_id, column)
    } else {
        Ok(Vec::new())
    }
}

fn append_execution_run_step(
    conn: &Connection,
    execution_run_id: &str,
    execution_step_id: &str,
) -> Result<()> {
    let step_ids_json: String = conn.query_row(
        "SELECT step_ids_json FROM execution_run WHERE execution_run_id = ?1",
        params![execution_run_id],
        |row| row.get(0),
    )?;
    let mut step_ids = parse_json_vec_string(&step_ids_json);
    if step_ids.iter().any(|id| id == execution_step_id) == false {
        step_ids.push(execution_step_id.to_string());
    }
    conn.execute(
        "UPDATE execution_run SET step_ids_json = ?1 WHERE execution_run_id = ?2",
        params![json_string(&step_ids)?, execution_run_id],
    )?;
    Ok(())
}

fn compute_todo_list_status(conn: &Connection, todo_list_id: &str) -> Result<String> {
    let mut stmt = conn.prepare("SELECT status FROM todo_item WHERE todo_list_id = ?1")?;
    let rows = stmt.query_map(params![todo_list_id], |row| row.get::<_, String>(0))?;
    let mut statuses = Vec::new();
    for row in rows {
        statuses.push(row?);
    }
    if statuses.iter().any(|status| status == "failed") {
        return Ok("failed".to_string());
    }
    if statuses.iter().any(|status| status == "blocked") {
        return Ok("blocked".to_string());
    }
    if statuses.is_empty() == false
        && statuses
            .iter()
            .all(|status| matches!(status.as_str(), "completed" | "skipped"))
    {
        return Ok("completed".to_string());
    }
    Ok("active".to_string())
}

fn compute_execution_run_status(conn: &Connection, execution_run_id: &str) -> Result<String> {
    let mut stmt = conn.prepare("SELECT status FROM execution_step WHERE execution_run_id = ?1")?;
    let rows = stmt.query_map(params![execution_run_id], |row| row.get::<_, String>(0))?;
    let mut statuses = Vec::new();
    for row in rows {
        statuses.push(row?);
    }
    if statuses.iter().any(|status| status == "failed") {
        return Ok("failed".to_string());
    }
    if statuses.iter().any(|status| status == "blocked") {
        return Ok("blocked".to_string());
    }
    if statuses.is_empty() == false
        && statuses
            .iter()
            .all(|status| matches!(status.as_str(), "completed" | "skipped"))
    {
        return Ok("completed".to_string());
    }
    Ok("running".to_string())
}

fn read_execution_step_counts(
    conn: &Connection,
    execution_run_id: &str,
) -> Result<(i64, i64, i64, i64)> {
    let mut stmt = conn.prepare(
        "SELECT status, COUNT(*)
         FROM execution_step
         WHERE execution_run_id = ?1
         GROUP BY status",
    )?;
    let rows = stmt.query_map(params![execution_run_id], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
    })?;
    let mut total = 0_i64;
    let mut completed = 0_i64;
    let mut failed = 0_i64;
    let mut blocked = 0_i64;
    for row in rows {
        let (status, count) = row?;
        total += count;
        match status.as_str() {
            "completed" => completed += count,
            "failed" => failed += count,
            "blocked" => blocked += count,
            _ => {}
        }
    }
    Ok((total, completed, failed, blocked))
}

fn infer_verification_requirements(changed_files: &Value) -> Vec<Value> {
    let mut commands = Vec::<Value>::new();
    let mut seen = Vec::<String>::new();
    let paths = changed_files
        .as_array()
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.get("path").and_then(Value::as_str))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    for path in paths {
        let command = if path.ends_with(".rs") {
            let crate_name = path
                .strip_prefix("crates/")
                .and_then(|rest| rest.split('/').next())
                .filter(|value| value.is_empty() == false)
                .unwrap_or("");
            if crate_name.is_empty() {
                "cargo test".to_string()
            } else {
                format!("cargo test -p {crate_name}")
            }
        } else if path.starts_with("apps/desktop/")
            && (path.ends_with(".ts")
                || path.ends_with(".tsx")
                || path.ends_with(".css")
                || path.ends_with(".scss"))
        {
            "npm --prefix apps/desktop run test -- ai-panel".to_string()
        } else {
            continue;
        };
        if seen.iter().any(|value| value == &command) {
            continue;
        }
        seen.push(command.clone());
        commands.push(json!({
            "kind": "command",
            "toolPath": "/tools/shell/run_command",
            "command": command,
            "cwd": ".",
            "required": true,
            "reason": "write_after_patch"
        }));
    }
    commands
}

fn ensure_verification_plan_for_command(
    conn: &Connection,
    session_id: &str,
    turn_id: Option<&str>,
    execution_run_id: Option<&str>,
    command: &str,
    cwd: &str,
) -> Result<String> {
    let existing = conn
        .query_row(
            "SELECT verification_plan_id
             FROM verification_plan
             WHERE session_id = ?1
             ORDER BY updated_at_ms DESC, created_at_ms DESC
             LIMIT 1",
            params![session_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    if let Some(verification_plan_id) = existing {
        return Ok(verification_plan_id);
    }
    let verification_plan_id = new_id("verification_plan");
    let now = now_ms();
    let now_iso = now_iso();
    conn.execute(
        "INSERT INTO verification_plan (
            verification_plan_id, session_id, runtime_turn_id, execution_run_id,
            status, title, required_json, optional_json, not_run_json, source_json,
            created_at_ms, created_at_iso, updated_at_ms, updated_at_iso
         ) VALUES (?1, ?2, ?3, ?4, 'pending', 'Ad-hoc command verification', ?5, '[]', '[]', ?6, ?7, ?8, ?7, ?8)",
        params![
            verification_plan_id,
            session_id,
            turn_id,
            execution_run_id,
            json!([{
                "kind": "command",
                "toolPath": "/tools/shell/run_command",
                "command": command,
                "cwd": cwd,
                "required": true,
                "reason": "ad_hoc_command"
            }])
            .to_string(),
            json!({ "type": "run_command", "command": command, "cwd": cwd }).to_string(),
            now,
            now_iso,
        ],
    )?;
    Ok(verification_plan_id)
}

fn read_verification_runs_for_plan(
    conn: &Connection,
    verification_plan_id: &str,
) -> Result<Vec<AgentVerificationRunSummary>> {
    let mut stmt = conn.prepare(
        "SELECT verification_run_id, verification_plan_id, execution_run_id, runtime_turn_id,
                kind, status, command, cwd, exit_code, report_artifact_id,
                evidence_refs_json, skip_reason, residual_risk_json, updated_at_ms
         FROM verification_run
         WHERE verification_plan_id = ?1
         ORDER BY created_at_ms ASC",
    )?;
    let rows = stmt.query_map(params![verification_plan_id], |row| {
        let evidence_refs_json: String = row.get(10)?;
        let residual_risk_json: String = row.get(12)?;
        Ok(AgentVerificationRunSummary {
            verification_run_id: row.get(0)?,
            verification_plan_id: row.get(1)?,
            execution_run_id: row.get(2)?,
            runtime_turn_id: row.get(3)?,
            kind: row.get(4)?,
            status: row.get(5)?,
            command: row.get(6)?,
            cwd: row.get(7)?,
            exit_code: row.get(8)?,
            artifact_id: row.get(9)?,
            evidence_refs: parse_json_vec_string(&evidence_refs_json),
            skip_reason: row.get(11)?,
            residual_risk: serde_json::from_str(&residual_risk_json).unwrap_or_else(|_| json!({})),
            updated_at: row.get(13)?,
        })
    })?;
    let mut result = Vec::new();
    for row in rows {
        result.push(row?);
    }
    Ok(result)
}

fn compute_verification_plan_status(
    conn: &Connection,
    verification_plan_id: &str,
) -> Result<String> {
    let mut stmt =
        conn.prepare("SELECT status FROM verification_run WHERE verification_plan_id = ?1")?;
    let rows = stmt.query_map(params![verification_plan_id], |row| row.get::<_, String>(0))?;
    let mut statuses = Vec::new();
    for row in rows {
        statuses.push(row?);
    }
    if statuses.iter().any(|status| status == "failed") {
        return Ok("failed".to_string());
    }
    if statuses.iter().any(|status| status == "blocked") {
        return Ok("blocked".to_string());
    }
    if statuses.is_empty() {
        return Ok("pending".to_string());
    }
    if statuses.iter().all(|status| status == "not_run") {
        return Ok("not_run".to_string());
    }
    if statuses
        .iter()
        .all(|status| matches!(status.as_str(), "passed" | "not_run"))
    {
        return Ok("passed".to_string());
    }
    Ok("pending".to_string())
}

fn normalize_verification_run_status(status: &str) -> &'static str {
    match status {
        "passed" | "completed" => "passed",
        "failed" => "failed",
        "blocked" => "blocked",
        "not_run" => "not_run",
        "running" => "running",
        _ => "pending",
    }
}

struct TodoAuditSnapshot {
    missing_todo_item_ids: Vec<String>,
    failed_todo_item_ids: Vec<String>,
    blocked_todo_item_ids: Vec<String>,
    missing_evidence_refs: Vec<String>,
    evidence_refs: Vec<String>,
}

struct ExecutionAuditSnapshot {
    execution_run_id: String,
    status: String,
    step_count: i64,
    failed_step_count: i64,
    blocked_step_count: i64,
    artifact_refs: Vec<String>,
    evidence_refs: Vec<String>,
}

struct VerificationPlanAuditSnapshot {
    required: Vec<Value>,
    not_run: Vec<Value>,
    runs: Vec<AgentVerificationRunSummary>,
}

fn upsert_completion_audit_and_delivery_proof(
    conn: &Connection,
    session_id: &str,
    turn_id: Option<&str>,
    execution_run_id: Option<&str>,
) -> Result<bool> {
    let todo = read_latest_todo_audit(conn, session_id)?;
    let execution = read_execution_audit(conn, session_id, execution_run_id)?;
    let verification_plan = read_latest_verification_plan_audit(conn, session_id)?;
    let pending_approval_ticket_ids = read_pending_approval_ticket_ids(conn, session_id)?;
    if todo.is_none()
        && execution.is_none()
        && verification_plan.is_none()
        && pending_approval_ticket_ids.is_empty()
    {
        return Ok(false);
    }
    let now = now_ms();
    let now_iso = now_iso();
    let verification_runs = verification_plan
        .as_ref()
        .map(|plan| plan.runs.clone())
        .unwrap_or_default();
    let failed_runs = verification_runs
        .iter()
        .filter(|run| run.status == "failed")
        .map(|run| run.verification_run_id.clone())
        .collect::<Vec<_>>();
    let blocked_runs = verification_runs
        .iter()
        .filter(|run| run.status == "blocked")
        .map(|run| run.verification_run_id.clone())
        .collect::<Vec<_>>();
    let not_run = verification_runs
        .iter()
        .filter(|run| run.status == "not_run")
        .map(|run| run.verification_run_id.clone())
        .collect::<Vec<_>>();
    let pending_runs = verification_runs
        .iter()
        .filter(|run| matches!(run.status.as_str(), "pending" | "running"))
        .map(|run| run.verification_run_id.clone())
        .collect::<Vec<_>>();
    let verification_missing_evidence = verification_runs
        .iter()
        .filter(|run| run.status == "passed" && run.evidence_refs.is_empty())
        .map(|run| format!("verification_run:{}", run.verification_run_id))
        .collect::<Vec<_>>();
    let required_count = verification_plan
        .as_ref()
        .map(|plan| plan.required.len())
        .unwrap_or_default();
    let missing_required_verification_count =
        required_count.saturating_sub(verification_runs.len());
    let not_run_plan_records = verification_plan
        .as_ref()
        .map(|plan| plan.not_run.clone())
        .unwrap_or_default();
    let failed_todo_item_ids = todo
        .as_ref()
        .map(|todo| todo.failed_todo_item_ids.clone())
        .unwrap_or_default();
    let blocked_todo_item_ids = todo
        .as_ref()
        .map(|todo| todo.blocked_todo_item_ids.clone())
        .unwrap_or_default();
    let missing_todo_item_ids = todo
        .as_ref()
        .map(|todo| todo.missing_todo_item_ids.clone())
        .unwrap_or_default();
    let mut missing_evidence_refs = todo
        .as_ref()
        .map(|todo| todo.missing_evidence_refs.clone())
        .unwrap_or_default();
    missing_evidence_refs =
        merge_string_refs(&missing_evidence_refs, &verification_missing_evidence);
    let execution_failed = execution
        .as_ref()
        .map(|execution| execution.failed_step_count > 0 || execution.status == "failed")
        .unwrap_or(false);
    let execution_blocked = execution
        .as_ref()
        .map(|execution| execution.blocked_step_count > 0 || execution.status == "blocked")
        .unwrap_or(false);
    let has_not_run = not_run.is_empty() == false || not_run_plan_records.is_empty() == false;
    let has_failure = failed_runs.is_empty() == false
        || failed_todo_item_ids.is_empty() == false
        || execution_failed;
    let has_blocker = blocked_runs.is_empty() == false
        || pending_runs.is_empty() == false
        || blocked_todo_item_ids.is_empty() == false
        || pending_approval_ticket_ids.is_empty() == false
        || missing_todo_item_ids.is_empty() == false
        || missing_evidence_refs.is_empty() == false
        || missing_required_verification_count > 0
        || execution_blocked;
    let audit_status = if has_failure {
        "failed"
    } else if has_blocker {
        "blocked"
    } else if has_not_run {
        "partial_allowed"
    } else {
        "passed"
    };
    let residual_risks = verification_runs
        .iter()
        .filter(|run| {
            run.status == "not_run"
                || (run.residual_risk.is_null() == false && run.residual_risk != json!({}))
        })
        .map(|run| {
            json!({
                "verificationRunId": run.verification_run_id,
                "status": run.status,
                "skipReason": run.skip_reason,
                "residualRisk": run.residual_risk,
            })
        })
        .chain(not_run_plan_records.iter().map(|record| {
            json!({
                "source": "verification_plan",
                "record": record,
            })
        }))
        .collect::<Vec<_>>();
    let execution_run_id = execution
        .as_ref()
        .map(|execution| execution.execution_run_id.as_str())
        .or(execution_run_id);
    let audit_summary = delivery_audit_summary_text(
        audit_status,
        failed_runs.len(),
        blocked_runs.len() + pending_runs.len(),
        not_run.len() + not_run_plan_records.len(),
        missing_todo_item_ids.len(),
        pending_approval_ticket_ids.len(),
    );
    let completion_audit_id = new_id("completion_audit");
    conn.execute(
        "INSERT INTO completion_audit (
            completion_audit_id, session_id, runtime_turn_id, execution_run_id, status,
            summary_json, created_at_ms, created_at_iso, updated_at_ms, updated_at_iso
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?7, ?8)",
        params![
            completion_audit_id,
            session_id,
            turn_id,
            execution_run_id,
            audit_status,
            json!({
                "summary": audit_summary,
                "missingTodoItemIds": missing_todo_item_ids.clone(),
                "failedTodoItemIds": failed_todo_item_ids.clone(),
                "blockedTodoItemIds": blocked_todo_item_ids.clone(),
                "missingEvidenceRefs": missing_evidence_refs.clone(),
                "failedVerificationRunIds": failed_runs.clone(),
                "blockedVerificationRunIds": blocked_runs.clone(),
                "pendingVerificationRunIds": pending_runs.clone(),
                "notRunVerificationRunIds": not_run.clone(),
                "missingRequiredVerificationCount": missing_required_verification_count,
                "pendingApprovalTicketIds": pending_approval_ticket_ids.clone(),
                "execution": execution.as_ref().map(|execution| json!({
                    "executionRunId": execution.execution_run_id.clone(),
                    "status": execution.status.clone(),
                    "stepCount": execution.step_count,
                    "failedStepCount": execution.failed_step_count,
                    "blockedStepCount": execution.blocked_step_count,
                })),
                "residualRisks": residual_risks.clone(),
            })
            .to_string(),
            now,
            now_iso,
        ],
    )?;
    let verification_run_ids = verification_runs
        .iter()
        .map(|run| run.verification_run_id.clone())
        .collect::<Vec<_>>();
    let artifact_refs = verification_runs
        .iter()
        .filter_map(|run| run.artifact_id.clone())
        .collect::<Vec<_>>();
    let step_artifact_refs = execution
        .as_ref()
        .map(|execution| execution.artifact_refs.clone())
        .unwrap_or_default();
    let artifact_refs = merge_string_refs(&artifact_refs, &step_artifact_refs);
    let evidence_refs = verification_runs
        .iter()
        .flat_map(|run| run.evidence_refs.clone())
        .collect::<Vec<_>>();
    let todo_evidence_refs = todo
        .as_ref()
        .map(|todo| todo.evidence_refs.clone())
        .unwrap_or_default();
    let step_evidence_refs = execution
        .as_ref()
        .map(|execution| execution.evidence_refs.clone())
        .unwrap_or_default();
    let evidence_refs = merge_string_refs(
        &merge_string_refs(&evidence_refs, &todo_evidence_refs),
        &step_evidence_refs,
    );
    let unresolved_risks = json!({
        "failedVerificationRunIds": failed_runs,
        "blockedVerificationRunIds": blocked_runs,
        "pendingVerificationRunIds": pending_runs,
        "notRunVerificationRunIds": not_run,
        "pendingApprovalTicketIds": pending_approval_ticket_ids,
        "missingTodoItemIds": missing_todo_item_ids,
        "missingEvidenceRefs": missing_evidence_refs,
        "missingRequiredVerificationCount": missing_required_verification_count,
        "residualRisks": residual_risks,
    });
    let delivery_status = match audit_status {
        "passed" => "ready",
        "partial_allowed" => "partial",
        "failed" => "failed",
        "blocked" => "blocked",
        _ => "pending_verification",
    };
    let delivery_proof_id = new_id("delivery_proof");
    conn.execute(
        "INSERT INTO delivery_proof (
            delivery_proof_id, session_id, runtime_turn_id, execution_run_id, status,
            objective_ref, changed_files_refs_json, artifact_refs_json, evidence_refs_json,
            verification_run_ids_json, completion_audit_id, side_effect_refs_json,
            unresolved_risks_json, user_visible_summary_ref, created_at_ms, created_at_iso,
            updated_at_ms, updated_at_iso
         ) VALUES (?1, ?2, ?3, ?4, ?5, NULL, '[]', ?6, ?7, ?8, ?9, '[]', ?10, ?11, ?12, ?13, ?12, ?13)",
        params![
            delivery_proof_id,
            session_id,
            turn_id,
            execution_run_id,
            delivery_status,
            json_string(&artifact_refs)?,
            json_string(&evidence_refs)?,
            json_string(&verification_run_ids)?,
            completion_audit_id,
            unresolved_risks.to_string(),
            delivery_summary_text(delivery_status, &audit_summary),
            now,
            now_iso,
        ],
    )?;
    Ok(true)
}

fn read_latest_todo_audit(
    conn: &Connection,
    session_id: &str,
) -> Result<Option<TodoAuditSnapshot>> {
    let todo_list_id = conn
        .query_row(
            "SELECT todo_list_id
             FROM execution_todo_list
             WHERE session_id = ?1 AND status != 'superseded'
             ORDER BY updated_at_ms DESC, created_at_ms DESC
             LIMIT 1",
            params![session_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    let Some(todo_list_id) = todo_list_id else {
        return Ok(None);
    };
    let items = read_todo_items_for_list(conn, &todo_list_id)?;
    let mut missing_todo_item_ids = Vec::new();
    let mut failed_todo_item_ids = Vec::new();
    let mut blocked_todo_item_ids = Vec::new();
    let mut missing_evidence_refs = Vec::new();
    let mut evidence_refs = Vec::new();
    for item in items {
        evidence_refs = merge_string_refs(&evidence_refs, &item.evidence_refs);
        match item.status.as_str() {
            "completed" => {
                if item.evidence_refs.is_empty() {
                    missing_evidence_refs.push(format!("todo_item:{}", item.todo_item_id));
                }
            }
            "skipped" => {}
            "failed" => {
                failed_todo_item_ids.push(item.todo_item_id.clone());
                missing_todo_item_ids.push(item.todo_item_id);
            }
            "blocked" => {
                blocked_todo_item_ids.push(item.todo_item_id.clone());
                missing_todo_item_ids.push(item.todo_item_id);
            }
            _ => missing_todo_item_ids.push(item.todo_item_id),
        }
    }
    Ok(Some(TodoAuditSnapshot {
        missing_todo_item_ids,
        failed_todo_item_ids,
        blocked_todo_item_ids,
        missing_evidence_refs,
        evidence_refs,
    }))
}

fn read_execution_audit(
    conn: &Connection,
    session_id: &str,
    execution_run_id: Option<&str>,
) -> Result<Option<ExecutionAuditSnapshot>> {
    let row = if let Some(execution_run_id) = execution_run_id {
        conn.query_row(
            "SELECT execution_run_id, status
             FROM execution_run
             WHERE session_id = ?1 AND execution_run_id = ?2",
            params![session_id, execution_run_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()?
    } else {
        conn.query_row(
            "SELECT execution_run_id, status
             FROM execution_run
             WHERE session_id = ?1
             ORDER BY updated_at_ms DESC, created_at_ms DESC
             LIMIT 1",
            params![session_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()?
    };
    let Some((execution_run_id, status)) = row else {
        return Ok(None);
    };
    let counts = read_execution_step_counts(conn, &execution_run_id)?;
    let (artifact_refs, evidence_refs) = read_execution_step_refs(conn, &execution_run_id)?;
    Ok(Some(ExecutionAuditSnapshot {
        execution_run_id,
        status,
        step_count: counts.0,
        failed_step_count: counts.2,
        blocked_step_count: counts.3,
        artifact_refs,
        evidence_refs,
    }))
}

fn read_execution_step_refs(
    conn: &Connection,
    execution_run_id: &str,
) -> Result<(Vec<String>, Vec<String>)> {
    let mut stmt = conn.prepare(
        "SELECT artifact_refs_json, evidence_refs_json
         FROM execution_step
         WHERE execution_run_id = ?1",
    )?;
    let rows = stmt.query_map(params![execution_run_id], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })?;
    let mut artifact_refs = Vec::new();
    let mut evidence_refs = Vec::new();
    for row in rows {
        let (artifact_json, evidence_json) = row?;
        artifact_refs = merge_string_refs(&artifact_refs, &parse_json_vec_string(&artifact_json));
        evidence_refs = merge_string_refs(&evidence_refs, &parse_json_vec_string(&evidence_json));
    }
    Ok((artifact_refs, evidence_refs))
}

fn read_latest_verification_plan_audit(
    conn: &Connection,
    session_id: &str,
) -> Result<Option<VerificationPlanAuditSnapshot>> {
    let row = conn
        .query_row(
            "SELECT verification_plan_id, required_json, not_run_json
             FROM verification_plan
             WHERE session_id = ?1
             ORDER BY updated_at_ms DESC, created_at_ms DESC
             LIMIT 1",
            params![session_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            },
        )
        .optional()?;
    let Some((verification_plan_id, required_json, not_run_json)) = row else {
        return Ok(None);
    };
    Ok(Some(VerificationPlanAuditSnapshot {
        required: parse_json_vec_value(&required_json),
        not_run: parse_json_vec_value(&not_run_json),
        runs: read_verification_runs_for_plan(conn, &verification_plan_id)?,
    }))
}

fn read_pending_approval_ticket_ids(conn: &Connection, session_id: &str) -> Result<Vec<String>> {
    let mut stmt = conn.prepare(
        "SELECT approval_ticket_id
         FROM approval_ticket
         WHERE session_id = ?1 AND status = 'pending_user'
         ORDER BY updated_at_ms DESC, created_at_ms DESC",
    )?;
    let rows = stmt.query_map(params![session_id], |row| row.get::<_, String>(0))?;
    let mut result = Vec::new();
    for row in rows {
        result.push(row?);
    }
    Ok(result)
}

fn read_latest_execution_run_id(conn: &Connection, session_id: &str) -> Result<Option<String>> {
    conn.query_row(
        "SELECT execution_run_id
         FROM execution_run
         WHERE session_id = ?1
         ORDER BY updated_at_ms DESC, created_at_ms DESC
         LIMIT 1",
        params![session_id],
        |row| row.get(0),
    )
    .optional()
    .context("failed to read latest execution run id")
}

fn read_completion_audit_summary_from_conn(
    conn: &Connection,
    session_id: &str,
) -> Result<Option<AgentCompletionAuditSummary>> {
    conn.query_row(
        "SELECT completion_audit_id, session_id, runtime_turn_id, execution_run_id,
                status, summary_json, updated_at_ms
         FROM completion_audit
         WHERE session_id = ?1
         ORDER BY updated_at_ms DESC, created_at_ms DESC
         LIMIT 1",
        params![session_id],
        |row| {
            let summary_json: String = row.get(5)?;
            let summary_value: Value =
                serde_json::from_str(&summary_json).unwrap_or_else(|_| json!({}));
            Ok(AgentCompletionAuditSummary {
                completion_audit_id: row.get(0)?,
                session_id: row.get(1)?,
                runtime_turn_id: row.get(2)?,
                execution_run_id: row.get(3)?,
                status: row.get(4)?,
                missing_todo_item_ids: value_string_array(&summary_value, "missingTodoItemIds"),
                missing_evidence_refs: value_string_array(&summary_value, "missingEvidenceRefs"),
                failed_verification_run_ids: value_string_array(
                    &summary_value,
                    "failedVerificationRunIds",
                ),
                blocked_verification_run_ids: value_string_array(
                    &summary_value,
                    "blockedVerificationRunIds",
                ),
                not_run_verification_run_ids: value_string_array(
                    &summary_value,
                    "notRunVerificationRunIds",
                ),
                pending_approval_ticket_ids: value_string_array(
                    &summary_value,
                    "pendingApprovalTicketIds",
                ),
                residual_risks: summary_value
                    .get("residualRisks")
                    .cloned()
                    .unwrap_or_else(|| json!([])),
                summary: summary_value
                    .get("summary")
                    .and_then(Value::as_str)
                    .unwrap_or("Completion audit is pending.")
                    .to_string(),
                updated_at: row.get(6)?,
            })
        },
    )
    .optional()
    .context("failed to read completion audit summary")
}

fn value_string_array(value: &Value, key: &str) -> Vec<String> {
    value
        .get(key)
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(ToString::to_string)
                .collect()
        })
        .unwrap_or_default()
}

fn delivery_audit_summary_text(
    status: &str,
    failed_verification_count: usize,
    blocked_verification_count: usize,
    not_run_count: usize,
    missing_todo_count: usize,
    pending_approval_count: usize,
) -> String {
    match status {
        "passed" => "Completion audit passed.".to_string(),
        "failed" => format!(
            "Completion audit failed: {failed_verification_count} failed verification run(s)."
        ),
        "blocked" => format!(
            "Completion audit blocked: {missing_todo_count} todo item(s), {blocked_verification_count} verification run(s), and {pending_approval_count} approval(s) still need resolution."
        ),
        "partial_allowed" => format!(
            "Completion audit allows partial delivery with {not_run_count} not-run verification record(s)."
        ),
        _ => "Completion audit is pending.".to_string(),
    }
}

fn delivery_summary_text(status: &str, audit_summary: &str) -> String {
    match status {
        "ready" => "Delivery proof is ready.".to_string(),
        "partial" => format!("Delivery proof is partial. {audit_summary}"),
        "failed" => format!("Delivery proof failed. {audit_summary}"),
        "blocked" => format!("Delivery proof is blocked. {audit_summary}"),
        _ => "Delivery proof is pending verification.".to_string(),
    }
}

fn merge_string_refs(existing: &[String], next: &[String]) -> Vec<String> {
    let mut refs = existing.to_vec();
    for value in next {
        if value.trim().is_empty() == false && refs.iter().any(|item| item == value) == false {
            refs.push(value.clone());
        }
    }
    refs
}

fn merge_todo_blocker_json(existing: &Value, next: &Value) -> Value {
    let mut blockers = existing.as_array().cloned().unwrap_or_else(|| {
        if existing.is_null() || existing == &json!({}) {
            Vec::new()
        } else {
            vec![existing.clone()]
        }
    });
    if next.is_null() == false && blockers.iter().any(|value| value == next) == false {
        blockers.push(next.clone());
    }
    json!(blockers)
}

fn parse_json_vec_string(value: &str) -> Vec<String> {
    serde_json::from_str::<Vec<String>>(value).unwrap_or_default()
}

fn parse_json_vec_value(value: &str) -> Vec<Value> {
    serde_json::from_str::<Vec<Value>>(value).unwrap_or_default()
}

fn normalize_todo_kind(kind: &str) -> &'static str {
    match kind.trim() {
        "plan_bound" => "plan_bound",
        "recovery" => "recovery",
        _ => "mini",
    }
}

fn normalize_risk_level(risk_level: &str) -> &'static str {
    match risk_level.trim() {
        "low" => "low",
        "high" => "high",
        "critical" => "critical",
        _ => "medium",
    }
}

fn normalize_todo_status(status: &str) -> &'static str {
    match status.trim() {
        "in_progress" => "in_progress",
        "completed" => "completed",
        "blocked" => "blocked",
        "failed" => "failed",
        "skipped" => "skipped",
        _ => "pending",
    }
}

fn todo_status_priority(status: &str) -> u8 {
    match status {
        "blocked" => 0,
        "in_progress" => 1,
        "pending" => 2,
        "failed" => 3,
        "completed" => 4,
        "skipped" => 5,
        _ => 6,
    }
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
