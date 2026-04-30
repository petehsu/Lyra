use crate::error_code::INTERNAL_ERROR_CODE;
use chrono::Utc;
use lyra_app_server_protocol::JSONRPCErrorError;
use lyra_app_server_protocol::LyraAiModelDiscoveryState;
use lyra_app_server_protocol::LyraAiModelRuntimeMetadata;
use lyra_app_server_protocol::LyraAiProviderCatalogItem;
use lyra_app_server_protocol::LyraAiProviderFieldOption;
use lyra_app_server_protocol::LyraAiProviderFieldSchema;
use lyra_app_server_protocol::LyraAiProviderModelEntry;
use lyra_app_server_protocol::LyraAiProviderPreset;
use lyra_app_server_protocol::LyraAiProviderProfile;
use lyra_app_server_protocol::LyraConfigProfileDeleteParams;
use lyra_app_server_protocol::LyraConfigProfileDeleteResponse;
use lyra_app_server_protocol::LyraConfigProfileSetDefaultParams;
use lyra_app_server_protocol::LyraConfigProfileSetDefaultResponse;
use lyra_app_server_protocol::LyraConfigProfileUpsertParams;
use lyra_app_server_protocol::LyraConfigProfileUpsertResponse;
use lyra_app_server_protocol::LyraConfigProfilesListResponse;
use lyra_app_server_protocol::LyraConfigProvidersCatalogReadResponse;
use lyra_models_manager::provider_model_entry_from_id;
use serde::Deserialize;
use serde::Serialize;
use serde_json::Value as JsonValue;
use std::cmp::Ordering;
use std::collections::BTreeMap;
use std::collections::BTreeSet;
use std::fs;
use std::path::PathBuf;
use uuid::Uuid;

const FILE_VERSION: u32 = 2;
const PROFILES_FILENAME: &str = "profiles.v2.json";
const LYRA_CONFIG_DIR: &str = "lyra-config";
const DEFAULT_ANTHROPIC_VERSION: &str = "2023-06-01";
const RUNTIME_PROVIDER_PREFIX: &str = "lp_";

