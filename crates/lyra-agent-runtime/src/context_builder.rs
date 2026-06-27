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
use crate::native_backend::token_estimate::{
    estimate_message_tokens, estimate_messages_tokens, estimate_tokens,
};
use crate::native_backend::tool_protocol::{
    TOOL_OUTPUT_CLEARED_SUMMARY, TOOL_OUTPUT_OMITTED_SUMMARY, message_has_provider_transcript,
    tool_activity_output_summary,
};
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
    pub openai_responses_replay: bool,
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
        output
    }
}

fn provider_messages_from_agent_message(
    message: &Value,
    message_index: usize,
    all_messages: &[Value],
    options: &ProviderContextOptions,
    output: &mut ProviderContext,
) -> Vec<Value> {
    let Some(role) = message.get("role").and_then(Value::as_str) else {
        return Vec::new();
    };
    if options.openai_responses_replay
        && role == "assistant"
        && let Some(items) = message
            .pointer("/metadata/openaiResponsesReplay")
            .and_then(Value::as_array)
            .filter(|items| !items.is_empty())
    {
        return items.clone();
    }
    let text = message
        .get("text")
        .and_then(Value::as_str)
        .unwrap_or_default();

    // Compressed-context-block: role=system message produced by memory_compress.
    // Wrap its JSON payload with a framing prefix so the provider treats it as a
    // summary of prior conversation, not a generic system instruction.
    if role == "system"
        && message
            .pointer("/metadata/kind")
            .and_then(Value::as_str)
            == Some("compressed-context-block")
    {
        if text.trim().is_empty() {
            return Vec::new();
        }
        return vec![json!({
            "role": "system",
            "content": format!(
                "The following is a compressed context summary of earlier conversation in this session, generated by Lyra. Treat it as authoritative context about prior exchanges; prefer newer messages for current intent.\n\n{text}"
            ),
        })];
    }

    if role == "tool" {
        let (content, evidence_ref) = trim_tool_output(
            text,
            effective_tool_output_budget(options, message.get("id")),
            message.get("id"),
        );
        if let Some(evidence_ref) = evidence_ref {
            output.evidence_refs.push(evidence_ref);
        }
        return if content.trim().is_empty() {
            Vec::new()
        } else {
            vec![json!({
                "role": "tool",
                "tool_call_id": message.get("toolCallId").or_else(|| message.get("tool_call_id")).cloned().unwrap_or_else(|| Value::String("tool-result".to_string())),
                "content": content,
            })]
        };
    }

    // Any assistant message with tool blocks but no providerTranscript is an
    // intermediate tool-call message from a multi-round turn. The complete
    // provider-side view (tool_calls + role:"tool" pairs) is carried by the
    // final assistant message's providerTranscript. Without that transcript,
    // tool blocks can only be emitted as plain text — which strips tool
    // identity and duplicates/confuses the provider. Skip unconditionally.
    // This also covers the interrupted-turn case: if no final message ever
    // received a transcript, the tool calls are incomplete and must not leak
    // as text into the next turn's provider context.
    if role == "assistant"
        && !message_has_provider_transcript(message)
        && message
            .get("blocks")
            .and_then(Value::as_array)
            .is_some_and(|blocks| {
                blocks
                    .iter()
                    .any(|b| b.get("type").and_then(Value::as_str) == Some("tool"))
            })
    {
        return Vec::new();
    }

    let mut transcript = provider_transcript_from_agent_message(message);
    let blocks = message
        .get("blocks")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let content = if blocks.is_empty() {
        text_content_or_none(text)
    } else {
        content_from_blocks(message, &blocks, text, options, output)
    };

    if let Some(content) = content {
        let merged = merge_user_content_with_transcript_citations(message, role, content);
        let merged = merge_user_content_with_page_citations(message, role, merged);
        let merged = merge_user_content_with_file_citations(message, role, merged);
        let inline_images = message
            .pointer("/metadata/inlineImages")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let (effective_inline_images, inherited_session_inline_images) =
            effective_inline_images_for_user_turn(
                role,
                &inline_images,
                text,
                all_messages,
                message_index,
            );
        let provider_inline_images = enrich_inline_images_for_provider(&effective_inline_images);
        let merged = merge_user_content_with_inline_images(role, merged, &provider_inline_images);
        let merged = if role == "user" && !provider_inline_images.is_empty() {
            if text_has_inline_image_markers(text) {
                expand_inline_image_markers_in_content(
                    merged,
                    &provider_inline_images,
                    options,
                    output,
                )
            } else if inherited_session_inline_images {
                prepend_inline_images_vision_to_content(
                    merged,
                    &provider_inline_images,
                    options,
                    output,
                )
            } else {
                merged
            }
        } else {
            merged
        };
        transcript.push(json!({
            "role": role,
            "content": merged,
        }));
    }

    transcript
}

