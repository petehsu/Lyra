//! Centralized feature flags and metadata.
//!
//! This crate defines the feature registry plus the logic used to resolve an
//! effective feature set from config-like inputs.

use lyra_otel::SessionTelemetry;
use schemars::JsonSchema;
use serde::Deserialize;
use serde::Serialize;
use std::collections::BTreeMap;
use std::collections::BTreeSet;

mod feature_configs;
pub use feature_configs::MultiAgentV2ConfigToml;

/// High-level lifecycle stage for a feature.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Stage {
    /// Stable features. The feature flag is kept for ad-hoc enabling/disabling
    Stable,
    /// Internal features that may be toggled by first-party config only.
    Internal,
    /// Deprecated feature that should not be used anymore.
    Deprecated,
    /// The feature flag is a no-op and should not be used.
    Removed,
}

/// Unique features toggled via configuration.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Feature {
    // Stable.
    /// Create a ghost commit at each turn.
    GhostCommit,
    /// Enable the default shell tool.
    ShellTool,

    /// Enable JavaScript REPL tools backed by a persistent Node kernel.
    JsRepl,
    /// Enable a minimal JavaScript mode backed by Node's built-in vm runtime.
    CodeMode,
    /// Restrict model-visible tools to code mode entrypoints (`exec`, `wait`).
    CodeModeOnly,
    /// Only expose js_repl tools directly to the model.
    JsReplToolsOnly,
    /// Use the single unified PTY-backed exec tool.
    UnifiedExec,
    /// Route shell tool execution through the zsh exec bridge.
    ShellZshFork,
    /// Include the freeform apply_patch tool.
    ApplyPatchFreeform,
    /// Stream structured progress while apply_patch input is being generated.
    ApplyPatchStreamingEvents,
    /// Allow exec tools to request additional permissions while staying sandboxed.
    ExecPermissionApprovals,
    /// Enable Claude-style lifecycle hooks loaded from hooks.json files.
    LyraHooks,
    /// Expose the built-in request_permissions tool.
    RequestPermissionsTool,
    /// Allow the model to request web searches that fetch live content.
    WebSearchRequest,
    /// Allow the model to request web searches that fetch cached content.
    /// Takes precedence over `WebSearchRequest`.
    WebSearchCached,
    /// Removed search-tool feature flag.
    SearchTool,
    /// Removed Linux bubblewrap opt-in flag.
    UseLinuxSandboxBwrap,
    /// Use the classic Landlock Linux sandbox fallback instead of the default
    /// bubblewrap pipeline.
    UseClassicLandlock,
    /// Allow the model to request approval and propose exec rules.
    RequestRule,
    /// Removed remote models flag.
    RemoteModels,
    /// Enable shell snapshotting.
    ShellSnapshot,
    /// Enable git commit attribution guidance via model instructions.
    LyraGitCommit,
    /// Enable runtime metrics snapshots via a manual reader.
    RuntimeMetrics,
    /// Enable thread lifecycle analytics emitted via the app-server analytics pipeline.
    GeneralAnalytics,
    /// Persist rollout metadata to a local SQLite database.
    Sqlite,
    /// Enable the Telepathy sidecar for passive screen-context memories.
    Telepathy,
    /// Append additional AGENTS.md guidance to user instructions.
    ChildAgentsMd,
    /// Compress request bodies (zstd) when sending streaming requests to lyra-backend.
    EnableRequestCompression,
    /// Enable collab tools.
    Collab,
    /// Enable task-path-based multi-agent routing.
    MultiAgentV2,
    /// Enable CSV-backed agent job tools.
    SpawnCsv,
    /// Enable apps.
    Apps,
    /// Enable the tool_search tool for apps.
    ToolSearch,
    /// Always defer MCP tools behind tool_search instead of exposing small sets directly.
    ToolSearchAlwaysDeferMcpTools,
    /// Expose placeholder tools for unavailable historical tool calls.
    UnavailableDummyTools,
    /// Enable discoverable tool suggestions for apps.
    ToolSuggest,
    /// Enable plugins.
    Plugins,
    /// Allow the model to invoke the built-in image generation tool.
    ImageGeneration,
    /// Allow prompting and installing missing MCP dependencies.
    SkillMcpDependencyInstall,
    /// Prompt for missing skill env var dependencies.
    SkillEnvVarDependencyPrompt,
    /// Steer feature flag. Behavior is always steer-enabled.
    Steer,
    /// Allow request_user_input in Default collaboration mode.
    DefaultModeRequestUserInput,
    /// Enable automatic review for approval prompts.
    AutoReviewApproval,
    /// Enable collaboration modes (Plan, Default). Behavior is always enabled.
    CollaborationModes,
    /// Route MCP tool approval prompts through the MCP elicitation request path.
    ToolCallMcpElicitation,
    /// Enable native artifact tools.
    Artifact,
    /// Removed image detail feature flag.
    ImageDetailOriginal,
    /// Removed TUI app-server flag. The TUI always uses the app-server implementation.
    TuiAppServer,
    /// Legacy rollout flag for Responses API WebSocket transport.
    ResponsesWebsockets,
    /// Legacy rollout flag for Responses API WebSocket transport v2.
    ResponsesWebsocketsV2,
    /// Enable workspace dependency support.
    WorkspaceDependencies,
}

