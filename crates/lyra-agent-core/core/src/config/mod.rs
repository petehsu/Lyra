use crate::agents_md::AgentsMdManager;
use crate::config::edit::ConfigEdit;
use crate::config::edit::ConfigEditsBuilder;
use crate::config_loader::CloudRequirementsLoader;
use crate::config_loader::ConfigLayerStack;
use crate::config_loader::ConfigLayerStackOrdering;
use crate::config_loader::ConfigRequirements;
use crate::config_loader::ConfigRequirementsToml;
use crate::config_loader::ConstrainedWithSource;
use crate::config_loader::LoaderOverrides;
use crate::config_loader::McpServerIdentity;
use crate::config_loader::McpServerRequirement;
use crate::config_loader::ResidencyRequirement;
use crate::config_loader::Sourced;
use crate::config_loader::load_config_layers_state;
use crate::config_loader::project_trust_key;
use crate::memories::memory_root;
use crate::path_utils::normalize_for_native_workdir;
use crate::unified_exec::DEFAULT_MAX_BACKGROUND_TERMINAL_TIMEOUT_MS;
use crate::unified_exec::MIN_EMPTY_YIELD_TIME_MS;
use crate::windows_sandbox::WindowsSandboxLevelExt;
use crate::windows_sandbox::resolve_windows_sandbox_mode;
use crate::windows_sandbox::resolve_windows_sandbox_private_desktop;
use lyra_config::config_toml::ConfigToml;
use lyra_config::config_toml::ProjectConfig;
use lyra_config::config_toml::validate_model_providers;
use lyra_config::profile_toml::ConfigProfile;
use lyra_config::types::ApprovalsReviewer;
use lyra_config::types::AuthCredentialsStoreMode;
use lyra_config::types::DEFAULT_OTEL_ENVIRONMENT;
use lyra_config::types::History;
use lyra_config::types::McpServerConfig;
use lyra_config::types::McpServerDisabledReason;
use lyra_config::types::McpServerTransportConfig;
use lyra_config::types::MemoriesConfig;
use lyra_config::types::ModelAvailabilityNuxConfig;
use lyra_config::types::Notice;
use lyra_config::types::OAuthCredentialsStoreMode;
use lyra_config::types::OtelConfig;
use lyra_config::types::OtelConfigToml;
use lyra_config::types::OtelExporterKind;
use lyra_config::types::ShellEnvironmentPolicy;
use lyra_config::types::ToolSuggestConfig;
use lyra_config::types::ToolSuggestDiscoverable;
use lyra_config::types::TuiNotificationSettings;
use lyra_config::types::UriBasedFileOpener;
use lyra_config::types::WindowsSandboxModeToml;
use lyra_exec_server::ExecutorFileSystem;
use lyra_exec_server::LOCAL_FS;
use lyra_features::Feature;
use lyra_features::FeatureConfigSource;
use lyra_features::FeatureOverrides;
use lyra_features::FeatureToml;
use lyra_features::Features;
use lyra_features::FeaturesToml;
use lyra_features::MultiAgentV2ConfigToml;
use lyra_git_utils::resolve_root_git_project_for_trust;
use lyra_login::AuthManagerConfig;
use lyra_mcp::McpConfig;
use lyra_model_provider_info::LEGACY_OLLAMA_CHAT_PROVIDER_ID;
use lyra_model_provider_info::LMSTUDIO_OSS_PROVIDER_ID;
use lyra_model_provider_info::ModelProviderInfo;
use lyra_model_provider_info::OLLAMA_CHAT_PROVIDER_REMOVED_ERROR;
use lyra_model_provider_info::WireApi;
use lyra_model_provider_info::built_in_model_providers;
use lyra_models_manager::ModelsManagerConfig;
use lyra_models_manager::ProviderModelCatalog;
use lyra_models_manager::model_info_from_provider_model_entry;
use lyra_models_manager::normalize_provider_model_entry;
use lyra_models_manager::provider_model_entry_from_id;
use lyra_protocol::config_types::AltScreenMode;
use lyra_protocol::config_types::ForcedLoginMethod;
use lyra_protocol::config_types::ReasoningSummary;
use lyra_protocol::config_types::SandboxMode;
use lyra_protocol::config_types::ServiceTier;
use lyra_protocol::config_types::TrustLevel;
use lyra_protocol::config_types::Verbosity;
use lyra_protocol::config_types::WebSearchConfig;
use lyra_protocol::config_types::WebSearchMode;
use lyra_protocol::config_types::WindowsSandboxLevel;
use lyra_protocol::openai_models::ModelsResponse;
use lyra_protocol::openai_models::ReasoningEffort;
use lyra_protocol::permissions::FileSystemSandboxPolicy;
use lyra_protocol::permissions::NetworkSandboxPolicy;
use lyra_protocol::protocol::AskForApproval;
use lyra_protocol::protocol::SandboxPolicy;
use lyra_utils_absolute_path::AbsolutePathBuf;
use lyra_utils_absolute_path::AbsolutePathBufGuard;
use serde::Deserialize;
use std::collections::BTreeMap;
use std::collections::HashMap;
use std::io::ErrorKind;
use std::path::Path;
use std::path::PathBuf;
use tokio::fs;

use crate::config::permissions::compile_permission_profile;
use crate::config::permissions::get_readable_roots_required_for_lyra_runtime;
use crate::config::permissions::network_proxy_config_from_profile_network;
use lyra_network_proxy::NetworkProxyConfig;
use toml::Value as TomlValue;
use toml_edit::DocumentMut;

pub(crate) mod agent_roles;
pub mod edit;
mod managed_features;
mod network_proxy_spec;
mod permissions;
#[cfg(test)]
mod schema;
pub(crate) mod service;
pub use lyra_config::Constrained;
pub use lyra_config::ConstraintError;
pub use lyra_config::ConstraintResult;
pub use lyra_network_proxy::NetworkProxyAuditMetadata;
pub use lyra_sandboxing::system_bwrap_warning;
pub use managed_features::ManagedFeatures;
pub use network_proxy_spec::NetworkProxySpec;
pub use network_proxy_spec::StartedNetworkProxy;
pub(crate) use permissions::resolve_permission_profile;
pub use service::ConfigService;
pub use service::ConfigServiceError;

pub use lyra_git_utils::GhostSnapshotConfig;

/// Maximum number of bytes of the documentation that will be embedded. Larger
/// files are *silently truncated* to this size so we do not take up too much of
/// the context window.
pub(crate) const AGENTS_MD_MAX_BYTES: usize = 32 * 1024; // 32 KiB
pub(crate) const DEFAULT_AGENT_MAX_THREADS: Option<usize> = Some(6);
pub(crate) const DEFAULT_AGENT_MAX_DEPTH: i32 = 1;
pub(crate) const DEFAULT_AGENT_JOB_MAX_RUNTIME_SECONDS: Option<u64> = None;
const LOCAL_DEV_BUILD_VERSION: &str = "0.0.0";

pub const CONFIG_TOML_FILE: &str = "config.toml";

