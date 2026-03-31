use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use keyring::Entry;
#[cfg(not(test))]
use napi::threadsafe_function::{
    ErrorStrategy, ThreadSafeCallContext, ThreadsafeFunction, ThreadsafeFunctionCallMode,
};
use napi::{Error, JsFunction, Result, Status};
use napi_derive::napi;
use once_cell::sync::Lazy;
use reqwest::blocking::Client;
use reqwest::redirect::Policy;
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};
use uuid::Uuid;

const MCP_STORAGE_VERSION: u8 = 1;
const MCP_SCOPE_GLOBAL: &str = "global";
const MCP_SCOPE_PROJECT: &str = "project";
const MCP_SECRET_SERVICE: &str = "lyra.mcp";

#[cfg(not(test))]
type EventCallback = ThreadsafeFunction<String, ErrorStrategy::CalleeHandled>;
#[cfg(test)]
type EventCallback = ();

static EVENT_CALLBACK: Lazy<Mutex<Option<EventCallback>>> = Lazy::new(|| Mutex::new(None));
static RUNTIME_STATUSES: Lazy<Mutex<HashMap<String, McpRuntimeStatus>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));
static RUNTIME_INTROSPECTIONS: Lazy<Mutex<HashMap<String, McpIntrospectionSnapshot>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));
static RUNTIME_PROCESSES: Lazy<Mutex<HashMap<String, Arc<Mutex<Child>>>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PersistedMcpEnvironmentEntry {
    key: String,
    mode: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    value: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    external_key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    secret_ref_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    last_updated_at: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PersistedMcpServerConfig {
    id: String,
    server_key: String,
    source: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    template_id: Option<String>,
    title: String,
    summary: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    description: Option<String>,
    icon_key: String,
    scope: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    project_root: Option<String>,
    transport: String,
    install_kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    command: Option<String>,
    args: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    cwd: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    url: Option<String>,
    environment: Vec<PersistedMcpEnvironmentEntry>,
    permissions: Vec<String>,
    enabled: bool,
    auto_start: bool,
    created_at: String,
    updated_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    last_error: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PersistedMcpScopeDocument {
    version: u8,
    scope: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    project_root: Option<String>,
    servers: Vec<PersistedMcpServerConfig>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PersistedMcpSecretRecord {
    updated_at: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PersistedMcpSecretStore {
    version: u8,
    secrets: HashMap<String, PersistedMcpSecretRecord>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct McpSecretFieldRef {
    secret_ref_id: String,
    is_set: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    last_updated_at: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct McpEnvironmentEntry {
    key: String,
    mode: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    value: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    external_key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    secret_ref: Option<McpSecretFieldRef>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct McpRuntimeStatus {
    server_id: String,
    phase: String,
    transport: String,
    updated_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pid: Option<u32>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct McpServerConfig {
    id: String,
    server_key: String,
    source: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    template_id: Option<String>,
    title: String,
    summary: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    description: Option<String>,
    icon_key: String,
    scope: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    project_root: Option<String>,
    transport: String,
    install_kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    command: Option<String>,
    args: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    cwd: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    url: Option<String>,
    environment: Vec<McpEnvironmentEntry>,
    permissions: Vec<String>,
    enabled: bool,
    auto_start: bool,
    created_at: String,
    updated_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    last_error: Option<String>,
    runtime_status: McpRuntimeStatus,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct McpEffectiveServerConfig {
    #[serde(flatten)]
    server: McpServerConfig,
    effective_scope: String,
    inherited_from_global: bool,
    overridden_fields: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct McpEffectiveConfig {
    #[serde(skip_serializing_if = "Option::is_none")]
    resolved_project_root: Option<String>,
    servers: Vec<McpEffectiveServerConfig>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct McpIntrospectionItem {
    name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    description: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct McpIntrospectionSnapshot {
    server_id: String,
    fetched_at: String,
    source: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    note: Option<String>,
    tools: Vec<McpIntrospectionItem>,
    resources: Vec<McpIntrospectionItem>,
    prompts: Vec<McpIntrospectionItem>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ScopeDocumentRequest {
    storage_root: String,
    scope: String,
    project_root: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WriteScopeDocumentRequest {
    storage_root: String,
    document: PersistedMcpScopeDocument,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SecretStoreRequest {
    storage_root: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WriteSecretStoreRequest {
    storage_root: String,
    store: PersistedMcpSecretStore,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SanitizeEnvironmentRequest {
    entries: Vec<PersistedMcpEnvironmentEntry>,
    secret_store: PersistedMcpSecretStore,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NormalizeEnvironmentInputEntry {
    key: String,
    mode: String,
    value: Option<String>,
    external_key: Option<String>,
    secret_ref_id: Option<String>,
    secret_value: Option<String>,
    last_updated_at: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NormalizeEnvironmentInputRequest {
    next_entries: Vec<NormalizeEnvironmentInputEntry>,
    previous_entries: Vec<PersistedMcpEnvironmentEntry>,
    secret_store: PersistedMcpSecretStore,
    now_iso: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct NormalizeEnvironmentInputResult {
    environment: Vec<PersistedMcpEnvironmentEntry>,
    secret_store: PersistedMcpSecretStore,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeleteSecretRefsRequest {
    secret_store: PersistedMcpSecretStore,
    refs: Vec<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MergeEffectiveConfigRequest {
    resolved_project_root: Option<String>,
    global_document: PersistedMcpScopeDocument,
    project_document: PersistedMcpScopeDocument,
    secret_store: PersistedMcpSecretStore,
    runtime_statuses: Vec<McpRuntimeStatus>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct McpValidationResult {
    server_id: String,
    ok: bool,
    checked_at: String,
    summary: String,
    diagnostics: Vec<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ValidateMcpServerRequest {
    server: PersistedMcpServerConfig,
    checked_at: String,
    #[serde(default)]
    secret_store: Option<PersistedMcpSecretStore>,
    #[serde(default)]
    available_external_keys: Vec<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WriteManagedManifestRequest {
    storage_root: String,
    server: PersistedMcpServerConfig,
    generated_at: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MaterializeRuntimeEnvironmentRequest {
    entries: Vec<PersistedMcpEnvironmentEntry>,
    base_env: HashMap<String, String>,
}

#[allow(dead_code)]
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TemplateFieldDefinition {
    id: String,
    kind: String,
    required: bool,
    default_value: Option<String>,
    prefer_project_root: Option<bool>,
}

#[allow(dead_code)]
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TemplateQuickSetup {
    fields: Vec<TemplateFieldDefinition>,
}

#[allow(dead_code)]
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct McpCatalogItem {
    id: String,
    title: String,
    summary: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    description: Option<String>,
    icon_key: String,
    official: bool,
    transports: Vec<String>,
    install_kind: String,
    recommended_scope: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    default_command: Option<String>,
    default_args: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    default_cwd: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    default_url: Option<String>,
    default_environment: Vec<PersistedMcpEnvironmentEntry>,
    permissions: Vec<String>,
    tools: Vec<serde_json::Value>,
    resources: Vec<serde_json::Value>,
    prompts: Vec<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    quick_setup: Option<TemplateQuickSetup>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateMcpServerFromTemplateRequest {
    catalog_item: McpCatalogItem,
    title: Option<String>,
    server_key: Option<String>,
    setup_values: HashMap<String, String>,
    enabled: Option<bool>,
    auto_start: Option<bool>,
    resolved_scope: ResolvedScope,
    now_iso: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StartMcpRuntimeRequest {
    server: PersistedMcpServerConfig,
    checked_at: String,
    secret_store: PersistedMcpSecretStore,
    available_external_keys: Vec<String>,
    base_env: HashMap<String, String>,
    introspection_snapshot: Option<McpIntrospectionSnapshot>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct StartMcpRuntimeResult {
    validation: McpValidationResult,
    status: McpRuntimeStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    introspection_snapshot: Option<McpIntrospectionSnapshot>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StopMcpRuntimeRequest {
    server_id: String,
    transport: String,
    reason: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReadMcpRuntimeIntrospectionRequest {
    server_id: String,
    fallback_snapshot: Option<McpIntrospectionSnapshot>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ResolvedScope {
    scope: String,
    project_root: Option<String>,
}

fn to_error(message: impl Into<String>) -> Error {
    Error::new(Status::InvalidArg, message.into())
}

fn emit_runtime_event(event: serde_json::Value) {
    #[cfg(test)]
    {
        let _ = event;
        return;
    }

    #[cfg(not(test))]
    if let Ok(guard) = EVENT_CALLBACK.lock() {
        if let Some(callback) = guard.as_ref() {
            let _ = callback.call(
                Ok(event.to_string()),
                ThreadsafeFunctionCallMode::NonBlocking,
            );
        }
    }
}

fn set_runtime_status(status: McpRuntimeStatus) {
    if let Ok(mut statuses) = RUNTIME_STATUSES.lock() {
        statuses.insert(status.server_id.clone(), status.clone());
    }
    emit_runtime_event(json!({
        "kind": "runtime-status",
        "status": status,
    }));
}

fn set_runtime_introspection(snapshot: McpIntrospectionSnapshot) {
    if let Ok(mut snapshots) = RUNTIME_INTROSPECTIONS.lock() {
        snapshots.insert(snapshot.server_id.clone(), snapshot.clone());
    }
    emit_runtime_event(json!({
        "kind": "introspection",
        "snapshot": snapshot,
    }));
}

fn emit_runtime_validation(result: &McpValidationResult) {
    emit_runtime_event(json!({
        "kind": "validation",
        "result": result,
    }));
}

fn emit_runtime_log(server_id: &str, level: &str, message: &str) {
    emit_runtime_event(json!({
        "kind": "log",
        "serverId": server_id,
        "level": level,
        "message": message,
        "timestamp": now_iso(),
    }));
}

fn parse_json<T: DeserializeOwned>(input: &str) -> Result<T> {
    serde_json::from_str(input).map_err(|error| to_error(format!("invalid JSON payload: {error}")))
}

fn to_json<T: Serialize>(value: &T) -> Result<String> {
    serde_json::to_string(value)
        .map_err(|error| to_error(format!("failed to serialize payload: {error}")))
}

fn trim_or_none(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn normalize_title(value: Option<&str>, fallback: &str) -> String {
    value
        .and_then(trim_or_none)
        .unwrap_or_else(|| fallback.to_string())
}

fn create_secret_entry(secret_ref_id: &str) -> Result<Entry> {
    Entry::new(MCP_SECRET_SERVICE, secret_ref_id)
        .map_err(|error| to_error(format!("failed to access secure storage: {error}")))
}

fn write_secret_value(secret_ref_id: &str, secret_value: &str) -> Result<()> {
    create_secret_entry(secret_ref_id)?
        .set_password(secret_value)
        .map_err(|error| to_error(format!("failed to store MCP secret securely: {error}")))
}

fn read_secret_value(secret_ref_id: &str) -> Result<String> {
    create_secret_entry(secret_ref_id)?
        .get_password()
        .map_err(|error| to_error(format!("failed to read MCP secret securely: {error}")))
}

fn delete_secret_value(secret_ref_id: &str) -> Result<()> {
    match create_secret_entry(secret_ref_id)?.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(to_error(format!(
            "failed to delete MCP secret securely: {error}"
        ))),
    }
}

fn secret_value_exists(secret_ref_id: &str) -> bool {
    read_secret_value(secret_ref_id).is_ok()
}

fn hash_project_root(project_root: &str) -> String {
    let digest = Sha256::digest(project_root.as_bytes());
    let mut output = String::new();
    for byte in &digest[..8] {
        output.push_str(&format!("{byte:02x}"));
    }
    output
}

fn build_storage_root_path(storage_root: &str) -> PathBuf {
    PathBuf::from(storage_root)
}

fn build_global_document_path(storage_root: &Path) -> PathBuf {
    storage_root.join("global.servers.json")
}

fn build_project_document_path(storage_root: &Path, project_root: &str) -> PathBuf {
    storage_root
        .join("projects")
        .join(hash_project_root(project_root))
        .join("servers.json")
}

fn build_secrets_path(storage_root: &Path) -> PathBuf {
    storage_root.join("secrets.json")
}

fn build_managed_server_directory(
    storage_root: &Path,
    install_kind: &str,
    server_key: &str,
) -> PathBuf {
    storage_root
        .join("managed")
        .join(install_kind)
        .join(server_key)
}

fn build_default_scope_document(
    scope: &str,
    project_root: Option<String>,
) -> PersistedMcpScopeDocument {
    PersistedMcpScopeDocument {
        version: MCP_STORAGE_VERSION,
        scope: scope.to_string(),
        project_root,
        servers: Vec::new(),
    }
}

fn build_default_secret_store() -> PersistedMcpSecretStore {
    PersistedMcpSecretStore {
        version: MCP_STORAGE_VERSION,
        secrets: HashMap::new(),
    }
}

fn ensure_directory(directory_path: &Path) -> Result<()> {
    fs::create_dir_all(directory_path).map_err(|error| {
        to_error(format!(
            "failed to create directory {}: {error}",
            directory_path.display()
        ))
    })
}

fn read_json_file<T: DeserializeOwned>(file_path: &Path, fallback: T) -> T {
    match fs::read_to_string(file_path) {
        Ok(contents) => serde_json::from_str(&contents).unwrap_or(fallback),
        Err(_) => fallback,
    }
}

fn write_json_file<T: Serialize>(file_path: &Path, payload: &T) -> Result<()> {
    if let Some(parent_directory) = file_path.parent() {
        ensure_directory(parent_directory)?;
    }
    let json = serde_json::to_string_pretty(payload)
        .map_err(|error| to_error(format!("failed to serialize JSON payload: {error}")))?;
    fs::write(file_path, json).map_err(|error| {
        to_error(format!(
            "failed to write JSON file {}: {error}",
            file_path.display()
        ))
    })
}

fn resolve_document_path(
    storage_root: &Path,
    scope: &str,
    project_root: Option<&str>,
) -> Result<PathBuf> {
    if scope == MCP_SCOPE_GLOBAL {
        return Ok(build_global_document_path(storage_root));
    }

    if scope == MCP_SCOPE_PROJECT {
        let project_root =
            project_root.ok_or_else(|| to_error("project scope requires a project root"))?;
        return Ok(build_project_document_path(storage_root, project_root));
    }

    Err(to_error(format!("invalid MCP scope: {scope}")))
}

fn default_runtime_status(server: &PersistedMcpServerConfig) -> McpRuntimeStatus {
    McpRuntimeStatus {
        server_id: server.id.clone(),
        phase: "stopped".to_string(),
        transport: server.transport.clone(),
        updated_at: server.updated_at.clone(),
        message: server.last_error.clone(),
        pid: None,
    }
}

fn now_iso() -> String {
    chrono_like_now()
}

fn chrono_like_now() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};

    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis())
        .unwrap_or(0);
    millis.to_string()
}

fn create_runtime_status(
    server_id: &str,
    transport: &str,
    phase: &str,
    message: Option<String>,
    pid: Option<u32>,
) -> McpRuntimeStatus {
    McpRuntimeStatus {
        server_id: server_id.to_string(),
        phase: phase.to_string(),
        transport: transport.to_string(),
        updated_at: now_iso(),
        message,
        pid,
    }
}

fn sanitize_environment_entries(
    entries: &[PersistedMcpEnvironmentEntry],
    _secret_store: &PersistedMcpSecretStore,
) -> Vec<McpEnvironmentEntry> {
    entries
        .iter()
        .map(|entry| match entry.mode.as_str() {
            "plain" => McpEnvironmentEntry {
                key: entry.key.clone(),
                mode: "plain".to_string(),
                value: entry.value.clone(),
                external_key: None,
                secret_ref: None,
            },
            "external" => McpEnvironmentEntry {
                key: entry.key.clone(),
                mode: "external".to_string(),
                value: None,
                external_key: entry.external_key.clone(),
                secret_ref: None,
            },
            "secret" => McpEnvironmentEntry {
                key: entry.key.clone(),
                mode: "secret".to_string(),
                value: None,
                external_key: None,
                secret_ref: entry
                    .secret_ref_id
                    .as_ref()
                    .map(|secret_ref_id| McpSecretFieldRef {
                        secret_ref_id: secret_ref_id.clone(),
                        is_set: secret_value_exists(secret_ref_id),
                        last_updated_at: entry.last_updated_at.clone(),
                    }),
            },
            _ => McpEnvironmentEntry {
                key: entry.key.clone(),
                mode: entry.mode.clone(),
                value: entry.value.clone(),
                external_key: entry.external_key.clone(),
                secret_ref: None,
            },
        })
        .collect()
}

fn create_secret_id() -> String {
    format!("mcp-secret-{}", Uuid::new_v4())
}

fn normalize_environment_entries(
    request: NormalizeEnvironmentInputRequest,
) -> Result<NormalizeEnvironmentInputResult> {
    let previous_secret_refs = request
        .previous_entries
        .iter()
        .filter(|entry| entry.mode == "secret")
        .filter_map(|entry| entry.secret_ref_id.clone())
        .collect::<HashSet<_>>();

    let mut retained_secret_refs = HashSet::new();
    let mut next_secrets = request.secret_store.secrets.clone();
    let mut normalized = Vec::new();

    for entry in request.next_entries {
        let key = normalize_title(Some(&entry.key), "");
        if key.is_empty() {
            continue;
        }

        match entry.mode.as_str() {
            "plain" => {
                normalized.push(PersistedMcpEnvironmentEntry {
                    key,
                    mode: "plain".to_string(),
                    value: Some(normalize_title(entry.value.as_deref(), "")),
                    external_key: None,
                    secret_ref_id: None,
                    last_updated_at: None,
                });
            }
            "external" => {
                normalized.push(PersistedMcpEnvironmentEntry {
                    key: key.clone(),
                    mode: "external".to_string(),
                    value: None,
                    external_key: Some(normalize_title(entry.external_key.as_deref(), &key)),
                    secret_ref_id: None,
                    last_updated_at: None,
                });
            }
            "secret" => {
                if let Some(secret_value) = entry.secret_value.as_deref().and_then(trim_or_none) {
                    let secret_ref_id = entry
                        .secret_ref_id
                        .as_deref()
                        .and_then(trim_or_none)
                        .unwrap_or_else(create_secret_id);
                    let updated_at = entry
                        .last_updated_at
                        .as_deref()
                        .and_then(trim_or_none)
                        .unwrap_or_else(|| request.now_iso.clone());

                    write_secret_value(&secret_ref_id, &secret_value)?;
                    next_secrets.insert(
                        secret_ref_id.clone(),
                        PersistedMcpSecretRecord {
                            updated_at: updated_at.clone(),
                        },
                    );
                    retained_secret_refs.insert(secret_ref_id.clone());
                    normalized.push(PersistedMcpEnvironmentEntry {
                        key,
                        mode: "secret".to_string(),
                        value: None,
                        external_key: None,
                        secret_ref_id: Some(secret_ref_id),
                        last_updated_at: Some(updated_at),
                    });
                    continue;
                }

                let retained_secret_ref_id = entry
                    .secret_ref_id
                    .as_deref()
                    .and_then(trim_or_none)
                    .or_else(|| {
                        request
                            .previous_entries
                            .iter()
                            .find(|candidate| candidate.key == key && candidate.mode == "secret")
                            .and_then(|candidate| candidate.secret_ref_id.clone())
                    });

                let Some(secret_ref_id) = retained_secret_ref_id else {
                    return Err(to_error(format!("secret value is required for {key}")));
                };

                let Some(secret_entry) = next_secrets.get(&secret_ref_id) else {
                    return Err(to_error(format!("secret value is required for {key}")));
                };
                if secret_value_exists(&secret_ref_id) == false {
                    return Err(to_error(format!("secret value is required for {key}")));
                }

                retained_secret_refs.insert(secret_ref_id.clone());
                normalized.push(PersistedMcpEnvironmentEntry {
                    key,
                    mode: "secret".to_string(),
                    value: None,
                    external_key: None,
                    secret_ref_id: Some(secret_ref_id),
                    last_updated_at: Some(secret_entry.updated_at.clone()),
                });
            }
            other => {
                return Err(to_error(format!(
                    "unsupported MCP environment mode: {other}"
                )));
            }
        }
    }

    for secret_ref_id in previous_secret_refs {
        if retained_secret_refs.contains(&secret_ref_id) {
            continue;
        }
        next_secrets.remove(&secret_ref_id);
    }

    Ok(NormalizeEnvironmentInputResult {
        environment: normalized,
        secret_store: PersistedMcpSecretStore {
            version: MCP_STORAGE_VERSION,
            secrets: next_secrets,
        },
    })
}

fn delete_secret_refs(
    secret_store: PersistedMcpSecretStore,
    refs: &[String],
) -> PersistedMcpSecretStore {
    let refs = refs.iter().cloned().collect::<HashSet<_>>();
    for secret_ref_id in &refs {
        let _ = delete_secret_value(secret_ref_id);
    }
    let secrets = secret_store
        .secrets
        .into_iter()
        .filter(|(key, _)| !refs.contains(key))
        .collect::<HashMap<_, _>>();

    PersistedMcpSecretStore {
        version: MCP_STORAGE_VERSION,
        secrets,
    }
}

fn json_changed<T: Serialize>(left: &T, right: &T) -> bool {
    serde_json::to_value(left).ok() != serde_json::to_value(right).ok()
}

fn compute_overridden_fields(
    global_server: &PersistedMcpServerConfig,
    project_server: &PersistedMcpServerConfig,
) -> Vec<String> {
    let mut fields = Vec::new();

    if json_changed(&global_server.title, &project_server.title) {
        fields.push("title".to_string());
    }
    if json_changed(&global_server.summary, &project_server.summary) {
        fields.push("summary".to_string());
    }
    if json_changed(&global_server.description, &project_server.description) {
        fields.push("description".to_string());
    }
    if json_changed(&global_server.transport, &project_server.transport) {
        fields.push("transport".to_string());
    }
    if json_changed(&global_server.install_kind, &project_server.install_kind) {
        fields.push("installKind".to_string());
    }
    if json_changed(&global_server.command, &project_server.command) {
        fields.push("command".to_string());
    }
    if json_changed(&global_server.args, &project_server.args) {
        fields.push("args".to_string());
    }
    if json_changed(&global_server.cwd, &project_server.cwd) {
        fields.push("cwd".to_string());
    }
    if json_changed(&global_server.url, &project_server.url) {
        fields.push("url".to_string());
    }
    if json_changed(&global_server.environment, &project_server.environment) {
        fields.push("environment".to_string());
    }
    if json_changed(&global_server.permissions, &project_server.permissions) {
        fields.push("permissions".to_string());
    }
    if json_changed(&global_server.enabled, &project_server.enabled) {
        fields.push("enabled".to_string());
    }
    if json_changed(&global_server.auto_start, &project_server.auto_start) {
        fields.push("autoStart".to_string());
    }

    fields
}

fn decorate_server(
    server: &PersistedMcpServerConfig,
    secret_store: &PersistedMcpSecretStore,
    runtime_statuses: &HashMap<String, McpRuntimeStatus>,
) -> McpServerConfig {
    let runtime_status = runtime_statuses
        .get(&server.id)
        .cloned()
        .unwrap_or_else(|| default_runtime_status(server));

    McpServerConfig {
        id: server.id.clone(),
        server_key: server.server_key.clone(),
        source: server.source.clone(),
        template_id: server.template_id.clone(),
        title: server.title.clone(),
        summary: server.summary.clone(),
        description: server.description.clone(),
        icon_key: server.icon_key.clone(),
        scope: server.scope.clone(),
        project_root: server.project_root.clone(),
        transport: server.transport.clone(),
        install_kind: server.install_kind.clone(),
        command: server.command.clone(),
        args: server.args.clone(),
        cwd: server.cwd.clone(),
        url: server.url.clone(),
        environment: sanitize_environment_entries(&server.environment, secret_store),
        permissions: server.permissions.clone(),
        enabled: server.enabled,
        auto_start: server.auto_start,
        created_at: server.created_at.clone(),
        updated_at: server.updated_at.clone(),
        last_error: server.last_error.clone(),
        runtime_status,
    }
}

fn to_path_candidate(value: &str) -> PathBuf {
    let path = PathBuf::from(value);
    if path.is_absolute() {
        path
    } else {
        std::env::current_dir()
            .map(|base| base.join(&path))
            .unwrap_or(path)
    }
}

fn is_valid_env_key(value: &str) -> bool {
    let trimmed = value.trim();
    !trimmed.is_empty() && !trimmed.contains('=') && !trimmed.contains('\0')
}

fn validate_runtime_environment(
    server: &PersistedMcpServerConfig,
    secret_store: &PersistedMcpSecretStore,
    available_external_keys: &[String],
) -> Vec<String> {
    let mut diagnostics = Vec::new();
    let mut seen_keys = HashSet::new();
    let available_external_keys = available_external_keys
        .iter()
        .map(|entry| entry.trim().to_string())
        .filter(|entry| !entry.is_empty())
        .collect::<HashSet<_>>();

    if let Some(cwd) = server.cwd.as_deref().and_then(trim_or_none) {
        let cwd_path = PathBuf::from(&cwd);
        if !cwd_path.exists() {
            diagnostics.push(format!("Working directory does not exist: {cwd}"));
        } else if !cwd_path.is_dir() {
            diagnostics.push(format!("Working directory is not a directory: {cwd}"));
        }
    }

    for entry in &server.environment {
        let key = entry.key.trim();
        if !is_valid_env_key(key) {
            diagnostics.push(format!("Invalid environment key: {}", entry.key));
            continue;
        }

        if !seen_keys.insert(key.to_string()) {
            diagnostics.push(format!("Duplicate environment key: {key}"));
        }

        match entry.mode.as_str() {
            "plain" => {
                if entry.value.is_none() {
                    diagnostics.push(format!("Missing plain environment value for {key}"));
                }
            }
            "external" => match entry.external_key.as_deref().and_then(trim_or_none) {
                None => diagnostics.push(format!("Missing external environment key for {key}")),
                Some(external_key) => {
                    if !available_external_keys.contains(&external_key) {
                        diagnostics.push(format!(
                            "External environment variable is not available for {key}: {external_key}"
                        ));
                    }
                }
            },
            "secret" => match entry.secret_ref_id.as_deref().and_then(trim_or_none) {
                None => diagnostics.push(format!("Missing secret reference for {key}")),
                Some(secret_ref_id) => {
                    if !secret_store.secrets.contains_key(&secret_ref_id)
                        || !secret_value_exists(&secret_ref_id)
                    {
                        diagnostics.push(format!("Secret value is missing for {key}"));
                    }
                }
            },
            other => diagnostics.push(format!("Unsupported environment mode for {key}: {other}")),
        }
    }

    diagnostics
}

fn quote_posix(value: &str) -> String {
    if value.is_empty() {
        "''".to_string()
    } else {
        format!("'{}'", value.replace('\'', "'\"'\"'"))
    }
}

fn quote_windows_cmd(value: &str) -> String {
    format!("\"{}\"", value.replace('"', "\"\""))
}

fn build_posix_command_line(command: &str, args: &[String]) -> String {
    let mut parts = vec![quote_posix(command)];
    parts.extend(args.iter().map(|arg| quote_posix(arg)));
    parts.join(" ")
}

fn build_windows_command_line(command: &str, args: &[String]) -> String {
    let mut parts = vec![quote_windows_cmd(command)];
    parts.extend(args.iter().map(|arg| quote_windows_cmd(arg)));
    parts.join(" ")
}

fn create_server_id() -> String {
    format!("mcp-{}", Uuid::new_v4())
}

fn create_server_key(value: &str) -> String {
    let normalized = value
        .trim()
        .to_lowercase()
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() {
                character
            } else {
                '-'
            }
        })
        .collect::<String>();
    let trimmed = normalized.trim_matches('-').to_string();
    if trimmed.is_empty() {
        format!("server-{}", &Uuid::new_v4().to_string()[..8])
    } else {
        trimmed
    }
}

fn normalize_setup_values(values: HashMap<String, String>) -> HashMap<String, String> {
    values
        .into_iter()
        .map(|(key, value)| (key, value.trim().to_string()))
        .collect()
}

fn resolve_template_path_input(
    candidate: Option<&String>,
    resolved_scope: &ResolvedScope,
) -> String {
    candidate
        .and_then(|value| trim_or_none(value))
        .or_else(|| resolved_scope.project_root.clone())
        .unwrap_or_else(|| ".".to_string())
}

fn create_server_from_template(
    request: CreateMcpServerFromTemplateRequest,
) -> PersistedMcpServerConfig {
    let setup_values = normalize_setup_values(request.setup_values);
    let catalog_item = request.catalog_item;
    let mut args = catalog_item.default_args.clone();
    let mut cwd = catalog_item.default_cwd.clone();
    let url = catalog_item.default_url.clone();
    let mut environment = catalog_item.default_environment.clone();
    let mut title = normalize_title(request.title.as_deref(), &catalog_item.title);

    match catalog_item.id.as_str() {
        "filesystem" => {
            let root_path =
                resolve_template_path_input(setup_values.get("rootPath"), &request.resolved_scope);
            args = vec![
                "-y".to_string(),
                "@modelcontextprotocol/server-filesystem".to_string(),
                root_path.clone(),
            ];
            title = normalize_title(
                request.title.as_deref(),
                &format!(
                    "{} · {}",
                    catalog_item.title,
                    Path::new(&root_path)
                        .file_name()
                        .and_then(|value| value.to_str())
                        .unwrap_or(root_path.as_str())
                ),
            );
        }
        "git" => {
            let repo_path =
                resolve_template_path_input(setup_values.get("repoPath"), &request.resolved_scope);
            args = vec![
                "-y".to_string(),
                "@modelcontextprotocol/server-git".to_string(),
                repo_path.clone(),
            ];
            cwd = Some(repo_path.clone());
            title = normalize_title(
                request.title.as_deref(),
                &format!(
                    "{} · {}",
                    catalog_item.title,
                    Path::new(&repo_path)
                        .file_name()
                        .and_then(|value| value.to_str())
                        .unwrap_or(repo_path.as_str())
                ),
            );
        }
        "time" => {
            if let Some(timezone) = setup_values
                .get("timezone")
                .and_then(|value| trim_or_none(value))
            {
                environment.push(PersistedMcpEnvironmentEntry {
                    key: "TZ".to_string(),
                    mode: "plain".to_string(),
                    value: Some(timezone.clone()),
                    external_key: None,
                    secret_ref_id: None,
                    last_updated_at: None,
                });
                title = normalize_title(
                    request.title.as_deref(),
                    &format!("{} · {}", catalog_item.title, timezone),
                );
            }
        }
        _ => {}
    }

    PersistedMcpServerConfig {
        id: create_server_id(),
        server_key: request
            .server_key
            .as_deref()
            .and_then(trim_or_none)
            .unwrap_or_else(|| create_server_key(&catalog_item.id)),
        source: "catalog".to_string(),
        template_id: Some(catalog_item.id.clone()),
        title,
        summary: catalog_item.summary.clone(),
        description: catalog_item.description.clone(),
        icon_key: catalog_item.icon_key.clone(),
        scope: request.resolved_scope.scope,
        project_root: request.resolved_scope.project_root,
        transport: catalog_item
            .transports
            .first()
            .cloned()
            .unwrap_or_else(|| "stdio".to_string()),
        install_kind: catalog_item.install_kind.clone(),
        command: catalog_item.default_command.clone(),
        args,
        cwd,
        url,
        environment,
        permissions: catalog_item.permissions.clone(),
        enabled: request.enabled.unwrap_or(true),
        auto_start: request.auto_start.unwrap_or(false),
        created_at: request.now_iso.clone(),
        updated_at: request.now_iso,
        last_error: None,
    }
}

fn materialize_runtime_environment(
    request: MaterializeRuntimeEnvironmentRequest,
) -> Result<HashMap<String, String>> {
    let mut environment = request.base_env;

    for entry in request.entries {
        match entry.mode.as_str() {
            "plain" => {
                if let Some(value) = entry.value {
                    environment.insert(entry.key, value);
                }
            }
            "external" => {
                if let Some(external_key) = entry.external_key {
                    if let Some(external_value) = environment.get(&external_key).cloned() {
                        environment.insert(entry.key, external_value);
                    }
                }
            }
            "secret" => {
                let secret_ref_id = entry
                    .secret_ref_id
                    .as_deref()
                    .and_then(trim_or_none)
                    .ok_or_else(|| to_error(format!("secret missing for {}", entry.key)))?;
                let secret_value = read_secret_value(&secret_ref_id)
                    .map_err(|_| to_error(format!("secret missing for {}", entry.key)))?;
                environment.insert(entry.key, secret_value);
            }
            other => {
                return Err(to_error(format!(
                    "unsupported MCP environment mode: {other}"
                )));
            }
        }
    }

    Ok(environment)
}

fn build_posix_launch_script(server: &PersistedMcpServerConfig) -> Option<String> {
    if server.transport != "stdio" {
        return None;
    }

    let command = server.command.as_deref().and_then(trim_or_none)?;
    let mut lines = vec![
        "#!/usr/bin/env bash".to_string(),
        "set -euo pipefail".to_string(),
        String::new(),
        "# Generated by Lyra MCP manager.".to_string(),
    ];

    if let Some(cwd) = server.cwd.as_deref().and_then(trim_or_none) {
        lines.push(format!("cd {}", quote_posix(&cwd)));
    }

    if !server.environment.is_empty() {
        lines.push(String::new());
        for entry in &server.environment {
            match entry.mode.as_str() {
                "plain" => {
                    if let Some(value) = entry.value.as_deref() {
                        lines.push(format!("export {}={}", entry.key, quote_posix(value)));
                    }
                }
                "external" => {
                    if let Some(external_key) = entry.external_key.as_deref() {
                        lines.push(format!(
                            "if [ -n \"${{{}:-}}\" ]; then export {}=\"${{{}}}\"; fi",
                            external_key, entry.key, external_key
                        ));
                    }
                }
                "secret" => {
                    lines.push(format!(
                        "# secret {} is injected by Lyra runtime only",
                        entry.key
                    ));
                }
                _ => {}
            }
        }
    }

    lines.push(String::new());
    lines.push(format!(
        "exec {}",
        build_posix_command_line(&command, &server.args)
    ));
    Some(lines.join("\n") + "\n")
}

fn build_windows_launch_script(server: &PersistedMcpServerConfig) -> Option<String> {
    if server.transport != "stdio" {
        return None;
    }

    let command = server.command.as_deref().and_then(trim_or_none)?;
    let mut lines = vec![
        "@echo off".to_string(),
        "setlocal".to_string(),
        "REM Generated by Lyra MCP manager.".to_string(),
    ];

    if let Some(cwd) = server.cwd.as_deref().and_then(trim_or_none) {
        lines.push(format!("cd /d {}", quote_windows_cmd(&cwd)));
    }

    if !server.environment.is_empty() {
        for entry in &server.environment {
            match entry.mode.as_str() {
                "plain" => {
                    if let Some(value) = entry.value.as_deref() {
                        lines.push(format!("set \"{}={}\"", entry.key, value));
                    }
                }
                "external" => {
                    if let Some(external_key) = entry.external_key.as_deref() {
                        lines.push(format!(
                            "if defined {} set \"{}=%{}%\"",
                            external_key, entry.key, external_key
                        ));
                    }
                }
                "secret" => {
                    lines.push(format!(
                        "REM secret {} is injected by Lyra runtime only",
                        entry.key
                    ));
                }
                _ => {}
            }
        }
    }

    lines.push(build_windows_command_line(&command, &server.args));
    Some(lines.join("\r\n") + "\r\n")
}

fn write_text_file(file_path: &Path, contents: &str) -> Result<()> {
    if let Some(parent_directory) = file_path.parent() {
        ensure_directory(parent_directory)?;
    }
    fs::write(file_path, contents).map_err(|error| {
        to_error(format!(
            "failed to write file {}: {error}",
            file_path.display()
        ))
    })?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if file_path
            .extension()
            .and_then(|value| value.to_str())
            .is_some_and(|value| value.eq_ignore_ascii_case("sh"))
        {
            let permissions = fs::Permissions::from_mode(0o755);
            fs::set_permissions(file_path, permissions).map_err(|error| {
                to_error(format!(
                    "failed to set permissions on {}: {error}",
                    file_path.display()
                ))
            })?;
        }
    }

    Ok(())
}

fn find_command_on_path(command: &str) -> Option<String> {
    let trimmed = command.trim();
    if trimmed.is_empty() {
        return None;
    }

    if trimmed.contains('/') || trimmed.contains('\\') {
        let direct = to_path_candidate(trimmed);
        return direct
            .exists()
            .then(|| direct.to_string_lossy().into_owned());
    }

    let search_path = std::env::var("PATH").unwrap_or_default();
    let path_entries = search_path
        .split(if cfg!(windows) { ';' } else { ':' })
        .filter(|entry| !entry.is_empty())
        .collect::<Vec<_>>();

    #[cfg(windows)]
    let extensions = std::env::var("PATHEXT")
        .unwrap_or_else(|_| ".EXE;.CMD;.BAT".to_string())
        .split(';')
        .map(str::to_ascii_lowercase)
        .collect::<Vec<_>>();
    #[cfg(not(windows))]
    let _extensions = vec![String::new()];

    for entry in path_entries {
        let base_path = Path::new(entry).join(trimmed);
        if base_path.exists() {
            return Some(base_path.to_string_lossy().into_owned());
        }

        #[cfg(windows)]
        for extension in &extensions {
            let candidate = PathBuf::from(format!("{}{}", base_path.to_string_lossy(), extension));
            if candidate.exists() {
                return Some(candidate.to_string_lossy().into_owned());
            }
        }
    }

    None
}

fn validate_server(
    server: &PersistedMcpServerConfig,
    checked_at: String,
    secret_store: &PersistedMcpSecretStore,
    available_external_keys: &[String],
) -> McpValidationResult {
    let mut diagnostics =
        validate_runtime_environment(server, secret_store, available_external_keys);

    if !server.enabled {
        diagnostics.push("Server is disabled.".to_string());
    }

    if server.transport == "stdio" {
        match server.command.as_deref().and_then(trim_or_none) {
            None => diagnostics.push("Missing startup command.".to_string()),
            Some(command) => {
                if find_command_on_path(&command).is_none() {
                    diagnostics.push(format!("Command not found on PATH: {command}"));
                }
            }
        }
    } else {
        match server.url.as_deref().and_then(trim_or_none) {
            None => diagnostics.push("Missing remote URL.".to_string()),
            Some(url) => {
                let client = Client::builder()
                    .timeout(Duration::from_secs(4))
                    .redirect(Policy::none())
                    .build();
                match client {
                    Ok(client) => match client.get(&url).send() {
                        Ok(response) => {
                            if response.status().as_u16() >= 500 {
                                diagnostics.push(format!(
                                    "Remote endpoint responded with {}.",
                                    response.status().as_u16()
                                ));
                            }
                        }
                        Err(error) => diagnostics.push(error.to_string()),
                    },
                    Err(error) => diagnostics.push(error.to_string()),
                }
            }
        }
    }

    let ok = diagnostics.is_empty();
    McpValidationResult {
        server_id: server.id.clone(),
        ok,
        checked_at,
        summary: if ok {
            "Validation passed.".to_string()
        } else {
            "Validation failed.".to_string()
        },
        diagnostics,
    }
}

fn spawn_log_thread(
    server_id: String,
    level: &'static str,
    mut reader: impl Read + Send + 'static,
) {
    thread::spawn(move || {
        let mut buffer = [0_u8; 8192];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(size) => {
                    let message = String::from_utf8_lossy(&buffer[..size]).trim().to_string();
                    if !message.is_empty() {
                        emit_runtime_log(&server_id, level, &message);
                    }
                }
                Err(error) => {
                    emit_runtime_log(&server_id, "error", &error.to_string());
                    break;
                }
            }
        }
    });
}

fn stop_runtime_internal(request: StopMcpRuntimeRequest) -> McpRuntimeStatus {
    if let Ok(mut processes) = RUNTIME_PROCESSES.lock() {
        if let Some(child) = processes.remove(&request.server_id) {
            if let Ok(mut guard) = child.lock() {
                let _ = guard.kill();
            }
        }
    }

    let status = create_runtime_status(
        &request.server_id,
        &request.transport,
        "stopped",
        request.reason,
        None,
    );
    set_runtime_status(status.clone());
    status
}

fn start_runtime(request: StartMcpRuntimeRequest) -> Result<StartMcpRuntimeResult> {
    let validation = validate_server(
        &request.server,
        request.checked_at,
        &request.secret_store,
        &request.available_external_keys,
    );
    emit_runtime_validation(&validation);

    let introspection_snapshot = request.introspection_snapshot.clone();
    if let Some(snapshot) = introspection_snapshot.clone() {
        set_runtime_introspection(snapshot);
    }

    if !validation.ok {
        let status = create_runtime_status(
            &request.server.id,
            &request.server.transport,
            "error",
            Some(validation.summary.clone()),
            None,
        );
        set_runtime_status(status.clone());
        return Ok(StartMcpRuntimeResult {
            validation,
            status,
            introspection_snapshot,
        });
    }

    if request.server.transport != "stdio" {
        let status = create_runtime_status(
            &request.server.id,
            &request.server.transport,
            "running",
            Some(validation.summary.clone()),
            None,
        );
        set_runtime_status(status.clone());
        return Ok(StartMcpRuntimeResult {
            validation,
            status,
            introspection_snapshot,
        });
    }

    let command = request
        .server
        .command
        .as_deref()
        .and_then(trim_or_none)
        .ok_or_else(|| to_error("startup command is required for stdio MCP servers"))?;

    let _ = stop_runtime_internal(StopMcpRuntimeRequest {
        server_id: request.server.id.clone(),
        transport: request.server.transport.clone(),
        reason: Some("Restarting MCP server".to_string()),
    });

    let starting_status = create_runtime_status(
        &request.server.id,
        &request.server.transport,
        "starting",
        Some("Starting MCP server".to_string()),
        None,
    );
    set_runtime_status(starting_status);

    let environment = materialize_runtime_environment(MaterializeRuntimeEnvironmentRequest {
        entries: request.server.environment.clone(),
        base_env: request.base_env,
    })?;

    let mut child = Command::new(&command)
        .args(&request.server.args)
        .current_dir(
            request
                .server
                .cwd
                .as_deref()
                .and_then(trim_or_none)
                .unwrap_or_else(|| ".".to_string()),
        )
        .envs(environment)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .stdin(Stdio::null())
        .spawn()
        .map_err(|error| to_error(format!("failed to start MCP server: {error}")))?;

    let pid = child.id();
    if let Some(stdout) = child.stdout.take() {
        spawn_log_thread(request.server.id.clone(), "info", stdout);
    }
    if let Some(stderr) = child.stderr.take() {
        spawn_log_thread(request.server.id.clone(), "error", stderr);
    }

    let child = Arc::new(Mutex::new(child));
    if let Ok(mut processes) = RUNTIME_PROCESSES.lock() {
        processes.insert(request.server.id.clone(), Arc::clone(&child));
    }

    let running_status = create_runtime_status(
        &request.server.id,
        &request.server.transport,
        "running",
        Some("MCP server is running.".to_string()),
        Some(pid),
    );
    set_runtime_status(running_status.clone());

    let server_id = request.server.id.clone();
    let transport = request.server.transport.clone();
    thread::spawn(move || {
        let exit_result = child
            .lock()
            .ok()
            .and_then(|mut process| process.wait().ok());

        if let Ok(mut processes) = RUNTIME_PROCESSES.lock() {
            processes.remove(&server_id);
        }

        let current_phase = RUNTIME_STATUSES
            .lock()
            .ok()
            .and_then(|statuses| statuses.get(&server_id).map(|status| status.phase.clone()));
        if current_phase.as_deref() == Some("stopped") {
            return;
        }

        let (phase, message) = match exit_result {
            Some(status) if status.success() => ("stopped", "MCP server stopped.".to_string()),
            Some(status) => (
                "error",
                format!(
                    "MCP server exited{}.",
                    status
                        .code()
                        .map(|code| format!(" with code {code}"))
                        .unwrap_or_default()
                ),
            ),
            None => ("error", "MCP server exited unexpectedly.".to_string()),
        };
        set_runtime_status(create_runtime_status(
            &server_id,
            &transport,
            phase,
            Some(message.clone()),
            None,
        ));
        if phase == "error" {
            emit_runtime_log(&server_id, "error", &message);
        }
    });

    Ok(StartMcpRuntimeResult {
        validation,
        status: running_status,
        introspection_snapshot,
    })
}

#[napi(js_name = "readMcpScopeDocumentJson")]
pub fn read_mcp_scope_document_json(request_json: String) -> Result<String> {
    let request: ScopeDocumentRequest = parse_json(&request_json)?;
    if request.scope == MCP_SCOPE_PROJECT && request.project_root.is_none() {
        return to_json(&build_default_scope_document(&request.scope, None));
    }

    let storage_root = build_storage_root_path(&request.storage_root);
    let document_path = resolve_document_path(
        &storage_root,
        &request.scope,
        request.project_root.as_deref(),
    )?;
    let document = read_json_file(
        &document_path,
        build_default_scope_document(&request.scope, request.project_root),
    );
    to_json(&document)
}

#[napi(js_name = "registerMcpEventCallback")]
pub fn register_mcp_event_callback(callback: JsFunction) -> Result<()> {
    #[cfg(test)]
    {
        let _ = callback;
        if let Ok(mut guard) = EVENT_CALLBACK.lock() {
            *guard = Some(());
        }
        Ok(())
    }

    #[cfg(not(test))]
    {
        let threadsafe = callback.create_threadsafe_function(
            0,
            |ctx: ThreadSafeCallContext<String>| -> Result<Vec<napi::JsUnknown>> {
                Ok(vec![ctx
                    .env
                    .create_string_from_std(ctx.value)?
                    .into_unknown()])
            },
        )?;

        if let Ok(mut guard) = EVENT_CALLBACK.lock() {
            *guard = Some(threadsafe);
        }
        Ok(())
    }
}

#[napi(js_name = "writeMcpScopeDocumentJson")]
pub fn write_mcp_scope_document_json(request_json: String) -> Result<()> {
    let request: WriteScopeDocumentRequest = parse_json(&request_json)?;
    let storage_root = build_storage_root_path(&request.storage_root);
    let document_path = resolve_document_path(
        &storage_root,
        &request.document.scope,
        request.document.project_root.as_deref(),
    )?;
    write_json_file(&document_path, &request.document)
}

#[napi(js_name = "readMcpSecretStoreJson")]
pub fn read_mcp_secret_store_json(request_json: String) -> Result<String> {
    let request: SecretStoreRequest = parse_json(&request_json)?;
    let storage_root = build_storage_root_path(&request.storage_root);
    let secret_store = read_json_file(
        &build_secrets_path(&storage_root),
        build_default_secret_store(),
    );
    to_json(&secret_store)
}

#[napi(js_name = "writeMcpSecretStoreJson")]
pub fn write_mcp_secret_store_json(request_json: String) -> Result<()> {
    let request: WriteSecretStoreRequest = parse_json(&request_json)?;
    let storage_root = build_storage_root_path(&request.storage_root);
    write_json_file(&build_secrets_path(&storage_root), &request.store)
}

#[napi(js_name = "sanitizeMcpEnvironmentJson")]
pub fn sanitize_mcp_environment_json(request_json: String) -> Result<String> {
    let request: SanitizeEnvironmentRequest = parse_json(&request_json)?;
    let sanitized = sanitize_environment_entries(&request.entries, &request.secret_store);
    to_json(&sanitized)
}

#[napi(js_name = "normalizeMcpEnvironmentInputJson")]
pub fn normalize_mcp_environment_input_json(request_json: String) -> Result<String> {
    let request: NormalizeEnvironmentInputRequest = parse_json(&request_json)?;
    let normalized = normalize_environment_entries(request)?;
    to_json(&normalized)
}

#[napi(js_name = "deleteMcpSecretRefsJson")]
pub fn delete_mcp_secret_refs_json(request_json: String) -> Result<String> {
    let request: DeleteSecretRefsRequest = parse_json(&request_json)?;
    let next_store = delete_secret_refs(request.secret_store, &request.refs);
    to_json(&next_store)
}

#[napi(js_name = "mergeMcpEffectiveConfigJson")]
pub fn merge_mcp_effective_config_json(request_json: String) -> Result<String> {
    let request: MergeEffectiveConfigRequest = parse_json(&request_json)?;
    let runtime_statuses = request
        .runtime_statuses
        .into_iter()
        .map(|status| (status.server_id.clone(), status))
        .collect::<HashMap<_, _>>();

    let mut effective_servers = Vec::new();
    let mut key_to_index = HashMap::new();

    for global_server in &request.global_document.servers {
        key_to_index.insert(global_server.server_key.clone(), effective_servers.len());
        effective_servers.push(McpEffectiveServerConfig {
            server: decorate_server(global_server, &request.secret_store, &runtime_statuses),
            effective_scope: MCP_SCOPE_GLOBAL.to_string(),
            inherited_from_global: false,
            overridden_fields: Vec::new(),
        });
    }

    for project_server in &request.project_document.servers {
        let overridden = request
            .global_document
            .servers
            .iter()
            .find(|global_server| global_server.server_key == project_server.server_key);
        let effective_server = McpEffectiveServerConfig {
            server: decorate_server(project_server, &request.secret_store, &runtime_statuses),
            effective_scope: MCP_SCOPE_PROJECT.to_string(),
            inherited_from_global: overridden.is_some(),
            overridden_fields: overridden
                .map(|global_server| compute_overridden_fields(global_server, project_server))
                .unwrap_or_default(),
        };

        if let Some(index) = key_to_index.get(&project_server.server_key).copied() {
            effective_servers[index] = effective_server;
        } else {
            key_to_index.insert(project_server.server_key.clone(), effective_servers.len());
            effective_servers.push(effective_server);
        }
    }

    to_json(&McpEffectiveConfig {
        resolved_project_root: request.resolved_project_root,
        servers: effective_servers,
    })
}

#[napi(js_name = "validateMcpServerJson")]
pub fn validate_mcp_server_json(request_json: String) -> Result<String> {
    let request: ValidateMcpServerRequest = parse_json(&request_json)?;
    let secret_store = request
        .secret_store
        .unwrap_or_else(build_default_secret_store);
    let result = validate_server(
        &request.server,
        request.checked_at,
        &secret_store,
        &request.available_external_keys,
    );
    to_json(&result)
}

#[napi(js_name = "writeMcpManagedManifestJson")]
pub fn write_mcp_managed_manifest_json(request_json: String) -> Result<()> {
    let request: WriteManagedManifestRequest = parse_json(&request_json)?;
    let storage_root = build_storage_root_path(&request.storage_root);
    let managed_directory = build_managed_server_directory(
        &storage_root,
        &request.server.install_kind,
        &request.server.server_key,
    );
    ensure_directory(&managed_directory)?;

    let manifest_path = managed_directory.join("manifest.json");
    let launch_posix = build_posix_launch_script(&request.server);
    let launch_windows = build_windows_launch_script(&request.server);
    let payload = serde_json::json!({
        "serverKey": request.server.server_key,
        "serverId": request.server.id,
        "installKind": request.server.install_kind,
        "title": request.server.title,
        "templateId": request.server.template_id,
        "generatedAt": request.generated_at,
        "transport": request.server.transport,
        "runtime": {
            "command": request.server.command,
            "args": request.server.args,
            "cwd": request.server.cwd,
            "url": request.server.url
        },
        "environment": {
            "plainKeys": request.server.environment.iter().filter(|entry| entry.mode == "plain").map(|entry| entry.key.clone()).collect::<Vec<_>>(),
            "externalKeys": request.server.environment.iter().filter(|entry| entry.mode == "external").map(|entry| entry.external_key.clone().unwrap_or_default()).filter(|entry| !entry.is_empty()).collect::<Vec<_>>(),
            "secretKeys": request.server.environment.iter().filter(|entry| entry.mode == "secret").map(|entry| entry.key.clone()).collect::<Vec<_>>()
        },
        "launchers": {
            "posix": launch_posix.as_ref().map(|_| "launch.sh"),
            "windows": launch_windows.as_ref().map(|_| "launch.cmd")
        },
        "commandPreview": {
            "posix": request.server.command.as_ref().map(|command| build_posix_command_line(command, &request.server.args)),
            "windows": request.server.command.as_ref().map(|command| build_windows_command_line(command, &request.server.args))
        }
    });
    write_json_file(&manifest_path, &payload)?;

    if let Some(contents) = launch_posix.as_deref() {
        write_text_file(&managed_directory.join("launch.sh"), contents)?;
    }
    if let Some(contents) = launch_windows.as_deref() {
        write_text_file(&managed_directory.join("launch.cmd"), contents)?;
    }

    Ok(())
}

#[napi(js_name = "materializeMcpRuntimeEnvironmentJson")]
pub fn materialize_mcp_runtime_environment_json(request_json: String) -> Result<String> {
    let request: MaterializeRuntimeEnvironmentRequest = parse_json(&request_json)?;
    let environment = materialize_runtime_environment(request)?;
    to_json(&environment)
}

#[napi(js_name = "createMcpServerFromTemplateJson")]
pub fn create_mcp_server_from_template_json(request_json: String) -> Result<String> {
    let request: CreateMcpServerFromTemplateRequest = parse_json(&request_json)?;
    let server = create_server_from_template(request);
    to_json(&server)
}

#[napi(js_name = "readMcpRuntimeStatusesJson")]
pub fn read_mcp_runtime_statuses_json() -> Result<String> {
    let mut statuses = RUNTIME_STATUSES
        .lock()
        .map_err(|_| to_error("failed to read MCP runtime statuses"))?
        .values()
        .cloned()
        .collect::<Vec<_>>();
    statuses.sort_by(|left, right| left.server_id.cmp(&right.server_id));
    to_json(&statuses)
}

#[napi(js_name = "readMcpRuntimeIntrospectionJson")]
pub fn read_mcp_runtime_introspection_json(request_json: String) -> Result<String> {
    let request: ReadMcpRuntimeIntrospectionRequest = parse_json(&request_json)?;
    let snapshot = if let Ok(mut snapshots) = RUNTIME_INTROSPECTIONS.lock() {
        if let Some(snapshot) = snapshots.get(&request.server_id).cloned() {
            Some(snapshot)
        } else if let Some(fallback) = request.fallback_snapshot {
            snapshots.insert(request.server_id.clone(), fallback.clone());
            Some(fallback)
        } else {
            None
        }
    } else {
        request.fallback_snapshot
    };
    to_json(&snapshot)
}

#[napi(js_name = "startMcpRuntimeJson")]
pub fn start_mcp_runtime_json(request_json: String) -> Result<String> {
    let request: StartMcpRuntimeRequest = parse_json(&request_json)?;
    let result = start_runtime(request)?;
    to_json(&result)
}

#[napi(js_name = "stopMcpRuntimeJson")]
pub fn stop_mcp_runtime_json(request_json: String) -> Result<String> {
    let request: StopMcpRuntimeRequest = parse_json(&request_json)?;
    let result = stop_runtime_internal(request);
    to_json(&result)
}

#[napi(js_name = "restartMcpRuntimeJson")]
pub fn restart_mcp_runtime_json(request_json: String) -> Result<String> {
    let request: StartMcpRuntimeRequest = parse_json(&request_json)?;
    let result = start_runtime(request)?;
    to_json(&result)
}

#[napi(js_name = "shutdownMcpRuntime")]
pub fn shutdown_mcp_runtime() -> Result<()> {
    let server_ids = RUNTIME_PROCESSES
        .lock()
        .map_err(|_| to_error("failed to access MCP runtime processes"))?
        .keys()
        .cloned()
        .collect::<Vec<_>>();

    for server_id in server_ids {
        let transport = RUNTIME_STATUSES
            .lock()
            .ok()
            .and_then(|statuses| {
                statuses
                    .get(&server_id)
                    .map(|status| status.transport.clone())
            })
            .unwrap_or_else(|| "stdio".to_string());
        let _ = stop_runtime_internal(StopMcpRuntimeRequest {
            server_id,
            transport,
            reason: Some("Lyra is shutting down.".to_string()),
        });
    }

    if let Ok(mut statuses) = RUNTIME_STATUSES.lock() {
        statuses.clear();
    }
    if let Ok(mut snapshots) = RUNTIME_INTROSPECTIONS.lock() {
        snapshots.clear();
    }
    if let Ok(mut callback) = EVENT_CALLBACK.lock() {
        *callback = None;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::thread;
    use std::time::Duration;

    fn clear_runtime_globals() {
        if let Ok(mut statuses) = RUNTIME_STATUSES.lock() {
            statuses.clear();
        }
        if let Ok(mut introspections) = RUNTIME_INTROSPECTIONS.lock() {
            introspections.clear();
        }
        if let Ok(mut processes) = RUNTIME_PROCESSES.lock() {
            processes.clear();
        }
    }

    fn build_stdio_server(command: String, args: Vec<String>) -> PersistedMcpServerConfig {
        let now = now_iso();
        PersistedMcpServerConfig {
            id: "mcp-test-runtime".to_string(),
            server_key: "mcp-test-runtime".to_string(),
            source: "custom".to_string(),
            template_id: None,
            title: "MCP Test Runtime".to_string(),
            summary: "runtime smoke".to_string(),
            description: None,
            icon_key: "mcp".to_string(),
            scope: MCP_SCOPE_GLOBAL.to_string(),
            project_root: None,
            transport: "stdio".to_string(),
            install_kind: "manual".to_string(),
            command: Some(command),
            args,
            cwd: None,
            url: None,
            environment: Vec::new(),
            permissions: Vec::new(),
            enabled: true,
            auto_start: false,
            created_at: now.clone(),
            updated_at: now,
            last_error: None,
        }
    }

    #[test]
    fn trims_setup_values() {
        let mut values = HashMap::new();
        values.insert("rootPath".to_string(), "  /tmp/demo  ".to_string());
        values.insert("timezone".to_string(), "  Asia/Shanghai ".to_string());

        let normalized = normalize_setup_values(values);
        assert_eq!(
            normalized.get("rootPath"),
            Some(&"/tmp/demo".to_string())
        );
        assert_eq!(
            normalized.get("timezone"),
            Some(&"Asia/Shanghai".to_string())
        );
    }

    #[test]
    fn normalizes_server_key() {
        let key = create_server_key("  MCP Server: Filesystem  ");
        assert!(!key.is_empty());
        assert!(key.contains("filesystem"));
        assert!(key
            .chars()
            .all(|character| character.is_ascii_lowercase() || character.is_ascii_digit() || character == '-'));
    }

    #[test]
    fn runtime_start_status_stop_smoke_stdio() {
        clear_runtime_globals();

        #[cfg(windows)]
        let (command, args) = (
            "cmd".to_string(),
            vec![
                "/C".to_string(),
                "echo lyra-mcp-smoke".to_string(),
            ],
        );
        #[cfg(not(windows))]
        let (command, args) = (
            "sh".to_string(),
            vec!["-c".to_string(), "echo lyra-mcp-smoke".to_string()],
        );

        let server = build_stdio_server(command, args);
        let request = StartMcpRuntimeRequest {
            server: server.clone(),
            checked_at: now_iso(),
            secret_store: build_default_secret_store(),
            available_external_keys: Vec::new(),
            base_env: HashMap::new(),
            introspection_snapshot: None,
        };

        let result = start_runtime(request).expect("start runtime should succeed");
        assert_eq!(result.validation.ok, true);
        assert_eq!(result.status.server_id, server.id);
        assert!(result.status.phase == "running" || result.status.phase == "stopped");
        assert_eq!(result.status.transport, "stdio");

        thread::sleep(Duration::from_millis(80));
        let statuses = RUNTIME_STATUSES
            .lock()
            .expect("runtime statuses mutex poisoned");
        let running = statuses
            .get(&server.id)
            .expect("runtime status should be tracked");
        assert!(running.phase == "running" || running.phase == "stopped");
        drop(statuses);

        let stopped = stop_runtime_internal(StopMcpRuntimeRequest {
            server_id: server.id.clone(),
            transport: "stdio".to_string(),
            reason: Some("test cleanup".to_string()),
        });
        assert_eq!(stopped.phase, "stopped");

        let statuses = RUNTIME_STATUSES
            .lock()
            .expect("runtime statuses mutex poisoned");
        let current = statuses
            .get(&server.id)
            .expect("stopped runtime status should be tracked");
        assert_eq!(current.phase, "stopped");
        drop(statuses);

        let _ = shutdown_mcp_runtime();
    }
}
