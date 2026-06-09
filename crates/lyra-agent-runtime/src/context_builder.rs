use lyra_agent_plugins::SkillRegistry;
use serde_json::{Value, json};

use crate::prompt_policy::PromptAccounting;

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
}

impl Default for ProviderContextOptions {
    fn default() -> Self {
        Self {
            supports_image_input: false,
            context_window: None,
            max_tool_output_chars: 24_000,
            session_tool_count: 0,
            last_turn_tool_count: 0,
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

        for message in messages {
            if let Some(provider_message) =
                provider_message_from_agent_message(&message, &options, &mut output)
            {
                output.messages.push(provider_message);
            }
        }

        output.token_estimate = estimate_messages_tokens(&output.messages);
        let retention = RetentionPolicy::from_context(&output.messages, &options);
        if output.token_estimate >= retention.trim_trigger_tokens {
            compact_to_retention_policy(&mut output, retention);
        }
        output
    }
}

fn provider_message_from_agent_message(
    message: &Value,
    options: &ProviderContextOptions,
    output: &mut ProviderContext,
) -> Option<Value> {
    let role = message.get("role").and_then(Value::as_str)?;
    let text = message
        .get("text")
        .and_then(Value::as_str)
        .unwrap_or_default();

    if role == "tool" {
        let (content, evidence_ref) =
            trim_tool_output(text, options.max_tool_output_chars, message.get("id"));
        if let Some(evidence_ref) = evidence_ref {
            output.evidence_refs.push(evidence_ref);
        }
        return (!content.trim().is_empty()).then(|| {
            json!({
                "role": "tool",
                "tool_call_id": message.get("toolCallId").or_else(|| message.get("tool_call_id")).cloned().unwrap_or_else(|| Value::String("tool-result".to_string())),
                "content": content,
            })
        });
    }

    let blocks = message
        .get("blocks")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let content = if blocks.is_empty() {
        text_content_or_none(text)?
    } else {
        content_from_blocks(message, &blocks, text, options, output)?
    };

    Some(json!({
        "role": role,
        "content": content,
    }))
}

fn text_content_or_none(text: &str) -> Option<Value> {
    (!text.trim().is_empty()).then(|| Value::String(text.to_string()))
}

fn content_from_blocks(
    message: &Value,
    blocks: &[Value],
    fallback_text: &str,
    options: &ProviderContextOptions,
    output: &mut ProviderContext,
) -> Option<Value> {
    let mut parts = Vec::new();
    for block in blocks {
        match block.get("type").and_then(Value::as_str) {
            Some("text") => {
                if let Some(text) = block.get("text").and_then(Value::as_str)
                    && !text.trim().is_empty()
                {
                    parts.push(json!({ "type": "text", "text": text }));
                }
            }
            Some("image") => {
                if options.supports_image_input {
                    match provider_image_url(block) {
                        Some(url) => {
                            parts.push(json!({
                                "type": "image_url",
                                "image_url": { "url": url },
                            }));
                        }
                        None => {
                            let downgrade =
                                image_downgrade(message, block, "image_data_unavailable");
                            output.input_downgrades.push(downgrade.clone());
                            parts.push(json!({
                                "type": "text",
                                "text": format!(
                                    "[Image omitted: {}]",
                                    downgrade["reason"].as_str().unwrap_or("image unavailable")
                                )
                            }));
                        }
                    }
                } else {
                    let downgrade =
                        image_downgrade(message, block, "model_does_not_support_image_input");
                    output.input_downgrades.push(downgrade.clone());
                    parts.push(json!({
                        "type": "text",
                        "text": format!(
                            "[Image omitted: {}]",
                            downgrade["reason"].as_str().unwrap_or("image input unsupported")
                        )
                    }));
                }
            }
            Some("tool") => {
                let tool_id = block
                    .get("toolId")
                    .or_else(|| block.get("tool_id"))
                    .and_then(Value::as_str)
                    .unwrap_or("tool");
                let evidence_ref = json!({
                    "kind": "tool_result_ref",
                    "toolId": tool_id,
                    "messageId": message.get("id").cloned().unwrap_or(Value::Null),
                });
                output.evidence_refs.push(evidence_ref);
                parts.push(json!({
                    "type": "text",
                    "text": format!("[Tool result ref: {tool_id}]"),
                }));
            }
            _ => {}
        }
    }

    if parts.is_empty() {
        return text_content_or_none(fallback_text);
    }

    if parts.len() == 1
        && let Some(text) = parts[0].get("text").and_then(Value::as_str)
    {
        return Some(Value::String(text.to_string()));
    }

    Some(Value::Array(parts))
}

fn provider_image_url(block: &Value) -> Option<String> {
    let media_type = block
        .get("mediaType")
        .or_else(|| block.get("media_type"))
        .and_then(Value::as_str)
        .unwrap_or("image/png");
    let data = block
        .get("data")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if data.starts_with("data:image/")
        || data.starts_with("http://")
        || data.starts_with("https://")
    {
        return Some(data.to_string());
    }
    if !data.trim().is_empty() {
        return Some(format!("data:{media_type};base64,{data}"));
    }
    block
        .get("source")
        .and_then(Value::as_str)
        .filter(|source| source.starts_with("http://") || source.starts_with("https://"))
        .map(str::to_string)
}

fn image_downgrade(message: &Value, block: &Value, reason: &str) -> Value {
    json!({
        "kind": "image_input_downgrade",
        "reason": reason,
        "messageId": message.get("id").cloned().unwrap_or(Value::Null),
        "blockId": block.get("id").cloned().unwrap_or(Value::Null),
        "mediaType": block.get("mediaType").or_else(|| block.get("media_type")).cloned().unwrap_or(Value::Null),
        "label": block.get("label").cloned().unwrap_or(Value::Null),
        "source": block.get("source").cloned().unwrap_or(Value::Null),
    })
}

fn trim_tool_output(
    text: &str,
    max_chars: usize,
    message_id: Option<&Value>,
) -> (String, Option<Value>) {
    if max_chars == 0 || text.chars().count() <= max_chars {
        return (text.to_string(), None);
    }
    let trimmed = text.chars().take(max_chars).collect::<String>();
    let evidence_ref = json!({
        "kind": "truncated_tool_output",
        "messageId": message_id.cloned().unwrap_or(Value::Null),
        "originalChars": text.chars().count(),
        "keptChars": max_chars,
    });
    (
        format!(
            "{trimmed}\n\n[Tool output truncated; full output retained by Lyra as evidence ref.]"
        ),
        Some(evidence_ref),
    )
}

fn estimate_messages_tokens(messages: &[Value]) -> usize {
    messages
        .iter()
        .map(|message| estimate_tokens(&serde_json::to_string(message).unwrap_or_default()))
        .sum()
}

fn estimate_tokens(text: &str) -> usize {
    (text.chars().count() / 4).max(1)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ComplexityBand {
    Simple,
    Normal,
    Complex,
}

#[derive(Clone, Copy, Debug)]
struct RetentionPolicy {
    usable_context_tokens: usize,
    trim_trigger_tokens: usize,
    target_tokens: usize,
    protected_recent_tokens: usize,
    complexity_score: usize,
    complexity_band: ComplexityBand,
    has_explicit_context_window: bool,
}

const DEFAULT_RETENTION_CONTEXT_TOKENS: usize = 100_000;
const RETENTION_TRIM_TRIGGER_CAP_TOKENS: usize = 100_000;
const TARGET_MIN_RETAINED_TOKENS: usize = 100_000;
const RECENT_PROTECTED_TOKENS: usize = 50_000;
const CONTEXT_GUARD_TOKENS: usize = 128;

impl RetentionPolicy {
    fn from_context(messages: &[Value], options: &ProviderContextOptions) -> Self {
        let usable_context_tokens = options
            .context_window
            .filter(|window| *window > 0)
            .unwrap_or(DEFAULT_RETENTION_CONTEXT_TOKENS);
        let trim_trigger_tokens = if usable_context_tokens >= RETENTION_TRIM_TRIGGER_CAP_TOKENS {
            RETENTION_TRIM_TRIGGER_CAP_TOKENS
        } else {
            ((usable_context_tokens as f64 * 0.82) as usize).max(1)
        };
        let complexity_score = complexity_score(messages, options);
        let complexity_band = if complexity_score >= 120 {
            ComplexityBand::Complex
        } else if complexity_score >= 48 {
            ComplexityBand::Normal
        } else {
            ComplexityBand::Simple
        };
        let base_target =
            if usable_context_tokens >= TARGET_MIN_RETAINED_TOKENS {
                match complexity_band {
                    ComplexityBand::Complex => ((usable_context_tokens as f64 * 0.92) as usize)
                        .max(TARGET_MIN_RETAINED_TOKENS),
                    ComplexityBand::Normal => ((usable_context_tokens as f64 * 0.84) as usize)
                        .max(TARGET_MIN_RETAINED_TOKENS),
                    ComplexityBand::Simple => TARGET_MIN_RETAINED_TOKENS,
                }
            } else {
                match complexity_band {
                    ComplexityBand::Complex => (usable_context_tokens as f64 * 0.88) as usize,
                    ComplexityBand::Normal => (usable_context_tokens as f64 * 0.78) as usize,
                    ComplexityBand::Simple => (usable_context_tokens as f64 * 0.68) as usize,
                }
            };
        let target_tokens = base_target
            .min(usable_context_tokens.saturating_sub(CONTEXT_GUARD_TOKENS))
            .max((usable_context_tokens / 2).max(1));
        let protected_recent_tokens = if usable_context_tokens >= RECENT_PROTECTED_TOKENS {
            RECENT_PROTECTED_TOKENS.min(target_tokens.saturating_sub(CONTEXT_GUARD_TOKENS))
        } else {
            (usable_context_tokens as f64 * 0.45) as usize
        }
        .max(1);

        Self {
            usable_context_tokens,
            trim_trigger_tokens,
            target_tokens,
            protected_recent_tokens,
            complexity_score,
            complexity_band,
            has_explicit_context_window: options.context_window.is_some(),
        }
    }
}

fn complexity_score(messages: &[Value], options: &ProviderContextOptions) -> usize {
    let mut total_user_chars = 0;
    let mut total_assistant_chars = 0;
    let mut latest_user_chars = 0;
    let mut latest_assistant_chars = 0;

    for message in messages {
        let chars = message_text_chars(message);
        match message.get("role").and_then(Value::as_str) {
            Some("user") => {
                total_user_chars += chars;
                latest_user_chars = chars;
            }
            Some("assistant") => {
                total_assistant_chars += chars;
                latest_assistant_chars = chars;
            }
            _ => {}
        }
    }

    options.session_tool_count.saturating_mul(8)
        + options.last_turn_tool_count.saturating_mul(18)
        + total_user_chars / 900
        + total_assistant_chars / 1_200
        + latest_user_chars / 350
        + latest_assistant_chars / 700
}

fn message_text_chars(message: &Value) -> usize {
    match message.get("content") {
        Some(Value::String(text)) => text.chars().count(),
        Some(Value::Array(parts)) => parts
            .iter()
            .filter_map(|part| part.get("text").and_then(Value::as_str))
            .map(|text| text.chars().count())
            .sum(),
        _ => message
            .get("text")
            .and_then(Value::as_str)
            .map(|text| text.chars().count())
            .unwrap_or(0),
    }
}

fn compact_to_retention_policy(output: &mut ProviderContext, policy: RetentionPolicy) {
    let Some(system) = output.messages.first().cloned() else {
        return;
    };
    let system_tokens = estimate_tokens(&serde_json::to_string(&system).unwrap_or_default());
    let messages = output.messages.iter().skip(1).cloned().collect::<Vec<_>>();
    let message_tokens = messages
        .iter()
        .map(|message| estimate_tokens(&serde_json::to_string(message).unwrap_or_default()))
        .collect::<Vec<_>>();
    let mut keep = vec![false; messages.len()];
    let mut protected_tokens = 0_usize;
    for index in (0..messages.len()).rev() {
        if protected_tokens >= policy.protected_recent_tokens
            && latest_user_is_already_kept(&messages, &keep)
        {
            break;
        }
        let estimate = message_tokens[index];
        if protected_tokens > 0
            && protected_tokens.saturating_add(estimate) > policy.protected_recent_tokens
            && latest_user_is_already_kept(&messages, &keep)
        {
            break;
        }
        keep[index] = true;
        protected_tokens = protected_tokens.saturating_add(estimate);
    }

    let mut token_total = system_tokens.saturating_add(protected_tokens);
    let target_without_notice = policy.target_tokens.saturating_sub(CONTEXT_GUARD_TOKENS);
    let include_older_tools = matches!(policy.complexity_band, ComplexityBand::Complex);
    for index in (0..messages.len()).rev() {
        if keep[index] {
            continue;
        }
        let role = messages[index]
            .get("role")
            .and_then(Value::as_str)
            .unwrap_or("");
        if role == "tool" && !include_older_tools {
            continue;
        }
        let estimate = message_tokens[index];
        if token_total.saturating_add(estimate) > target_without_notice {
            continue;
        }
        keep[index] = true;
        token_total = token_total.saturating_add(estimate);
    }

    let kept = messages
        .into_iter()
        .zip(keep)
        .filter_map(|(message, keep)| keep.then_some(message))
        .collect::<Vec<_>>();
    let dropped = output.messages.len().saturating_sub(1 + kept.len());
    if dropped > 0 {
        output.trimmed = true;
        output.messages = vec![
            system,
            json!({
                "role": "system",
                "content": format!(
                    "Earlier conversation context was compacted by Lyra before this provider request. Dropped message count: {dropped}. Retention policy: usable_context_tokens={}, trim_trigger_tokens={}, target_tokens={}, protected_recent_tokens={}, complexity_score={}, complexity_band={:?}. Latest user intent, protected recent context, tool evidence refs, and pinned memory remain preferred over older summaries.",
                    policy.usable_context_tokens,
                    policy.trim_trigger_tokens,
                    policy.target_tokens,
                    policy.protected_recent_tokens,
                    policy.complexity_score,
                    policy.complexity_band
                ),
            }),
        ];
        output.messages.extend(kept);
        output.token_estimate = estimate_messages_tokens(&output.messages);
    }

    if policy.has_explicit_context_window && output.token_estimate > policy.usable_context_tokens {
        output.overflow = Some(json!({
            "kind": "context_overflow",
            "contextWindow": policy.usable_context_tokens,
            "estimatedTokens": output.token_estimate,
            "recoverable": true,
        }));
    }
}

fn latest_user_is_already_kept(messages: &[Value], keep: &[bool]) -> bool {
    messages
        .iter()
        .zip(keep.iter())
        .rev()
        .find(|(message, _)| is_latest_user_message(message))
        .map(|(_, keep)| *keep)
        .unwrap_or(true)
}

fn is_latest_user_message(message: &Value) -> bool {
    message.get("role").and_then(Value::as_str) == Some("user")
}

fn prompt_accounting_json(accounting: &PromptAccounting) -> Value {
    json!({
        "systemBudget": accounting.system_budget,
        "toolsBudget": accounting.tools_budget,
        "memoryBudget": accounting.memory_budget,
        "historyBudget": accounting.history_budget,
        "artifactBudget": accounting.artifact_budget,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use lyra_agent_plugins::LyraSkillManifest;

    #[test]
    fn active_skill_prompt_enters_layered_context() {
        let registry = SkillRegistry::default();
        registry.register(LyraSkillManifest {
            id: "review-skill".to_string(),
            name: "Review Skill".to_string(),
            version: "0.1.0".to_string(),
            description: "Review".to_string(),
            prompt: "Use the review checklist.".to_string(),
            permissions: vec!["files.read".to_string()],
            tool_capabilities: Vec::new(),
        });
        registry.activate("review-skill").expect("activate skill");
        let context = ContextBuilder::with_skill_registry(registry).build_layered_prompt_context(
            json!({ "tools": [] }),
            String::new(),
            12,
            3,
        );
        assert!(
            context["activeSkillPrompt"]
                .as_str()
                .unwrap()
                .contains("review-skill")
        );
        assert_eq!(context["promptAccounting"]["historyBudget"], 12);
    }

    #[test]
    fn provider_context_includes_image_blocks_when_supported() {
        let context = ContextBuilder::default().build_provider_context(
            "system".to_string(),
            vec![json!({
                "id": "message-1",
                "role": "user",
                "text": "look",
                "blocks": [
                    { "type": "text", "id": "text-0", "text": "look" },
                    { "type": "image", "id": "image-0", "mediaType": "image/png", "data": "AAAA" }
                ],
            })],
            ProviderContextOptions {
                supports_image_input: true,
                ..ProviderContextOptions::default()
            },
        );

        assert!(context.input_downgrades.is_empty());
        assert_eq!(
            context.messages[1]
                .pointer("/content/1/image_url/url")
                .and_then(Value::as_str),
            Some("data:image/png;base64,AAAA")
        );
    }

    #[test]
    fn provider_context_gates_image_blocks_when_unsupported() {
        let context = ContextBuilder::default().build_provider_context(
            "system".to_string(),
            vec![json!({
                "id": "message-1",
                "role": "user",
                "text": "look",
                "blocks": [
                    { "type": "text", "id": "text-0", "text": "look" },
                    { "type": "image", "id": "image-0", "mediaType": "image/png", "data": "AAAA" }
                ],
            })],
            ProviderContextOptions::default(),
        );

        assert_eq!(context.input_downgrades.len(), 1);
        assert!(
            serde_json::to_string(&context.messages)
                .unwrap()
                .contains("Image omitted")
        );
        assert!(
            !serde_json::to_string(&context.messages)
                .unwrap()
                .contains("image_url")
        );
    }

    #[test]
    fn provider_context_trims_large_tool_output_and_reports_evidence_ref() {
        let context = ContextBuilder::default().build_provider_context(
            "system".to_string(),
            vec![json!({
                "id": "message-tool",
                "role": "tool",
                "toolCallId": "tool-1",
                "text": "abcdef",
            })],
            ProviderContextOptions {
                max_tool_output_chars: 3,
                ..ProviderContextOptions::default()
            },
        );

        assert_eq!(context.evidence_refs.len(), 1);
        assert!(
            context.messages[1]["content"]
                .as_str()
                .unwrap()
                .starts_with("abc")
        );
    }

    #[test]
    fn provider_context_compacts_when_budget_is_exceeded() {
        let context = ContextBuilder::default().build_provider_context(
            "system".to_string(),
            vec![
                json!({ "id": "old", "role": "user", "text": "x".repeat(2_000) }),
                json!({ "id": "latest", "role": "user", "text": "latest intent" }),
            ],
            ProviderContextOptions {
                context_window: Some(96),
                ..ProviderContextOptions::default()
            },
        );

        assert!(context.trimmed);
        assert!(
            serde_json::to_string(&context.messages)
                .unwrap()
                .contains("latest intent")
        );
    }

    #[test]
    fn retention_policy_uses_100k_default_trigger() {
        let policy = RetentionPolicy::from_context(&[], &ProviderContextOptions::default());
        assert_eq!(
            policy.trim_trigger_tokens,
            RETENTION_TRIM_TRIGGER_CAP_TOKENS
        );

        let small_policy = RetentionPolicy::from_context(
            &[],
            &ProviderContextOptions {
                context_window: Some(4_000),
                ..ProviderContextOptions::default()
            },
        );
        assert_eq!(small_policy.trim_trigger_tokens, 3_280);
    }

    #[test]
    fn provider_context_trims_by_formula_without_fixed_message_count() {
        let mut messages = (0..80)
            .map(|index| {
                json!({
                    "id": format!("old-{index}"),
                    "role": if index % 2 == 0 { "assistant" } else { "user" },
                    "text": "x".repeat(8_000),
                })
            })
            .collect::<Vec<_>>();
        messages.push(json!({
            "id": "latest",
            "role": "user",
            "text": "latest protected intent",
        }));

        let context = ContextBuilder::default().build_provider_context(
            "system".to_string(),
            messages,
            ProviderContextOptions {
                context_window: None,
                session_tool_count: 4,
                last_turn_tool_count: 2,
                ..ProviderContextOptions::default()
            },
        );

        assert!(context.trimmed);
        assert!(
            serde_json::to_string(&context.messages)
                .unwrap()
                .contains("latest protected intent")
        );
        assert!(context.token_estimate <= TARGET_MIN_RETAINED_TOKENS + RECENT_PROTECTED_TOKENS);
    }
}