const LYRA_PROFILES_PATH_COMPONENTS: [&str; 2] = ["lyra-config", "profiles.v2.json"];
const LYRA_PROFILE_RUNTIME_PREFIX: &str = "lp_";

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct LyraStoredProfilesDocument {
    #[serde(default)]
    default_profile_id: Option<String>,
    #[serde(default)]
    profiles: Vec<LyraStoredProfile>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LyraStoredProfile {
    id: String,
    #[serde(default)]
    provider_id: String,
    #[serde(default)]
    protocol_id: String,
    #[serde(default)]
    model: String,
    #[serde(default)]
    connection_config: HashMap<String, String>,
    #[serde(default)]
    auth_config: HashMap<String, String>,
    #[serde(default)]
    headers: HashMap<String, String>,
    #[serde(default)]
    custom_models: Vec<LyraStoredModelEntry>,
    #[serde(default)]
    discovery_state: LyraStoredModelDiscoveryState,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct LyraStoredModelDiscoveryState {
    #[serde(default)]
    models: Vec<LyraStoredModelEntry>,
}

#[derive(Debug, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
struct LyraStoredModelEntry {
    id: String,
    #[serde(default)]
    name: String,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    context_window: Option<u64>,
    #[serde(default)]
    supports_images: Option<bool>,
    #[serde(default)]
    supports_tools: Option<bool>,
    #[serde(default)]
    runtime_metadata: Option<LyraStoredModelRuntimeMetadata>,
    #[serde(default)]
    source: String,
}

#[derive(Debug, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
struct LyraStoredModelRuntimeMetadata {
    #[serde(default)]
    shell_type: Option<String>,
    #[serde(default)]
    apply_patch_tool_type: Option<String>,
    #[serde(default)]
    supports_search_tool: Option<bool>,
    #[serde(default)]
    supports_parallel_tool_calls: Option<bool>,
    #[serde(default)]
    supports_reasoning_summaries: Option<bool>,
    #[serde(default)]
    default_reasoning_level: Option<ReasoningEffort>,
    #[serde(default)]
    supported_reasoning_levels: Vec<ReasoningEffort>,
    #[serde(default)]
    support_verbosity: Option<bool>,
    #[serde(default)]
    default_verbosity: Option<Verbosity>,
    #[serde(default)]
    web_search_tool_type: Option<String>,
    #[serde(default)]
    supports_image_detail_original: Option<bool>,
    #[serde(default)]
    input_modalities: Vec<String>,
    #[serde(default)]
    supported_tools: Vec<String>,
    #[serde(default)]
    context_window: Option<u64>,
    #[serde(default)]
    max_context_window: Option<u64>,
    #[serde(default)]
    effective_context_window_percent: Option<u64>,
    #[serde(default)]
    protocol_behavior: Option<lyra_app_server_protocol::LyraAiProtocolBehaviorSummary>,
}

#[derive(Debug, Default)]
struct LyraProfileProviderProjection {
    providers: HashMap<String, ModelProviderInfo>,
    default_runtime_provider_id: Option<String>,
    provider_model_catalogs: HashMap<String, ProviderModelCatalog>,
}

async fn load_lyra_profile_provider_projection(lyra_home: &Path) -> LyraProfileProviderProjection {
    let path = LYRA_PROFILES_PATH_COMPONENTS
        .iter()
        .fold(lyra_home.to_path_buf(), |path, component| {
            path.join(component)
        });
    let raw = match fs::read_to_string(&path).await {
        Ok(raw) => raw,
        Err(err) if err.kind() == ErrorKind::NotFound => {
            return LyraProfileProviderProjection::default();
        }
        Err(err) => {
            tracing::warn!(
                path = %path.display(),
                error = %err,
                "failed to read Lyra profile store"
            );
            return LyraProfileProviderProjection::default();
        }
    };
    let document = match serde_json::from_str::<LyraStoredProfilesDocument>(&raw) {
        Ok(document) => document,
        Err(err) => {
            tracing::warn!(
                path = %path.display(),
                error = %err,
                "failed to parse Lyra profile store"
            );
            return LyraProfileProviderProjection::default();
        }
    };

    let mut providers = HashMap::new();
    let default_profile_id = document
        .default_profile_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned);
    let mut default_runtime_provider_id = None;
    let mut provider_model_catalogs = HashMap::new();

    for profile in document.profiles {
        if profile.id.trim().is_empty() {
            continue;
        }
        let runtime_provider_id = format!("{LYRA_PROFILE_RUNTIME_PREFIX}{}", profile.id.trim());
        let Some((provider_info, model_catalog)) = model_provider_info_from_lyra_profile(&profile)
        else {
            continue;
        };
        if default_profile_id.as_deref() == Some(profile.id.trim()) {
            default_runtime_provider_id = Some(runtime_provider_id.clone());
        }
        provider_model_catalogs.insert(runtime_provider_id.clone(), model_catalog);
        providers.insert(runtime_provider_id, provider_info);
    }

    LyraProfileProviderProjection {
        providers,
        default_runtime_provider_id,
        provider_model_catalogs,
    }
}

fn model_provider_info_from_lyra_profile(
    profile: &LyraStoredProfile,
) -> Option<(ModelProviderInfo, ProviderModelCatalog)> {
    let protocol_id = profile.protocol_id.trim();
    let provider_id = profile.provider_id.trim();
    let wire_api = match protocol_id {
        "anthropic_messages" => WireApi::AnthropicMessages,
        "gemini_generate_content" => WireApi::GeminiGenerateContent,
        "openai_chat_completions" | "azure_openai_chat_completions" => WireApi::Responses,
        "openrouter_chat_completions"
        | "deepseek_chat_completions"
        | "xai_chat_completions"
        | "mistral_chat_completions"
        | "groq_chat_completions"
        | "together_chat_completions"
        | "fireworks_chat_completions"
        | "vercel_ai_gateway_chat_completions"
        | "custom_chat_completions"
        | "ollama_chat"
        | "lmstudio_chat_completions" => WireApi::ChatCompletions,
        _ => {
            tracing::debug!(
                profile_id = %profile.id,
                provider_id = %provider_id,
                protocol_id = %protocol_id,
                "skip unsupported Lyra profile protocol for runtime projection"
            );
            return None;
        }
    };

    let Some(base_url) = profile_base_url(profile, protocol_id) else {
        tracing::debug!(
            profile_id = %profile.id,
            provider_id = %provider_id,
            protocol_id = %protocol_id,
            "skip Lyra profile without resolvable base URL"
        );
        return None;
    };

    let model_catalog = provider_model_catalog_from_lyra_profile(profile, provider_id, protocol_id);

    let mut headers = sanitize_profile_headers(&profile.headers);
    if protocol_id == "anthropic_messages" {
        let anthropic_version = profile
            .auth_config
            .get("anthropicVersion")
            .map(|value| value.trim())
            .filter(|value| !value.is_empty())
            .unwrap_or("2023-06-01");
        headers.insert(
            "anthropic-version".to_string(),
            anthropic_version.to_string(),
        );
    }

    let env_http_headers = if protocol_id == "azure_openai_chat_completions" {
        Some(HashMap::from([(
            "api-key".to_string(),
            "AZURE_OPENAI_API_KEY".to_string(),
        )]))
    } else {
        None
    };

    let query_params = if protocol_id == "azure_openai_chat_completions" {
        let api_version = profile
            .connection_config
            .get("apiVersion")
            .map(|value| value.trim())
            .filter(|value| !value.is_empty())
            .unwrap_or("2024-10-21");
        Some(HashMap::from([(
            "api-version".to_string(),
            api_version.to_string(),
        )]))
    } else {
        None
    };

    let env_key = env_key_for_profile_provider(provider_id, protocol_id);

    Some((
        ModelProviderInfo {
            name: format!("Lyra Profile ({provider_id})"),
            base_url: Some(base_url),
            env_key,
            env_key_instructions: None,
            bearer_token: None,
            auth: None,
            wire_api,
            query_params,
            http_headers: (!headers.is_empty()).then_some(headers),
            env_http_headers,
            request_max_retries: None,
            stream_max_retries: None,
            stream_idle_timeout_ms: None,
            websocket_connect_timeout_ms: None,
            requires_managed_auth: false,
            supports_websockets: matches!(protocol_id, "openai_chat_completions"),
            protocol_behavior: None,
        },
        model_catalog,
    ))
}

fn provider_model_catalog_from_lyra_profile(
    profile: &LyraStoredProfile,
    provider_id: &str,
    protocol_id: &str,
) -> ProviderModelCatalog {
    let mut models = Vec::new();
    let selected_model = profile.model.trim();
    if !selected_model.is_empty() {
        let selected =
            provider_model_entry_from_id(provider_id, protocol_id, selected_model, "profile");
        models.push(model_info_from_provider_model_entry(
            provider_id,
            protocol_id,
            &selected,
        ));
    }
    for entry in profile
        .discovery_state
        .models
        .iter()
        .cloned()
        .map(lyra_provider_model_entry_from_stored)
        .chain(
            profile
                .custom_models
                .iter()
                .cloned()
                .map(lyra_provider_model_entry_from_stored),
        )
    {
        let normalized = normalize_provider_model_entry(provider_id, protocol_id, entry);
        if models.iter().any(|model| model.slug == normalized.id) {
            continue;
        }
        models.push(model_info_from_provider_model_entry(
            provider_id,
            protocol_id,
            &normalized,
        ));
    }

    ProviderModelCatalog {
        protocol_id: Some(protocol_id.to_string()),
        models,
    }
}

fn lyra_provider_model_entry_from_stored(
    entry: LyraStoredModelEntry,
) -> lyra_app_server_protocol::LyraAiProviderModelEntry {
    let id = entry.id;
    let name = if entry.name.trim().is_empty() {
        id.clone()
    } else {
        entry.name
    };
    lyra_app_server_protocol::LyraAiProviderModelEntry {
        id,
        name,
        description: entry.description,
        context_window: entry.context_window,
        supports_images: entry.supports_images,
        supports_tools: entry.supports_tools,
        runtime_metadata: entry.runtime_metadata.map(|metadata| {
            lyra_app_server_protocol::LyraAiModelRuntimeMetadata {
                shell_type: metadata.shell_type,
                apply_patch_tool_type: metadata.apply_patch_tool_type,
                supports_search_tool: metadata.supports_search_tool,
                supports_parallel_tool_calls: metadata.supports_parallel_tool_calls,
                supports_reasoning_summaries: metadata.supports_reasoning_summaries,
                default_reasoning_level: metadata.default_reasoning_level,
                supported_reasoning_levels: metadata.supported_reasoning_levels,
                support_verbosity: metadata.support_verbosity,
                default_verbosity: metadata.default_verbosity,
                web_search_tool_type: metadata.web_search_tool_type,
                supports_image_detail_original: metadata.supports_image_detail_original,
                input_modalities: metadata.input_modalities,
                supported_tools: metadata.supported_tools,
                context_window: metadata.context_window,
                max_context_window: metadata.max_context_window,
                effective_context_window_percent: metadata.effective_context_window_percent,
                protocol_behavior: metadata.protocol_behavior,
            }
        }),
        source: if entry.source.trim().is_empty() {
            "dynamic".to_string()
        } else {
            entry.source
        },
    }
}

fn profile_base_url(profile: &LyraStoredProfile, protocol_id: &str) -> Option<String> {
    if let Some(base_url) = profile
        .connection_config
        .get("baseUrl")
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
    {
        return Some(base_url.trim_end_matches('/').to_string());
    }

    let fallback = match protocol_id {
        "openai_chat_completions" => Some("https://api.openai.com/v1"),
        "openrouter_chat_completions" => Some("https://openrouter.ai/api/v1"),
        "anthropic_messages" => Some("https://api.anthropic.com"),
        "gemini_generate_content" => Some("https://generativelanguage.googleapis.com"),
        "deepseek_chat_completions" => Some("https://api.deepseek.com/v1"),
        "xai_chat_completions" => Some("https://api.x.ai/v1"),
        "mistral_chat_completions" => Some("https://api.mistral.ai/v1"),
        "groq_chat_completions" => Some("https://api.groq.com/openai/v1"),
        "together_chat_completions" => Some("https://api.together.xyz/v1"),
        "fireworks_chat_completions" => Some("https://api.fireworks.ai/inference/v1"),
        "vercel_ai_gateway_chat_completions" => Some("https://ai-gateway.vercel.sh/v1"),
        "ollama_chat" => Some("http://127.0.0.1:11434"),
        "lmstudio_chat_completions" => Some("http://127.0.0.1:1234/v1"),
        _ => None,
    }?;
    Some(fallback.to_string())
}

fn sanitize_profile_headers(headers: &HashMap<String, String>) -> HashMap<String, String> {
    headers
        .iter()
        .filter_map(|(key, value)| {
            let key = key.trim();
            let value = value.trim();
            if key.is_empty() || value.is_empty() {
                None
            } else {
                Some((key.to_string(), value.to_string()))
            }
        })
        .collect()
}

fn env_key_for_profile_provider(provider_id: &str, protocol_id: &str) -> Option<String> {
    let value = match provider_id {
        "openai" => Some("OPENAI_API_KEY"),
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
        "custom_openai_compatible" => Some("CUSTOM_OPENAI_API_KEY"),
        _ => match protocol_id {
            "azure_openai_chat_completions" => None,
            "anthropic_messages" => Some("ANTHROPIC_API_KEY"),
            "gemini_generate_content" => Some("GEMINI_API_KEY"),
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
    }?;
    Some(value.to_string())
}

fn resolve_sqlite_home_env(resolved_cwd: &Path) -> Option<PathBuf> {
    let raw = std::env::var(lyra_state::SQLITE_HOME_ENV).ok()?;
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    let path = PathBuf::from(trimmed);
    if path.is_absolute() {
        Some(path)
    } else {
        Some(resolved_cwd.join(path))
    }
}

fn resolve_cli_auth_credentials_store_mode(
    configured: AuthCredentialsStoreMode,
    package_version: &str,
) -> AuthCredentialsStoreMode {
    match (package_version, configured) {
        (
            LOCAL_DEV_BUILD_VERSION,
            AuthCredentialsStoreMode::Keyring | AuthCredentialsStoreMode::Auto,
        ) => AuthCredentialsStoreMode::File,
        (_, mode) => mode,
    }
}

fn resolve_mcp_oauth_credentials_store_mode(
    configured: OAuthCredentialsStoreMode,
    package_version: &str,
) -> OAuthCredentialsStoreMode {
    match (package_version, configured) {
        (
            LOCAL_DEV_BUILD_VERSION,
            OAuthCredentialsStoreMode::Keyring | OAuthCredentialsStoreMode::Auto,
        ) => OAuthCredentialsStoreMode::File,
        (_, mode) => mode,
    }
}

#[cfg(test)]
pub(crate) async fn test_config() -> Config {
    let lyra_home = tempfile::tempdir().expect("create temp dir");
    Config::load_from_base_config_with_overrides(
        ConfigToml::default(),
        ConfigOverrides::default(),
        AbsolutePathBuf::from_absolute_path(lyra_home.path()).expect("temp dir should resolve"),
    )
    .await
    .expect("load default test config")
}

/// Application configuration loaded from disk and merged with overrides.
#[derive(Debug, Clone, PartialEq)]
pub struct Permissions {
    /// Approval policy for executing commands.
    pub approval_policy: Constrained<AskForApproval>,
    /// Effective sandbox policy used for shell/unified exec.
    pub sandbox_policy: Constrained<SandboxPolicy>,
    /// Effective filesystem sandbox policy, including entries that cannot yet
    /// be fully represented by the legacy [`SandboxPolicy`] projection.
    pub file_system_sandbox_policy: FileSystemSandboxPolicy,
    /// Effective network sandbox policy split out from the legacy
    /// [`SandboxPolicy`] projection.
    pub network_sandbox_policy: NetworkSandboxPolicy,
    /// Effective network configuration applied to all spawned processes.
    pub network: Option<NetworkProxySpec>,
    /// Whether the model may request a login shell for shell-based tools.
    /// Default to `true`
    ///
    /// If `true`, the model may request a login shell (`login = true`), and
    /// omitting `login` defaults to using a login shell.
    /// If `false`, the model can never use a login shell: `login = true`
    /// requests are rejected, and omitting `login` defaults to a non-login
    /// shell.
    pub allow_login_shell: bool,
    /// Policy used to build process environments for shell/unified exec.
    pub shell_environment_policy: ShellEnvironmentPolicy,
    /// Effective Windows sandbox mode derived from `[windows].sandbox` or
    /// legacy feature keys.
    pub windows_sandbox_mode: Option<WindowsSandboxModeToml>,
    /// Whether the final Windows sandboxed child should run on a private desktop.
    pub windows_sandbox_private_desktop: bool,
}

/// Application configuration loaded from disk and merged with overrides.
#[derive(Debug, Clone, PartialEq)]
pub struct Config {
    /// Provenance for how this [`Config`] was derived (merged layers + enforced
    /// requirements).
    pub config_layer_stack: ConfigLayerStack,

    /// Warnings collected during config load that should be shown on startup.
    pub startup_warnings: Vec<String>,

    /// Optional override of model selection.
    pub model: Option<String>,

    /// Effective service tier preference for new turns (`fast` or `flex`).
    pub service_tier: Option<ServiceTier>,

    /// Model used specifically for review sessions.
    pub review_model: Option<String>,

    /// Size of the context window for the model, in tokens.
    pub model_context_window: Option<i64>,

    /// Key into the model_providers map that specifies which provider to use.
    pub model_provider_id: String,

    /// Info needed to make an API request to the model.
    pub model_provider: ModelProviderInfo,

    /// Effective permission configuration for shell tool execution.
    pub permissions: Permissions,

    /// Configures who approval requests are routed to for review once they have
    /// been escalated. This does not disable separate safety checks such as
    /// ARC.
    pub approvals_reviewer: ApprovalsReviewer,

    /// enforce_residency means web traffic cannot be routed outside of a
    /// particular geography. HTTP clients should direct their requests
    /// using backend-specific headers or URLs to enforce this.
    pub enforce_residency: Constrained<Option<ResidencyRequirement>>,

    /// When `true`, `AgentReasoning` events emitted by the backend will be
    /// suppressed from the frontend output. This can reduce visual noise when
    /// users are only interested in the final agent responses.
    pub hide_agent_reasoning: bool,

    /// When set to `true`, `AgentReasoningRawContentEvent` events will be shown in the UI/output.
    /// Defaults to `false`.
    pub show_raw_agent_reasoning: bool,

    /// User-provided instructions from AGENTS.md.
    pub user_instructions: Option<String>,

    /// Base instructions override.
    pub base_instructions: Option<String>,

    /// Developer instructions override injected as a separate message.
    pub developer_instructions: Option<String>,

    /// AutoReview-specific tenant policy config override from requirements.toml.
    /// This is inserted into the fixed auto_review prompt template under the
    /// `# Policy Configuration` section rather than replacing the whole
    /// auto_review developer prompt.
    pub auto_review_policy_config: Option<String>,

    /// Whether to inject the `<permissions instructions>` developer block.
    pub include_permissions_instructions: bool,

    /// Whether to inject the `<apps_instructions>` developer block.
    pub include_apps_instructions: bool,

    /// Whether to inject the `<skills_instructions>` developer block.
    pub include_skill_instructions: bool,

    /// Whether to inject the `<environment_context>` user block.
    pub include_environment_context: bool,

    /// Optional commit attribution text for commit message co-author trailers.
    ///
    /// - `None` or whitespace-only: disable commit attribution
    /// - `Some("...")`: use the provided attribution text verbatim
    pub commit_attribution: Option<String>,

    /// TUI notification settings, including enabled events, delivery method, and focus condition.
    pub tui_notifications: TuiNotificationSettings,

    /// Enable ASCII animations and shimmer effects in the TUI.
    pub animations: bool,

    /// Show startup tooltips in the TUI welcome screen.
    pub show_tooltips: bool,

    /// Persisted startup availability NUX state for model tooltips.
    pub model_availability_nux: ModelAvailabilityNuxConfig,

    /// Start the TUI in the specified collaboration mode (plan/default).

    /// Controls whether the TUI uses the terminal's alternate screen buffer.
    ///
    /// This is the same `tui.alternate_screen` value from `config.toml`.
    /// - `auto` (default): Disable alternate screen in Zellij, enable elsewhere.
    /// - `always`: Always use alternate screen (original behavior).
    /// - `never`: Never use alternate screen (inline mode, preserves scrollback).
    pub tui_alternate_screen: AltScreenMode,

    /// Ordered list of status line item identifiers for the TUI.
    ///
    /// When unset, the TUI defaults to: `model-with-reasoning` and `current-dir`.
    pub tui_status_line: Option<Vec<String>>,

    /// Ordered list of terminal title item identifiers for the TUI.
    ///
    /// When unset, the TUI defaults to: `project` and `spinner`.
    pub tui_terminal_title: Option<Vec<String>>,

    /// Syntax highlighting theme override (kebab-case name).
    pub tui_theme: Option<String>,

    /// The absolute directory that should be treated as the current working
    /// directory for the session. All relative paths inside the business-logic
    /// layer are resolved against this path.
    pub cwd: AbsolutePathBuf,

    /// Preferred store for CLI auth credentials.
    /// file (default): Use a file in the active Lyra runtime home directory.
    /// keyring: Use an OS-specific keyring service.
    /// auto: Use the OS-specific keyring service if available, otherwise use a file.
    pub cli_auth_credentials_store_mode: AuthCredentialsStoreMode,

    /// Definition for MCP servers that Lyra can reach out to for tool calls.
    pub mcp_servers: Constrained<HashMap<String, McpServerConfig>>,

    /// Preferred store for MCP OAuth credentials.
    /// keyring: Use an OS-specific keyring service.
    ///          Credentials stored in the keyring will only be readable by Lyra unless the user explicitly grants access via OS-level keyring access.
    /// file: `.credentials.json` in the active Lyra runtime home.
    ///       This file will be readable to Lyra and other applications running as the same user.
    /// auto (default): keyring if available, otherwise file.
    pub mcp_oauth_credentials_store_mode: OAuthCredentialsStoreMode,

    /// Optional fixed port to use for the local HTTP callback server used during MCP OAuth login.
    ///
    /// When unset, Lyra will bind to an ephemeral port chosen by the OS.
    pub mcp_oauth_callback_port: Option<u16>,

    /// Optional redirect URI to use during MCP OAuth login.
    ///
    /// When set, this URI is used in the OAuth authorization request instead
    /// of the local listener address. The local callback listener still binds
    /// to 127.0.0.1 (using `mcp_oauth_callback_port` when provided).
    pub mcp_oauth_callback_url: Option<String>,

    /// Combined provider map (defaults plus user-defined providers).
    pub model_providers: HashMap<String, ModelProviderInfo>,

    /// Maximum number of bytes to include from an AGENTS.md project doc file.
    pub project_doc_max_bytes: usize,

    /// Additional filenames to try when looking for project-level docs.
    pub project_doc_fallback_filenames: Vec<String>,

    /// Token budget applied when storing tool/function outputs in the context manager.
    pub tool_output_token_limit: Option<usize>,

    /// Maximum number of agent threads that can be open concurrently.
    pub agent_max_threads: Option<usize>,
    /// Maximum runtime in seconds for agent job workers before they are failed.
    pub agent_job_max_runtime_seconds: Option<u64>,

    /// Maximum nesting depth allowed for spawned agent threads.
    pub agent_max_depth: i32,

    /// User-defined role declarations keyed by role name.
    pub agent_roles: BTreeMap<String, AgentRoleConfig>,

    /// Memories subsystem settings.
    pub memories: MemoriesConfig,

    /// Directory containing all Lyra runtime state (defaults to `~/.lyra`
    /// but can be overridden by `LYRA_HOME`).
    pub lyra_home: AbsolutePathBuf,

    /// Directory where Lyra stores the SQLite state DB.
    pub sqlite_home: PathBuf,

    /// Directory where Lyra writes log files (defaults to the active Lyra runtime home's `log/` directory).
    pub log_dir: PathBuf,

    /// Settings that govern if and what will be written to `~/.lyra/history.jsonl`.
    pub history: History,

    /// When true, session is not persisted on disk. Default to `false`
    pub ephemeral: bool,

    /// Optional URI-based file opener. If set, citations to files in the model
    /// output will be hyperlinked using the specified URI scheme.
    pub file_opener: UriBasedFileOpener,

    /// Path to the current Lyra executable. This cannot be set in the config
    /// file: it must be set in code via [`ConfigOverrides`].
    pub lyra_self_exe: Option<PathBuf>,

    /// Path to the `lyra-linux-sandbox` executable. This must be set if
    /// [`lyra_sandboxing::SandboxType::LinuxSeccomp`] is used. Note that this
    /// cannot be set in the config file: it must be set in code via
    /// [`ConfigOverrides`].
    ///
    /// When this program is invoked, arg0 will be set to `lyra-linux-sandbox`.
    pub lyra_linux_sandbox_exe: Option<PathBuf>,

    /// Path to the `lyra-execve-wrapper` executable used for shell
    /// escalation. This cannot be set in the config file: it must be set in
    /// code via [`ConfigOverrides`].
    pub main_execve_wrapper_exe: Option<PathBuf>,

    /// Optional absolute path to the Node runtime used by `js_repl`.
    pub js_repl_node_path: Option<PathBuf>,

    /// Ordered list of directories to search for Node modules in `js_repl`.
    pub js_repl_node_module_dirs: Vec<PathBuf>,

    /// Optional absolute path to patched zsh used by zsh-exec-bridge-backed shell execution.
    pub zsh_path: Option<PathBuf>,

    /// Value to use for `reasoning.effort` when making a request using the
    /// Responses API.
    pub model_reasoning_effort: Option<ReasoningEffort>,
    /// Optional Plan-mode-specific reasoning effort override used by the TUI.
    ///
    /// When unset, Plan mode uses the built-in Plan preset default (currently
    /// `medium`). When explicitly set (including `none`), this overrides the
    /// Plan preset. The `none` value means "no reasoning" (not "inherit the
    /// global default").
    pub plan_mode_reasoning_effort: Option<ReasoningEffort>,

    /// Optional value to use for `reasoning.summary` when making a request
    /// using the Responses API. When unset, the model catalog default is used.
    pub model_reasoning_summary: Option<ReasoningSummary>,

    /// Optional override to force-enable reasoning summaries for the configured model.
    pub model_supports_reasoning_summaries: Option<bool>,

    /// Optional full model catalog loaded from `model_catalog_json`.
    /// When set, this replaces the bundled catalog for the current process.
    pub model_catalog: Option<ModelsResponse>,

    /// Provider-scoped model catalogs projected from Lyra AI profiles.
    pub provider_model_catalogs: HashMap<String, ProviderModelCatalog>,

    /// Optional verbosity control for GPT-5 models (Responses API `text.verbosity`).
    pub model_verbosity: Option<Verbosity>,

    /// When set, restricts the login mechanism users may use.
    pub forced_login_method: Option<ForcedLoginMethod>,

    /// Include the `apply_patch` tool for models that benefit from invoking
    /// file edits as a structured tool call. When unset, this falls back to the
    /// model info's default preference.
    pub include_apply_patch_tool: bool,

    /// Explicit or feature-derived web search mode.
    pub web_search_mode: Constrained<WebSearchMode>,

    /// Additional parameters for the web search tool when it is enabled.
    pub web_search_config: Option<WebSearchConfig>,

    /// If set to `true`, used only the unified exec tool.
    pub use_unified_exec_tool: bool,

    /// Maximum poll window for background terminal output (`write_stdin`), in milliseconds.
    /// Default: `300000` (5 minutes).
    pub background_terminal_max_timeout: u64,

    /// Settings for ghost snapshots (used for undo).
    pub ghost_snapshot: GhostSnapshotConfig,

    /// Settings specific to the task-path-based multi-agent tool surface.
    pub multi_agent_v2: MultiAgentV2Config,

    /// Centralized feature flags; source of truth for feature gating.
    pub features: ManagedFeatures,

    /// The active profile name used to derive this `Config` (if any).
    pub active_profile: Option<String>,

    /// The currently active project config, resolved by checking if cwd:
    /// is (1) part of a git repo, (2) a git worktree, or (3) just using the cwd
    pub active_project: ProjectConfig,

    /// Tracks whether the Windows onboarding screen has been acknowledged.
    pub windows_wsl_setup_acknowledged: bool,

    /// Collection of various notices we show the user
    pub notices: Notice,

    /// When `true`, checks for Lyra updates on startup and surfaces update prompts.
    /// Set to `false` only if your Lyra updates are centrally managed.
    /// Defaults to `true`.
    pub check_for_update_on_startup: bool,

    /// When true, disables burst-paste detection for typed input entirely.
    /// All characters are inserted as they are received, and no buffering
    /// or placeholder replacement will occur for fast keypress bursts.
    pub disable_paste_burst: bool,

    /// When `false`, disables analytics across Lyra product surfaces in this machine.
    /// Voluntarily left as Optional because the default value might depend on the client.
    pub analytics_enabled: Option<bool>,

    /// When `false`, disables feedback collection across Lyra product surfaces.
    /// Defaults to `true`.
    pub feedback_enabled: bool,

    /// Configured discoverable tools for tool suggestions.
    pub tool_suggest: ToolSuggestConfig,

    /// OTEL configuration (exporter type, endpoint, headers, etc.).
    pub otel: lyra_config::types::OtelConfig,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MultiAgentV2Config {
    pub usage_hint_enabled: bool,
    pub usage_hint_text: Option<String>,
    pub hide_spawn_agent_metadata: bool,
}

impl Default for MultiAgentV2Config {
    fn default() -> Self {
        Self {
            usage_hint_enabled: true,
            usage_hint_text: None,
            hide_spawn_agent_metadata: false,
        }
    }
}

impl AuthManagerConfig for Config {
    fn lyra_home(&self) -> PathBuf {
        self.lyra_home.to_path_buf()
    }

    fn cli_auth_credentials_store_mode(&self) -> AuthCredentialsStoreMode {
        self.cli_auth_credentials_store_mode
    }
}

#[derive(Debug, Clone, Default)]
pub struct ConfigBuilder {
    lyra_home: Option<PathBuf>,
    cli_overrides: Option<Vec<(String, TomlValue)>>,
    harness_overrides: Option<ConfigOverrides>,
    loader_overrides: Option<LoaderOverrides>,
    cloud_requirements: CloudRequirementsLoader,
    fallback_cwd: Option<PathBuf>,
}

impl ConfigBuilder {
    pub fn lyra_home(mut self, lyra_home: PathBuf) -> Self {
        self.lyra_home = Some(lyra_home);
        self
    }

    pub fn cli_overrides(mut self, cli_overrides: Vec<(String, TomlValue)>) -> Self {
        self.cli_overrides = Some(cli_overrides);
        self
    }

    pub fn harness_overrides(mut self, harness_overrides: ConfigOverrides) -> Self {
        self.harness_overrides = Some(harness_overrides);
        self
    }

    pub fn loader_overrides(mut self, loader_overrides: LoaderOverrides) -> Self {
        self.loader_overrides = Some(loader_overrides);
        self
    }

    pub fn cloud_requirements(mut self, cloud_requirements: CloudRequirementsLoader) -> Self {
        self.cloud_requirements = cloud_requirements;
        self
    }

    pub fn fallback_cwd(mut self, fallback_cwd: Option<PathBuf>) -> Self {
        self.fallback_cwd = fallback_cwd;
        self
    }

    pub async fn build(self) -> std::io::Result<Config> {
        let Self {
            lyra_home,
            cli_overrides,
            harness_overrides,
            loader_overrides,
            cloud_requirements,
            fallback_cwd,
        } = self;
        let lyra_home = match lyra_home {
            Some(lyra_home) => AbsolutePathBuf::from_absolute_path(lyra_home)?,
            None => find_lyra_home()?,
        };
        let cli_overrides = cli_overrides.unwrap_or_default();
        let mut harness_overrides = harness_overrides.unwrap_or_default();
        let loader_overrides = loader_overrides.unwrap_or_default();
        let cwd_override = harness_overrides.cwd.as_deref().or(fallback_cwd.as_deref());
        let cwd = match cwd_override {
            Some(path) => AbsolutePathBuf::relative_to_current_dir(path)?,
            None => AbsolutePathBuf::current_dir()?,
        };
        harness_overrides.cwd = Some(cwd.to_path_buf());
        let config_layer_stack = load_config_layers_state(
            LOCAL_FS.as_ref(),
            &lyra_home,
            Some(cwd),
            &cli_overrides,
            loader_overrides,
            cloud_requirements,
        )
        .await?;
        let merged_toml = config_layer_stack.effective_config();

        // Note that each layer in ConfigLayerStack should have resolved
        // relative paths to absolute paths based on the parent folder of the
        // respective config file, so we should be safe to deserialize without
        // AbsolutePathBufGuard here.
        let config_toml: ConfigToml = match merged_toml.try_into() {
            Ok(config_toml) => config_toml,
            Err(err) => {
                if let Some(config_error) =
                    crate::config_loader::first_layer_config_error(&config_layer_stack).await
                {
                    return Err(crate::config_loader::io_error_from_config_error(
                        std::io::ErrorKind::InvalidData,
                        config_error,
                        Some(err),
                    ));
                }
                return Err(std::io::Error::new(std::io::ErrorKind::InvalidData, err));
            }
        };
        Config::load_config_with_layer_stack(
            LOCAL_FS.as_ref(),
            config_toml,
            harness_overrides,
            lyra_home,
            config_layer_stack,
        )
        .await
    }

    #[cfg(test)]
    pub(crate) fn without_managed_config_for_tests() -> Self {
        Self::default().loader_overrides(LoaderOverrides::without_managed_config_for_tests())
    }
}

impl Config {
    pub fn to_models_manager_config(&self) -> ModelsManagerConfig {
        ModelsManagerConfig {
            model_context_window: self.model_context_window,
            tool_output_token_limit: self.tool_output_token_limit,
            base_instructions: self.base_instructions.clone(),
            model_supports_reasoning_summaries: self.model_supports_reasoning_summaries,
            model_catalog: self.model_catalog.clone(),
            provider_model_catalogs: self.provider_model_catalogs.clone(),
        }
    }

    pub async fn to_mcp_config(
        &self,
        plugins_manager: &crate::plugins::PluginsManager,
    ) -> McpConfig {
        let loaded_plugins = plugins_manager.plugins_for_config(self).await;
        let mut configured_mcp_servers = self.mcp_servers.get().clone();
        for (name, plugin_server) in loaded_plugins.effective_mcp_servers() {
            configured_mcp_servers.entry(name).or_insert(plugin_server);
        }

        McpConfig {
            lyra_home: self.lyra_home.to_path_buf(),
            mcp_oauth_credentials_store_mode: self.mcp_oauth_credentials_store_mode,
            mcp_oauth_callback_port: self.mcp_oauth_callback_port,
            mcp_oauth_callback_url: self.mcp_oauth_callback_url.clone(),
            skill_mcp_dependency_install_enabled: self
                .features
                .enabled(Feature::SkillMcpDependencyInstall),
            approval_policy: self.permissions.approval_policy.clone(),
            lyra_linux_sandbox_exe: self.lyra_linux_sandbox_exe.clone(),
            use_classic_landlock: self.features.use_classic_landlock(),
            apps_enabled: self.features.enabled(Feature::Apps),
            configured_mcp_servers,
            plugin_capability_summaries: loaded_plugins.capability_summaries().to_vec(),
        }
    }

    /// This is the preferred way to create an instance of [Config].
    pub async fn load_with_cli_overrides(
        cli_overrides: Vec<(String, TomlValue)>,
    ) -> std::io::Result<Self> {
        ConfigBuilder::default()
            .cli_overrides(cli_overrides)
            .build()
            .await
    }

    /// Load a default configuration when user config files are invalid.
    pub async fn load_default_with_cli_overrides(
        cli_overrides: Vec<(String, TomlValue)>,
    ) -> std::io::Result<Self> {
        let lyra_home = find_lyra_home()?;
        Self::load_default_with_cli_overrides_for_lyra_home(lyra_home.to_path_buf(), cli_overrides)
            .await
    }

    /// Load a default configuration for a specific Lyra runtime home without reading
    /// user, project, or system config layers.
    pub async fn load_default_with_cli_overrides_for_lyra_home(
        lyra_home: PathBuf,
        cli_overrides: Vec<(String, TomlValue)>,
    ) -> std::io::Result<Self> {
        let mut merged = toml::Value::try_from(ConfigToml::default()).map_err(|e| {
            std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                format!("failed to serialize default config: {e}"),
            )
        })?;
        let cli_layer = crate::config_loader::build_cli_overrides_layer(&cli_overrides);
        crate::config_loader::merge_toml_values(&mut merged, &cli_layer);
        let lyra_home = AbsolutePathBuf::from_absolute_path_checked(lyra_home)?;
        let config_toml = deserialize_config_toml_with_base(merged, &lyra_home)?;
        Self::load_config_with_layer_stack(
            LOCAL_FS.as_ref(),
            config_toml,
            ConfigOverrides::default(),
            lyra_home,
            ConfigLayerStack::default(),
        )
        .await
    }

    /// This is a secondary way of creating [Config], which is appropriate when
    /// the harness is meant to be used with a specific configuration that
    /// ignores user settings. For example, the `lyra exec` subcommand is
    /// designed to use [AskForApproval::Never] exclusively.
    ///
    /// Further, [ConfigOverrides] contains some options that are not supported
    /// in [ConfigToml], such as `cwd`, `lyra_self_exe`, `lyra_linux_sandbox_exe`, and
    /// `main_execve_wrapper_exe`.
    pub async fn load_with_cli_overrides_and_harness_overrides(
        cli_overrides: Vec<(String, TomlValue)>,
        harness_overrides: ConfigOverrides,
    ) -> std::io::Result<Self> {
        ConfigBuilder::default()
            .cli_overrides(cli_overrides)
            .harness_overrides(harness_overrides)
            .build()
            .await
    }
}

/// DEPRECATED: Use [Config::load_with_cli_overrides()] instead because working
/// with [ConfigToml] directly means that [ConfigRequirements] have not been
/// applied yet, which risks failing to enforce required constraints.
pub async fn load_config_as_toml_with_cli_overrides(
    lyra_home: &Path,
    cwd: Option<&AbsolutePathBuf>,
    cli_overrides: Vec<(String, TomlValue)>,
) -> std::io::Result<ConfigToml> {
    let config_layer_stack = load_config_layers_state(
        LOCAL_FS.as_ref(),
        lyra_home,
        cwd.cloned(),
        &cli_overrides,
        LoaderOverrides::default(),
        CloudRequirementsLoader::default(),
    )
    .await?;

    let merged_toml = config_layer_stack.effective_config();
    let cfg = deserialize_config_toml_with_base(merged_toml, lyra_home).map_err(|e| {
        tracing::error!("Failed to deserialize overridden config: {e}");
        e
    })?;

    Ok(cfg)
}

pub(crate) fn deserialize_config_toml_with_base(
    root_value: TomlValue,
    config_base_dir: &Path,
) -> std::io::Result<ConfigToml> {
    // This guard ensures that any relative paths that is deserialized into an
    // [AbsolutePathBuf] is resolved against `config_base_dir`.
    let _guard = AbsolutePathBufGuard::new(config_base_dir);
    root_value
        .try_into()
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))
}

