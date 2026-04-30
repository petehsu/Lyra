use std::sync::LazyLock;

use lyra_app_server_protocol::LyraAiModelRuntimeMetadata;
use lyra_app_server_protocol::LyraAiProtocolBehaviorSummary;
use lyra_app_server_protocol::LyraAiProviderModelEntry;
use lyra_protocol::config_types::ReasoningSummary;
use lyra_protocol::openai_models::ApplyPatchToolType;
use lyra_protocol::openai_models::ConfigShellToolType;
use lyra_protocol::openai_models::InputModality;
use lyra_protocol::openai_models::ModelInfo;
use lyra_protocol::openai_models::ModelVisibility;
use lyra_protocol::openai_models::ReasoningEffortPreset;
use lyra_protocol::openai_models::TruncationPolicyConfig;
use lyra_protocol::openai_models::WebSearchToolType;
use lyra_protocol::openai_models::default_input_modalities;

use crate::bundled_models_response;
use crate::model_info::BASE_INSTRUCTIONS;

static BUNDLED_MODELS: LazyLock<Vec<ModelInfo>> = LazyLock::new(|| {
    bundled_models_response()
        .map(|response| response.models)
        .unwrap_or_default()
});

pub fn provider_model_entry_from_id(
    provider_id: &str,
    protocol_id: &str,
    model_id: &str,
    source: &str,
) -> LyraAiProviderModelEntry {
    let normalized = normalize_provider_model_entry(
        provider_id,
        protocol_id,
        base_model_entry(model_id, source),
    );
    normalized
}

pub fn normalize_provider_model_entry(
    provider_id: &str,
    protocol_id: &str,
    entry: LyraAiProviderModelEntry,
) -> LyraAiProviderModelEntry {
    let metadata = normalized_runtime_metadata(
        provider_id,
        protocol_id,
        entry.id.as_str(),
        entry.runtime_metadata.as_ref(),
    );
    let supports_images = metadata
        .input_modalities
        .iter()
        .any(|modality| modality == "image");
    let supports_tools = metadata.apply_patch_tool_type.is_some();
    LyraAiProviderModelEntry {
        context_window: metadata.context_window,
        supports_images: Some(supports_images),
        supports_tools: Some(supports_tools),
        runtime_metadata: Some(metadata),
        ..entry
    }
}

pub fn model_info_from_provider_model_entry(
    provider_id: &str,
    protocol_id: &str,
    entry: &LyraAiProviderModelEntry,
) -> ModelInfo {
    if let Some(exact) =
        exact_model_info_for_provider_protocol(provider_id, protocol_id, entry.id.as_str())
    {
        return exact;
    }

    let metadata = normalized_runtime_metadata(
        provider_id,
        protocol_id,
        entry.id.as_str(),
        entry.runtime_metadata.as_ref(),
    );
    model_info_from_runtime_metadata(
        entry.id.as_str(),
        entry.name.as_str(),
        entry.description.as_deref(),
        &metadata,
    )
}

pub fn model_info_for_provider_protocol(
    provider_id: Option<&str>,
    protocol_id: Option<&str>,
    model: &str,
) -> Option<ModelInfo> {
    let provider_id = provider_id.unwrap_or_default().trim();
    let protocol_id = protocol_id.unwrap_or_default().trim();
    exact_model_info_for_provider_protocol(provider_id, protocol_id, model)
        .or_else(|| baseline_model_info_for_provider_protocol(provider_id, protocol_id, model))
}

