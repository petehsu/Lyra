use std::collections::BTreeMap;
use std::fs;
use std::path::Path;
use std::path::PathBuf;
use std::time::Duration;

use lyra_models_manager::provider_model_entry_from_id;
use lyra_runtime_protocol::RuntimeError;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use url::Url;

const DEFAULT_DISCOVERY_TIMEOUT_MS: u64 = 10_000;
const DEFAULT_ANTHROPIC_VERSION: &str = "2023-06-01";
const MODEL_SECRETS_FILENAME: &str = "model-secrets.v1.json";
const LYRA_CONFIG_DIRNAME: &str = "lyra-config";

type StringMap = BTreeMap<String, String>;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AiValidateProfileRequest {
    id: Option<String>,
    name: Option<String>,
    provider_id: String,
    protocol_id: String,
    #[allow(dead_code)]
    preset_id: Option<String>,
    #[serde(default)]
    connection_config: StringMap,
    #[serde(default)]
    auth_config: StringMap,
    #[serde(default)]
    secret_values: BTreeMap<String, Value>,
    #[serde(default)]
    headers: StringMap,
    model: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AiDiscoverModelsRequest {
    id: Option<String>,
    provider_id: String,
    protocol_id: String,
    #[allow(dead_code)]
    preset_id: Option<String>,
    #[serde(default)]
    connection_config: StringMap,
    #[serde(default)]
    auth_config: StringMap,
    #[serde(default)]
    secret_values: BTreeMap<String, Value>,
    #[serde(default)]
    headers: StringMap,
    #[allow(dead_code)]
    force_refresh: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeleteSecretsRequest {
    base_url: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReadSecretsRequest {
    base_url: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WriteSecretsRequest {
    base_url: Option<String>,
    value: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AiProviderModelEntry {
    id: String,
    name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    context_window: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    supports_images: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    supports_tools: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    runtime_metadata: Option<AiModelRuntimeMetadata>,
    source: &'static str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AiModelRuntimeMetadata {
    #[serde(skip_serializing_if = "Option::is_none")]
    shell_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    apply_patch_tool_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    supports_search_tool: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    supports_parallel_tool_calls: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    supports_reasoning_summaries: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    support_verbosity: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    web_search_tool_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    supports_image_detail_original: Option<bool>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    input_modalities: Vec<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    supported_tools: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    context_window: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    max_context_window: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    effective_context_window_percent: Option<u64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AiModelDiscoveryResult {
    provider_id: String,
    protocol_id: String,
    status: &'static str,
    message: String,
    checked_at: i64,
    models: Vec<AiProviderModelEntry>,
    #[serde(skip_serializing_if = "Option::is_none")]
    code: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AiProfileValidationResult {
    ok: bool,
    message: String,
    checked_at: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    code: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SecretReadResult {
    configured: bool,
}

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ModelSecretsDocument {
    version: u8,
    #[serde(default)]
    secrets: BTreeMap<String, String>,
}

#[derive(Debug, Clone)]
struct ResolvedProfile {
    provider_id: String,
    protocol_id: String,
    connection_config: StringMap,
    auth_config: StringMap,
    headers: StringMap,
    model: String,
    base_url: String,
    secret_values: StringMap,
}

pub(crate) fn handles_method(method: &str) -> bool {
    matches!(
        method,
        "lyra/config/profiles/validate"
            | "lyra/config/models/discover"
            | "lyra/secrets.ai.read"
            | "lyra/secrets.ai.write"
            | "lyra/secrets.ai.delete"
    )
}

pub(crate) async fn handle_request(
    method: &str,
    payload: Value,
    storage_root: &Path,
) -> Result<Value, RuntimeError> {
    match method {
        "lyra/config/profiles/validate" => {
            let request: AiValidateProfileRequest = from_value(payload)?;
            to_value(&validate_profile(request, storage_root).await?)
        }
        "lyra/config/models/discover" => {
            let request: AiDiscoverModelsRequest = from_value(payload)?;
            to_value(&discover_models(request, storage_root).await?)
        }
        "lyra/secrets.ai.read" => {
            let request: ReadSecretsRequest = from_value(payload)?;
            let configured =
                read_secret_for_base_url(storage_root, request.base_url.as_deref())?.is_some();
            to_value(&SecretReadResult { configured })
        }
        "lyra/secrets.ai.write" => {
            let request: WriteSecretsRequest = from_value(payload)?;
            write_secret_for_base_url(
                storage_root,
                request.base_url.as_deref(),
                request.value.as_deref(),
            )?;
            Ok(Value::Null)
        }
        "lyra/secrets.ai.delete" => {
            let request: DeleteSecretsRequest = from_value(payload)?;
            delete_secret_for_base_url(storage_root, request.base_url.as_deref())?;
            Ok(Value::Null)
        }
        _ => Err(runtime_error(
            "METHOD_NOT_FOUND",
            format!("unsupported Lyra AI config method: {method}"),
        )),
    }
}

fn runtime_error(code: &str, message: impl Into<String>) -> RuntimeError {
    RuntimeError::new(code, message.into())
}

fn from_value<T>(value: Value) -> Result<T, RuntimeError>
where
    T: for<'de> Deserialize<'de>,
{
    serde_json::from_value(value)
        .map_err(|error| runtime_error("SERDE_DECODE_FAILED", error.to_string()))
}

fn to_value<T>(value: &T) -> Result<Value, RuntimeError>
where
    T: Serialize,
{
    serde_json::to_value(value)
        .map_err(|error| runtime_error("SERDE_ENCODE_FAILED", error.to_string()))
}

fn trim_string(value: &str) -> String {
    value.trim().to_string()
}

fn is_blank(value: Option<&String>) -> bool {
    match value {
        Some(value) => value.trim().is_empty(),
        None => true,
    }
}

fn encode_query_value(value: &str) -> String {
    url::form_urlencoded::byte_serialize(value.as_bytes()).collect()
}

fn normalize_string_map(map: StringMap) -> StringMap {
    map.into_iter()
        .filter_map(|(key, value)| {
            let next_key = trim_string(&key);
            let next_value = trim_string(&value);
            (!next_key.is_empty() && !next_value.is_empty()).then_some((next_key, next_value))
        })
        .collect()
}

fn normalize_secret_values(
    secret_values: BTreeMap<String, Value>,
) -> BTreeMap<String, Option<String>> {
    secret_values
        .into_iter()
        .filter_map(|(key, value)| {
            let next_key = trim_string(&key);
            if next_key.is_empty() {
                return None;
            }
            match value {
                Value::Null => Some((next_key, None)),
                Value::String(text) => Some((next_key, Some(trim_string(&text)))),
                _ => None,
            }
        })
        .collect()
}

fn canonical_base_url_account(base_url: &str) -> Option<String> {
    let trimmed = base_url.trim();
    if trimmed.is_empty() {
        return None;
    }

    if let Ok(url) = Url::parse(trimmed) {
        if let Some(host) = url.host_str() {
            let scheme = url.scheme().to_ascii_lowercase();
            let host = host.to_ascii_lowercase();
            let mut canonical = format!("{scheme}://{host}");
            if let Some(port) = url.port() {
                canonical.push(':');
                canonical.push_str(&port.to_string());
            }
            let path = url.path().trim_end_matches('/');
            if !path.is_empty() && path != "/" {
                canonical.push_str(path);
            }
            return Some(canonical);
        }
    }

    Some(trimmed.trim_end_matches('/').to_string())
}

fn lyra_home_from_storage_root(storage_root: &Path) -> PathBuf {
    let is_ai_module_root = storage_root
        .file_name()
        .and_then(|value| value.to_str())
        .is_some_and(|value| value == "ai")
        && storage_root
            .parent()
            .and_then(|value| value.file_name())
            .and_then(|value| value.to_str())
            .is_some_and(|value| value == "modules");
    if is_ai_module_root {
        return storage_root
            .parent()
            .and_then(|value| value.parent())
            .map(Path::to_path_buf)
            .unwrap_or_else(|| storage_root.to_path_buf());
    }
    storage_root.to_path_buf()
}

fn canonical_model_secrets_path(storage_root: &Path) -> PathBuf {
    lyra_home_from_storage_root(storage_root)
        .join(LYRA_CONFIG_DIRNAME)
        .join(MODEL_SECRETS_FILENAME)
}

fn read_model_secrets_document_from_path(
    path: &Path,
) -> Result<ModelSecretsDocument, RuntimeError> {
    if !path.exists() {
        return Ok(ModelSecretsDocument {
            version: 1,
            secrets: BTreeMap::new(),
        });
    }
    let content = fs::read_to_string(&path)
        .map_err(|error| runtime_error("AI_SECRET_STORAGE_FAILED", error.to_string()))?;
    serde_json::from_str::<ModelSecretsDocument>(&content)
        .map_err(|error| runtime_error("AI_SECRET_STORAGE_FAILED", error.to_string()))
}

#[cfg(unix)]
fn restrict_secret_file_permissions(path: &Path) -> Result<(), RuntimeError> {
    use std::os::unix::fs::PermissionsExt;
    let permissions = fs::Permissions::from_mode(0o600);
    fs::set_permissions(path, permissions)
        .map_err(|error| runtime_error("AI_SECRET_STORAGE_FAILED", error.to_string()))
}

#[cfg(not(unix))]
fn restrict_secret_file_permissions(_path: &Path) -> Result<(), RuntimeError> {
    Ok(())
}

fn write_model_secrets_document(
    storage_root: &Path,
    document: &ModelSecretsDocument,
) -> Result<(), RuntimeError> {
    let path = canonical_model_secrets_path(storage_root);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| runtime_error("AI_SECRET_STORAGE_FAILED", error.to_string()))?;
    }
    let content = serde_json::to_string_pretty(document)
        .map_err(|error| runtime_error("AI_SECRET_STORAGE_FAILED", error.to_string()))?;
    fs::write(&path, content)
        .map_err(|error| runtime_error("AI_SECRET_STORAGE_FAILED", error.to_string()))?;
    restrict_secret_file_permissions(&path)?;
    Ok(())
}

fn read_secret_for_base_url(
    storage_root: &Path,
    base_url: Option<&str>,
) -> Result<Option<String>, RuntimeError> {
    let Some(base_url) = base_url.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };
    let account = canonical_base_url_account(base_url)
        .ok_or_else(|| runtime_error("AI_SECRET_STORAGE_FAILED", "baseUrl is required"))?;
    let document =
        read_model_secrets_document_from_path(&canonical_model_secrets_path(storage_root))?;

    Ok(document
        .secrets
        .get(&account)
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty()))
}

fn write_secret_for_base_url(
    storage_root: &Path,
    base_url: Option<&str>,
    value: Option<&str>,
) -> Result<(), RuntimeError> {
    let base_url = base_url
        .map(str::trim)
        .filter(|entry| !entry.is_empty())
        .ok_or_else(|| runtime_error("AI_SECRET_STORAGE_FAILED", "baseUrl is required"))?;

    let value = value.map(str::trim).unwrap_or_default();
    if value.is_empty() {
        return delete_secret_for_base_url(storage_root, Some(base_url));
    }

    let account = canonical_base_url_account(base_url)
        .ok_or_else(|| runtime_error("AI_SECRET_STORAGE_FAILED", "baseUrl is required"))?;
    let mut document =
        read_model_secrets_document_from_path(&canonical_model_secrets_path(storage_root))?;
    document.version = 1;
    document.secrets.insert(account, value.to_string());
    write_model_secrets_document(storage_root, &document)
}

fn delete_secret_for_base_url(
    storage_root: &Path,
    base_url: Option<&str>,
) -> Result<(), RuntimeError> {
    let Some(base_url) = base_url.map(str::trim).filter(|entry| !entry.is_empty()) else {
        return Ok(());
    };

    let account = canonical_base_url_account(base_url)
        .ok_or_else(|| runtime_error("AI_SECRET_STORAGE_FAILED", "baseUrl is required"))?;
    let mut document =
        read_model_secrets_document_from_path(&canonical_model_secrets_path(storage_root))?;
    document.secrets.remove(&account);
    write_model_secrets_document(storage_root, &document)
}

fn provider_env_key(provider_id: &str, protocol_id: &str) -> Option<&'static str> {
    match provider_id.trim() {
        "openai" => Some("OPENAI_API_KEY"),
        "azure_openai" => Some("AZURE_OPENAI_API_KEY"),
        "openrouter" => Some("OPENROUTER_API_KEY"),
        "anthropic" => Some("ANTHROPIC_API_KEY"),
        "google_ai" => Some("GEMINI_API_KEY"),
        "deepseek" => Some("DEEPSEEK_API_KEY"),
        "xai" => Some("XAI_API_KEY"),
        "mistral" => Some("MISTRAL_API_KEY"),
        "groq" => Some("GROQ_API_KEY"),
        "together" => Some("TOGETHER_API_KEY"),
        "fireworks" => Some("FIREWORKS_API_KEY"),
        "vercel_ai_gateway" => Some("VERCEL_AI_GATEWAY_API_KEY"),
        "mimo" => Some("MIMO_API_KEY"),
        "custom_openai_compatible" => Some("CUSTOM_OPENAI_API_KEY"),
        _ => match protocol_id.trim() {
            "mimo_openai_chat_completions" | "mimo_anthropic_messages" => Some("MIMO_API_KEY"),
            "anthropic_messages" => Some("ANTHROPIC_API_KEY"),
            "gemini_generate_content" => Some("GEMINI_API_KEY"),
            "azure_openai_chat_completions" => Some("AZURE_OPENAI_API_KEY"),
            "openai_chat_completions"
            | "openrouter_chat_completions"
            | "deepseek_chat_completions"
            | "xai_chat_completions"
            | "mistral_chat_completions"
            | "groq_chat_completions"
            | "together_chat_completions"
            | "fireworks_chat_completions"
            | "vercel_ai_gateway_chat_completions"
            | "custom_chat_completions" => Some("OPENAI_API_KEY"),
            _ => None,
        },
    }
}

fn resolve_api_key(
    storage_root: &Path,
    provider_id: &str,
    protocol_id: &str,
    base_url: &str,
    explicit: Option<String>,
) -> Result<Option<String>, RuntimeError> {
    if let Some(explicit) = explicit {
        let trimmed = explicit.trim().to_string();
        if !trimmed.is_empty() {
            return Ok(Some(trimmed));
        }
    }

    if let Some(env_key) = provider_env_key(provider_id, protocol_id) {
        if let Ok(value) = std::env::var(env_key) {
            let trimmed = value.trim().to_string();
            if !trimmed.is_empty() {
                return Ok(Some(trimmed));
            }
        }
    }

    read_secret_for_base_url(storage_root, Some(base_url))
}

fn protocol_requires_api_key(protocol_id: &str) -> bool {
    matches!(
        protocol_id,
        "openai_chat_completions"
            | "azure_openai_chat_completions"
            | "openrouter_chat_completions"
            | "deepseek_chat_completions"
            | "xai_chat_completions"
            | "mistral_chat_completions"
            | "groq_chat_completions"
            | "together_chat_completions"
            | "fireworks_chat_completions"
            | "vercel_ai_gateway_chat_completions"
            | "mimo_openai_chat_completions"
            | "mimo_anthropic_messages"
            | "custom_chat_completions"
            | "anthropic_messages"
            | "gemini_generate_content"
    )
}

fn discovery_base_url(
    protocol_id: &str,
    provider_id: &str,
    connection_config: &StringMap,
) -> String {
    let configured_base_url = connection_config
        .get("baseUrl")
        .or_else(|| connection_config.get("endpointOverride"))
        .map(|value| trim_string(value))
        .filter(|value| !value.is_empty());
    if let Some(base_url) = configured_base_url {
        return base_url.trim_end_matches('/').to_string();
    }

    match protocol_id {
        "openai_chat_completions" => "https://api.openai.com/v1".to_string(),
        "openrouter_chat_completions" => "https://openrouter.ai/api/v1".to_string(),
        "deepseek_chat_completions" => "https://api.deepseek.com/v1".to_string(),
        "xai_chat_completions" => "https://api.x.ai/v1".to_string(),
        "mistral_chat_completions" => "https://api.mistral.ai/v1".to_string(),
        "groq_chat_completions" => "https://api.groq.com/openai/v1".to_string(),
        "together_chat_completions" => "https://api.together.xyz/v1".to_string(),
        "fireworks_chat_completions" => "https://api.fireworks.ai/inference/v1".to_string(),
        "vercel_ai_gateway_chat_completions" => "https://ai-gateway.vercel.sh/v1".to_string(),
        "mimo_openai_chat_completions" => "https://api.xiaomimimo.com/v1".to_string(),
        "mimo_anthropic_messages" => "https://api.xiaomimimo.com/anthropic".to_string(),
        "anthropic_messages" => "https://api.anthropic.com".to_string(),
        "gemini_generate_content" => "https://generativelanguage.googleapis.com".to_string(),
        "ollama_chat" => "http://127.0.0.1:11434".to_string(),
        "lmstudio_chat_completions" => "http://127.0.0.1:1234/v1".to_string(),
        "custom_chat_completions" if provider_id == "lmstudio" => {
            "http://127.0.0.1:1234/v1".to_string()
        }
        _ => String::new(),
    }
}

async fn resolve_request_context(
    storage_root: &Path,
    _request_id: Option<String>,
    provider_id: String,
    protocol_id: String,
    connection_config: StringMap,
    auth_config: StringMap,
    headers: StringMap,
    model: String,
    secret_values: BTreeMap<String, Value>,
) -> Result<ResolvedProfile, RuntimeError> {
    let provider_id = trim_string(&provider_id);
    let protocol_id = trim_string(&protocol_id);
    let connection_config = normalize_string_map(connection_config);
    let auth_config = normalize_string_map(auth_config);
    let headers = normalize_string_map(headers);
    let model = trim_string(&model);
    let base_url = discovery_base_url(&protocol_id, &provider_id, &connection_config);

    let mut resolved_secrets: StringMap = normalize_secret_values(secret_values)
        .into_iter()
        .filter_map(|(field_id, value)| {
            let value = value.unwrap_or_default();
            let value = trim_string(&value);
            (!value.is_empty()).then_some((field_id, value))
        })
        .collect();

    let explicit_api_key = resolved_secrets.remove("apiKey");
    if let Some(api_key) = resolve_api_key(
        storage_root,
        &provider_id,
        &protocol_id,
        &base_url,
        explicit_api_key,
    )? {
        resolved_secrets.insert("apiKey".to_string(), api_key);
    }

    Ok(ResolvedProfile {
        provider_id,
        protocol_id,
        connection_config,
        auth_config,
        headers,
        model,
        base_url,
        secret_values: resolved_secrets,
    })
}

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

fn validation_result(
    ok: bool,
    message: impl Into<String>,
    code: Option<&str>,
) -> AiProfileValidationResult {
    AiProfileValidationResult {
        ok,
        message: message.into(),
        checked_at: now_ms(),
        code: code.map(str::to_string),
    }
}

fn discovery_result(
    context: &ResolvedProfile,
    status: &'static str,
    message: impl Into<String>,
    models: Vec<AiProviderModelEntry>,
    code: Option<&str>,
) -> AiModelDiscoveryResult {
    AiModelDiscoveryResult {
        provider_id: context.provider_id.clone(),
        protocol_id: context.protocol_id.clone(),
        status,
        message: message.into(),
        checked_at: now_ms(),
        models,
        code: code.map(str::to_string),
    }
}

fn parse_openai_like_models(payload: Value) -> Vec<AiProviderModelEntry> {
    payload
        .get("data")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|entry| {
            let id = entry
                .get("id")
                .or_else(|| entry.get("model"))
                .and_then(Value::as_str)
                .map(trim_string)
                .filter(|value| !value.is_empty())?;
            Some(normalized_discovered_model_entry("", "", &id, "dynamic"))
        })
        .collect()
}

fn parse_anthropic_models(payload: Value) -> Vec<AiProviderModelEntry> {
    payload
        .get("data")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|entry| {
            let id = entry
                .get("id")
                .or_else(|| entry.get("name"))
                .and_then(Value::as_str)
                .map(trim_string)
                .filter(|value| !value.is_empty())?;
            Some(normalized_discovered_model_entry("", "", &id, "dynamic"))
        })
        .collect()
}

fn parse_gemini_models(payload: Value) -> Vec<AiProviderModelEntry> {
    payload
        .get("models")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|entry| {
            let raw_id = entry
                .get("baseModelId")
                .or_else(|| entry.get("name"))
                .and_then(Value::as_str)
                .map(trim_string)
                .filter(|value| !value.is_empty())?;
            let id = raw_id.trim_start_matches("models/").to_string();
            Some(normalized_discovered_model_entry("", "", &id, "dynamic"))
        })
        .collect()
}

