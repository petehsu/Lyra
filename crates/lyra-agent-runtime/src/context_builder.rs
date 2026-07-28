use std::collections::{HashMap, HashSet};

use lyra_agent_plugins::SkillRegistry;
use serde_json::{Value, json};

use crate::retention_policy::{
    CONTEXT_GUARD_TOKENS, ComplexityBand, RetentionPolicy, RetentionSignals, TrimAggressiveness,
    halve_tool_message_ids, retention_policy_from_messages, select_interleaved_provider_keep,
};

use crate::native_backend::inline_images::{
    effective_inline_images_for_user_turn, enrich_inline_images_for_provider,
    expand_inline_image_markers_in_content, prepend_inline_images_vision_to_content,
    provider_image_url_from_value, text_has_inline_image_markers,
};
use crate::native_backend::token_estimate::{estimate_message_tokens, estimate_messages_tokens};
use crate::native_backend::tool_protocol::{
    TOOL_OUTPUT_CLEARED_SUMMARY, TOOL_OUTPUT_OMITTED_SUMMARY, message_has_provider_transcript,
    tool_activity_output_summary,
};
use crate::prompt_policy::PromptAccounting;

pub(crate) const PROVIDER_CONTEXT_METADATA_VERSION: u64 = 1;
const OPENAI_RESPONSES_REPLAY_GROUP_KEY: &str = "lyraOpenaiResponsesReplayGroup";

#[derive(Clone, Debug)]
pub struct ContextBuilder {
    skill_registry: SkillRegistry,
}

impl Default for ContextBuilder {
    fn default() -> Self {
        Self::with_skill_registry(SkillRegistry::with_builtin_skills())
    }
}

#[derive(Clone, Debug)]
pub struct ProviderContextOptions {
    pub supports_image_input: bool,
    pub context_window: Option<usize>,
    pub max_tool_output_chars: usize,
    pub session_tool_count: usize,
    pub last_turn_tool_count: usize,
    pub openai_responses_replay: bool,
    pub provider_id: Option<String>,
    pub route_id: Option<String>,
    pub protocol_id: Option<String>,
    pub model: Option<String>,
    pub tool_outputs_by_id: HashMap<String, String>,
    pub halve_tool_output_message_ids: HashSet<String>,
}

impl Default for ProviderContextOptions {
    fn default() -> Self {
        Self {
            supports_image_input: false,
            context_window: None,
            max_tool_output_chars: 24_000,
            session_tool_count: 0,
            last_turn_tool_count: 0,
            openai_responses_replay: false,
            provider_id: None,
            route_id: None,
            protocol_id: None,
            model: None,
            tool_outputs_by_id: HashMap::new(),
            halve_tool_output_message_ids: HashSet::new(),
        }
    }
}

#[derive(Clone, Debug, Default)]
pub struct ProviderContext {
    pub messages: Vec<Value>,
    pub token_estimate: usize,
    pub input_downgrades: Vec<Value>,
    pub evidence_refs: Vec<Value>,
    pub trimmed: bool,
    pub overflow: Option<Value>,
}

impl ContextBuilder {
    pub const NAME: &'static str = "context_builder";

    pub fn with_skill_registry(skill_registry: SkillRegistry) -> Self {
        Self { skill_registry }
    }

    pub fn build_prompt_context(
        &self,
        messages: Vec<lyra_agent_api::AgentMessage>,
        memory: Option<lyra_agent_api::AgentMemoryProjection>,
    ) -> serde_json::Value {
        serde_json::json!({
            "messages": messages,
            "memory": memory,
            "activeSkillPrompt": self.skill_registry.active_prompt(),
            "activeSkillPermissions": self.skill_registry.active_permissions(),
            "promptAccounting": prompt_accounting_json(&PromptAccounting::default()),
        })
    }

    pub fn build_layered_prompt_context(
        &self,
        runtime_context: Value,
        memory_prompt: String,
        history_token_estimate: usize,
        artifact_token_estimate: usize,
    ) -> serde_json::Value {
        let accounting = PromptAccounting {
            system_budget: 1200,
            tools_budget: 800,
            memory_budget: 600,
            history_budget: history_token_estimate,
            artifact_budget: artifact_token_estimate,
        };
        json!({
            "staticPrompt": "Lyra Agent identity, tool strategy, verification policy",
            "dynamicRuntimeContext": runtime_context,
            "dynamicToolSection": {
                "cacheKey": "runtime-tool-section",
                "strategy": "Only this section changes when Lyra tool manifests change; large schemas stay behind discover/inspect references."
            },
            "activeSkillPrompt": self.skill_registry.active_prompt(),
            "activeSkillPermissions": self.skill_registry.active_permissions(),
            "memoryPrompt": memory_prompt,
            "promptAccounting": prompt_accounting_json(&accounting),
        })
    }

    pub fn build_provider_context(
        &self,
        system_prompt: String,
        messages: Vec<Value>,
        options: ProviderContextOptions,
    ) -> ProviderContext {
        let mut output = ProviderContext {
            messages: vec![json!({
                "role": "system",
                "content": system_prompt,
            })],
            ..ProviderContext::default()
        };

        let retention_signals = RetentionSignals {
            context_window: options.context_window,
            session_tool_count: options.session_tool_count,
            last_turn_tool_count: options.last_turn_tool_count,
        };
        let retention = retention_policy_from_messages(&messages, &retention_signals);
        let mut options = options;
        options.halve_tool_output_message_ids =
            halve_tool_message_ids(&messages, &retention, &HashSet::new());

        for (message_index, message) in messages.iter().enumerate() {
            let provider_messages = provider_messages_from_agent_message(
                message,
                message_index,
                &messages,
                &options,
                &mut output,
            );
            output.messages.extend(provider_messages);
        }
        output.token_estimate = estimate_messages_tokens(&output.messages);
        if should_compact_provider_context(&output, &retention, messages.len()) {
            compact_to_retention_policy(&mut output, retention, TrimAggressiveness::Normal);
        }
        strip_openai_responses_replay_groups(&mut output.messages);
        output.token_estimate = estimate_messages_tokens(&output.messages);
        output
    }
}

mod provider_messages;
mod retention;
#[cfg(test)]
#[path = "context_builder/tests/mod.rs"]
mod tests;

use provider_messages::provider_messages_from_agent_message;
#[cfg(test)]
use retention::normalize_openai_responses_replay_retention;
use retention::{
    compact_to_retention_policy, prompt_accounting_json, should_compact_provider_context,
    strip_openai_responses_replay_groups,
};