pub fn runtime_metadata_from_model_info(model: &ModelInfo) -> LyraAiModelRuntimeMetadata {
    LyraAiModelRuntimeMetadata {
        shell_type: Some(shell_type_to_wire(model.shell_type)),
        apply_patch_tool_type: model
            .apply_patch_tool_type
            .clone()
            .map(apply_patch_tool_type_to_wire),
        supports_search_tool: Some(model.supports_search_tool),
        supports_parallel_tool_calls: Some(model.supports_parallel_tool_calls),
        supports_reasoning_summaries: Some(model.supports_reasoning_summaries),
        default_reasoning_level: model.default_reasoning_level,
        supported_reasoning_levels: model
            .supported_reasoning_levels
            .iter()
            .map(|preset| preset.effort)
            .collect(),
        support_verbosity: Some(model.support_verbosity),
        default_verbosity: model.default_verbosity,
        web_search_tool_type: Some(web_search_tool_type_to_wire(model.web_search_tool_type)),
        supports_image_detail_original: Some(model.supports_image_detail_original),
        input_modalities: model
            .input_modalities
            .iter()
            .map(input_modality_to_wire)
            .collect(),
        supported_tools: model.supported_tools.clone(),
        context_window: model
            .context_window
            .and_then(|value| u64::try_from(value).ok()),
        max_context_window: model
            .max_context_window
            .and_then(|value| u64::try_from(value).ok()),
        effective_context_window_percent: u64::try_from(model.effective_context_window_percent)
            .ok(),
        protocol_behavior: None,
    }
}

fn base_model_entry(model_id: &str, source: &str) -> LyraAiProviderModelEntry {
    let id = model_id.trim().to_string();
    LyraAiProviderModelEntry {
        id: id.clone(),
        name: id,
        description: None,
        context_window: None,
        supports_images: None,
        supports_tools: None,
        runtime_metadata: None,
        source: if source.trim().is_empty() {
            "dynamic".to_string()
        } else {
            source.trim().to_string()
        },
    }
}

fn normalized_runtime_metadata(
    provider_id: &str,
    protocol_id: &str,
    model: &str,
    existing: Option<&LyraAiModelRuntimeMetadata>,
) -> LyraAiModelRuntimeMetadata {
    if let Some(exact) = exact_model_info_for_provider_protocol(provider_id, protocol_id, model) {
        let mut metadata = runtime_metadata_from_model_info(&exact);
        metadata.protocol_behavior = protocol_behavior_summary(provider_id, protocol_id, model);
        return metadata;
    }

    let mut baseline = baseline_model_info_for_provider_protocol(provider_id, protocol_id, model)
        .map(|model| runtime_metadata_from_model_info(&model))
        .unwrap_or_else(default_runtime_metadata);
    baseline.protocol_behavior = protocol_behavior_summary(provider_id, protocol_id, model);
    match existing {
        Some(existing) => merge_runtime_metadata(existing, &baseline),
        None => baseline,
    }
}

fn protocol_behavior_summary(
    provider_id: &str,
    protocol_id: &str,
    model: &str,
) -> Option<LyraAiProtocolBehaviorSummary> {
    let provider_id = provider_id.trim();
    let protocol_id = protocol_id.trim();
    let model = model.trim().to_ascii_lowercase();
    match (provider_id, protocol_id) {
        ("deepseek", "deepseek_chat_completions") => Some(LyraAiProtocolBehaviorSummary {
            reasoning_replay_field: Some("reasoning_content".to_string()),
            preserve_empty_reasoning: Some(true),
            require_assistant_reasoning: Some(true),
            tool_loop_supported: Some(model != "deepseek-reasoner"),
        }),
        ("openrouter", "openrouter_chat_completions") => Some(LyraAiProtocolBehaviorSummary {
            reasoning_replay_field: Some("reasoning_details".to_string()),
            preserve_empty_reasoning: Some(false),
            require_assistant_reasoning: Some(false),
            tool_loop_supported: Some(true),
        }),
        ("anthropic", "anthropic_messages") => Some(LyraAiProtocolBehaviorSummary {
            reasoning_replay_field: Some("signed_thinking_blocks".to_string()),
            preserve_empty_reasoning: Some(false),
            require_assistant_reasoning: Some(false),
            tool_loop_supported: Some(true),
        }),
        ("google_ai", "gemini_generate_content") => Some(LyraAiProtocolBehaviorSummary {
            reasoning_replay_field: None,
            preserve_empty_reasoning: Some(false),
            require_assistant_reasoning: Some(false),
            tool_loop_supported: Some(true),
        }),
        _ => None,
    }
}