fn load_catalog_json(path: &AbsolutePathBuf) -> std::io::Result<ModelsResponse> {
    let file_contents = std::fs::read_to_string(path)?;
    let catalog = serde_json::from_str::<ModelsResponse>(&file_contents).map_err(|err| {
        std::io::Error::new(
            ErrorKind::InvalidData,
            format!(
                "failed to parse model_catalog_json path `{}` as JSON: {err}",
                path.display()
            ),
        )
    })?;
    if catalog.models.is_empty() {
        return Err(std::io::Error::new(
            ErrorKind::InvalidData,
            format!(
                "model_catalog_json path `{}` must contain at least one model",
                path.display()
            ),
        ));
    }
    Ok(catalog)
}

fn load_model_catalog(
    model_catalog_json: Option<AbsolutePathBuf>,
) -> std::io::Result<Option<ModelsResponse>> {
    model_catalog_json
        .map(|path| load_catalog_json(&path))
        .transpose()
}

fn filter_mcp_servers_by_requirements(
    mcp_servers: &mut HashMap<String, McpServerConfig>,
    mcp_requirements: Option<&Sourced<BTreeMap<String, McpServerRequirement>>>,
) {
    let Some(allowlist) = mcp_requirements else {
        return;
    };

    let source = allowlist.source.clone();
    for (name, server) in mcp_servers.iter_mut() {
        let allowed = allowlist
            .value
            .get(name)
            .is_some_and(|requirement| mcp_server_matches_requirement(requirement, server));
        if allowed {
            server.disabled_reason = None;
        } else {
            server.enabled = false;
            server.disabled_reason = Some(McpServerDisabledReason::Requirements {
                source: source.clone(),
            });
        }
    }
}