#[derive(Debug, Clone)]
pub(crate) struct LyraAiConfigApi {
    lyra_home: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredProfilesDocument {
    version: u32,
    default_profile_id: Option<String>,
    profiles: Vec<StoredProfile>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredProfile {
    id: String,
    name: String,
    provider_id: String,
    protocol_id: String,
    preset_id: Option<String>,
    connection_config: BTreeMap<String, String>,
    auth_config: BTreeMap<String, String>,
    configured_secret_fields: Vec<String>,
    headers: BTreeMap<String, String>,
    model: String,
    custom_models: Vec<LyraAiProviderModelEntry>,
    discovery_state: LyraAiModelDiscoveryState,
    created_at: i64,
    updated_at: i64,
}

#[derive(Debug, Clone)]
struct ProviderPresetSpec {
    provider_id: String,
    protocol_id: String,
    label: String,
    description: String,
    section: String,
    default_model: String,
    model_discovery_supported: bool,
    capability: String,
    runtime_supported: bool,
    simple_fields: Vec<String>,
    default_connection_config: Vec<(String, String)>,
    default_auth_config: Vec<(String, String)>,
    connection_fields: Vec<LyraAiProviderFieldSchema>,
    auth_fields: Vec<LyraAiProviderFieldSchema>,
}

impl LyraAiConfigApi {
    pub(crate) fn new(lyra_home: PathBuf) -> Self {
        Self { lyra_home }
    }

    pub(crate) async fn list_profiles(
        &self,
    ) -> Result<LyraConfigProfilesListResponse, JSONRPCErrorError> {
        let document = self.read_profiles_document()?;
        let mut profiles = document
            .profiles
            .into_iter()
            .map(|profile| to_public_profile(profile, document.default_profile_id.as_deref()))
            .collect::<Vec<_>>();
        sort_profiles(&mut profiles);
        Ok(LyraConfigProfilesListResponse {
            profiles,
            default_profile_id: document.default_profile_id,
        })
    }

    pub(crate) async fn upsert_profile(
        &self,
        params: LyraConfigProfileUpsertParams,
    ) -> Result<LyraConfigProfileUpsertResponse, JSONRPCErrorError> {
        let mut document = self.read_profiles_document()?;
        let now = now_ms();
        let requested_id = trim_to_option(params.id.as_deref());
        let profile_id = requested_id.unwrap_or_else(|| Uuid::now_v7().to_string());
        let previous = document
            .profiles
            .iter()
            .find(|profile| profile.id == profile_id)
            .cloned();
        let provider_id = trim_string(&params.provider_id);
        let name = trim_string(&params.name);
        let next_profile = StoredProfile {
            id: profile_id.clone(),
            name: if name.is_empty() {
                previous
                    .as_ref()
                    .map(|profile| profile.name.clone())
                    .filter(|value| !value.trim().is_empty())
                    .or_else(|| {
                        if provider_id.is_empty() {
                            None
                        } else {
                            Some(provider_id.clone())
                        }
                    })
                    .unwrap_or_else(|| "Untitled profile".to_string())
            } else {
                name
            },
            provider_id,
            protocol_id: trim_string(&params.protocol_id),
            preset_id: trim_to_option(params.preset_id.as_deref()),
            connection_config: normalize_string_map(params.connection_config),
            auth_config: normalize_string_map(params.auth_config),
            configured_secret_fields: merge_configured_secret_fields(
                previous
                    .as_ref()
                    .map(|profile| profile.configured_secret_fields.as_slice())
                    .unwrap_or(&[]),
                &params.secret_values,
                &params.clear_secret_fields,
            ),
            headers: normalize_string_map(params.headers),
            model: trim_string(&params.model),
            custom_models: normalize_custom_models(params.custom_models),
            discovery_state: params
                .discovery_state
                .map(normalize_discovery_state)
                .or_else(|| {
                    previous
                        .as_ref()
                        .map(|profile| profile.discovery_state.clone())
                })
                .unwrap_or_else(empty_discovery_state),
            created_at: previous
                .as_ref()
                .map(|profile| profile.created_at)
                .unwrap_or(now),
            updated_at: now,
        };

        document.profiles.retain(|profile| profile.id != profile_id);
        document.profiles.push(next_profile.clone());
        if document.default_profile_id.is_none() {
            document.default_profile_id = Some(profile_id.clone());
        }
        self.write_profiles_document(&document)?;

        Ok(LyraConfigProfileUpsertResponse {
            profile: to_public_profile(next_profile, document.default_profile_id.as_deref()),
        })
    }

    pub(crate) async fn delete_profile(
        &self,
        params: LyraConfigProfileDeleteParams,
    ) -> Result<LyraConfigProfileDeleteResponse, JSONRPCErrorError> {
        let profile_id = trim_string(&params.id);
        if profile_id.is_empty() {
            return Ok(LyraConfigProfileDeleteResponse {});
        }
        let mut document = self.read_profiles_document()?;
        document.profiles.retain(|profile| profile.id != profile_id);
        if document.default_profile_id.as_deref() == Some(profile_id.as_str()) {
            document.default_profile_id =
                document.profiles.first().map(|profile| profile.id.clone());
        }
        self.write_profiles_document(&document)?;
        Ok(LyraConfigProfileDeleteResponse {})
    }

    pub(crate) async fn set_default_profile(
        &self,
        params: LyraConfigProfileSetDefaultParams,
    ) -> Result<LyraConfigProfileSetDefaultResponse, JSONRPCErrorError> {
        let profile_id = trim_string(&params.id);
        if profile_id.is_empty() {
            return Ok(LyraConfigProfileSetDefaultResponse { profile: None });
        }
        let mut document = self.read_profiles_document()?;
        let target = document
            .profiles
            .iter()
            .find(|profile| profile.id == profile_id)
            .cloned();
        let Some(target) = target else {
            return Ok(LyraConfigProfileSetDefaultResponse { profile: None });
        };
        document.default_profile_id = Some(profile_id);
        self.write_profiles_document(&document)?;
        Ok(LyraConfigProfileSetDefaultResponse {
            profile: Some(to_public_profile(
                target,
                document.default_profile_id.as_deref(),
            )),
        })
    }

    pub(crate) async fn read_provider_catalog(
        &self,
    ) -> Result<LyraConfigProvidersCatalogReadResponse, JSONRPCErrorError> {
        let specs = provider_preset_specs();
        Ok(LyraConfigProvidersCatalogReadResponse {
            providers: specs.iter().map(provider_catalog_item_from_spec).collect(),
            presets: specs.iter().map(provider_preset_from_spec).collect(),
        })
    }

    fn config_root(&self) -> PathBuf {
        self.lyra_home.join(LYRA_CONFIG_DIR)
    }

    fn profiles_path(&self) -> PathBuf {
        self.config_root().join(PROFILES_FILENAME)
    }

    fn ensure_storage_root(&self) -> Result<(), JSONRPCErrorError> {
        fs::create_dir_all(self.config_root()).map_err(map_io_error)
    }

    fn read_profiles_document(&self) -> Result<StoredProfilesDocument, JSONRPCErrorError> {
        self.ensure_storage_root()?;
        let path = self.profiles_path();
        let raw = match fs::read_to_string(&path) {
            Ok(raw) => raw,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(default_profiles_document());
            }
            Err(error) => return Err(map_io_error(error)),
        };
        let parsed = serde_json::from_str::<StoredProfilesDocument>(&raw)
            .unwrap_or_else(|_| default_profiles_document());
        Ok(StoredProfilesDocument {
            version: FILE_VERSION,
            default_profile_id: parsed.default_profile_id,
            profiles: parsed.profiles,
        })
    }

    fn write_profiles_document(
        &self,
        document: &StoredProfilesDocument,
    ) -> Result<(), JSONRPCErrorError> {
        self.ensure_storage_root()?;
        let serialized =
            serde_json::to_string_pretty(document).map_err(|error| JSONRPCErrorError {
                code: INTERNAL_ERROR_CODE,
                message: format!("failed to encode Lyra AI profiles: {error}"),
                data: None,
            })?;
        fs::write(self.profiles_path(), format!("{serialized}\n")).map_err(map_io_error)
    }
}

fn provider_catalog_item_from_spec(spec: &ProviderPresetSpec) -> LyraAiProviderCatalogItem {
    LyraAiProviderCatalogItem {
        id: spec.provider_id.clone(),
        label: spec.label.clone(),
        description: spec.description.clone(),
        protocol_id: spec.protocol_id.clone(),
        icon_key: spec.provider_id.clone(),
        recommended: spec.section == "mainstream",
    }
}

fn provider_preset_from_spec(spec: &ProviderPresetSpec) -> LyraAiProviderPreset {
    LyraAiProviderPreset {
        id: format!("{}-default", spec.provider_id),
        provider_id: spec.provider_id.clone(),
        protocol_id: spec.protocol_id.clone(),
        label: spec.label.clone(),
        description: spec.description.clone(),
        section: spec.section.clone(),
        icon_key: spec.provider_id.clone(),
        default_model: spec.default_model.clone(),
        discovery_mode: if spec.model_discovery_supported {
            "dynamic".to_string()
        } else {
            "static".to_string()
        },
        capability: spec.capability.clone(),
        model_discovery_supported: spec.model_discovery_supported,
        custom_headers_supported: true,
        custom_models_supported: true,
        runtime_supported: spec.runtime_supported,
        simple_fields: spec.simple_fields.clone(),
        connection_fields: spec.connection_fields.clone(),
        auth_fields: spec.auth_fields.clone(),
        default_connection_config: spec
            .default_connection_config
            .iter()
            .map(|(key, value)| (key.clone(), value.clone()))
            .collect(),
        default_auth_config: spec
            .default_auth_config
            .iter()
            .map(|(key, value)| (key.clone(), value.clone()))
            .collect(),
        recommended_models: if spec.default_model.trim().is_empty() {
            Vec::new()
        } else {
            vec![provider_model_entry_from_id(
                spec.provider_id.as_str(),
                spec.protocol_id.as_str(),
                spec.default_model.as_str(),
                "preset",
            )]
        },
    }
}

fn provider_preset_specs() -> Vec<ProviderPresetSpec> {
    let mut specs = vec![
        ProviderPresetSpec {
            provider_id: "openai".to_string(),
            protocol_id: "openai_chat_completions".to_string(),
            label: "OpenAI".to_string(),
            description: "OpenAI chat completions endpoint.".to_string(),
            section: "mainstream".to_string(),
            default_model: "gpt-5".to_string(),
            model_discovery_supported: true,
            capability: "full".to_string(),
            runtime_supported: true,
            simple_fields: vec!["apiKey".to_string(), "model".to_string()],
            default_connection_config: vec![(
                "baseUrl".to_string(),
                "https://api.openai.com/v1".to_string(),
            )],
            default_auth_config: Vec::new(),
            connection_fields: vec![url_field("baseUrl", "Base URL", false)],
            auth_fields: vec![password_field("apiKey", "API Key")],
        },
        ProviderPresetSpec {
            provider_id: "azure_openai".to_string(),
            protocol_id: "azure_openai_chat_completions".to_string(),
            label: "Azure OpenAI".to_string(),
            description: "Azure OpenAI deployment endpoint.".to_string(),
            section: "mainstream".to_string(),
            default_model: "gpt-4.1".to_string(),
            model_discovery_supported: true,
            capability: "full".to_string(),
            runtime_supported: true,
            simple_fields: vec!["apiKey".to_string(), "model".to_string()],
            default_connection_config: vec![
                ("baseUrl".to_string(), "".to_string()),
                ("apiVersion".to_string(), "2024-10-21".to_string()),
            ],
            default_auth_config: Vec::new(),
            connection_fields: vec![
                required_url_field("baseUrl", "Endpoint"),
                text_field("apiVersion", "API Version", false, false),
            ],
            auth_fields: vec![password_field("apiKey", "API Key")],
        },
        ProviderPresetSpec {
            provider_id: "openrouter".to_string(),
            protocol_id: "openrouter_chat_completions".to_string(),
            label: "OpenRouter".to_string(),
            description: "OpenRouter OpenAI-compatible endpoint.".to_string(),
            section: "mainstream".to_string(),
            default_model: "openai/gpt-4.1".to_string(),
            model_discovery_supported: true,
            capability: "full".to_string(),
            runtime_supported: true,
            simple_fields: vec!["apiKey".to_string(), "model".to_string()],
            default_connection_config: vec![(
                "baseUrl".to_string(),
                "https://openrouter.ai/api/v1".to_string(),
            )],
            default_auth_config: Vec::new(),
            connection_fields: vec![url_field("baseUrl", "Base URL", false)],
            auth_fields: vec![password_field("apiKey", "API Key")],
        },
        ProviderPresetSpec {
            provider_id: "anthropic".to_string(),
            protocol_id: "anthropic_messages".to_string(),
            label: "Anthropic".to_string(),
            description: "Anthropic Messages API.".to_string(),
            section: "mainstream".to_string(),
            default_model: "claude-sonnet-4-20250514".to_string(),
            model_discovery_supported: true,
            capability: "full".to_string(),
            runtime_supported: true,
            simple_fields: vec!["apiKey".to_string(), "model".to_string()],
            default_connection_config: vec![(
                "baseUrl".to_string(),
                "https://api.anthropic.com".to_string(),
            )],
            default_auth_config: vec![(
                "anthropicVersion".to_string(),
                DEFAULT_ANTHROPIC_VERSION.to_string(),
            )],
            connection_fields: vec![url_field("baseUrl", "Base URL", false)],
            auth_fields: vec![
                password_field("apiKey", "API Key"),
                auth_text_field("anthropicVersion", "Anthropic Version", false, false),
            ],
        },
        ProviderPresetSpec {
            provider_id: "google_ai".to_string(),
            protocol_id: "gemini_generate_content".to_string(),
            label: "Google AI Studio".to_string(),
            description: "Gemini generateContent API.".to_string(),
            section: "mainstream".to_string(),
            default_model: "gemini-2.5-pro".to_string(),
            model_discovery_supported: true,
            capability: "full".to_string(),
            runtime_supported: true,
            simple_fields: vec!["apiKey".to_string(), "model".to_string()],
            default_connection_config: vec![(
                "baseUrl".to_string(),
                "https://generativelanguage.googleapis.com".to_string(),
            )],
            default_auth_config: Vec::new(),
            connection_fields: vec![url_field("baseUrl", "Base URL", false)],
            auth_fields: vec![password_field("apiKey", "API Key")],
        },
        ProviderPresetSpec {
            provider_id: "ollama".to_string(),
            protocol_id: "ollama_chat".to_string(),
            label: "Ollama".to_string(),
            description: "Local Ollama chat endpoint.".to_string(),
            section: "local".to_string(),
            default_model: "qwen3:latest".to_string(),
            model_discovery_supported: true,
            capability: "full".to_string(),
            runtime_supported: true,
            simple_fields: vec!["model".to_string()],
            default_connection_config: vec![(
                "baseUrl".to_string(),
                "http://127.0.0.1:11434".to_string(),
            )],
            default_auth_config: Vec::new(),
            connection_fields: vec![url_field("baseUrl", "Base URL", false)],
            auth_fields: Vec::new(),
        },
        ProviderPresetSpec {
            provider_id: "lmstudio".to_string(),
            protocol_id: "lmstudio_chat_completions".to_string(),
            label: "LM Studio".to_string(),
            description: "Local LM Studio OpenAI-compatible endpoint.".to_string(),
            section: "local".to_string(),
            default_model: "local-model".to_string(),
            model_discovery_supported: true,
            capability: "full".to_string(),
            runtime_supported: true,
            simple_fields: vec!["model".to_string()],
            default_connection_config: vec![(
                "baseUrl".to_string(),
                "http://127.0.0.1:1234/v1".to_string(),
            )],
            default_auth_config: Vec::new(),
            connection_fields: vec![url_field("baseUrl", "Base URL", false)],
            auth_fields: Vec::new(),
        },
    ];

    for (provider_id, protocol_id, label, base_url) in [
        (
            "deepseek",
            "deepseek_chat_completions",
            "DeepSeek",
            "https://api.deepseek.com/v1",
        ),
        ("xai", "xai_chat_completions", "xAI", "https://api.x.ai/v1"),
        (
            "mistral",
            "mistral_chat_completions",
            "Mistral",
            "https://api.mistral.ai/v1",
        ),
        (
            "groq",
            "groq_chat_completions",
            "Groq",
            "https://api.groq.com/openai/v1",
        ),
        (
            "together",
            "together_chat_completions",
            "Together",
            "https://api.together.xyz/v1",
        ),
        (
            "fireworks",
            "fireworks_chat_completions",
            "Fireworks",
            "https://api.fireworks.ai/inference/v1",
        ),
        (
            "vercel_ai_gateway",
            "vercel_ai_gateway_chat_completions",
            "Vercel AI Gateway",
            "https://ai-gateway.vercel.sh/v1",
        ),
        (
            "custom_openai_compatible",
            "custom_chat_completions",
            "Custom Compatible",
            "",
        ),
    ] {
        let capability = if provider_id == "custom_openai_compatible" {
            "static"
        } else {
            "full"
        };
        let discovery_supported = provider_id != "custom_openai_compatible";
        specs.push(ProviderPresetSpec {
            provider_id: provider_id.to_string(),
            protocol_id: protocol_id.to_string(),
            label: label.to_string(),
            description: if provider_id == "custom_openai_compatible" {
                "Custom Compatible OpenAI-compatible endpoint.".to_string()
            } else {
                format!("{label} OpenAI-compatible endpoint.")
            },
            section: if provider_id == "custom_openai_compatible" {
                "custom".to_string()
            } else {
                "mainstream".to_string()
            },
            default_model: "".to_string(),
            model_discovery_supported: discovery_supported,
            capability: capability.to_string(),
            runtime_supported: true,
            simple_fields: if provider_id == "custom_openai_compatible" {
                vec!["apiKey".to_string(), "model".to_string()]
            } else {
                vec!["apiKey".to_string(), "model".to_string()]
            },
            default_connection_config: vec![("baseUrl".to_string(), base_url.to_string())],
            default_auth_config: Vec::new(),
            connection_fields: vec![url_field("baseUrl", "Base URL", false)],
            auth_fields: vec![password_field("apiKey", "API Key")],
        });
    }

    specs
}

fn url_field(id: &str, label: &str, required: bool) -> LyraAiProviderFieldSchema {
    field(id, label, "url", "connection", required, false)
}

fn required_url_field(id: &str, label: &str) -> LyraAiProviderFieldSchema {
    url_field(id, label, true)
}

fn text_field(id: &str, label: &str, required: bool, secret: bool) -> LyraAiProviderFieldSchema {
    field(id, label, "text", "connection", required, secret)
}

fn auth_text_field(
    id: &str,
    label: &str,
    required: bool,
    secret: bool,
) -> LyraAiProviderFieldSchema {
    field(id, label, "text", "auth", required, secret)
}

fn password_field(id: &str, label: &str) -> LyraAiProviderFieldSchema {
    LyraAiProviderFieldSchema {
        id: id.to_string(),
        label: label.to_string(),
        kind: "password".to_string(),
        scope: "auth".to_string(),
        placeholder: None,
        description: None,
        required: None,
        secret: Some(true),
        options: Vec::new(),
    }
}

fn field(
    id: &str,
    label: &str,
    kind: &str,
    scope: &str,
    required: bool,
    secret: bool,
) -> LyraAiProviderFieldSchema {
    LyraAiProviderFieldSchema {
        id: id.to_string(),
        label: label.to_string(),
        kind: kind.to_string(),
        scope: scope.to_string(),
        placeholder: None,
        description: None,
        required: required.then_some(true),
        secret: secret.then_some(true),
        options: Vec::<LyraAiProviderFieldOption>::new(),
    }
}

fn empty_discovery_state() -> LyraAiModelDiscoveryState {
    LyraAiModelDiscoveryState {
        status: "idle".to_string(),
        last_checked_at: None,
        error_message: None,
        models: Vec::new(),
    }
}

fn default_profiles_document() -> StoredProfilesDocument {
    StoredProfilesDocument {
        version: FILE_VERSION,
        default_profile_id: None,
        profiles: Vec::new(),
    }
}

fn to_public_profile(
    profile: StoredProfile,
    default_profile_id: Option<&str>,
) -> LyraAiProviderProfile {
    let is_default = default_profile_id == Some(profile.id.as_str());
    let runtime_provider_id = runtime_provider_id_for_profile_id(&profile.id);
    let runtime_supported = runtime_supported_for_protocol(&profile.protocol_id);
    let secret_status = resolve_secret_status(
        &profile.provider_id,
        &profile.protocol_id,
        &profile.configured_secret_fields,
    );
    let model_runtime_metadata = provider_model_entry_from_id(
        &profile.provider_id,
        &profile.protocol_id,
        &profile.model,
        "preset",
    )
    .runtime_metadata;
    LyraAiProviderProfile {
        id: profile.id,
        name: profile.name,
        provider_id: profile.provider_id,
        protocol_id: profile.protocol_id,
        runtime_provider_id,
        runtime_supported,
        secret_status,
        preset_id: profile.preset_id,
        connection_config: profile.connection_config,
        auth_config: profile.auth_config,
        configured_secret_fields: profile.configured_secret_fields,
        headers: profile.headers,
        model: profile.model,
        model_runtime_metadata,
        custom_models: profile.custom_models,
        discovery_state: profile.discovery_state,
        is_default,
        created_at: profile.created_at,
        updated_at: profile.updated_at,
    }
}

fn sort_profiles(profiles: &mut [LyraAiProviderProfile]) {
    profiles.sort_by(|left, right| {
        if left.is_default != right.is_default {
            return if left.is_default {
                Ordering::Less
            } else {
                Ordering::Greater
            };
        }
        if left.updated_at != right.updated_at {
            return right.updated_at.cmp(&left.updated_at);
        }
        left.name.cmp(&right.name)
    });
}

fn runtime_provider_id_for_profile_id(profile_id: &str) -> String {
    format!("{RUNTIME_PROVIDER_PREFIX}{}", profile_id.trim())
}

fn runtime_supported_for_protocol(protocol_id: &str) -> bool {
    matches!(
        protocol_id.trim(),
        "openai_chat_completions"
            | "azure_openai_chat_completions"
            | "openrouter_chat_completions"
            | "anthropic_messages"
            | "gemini_generate_content"
            | "deepseek_chat_completions"
            | "xai_chat_completions"
            | "mistral_chat_completions"
            | "groq_chat_completions"
            | "together_chat_completions"
            | "fireworks_chat_completions"
            | "vercel_ai_gateway_chat_completions"
            | "ollama_chat"
            | "lmstudio_chat_completions"
            | "custom_chat_completions"
    )
}

fn provider_env_key(provider_id: &str) -> Option<&'static str> {
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
        "custom_openai_compatible" => Some("CUSTOM_OPENAI_API_KEY"),
        _ => None,
    }
}