fn merge_runtime_metadata(
    existing: &LyraAiModelRuntimeMetadata,
    baseline: &LyraAiModelRuntimeMetadata,
) -> LyraAiModelRuntimeMetadata {
    LyraAiModelRuntimeMetadata {
        shell_type: existing
            .shell_type
            .clone()
            .or_else(|| baseline.shell_type.clone()),
        apply_patch_tool_type: existing
            .apply_patch_tool_type
            .clone()
            .or_else(|| baseline.apply_patch_tool_type.clone()),
        supports_search_tool: existing
            .supports_search_tool
            .or(baseline.supports_search_tool),
        supports_parallel_tool_calls: existing
            .supports_parallel_tool_calls
            .or(baseline.supports_parallel_tool_calls),
        supports_reasoning_summaries: existing
            .supports_reasoning_summaries
            .or(baseline.supports_reasoning_summaries),
        default_reasoning_level: existing
            .default_reasoning_level
            .or(baseline.default_reasoning_level),
        supported_reasoning_levels: if existing.supported_reasoning_levels.is_empty() {
            baseline.supported_reasoning_levels.clone()
        } else {
            existing.supported_reasoning_levels.clone()
        },
        support_verbosity: existing.support_verbosity.or(baseline.support_verbosity),
        default_verbosity: existing.default_verbosity.or(baseline.default_verbosity),
        web_search_tool_type: existing
            .web_search_tool_type
            .clone()
            .or_else(|| baseline.web_search_tool_type.clone()),
        supports_image_detail_original: existing
            .supports_image_detail_original
            .or(baseline.supports_image_detail_original),
        input_modalities: if existing.input_modalities.is_empty() {
            baseline.input_modalities.clone()
        } else {
            existing.input_modalities.clone()
        },
        supported_tools: if existing.supported_tools.is_empty() {
            baseline.supported_tools.clone()
        } else {
            existing.supported_tools.clone()
        },
        context_window: existing.context_window.or(baseline.context_window),
        max_context_window: existing.max_context_window.or(baseline.max_context_window),
        effective_context_window_percent: existing
            .effective_context_window_percent
            .or(baseline.effective_context_window_percent),
        protocol_behavior: existing
            .protocol_behavior
            .clone()
            .or_else(|| baseline.protocol_behavior.clone()),
    }
}

fn exact_model_info_for_provider_protocol(
    provider_id: &str,
    protocol_id: &str,
    model: &str,
) -> Option<ModelInfo> {
    find_model_candidate(model, &BUNDLED_MODELS).or_else(|| {
        curated_provider_models(provider_id, protocol_id)
            .into_iter()
            .find(|candidate| candidate.slug == model)
    })
}

fn find_model_candidate(model: &str, candidates: &[ModelInfo]) -> Option<ModelInfo> {
    find_model_by_longest_prefix(model, candidates)
        .or_else(|| find_model_by_namespaced_suffix(model, candidates))
        .map(|candidate| ModelInfo {
            slug: model.to_string(),
            ..candidate
        })
}

fn find_model_by_longest_prefix(model: &str, candidates: &[ModelInfo]) -> Option<ModelInfo> {
    let mut best: Option<ModelInfo> = None;
    for candidate in candidates {
        if !model.starts_with(&candidate.slug) {
            continue;
        }
        let is_better_match = if let Some(current) = best.as_ref() {
            candidate.slug.len() > current.slug.len()
        } else {
            true
        };
        if is_better_match {
            best = Some(candidate.clone());
        }
    }
    best
}

fn find_model_by_namespaced_suffix(model: &str, candidates: &[ModelInfo]) -> Option<ModelInfo> {
    let (namespace, suffix) = model.split_once('/')?;
    if suffix.contains('/') {
        return None;
    }
    if !namespace
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || character == '_')
    {
        return None;
    }
    find_model_by_longest_prefix(suffix, candidates)
}