fn merge_user_content_with_transcript_citations(
    message: &Value,
    role: &str,
    content: Value,
) -> Value {
    if role != "user" {
        return content;
    }
    let citations = message
        .pointer("/metadata/transcriptCitations")
        .and_then(Value::as_array)
        .filter(|items| !items.is_empty());
    let Some(citations) = citations else {
        return content;
    };
    let cite_blocks = citations
        .iter()
        .filter_map(format_transcript_cite_xml)
        .collect::<Vec<_>>()
        .join("\n");
    if cite_blocks.is_empty() {
        return content;
    }
    let user_text = match &content {
        Value::String(text) => text.clone(),
        Value::Array(parts) => parts
            .iter()
            .filter_map(|part| part.get("text").and_then(Value::as_str))
            .collect::<Vec<_>>()
            .join("\n"),
        _ => String::new(),
    };
    let merged = if user_text.trim().is_empty() {
        format!(
            "The user referenced prior transcript excerpts. Treat every <lyra-transcript-cite> block as a canonical anchor to a message that definitely occurred in this session, even if it is outside the current working context.\n\n{cite_blocks}"
        )
    } else {
        format!(
            "The user referenced prior transcript excerpts. Treat every <lyra-transcript-cite> block as a canonical anchor to a message that definitely occurred in this session, even if it is outside the current working context. When truncated=\"true\", call lyra_session_read_message with messageId (and offsets when present) before relying on the excerpt alone.\n\n{cite_blocks}\n\nUser message:\n{user_text}"
        )
    };
    Value::String(merged)
}

fn merged_content_text(content: &Value) -> String {
    match content {
        Value::String(text) => text.clone(),
        Value::Array(parts) => parts
            .iter()
            .filter_map(|part| part.get("text").and_then(Value::as_str))
            .collect::<Vec<_>>()
            .join("\n"),
        _ => String::new(),
    }
}

fn merge_user_content_with_inline_images(role: &str, content: Value, images: &[Value]) -> Value {
    if role != "user" || images.is_empty() {
        return content;
    }
    let image_blocks = images
        .iter()
        .filter_map(crate::native_backend::inline_images::format_inline_image_xml)
        .collect::<Vec<_>>()
        .join("\n");
    if image_blocks.is_empty() {
        return content;
    }
    let user_text = match &content {
        Value::String(text) => text.clone(),
        Value::Array(parts) => parts
            .iter()
            .filter_map(|part| part.get("text").and_then(Value::as_str))
            .collect::<Vec<_>>()
            .join("\n"),
        _ => String::new(),
    };
    let transcript_marker = "The user referenced prior transcript excerpts.";
    let page_marker = "The user referenced Workbench browser pages.";
    let image_anchor_hint = "Treat every <lyra-image-attach> block as a canonical inline image anchor for the member's inline image attachment. Attachment ids are session-local and are not artifact ids—never pass them to artifact_read. Use the source path on <lyra-image-attach> or image-viewer tools on that file path. Describe image content from vision input; describe transparency/alpha/format from lyra-image-attach traits (hasAlpha, transparentBackground, transparentPixelPercent, colorMode, visionComposited). When visionComposited=true, vision shows a white-backed composite for visibility—the original file at source may still be transparent.";
    let merged = if user_text.trim().is_empty() {
        format!("{image_anchor_hint}\n\n{image_blocks}")
    } else if user_text.contains(transcript_marker) || user_text.contains(page_marker) {
        format!("{user_text}\n\n{image_blocks}")
    } else {
        format!("{image_anchor_hint}\n\n{image_blocks}\n\nUser message:\n{user_text}")
    };
    Value::String(merged)
}