fn protocol_requires_api_key(protocol_id: &str) -> bool {
    matches!(
        protocol_id.trim(),
        "openai_chat_completions"
            | "azure_openai_chat_completions"
            | "openrouter_chat_completions"
            | "anthropic_messages"
            | "gemini_generate_content"
            | "deepseek_chat_completions"
            | "xai_chat_completions"
            | "mistral_chat_completions"
            | "groq_chat_completions"
            | "together_chat_completions"
            | "fireworks_chat_completions"
            | "vercel_ai_gateway_chat_completions"
            | "custom_chat_completions"
    )
}

fn resolve_secret_status(
    provider_id: &str,
    protocol_id: &str,
    configured_secret_fields: &[String],
) -> String {
    if !protocol_requires_api_key(protocol_id) {
        return "configured".to_string();
    }
    if let Some(env_key) = provider_env_key(provider_id)
        && let Ok(value) = std::env::var(env_key)
        && !value.trim().is_empty()
    {
        return "env".to_string();
    }
    if configured_secret_fields
        .iter()
        .any(|field| field.trim() == "apiKey")
    {
        return "configured".to_string();
    }
    "missing".to_string()
}

fn normalize_custom_models(models: Vec<LyraAiProviderModelEntry>) -> Vec<LyraAiProviderModelEntry> {
    models
        .into_iter()
        .filter_map(|entry| {
            let id = trim_string(&entry.id);
            let name = trim_string(&entry.name);
            if id.is_empty() || name.is_empty() {
                return None;
            }
            Some(LyraAiProviderModelEntry {
                id,
                name,
                description: entry.description.map(|value| trim_string(&value)),
                context_window: entry.context_window,
                supports_images: entry.supports_images,
                supports_tools: entry.supports_tools,
                runtime_metadata: entry.runtime_metadata.map(normalize_runtime_metadata),
                source: trim_to_option(Some(entry.source.as_str()))
                    .unwrap_or_else(|| "custom".to_string()),
            })
        })
        .collect()
}