fn curated_provider_models(provider_id: &str, protocol_id: &str) -> Vec<ModelInfo> {
    match (provider_id, protocol_id) {
        ("anthropic", "anthropic_messages") => vec![
            exact_template_model("claude-sonnet-4-20250514", "Claude Sonnet 4", 200_000, true),
            exact_template_model("claude-opus-4-20250514", "Claude Opus 4", 200_000, true),
            exact_template_model(
                "claude-3-7-sonnet-20250219",
                "Claude 3.7 Sonnet",
                200_000,
                true,
            ),
        ],
        ("google_ai", "gemini_generate_content") => vec![
            exact_template_model("gemini-2.5-pro", "Gemini 2.5 Pro", 1_000_000, true),
            exact_template_model("gemini-2.5-flash", "Gemini 2.5 Flash", 1_000_000, true),
        ],
        ("deepseek", "deepseek_chat_completions") => vec![
            exact_template_model("deepseek-reasoner", "DeepSeek Reasoner", 128_000, false),
            exact_template_model("deepseek-chat", "DeepSeek Chat", 128_000, false),
            exact_template_model("deepseek-v3", "DeepSeek V3", 128_000, false),
            exact_template_model("deepseek-v4-pro", "DeepSeek V4 Pro", 128_000, false),
        ],
        ("xai", "xai_chat_completions") => vec![
            exact_template_model("grok-4", "Grok 4", 128_000, true),
            exact_template_model("grok-3", "Grok 3", 128_000, true),
        ],
        ("mistral", "mistral_chat_completions") => vec![
            exact_template_model("mistral-large-latest", "Mistral Large", 128_000, true),
            exact_template_model("mistral-small-latest", "Mistral Small", 128_000, true),
            exact_template_model("codestral-latest", "Codestral", 128_000, false),
        ],
        ("groq", "groq_chat_completions") => vec![
            exact_template_model(
                "llama-3.3-70b-versatile",
                "Llama 3.3 70B Versatile",
                128_000,
                false,
            ),
            exact_template_model(
                "llama-3.1-8b-instant",
                "Llama 3.1 8B Instant",
                128_000,
                false,
            ),
        ],
        _ => Vec::new(),
    }
}

fn exact_template_model(
    slug: &str,
    display_name: &str,
    context_window: i64,
    supports_images: bool,
) -> ModelInfo {
    let metadata = LyraAiModelRuntimeMetadata {
        shell_type: Some(shell_type_to_wire(ConfigShellToolType::ShellCommand)),
        apply_patch_tool_type: Some(apply_patch_tool_type_to_wire(ApplyPatchToolType::Freeform)),
        supports_search_tool: Some(false),
        supports_parallel_tool_calls: Some(true),
        supports_reasoning_summaries: Some(false),
        default_reasoning_level: None,
        supported_reasoning_levels: Vec::new(),
        support_verbosity: Some(false),
        default_verbosity: None,
        web_search_tool_type: Some(web_search_tool_type_to_wire(WebSearchToolType::Text)),
        supports_image_detail_original: Some(false),
        input_modalities: if supports_images {
            default_input_modalities()
                .iter()
                .map(input_modality_to_wire)
                .collect()
        } else {
            vec![input_modality_to_wire(&InputModality::Text)]
        },
        supported_tools: Vec::new(),
        context_window: u64::try_from(context_window).ok(),
        max_context_window: u64::try_from(context_window).ok(),
        effective_context_window_percent: Some(95),
        protocol_behavior: None,
    };
    model_info_from_runtime_metadata(slug, display_name, None, &metadata)
}

