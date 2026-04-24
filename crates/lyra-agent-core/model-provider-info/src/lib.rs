//! Registry of model providers supported by Lyra.
//!
//! Providers can be defined in two places:
//!   1. Built-in defaults compiled into the binary so Lyra works out-of-the-box.
//!   2. User-defined entries inside `~/.lyra/config.toml` under the `model_providers`
//!      key. These override or extend the defaults at runtime.

use http::HeaderMap;
use http::header::HeaderName;
use http::header::HeaderValue;
use lyra_api::Provider as ApiProvider;
use lyra_api::RetryConfig as ApiRetryConfig;
use lyra_api::is_azure_responses_provider;
use lyra_app_server_protocol::AuthMode;
use lyra_protocol::config_types::ModelProviderAuthInfo;
use lyra_protocol::error::EnvVarError;
use lyra_protocol::error::LyraErr;
use lyra_protocol::error::Result as LyraResult;
use schemars::JsonSchema;
use serde::Deserialize;
use serde::Serialize;
use serde_json;
use std::collections::HashMap;
use std::env;
use std::fmt;
use std::fs;
use std::path::PathBuf;
use std::time::Duration;
use url::Url;

const DEFAULT_STREAM_IDLE_TIMEOUT_MS: u64 = 300_000;
const DEFAULT_STREAM_MAX_RETRIES: u64 = 5;
const DEFAULT_REQUEST_MAX_RETRIES: u64 = 4;
const MODEL_SECRETS_PATH_COMPONENTS: [&str; 2] = ["lyra-config", "model-secrets.v1.json"];
pub const DEFAULT_WEBSOCKET_CONNECT_TIMEOUT_MS: u64 = 15_000;
/// Hard cap for user-configured `stream_max_retries`.
const MAX_STREAM_MAX_RETRIES: u64 = 100;
/// Hard cap for user-configured `request_max_retries`.
const MAX_REQUEST_MAX_RETRIES: u64 = 100;

const OPENAI_PROVIDER_NAME: &str = "OpenAI";
pub const OPENAI_PROVIDER_ID: &str = "openai";
const CHAT_WIRE_API_REMOVED_ERROR: &str = "`wire_api = \"chat\"` is no longer supported.\nHow to fix: set `wire_api = \"responses\"` in your provider config.";
pub const LEGACY_OLLAMA_CHAT_PROVIDER_ID: &str = "ollama-chat";
pub const OLLAMA_CHAT_PROVIDER_REMOVED_ERROR: &str = "`ollama-chat` is no longer supported.\nHow to fix: replace `ollama-chat` with `ollama` in `model_provider`, `oss_provider`, or `--local-provider`.";

/// Wire protocol that the provider speaks.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum WireApi {
    /// The Responses API exposed at `/v1/responses`.
    #[default]
    Responses,
    /// OpenAI-compatible Chat Completions API at `/v1/chat/completions`.
    ChatCompletions,
    /// Anthropic Messages API at `/v1/messages`.
    AnthropicMessages,
    /// Gemini generateContent API.
    GeminiGenerateContent,
}

impl fmt::Display for WireApi {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let value = match self {
            Self::Responses => "responses",
            Self::ChatCompletions => "chat_completions",
            Self::AnthropicMessages => "anthropic_messages",
            Self::GeminiGenerateContent => "gemini_generate_content",
        };
        f.write_str(value)
    }
}

impl<'de> Deserialize<'de> for WireApi {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        match value.as_str() {
            "responses" => Ok(Self::Responses),
            "chat_completions" => Ok(Self::ChatCompletions),
            "anthropic_messages" => Ok(Self::AnthropicMessages),
            "gemini_generate_content" => Ok(Self::GeminiGenerateContent),
            "chat" => Err(serde::de::Error::custom(CHAT_WIRE_API_REMOVED_ERROR)),
            _ => Err(serde::de::Error::unknown_variant(
                &value,
                &["responses", "anthropic_messages", "gemini_generate_content"],
            )),
        }
    }
}

/// Serializable representation of a provider definition.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, JsonSchema)]
#[schemars(deny_unknown_fields)]
pub struct ModelProviderInfo {
    /// Friendly display name.
    pub name: String,
    /// Base URL for the provider's Responses-compatible API.
    pub base_url: Option<String>,
    /// Environment variable that stores the user's API key for this provider.
    pub env_key: Option<String>,

