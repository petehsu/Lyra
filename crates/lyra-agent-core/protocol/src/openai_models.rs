//! Shared model metadata types exchanged between Lyra services and clients.
//!
//! These types are serialized across core, TUI, app-server, and SDK boundaries, so field defaults
//! are used to preserve compatibility when older payloads omit newly introduced attributes.

use std::collections::HashMap;
use std::str::FromStr;

use schemars::JsonSchema;
use serde::Deserialize;
use serde::Serialize;
use strum::IntoEnumIterator;
use strum_macros::Display;
use strum_macros::EnumIter;
use ts_rs::TS;

use crate::config_types::ReasoningSummary;
use crate::config_types::Verbosity;

/// See https://platform.openai.com/docs/guides/reasoning?api-mode=responses#get-started-with-reasoning
#[derive(
    Debug,
    Serialize,
    Deserialize,
    Default,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Display,
    JsonSchema,
    TS,
    EnumIter,
    Hash,
)]
#[serde(rename_all = "lowercase")]
#[strum(serialize_all = "lowercase")]
pub enum ReasoningEffort {
    None,
    Minimal,
    Low,
    #[default]
    Medium,
    High,
    XHigh,
}

impl FromStr for ReasoningEffort {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        serde_json::from_value(serde_json::Value::String(s.to_string()))
            .map_err(|_| format!("invalid reasoning_effort: {s}"))
    }
}

/// Canonical user-input modality tags advertised by a model.
#[derive(
    Debug,
    Serialize,
    Deserialize,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Display,
    JsonSchema,
    TS,
    EnumIter,
    Hash,
)]
#[serde(rename_all = "lowercase")]
#[strum(serialize_all = "lowercase")]
pub enum InputModality {
    /// Plain text turns and tool payloads.
    Text,
    /// Image attachments included in user turns.
    Image,
}

/// Backward-compatible default when `input_modalities` is omitted on the wire.
///
/// Legacy payloads predate modality metadata, so we conservatively assume both text and images are
/// accepted unless a preset explicitly narrows support.
pub fn default_input_modalities() -> Vec<InputModality> {
    vec![InputModality::Text, InputModality::Image]
}

/// A reasoning effort option that can be surfaced for a model.
#[derive(Debug, Clone, Deserialize, Serialize, TS, JsonSchema, PartialEq, Eq)]
pub struct ReasoningEffortPreset {
    /// Effort level that the model supports.
    pub effort: ReasoningEffort,
    /// Short human description shown next to the effort in UIs.
    pub description: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, TS, JsonSchema, PartialEq)]
pub struct ModelUpgrade {
    pub id: String,
    pub reasoning_effort_mapping: Option<HashMap<ReasoningEffort, ReasoningEffort>>,
    pub migration_config_key: String,
    pub model_link: Option<String>,
    pub upgrade_copy: Option<String>,
    pub migration_markdown: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, TS, JsonSchema, PartialEq, Eq)]
pub struct ModelAvailabilityNux {
    pub message: String,
}

/// Metadata describing a Lyra-supported model.
#[derive(Debug, Clone, Deserialize, Serialize, TS, JsonSchema, PartialEq)]
pub struct ModelPreset {
    /// Stable identifier for the preset.
    pub id: String,
    /// Model slug (e.g., "gpt-5").
    pub model: String,
    /// Display name shown in UIs.
    pub display_name: String,
    /// Short human description shown in UIs.
    pub description: String,
    /// Reasoning effort applied when none is explicitly chosen.
    pub default_reasoning_effort: ReasoningEffort,
    /// Supported reasoning effort options.
    pub supported_reasoning_efforts: Vec<ReasoningEffortPreset>,
    /// Additional speed tiers this model can run with beyond the standard path.
    #[serde(default)]
    pub additional_speed_tiers: Vec<String>,
    /// Whether this is the default model for new users.
    pub is_default: bool,
    /// recommended upgrade model
    pub upgrade: Option<ModelUpgrade>,
    /// Whether this preset should appear in the picker UI.
    pub show_in_picker: bool,
    /// Availability NUX shown when this preset becomes accessible to the user.
    pub availability_nux: Option<ModelAvailabilityNux>,
    /// whether this model is supported in the api
    pub supported_in_api: bool,
    /// Input modalities accepted when composing user turns for this preset.
    #[serde(default = "default_input_modalities")]
    pub input_modalities: Vec<InputModality>,
}