fn baseline_model_info_for_provider_protocol(
    provider_id: &str,
    protocol_id: &str,
    model: &str,
) -> Option<ModelInfo> {
    let metadata = match (provider_id, protocol_id) {
        ("openai", "openai_chat_completions") => responses_provider_baseline(true, true, 272_000),
        ("azure_openai", "azure_openai_chat_completions") => {
            responses_provider_baseline(true, true, 272_000)
        }
        ("openrouter", "openrouter_chat_completions") => {
            chat_completions_baseline(false, true, true, 272_000)
        }
        ("anthropic", "anthropic_messages") => anthropic_baseline(200_000),
        ("google_ai", "gemini_generate_content") => gemini_baseline(1_000_000),
        ("deepseek", "deepseek_chat_completions") => {
            chat_completions_baseline(false, false, true, 128_000)
        }
        ("xai", "xai_chat_completions") => chat_completions_baseline(false, true, true, 128_000),
        ("mistral", "mistral_chat_completions") => {
            chat_completions_baseline(false, true, true, 128_000)
        }
        ("groq", "groq_chat_completions") => chat_completions_baseline(false, false, true, 128_000),
        ("together", "together_chat_completions") => {
            chat_completions_baseline(false, false, true, 128_000)
        }
        ("fireworks", "fireworks_chat_completions") => {
            chat_completions_baseline(false, true, true, 128_000)
        }
        ("vercel_ai_gateway", "vercel_ai_gateway_chat_completions") => {
            chat_completions_baseline(false, true, true, 272_000)
        }
        ("ollama", "ollama_chat") => chat_completions_baseline(false, false, true, 128_000),
        ("lmstudio", "lmstudio_chat_completions") => {
            chat_completions_baseline(false, false, true, 128_000)
        }
        ("custom_openai_compatible", "custom_chat_completions") => {
            chat_completions_baseline(false, false, true, 128_000)
        }
        ("", "openai_chat_completions") => responses_provider_baseline(true, true, 272_000),
        ("", "azure_openai_chat_completions") => responses_provider_baseline(true, true, 272_000),
        ("", "openrouter_chat_completions") => {
            chat_completions_baseline(false, true, true, 272_000)
        }
        ("", "anthropic_messages") => anthropic_baseline(200_000),
        ("", "gemini_generate_content") => gemini_baseline(1_000_000),
        ("", "deepseek_chat_completions") => chat_completions_baseline(false, false, true, 128_000),
        ("", "xai_chat_completions") => chat_completions_baseline(false, true, true, 128_000),
        ("", "mistral_chat_completions") => chat_completions_baseline(false, true, true, 128_000),
        ("", "groq_chat_completions") => chat_completions_baseline(false, false, true, 128_000),
        ("", "together_chat_completions") => chat_completions_baseline(false, false, true, 128_000),
        ("", "fireworks_chat_completions") => chat_completions_baseline(false, true, true, 128_000),
        ("", "vercel_ai_gateway_chat_completions") => {
            chat_completions_baseline(false, true, true, 272_000)
        }
        ("", "ollama_chat") => chat_completions_baseline(false, false, true, 128_000),
        ("", "lmstudio_chat_completions") => chat_completions_baseline(false, false, true, 128_000),
        ("", "custom_chat_completions") => chat_completions_baseline(false, false, true, 128_000),
        _ => return None,
    };
    Some(model_info_from_runtime_metadata(
        model, model, None, &metadata,
    ))
}

fn responses_provider_baseline(
    supports_search_tool: bool,
    supports_images: bool,
    context_window: u64,
) -> LyraAiModelRuntimeMetadata {
    LyraAiModelRuntimeMetadata {
        shell_type: Some(shell_type_to_wire(ConfigShellToolType::ShellCommand)),
        apply_patch_tool_type: Some(apply_patch_tool_type_to_wire(ApplyPatchToolType::Freeform)),
        supports_search_tool: Some(supports_search_tool),
        supports_parallel_tool_calls: Some(true),
        supports_reasoning_summaries: Some(false),
        default_reasoning_level: None,
        supported_reasoning_levels: Vec::new(),
        support_verbosity: Some(false),
        default_verbosity: None,
        web_search_tool_type: Some(web_search_tool_type_to_wire(WebSearchToolType::Text)),
        supports_image_detail_original: Some(false),
        input_modalities: if supports_images {
            default_input_modalities()
                .iter()
                .map(input_modality_to_wire)
                .collect()
        } else {
            vec![input_modality_to_wire(&InputModality::Text)]
        },
        supported_tools: Vec::new(),
        context_window: Some(context_window),
        max_context_window: Some(context_window),
        effective_context_window_percent: Some(95),
        protocol_behavior: None,
    }
}