fn parse_ollama_models(payload: Value) -> Vec<AiProviderModelEntry> {
    payload
        .get("models")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|entry| {
            let id = entry
                .get("name")
                .and_then(Value::as_str)
                .map(trim_string)
                .filter(|value| !value.is_empty())?;
            Some(normalized_discovered_model_entry("", "", &id, "dynamic"))
        })
        .collect()
}

fn normalized_discovered_model_entry(
    provider_id: &str,
    protocol_id: &str,
    model_id: &str,
    source: &'static str,
) -> AiProviderModelEntry {
    let entry = provider_model_entry_from_id(provider_id, protocol_id, model_id, source);
    AiProviderModelEntry {
        id: entry.id,
        name: entry.name,
        description: entry.description,
        context_window: entry.context_window,
        supports_images: entry.supports_images,
        supports_tools: entry.supports_tools,
        runtime_metadata: entry
            .runtime_metadata
            .map(|metadata| AiModelRuntimeMetadata {
                shell_type: metadata.shell_type,
                apply_patch_tool_type: metadata.apply_patch_tool_type,
                supports_search_tool: metadata.supports_search_tool,
                supports_parallel_tool_calls: metadata.supports_parallel_tool_calls,
                supports_reasoning_summaries: metadata.supports_reasoning_summaries,
                support_verbosity: metadata.support_verbosity,
                web_search_tool_type: metadata.web_search_tool_type,
                supports_image_detail_original: metadata.supports_image_detail_original,
                input_modalities: metadata.input_modalities,
                supported_tools: metadata.supported_tools,
                context_window: metadata.context_window,
                max_context_window: metadata.max_context_window,
                effective_context_window_percent: metadata.effective_context_window_percent,
            }),
        source,
    }
}