fn constrain_mcp_servers(
    mcp_servers: HashMap<String, McpServerConfig>,
    mcp_requirements: Option<&Sourced<BTreeMap<String, McpServerRequirement>>>,
) -> ConstraintResult<Constrained<HashMap<String, McpServerConfig>>> {
    if mcp_requirements.is_none() {
        return Ok(Constrained::allow_any(mcp_servers));
    }

    let mcp_requirements = mcp_requirements.cloned();
    Constrained::normalized(mcp_servers, move |mut servers| {
        filter_mcp_servers_by_requirements(&mut servers, mcp_requirements.as_ref());
        servers
    })
}

fn apply_requirement_constrained_value<T>(
    field_name: &'static str,
    configured_value: T,
    constrained_value: &mut ConstrainedWithSource<T>,
    startup_warnings: &mut Vec<String>,
) -> std::io::Result<()>
where
    T: Clone + std::fmt::Debug + Send + Sync,
{
    if let Err(err) = constrained_value.set(configured_value) {
        let fallback_value = constrained_value.get().clone();
        tracing::warn!(
            error = %err,
            ?fallback_value,
            requirement_source = ?constrained_value.source,
            "configured value is disallowed by requirements; falling back to required value for {field_name}"
        );
        let message = format!(
            "Configured value for `{field_name}` is disallowed by requirements; falling back to required value {fallback_value:?}. Details: {err}"
        );
        startup_warnings.push(message);

        constrained_value.set(fallback_value).map_err(|fallback_err| {
            std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                format!(
                    "configured value for `{field_name}` is disallowed by requirements ({err}); fallback to a requirement-compliant value also failed ({fallback_err})"
                ),
            )
        })?;
    }

    Ok(())
}