fn chat_completions_baseline(
    supports_search_tool: bool,
    supports_images: bool,
    supports_parallel_tool_calls: bool,
    context_window: u64,
) -> LyraAiModelRuntimeMetadata {
    LyraAiModelRuntimeMetadata {
        shell_type: Some(shell_type_to_wire(ConfigShellToolType::ShellCommand)),
        apply_patch_tool_type: Some(apply_patch_tool_type_to_wire(ApplyPatchToolType::Freeform)),
        supports_search_tool: Some(supports_search_tool),
        supports_parallel_tool_calls: Some(supports_parallel_tool_calls),
        supports_reasoning_summaries: Some(false),
        default_reasoning_level: None,
        supported_reasoning_levels: Vec::new(),
        support_verbosity: Some(false),
        default_verbosity: None,
        web_search_tool_type: Some(web_search_tool_type_to_wire(WebSearchToolType::Text)),
        supports_image_detail_original: Some(false),
        input_modalities: if supports_images {
            default_input_modalities()
                .iter()
                .map(input_modality_to_wire)
                .collect()
        } else {
            vec![input_modality_to_wire(&InputModality::Text)]
        },
        supported_tools: Vec::new(),
        context_window: Some(context_window),
        max_context_window: Some(context_window),
        effective_context_window_percent: Some(95),
        protocol_behavior: None,
    }
}

fn anthropic_baseline(context_window: u64) -> LyraAiModelRuntimeMetadata {
    LyraAiModelRuntimeMetadata {
        shell_type: Some(shell_type_to_wire(ConfigShellToolType::ShellCommand)),
        apply_patch_tool_type: Some(apply_patch_tool_type_to_wire(ApplyPatchToolType::Freeform)),
        supports_search_tool: Some(false),
        supports_parallel_tool_calls: Some(false),
        supports_reasoning_summaries: Some(false),
        default_reasoning_level: None,
        supported_reasoning_levels: Vec::new(),
        support_verbosity: Some(false),
        default_verbosity: None,
        web_search_tool_type: Some(web_search_tool_type_to_wire(WebSearchToolType::Text)),
        supports_image_detail_original: Some(false),
        input_modalities: default_input_modalities()
            .iter()
            .map(input_modality_to_wire)
            .collect(),
        supported_tools: Vec::new(),
        context_window: Some(context_window),
        max_context_window: Some(context_window),
        effective_context_window_percent: Some(95),
        protocol_behavior: None,
    }
}

fn gemini_baseline(context_window: u64) -> LyraAiModelRuntimeMetadata {
    LyraAiModelRuntimeMetadata {
        shell_type: Some(shell_type_to_wire(ConfigShellToolType::ShellCommand)),
        apply_patch_tool_type: Some(apply_patch_tool_type_to_wire(ApplyPatchToolType::Freeform)),
        supports_search_tool: Some(false),
        supports_parallel_tool_calls: Some(false),
        supports_reasoning_summaries: Some(false),
        default_reasoning_level: None,
        supported_reasoning_levels: Vec::new(),
        support_verbosity: Some(false),
        default_verbosity: None,
        web_search_tool_type: Some(web_search_tool_type_to_wire(WebSearchToolType::Text)),
        supports_image_detail_original: Some(false),
        input_modalities: default_input_modalities()
            .iter()
            .map(input_modality_to_wire)
            .collect(),
        supported_tools: Vec::new(),
        context_window: Some(context_window),
        max_context_window: Some(context_window),
        effective_context_window_percent: Some(95),
        protocol_behavior: None,
    }
}