fn build_headers(headers: &StringMap) -> Result<HeaderMap, RuntimeError> {
    let mut header_map = HeaderMap::new();
    for (key, value) in headers {
        let name = HeaderName::from_bytes(key.as_bytes())
            .map_err(|error| runtime_error("AI_CONFIG_HEADER_INVALID", error.to_string()))?;
        let value = HeaderValue::from_str(value)
            .map_err(|error| runtime_error("AI_CONFIG_HEADER_INVALID", error.to_string()))?;
        header_map.insert(name, value);
    }
    Ok(header_map)
}

fn uses_mimo_api_key_header(context: &ResolvedProfile) -> bool {
    context.provider_id == "mimo"
        || matches!(
            context.protocol_id.as_str(),
            "mimo_openai_chat_completions" | "mimo_anthropic_messages"
        )
        || context.base_url.contains("xiaomimimo.com")
}

fn insert_api_key_header(
    headers: &mut HeaderMap,
    header_name: &'static str,
    api_key: &str,
) -> Result<(), RuntimeError> {
    headers.insert(
        HeaderName::from_static(header_name),
        HeaderValue::from_str(api_key)
            .map_err(|error| runtime_error("AI_CONFIG_HEADER_INVALID", error.to_string()))?,
    );
    Ok(())
}