fn mcp_server_matches_requirement(
    requirement: &McpServerRequirement,
    server: &McpServerConfig,
) -> bool {
    match &requirement.identity {
        McpServerIdentity::Command {
            command: want_command,
        } => matches!(
            &server.transport,
            McpServerTransportConfig::Stdio { command: got_command, .. }
                if got_command == want_command
        ),
        McpServerIdentity::Url { url: want_url } => matches!(
            &server.transport,
            McpServerTransportConfig::StreamableHttp { url: got_url, .. }
                if got_url == want_url
        ),
    }
}

pub async fn load_global_mcp_servers(
    lyra_home: &Path,
) -> std::io::Result<BTreeMap<String, McpServerConfig>> {
    // In general, Config::load_with_cli_overrides() should be used to load the
    // full config with requirements.toml applied, but in this case, we need
    // access to the raw TOML in order to warn the user about deprecated fields.
    //
    // Note that a more precise way to do this would be to audit the individual
    // config layers for deprecated fields rather than reporting on the merged
    // result.
    let cli_overrides = Vec::<(String, TomlValue)>::new();
    // There is no cwd/project context for this query, so this will not include
    // MCP servers defined in in-repo .lyra/ folders.
    let cwd: Option<AbsolutePathBuf> = None;
    let config_layer_stack = load_config_layers_state(
        LOCAL_FS.as_ref(),
        lyra_home,
        cwd,
        &cli_overrides,
        LoaderOverrides::default(),
        CloudRequirementsLoader::default(),
    )
    .await?;
    let merged_toml = config_layer_stack.effective_config();
    let Some(servers_value) = merged_toml.get("mcp_servers") else {
        return Ok(BTreeMap::new());
    };

    ensure_no_inline_bearer_tokens(servers_value)?;

    servers_value
        .clone()
        .try_into()
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))
}

/// We briefly allowed plain text bearer_token fields in MCP server configs.
/// We want to warn people who recently added these fields but can remove this after a few months.
fn ensure_no_inline_bearer_tokens(value: &TomlValue) -> std::io::Result<()> {
    let Some(servers_table) = value.as_table() else {
        return Ok(());
    };

    for (server_name, server_value) in servers_table {
        if let Some(server_table) = server_value.as_table()
            && server_table.contains_key("bearer_token")
        {
            let message = format!(
                "mcp_servers.{server_name} uses unsupported `bearer_token`; set `bearer_token_env_var`."
            );
            return Err(std::io::Error::new(ErrorKind::InvalidData, message));
        }
    }

    Ok(())
}

pub(crate) fn set_project_trust_level_inner(
    doc: &mut DocumentMut,
    project_path: &Path,
    trust_level: TrustLevel,
) -> anyhow::Result<()> {
    // Ensure we render a human-friendly structure:
    //
    // [projects]
    // [projects."/path/to/project"]
    // trust_level = "trusted" or "untrusted"
    //
    // rather than inline tables like:
    //
    // [projects]
    // "/path/to/project" = { trust_level = "trusted" }
    let project_key = project_trust_key(project_path);

    // Ensure top-level `projects` exists as a non-inline, explicit table. If it
    // exists but was previously represented as a non-table (e.g., inline),
    // replace it with an explicit table.
    {
        let root = doc.as_table_mut();
        // If `projects` exists but isn't a standard table (e.g., it's an inline table),
        // convert it to an explicit table while preserving existing entries.
        let existing_projects = root.get("projects").cloned();
        if existing_projects.as_ref().is_none_or(|i| !i.is_table()) {
            let mut projects_tbl = toml_edit::Table::new();
            projects_tbl.set_implicit(true);

            // If there was an existing inline table, migrate its entries to explicit tables.
            if let Some(inline_tbl) = existing_projects.as_ref().and_then(|i| i.as_inline_table()) {
                for (k, v) in inline_tbl.iter() {
                    if let Some(inner_tbl) = v.as_inline_table() {
                        let new_tbl = inner_tbl.clone().into_table();
                        projects_tbl.insert(k, toml_edit::Item::Table(new_tbl));
                    }
                }
            }

            root.insert("projects", toml_edit::Item::Table(projects_tbl));
        }
    }
    let Some(projects_tbl) = doc["projects"].as_table_mut() else {
        return Err(anyhow::anyhow!(
            "projects table missing after initialization"
        ));
    };

    // Ensure the per-project entry is its own explicit table. If it exists but
    // is not a table (e.g., an inline table), replace it with an explicit table.
    let needs_proj_table = !projects_tbl.contains_key(project_key.as_str())
        || projects_tbl
            .get(project_key.as_str())
            .and_then(|i| i.as_table())
            .is_none();
    if needs_proj_table {
        projects_tbl.insert(project_key.as_str(), toml_edit::table());
    }
    let Some(proj_tbl) = projects_tbl
        .get_mut(project_key.as_str())
        .and_then(|i| i.as_table_mut())
    else {
        return Err(anyhow::anyhow!("project table missing for {project_key}"));
    };
    proj_tbl.set_implicit(false);
    proj_tbl["trust_level"] = toml_edit::value(trust_level.to_string());
    Ok(())
}

/// Patch the active Lyra home `config.toml` project state to set trust level.
/// Use with caution.
pub fn set_project_trust_level(
    lyra_home: &Path,
    project_path: &Path,
    trust_level: TrustLevel,
) -> anyhow::Result<()> {
    use crate::config::edit::ConfigEditsBuilder;

    ConfigEditsBuilder::new(lyra_home)
        .set_project_trust_level(project_path, trust_level)
        .apply_blocking()
}