/// Visibility of a model in the picker or APIs.
#[derive(
    Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq, TS, JsonSchema, EnumIter, Display,
)]
#[serde(rename_all = "lowercase")]
#[strum(serialize_all = "lowercase")]
pub enum ModelVisibility {
    List,
    Hide,
    None,
}

/// Shell execution capability for a model.
#[derive(
    Debug,
    Serialize,
    Deserialize,
    Clone,
    Copy,
    PartialEq,
    Eq,
    TS,
    JsonSchema,
    EnumIter,
    Display,
    Hash,
)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum ConfigShellToolType {
    Default,
    Local,
    UnifiedExec,
    Disabled,
    ShellCommand,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash, TS, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ApplyPatchToolType {
    Freeform,
    Function,
}

#[derive(
    Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash, TS, JsonSchema, Default,
)]
#[serde(rename_all = "snake_case")]
pub enum WebSearchToolType {
    #[default]
    Text,
    TextAndImage,
}

/// Server-provided truncation policy metadata for a model.
#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq, TS, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum TruncationMode {
    Bytes,
    Tokens,
}

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq, TS, JsonSchema)]
pub struct TruncationPolicyConfig {
    pub mode: TruncationMode,
    pub limit: i64,
}

impl TruncationPolicyConfig {
    pub const fn bytes(limit: i64) -> Self {
        Self {
            mode: TruncationMode::Bytes,
            limit,
        }
    }

    pub const fn tokens(limit: i64) -> Self {
        Self {
            mode: TruncationMode::Tokens,
            limit,
        }
    }
}

/// Semantic version triple encoded as an array in JSON (e.g. [0, 62, 0]).
#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq, TS, JsonSchema)]
pub struct ClientVersion(pub i32, pub i32, pub i32);

const fn default_effective_context_window_percent() -> i64 {
    95
}

/// Model metadata returned by the Lyra backend `/models` endpoint.
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq, TS, JsonSchema)]
pub struct ModelInfo {
    pub slug: String,
    pub display_name: String,
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_reasoning_level: Option<ReasoningEffort>,
    pub supported_reasoning_levels: Vec<ReasoningEffortPreset>,
    pub shell_type: ConfigShellToolType,
    pub visibility: ModelVisibility,
    pub supported_in_api: bool,
    pub priority: i32,
    #[serde(default)]
    pub additional_speed_tiers: Vec<String>,
    pub availability_nux: Option<ModelAvailabilityNux>,
    pub upgrade: Option<ModelInfoUpgrade>,
    pub base_instructions: String,
    pub supports_reasoning_summaries: bool,
    #[serde(default)]
    pub default_reasoning_summary: ReasoningSummary,
    pub support_verbosity: bool,
    pub default_verbosity: Option<Verbosity>,
    pub apply_patch_tool_type: Option<ApplyPatchToolType>,
    #[serde(default)]
    pub web_search_tool_type: WebSearchToolType,
    pub truncation_policy: TruncationPolicyConfig,
    pub supports_parallel_tool_calls: bool,
    #[serde(default)]
    pub supports_image_detail_original: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context_window: Option<i64>,
    /// Maximum context window allowed for config overrides.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_context_window: Option<i64>,
    /// Percentage of the context window considered usable for inputs, after
    /// reserving headroom for system prompts, tool overhead, and model output.
    #[serde(default = "default_effective_context_window_percent")]
    pub effective_context_window_percent: i64,
    pub supported_tools: Vec<String>,
    /// Input modalities accepted by the backend for this model.
    #[serde(default = "default_input_modalities")]
    pub input_modalities: Vec<InputModality>,
    #[serde(default)]
    pub supports_search_tool: bool,
}