async fn fetch_json(
    url: &str,
    method: reqwest::Method,
    headers: HeaderMap,
) -> Result<Value, RuntimeError> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_millis(DEFAULT_DISCOVERY_TIMEOUT_MS))
        .build()
        .map_err(|error| runtime_error("AI_MODEL_DISCOVERY_FAILED", error.to_string()))?;
    let response = client
        .request(method, url)
        .headers(headers)
        .send()
        .await
        .map_err(|error| runtime_error("AI_MODEL_DISCOVERY_FAILED", error.to_string()))?;
    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_else(|_| String::new());
        return Err(runtime_error(
            "AI_MODEL_DISCOVERY_FAILED",
            format!("{status}: {body}"),
        ));
    }
    response
        .json::<Value>()
        .await
        .map_err(|error| runtime_error("AI_MODEL_DISCOVERY_FAILED", error.to_string()))
}

async fn validate_profile(
    request: AiValidateProfileRequest,
    storage_root: &Path,
) -> Result<AiProfileValidationResult, RuntimeError> {
    let AiValidateProfileRequest {
        id,
        name,
        provider_id,
        protocol_id,
        preset_id: _,
        connection_config,
        auth_config,
        secret_values,
        headers,
        model,
    } = request;
    let context = resolve_request_context(
        storage_root,
        id,
        provider_id,
        protocol_id,
        connection_config,
        auth_config,
        headers,
        model,
        secret_values,
    )
    .await?;

    if name
        .map(|value| trim_string(&value))
        .unwrap_or_default()
        .is_empty()
    {
        return Ok(validation_result(
            false,
            "Profile name is required",
            Some("AI_CONFIG_NAME_REQUIRED"),
        ));
    }
    if context.provider_id.is_empty() {
        return Ok(validation_result(
            false,
            "providerId is required",
            Some("AI_CONFIG_PROVIDER_REQUIRED"),
        ));
    }
    if context.protocol_id.is_empty() {
        return Ok(validation_result(
            false,
            "protocolId is required",
            Some("AI_CONFIG_PROTOCOL_REQUIRED"),
        ));
    }
    if context.model.is_empty() {
        return Ok(validation_result(
            false,
            "model is required",
            Some("AI_CONFIG_MODEL_REQUIRED"),
        ));
    }
    if protocol_requires_api_key(&context.protocol_id)
        && is_blank(context.secret_values.get("apiKey"))
    {
        return Ok(validation_result(
            false,
            "apiKey is required for this protocol",
            Some("AI_CONFIG_SECRET_REQUIRED"),
        ));
    }

    Ok(validation_result(true, "Profile is valid", None))
}