fn default_runtime_metadata() -> LyraAiModelRuntimeMetadata {
    LyraAiModelRuntimeMetadata {
        shell_type: Some(shell_type_to_wire(ConfigShellToolType::ShellCommand)),
        apply_patch_tool_type: Some(apply_patch_tool_type_to_wire(ApplyPatchToolType::Freeform)),
        supports_search_tool: Some(false),
        supports_parallel_tool_calls: Some(false),
        supports_reasoning_summaries: Some(false),
        default_reasoning_level: None,
        supported_reasoning_levels: Vec::new(),
        support_verbosity: Some(false),
        default_verbosity: None,
        web_search_tool_type: Some(web_search_tool_type_to_wire(WebSearchToolType::Text)),
        supports_image_detail_original: Some(false),
        input_modalities: vec![input_modality_to_wire(&InputModality::Text)],
        supported_tools: Vec::new(),
        context_window: None,
        max_context_window: None,
        effective_context_window_percent: Some(95),
        protocol_behavior: None,
    }
}

fn model_info_from_runtime_metadata(
    slug: &str,
    display_name: &str,
    description: Option<&str>,
    metadata: &LyraAiModelRuntimeMetadata,
) -> ModelInfo {
    let shell_type = metadata
        .shell_type
        .as_deref()
        .and_then(shell_type_from_wire)
        .unwrap_or(ConfigShellToolType::ShellCommand);
    let apply_patch_tool_type = metadata
        .apply_patch_tool_type
        .as_deref()
        .and_then(apply_patch_tool_type_from_wire);
    let web_search_tool_type = metadata
        .web_search_tool_type
        .as_deref()
        .and_then(web_search_tool_type_from_wire)
        .unwrap_or(WebSearchToolType::Text);
    let mut input_modalities = if metadata.input_modalities.is_empty() {
        default_input_modalities()
    } else {
        metadata
            .input_modalities
            .iter()
            .filter_map(|modality| input_modality_from_wire(modality))
            .collect::<Vec<_>>()
    };
    if input_modalities.is_empty() {
        input_modalities = vec![InputModality::Text];
    }
    let context_window = metadata
        .context_window
        .and_then(|value| i64::try_from(value).ok());
    let max_context_window = metadata
        .max_context_window
        .and_then(|value| i64::try_from(value).ok())
        .or(context_window);
    let effective_context_window_percent = metadata
        .effective_context_window_percent
        .and_then(|value| i64::try_from(value).ok())
        .unwrap_or(95);
    ModelInfo {
        slug: slug.to_string(),
        display_name: if display_name.trim().is_empty() {
            slug.to_string()
        } else {
            display_name.trim().to_string()
        },
        description: description
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string),
        default_reasoning_level: metadata.default_reasoning_level,
        supported_reasoning_levels: metadata
            .supported_reasoning_levels
            .iter()
            .map(|effort| ReasoningEffortPreset {
                effort: *effort,
                description: effort.to_string(),
            })
            .collect(),
        shell_type,
        visibility: ModelVisibility::List,
        supported_in_api: true,
        priority: 99,
        additional_speed_tiers: Vec::new(),
        availability_nux: None,
        upgrade: None,
        base_instructions: BASE_INSTRUCTIONS.to_string(),
        supports_reasoning_summaries: metadata.supports_reasoning_summaries.unwrap_or(false),
        default_reasoning_summary: ReasoningSummary::Auto,
        support_verbosity: metadata.support_verbosity.unwrap_or(false),
        default_verbosity: metadata.default_verbosity,
        apply_patch_tool_type,
        web_search_tool_type,
        truncation_policy: TruncationPolicyConfig::bytes(10_000),
        supports_parallel_tool_calls: metadata.supports_parallel_tool_calls.unwrap_or(false),
        supports_image_detail_original: metadata.supports_image_detail_original.unwrap_or(false),
        context_window,
        max_context_window,
        effective_context_window_percent,
        supported_tools: metadata.supported_tools.clone(),
        input_modalities,
        supports_search_tool: metadata.supports_search_tool.unwrap_or(false),
    }
}