impl Feature {
    pub fn key(self) -> &'static str {
        self.info().key
    }

    pub fn stage(self) -> Stage {
        self.info().stage
    }

    pub fn default_enabled(self) -> bool {
        self.info().default_enabled
    }

    fn info(self) -> &'static FeatureSpec {
        FEATURES
            .iter()
            .find(|spec| spec.id == self)
            .unwrap_or_else(|| unreachable!("missing FeatureSpec for {self:?}"))
    }
}

/// Holds the effective set of enabled features.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Features {
    enabled: BTreeSet<Feature>,
}

#[derive(Debug, Clone, Default)]
pub struct FeatureOverrides {
    pub include_apply_patch_tool: Option<bool>,
    pub web_search_request: Option<bool>,
}

#[derive(Debug, Clone, Copy, Default)]
pub struct FeatureConfigSource<'a> {
    pub features: Option<&'a FeaturesToml>,
}

impl FeatureOverrides {
    fn apply(self, features: &mut Features) {
        if let Some(enabled) = self.include_apply_patch_tool {
            features.set_enabled(Feature::ApplyPatchFreeform, enabled);
        }
        if let Some(enabled) = self.web_search_request {
            features.set_enabled(Feature::WebSearchRequest, enabled);
        }
    }
}

impl Features {
    /// Starts with built-in defaults.
    pub fn with_defaults() -> Self {
        let mut set = BTreeSet::new();
        for spec in FEATURES {
            if spec.default_enabled {
                set.insert(spec.id);
            }
        }
        Self { enabled: set }
    }

    pub fn enabled(&self, f: Feature) -> bool {
        self.enabled.contains(&f)
    }

    pub fn apps_enabled_for_auth(&self, _has_managed_auth: bool) -> bool {
        self.enabled(Feature::Apps)
    }

    pub fn use_classic_landlock(&self) -> bool {
        self.enabled(Feature::UseClassicLandlock)
    }

    pub fn enable(&mut self, f: Feature) -> &mut Self {
        self.enabled.insert(f);
        self
    }

    pub fn disable(&mut self, f: Feature) -> &mut Self {
        self.enabled.remove(&f);
        self
    }

    pub fn set_enabled(&mut self, f: Feature, enabled: bool) -> &mut Self {
        if enabled {
            self.enable(f)
        } else {
            self.disable(f)
        }
    }

    pub fn emit_metrics(&self, otel: &SessionTelemetry) {
        for feature in FEATURES {
            if matches!(feature.stage, Stage::Removed) {
                continue;
            }
            if self.enabled(feature.id) != feature.default_enabled {
                otel.counter(
                    "lyra.feature.state",
                    /*inc*/ 1,
                    &[
                        ("feature", feature.key),
                        ("value", &self.enabled(feature.id).to_string()),
                    ],
                );
            }
        }
    }

    /// Apply a table of key -> bool toggles (e.g. from TOML).
    pub fn apply_map(&mut self, m: &BTreeMap<String, bool>) {
        for (k, v) in m {
            match feature_for_key(k) {
                Some(feat) => {
                    if matches!(feat.stage(), Stage::Removed) {
                        continue;
                    }
                    if *v {
                        self.enable(feat);
                    } else {
                        self.disable(feat);
                    }
                }
                None => {
                    tracing::warn!("unknown feature key in config: {k}");
                }
            }
        }
    }