    /// Optional instructions to help the user get a valid value for the
    /// variable and set it.
    pub env_key_instructions: Option<String>,
    /// Value to use with `Authorization: Bearer <token>` header. Use of this
    /// config is discouraged in favor of `env_key` for security reasons, but
    /// this may be necessary when using this programmatically.
    pub experimental_bearer_token: Option<String>,
    /// Command-backed bearer-token configuration for this provider.
    pub auth: Option<ModelProviderAuthInfo>,
    /// Which wire protocol this provider expects.
    #[serde(default)]
    pub wire_api: WireApi,
    /// Optional query parameters to append to the base URL.
    pub query_params: Option<HashMap<String, String>>,
    /// Additional HTTP headers to include in requests to this provider where
    /// the (key, value) pairs are the header name and value.
    pub http_headers: Option<HashMap<String, String>>,
    /// Optional HTTP headers to include in requests to this provider where the
    /// (key, value) pairs are the header name and _environment variable_ whose
    /// value should be used. If the environment variable is not set, or the
    /// value is empty, the header will not be included in the request.
    pub env_http_headers: Option<HashMap<String, String>>,
    /// Maximum number of times to retry a failed HTTP request to this provider.
    pub request_max_retries: Option<u64>,
    /// Number of times to retry reconnecting a dropped streaming response before failing.
    pub stream_max_retries: Option<u64>,
    /// Idle timeout (in milliseconds) to wait for activity on a streaming response before treating
    /// the connection as lost.
    pub stream_idle_timeout_ms: Option<u64>,
    /// Maximum time (in milliseconds) to wait for a websocket connection attempt before treating
    /// it as failed.
    pub websocket_connect_timeout_ms: Option<u64>,
    /// Does this provider require managed session credentials? If true, the
    /// runtime uses the interactive credential store in `auth.json` instead of
    /// `env_key` or command-backed auth.
    #[serde(default)]
    pub requires_managed_auth: bool,
    /// Whether this provider supports the Responses API WebSocket transport.
    #[serde(default)]
    pub supports_websockets: bool,
}