fn merge_user_content_with_page_citations(message: &Value, role: &str, content: Value) -> Value {
    if role != "user" {
        return content;
    }
    let citations = message
        .pointer("/metadata/pageCitations")
        .and_then(Value::as_array)
        .filter(|items| !items.is_empty());
    let Some(citations) = citations else {
        return content;
    };
    let cite_blocks = citations
        .iter()
        .filter_map(crate::native_backend::page_citations::format_page_cite_xml)
        .collect::<Vec<_>>()
        .join("\n");
    if cite_blocks.is_empty() {
        return content;
    }
    let user_text = match &content {
        Value::String(text) => text.clone(),
        Value::Array(parts) => parts
            .iter()
            .filter_map(|part| part.get("text").and_then(Value::as_str))
            .collect::<Vec<_>>()
            .join("\n"),
        _ => String::new(),
    };
    let transcript_marker = "The user referenced prior transcript excerpts.";
    let merged = if user_text.trim().is_empty() {
        format!(
            "The user referenced Workbench browser pages. Treat every <lyra-page-cite> block as a canonical anchor to a tab/page the user was viewing.\n\n{cite_blocks}"
        )
    } else if user_text.contains(transcript_marker) {
        format!("{user_text}\n\n{cite_blocks}")
    } else {
        format!(
            "The user referenced Workbench browser pages. Treat every <lyra-page-cite> block as a canonical anchor to a tab/page the user was viewing.\n\n{cite_blocks}\n\nUser message:\n{user_text}"
        )
    };
    Value::String(merged)
}

fn merge_user_content_with_file_citations(message: &Value, role: &str, content: Value) -> Value {
    if role != "user" {
        return content;
    }
    let citations = message
        .pointer("/metadata/fileAttachments")
        .and_then(Value::as_array)
        .filter(|items| !items.is_empty());
    let Some(citations) = citations else {
        return content;
    };
    let cite_blocks = citations
        .iter()
        .filter_map(crate::native_backend::file_citations::format_file_cite_xml)
        .collect::<Vec<_>>()
        .join("\n");
    if cite_blocks.is_empty() {
        return content;
    }
    let user_text = match &content {
        Value::String(text) => text.clone(),
        Value::Array(parts) => parts
            .iter()
            .filter_map(|part| part.get("text").and_then(Value::as_str))
            .collect::<Vec<_>>()
            .join("\n"),
        _ => String::new(),
    };
    let merged = if user_text.trim().is_empty() {
        format!(
            "The user attached local files from the Lyra file manager. Treat every <lyra-file-cite> block as a canonical anchor to a file path the user referenced.\n\n{cite_blocks}"
        )
    } else {
        format!(
            "The user attached local files from the Lyra file manager. Treat every <lyra-file-cite> block as a canonical anchor to a file path the user referenced.\n\n{cite_blocks}\n\nUser message:\n{user_text}"
        )
    };
    Value::String(merged)
}

fn format_transcript_cite_xml(citation: &Value) -> Option<String> {
    let id = citation.get("id").and_then(Value::as_str)?;
    let message_id = citation.get("messageId").and_then(Value::as_str)?;
    let role = citation
        .get("role")
        .and_then(Value::as_str)
        .unwrap_or("assistant");
    let truncated = citation
        .get("truncated")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let block_id = citation
        .get("blockId")
        .and_then(Value::as_str)
        .map(|value| format!(" blockId=\"{value}\""))
        .unwrap_or_default();
    let start = citation
        .get("startOffset")
        .and_then(Value::as_u64)
        .map(|value| format!(" start=\"{value}\""))
        .unwrap_or_default();
    let end = citation
        .get("endOffset")
        .and_then(Value::as_u64)
        .map(|value| format!(" end=\"{value}\""))
        .unwrap_or_default();
    let quoted = citation
        .get("quotedText")
        .and_then(Value::as_str)
        .unwrap_or_default();
    Some(format!(
        "<lyra-transcript-cite id=\"{id}\" messageId=\"{message_id}\" role=\"{role}\" authentic=\"true\" truncated=\"{truncated}\"{block_id}{start}{end}>\n{quoted}\n</lyra-transcript-cite>"
    ))
}