async fn discover_models(
    request: AiDiscoverModelsRequest,
    storage_root: &Path,
) -> Result<AiModelDiscoveryResult, RuntimeError> {
    let context = resolve_request_context(
        storage_root,
        request.id,
        request.provider_id,
        request.protocol_id,
        request.connection_config,
        request.auth_config,
        request.headers,
        String::new(),
        request.secret_values,
    )
    .await?;

    let result = match context.protocol_id.as_str() {
        "openai_chat_completions"
        | "openrouter_chat_completions"
        | "deepseek_chat_completions"
        | "xai_chat_completions"
        | "mistral_chat_completions"
        | "groq_chat_completions"
        | "together_chat_completions"
        | "fireworks_chat_completions"
        | "vercel_ai_gateway_chat_completions"
        | "mimo_openai_chat_completions"
        | "custom_chat_completions"
        | "lmstudio_chat_completions" => discover_openai_like_models(&context).await,
        "azure_openai_chat_completions" => discover_azure_models(&context).await,
        "anthropic_messages" | "mimo_anthropic_messages" => {
            discover_anthropic_models(&context).await
        }
        "gemini_generate_content" => discover_gemini_models(&context).await,
        "ollama_chat" => discover_ollama_models(&context).await,
        _ => Ok(discovery_result(
            &context,
            "error",
            format!(
                "Model discovery is not implemented for {}",
                context.protocol_id
            ),
            Vec::new(),
            Some("AI_MODEL_DISCOVERY_UNSUPPORTED"),
        )),
    };

    result.or_else(|error| {
        Ok(discovery_result(
            &context,
            "error",
            error.message,
            Vec::new(),
            Some("AI_MODEL_DISCOVERY_FAILED"),
        ))
    })
}