impl ModelInfo {
    pub fn resolved_context_window(&self) -> Option<i64> {
        self.context_window.or(self.max_context_window)
    }

    pub fn get_model_instructions(&self) -> String {
        self.base_instructions.clone()
    }
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq, TS, JsonSchema)]
pub struct ModelInfoUpgrade {
    pub model: String,
    pub migration_markdown: String,
}

impl From<&ModelUpgrade> for ModelInfoUpgrade {
    fn from(upgrade: &ModelUpgrade) -> Self {
        ModelInfoUpgrade {
            model: upgrade.id.clone(),
            migration_markdown: upgrade.migration_markdown.clone().unwrap_or_default(),
        }
    }
}

/// Response wrapper for `/models`.
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq, TS, JsonSchema, Default)]
pub struct ModelsResponse {
    pub models: Vec<ModelInfo>,
}

// convert ModelInfo to ModelPreset
impl From<ModelInfo> for ModelPreset {
    fn from(info: ModelInfo) -> Self {
        ModelPreset {
            id: info.slug.clone(),
            model: info.slug.clone(),
            display_name: info.display_name,
            description: info.description.unwrap_or_default(),
            default_reasoning_effort: info
                .default_reasoning_level
                .unwrap_or(ReasoningEffort::None),
            supported_reasoning_efforts: info.supported_reasoning_levels.clone(),
            additional_speed_tiers: info.additional_speed_tiers,
            is_default: false, // default is the highest priority available model
            upgrade: info.upgrade.as_ref().map(|upgrade| ModelUpgrade {
                id: upgrade.model.clone(),
                reasoning_effort_mapping: reasoning_effort_mapping_from_presets(
                    &info.supported_reasoning_levels,
                ),
                migration_config_key: info.slug.clone(),
                // todo(aibrahim): add the model link here.
                model_link: None,
                upgrade_copy: None,
                migration_markdown: Some(upgrade.migration_markdown.clone()),
            }),
            show_in_picker: info.visibility == ModelVisibility::List,
            availability_nux: info.availability_nux,
            supported_in_api: info.supported_in_api,
            input_modalities: info.input_modalities,
        }
    }
}

impl ModelPreset {
    /// Filter models down to presets that are supported by the public API surface.
    pub fn filter_api_supported(models: Vec<ModelPreset>) -> Vec<ModelPreset> {
        models
            .into_iter()
            .filter(|model| model.supported_in_api)
            .collect()
    }

    /// Recompute the single default preset using picker visibility.
    ///
    /// The first picker-visible model wins; if none are picker-visible, the first model wins.
    pub fn mark_default_by_picker_visibility(models: &mut [ModelPreset]) {
        for preset in models.iter_mut() {
            preset.is_default = false;
        }
        if let Some(default) = models.iter_mut().find(|preset| preset.show_in_picker) {
            default.is_default = true;
        } else if let Some(default) = models.first_mut() {
            default.is_default = true;
        }
    }
}

fn reasoning_effort_mapping_from_presets(
    presets: &[ReasoningEffortPreset],
) -> Option<HashMap<ReasoningEffort, ReasoningEffort>> {
    if presets.is_empty() {
        return None;
    }

    // Map every canonical effort to the closest supported effort for the new model.
    let supported: Vec<ReasoningEffort> = presets.iter().map(|p| p.effort).collect();
    let mut map = HashMap::new();
    for effort in ReasoningEffort::iter() {
        let nearest = nearest_effort(effort, &supported);
        map.insert(effort, nearest);
    }
    Some(map)
}

fn effort_rank(effort: ReasoningEffort) -> i32 {
    match effort {
        ReasoningEffort::None => 0,
        ReasoningEffort::Minimal => 1,
        ReasoningEffort::Low => 2,
        ReasoningEffort::Medium => 3,
        ReasoningEffort::High => 4,
        ReasoningEffort::XHigh => 5,
    }
}

fn nearest_effort(target: ReasoningEffort, supported: &[ReasoningEffort]) -> ReasoningEffort {
    let target_rank = effort_rank(target);
    supported
        .iter()
        .copied()
        .min_by_key(|candidate| (effort_rank(*candidate) - target_rank).abs())
        .unwrap_or(target)
}