    pub fn from_sources(
        base: FeatureConfigSource<'_>,
        profile: FeatureConfigSource<'_>,
        overrides: FeatureOverrides,
    ) -> Self {
        let mut features = Features::with_defaults();

        for source in [base, profile] {
            if let Some(feature_entries) = source.features {
                features.apply_toml(feature_entries);
            }
        }

        overrides.apply(&mut features);
        features.normalize_dependencies();

        features
    }

    pub fn enabled_features(&self) -> Vec<Feature> {
        self.enabled.iter().copied().collect()
    }

    pub fn normalize_dependencies(&mut self) {
        if self.enabled(Feature::SpawnCsv) && !self.enabled(Feature::Collab) {
            self.enable(Feature::Collab);
        }
        if self.enabled(Feature::CodeModeOnly) && !self.enabled(Feature::CodeMode) {
            self.enable(Feature::CodeMode);
        }
        if self.enabled(Feature::JsReplToolsOnly) && !self.enabled(Feature::JsRepl) {
            tracing::warn!("js_repl_tools_only requires js_repl; disabling js_repl_tools_only");
            self.disable(Feature::JsReplToolsOnly);
        }
    }
}

/// Keys accepted in `[features]` tables.
pub fn feature_for_key(key: &str) -> Option<Feature> {
    FEATURES
        .iter()
        .find(|spec| spec.key == key)
        .map(|spec| spec.id)
}

pub fn canonical_feature_for_key(key: &str) -> Option<Feature> {
    FEATURES
        .iter()
        .find(|spec| spec.key == key)
        .map(|spec| spec.id)
}

/// Returns `true` if the provided string matches a known feature toggle key.
pub fn is_known_feature_key(key: &str) -> bool {
    feature_for_key(key).is_some()
}

/// Deserializable features table for TOML.
#[derive(Serialize, Deserialize, Debug, Clone, Default, PartialEq, JsonSchema)]
pub struct FeaturesToml {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub multi_agent_v2: Option<FeatureToml<MultiAgentV2ConfigToml>>,
    /// Boolean feature toggles keyed by canonical feature name.
    #[serde(flatten)]
    entries: BTreeMap<String, bool>,
}

impl Features {
    fn apply_toml(&mut self, features: &FeaturesToml) {
        let entries = features.entries();
        self.apply_map(&entries);
    }
}

impl FeaturesToml {
    pub fn entries(&self) -> BTreeMap<String, bool> {
        let mut entries = self.entries.clone();
        if let Some(enabled) = self.multi_agent_v2.as_ref().and_then(FeatureToml::enabled) {
            entries.insert(Feature::MultiAgentV2.key().to_string(), enabled);
        }
        entries
    }
}

impl From<BTreeMap<String, bool>> for FeaturesToml {
    fn from(entries: BTreeMap<String, bool>) -> Self {
        Self {
            entries,
            ..Default::default()
        }
    }
}

// To be used for features that need more configuration than just enabled/disabled and
// require a custom config struct under `[features]`.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq, JsonSchema)]
#[serde(untagged)]
pub enum FeatureToml<T> {
    Enabled(bool),
    Config(T),
}

impl<T: FeatureConfig> FeatureToml<T> {
    pub fn enabled(&self) -> Option<bool> {
        match self {
            Self::Enabled(enabled) => Some(*enabled),
            Self::Config(config) => config.enabled(),
        }
    }
}

// A trait to be implemented by custom feature config structs when defining a feature that needs more configuration than
// just enabled/disabled.
pub trait FeatureConfig {
    fn enabled(&self) -> Option<bool>;
}

/// Single, easy-to-read registry of all feature definitions.
#[derive(Debug, Clone, Copy)]
pub struct FeatureSpec {
    pub id: Feature,
    pub key: &'static str,
    pub stage: Stage,
    pub default_enabled: bool,
}