/// Save the default OSS provider preference to config.toml
pub fn set_default_oss_provider(lyra_home: &Path, provider: &str) -> std::io::Result<()> {
    lyra_config::config_toml::validate_oss_provider(provider)?;
    use toml_edit::value;

    let edits = [ConfigEdit::SetPath {
        segments: vec!["oss_provider".to_string()],
        value: value(provider),
    }];

    ConfigEditsBuilder::new(lyra_home)
        .with_edits(edits)
        .apply_blocking()
        .map_err(|err| std::io::Error::other(format!("failed to persist config.toml: {err}")))
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct AgentRoleConfig {
    /// Human-facing role documentation used in spawn tool guidance.
    /// Required for loaded user-defined roles after deprecated/new metadata precedence resolves.
    pub description: Option<String>,
    /// Path to a role-specific config layer.
    pub config_file: Option<PathBuf>,
    /// Candidate nicknames for agents spawned with this role.
    pub nickname_candidates: Option<Vec<String>>,
}

fn resolve_tool_suggest_config(config_toml: &ConfigToml) -> ToolSuggestConfig {
    let discoverables = config_toml
        .tool_suggest
        .as_ref()
        .into_iter()
        .flat_map(|tool_suggest| tool_suggest.discoverables.iter())
        .filter_map(|discoverable| {
            let trimmed = discoverable.id.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(ToolSuggestDiscoverable {
                    kind: discoverable.kind,
                    id: trimmed.to_string(),
                })
            }
        })
        .collect();

    ToolSuggestConfig { discoverables }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PermissionConfigSyntax {
    Legacy,
    Profiles,
}

#[derive(Debug, Deserialize, Default)]
struct PermissionSelectionToml {
    default_permissions: Option<String>,
    sandbox_mode: Option<SandboxMode>,
}

fn resolve_permission_config_syntax(
    config_layer_stack: &ConfigLayerStack,
    cfg: &ConfigToml,
    sandbox_mode_override: Option<SandboxMode>,
    profile_sandbox_mode: Option<SandboxMode>,
) -> Option<PermissionConfigSyntax> {
    if sandbox_mode_override.is_some() || profile_sandbox_mode.is_some() {
        return Some(PermissionConfigSyntax::Legacy);
    }

    let mut selection = None;
    for layer in config_layer_stack.get_layers(
        ConfigLayerStackOrdering::LowestPrecedenceFirst,
        /*include_disabled*/ false,
    ) {
        let Ok(layer_selection) = layer.config.clone().try_into::<PermissionSelectionToml>() else {
            continue;
        };

        if layer_selection.sandbox_mode.is_some() {
            selection = Some(PermissionConfigSyntax::Legacy);
        }
        if layer_selection.default_permissions.is_some() {
            selection = Some(PermissionConfigSyntax::Profiles);
        }
    }

    selection.or_else(|| {
        if cfg.default_permissions.is_some() {
            Some(PermissionConfigSyntax::Profiles)
        } else if cfg.sandbox_mode.is_some() {
            Some(PermissionConfigSyntax::Legacy)
        } else {
            None
        }
    })
}

fn apply_managed_filesystem_constraints(
    file_system_sandbox_policy: &mut FileSystemSandboxPolicy,
    filesystem_constraints: &crate::config_loader::FilesystemConstraints,
) {
    for deny_read in &filesystem_constraints.deny_read {
        let deny_entry = if deny_read.contains_glob() {
            lyra_protocol::permissions::FileSystemSandboxEntry {
                path: lyra_protocol::permissions::FileSystemPath::GlobPattern {
                    pattern: deny_read.as_str().to_string(),
                },
                access: lyra_protocol::permissions::FileSystemAccessMode::None,
            }
        } else {
            let Ok(path) = AbsolutePathBuf::try_from(deny_read.as_str()) else {
                continue;
            };
            lyra_protocol::permissions::FileSystemSandboxEntry {
                path: lyra_protocol::permissions::FileSystemPath::Path { path },
                access: lyra_protocol::permissions::FileSystemAccessMode::None,
            }
        };
        if !file_system_sandbox_policy
            .entries
            .iter()
            .any(|existing| existing == &deny_entry)
        {
            file_system_sandbox_policy.entries.push(deny_entry);
        }
    }
}

/// Optional overrides for user configuration (e.g., from CLI flags).
#[derive(Default, Debug, Clone)]
pub struct ConfigOverrides {
    pub model: Option<String>,
    pub review_model: Option<String>,
    pub cwd: Option<PathBuf>,
    pub approval_policy: Option<AskForApproval>,
    pub approvals_reviewer: Option<ApprovalsReviewer>,
    pub sandbox_mode: Option<SandboxMode>,
    pub model_provider: Option<String>,
    pub service_tier: Option<Option<ServiceTier>>,
    pub config_profile: Option<String>,
    pub lyra_self_exe: Option<PathBuf>,
    pub lyra_linux_sandbox_exe: Option<PathBuf>,
    pub main_execve_wrapper_exe: Option<PathBuf>,
    pub js_repl_node_path: Option<PathBuf>,
    pub js_repl_node_module_dirs: Option<Vec<PathBuf>>,
    pub zsh_path: Option<PathBuf>,
    pub base_instructions: Option<String>,
    pub developer_instructions: Option<String>,
    pub include_apply_patch_tool: Option<bool>,
    pub show_raw_agent_reasoning: Option<bool>,
    pub tools_web_search_request: Option<bool>,
    pub ephemeral: Option<bool>,
    /// Additional directories that should be treated as writable roots for this session.
    pub additional_writable_roots: Vec<PathBuf>,
}

/// Resolves the OSS provider from CLI override, profile config, or global config.
/// Returns `None` if no provider is configured at any level.
pub fn resolve_oss_provider(
    explicit_provider: Option<&str>,
    config_toml: &ConfigToml,
    config_profile: Option<String>,
) -> Option<String> {
    if let Some(provider) = explicit_provider {
        // Explicit provider specified (e.g., via --local-provider)
        Some(provider.to_string())
    } else {
        // Check profile config first, then global config
        let profile = config_toml.get_config_profile(config_profile).ok();
        if let Some(profile) = &profile {
            // Check if profile has an oss provider
            if let Some(profile_oss_provider) = &profile.oss_provider {
                Some(profile_oss_provider.clone())
            }
            // If not then check if the toml has an oss provider
            else {
                config_toml.oss_provider.clone()
            }
        } else {
            config_toml.oss_provider.clone()
        }
    }
}

/// Resolve the web search mode from explicit config and feature flags.
fn resolve_web_search_mode(
    config_toml: &ConfigToml,
    config_profile: &ConfigProfile,
    features: &Features,
) -> Option<WebSearchMode> {
    if let Some(mode) = config_profile.web_search.or(config_toml.web_search) {
        return Some(mode);
    }
    if features.enabled(Feature::WebSearchCached) {
        return Some(WebSearchMode::Cached);
    }
    if features.enabled(Feature::WebSearchRequest) {
        return Some(WebSearchMode::Live);
    }
    None
}

fn resolve_web_search_config(
    config_toml: &ConfigToml,
    config_profile: &ConfigProfile,
) -> Option<WebSearchConfig> {
    let base = config_toml
        .tools
        .as_ref()
        .and_then(|tools| tools.web_search.as_ref());
    let profile = config_profile
        .tools
        .as_ref()
        .and_then(|tools| tools.web_search.as_ref());

    match (base, profile) {
        (None, None) => None,
        (Some(base), None) => Some(base.clone().into()),
        (None, Some(profile)) => Some(profile.clone().into()),
        (Some(base), Some(profile)) => Some(base.merge(profile).into()),
    }
}

fn resolve_multi_agent_v2_config(
    config_toml: &ConfigToml,
    config_profile: &ConfigProfile,
) -> MultiAgentV2Config {
    let base = multi_agent_v2_toml_config(config_toml.features.as_ref());
    let profile = multi_agent_v2_toml_config(config_profile.features.as_ref());
    let default = MultiAgentV2Config::default();

    let usage_hint_enabled = profile
        .and_then(|config| config.usage_hint_enabled)
        .or_else(|| base.and_then(|config| config.usage_hint_enabled))
        .unwrap_or(default.usage_hint_enabled);
    let usage_hint_text = profile
        .and_then(|config| config.usage_hint_text.as_ref())
        .or_else(|| base.and_then(|config| config.usage_hint_text.as_ref()))
        .cloned()
        .or(default.usage_hint_text);
    let hide_spawn_agent_metadata = profile
        .and_then(|config| config.hide_spawn_agent_metadata)
        .or_else(|| base.and_then(|config| config.hide_spawn_agent_metadata))
        .unwrap_or(default.hide_spawn_agent_metadata);

    MultiAgentV2Config {
        usage_hint_enabled,
        usage_hint_text,
        hide_spawn_agent_metadata,
    }
}

fn multi_agent_v2_toml_config(features: Option<&FeaturesToml>) -> Option<&MultiAgentV2ConfigToml> {
    match features?.multi_agent_v2.as_ref()? {
        FeatureToml::Enabled(_) => None,
        FeatureToml::Config(config) => Some(config),
    }
}

pub(crate) fn resolve_web_search_mode_for_turn(
    web_search_mode: &Constrained<WebSearchMode>,
    sandbox_policy: &SandboxPolicy,
) -> WebSearchMode {
    let preferred = web_search_mode.value();

    if matches!(sandbox_policy, SandboxPolicy::DangerFullAccess)
        && preferred != WebSearchMode::Disabled
    {
        for mode in [
            WebSearchMode::Live,
            WebSearchMode::Cached,
            WebSearchMode::Disabled,
        ] {
            if web_search_mode.can_set(&mode).is_ok() {
                return mode;
            }
        }
    } else {
        if web_search_mode.can_set(&preferred).is_ok() {
            return preferred;
        }
        for mode in [
            WebSearchMode::Cached,
            WebSearchMode::Live,
            WebSearchMode::Disabled,
        ] {
            if web_search_mode.can_set(&mode).is_ok() {
                return mode;
            }
        }
    }

    WebSearchMode::Disabled
}

impl Config {
    #[cfg(test)]
    async fn load_from_base_config_with_overrides(
        cfg: ConfigToml,
        overrides: ConfigOverrides,
        lyra_home: AbsolutePathBuf,
    ) -> std::io::Result<Self> {
        // Note this ignores requirements.toml enforcement for tests.
        let config_layer_stack = ConfigLayerStack::default();
        Self::load_config_with_layer_stack(
            LOCAL_FS.as_ref(),
            cfg,
            overrides,
            lyra_home,
            config_layer_stack,
        )
        .await
    }

    pub(crate) async fn load_config_with_layer_stack(
        fs: &dyn ExecutorFileSystem,
        cfg: ConfigToml,
        overrides: ConfigOverrides,
        lyra_home: AbsolutePathBuf,
        config_layer_stack: ConfigLayerStack,
    ) -> std::io::Result<Self> {
        // Keep the large config-construction future off small test thread stacks.
        Box::pin(async move {
        validate_model_providers(&cfg.model_providers)
            .map_err(|message| std::io::Error::new(std::io::ErrorKind::InvalidInput, message))?;
        // Ensure that every field of ConfigRequirements is applied to the final
        // Config.
        let ConfigRequirements {
            approval_policy: mut constrained_approval_policy,
            approvals_reviewer: mut constrained_approvals_reviewer,
            sandbox_policy: mut constrained_sandbox_policy,
            web_search_mode: mut constrained_web_search_mode,
            feature_requirements,
            mcp_servers,
            exec_policy: _,
            enforce_residency,
            network: network_requirements,
            filesystem: filesystem_requirements,
        } = config_layer_stack.requirements().clone();

        let user_instructions = AgentsMdManager::load_global_instructions(Some(&lyra_home))
            .map(|loaded| loaded.contents);
        let mut startup_warnings = Vec::new();

        // Destructure ConfigOverrides fully to ensure all overrides are applied.
        let ConfigOverrides {
            model,
            review_model: override_review_model,
            cwd,
            approval_policy: approval_policy_override,
            approvals_reviewer: approvals_reviewer_override,
            sandbox_mode,
            model_provider,
            service_tier: service_tier_override,
            config_profile: config_profile_key,
            lyra_self_exe,
            lyra_linux_sandbox_exe,
            main_execve_wrapper_exe,
            js_repl_node_path: js_repl_node_path_override,
            js_repl_node_module_dirs: js_repl_node_module_dirs_override,
            zsh_path: zsh_path_override,
            base_instructions,
            developer_instructions,
            include_apply_patch_tool: include_apply_patch_tool_override,
            show_raw_agent_reasoning,
            tools_web_search_request: override_tools_web_search_request,
            ephemeral,
            additional_writable_roots,
        } = overrides;

        let active_profile_name = config_profile_key
            .as_ref()
            .or(cfg.profile.as_ref())
            .cloned();
        let config_profile = match active_profile_name.as_ref() {
            Some(key) => cfg
                .profiles
                .get(key)
                .ok_or_else(|| {
                    std::io::Error::new(
                        std::io::ErrorKind::NotFound,
                        format!("config profile `{key}` not found"),
                    )
                })?
                .clone(),
            None => ConfigProfile::default(),
        };
        let tool_suggest = resolve_tool_suggest_config(&cfg);
        let feature_overrides = FeatureOverrides {
            include_apply_patch_tool: include_apply_patch_tool_override,
            web_search_request: override_tools_web_search_request,
        };

        let configured_features = Features::from_sources(
            FeatureConfigSource {
                features: cfg.features.as_ref(),
            },
            FeatureConfigSource {
                features: config_profile.features.as_ref(),
            },
            feature_overrides,
        );
        let features = ManagedFeatures::from_configured(configured_features, feature_requirements)?;
        let windows_sandbox_mode = resolve_windows_sandbox_mode(&cfg, &config_profile);
        let windows_sandbox_private_desktop =
            resolve_windows_sandbox_private_desktop(&cfg, &config_profile);
        let resolved_cwd = AbsolutePathBuf::try_from(normalize_for_native_workdir({
            use std::env;

            match cwd {
                None => {
                    tracing::info!("cwd not set, using current dir");
                    env::current_dir()?
                }
                Some(p) if p.is_absolute() => p,
                Some(p) => {
                    // Resolve relative path against the current working directory.
                    tracing::info!("cwd is relative, resolving against current dir");
                    let mut current = env::current_dir()?;
                    current.push(p);
                    current
                }
            }
        }))?;
        let mut additional_writable_roots: Vec<AbsolutePathBuf> = additional_writable_roots
            .into_iter()
            .map(|path| AbsolutePathBuf::resolve_path_against_base(path, resolved_cwd.as_path()))
            .collect();
        let repo_root = resolve_root_git_project_for_trust(fs, &resolved_cwd).await;
        let active_project = cfg
            .get_active_project(
                resolved_cwd.as_path(),
                repo_root.as_ref().map(AbsolutePathBuf::as_path),
            )
            .unwrap_or(ProjectConfig { trust_level: None });
        let permission_config_syntax = resolve_permission_config_syntax(
            &config_layer_stack,
            &cfg,
            sandbox_mode,
            config_profile.sandbox_mode,
        );
        let has_permission_profiles = cfg
            .permissions
            .as_ref()
            .is_some_and(|profiles| !profiles.is_empty());
        if has_permission_profiles
            && !matches!(
                permission_config_syntax,
                Some(PermissionConfigSyntax::Legacy)
            )
            && cfg.default_permissions.is_none()
        {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "config defines `[permissions]` profiles but does not set `default_permissions`",
            ));
        }

        let windows_sandbox_level = match windows_sandbox_mode {
            Some(WindowsSandboxModeToml::Elevated) => WindowsSandboxLevel::Elevated,
            Some(WindowsSandboxModeToml::Unelevated) => WindowsSandboxLevel::RestrictedToken,
            None => WindowsSandboxLevel::from_features(&features),
        };
        let memories_root = memory_root(&lyra_home);
        std::fs::create_dir_all(&memories_root)?;
        if !additional_writable_roots
            .iter()
            .any(|existing| existing == &memories_root)
        {
            additional_writable_roots.push(memories_root);
        }

        let profiles_are_active = matches!(
            permission_config_syntax,
            Some(PermissionConfigSyntax::Profiles)
        ) || (permission_config_syntax.is_none()
            && has_permission_profiles);
        let (
            configured_network_proxy_config,
            sandbox_policy,
            file_system_sandbox_policy,
            network_sandbox_policy,
        ) = if profiles_are_active {
            let permissions = cfg.permissions.as_ref().ok_or_else(|| {
                std::io::Error::new(
                    std::io::ErrorKind::InvalidInput,
                    "default_permissions requires a `[permissions]` table",
                )
            })?;
            let default_permissions = cfg.default_permissions.as_deref().ok_or_else(|| {
                std::io::Error::new(
                    std::io::ErrorKind::InvalidInput,
                    "default_permissions requires a named permissions profile",
                )
            })?;
            let profile = resolve_permission_profile(permissions, default_permissions)?;
            let configured_network_proxy_config =
                network_proxy_config_from_profile_network(profile.network.as_ref());
            let (mut file_system_sandbox_policy, network_sandbox_policy) =
                compile_permission_profile(
                    permissions,
                    default_permissions,
                    resolved_cwd.as_path(),
                    &mut startup_warnings,
                )?;
            let mut sandbox_policy = file_system_sandbox_policy
                .to_sandbox_policy(network_sandbox_policy, resolved_cwd.as_path())?;
            if matches!(sandbox_policy, SandboxPolicy::WorkspaceWrite { .. }) {
                file_system_sandbox_policy = file_system_sandbox_policy
                    .with_additional_writable_roots(
                        resolved_cwd.as_path(),
                        &additional_writable_roots,
                    );
                sandbox_policy = file_system_sandbox_policy
                    .to_sandbox_policy(network_sandbox_policy, resolved_cwd.as_path())?;
            }
            (
                configured_network_proxy_config,
                sandbox_policy,
                file_system_sandbox_policy,
                network_sandbox_policy,
            )
        } else {
            let configured_network_proxy_config = NetworkProxyConfig::default();
            let mut sandbox_policy = cfg
                .derive_sandbox_policy(
                    sandbox_mode,
                    config_profile.sandbox_mode,
                    windows_sandbox_level,
                    Some(&active_project),
                    Some(&constrained_sandbox_policy),
                )
                .await;
            if let SandboxPolicy::WorkspaceWrite { writable_roots, .. } = &mut sandbox_policy {
                for path in &additional_writable_roots {
                    if !writable_roots.iter().any(|existing| existing == path) {
                        writable_roots.push(path.clone());
                    }
                }
            }
            let file_system_sandbox_policy = FileSystemSandboxPolicy::from_sandbox_policy(
                &sandbox_policy,
                resolved_cwd.as_path(),
            );
            let network_sandbox_policy = NetworkSandboxPolicy::from(&sandbox_policy);
            (
                configured_network_proxy_config,
                sandbox_policy,
                file_system_sandbox_policy,
                network_sandbox_policy,
            )
        };
        let approval_policy_was_explicit = approval_policy_override.is_some()
            || config_profile.approval_policy.is_some()
            || cfg.approval_policy.is_some();
        let mut approval_policy = approval_policy_override
            .or(config_profile.approval_policy)
            .or(cfg.approval_policy)
            .unwrap_or_else(|| {
                if active_project.is_trusted() {
                    AskForApproval::OnRequest
                } else if active_project.is_untrusted() {
                    AskForApproval::UnlessTrusted
                } else {
                    AskForApproval::default()
                }
            });
        if !approval_policy_was_explicit
            && let Err(err) = constrained_approval_policy.can_set(&approval_policy)
        {
            tracing::warn!(
                error = %err,
                "default approval policy is disallowed by requirements; falling back to required default"
            );
            approval_policy = constrained_approval_policy.value();
        }
        let approvals_reviewer_was_explicit = approvals_reviewer_override.is_some()
            || config_profile.approvals_reviewer.is_some()
            || cfg.approvals_reviewer.is_some();
        let mut approvals_reviewer = approvals_reviewer_override
            .or(config_profile.approvals_reviewer)
            .or(cfg.approvals_reviewer)
            .unwrap_or(ApprovalsReviewer::User);
        if !approvals_reviewer_was_explicit
            && let Err(err) = constrained_approvals_reviewer.can_set(&approvals_reviewer)
        {
            tracing::warn!(
                error = %err,
                "default approvals reviewer is disallowed by requirements; falling back to required default"
            );
            approvals_reviewer = constrained_approvals_reviewer.value();
        }
        let web_search_mode = resolve_web_search_mode(&cfg, &config_profile, &features)
            .unwrap_or(WebSearchMode::Cached);
        let web_search_config = resolve_web_search_config(&cfg, &config_profile);
        let multi_agent_v2 = resolve_multi_agent_v2_config(&cfg, &config_profile);

        let agent_roles =
            agent_roles::load_agent_roles(fs, &cfg, &config_layer_stack, &mut startup_warnings)
                .await?;

        let openai_base_url = cfg
            .openai_base_url
            .clone()
            .filter(|value| !value.is_empty());

        let mut model_providers = built_in_model_providers(openai_base_url);
        // Merge user-defined providers into the built-in list.
        for (key, provider) in cfg.model_providers.into_iter() {
            model_providers.entry(key).or_insert(provider);
        }

        let lyra_profile_projection = load_lyra_profile_provider_projection(lyra_home.as_path()).await;
        for (runtime_provider_id, provider) in lyra_profile_projection.providers {
            model_providers.insert(runtime_provider_id, provider);
        }
        let provider_model_catalogs = lyra_profile_projection.provider_model_catalogs;
        let lyra_default_profile_provider = lyra_profile_projection
            .default_runtime_provider_id
            .filter(|provider_id| model_providers.contains_key(provider_id));

        let model_provider_id = model_provider
            .or(config_profile.model_provider)
            .or(cfg.model_provider)
            .or(lyra_default_profile_provider)
            .unwrap_or_else(|| LMSTUDIO_OSS_PROVIDER_ID.to_string());
        let model_provider = model_providers
            .get(&model_provider_id)
            .ok_or_else(|| {
                let message = if model_provider_id == LEGACY_OLLAMA_CHAT_PROVIDER_ID {
                    OLLAMA_CHAT_PROVIDER_REMOVED_ERROR.to_string()
                } else {
                    format!("Model provider `{model_provider_id}` not found")
                };
                std::io::Error::new(std::io::ErrorKind::NotFound, message)
            })?
            .clone();

        let shell_environment_policy = cfg.shell_environment_policy.into();
        let allow_login_shell = cfg.allow_login_shell.unwrap_or(true);

        let history = cfg.history.unwrap_or_default();

        let agent_max_threads = cfg
            .agents
            .as_ref()
            .and_then(|agents| agents.max_threads)
            .or(DEFAULT_AGENT_MAX_THREADS);
        if agent_max_threads == Some(0) {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "agents.max_threads must be at least 1",
            ));
        }
        let agent_max_depth = cfg
            .agents
            .as_ref()
            .and_then(|agents| agents.max_depth)
            .unwrap_or(DEFAULT_AGENT_MAX_DEPTH);
        if agent_max_depth < 1 {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "agents.max_depth must be at least 1",
            ));
        }
        let agent_job_max_runtime_seconds = cfg
            .agents
            .as_ref()
            .and_then(|agents| agents.job_max_runtime_seconds)
            .or(DEFAULT_AGENT_JOB_MAX_RUNTIME_SECONDS);
        if agent_job_max_runtime_seconds == Some(0) {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "agents.job_max_runtime_seconds must be at least 1",
            ));
        }
        if let Some(max_runtime_seconds) = agent_job_max_runtime_seconds
            && max_runtime_seconds > i64::MAX as u64
        {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "agents.job_max_runtime_seconds must fit within a 64-bit signed integer",
            ));
        }
        let background_terminal_max_timeout = cfg
            .background_terminal_max_timeout
            .unwrap_or(DEFAULT_MAX_BACKGROUND_TERMINAL_TIMEOUT_MS)
            .max(MIN_EMPTY_YIELD_TIME_MS);

        let ghost_snapshot = {
            let mut config = GhostSnapshotConfig::default();
            if let Some(ghost_snapshot) = cfg.ghost_snapshot.as_ref()
                && let Some(ignore_over_bytes) = ghost_snapshot.ignore_large_untracked_files
            {
                config.ignore_large_untracked_files = if ignore_over_bytes > 0 {
                    Some(ignore_over_bytes)
                } else {
                    None
                };
            }
            if let Some(ghost_snapshot) = cfg.ghost_snapshot.as_ref()
                && let Some(threshold) = ghost_snapshot.ignore_large_untracked_dirs
            {
                config.ignore_large_untracked_dirs =
                    if threshold > 0 { Some(threshold) } else { None };
            }
            if let Some(ghost_snapshot) = cfg.ghost_snapshot.as_ref()
                && let Some(disable_warnings) = ghost_snapshot.disable_warnings
            {
                config.disable_warnings = disable_warnings;
            }
            config
        };

        let include_apply_patch_tool_flag = features.enabled(Feature::ApplyPatchFreeform);
        let use_unified_exec_tool = features.enabled(Feature::UnifiedExec);

        let forced_login_method = cfg.forced_login_method;

        let model = model.or(config_profile.model).or(cfg.model);
        let service_tier = service_tier_override
            .unwrap_or_else(|| config_profile.service_tier.or(cfg.service_tier));
        let service_tier = match service_tier {
            Some(ServiceTier::Flex) => Some(ServiceTier::Flex),
            _ => None,
        };

        let commit_attribution = cfg.commit_attribution;

        // Load base instructions override from a file if specified. If the
        // path is relative, resolve it against the effective cwd so the
        // behaviour matches other path-like config values.
        let model_instructions_path = config_profile
            .model_instructions_file
            .as_ref()
            .or(cfg.model_instructions_file.as_ref());
        let file_base_instructions = Self::try_read_non_empty_file(
            fs,
            model_instructions_path,
            "model instructions file",
        )
        .await?;
        let base_instructions = base_instructions.or(file_base_instructions);
        let developer_instructions = developer_instructions.or(cfg.developer_instructions);
        let include_permissions_instructions = config_profile
            .include_permissions_instructions
            .or(cfg.include_permissions_instructions)
            .unwrap_or(true);
        let include_apps_instructions = config_profile
            .include_apps_instructions
            .or(cfg.include_apps_instructions)
            .unwrap_or(true);
        let include_skill_instructions = cfg
            .skills
            .as_ref()
            .and_then(|skills| skills.include_instructions)
            .unwrap_or(true);
        let include_environment_context = config_profile
            .include_environment_context
            .or(cfg.include_environment_context)
            .unwrap_or(true);
        let auto_review_policy_config =
            auto_review_policy_config_from_requirements(config_layer_stack.requirements_toml());
        let js_repl_node_path = js_repl_node_path_override
            .or(config_profile.js_repl_node_path.map(Into::into))
            .or(cfg.js_repl_node_path.map(Into::into));
        let js_repl_node_module_dirs = js_repl_node_module_dirs_override
            .or_else(|| {
                config_profile
                    .js_repl_node_module_dirs
                    .map(|dirs| dirs.into_iter().map(Into::into).collect::<Vec<PathBuf>>())
            })
            .or_else(|| {
                cfg.js_repl_node_module_dirs
                    .map(|dirs| dirs.into_iter().map(Into::into).collect::<Vec<PathBuf>>())
            })
            .unwrap_or_default();
        let zsh_path = zsh_path_override
            .or(config_profile.zsh_path.map(Into::into))
            .or(cfg.zsh_path.map(Into::into));

        let review_model = override_review_model.or(cfg.review_model);

        let check_for_update_on_startup = cfg.check_for_update_on_startup.unwrap_or(true);
        let model_catalog = load_model_catalog(
            config_profile
                .model_catalog_json
                .clone()
                .or(cfg.model_catalog_json.clone()),
        )?;

        let log_dir = cfg
            .log_dir
            .as_ref()
            .map(AbsolutePathBuf::to_path_buf)
            .unwrap_or_else(|| lyra_home.join("log").to_path_buf());
        let sqlite_home = cfg
            .sqlite_home
            .as_ref()
            .map(AbsolutePathBuf::to_path_buf)
            .or_else(|| resolve_sqlite_home_env(&resolved_cwd))
            .unwrap_or_else(|| lyra_home.to_path_buf());
        let original_sandbox_policy = sandbox_policy.clone();

        apply_requirement_constrained_value(
            "approval_policy",
            approval_policy,
            &mut constrained_approval_policy,
            &mut startup_warnings,
        )?;
        if let Some(Sourced {
            value: filesystem_requirements,
            source: filesystem_requirements_source,
        }) = filesystem_requirements.as_ref()
            && !filesystem_requirements.deny_read.is_empty()
        {
            let requirement_source = filesystem_requirements_source.clone();
            constrained_sandbox_policy
                .value
                .add_validator(move |policy| match policy {
                    SandboxPolicy::ReadOnly { .. } | SandboxPolicy::WorkspaceWrite { .. } => Ok(()),
                    SandboxPolicy::DangerFullAccess | SandboxPolicy::ExternalSandbox { .. } => {
                        Err(ConstraintError::InvalidValue {
                            field_name: "sandbox_mode",
                            candidate: policy.to_string(),
                            allowed: "[read-only, workspace-write]".to_string(),
                            requirement_source: requirement_source.clone(),
                        })
                    }
                })
                .map_err(std::io::Error::from)?;

            if cfg!(target_os = "windows") {
                startup_warnings.push(format!(
                    "managed filesystem deny_read from {filesystem_requirements_source} is only enforced for direct file tools on Windows; shell subprocess reads are not sandboxed"
                ));
            }
        }
        apply_requirement_constrained_value(
            "approvals_reviewer",
            approvals_reviewer,
            &mut constrained_approvals_reviewer,
            &mut startup_warnings,
        )?;
        apply_requirement_constrained_value(
            "sandbox_mode",
            sandbox_policy,
            &mut constrained_sandbox_policy,
            &mut startup_warnings,
        )?;
        apply_requirement_constrained_value(
            "web_search_mode",
            web_search_mode,
            &mut constrained_web_search_mode,
            &mut startup_warnings,
        )?;

        let mcp_servers = constrain_mcp_servers(cfg.mcp_servers.clone(), mcp_servers.as_ref())
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidInput, format!("{e}")))?;

        let (network_requirements, network_requirements_source) = match network_requirements {
            Some(Sourced { value, source }) => (Some(value), Some(source)),
            None => (None, None),
        };
        let has_network_requirements = network_requirements.is_some();
        let network = NetworkProxySpec::from_config_and_constraints(
            configured_network_proxy_config,
            network_requirements,
            constrained_sandbox_policy.get(),
        )
        .map_err(|err| {
            if let Some(source) = network_requirements_source.as_ref() {
                std::io::Error::new(
                    err.kind(),
                    format!("failed to build managed network proxy from {source}: {err}"),
                )
            } else {
                err
            }
        })?;
        let network = if has_network_requirements {
            Some(network)
        } else {
            network.enabled().then_some(network)
        };
        let helper_readable_roots = get_readable_roots_required_for_lyra_runtime(
            &lyra_home,
            zsh_path.as_ref(),
            main_execve_wrapper_exe.as_ref(),
        );
        let effective_sandbox_policy = constrained_sandbox_policy.value.get().clone();
        let mut effective_file_system_sandbox_policy =
            if effective_sandbox_policy == original_sandbox_policy {
                file_system_sandbox_policy
            } else {
                FileSystemSandboxPolicy::from_sandbox_policy_preserving_deny_entries(
                    &effective_sandbox_policy,
                    resolved_cwd.as_path(),
                    &file_system_sandbox_policy,
                )
            };
        if let Some(Sourced {
            value: filesystem_requirements,
            ..
        }) = filesystem_requirements.as_ref()
        {
            apply_managed_filesystem_constraints(
                &mut effective_file_system_sandbox_policy,
                filesystem_requirements,
            );
        }
        let effective_file_system_sandbox_policy = effective_file_system_sandbox_policy
            .with_additional_readable_roots(resolved_cwd.as_path(), &helper_readable_roots);
        let effective_network_sandbox_policy =
            if effective_sandbox_policy == original_sandbox_policy {
                network_sandbox_policy
            } else {
                NetworkSandboxPolicy::from(&effective_sandbox_policy)
            };
        let config = Self {
            model,
            service_tier,
            review_model,
            model_context_window: cfg.model_context_window,
            model_provider_id,
            model_provider,
            cwd: resolved_cwd,
            startup_warnings,
            permissions: Permissions {
                approval_policy: constrained_approval_policy.value,
                sandbox_policy: constrained_sandbox_policy.value,
                file_system_sandbox_policy: effective_file_system_sandbox_policy,
                network_sandbox_policy: effective_network_sandbox_policy,
                network,
                allow_login_shell,
                shell_environment_policy,
                windows_sandbox_mode,
                windows_sandbox_private_desktop,
            },
            approvals_reviewer: constrained_approvals_reviewer.value(),
            enforce_residency: enforce_residency.value,
            user_instructions,
            base_instructions,
            developer_instructions,
            commit_attribution,
            include_permissions_instructions,
            include_apps_instructions,
            include_skill_instructions,
            include_environment_context,
            // The config.toml omits "_mode" because it's a config file. However, "_mode"
            // is important in code to differentiate the mode from the store implementation.
            cli_auth_credentials_store_mode: resolve_cli_auth_credentials_store_mode(
                cfg.cli_auth_credentials_store.unwrap_or_default(),
                env!("CARGO_PKG_VERSION"),
            ),
            mcp_servers,
            // The config.toml omits "_mode" because it's a config file. However, "_mode"
            // is important in code to differentiate the mode from the store implementation.
            mcp_oauth_credentials_store_mode: resolve_mcp_oauth_credentials_store_mode(
                cfg.mcp_oauth_credentials_store.unwrap_or_default(),
                env!("CARGO_PKG_VERSION"),
            ),
            mcp_oauth_callback_port: cfg.mcp_oauth_callback_port,
            mcp_oauth_callback_url: cfg.mcp_oauth_callback_url.clone(),
            model_providers,
            project_doc_max_bytes: cfg.project_doc_max_bytes.unwrap_or(AGENTS_MD_MAX_BYTES),
            project_doc_fallback_filenames: cfg
                .project_doc_fallback_filenames
                .unwrap_or_default()
                .into_iter()
                .filter_map(|name| {
                    let trimmed = name.trim();
                    if trimmed.is_empty() {
                        None
                    } else {
                        Some(trimmed.to_string())
                    }
                })
                .collect(),
            tool_output_token_limit: cfg.tool_output_token_limit,
            agent_max_threads,
            agent_max_depth,
            agent_roles,
            memories: cfg.memories.unwrap_or_default().into(),
            agent_job_max_runtime_seconds,
            lyra_home,
            sqlite_home,
            log_dir,
            config_layer_stack,
            history,
            ephemeral: ephemeral.unwrap_or_default(),
            file_opener: cfg.file_opener.unwrap_or(UriBasedFileOpener::VsCode),
            lyra_self_exe,
            lyra_linux_sandbox_exe,
            main_execve_wrapper_exe,
            js_repl_node_path,
            js_repl_node_module_dirs,
            zsh_path,

            hide_agent_reasoning: cfg.hide_agent_reasoning.unwrap_or(false),
            show_raw_agent_reasoning: cfg
                .show_raw_agent_reasoning
                .or(show_raw_agent_reasoning)
                .unwrap_or(false),
            auto_review_policy_config,
            model_reasoning_effort: config_profile
                .model_reasoning_effort
                .or(cfg.model_reasoning_effort),
            plan_mode_reasoning_effort: config_profile
                .plan_mode_reasoning_effort
                .or(cfg.plan_mode_reasoning_effort),
            model_reasoning_summary: config_profile
                .model_reasoning_summary
                .or(cfg.model_reasoning_summary),
            model_supports_reasoning_summaries: cfg.model_supports_reasoning_summaries,
            model_catalog,
            provider_model_catalogs,
            model_verbosity: config_profile.model_verbosity.or(cfg.model_verbosity),
            forced_login_method,
            include_apply_patch_tool: include_apply_patch_tool_flag,
            web_search_mode: constrained_web_search_mode.value,
            web_search_config,
            use_unified_exec_tool,
            background_terminal_max_timeout,
            ghost_snapshot,
            multi_agent_v2,
            features,
            active_profile: active_profile_name,
            active_project,
            windows_wsl_setup_acknowledged: cfg.windows_wsl_setup_acknowledged.unwrap_or(false),
            notices: cfg.notice.unwrap_or_default(),
            check_for_update_on_startup,
            disable_paste_burst: cfg.disable_paste_burst.unwrap_or(false),
            analytics_enabled: config_profile
                .analytics
                .as_ref()
                .and_then(|a| a.enabled)
                .or(cfg.analytics.as_ref().and_then(|a| a.enabled)),
            feedback_enabled: cfg
                .feedback
                .as_ref()
                .and_then(|feedback| feedback.enabled)
                .unwrap_or(true),
            tool_suggest,
            tui_notifications: cfg
                .tui
                .as_ref()
                .map(|t| t.notification_settings.clone())
                .unwrap_or_default(),
            animations: cfg.tui.as_ref().map(|t| t.animations).unwrap_or(true),
            show_tooltips: cfg.tui.as_ref().map(|t| t.show_tooltips).unwrap_or(true),
            model_availability_nux: cfg
                .tui
                .as_ref()
                .map(|t| t.model_availability_nux.clone())
                .unwrap_or_default(),
            tui_alternate_screen: cfg
                .tui
                .as_ref()
                .map(|t| t.alternate_screen)
                .unwrap_or_default(),
            tui_status_line: cfg.tui.as_ref().and_then(|t| t.status_line.clone()),
            tui_terminal_title: cfg.tui.as_ref().and_then(|t| t.terminal_title.clone()),
            tui_theme: cfg.tui.as_ref().and_then(|t| t.theme.clone()),
            otel: {
                let t: OtelConfigToml = cfg.otel.unwrap_or_default();
                let log_user_prompt = t.log_user_prompt.unwrap_or(false);
                let environment = t
                    .environment
                    .unwrap_or(DEFAULT_OTEL_ENVIRONMENT.to_string());
                let exporter = t.exporter.unwrap_or(OtelExporterKind::None);
                let trace_exporter = t.trace_exporter.unwrap_or_else(|| exporter.clone());
                let metrics_exporter = t.metrics_exporter.unwrap_or(OtelExporterKind::None);
                OtelConfig {
                    log_user_prompt,
                    environment,
                    exporter,
                    trace_exporter,
                    metrics_exporter,
                }
            },
        };
        Ok(config)
        })
        .await
    }

    /// If `path` is `Some`, attempts to read the file at the given path and
    /// returns its contents as a trimmed `String`. If the file is empty, or
    /// is `Some` but cannot be read, returns an `Err`.
    async fn try_read_non_empty_file(
        fs: &dyn ExecutorFileSystem,
        path: Option<&AbsolutePathBuf>,
        context: &str,
    ) -> std::io::Result<Option<String>> {
        let Some(path) = path else {
            return Ok(None);
        };

        let contents = fs
            .read_file_text(path, /*sandbox*/ None)
            .await
            .map_err(|e| {
                std::io::Error::new(
                    e.kind(),
                    format!("failed to read {context} {}: {e}", path.display()),
                )
            })?;

        let s = contents.trim().to_string();
        if s.is_empty() {
            Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                format!("{context} is empty: {}", path.display()),
            ))
        } else {
            Ok(Some(s))
        }
    }

    pub fn set_windows_sandbox_enabled(&mut self, value: bool) {
        self.permissions.windows_sandbox_mode = if value {
            Some(WindowsSandboxModeToml::Unelevated)
        } else if matches!(
            self.permissions.windows_sandbox_mode,
            Some(WindowsSandboxModeToml::Unelevated)
        ) {
            None
        } else {
            self.permissions.windows_sandbox_mode
        };
    }

    pub fn set_windows_elevated_sandbox_enabled(&mut self, value: bool) {
        self.permissions.windows_sandbox_mode = if value {
            Some(WindowsSandboxModeToml::Elevated)
        } else if matches!(
            self.permissions.windows_sandbox_mode,
            Some(WindowsSandboxModeToml::Elevated)
        ) {
            None
        } else {
            self.permissions.windows_sandbox_mode
        };
    }

    pub fn managed_network_requirements_enabled(&self) -> bool {
        !matches!(
            self.permissions.sandbox_policy.get(),
            SandboxPolicy::DangerFullAccess
        ) && self
            .config_layer_stack
            .requirements_toml()
            .network
            .is_some()
    }

    pub fn bundled_skills_enabled(&self) -> bool {
        crate::manager::bundled_skills_enabled_from_stack(&self.config_layer_stack)
    }
}

fn auto_review_policy_config_from_requirements(
    requirements_toml: &ConfigRequirementsToml,
) -> Option<String> {
    requirements_toml
        .auto_review_policy_config
        .as_deref()
        .and_then(|value| {
            let trimmed = value.trim();
            (!trimmed.is_empty()).then(|| trimmed.to_string())
        })
}

/// Returns the path to the Lyra runtime home, which can be specified by the
/// `LYRA_HOME` environment variable.
/// If it is not set, defaults to `~/.lyra`.
///
/// - If `LYRA_HOME` is set, the value must exist and be a directory. The value
///   will be canonicalized and this function will Err otherwise.
/// - If the variable is not set, this function does not verify that the
///   default directory exists.
pub fn find_lyra_home() -> std::io::Result<AbsolutePathBuf> {
    lyra_utils_home_dir::find_lyra_home()
}

/// Returns the path to the folder where Lyra logs are stored. Does not verify
/// that the directory exists.
pub fn log_dir(cfg: &Config) -> std::io::Result<PathBuf> {
    Ok(cfg.log_dir.clone())
}