async fn discover_openai_like_models(
    context: &ResolvedProfile,
) -> Result<AiModelDiscoveryResult, RuntimeError> {
    let base_url = context.base_url.trim();
    if base_url.is_empty() {
        return Ok(discovery_result(
            context,
            "error",
            "baseUrl is required for model discovery",
            Vec::new(),
            Some("AI_MODEL_DISCOVERY_BASE_URL_REQUIRED"),
        ));
    }
    let mut headers = build_headers(&context.headers)?;
    if let Some(api_key) = context.secret_values.get("apiKey") {
        if !api_key.is_empty() {
            if uses_mimo_api_key_header(context) {
                insert_api_key_header(&mut headers, "api-key", api_key)?;
            } else {
                headers.insert(
                    reqwest::header::AUTHORIZATION,
                    HeaderValue::from_str(&format!("Bearer {api_key}")).map_err(|error| {
                        runtime_error("AI_CONFIG_HEADER_INVALID", error.to_string())
                    })?,
                );
            }
        }
    }
    let models: Vec<AiProviderModelEntry> = parse_openai_like_models(
        fetch_json(&format!("{base_url}/models"), reqwest::Method::GET, headers).await?,
    )
    .into_iter()
    .map(|entry| {
        normalized_discovered_model_entry(
            context.provider_id.as_str(),
            context.protocol_id.as_str(),
            entry.id.as_str(),
            "dynamic",
        )
    })
    .collect();
    let message = if models.is_empty() {
        "No models were returned by the provider"
    } else {
        "Models discovered"
    };
    Ok(discovery_result(context, "ready", message, models, None))
}