fn provider_transcript_from_agent_message(message: &Value) -> Vec<Value> {
    message
        .pointer("/metadata/providerTranscript")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(sanitize_provider_transcript_message)
        .collect()
}



fn sanitize_provider_transcript_message(message: &Value) -> Option<Value> {
    let role = message.get("role").and_then(Value::as_str)?;
    match role {
        "assistant" => {
            let mut output = json!({
                "role": "assistant",
                "content": message.get("content").cloned().unwrap_or(Value::String(String::new())),
            });
            if let Some(tool_calls) = message.get("tool_calls").filter(|value| value.is_array()) {
                output["tool_calls"] = tool_calls.clone();
            }
            if let Some(reasoning_content) = message
                .get("reasoning_content")
                .and_then(Value::as_str)
                .filter(|value| !value.trim().is_empty())
            {
                output["reasoning_content"] = Value::String(reasoning_content.to_string());
            }
            Some(output)
        }
        "tool" => {
            let tool_call_id = message
                .get("tool_call_id")
                .or_else(|| message.get("toolCallId"))
                .cloned()
                .unwrap_or_else(|| Value::String("tool-result".to_string()));
            Some(json!({
                "role": "tool",
                "tool_call_id": tool_call_id,
                "content": message.get("content").cloned().unwrap_or(Value::String(String::new())),
            }))
        }
        "user" | "system" => message.get("content").map(|content| {
            json!({
                "role": role,
                "content": content,
            })
        }),
        _ => None,
    }
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
                if message_has_provider_transcript(message) {
                    continue;
                }
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
                let summary = options
                    .tool_outputs_by_id
                    .get(tool_id)
                    .cloned()
                    .filter(|text| !text.trim().is_empty())
                    .unwrap_or_else(|| TOOL_OUTPUT_OMITTED_SUMMARY.to_string());
                let tool_budget = effective_tool_output_budget(options, message.get("id"));
                let (summary, maybe_ref) = if tool_budget == 0 {
                    (TOOL_OUTPUT_CLEARED_SUMMARY.to_string(), None)
                } else if summary.chars().count() > tool_budget {
                    let trimmed =
                        tool_activity_output_summary(&json!({ "content": summary }), tool_budget);
                    let evidence_ref = json!({
                        "kind": "truncated_tool_output",
                        "toolId": tool_id,
                        "messageId": message.get("id").cloned().unwrap_or(Value::Null),
                        "originalChars": summary.chars().count(),
                        "keptChars": tool_budget,
                    });
                    (trimmed, Some(evidence_ref))
                } else {
                    (summary, None)
                };
                if let Some(evidence_ref) = maybe_ref {
                    output.evidence_refs.push(evidence_ref);
                }
                parts.push(json!({
                    "type": "text",
                    "text": summary,
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
    provider_image_url_from_value(block)
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

fn should_compact_provider_context(
    output: &ProviderContext,
    retention: &RetentionPolicy,
    session_message_count: usize,
) -> bool {
    if output.token_estimate >= retention.trim_trigger_tokens {
        return true;
    }
    matches!(retention.complexity_band, ComplexityBand::Complex)
        && session_message_count >= 32
        && output.token_estimate * 2 > retention.protected_recent_tokens
}

fn apply_budget_fallback_keep(messages: &[Value], keep: &mut [bool], policy: &RetentionPolicy) {
    if keep.iter().any(|kept| !*kept) {
        return;
    }
    let token_counts: Vec<usize> = messages.iter().map(estimate_message_tokens).collect();
    let tail_start = crate::retention_policy::tail_keep_start(
        messages,
        &token_counts,
        policy.protected_recent_tokens,
    );
    let mut total = keep
        .iter()
        .enumerate()
        .filter_map(|(index, kept)| kept.then_some(token_counts[index]))
        .sum::<usize>();
    let budget_target = policy
        .trim_trigger_tokens
        .min(policy.target_tokens)
        .saturating_sub(CONTEXT_GUARD_TOKENS);
    for ordinal in 0..messages.len() {
        if ordinal >= tail_start || !keep[ordinal] {
            continue;
        }
        if total <= budget_target {
            break;
        }
        keep[ordinal] = false;
        total = total.saturating_sub(token_counts[ordinal]);
    }
    if keep.iter().all(|kept| *kept) && matches!(policy.complexity_band, ComplexityBand::Complex) {
        for ordinal in 0..tail_start {
            if ordinal % 2 == 0 && keep[ordinal] {
                keep[ordinal] = false;
            }
        }
    }
}

fn effective_tool_output_budget(
    options: &ProviderContextOptions,
    message_id: Option<&Value>,
) -> usize {
    let base = options.max_tool_output_chars;
    if base == 0 {
        return 0;
    }
    let halve = message_id
        .and_then(Value::as_str)
        .is_some_and(|id| options.halve_tool_output_message_ids.contains(id));
    if halve { (base / 2).max(1) } else { base }
}

fn compact_to_retention_policy(
    output: &mut ProviderContext,
    policy: RetentionPolicy,
    aggressiveness: TrimAggressiveness,
) {
    let Some(system) = output.messages.first().cloned() else {
        return;
    };
    let messages = output.messages.iter().skip(1).cloned().collect::<Vec<_>>();
    let mut keep = select_interleaved_provider_keep(&messages, &policy, aggressiveness);
    normalize_tool_round_retention(&messages, &mut keep);
    apply_budget_fallback_keep(&messages, &mut keep, &policy);

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

fn assistant_message_has_tool_calls(message: &Value) -> bool {
    message.get("role").and_then(Value::as_str) == Some("assistant")
        && message
            .get("tool_calls")
            .and_then(Value::as_array)
            .is_some_and(|tool_calls| !tool_calls.is_empty())
}

fn assistant_message_has_reasoning(message: &Value) -> bool {
    message
        .get("reasoning_content")
        .and_then(Value::as_str)
        .is_some_and(|value| !value.trim().is_empty())
}

fn normalize_tool_round_retention(messages: &[Value], keep: &mut [bool]) {
    let mut index = 0;
    while index < messages.len() {
        if !assistant_message_has_tool_calls(&messages[index]) {
            index += 1;
            continue;
        }
        let round_start = index;
        let mut round_end = index + 1;
        while round_end < messages.len()
            && messages[round_end].get("role").and_then(Value::as_str) == Some("tool")
        {
            round_end += 1;
        }
        let round_kept = (round_start..round_end).any(|slot| keep[slot]);
        if round_kept && !assistant_message_has_reasoning(&messages[round_start]) {
            for slot in round_start..round_end {
                keep[slot] = false;
            }
        } else if !keep[round_start] {
            for slot in round_start + 1..round_end {
                keep[slot] = false;
            }
        }
        index = round_end;
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
    fn provider_context_replays_provider_transcript_with_reasoning_content() {
        let context = ContextBuilder::default().build_provider_context(
            "system".to_string(),
            vec![json!({
                "id": "message-assistant",
                "role": "assistant",
                "text": "Done.",
                "metadata": {
                    "providerTranscript": [
                        {
                            "role": "assistant",
                            "content": "",
                            "reasoning_content": "I need to inspect the workspace.",
                            "tool_calls": [{
                                "id": "call-1",
                                "type": "function",
                                "function": {
                                    "name": "tool_fs_run",
                                    "arguments": "{\"path\":\"/tools/workbench/list_tabs\",\"args\":{}}"
                                }
                            }]
                        },
                        {
                            "role": "tool",
                            "tool_call_id": "call-1",
                            "content": "tabs: settings"
                        }
                    ]
                }
            })],
            ProviderContextOptions::default(),
        );

        assert_eq!(
            context.messages[1]["reasoning_content"],
            "I need to inspect the workspace."
        );
        assert_eq!(context.messages[2]["tool_call_id"], "call-1");
        assert_eq!(context.messages[3]["content"], "Done.");
    }

    #[test]
    fn provider_context_skips_tool_blocks_without_transcript() {
        // An assistant message with tool blocks but no providerTranscript must
        // be skipped entirely — tool output must never leak as plain text.
        let mut tool_outputs = HashMap::new();
        tool_outputs.insert(
            "call-1".to_string(),
            "OWASP ZAP is a popular black-box scanner.".to_string(),
        );
        let context = ContextBuilder::default().build_provider_context(
            "system".to_string(),
            vec![json!({
                "id": "message-assistant",
                "role": "assistant",
                "text": "Here are the findings.",
                "blocks": [
                    { "type": "text", "id": "text-0", "text": "Here are the findings." },
                    { "type": "tool", "id": "tool-call-1", "toolId": "call-1" }
                ]
            })],
            ProviderContextOptions {
                tool_outputs_by_id: tool_outputs,
                ..ProviderContextOptions::default()
            },
        );

        let serialized = serde_json::to_string(&context.messages).unwrap();
        assert!(
            !serialized.contains("OWASP ZAP"),
            "tool output must not leak as plain text without providerTranscript"
        );
        assert!(
            !serialized.contains("Here are the findings"),
            "intermediate tool-call assistant text must be skipped without transcript"
        );
    }

    #[test]
    fn provider_context_uses_openai_responses_replay_without_duplicate_visible_text() {
        let context = ContextBuilder::default().build_provider_context(
            "system".to_string(),
            vec![json!({
                "id": "message-assistant",
                "role": "assistant",
                "text": "Done.",
                "metadata": {
                    "openaiResponsesReplay": [{
                        "type": "message",
                        "role": "assistant",
                        "content": [{ "type": "output_text", "text": "Done." }]
                    }]
                }
            })],
            ProviderContextOptions {
                openai_responses_replay: true,
                ..ProviderContextOptions::default()
            },
        );

        assert_eq!(context.messages[1]["type"], "message");
        assert_eq!(
            context
                .messages
                .iter()
                .filter(|message| message.get("role").and_then(Value::as_str) == Some("assistant"))
                .count(),
            1
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
    fn retention_policy_uses_complexity_aware_trigger() {
        let policy = retention_policy_from_messages(
            &[],
            &RetentionSignals {
                context_window: None,
                session_tool_count: 0,
                last_turn_tool_count: 0,
            },
        );
        assert_eq!(policy.trim_trigger_tokens, 82_000);

        let heavy_policy = retention_policy_from_messages(
            &[],
            &RetentionSignals {
                context_window: Some(200_000),
                session_tool_count: 49,
                last_turn_tool_count: 12,
            },
        );
        assert_eq!(heavy_policy.trim_trigger_tokens, 90_000);

        let small_policy = retention_policy_from_messages(
            &[],
            &RetentionSignals {
                context_window: Some(4_000),
                session_tool_count: 0,
                last_turn_tool_count: 0,
            },
        );
        assert_eq!(small_policy.trim_trigger_tokens, 3_280);
    }

    #[test]
    fn provider_context_drops_incomplete_tool_rounds_missing_reasoning() {
        let mut messages = vec![json!({
            "role": "system",
            "content": "system",
        })];
        messages.extend((0..40).map(|index| {
            json!({
                "role": "user",
                "content": format!("filler message {index} {}", "x".repeat(500)),
            })
        }));
        messages.push(json!({
            "role": "assistant",
            "content": "",
            "tool_calls": [{
                "id": "call-tabs",
                "type": "function",
                "function": {
                    "name": "tool_fs_run",
                    "arguments": "{\"path\":\"/tools/workbench/list_tabs\",\"args\":{}}"
                }
            }]
        }));
        messages.push(json!({
            "role": "tool",
            "tool_call_id": "call-tabs",
            "content": "tabs: settings",
        }));
        messages.push(json!({
            "role": "user",
            "content": "latest intent",
        }));

        let mut output = ProviderContext {
            messages,
            ..ProviderContext::default()
        };
        let retention = retention_policy_from_messages(
            &output.messages,
            &RetentionSignals {
                context_window: Some(96),
                session_tool_count: 0,
                last_turn_tool_count: 0,
            },
        );
        compact_to_retention_policy(&mut output, retention, TrimAggressiveness::Normal);

        let payload = serde_json::to_string(&output.messages).unwrap();
        assert!(!payload.contains("call-tabs"));
        assert!(payload.contains("latest intent"));
    }

    #[test]
    fn provider_context_reinjects_vision_on_structural_inline_image_follow_up() {
        let context = ContextBuilder::default().build_provider_context(
            "system".to_string(),
            vec![
                json!({
                    "id": "message-image",
                    "role": "user",
                    "text": "请看 ⟦image:img-1⟧",
                    "metadata": {
                        "inlineImages": [{
                            "id": "img-1",
                            "mediaType": "image/png",
                            "data": "AAAA",
                            "source": "/tmp/example.png"
                        }]
                    }
                }),
                json!({
                    "id": "message-assistant",
                    "role": "assistant",
                    "text": "I see an image."
                }),
                json!({
                    "id": "message-follow-up",
                    "role": "user",
                    "text": "这张图片是什么"
                }),
            ],
            ProviderContextOptions {
                supports_image_input: true,
                ..ProviderContextOptions::default()
            },
        );

        let follow_up = context
            .messages
            .iter()
            .rev()
            .find(|message| {
                message.get("role").and_then(Value::as_str) == Some("user")
                    && message
                        .pointer("/content")
                        .and_then(|content| content.as_array())
                        .is_some_and(|parts| {
                            parts.iter().any(|part| part.get("image_url").is_some())
                        })
            })
            .expect("follow-up user message with vision");
        let parts = follow_up["content"].as_array().expect("content parts");
        assert!(parts.iter().any(|part| part.get("image_url").is_some()));
        assert!(
            serde_json::to_string(follow_up)
                .unwrap()
                .contains("re-attached here")
        );
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
        assert!(
            context.token_estimate
                <= crate::retention_policy::TARGET_MIN_RETAINED_TOKENS
                    + crate::retention_policy::RECENT_PROTECTED_TOKENS
        );
    }

    #[test]
    fn provider_context_annotates_compressed_context_block() {
        let context = ContextBuilder::default().build_provider_context(
            "system".to_string(),
            vec![
                json!({
                    "id": "compress-1",
                    "role": "system",
                    "text": "{\"summary\":\"prior talk\",\"keyDecisions\":[],\"projectState\":\"x\",\"compressedMessageIds\":[\"m1\"],\"tokenEstimate\":800}",
                    "createdAt": "2026-01-01T00:00:00Z",
                    "metadata": {
                        "kind": "compressed-context-block",
                        "compressionBlockId": "compress-1",
                        "compressedMessageIds": ["m1"],
                    },
                }),
                json!({ "id": "m2", "role": "user", "text": "latest intent" }),
            ],
            ProviderContextOptions::default(),
        );

        // Index 0 is the real system prompt; index 1 is the compression block.
        let block = &context.messages[1];
        assert_eq!(block["role"], "system");
        let content = block["content"].as_str().expect("string content");
        assert!(content.contains("compressed context summary"));
        assert!(content.contains("prior talk"));
        // The later user message is still present and unchanged.
        assert_eq!(context.messages[2]["content"], "latest intent");
    }

    #[test]
    fn intermediate_tool_call_message_skipped_even_without_later_transcript() {
        // Simulates an interrupted turn: the assistant made tool calls but no
        // final message with providerTranscript was ever committed. The
        // intermediate message must still be skipped — tool blocks must never
        // leak as plain text into the provider context.
        let messages = vec![
            json!({
                "id": "msg-intermediate",
                "role": "assistant",
                "text": "Let me search for that.",
                "blocks": [
                    { "type": "text", "id": "text-0", "text": "Let me search for that." },
                    { "type": "tool", "id": "tool-0", "toolId": "call-1" }
                ]
            }),
        ];

        let mut tool_outputs = HashMap::new();
        tool_outputs.insert(
            "call-1".to_string(),
            "Search results found.".to_string(),
        );

        let context = ContextBuilder::default().build_provider_context(
            "system".to_string(),
            messages,
            ProviderContextOptions {
                tool_outputs_by_id: tool_outputs,
                ..ProviderContextOptions::default()
            },
        );

        // No assistant content should be emitted — the only message had tool
        // blocks and no transcript, so it is skipped entirely.
        let has_assistant = context
            .messages
            .iter()
            .any(|m| m.get("role").and_then(Value::as_str) == Some("assistant"));
        assert!(
            !has_assistant,
            "intermediate tool-call message without transcript must be skipped entirely"
        );
        // Tool output must NOT appear as plain text.
        let serialized = serde_json::to_string(&context.messages).unwrap();
        assert!(
            !serialized.contains("Search results found"),
            "tool output must not leak as plain text when no transcript exists"
        );
    }

    #[test]
    fn intermediate_tool_call_message_skipped_when_transcript_on_later_message() {
        let messages = vec![
            json!({
                "id": "msg-intermediate",
                "role": "assistant",
                "text": "Let me search for that.",
                "blocks": [
                    { "type": "text", "id": "text-0", "text": "Let me search for that." },
                    { "type": "tool", "id": "tool-0", "toolId": "call-1" }
                ]
            }),
            json!({
                "id": "msg-final",
                "role": "assistant",
                "text": "Here are the results.",
                "blocks": [
                    { "type": "text", "id": "text-0", "text": "Here are the results." }
                ],
                "metadata": {
                    "providerTranscript": [
                        {
                            "role": "assistant",
                            "content": "Let me search for that.",
                            "tool_calls": [{
                                "id": "call-1",
                                "type": "function",
                                "function": {
                                    "name": "search",
                                    "arguments": "{\"query\": \"test\"}"
                                }
                            }]
                        },
                        {
                            "role": "tool",
                            "tool_call_id": "call-1",
                            "content": "Search results found."
                        },
                        {
                            "role": "assistant",
                            "content": "Here are the results."
                        }
                    ]
                }
            }),
        ];

        let mut tool_outputs = HashMap::new();
        tool_outputs.insert(
            "call-1".to_string(),
            "Search results found.".to_string(),
        );

        let context = ContextBuilder::default().build_provider_context(
            "system".to_string(),
            messages,
            ProviderContextOptions {
                tool_outputs_by_id: tool_outputs,
                ..ProviderContextOptions::default()
            },
        );

        let serialized = serde_json::to_string(&context.messages).unwrap();

        // The transcript's tool call is present with proper structure.
        assert!(
            serialized.contains("\"tool_calls\""),
            "transcript should contain proper tool_calls"
        );
        assert!(
            serialized.contains("\"tool_call_id\":\"call-1\""),
            "transcript should contain proper tool result with tool_call_id"
        );

        // The intermediate message's tool block should NOT emit tool output as
        // plain text — it must be skipped because the transcript covers it.
        // Verify by counting assistant messages: with the fix, the intermediate
        // message is skipped, so only 2 assistant messages remain (the transcript's
        // tool-call assistant + the final text content). Without the fix there
        // would be 3 (intermediate + transcript + final).
        let assistant_count = context
            .messages
            .iter()
            .filter(|m| m.get("role").and_then(Value::as_str) == Some("assistant"))
            .count();
        assert_eq!(
            assistant_count, 3,
            "intermediate tool-call assistant should be skipped when transcript covers it (2 from transcript + 1 from final content)"
        );
    }
}