fn shell_type_to_wire(value: ConfigShellToolType) -> String {
    match value {
        ConfigShellToolType::Default => "default",
        ConfigShellToolType::Local => "local",
        ConfigShellToolType::UnifiedExec => "unified_exec",
        ConfigShellToolType::Disabled => "disabled",
        ConfigShellToolType::ShellCommand => "shell_command",
    }
    .to_string()
}

fn shell_type_from_wire(value: &str) -> Option<ConfigShellToolType> {
    match value.trim() {
        "default" => Some(ConfigShellToolType::Default),
        "local" => Some(ConfigShellToolType::Local),
        "unified_exec" => Some(ConfigShellToolType::UnifiedExec),
        "disabled" => Some(ConfigShellToolType::Disabled),
        "shell_command" => Some(ConfigShellToolType::ShellCommand),
        _ => None,
    }
}

fn apply_patch_tool_type_to_wire(value: ApplyPatchToolType) -> String {
    match value {
        ApplyPatchToolType::Freeform => "freeform",
        ApplyPatchToolType::Function => "function",
    }
    .to_string()
}

fn apply_patch_tool_type_from_wire(value: &str) -> Option<ApplyPatchToolType> {
    match value.trim() {
        "freeform" => Some(ApplyPatchToolType::Freeform),
        "function" => Some(ApplyPatchToolType::Function),
        _ => None,
    }
}

fn web_search_tool_type_to_wire(value: WebSearchToolType) -> String {
    match value {
        WebSearchToolType::Text => "text",
        WebSearchToolType::TextAndImage => "text_and_image",
    }
    .to_string()
}

fn web_search_tool_type_from_wire(value: &str) -> Option<WebSearchToolType> {
    match value.trim() {
        "text" => Some(WebSearchToolType::Text),
        "text_and_image" => Some(WebSearchToolType::TextAndImage),
        _ => None,
    }
}

fn input_modality_to_wire(value: &InputModality) -> String {
    match value {
        InputModality::Text => "text",
        InputModality::Image => "image",
    }
    .to_string()
}

fn input_modality_from_wire(value: &str) -> Option<InputModality> {
    match value.trim() {
        "text" => Some(InputModality::Text),
        "image" => Some(InputModality::Image),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use pretty_assertions::assert_eq;

    #[test]
    fn provider_protocol_baseline_avoids_generic_fallback_for_supported_models() {
        let model = model_info_for_provider_protocol(
            Some("deepseek"),
            Some("deepseek_chat_completions"),
            "deepseek-reasoner",
        )
        .expect("supported provider baseline");

        assert_eq!(model.slug, "deepseek-reasoner");
        assert_eq!(
            model.apply_patch_tool_type,
            Some(ApplyPatchToolType::Freeform)
        );
        assert!(!model.supports_search_tool);
    }

    #[test]
    fn exact_catalog_reuses_bundled_metadata_for_namespaced_openai_models() {
        let model = model_info_for_provider_protocol(
            Some("openrouter"),
            Some("openrouter_chat_completions"),
            "openai/gpt-5.4",
        )
        .expect("namespaced bundled model");

        assert_eq!(model.slug, "openai/gpt-5.4");
        assert_eq!(model.display_name, "GPT-5.4");
        assert_eq!(
            model.apply_patch_tool_type,
            Some(ApplyPatchToolType::Freeform)
        );
    }

    #[test]
    fn provider_model_entry_includes_runtime_metadata() {
        let entry = provider_model_entry_from_id(
            "deepseek",
            "deepseek_chat_completions",
            "deepseek-reasoner",
            "preset",
        );

        assert_eq!(entry.id, "deepseek-reasoner");
        assert_eq!(entry.supports_tools, Some(true));
        assert!(entry.runtime_metadata.is_some());
    }
}