async fn discover_azure_models(
    context: &ResolvedProfile,
) -> Result<AiModelDiscoveryResult, RuntimeError> {
    let base_url = context.base_url.trim();
    if base_url.is_empty() {
        return Ok(discovery_result(
            context,
            "error",
            "Azure endpoint is required for model discovery",
            Vec::new(),
            Some("AI_MODEL_DISCOVERY_BASE_URL_REQUIRED"),
        ));
    }
    let api_key = context
        .secret_values
        .get("apiKey")
        .cloned()
        .unwrap_or_default();
    if api_key.is_empty() {
        return Ok(discovery_result(
            context,
            "error",
            "apiKey is required for Azure model discovery",
            Vec::new(),
            Some("AI_CONFIG_SECRET_REQUIRED"),
        ));
    }
    let api_version = context
        .connection_config
        .get("apiVersion")
        .map(|value| trim_string(value))
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "2024-10-21".to_string());
    let mut headers = build_headers(&context.headers)?;
    headers.insert(
        HeaderName::from_static("api-key"),
        HeaderValue::from_str(&api_key)
            .map_err(|error| runtime_error("AI_CONFIG_HEADER_INVALID", error.to_string()))?,
    );
    let models: Vec<AiProviderModelEntry> = parse_openai_like_models(
        fetch_json(
            &format!(
                "{}/openai/models?api-version={}",
                base_url.trim_end_matches('/'),
                encode_query_value(&api_version)
            ),
            reqwest::Method::GET,
            headers,
        )
        .await?,
    )
    .into_iter()
    .map(|entry| {
        normalized_discovered_model_entry(
            context.provider_id.as_str(),
            context.protocol_id.as_str(),
            entry.id.as_str(),
            "dynamic",
        )
    })
    .collect();
    let message = if models.is_empty() {
        "No models were returned by Azure OpenAI"
    } else {
        "Models discovered"
    };
    Ok(discovery_result(context, "ready", message, models, None))
}