#[cfg(test)]
mod tests {
    use super::*;
    use pretty_assertions::assert_eq;

    fn test_model() -> ModelInfo {
        ModelInfo {
            slug: "test-model".to_string(),
            display_name: "Test Model".to_string(),
            description: None,
            default_reasoning_level: None,
            supported_reasoning_levels: vec![],
            shell_type: ConfigShellToolType::ShellCommand,
            visibility: ModelVisibility::List,
            supported_in_api: true,
            priority: 1,
            additional_speed_tiers: Vec::new(),
            availability_nux: None,
            upgrade: None,
            base_instructions: "base".to_string(),
            supports_reasoning_summaries: false,
            default_reasoning_summary: ReasoningSummary::Auto,
            support_verbosity: false,
            default_verbosity: None,
            apply_patch_tool_type: None,
            web_search_tool_type: WebSearchToolType::Text,
            truncation_policy: TruncationPolicyConfig::bytes(/*limit*/ 10_000),
            supports_parallel_tool_calls: false,
            supports_image_detail_original: false,
            context_window: None,
            max_context_window: None,
            effective_context_window_percent: 95,
            supported_tools: vec![],
            input_modalities: default_input_modalities(),
            supports_search_tool: false,
        }
    }

    #[test]
    fn reasoning_effort_from_str_accepts_known_values() {
        assert_eq!("high".parse(), Ok(ReasoningEffort::High));
        assert_eq!("minimal".parse(), Ok(ReasoningEffort::Minimal));
    }

    #[test]
    fn reasoning_effort_from_str_rejects_unknown_values() {
        assert_eq!(
            "unsupported".parse::<ReasoningEffort>(),
            Err("invalid reasoning_effort: unsupported".to_string())
        );
    }

    #[test]
    fn model_info_defaults_availability_nux_to_none_when_omitted() {
        let model: ModelInfo = serde_json::from_value(serde_json::json!({
            "slug": "test-model",
            "display_name": "Test Model",
            "description": null,
            "supported_reasoning_levels": [],
            "shell_type": "shell_command",
            "visibility": "list",
            "supported_in_api": true,
            "priority": 1,
            "upgrade": null,
            "base_instructions": "base",
            "supports_reasoning_summaries": false,
            "default_reasoning_summary": "auto",
            "support_verbosity": false,
            "default_verbosity": null,
            "apply_patch_tool_type": null,
            "truncation_policy": {
                "mode": "bytes",
                "limit": 10000
            },
            "supports_parallel_tool_calls": false,
            "supports_image_detail_original": false,
            "context_window": null,
            "effective_context_window_percent": 95,
            "supported_tools": [],
            "input_modalities": ["text", "image"]
        }))
        .expect("deserialize model info");

        assert_eq!(model.availability_nux, None);
        assert!(!model.supports_image_detail_original);
        assert_eq!(model.web_search_tool_type, WebSearchToolType::Text);
        assert!(!model.supports_search_tool);
    }

    #[test]
    fn resolved_context_window_prefers_context_window() {
        let model = ModelInfo {
            context_window: Some(273_000),
            max_context_window: Some(400_000),
            ..test_model()
        };

        assert_eq!(model.resolved_context_window(), Some(273_000));
    }

    #[test]
    fn resolved_context_window_falls_back_to_max_context_window() {
        let model = ModelInfo {
            context_window: None,
            max_context_window: Some(400_000),
            ..test_model()
        };

        assert_eq!(model.resolved_context_window(), Some(400_000));
    }

    #[test]
    fn model_preset_preserves_availability_nux() {
        let preset = ModelPreset::from(ModelInfo {
            availability_nux: Some(ModelAvailabilityNux {
                message: "Try Spark.".to_string(),
            }),
            ..test_model()
        });

        assert_eq!(
            preset.availability_nux,
            Some(ModelAvailabilityNux {
                message: "Try Spark.".to_string(),
            })
        );
    }
}