fn normalize_discovery_state(state: LyraAiModelDiscoveryState) -> LyraAiModelDiscoveryState {
    LyraAiModelDiscoveryState {
        status: trim_string(&state.status),
        last_checked_at: state.last_checked_at,
        error_message: state.error_message.map(|value| trim_string(&value)),
        models: normalize_custom_models(state.models),
    }
}

fn normalize_runtime_metadata(metadata: LyraAiModelRuntimeMetadata) -> LyraAiModelRuntimeMetadata {
    LyraAiModelRuntimeMetadata {
        shell_type: metadata.shell_type.map(|value| trim_string(&value)),
        apply_patch_tool_type: metadata
            .apply_patch_tool_type
            .map(|value| trim_string(&value)),
        supports_search_tool: metadata.supports_search_tool,
        supports_parallel_tool_calls: metadata.supports_parallel_tool_calls,
        supports_reasoning_summaries: metadata.supports_reasoning_summaries,
        default_reasoning_level: metadata.default_reasoning_level,
        supported_reasoning_levels: metadata.supported_reasoning_levels,
        support_verbosity: metadata.support_verbosity,
        default_verbosity: metadata.default_verbosity,
        web_search_tool_type: metadata
            .web_search_tool_type
            .map(|value| trim_string(&value)),
        supports_image_detail_original: metadata.supports_image_detail_original,
        input_modalities: metadata
            .input_modalities
            .into_iter()
            .map(|value| trim_string(&value))
            .filter(|value| !value.is_empty())
            .collect(),
        supported_tools: metadata
            .supported_tools
            .into_iter()
            .map(|value| trim_string(&value))
            .filter(|value| !value.is_empty())
            .collect(),
        context_window: metadata.context_window,
        max_context_window: metadata.max_context_window,
        effective_context_window_percent: metadata.effective_context_window_percent,
        protocol_behavior: metadata.protocol_behavior,
    }
}