fn canonical_base_url_account(base_url: &str) -> Option<String> {
    let trimmed = base_url.trim();
    if trimmed.is_empty() {
        return None;
    }

    if let Ok(url) = Url::parse(trimmed)
        && let Some(host) = url.host_str()
    {
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

    Some(trimmed.trim_end_matches('/').to_string())
}

#[derive(Debug, Default, Deserialize)]
struct ModelSecretsDocument {
    #[serde(default)]
    secrets: HashMap<String, String>,
}

fn lyra_home_from_env() -> Option<PathBuf> {
    if let Ok(value) = env::var("LYRA_HOME")
        && !value.trim().is_empty()
    {
        return Some(PathBuf::from(value.trim()));
    }
    env::var("HOME")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .map(|value| PathBuf::from(value.trim()).join(".lyra"))
}

fn canonical_model_secrets_path() -> Option<PathBuf> {
    let mut path = lyra_home_from_env()?;
    for component in MODEL_SECRETS_PATH_COMPONENTS {
        path.push(component);
    }
    Some(path)
}

fn read_local_secret(base_url: Option<&str>) -> Option<String> {
    let account = canonical_base_url_account(base_url?)?;
    let path = canonical_model_secrets_path()?;
    let document = fs::read_to_string(path)
        .ok()
        .and_then(|content| serde_json::from_str::<ModelSecretsDocument>(&content).ok())?;
    document
        .secrets
        .get(&account)
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn resolve_env_or_local_secret(env_var: &str, base_url: Option<&str>) -> Option<String> {
    if let Ok(value) = std::env::var(env_var)
        && !value.trim().is_empty()
    {
        return Some(value.trim().to_string());
    }
    read_local_secret(base_url)
}

impl ModelProviderInfo {
    pub fn validate(&self) -> std::result::Result<(), String> {
        let Some(auth) = self.auth.as_ref() else {
            return Ok(());
        };

        if auth.command.trim().is_empty() {
            return Err("provider auth.command must not be empty".to_string());
        }

        let mut conflicts = Vec::new();
        if self.env_key.is_some() {
            conflicts.push("env_key");
        }
        if self.experimental_bearer_token.is_some() {
            conflicts.push("experimental_bearer_token");
        }
        if self.requires_managed_auth {
            conflicts.push("requires_managed_auth");
        }

        if conflicts.is_empty() {
            Ok(())
        } else {
            Err(format!(
                "provider auth cannot be combined with {}",
                conflicts.join(", ")
            ))
        }
    }

    fn build_header_map(&self) -> LyraResult<HeaderMap> {
        let capacity = self.http_headers.as_ref().map_or(0, HashMap::len)
            + self.env_http_headers.as_ref().map_or(0, HashMap::len);
        let mut headers = HeaderMap::with_capacity(capacity);
        if let Some(extra) = &self.http_headers {
            for (k, v) in extra {
                if let (Ok(name), Ok(value)) = (HeaderName::try_from(k), HeaderValue::try_from(v)) {
                    headers.insert(name, value);
                }
            }
        }

        if let Some(env_headers) = &self.env_http_headers {
            for (header, env_var) in env_headers {
                if let Some(val) = resolve_env_or_local_secret(env_var, self.base_url.as_deref())
                    && let (Ok(name), Ok(value)) = (
                        HeaderName::try_from(header),
                        HeaderValue::try_from(val.as_str()),
                    )
                {
                    headers.insert(name, value);
                }
            }
        }

        Ok(headers)
    }

    pub fn to_api_provider(&self, auth_mode: Option<AuthMode>) -> LyraResult<ApiProvider> {
        let _ = auth_mode;
        let default_base_url = "https://api.openai.com/v1"; // TODO(lyra): make configurable, remove OpenAI default
        let base_url = self
            .base_url
            .clone()
            .unwrap_or_else(|| default_base_url.to_string());

        let headers = self.build_header_map()?;
        let retry = ApiRetryConfig {
            max_attempts: self.request_max_retries(),
            base_delay: Duration::from_millis(200),
            retry_429: false,
            retry_5xx: true,
            retry_transport: true,
        };

        Ok(ApiProvider {
            name: self.name.clone(),
            base_url,
            query_params: self.query_params.clone(),
            headers,
            retry,
            stream_idle_timeout: self.stream_idle_timeout(),
        })
    }

    /// If `env_key` is Some, returns the API key for this provider if present
    /// (and non-empty) in the environment. If `env_key` is required but
    /// cannot be found, returns an error.
    pub fn api_key(&self) -> LyraResult<Option<String>> {
        match &self.env_key {
            Some(env_key) => {
                let api_key = resolve_env_or_local_secret(env_key, self.base_url.as_deref())
                    .ok_or_else(|| {
                        LyraErr::EnvVar(EnvVarError {
                            var: env_key.clone(),
                            instructions: self.env_key_instructions.clone(),
                        })
                    })?;
                Ok(Some(api_key))
            }
            None => Ok(None),
        }
    }

    /// Effective maximum number of request retries for this provider.
    pub fn request_max_retries(&self) -> u64 {
        self.request_max_retries
            .unwrap_or(DEFAULT_REQUEST_MAX_RETRIES)
            .min(MAX_REQUEST_MAX_RETRIES)
    }

    /// Effective maximum number of stream reconnection attempts for this provider.
    pub fn stream_max_retries(&self) -> u64 {
        self.stream_max_retries
            .unwrap_or(DEFAULT_STREAM_MAX_RETRIES)
            .min(MAX_STREAM_MAX_RETRIES)
    }

    /// Effective idle timeout for streaming responses.
    pub fn stream_idle_timeout(&self) -> Duration {
        self.stream_idle_timeout_ms
            .map(Duration::from_millis)
            .unwrap_or(Duration::from_millis(DEFAULT_STREAM_IDLE_TIMEOUT_MS))
    }

    /// Effective timeout for websocket connect attempts.
    pub fn websocket_connect_timeout(&self) -> Duration {
        self.websocket_connect_timeout_ms
            .map(Duration::from_millis)
            .unwrap_or(Duration::from_millis(DEFAULT_WEBSOCKET_CONNECT_TIMEOUT_MS))
    }

    pub fn create_openai_provider(base_url: Option<String>) -> ModelProviderInfo {
        ModelProviderInfo {
            name: OPENAI_PROVIDER_NAME.into(),
            base_url,
            env_key: None,
            env_key_instructions: None,
            experimental_bearer_token: None,
            auth: None,
            wire_api: WireApi::Responses,
            query_params: None,
            http_headers: Some(
                [("version".to_string(), env!("CARGO_PKG_VERSION").to_string())]
                    .into_iter()
                    .collect(),
            ),
            env_http_headers: None, // Removed hardcoded OpenAI-Organization / OpenAI-Project headers
            // Use global defaults for retry/timeout unless overridden in config.toml.
            request_max_retries: None,
            stream_max_retries: None,
            stream_idle_timeout_ms: None,
            websocket_connect_timeout_ms: None,
            requires_managed_auth: false,
            supports_websockets: true,
        }
    }

    pub fn is_openai(&self) -> bool {
        self.name == OPENAI_PROVIDER_NAME
    }

    pub fn supports_remote_compaction(&self) -> bool {
        self.is_openai() || is_azure_responses_provider(&self.name, self.base_url.as_deref())
    }

    pub fn has_command_auth(&self) -> bool {
        self.auth.is_some()
    }
}

pub const DEFAULT_LMSTUDIO_PORT: u16 = 1234;
pub const DEFAULT_OLLAMA_PORT: u16 = 11434;

pub const LMSTUDIO_OSS_PROVIDER_ID: &str = "lmstudio";
pub const OLLAMA_OSS_PROVIDER_ID: &str = "ollama";

/// Built-in default provider list.
pub fn built_in_model_providers(
    openai_base_url: Option<String>,
) -> HashMap<String, ModelProviderInfo> {
    use ModelProviderInfo as P;
    let openai_provider = P::create_openai_provider(openai_base_url);

    // We only include the OpenAI-compatible and open source ("oss") providers
    // by default. Users are encouraged to add to `model_providers` in
    // config.toml to add their own providers.
    [
        (OPENAI_PROVIDER_ID, openai_provider),
        (
            OLLAMA_OSS_PROVIDER_ID,
            create_oss_provider(DEFAULT_OLLAMA_PORT, WireApi::Responses),
        ),
        (
            LMSTUDIO_OSS_PROVIDER_ID,
            create_oss_provider(DEFAULT_LMSTUDIO_PORT, WireApi::Responses),
        ),
    ]
    .into_iter()
    .map(|(k, v)| (k.to_string(), v))
    .collect()
}

pub fn create_oss_provider(default_provider_port: u16, wire_api: WireApi) -> ModelProviderInfo {
    // These LYRA_OSS_ environment variables are experimental: we may
    // switch to reading values from config.toml instead.
    let default_lyra_oss_base_url = format!(
        "http://localhost:{lyra_oss_port}/v1",
        lyra_oss_port = std::env::var("LYRA_OSS_PORT")
            .ok()
            .filter(|value| !value.trim().is_empty())
            .and_then(|value| value.parse::<u16>().ok())
            .unwrap_or(default_provider_port)
    );

    let lyra_oss_base_url = std::env::var("LYRA_OSS_BASE_URL")
        .ok()
        .filter(|v| !v.trim().is_empty())
        .unwrap_or(default_lyra_oss_base_url);
    create_oss_provider_with_base_url(&lyra_oss_base_url, wire_api)
}

pub fn create_oss_provider_with_base_url(base_url: &str, wire_api: WireApi) -> ModelProviderInfo {
    ModelProviderInfo {
        name: "gpt-oss".into(),
        base_url: Some(base_url.into()),
        env_key: None,
        env_key_instructions: None,
        experimental_bearer_token: None,
        auth: None,
        wire_api,
        query_params: None,
        http_headers: None,
        env_http_headers: None,
        request_max_retries: None,
        stream_max_retries: None,
        stream_idle_timeout_ms: None,
        websocket_connect_timeout_ms: None,
        requires_managed_auth: false,
        supports_websockets: false,
    }
}

#[cfg(test)]
#[path = "model_provider_info_tests.rs"]
mod tests;