pub const FEATURES: &[FeatureSpec] = &[
    // Stable features.
    FeatureSpec {
        id: Feature::GhostCommit,
        key: "undo",
        stage: Stage::Stable,
        default_enabled: true,
    },
    FeatureSpec {
        id: Feature::ShellTool,
        key: "shell_tool",
        stage: Stage::Stable,
        default_enabled: true,
    },
    FeatureSpec {
        id: Feature::UnifiedExec,
        key: "unified_exec",
        stage: Stage::Stable,
        default_enabled: !cfg!(windows),
    },
    FeatureSpec {
        id: Feature::ShellZshFork,
        key: "shell_zsh_fork",
        stage: Stage::Internal,
        default_enabled: false,
    },
    FeatureSpec {
        id: Feature::ShellSnapshot,
        key: "shell_snapshot",
        stage: Stage::Stable,
        default_enabled: true,
    },
    FeatureSpec {
        id: Feature::JsRepl,
        key: "js_repl",
        stage: Stage::Stable,
        default_enabled: true,
    },
    FeatureSpec {
        id: Feature::CodeMode,
        key: "code_mode",
        stage: Stage::Internal,
        default_enabled: false,
    },
    FeatureSpec {
        id: Feature::CodeModeOnly,
        key: "code_mode_only",
        stage: Stage::Internal,
        default_enabled: false,
    },
    FeatureSpec {
        id: Feature::JsReplToolsOnly,
        key: "js_repl_tools_only",
        stage: Stage::Internal,
        default_enabled: false,
    },
    FeatureSpec {
        id: Feature::WebSearchRequest,
        key: "web_search_request",
        stage: Stage::Deprecated,
        default_enabled: false,
    },
    FeatureSpec {
        id: Feature::WebSearchCached,
        key: "web_search_cached",
        stage: Stage::Deprecated,
        default_enabled: false,
    },
    FeatureSpec {
        id: Feature::SearchTool,
        key: "search_tool",
        stage: Stage::Removed,
        default_enabled: false,
    },
    FeatureSpec {
        id: Feature::LyraGitCommit,
        key: "lyra_git_commit",
        stage: Stage::Internal,
        default_enabled: false,
    },
    FeatureSpec {
        id: Feature::RuntimeMetrics,
        key: "runtime_metrics",
        stage: Stage::Internal,
        default_enabled: false,
    },
    FeatureSpec {
        id: Feature::GeneralAnalytics,
        key: "general_analytics",
        stage: Stage::Stable,
        default_enabled: true,
    },
    FeatureSpec {
        id: Feature::Sqlite,
        key: "sqlite",
        stage: Stage::Removed,
        default_enabled: true,
    },
    FeatureSpec {
        id: Feature::Telepathy,
        key: "telepathy",
        stage: Stage::Internal,
        default_enabled: false,
    },
    FeatureSpec {
        id: Feature::ChildAgentsMd,
        key: "child_agents_md",
        stage: Stage::Internal,
        default_enabled: false,
    },
    FeatureSpec {
        id: Feature::ApplyPatchFreeform,
        key: "apply_patch_freeform",
        stage: Stage::Internal,
        default_enabled: false,
    },
    FeatureSpec {
        id: Feature::ApplyPatchStreamingEvents,
        key: "apply_patch_streaming_events",
        stage: Stage::Internal,
        default_enabled: true,
    },
    FeatureSpec {
        id: Feature::ExecPermissionApprovals,
        key: "exec_permission_approvals",
        stage: Stage::Internal,
        default_enabled: false,
    },
    FeatureSpec {
        id: Feature::LyraHooks,
        key: "lyra_hooks",
        stage: Stage::Internal,
        default_enabled: false,
    },
    FeatureSpec {
        id: Feature::RequestPermissionsTool,
        key: "request_permissions_tool",
        stage: Stage::Internal,
        default_enabled: false,
    },
    FeatureSpec {
        id: Feature::UseLinuxSandboxBwrap,
        key: "use_linux_sandbox_bwrap",
        stage: Stage::Removed,
        default_enabled: false,
    },
    FeatureSpec {
        id: Feature::UseClassicLandlock,
        key: "use_classic_landlock",
        stage: Stage::Deprecated,
        default_enabled: false,
    },
    FeatureSpec {
        id: Feature::RequestRule,
        key: "request_rule",
        stage: Stage::Removed,
        default_enabled: false,
    },
    FeatureSpec {
        id: Feature::RemoteModels,
        key: "remote_models",
        stage: Stage::Removed,
        default_enabled: false,
    },
    FeatureSpec {
        id: Feature::EnableRequestCompression,
        key: "enable_request_compression",
        stage: Stage::Stable,
        default_enabled: true,
    },
    FeatureSpec {
        id: Feature::Collab,
        key: "multi_agent",
        stage: Stage::Stable,
        default_enabled: true,
    },
    FeatureSpec {
        id: Feature::MultiAgentV2,
        key: "multi_agent_v2",
        stage: Stage::Internal,
        default_enabled: false,
    },
    FeatureSpec {
        id: Feature::SpawnCsv,
        key: "enable_fanout",
        stage: Stage::Internal,
        default_enabled: false,
    },
    FeatureSpec {
        id: Feature::Apps,
        key: "apps",
        stage: Stage::Stable,
        default_enabled: true,
    },
    FeatureSpec {
        id: Feature::ToolSearch,
        key: "tool_search",
        stage: Stage::Stable,
        default_enabled: true,
    },
    FeatureSpec {
        id: Feature::ToolSearchAlwaysDeferMcpTools,
        key: "tool_search_always_defer_mcp_tools",
        stage: Stage::Internal,
        default_enabled: false,
    },
    FeatureSpec {
        id: Feature::UnavailableDummyTools,
        key: "unavailable_dummy_tools",
        stage: Stage::Internal,
        default_enabled: false,
    },
    FeatureSpec {
        id: Feature::ToolSuggest,
        key: "tool_suggest",
        stage: Stage::Stable,
        default_enabled: true,
    },
    FeatureSpec {
        id: Feature::Plugins,
        key: "plugins",
        stage: Stage::Stable,
        default_enabled: true,
    },
    FeatureSpec {
        id: Feature::ImageGeneration,
        key: "image_generation",
        stage: Stage::Stable,
        default_enabled: true,
    },
    FeatureSpec {
        id: Feature::SkillMcpDependencyInstall,
        key: "skill_mcp_dependency_install",
        stage: Stage::Stable,
        default_enabled: true,
    },
    FeatureSpec {
        id: Feature::SkillEnvVarDependencyPrompt,
        key: "skill_env_var_dependency_prompt",
        stage: Stage::Internal,
        default_enabled: false,
    },
    FeatureSpec {
        id: Feature::Steer,
        key: "steer",
        stage: Stage::Removed,
        default_enabled: true,
    },
    FeatureSpec {
        id: Feature::DefaultModeRequestUserInput,
        key: "default_mode_request_user_input",
        stage: Stage::Internal,
        default_enabled: false,
    },
    FeatureSpec {
        id: Feature::AutoReviewApproval,
        key: "auto_review_approval",
        stage: Stage::Stable,
        default_enabled: false,
    },
    FeatureSpec {
        id: Feature::CollaborationModes,
        key: "collaboration_modes",
        stage: Stage::Removed,
        default_enabled: true,
    },
    FeatureSpec {
        id: Feature::ToolCallMcpElicitation,
        key: "tool_call_mcp_elicitation",
        stage: Stage::Stable,
        default_enabled: true,
    },
    FeatureSpec {
        id: Feature::Artifact,
        key: "artifact",
        stage: Stage::Internal,
        default_enabled: false,
    },
    FeatureSpec {
        id: Feature::ImageDetailOriginal,
        key: "image_detail_original",
        stage: Stage::Removed,
        default_enabled: false,
    },
    FeatureSpec {
        id: Feature::TuiAppServer,
        key: "tui_app_server",
        stage: Stage::Removed,
        default_enabled: true,
    },
    FeatureSpec {
        id: Feature::ResponsesWebsockets,
        key: "responses_websockets",
        stage: Stage::Removed,
        default_enabled: false,
    },
    FeatureSpec {
        id: Feature::ResponsesWebsocketsV2,
        key: "responses_websockets_v2",
        stage: Stage::Removed,
        default_enabled: false,
    },
    FeatureSpec {
        id: Feature::WorkspaceDependencies,
        key: "workspace_dependencies",
        stage: Stage::Stable,
        default_enabled: true,
    },
];

#[cfg(test)]
mod tests;