async fn discover_anthropic_models(
    context: &ResolvedProfile,
) -> Result<AiModelDiscoveryResult, RuntimeError> {
    let api_key = context
        .secret_values
        .get("apiKey")
        .cloned()
        .unwrap_or_default();
    if api_key.is_empty() {
        return Ok(discovery_result(
            context,
            "error",
            "apiKey is required for Anthropic model discovery",
            Vec::new(),
            Some("AI_CONFIG_SECRET_REQUIRED"),
        ));
    }
    let mut headers = build_headers(&context.headers)?;
    if uses_mimo_api_key_header(context) {
        insert_api_key_header(&mut headers, "api-key", &api_key)?;
    } else {
        insert_api_key_header(&mut headers, "x-api-key", &api_key)?;
        let anthropic_version = context
            .auth_config
            .get("anthropicVersion")
            .map(|value| trim_string(value))
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| DEFAULT_ANTHROPIC_VERSION.to_string());
        headers.insert(
            HeaderName::from_static("anthropic-version"),
            HeaderValue::from_str(&anthropic_version)
                .map_err(|error| runtime_error("AI_CONFIG_HEADER_INVALID", error.to_string()))?,
        );
    }
    let base_url = context.base_url.trim_end_matches('/');
    let models: Vec<AiProviderModelEntry> = parse_anthropic_models(
        fetch_json(
            &format!("{base_url}/v1/models"),
            reqwest::Method::GET,
            headers,
        )
        .await?,
    )
    .into_iter()
    .map(|entry| {
        normalized_discovered_model_entry(
            context.provider_id.as_str(),
            context.protocol_id.as_str(),
            entry.id.as_str(),
            "dynamic",
        )
    })
    .collect();
    let message = if models.is_empty() {
        "No models were returned by Anthropic"
    } else {
        "Models discovered"
    };
    Ok(discovery_result(context, "ready", message, models, None))
}

async fn discover_gemini_models(
    context: &ResolvedProfile,
) -> Result<AiModelDiscoveryResult, RuntimeError> {
    let api_key = context
        .secret_values
        .get("apiKey")
        .cloned()
        .unwrap_or_default();
    if api_key.is_empty() {
        return Ok(discovery_result(
            context,
            "error",
            "apiKey is required for Gemini model discovery",
            Vec::new(),
            Some("AI_CONFIG_SECRET_REQUIRED"),
        ));
    }
    let base_url = context.base_url.trim_end_matches('/');
    let models: Vec<AiProviderModelEntry> = parse_gemini_models(
        fetch_json(
            &format!(
                "{base_url}/v1beta/models?key={}",
                encode_query_value(&api_key)
            ),
            reqwest::Method::GET,
            build_headers(&context.headers)?,
        )
        .await?,
    )
    .into_iter()
    .map(|entry| {
        normalized_discovered_model_entry(
            context.provider_id.as_str(),
            context.protocol_id.as_str(),
            entry.id.as_str(),
            "dynamic",
        )
    })
    .collect();
    let message = if models.is_empty() {
        "No models were returned by Gemini"
    } else {
        "Models discovered"
    };
    Ok(discovery_result(context, "ready", message, models, None))
}

async fn discover_ollama_models(
    context: &ResolvedProfile,
) -> Result<AiModelDiscoveryResult, RuntimeError> {
    let base_url = context.base_url.trim_end_matches('/');
    let models: Vec<AiProviderModelEntry> = parse_ollama_models(
        fetch_json(
            &format!("{base_url}/api/tags"),
            reqwest::Method::GET,
            build_headers(&context.headers)?,
        )
        .await?,
    )
    .into_iter()
    .map(|entry| {
        normalized_discovered_model_entry(
            context.provider_id.as_str(),
            context.protocol_id.as_str(),
            entry.id.as_str(),
            "dynamic",
        )
    })
    .collect();
    let message = if models.is_empty() {
        "No models were returned by Ollama"
    } else {
        "Models discovered"
    };
    Ok(discovery_result(context, "ready", message, models, None))
}