fn merge_configured_secret_fields(
    previous_fields: &[String],
    secret_values: &BTreeMap<String, JsonValue>,
    clear_secret_fields: &[String],
) -> Vec<String> {
    let mut fields = previous_fields
        .iter()
        .filter_map(|value| trim_to_option(Some(value.as_str())))
        .collect::<BTreeSet<_>>();

    for (key, value) in secret_values {
        let Some(key) = trim_to_option(Some(key.as_str())) else {
            continue;
        };
        match value {
            JsonValue::String(value) if !value.trim().is_empty() => {
                fields.insert(key);
            }
            _ => {
                fields.remove(&key);
            }
        }
    }

    for key in clear_secret_fields {
        if let Some(key) = trim_to_option(Some(key.as_str())) {
            fields.remove(&key);
        }
    }

    fields.into_iter().collect()
}

fn normalize_string_map(input: BTreeMap<String, String>) -> BTreeMap<String, String> {
    input
        .into_iter()
        .filter_map(|(key, value)| {
            let key = trim_string(&key);
            let value = trim_string(&value);
            if key.is_empty() || value.is_empty() {
                None
            } else {
                Some((key, value))
            }
        })
        .collect()
}

fn trim_string(value: &str) -> String {
    value.trim().to_string()
}

fn trim_to_option(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn now_ms() -> i64 {
    Utc::now().timestamp_millis()
}

fn map_io_error(error: std::io::Error) -> JSONRPCErrorError {
    JSONRPCErrorError {
        code: INTERNAL_ERROR_CODE,
        message: error.to_string(),
        data: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[tokio::test]
    async fn profile_round_trip_uses_rust_owned_store() {
        let home = TempDir::new().expect("temp Lyra home");
        let api = LyraAiConfigApi::new(home.path().to_path_buf());

        let saved = api
            .upsert_profile(LyraConfigProfileUpsertParams {
                id: None,
                name: "OpenAI".to_string(),
                provider_id: "openai".to_string(),
                protocol_id: "openai_chat_completions".to_string(),
                preset_id: Some("openai-default".to_string()),
                connection_config: BTreeMap::from([(
                    "baseUrl".to_string(),
                    "https://api.openai.com/v1".to_string(),
                )]),
                auth_config: BTreeMap::new(),
                secret_values: BTreeMap::from([(
                    "apiKey".to_string(),
                    JsonValue::String("secret".to_string()),
                )]),
                clear_secret_fields: Vec::new(),
                headers: BTreeMap::new(),
                model: "gpt-5".to_string(),
                custom_models: Vec::new(),
                discovery_state: None,
            })
            .await
            .expect("save profile");

        assert!(saved.profile.is_default);
        assert_eq!(
            saved.profile.configured_secret_fields,
            vec!["apiKey".to_string()]
        );

        let listed = api.list_profiles().await.expect("list profiles");
        assert_eq!(listed.default_profile_id, Some(saved.profile.id.clone()));
        assert_eq!(listed.profiles.len(), 1);

        let removed = api
            .delete_profile(LyraConfigProfileDeleteParams {
                id: saved.profile.id.clone(),
            })
            .await
            .expect("delete profile");
        assert_eq!(removed, LyraConfigProfileDeleteResponse {});

        let listed = api
            .list_profiles()
            .await
            .expect("list profiles after delete");
        assert!(listed.profiles.is_empty());
        assert_eq!(listed.default_profile_id, None);
    }

    #[tokio::test]
    async fn provider_catalog_contains_expected_presets() {
        let home = TempDir::new().expect("temp Lyra home");
        let api = LyraAiConfigApi::new(home.path().to_path_buf());

        let catalog = api.read_provider_catalog().await.expect("catalog");

        assert!(catalog.providers.iter().any(|item| item.id == "openai"));
        assert!(
            catalog
                .presets
                .iter()
                .any(|preset| preset.protocol_id == "anthropic_messages")
        );
    }

    #[test]
    fn secret_status_reports_local_profiles_as_configured() {
        let profile = StoredProfile {
            id: "profile-local".to_string(),
            name: "Local".to_string(),
            provider_id: "ollama".to_string(),
            protocol_id: "ollama_chat".to_string(),
            preset_id: Some("ollama-default".to_string()),
            connection_config: BTreeMap::new(),
            auth_config: BTreeMap::new(),
            configured_secret_fields: Vec::new(),
            headers: BTreeMap::new(),
            model: "qwen3:latest".to_string(),
            custom_models: Vec::new(),
            discovery_state: empty_discovery_state(),
            created_at: 0,
            updated_at: 0,
        };

        let public = to_public_profile(profile, None);
        assert_eq!(public.secret_status, "configured");
    }
}
