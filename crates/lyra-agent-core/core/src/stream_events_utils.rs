use std::collections::hash_map::DefaultHasher;
use std::hash::Hash;
use std::hash::Hasher;
use std::pin::Pin;
use std::sync::Arc;

use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use lyra_protocol::config_types::ModeKind;
use lyra_protocol::items::PlanItem;
use lyra_protocol::items::TurnItem;
use lyra_protocol::plan_tool::PlanArtifact;
use lyra_protocol::plan_tool::PlanArtifactBlock;
use lyra_protocol::plan_tool::PlanArtifactStatus;
use lyra_utils_stream_parser::strip_citations;
use tokio_util::sync::CancellationToken;

use crate::function_tool::FunctionCallError;
use crate::memories::citations::get_thread_id_from_citations;
use crate::memories::citations::parse_memory_citation;
use crate::parse_turn_item;
use crate::session::session::Session;
use crate::session::turn_context::TurnContext;
use crate::tools::parallel::ToolCallRuntime;
use crate::tools::router::ToolRouter;
use futures::Future;
use lyra_protocol::error::LyraErr;
use lyra_protocol::error::Result;
use lyra_protocol::models::DeveloperInstructions;
use lyra_protocol::models::FunctionCallOutputBody;
use lyra_protocol::models::FunctionCallOutputPayload;
use lyra_protocol::models::MessagePhase;
use lyra_protocol::models::ResponseInputItem;
use lyra_protocol::models::ResponseItem;
use lyra_rollout::state_db;
use lyra_utils_absolute_path::AbsolutePathBuf;
use tracing::debug;
use tracing::instrument;

const GENERATED_IMAGE_ARTIFACTS_DIR: &str = "generated_images";
const PROPOSED_PLAN_OPEN: &str = "<proposed_plan>";
const PROPOSED_PLAN_CLOSE: &str = "</proposed_plan>";
const DRAFT_PLAN_OPEN: &str = "<draft_plan>";
const DRAFT_PLAN_CLOSE: &str = "</draft_plan>";

pub(crate) fn image_generation_artifact_path(
    lyra_home: &AbsolutePathBuf,
    session_id: &str,
    call_id: &str,
) -> AbsolutePathBuf {
    let sanitize = |value: &str| {
        let mut sanitized: String = value
            .chars()
            .map(|ch| {
                if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                    ch
                } else {
                    '_'
                }
            })
            .collect();
        if sanitized.is_empty() {
            sanitized = "generated_image".to_string();
        }
        sanitized
    };

    lyra_home
        .join(GENERATED_IMAGE_ARTIFACTS_DIR)
        .join(sanitize(session_id))
        .join(format!("{}.png", sanitize(call_id)))
}

fn strip_hidden_assistant_markup(text: &str, plan_mode: bool) -> String {
    let (without_citations, _) = strip_citations(text);
    strip_plan_tags_from_visible_text(&without_citations, plan_mode)
}

fn strip_hidden_assistant_markup_and_parse_memory_citation(
    text: &str,
    plan_mode: bool,
) -> (
    String,
    Option<lyra_protocol::memory_citation::MemoryCitation>,
) {
    let (without_citations, citations) = strip_citations(text);
    let visible_text = strip_plan_tags_from_visible_text(&without_citations, plan_mode);
    (visible_text, parse_memory_citation(citations))
}

fn strip_plan_tags_from_visible_text(text: &str, plan_mode: bool) -> String {
    if !plan_mode {
        return text.to_string();
    }
    let without_proposed = strip_tag_sections(text, PROPOSED_PLAN_OPEN, PROPOSED_PLAN_CLOSE);
    let without_draft = strip_tag_sections(&without_proposed, DRAFT_PLAN_OPEN, DRAFT_PLAN_CLOSE);
    if looks_like_untagged_plan_proposal(&without_draft) {
        return String::new();
    }
    without_draft
}

fn strip_tag_sections(text: &str, open: &str, close: &str) -> String {
    let mut rest = text;
    let mut out = String::new();
    while let Some(start) = rest.find(open) {
        out.push_str(&rest[..start]);
        let after_open = &rest[start + open.len()..];
        if let Some(end) = after_open.find(close) {
            rest = &after_open[end + close.len()..];
        } else {
            rest = "";
            break;
        }
    }
    out.push_str(rest);
    out
}

fn extract_plan_artifacts_from_assistant_text(text: &str) -> Vec<PlanArtifact> {
    let mut artifacts = Vec::new();
    artifacts.extend(
        extract_tag_sections(text, DRAFT_PLAN_OPEN, DRAFT_PLAN_CLOSE)
            .map(|content| markdown_plan_artifact(content, PlanArtifactStatus::Draft)),
    );
    artifacts.extend(
        extract_tag_sections(text, PROPOSED_PLAN_OPEN, PROPOSED_PLAN_CLOSE)
            .map(|content| markdown_plan_artifact(content, PlanArtifactStatus::Proposed)),
    );
    if artifacts.is_empty() && looks_like_untagged_plan_proposal(text) {
        artifacts.push(markdown_plan_artifact(text, PlanArtifactStatus::Proposed));
    }
    artifacts
}

fn looks_like_untagged_plan_proposal(text: &str) -> bool {
    let normalized = text.to_lowercase();
    if normalized.contains(PROPOSED_PLAN_OPEN) || normalized.contains(DRAFT_PLAN_OPEN) {
        return false;
    }

    let has_plan_marker = normalized.contains(" plan")
        || normalized.contains("plan:")
        || normalized.contains("planning")
        || text.contains("计划")
        || text.contains("方案");
    if !has_plan_marker {
        return false;
    }

    let heading_count = text
        .lines()
        .filter(|line| {
            let trimmed = line.trim_start();
            trimmed.starts_with("# ") || trimmed.starts_with("## ") || trimmed.starts_with("### ")
        })
        .count();
    let list_count = text
        .lines()
        .filter(|line| {
            let trimmed = line.trim_start();
            trimmed.starts_with("- ")
                || trimmed.starts_with("* ")
                || trimmed.chars().next().is_some_and(|ch| ch.is_ascii_digit())
                    && trimmed.contains(". ")
        })
        .count();
    let has_implementation_terms = normalized.contains("implementation")
        || normalized.contains("acceptance")
        || normalized.contains("test")
        || text.contains("实施")
        || text.contains("步骤")
        || text.contains("技术方案")
        || text.contains("验收")
        || text.contains("测试");

    has_implementation_terms && heading_count > 0 && (list_count >= 2 || heading_count >= 2)
}

fn extract_tag_sections<'a>(
    text: &'a str,
    open: &'static str,
    close: &'static str,
) -> impl Iterator<Item = &'a str> {
    let mut rest = text;
    std::iter::from_fn(move || {
        let start = rest.find(open)?;
        let after_open = &rest[start + open.len()..];
        let end = after_open.find(close)?;
        let content = &after_open[..end];
        rest = &after_open[end + close.len()..];
        Some(content.trim())
    })
}

fn markdown_plan_artifact(markdown: &str, status: PlanArtifactStatus) -> PlanArtifact {
    let normalized_markdown = official_plan_markdown(markdown);
    let title = first_markdown_heading(&normalized_markdown).unwrap_or_else(|| "Plan".to_string());
    let body_without_title = remove_first_markdown_heading(&normalized_markdown);
    let summary = first_non_heading_text(&body_without_title).unwrap_or_else(|| title.clone());
    let sections = markdown_sections(&body_without_title);
    let mut artifact = PlanArtifact {
        plan_id: stable_plan_id(&title, &normalized_markdown),
        status,
        title,
        summary: summary.clone(),
        objective: summary,
        assumptions: Vec::new(),
        steps: Vec::new(),
        interfaces: Vec::new(),
        risks: Vec::new(),
        tests: Vec::new(),
        acceptance_criteria: Vec::new(),
    };

    if sections.is_empty() {
        artifact.steps.push(markdown_plan_block(
            "step",
            "Plan",
            normalized_markdown.trim(),
            0,
        ));
        return artifact;
    }

    for (index, (heading, body)) in sections.into_iter().enumerate() {
        let block = markdown_plan_block(section_kind(&heading), &heading, &body, index);
        match section_bucket(&heading) {
            PlanSectionBucket::Assumptions => artifact.assumptions.push(block),
            PlanSectionBucket::Interfaces => artifact.interfaces.push(block),
            PlanSectionBucket::Risks => artifact.risks.push(block),
            PlanSectionBucket::Tests => artifact.tests.push(block),
            PlanSectionBucket::AcceptanceCriteria => artifact.acceptance_criteria.push(block),
            PlanSectionBucket::Steps => artifact.steps.push(block),
        }
    }

    if artifact.steps.is_empty()
        && artifact.assumptions.is_empty()
        && artifact.interfaces.is_empty()
        && artifact.risks.is_empty()
        && artifact.tests.is_empty()
        && artifact.acceptance_criteria.is_empty()
    {
        artifact
            .steps
            .push(markdown_plan_block("step", "Plan", markdown.trim(), 0));
    }
    artifact
}

fn official_plan_markdown(markdown: &str) -> String {
    if let Some((byte_index, _)) = markdown
        .char_indices()
        .find(|(index, _)| is_markdown_heading_at(markdown, *index))
    {
        markdown[byte_index..].trim().to_string()
    } else {
        markdown.trim().to_string()
    }
}

fn is_markdown_heading_at(markdown: &str, byte_index: usize) -> bool {
    if byte_index > 0 && !markdown[..byte_index].ends_with('\n') {
        return false;
    }
    let rest = &markdown[byte_index..];
    rest.starts_with("# ") || rest.starts_with("## ") || rest.starts_with("### ")
}

fn first_markdown_heading(markdown: &str) -> Option<String> {
    markdown.lines().find_map(|line| {
        let trimmed = line.trim();
        trimmed
            .strip_prefix("# ")
            .or_else(|| trimmed.strip_prefix("## "))
            .or_else(|| trimmed.strip_prefix("### "))
            .map(str::trim)
            .filter(|heading| !heading.is_empty())
            .map(ToOwned::to_owned)
    })
}

fn remove_first_markdown_heading(markdown: &str) -> String {
    let mut removed = false;
    markdown
        .lines()
        .filter(|line| {
            if removed {
                return true;
            }
            let trimmed = line.trim();
            if trimmed.starts_with("# ")
                || trimmed.starts_with("## ")
                || trimmed.starts_with("### ")
            {
                removed = true;
                return false;
            }
            true
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn first_non_heading_text(markdown: &str) -> Option<String> {
    markdown.lines().find_map(|line| {
        let trimmed = line
            .trim()
            .trim_start_matches("- ")
            .trim_start_matches("* ")
            .trim();
        if trimmed.is_empty()
            || trimmed.starts_with('#')
            || trimmed == "---"
            || trimmed == "***"
            || trimmed == "___"
        {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

fn markdown_sections(markdown: &str) -> Vec<(String, String)> {
    let mut sections = Vec::new();
    let mut current_heading: Option<String> = None;
    let mut current_body = Vec::new();

    for line in markdown.lines() {
        let trimmed = line.trim();
        if let Some(heading) = trimmed
            .strip_prefix("## ")
            .or_else(|| trimmed.strip_prefix("### "))
            .map(str::trim)
            .filter(|heading| !heading.is_empty())
        {
            if let Some(previous_heading) = current_heading.replace(heading.to_string()) {
                sections.push((previous_heading, current_body.join("\n").trim().to_string()));
                current_body.clear();
            }
            continue;
        }
        if current_heading.is_some() {
            current_body.push(line.to_string());
        }
    }

    if let Some(heading) = current_heading {
        sections.push((heading, current_body.join("\n").trim().to_string()));
    }
    sections
}

fn markdown_plan_block(kind: &str, title: &str, body: &str, index: usize) -> PlanArtifactBlock {
    let title = title.trim();
    let body = body.trim();
    PlanArtifactBlock {
        id: stable_block_id(kind, title, body, index),
        kind: kind.to_string(),
        title: if title.is_empty() {
            "Plan".to_string()
        } else {
            title.to_string()
        },
        body: if body.is_empty() {
            title.to_string()
        } else {
            body.to_string()
        },
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PlanSectionBucket {
    Assumptions,
    Steps,
    Interfaces,
    Risks,
    Tests,
    AcceptanceCriteria,
}

fn section_bucket(heading: &str) -> PlanSectionBucket {
    let normalized = heading.to_lowercase();
    if normalized.contains("assumption") || normalized.contains("假设") {
        PlanSectionBucket::Assumptions
    } else if normalized.contains("interface")
        || normalized.contains("api")
        || normalized.contains("protocol")
        || normalized.contains("schema")
        || normalized.contains("接口")
        || normalized.contains("协议")
        || normalized.contains("数据流")
    {
        PlanSectionBucket::Interfaces
    } else if normalized.contains("risk")
        || normalized.contains("tradeoff")
        || normalized.contains("edge")
        || normalized.contains("风险")
    {
        PlanSectionBucket::Risks
    } else if normalized.contains("test")
        || normalized.contains("verify")
        || normalized.contains("验证")
        || normalized.contains("测试")
    {
        PlanSectionBucket::Tests
    } else if normalized.contains("acceptance")
        || normalized.contains("criteria")
        || normalized.contains("验收")
        || normalized.contains("标准")
    {
        PlanSectionBucket::AcceptanceCriteria
    } else {
        PlanSectionBucket::Steps
    }
}

fn section_kind(heading: &str) -> &'static str {
    match section_bucket(heading) {
        PlanSectionBucket::Assumptions => "assumption",
        PlanSectionBucket::Steps => "step",
        PlanSectionBucket::Interfaces => "interface",
        PlanSectionBucket::Risks => "risk",
        PlanSectionBucket::Tests => "test",
        PlanSectionBucket::AcceptanceCriteria => "acceptanceCriterion",
    }
}

fn stable_plan_id(title: &str, body: &str) -> String {
    format!("plan-{:016x}", stable_hash(&(title, body)))
}

fn stable_block_id(kind: &str, title: &str, body: &str, index: usize) -> String {
    format!(
        "{kind}-{:02}-{:016x}",
        index + 1,
        stable_hash(&(kind, title, body))
    )
}

fn stable_hash<T: Hash>(value: &T) -> u64 {
    let mut hasher = DefaultHasher::new();
    value.hash(&mut hasher);
    hasher.finish()
}

async fn emit_assistant_plan_artifacts(sess: &Session, turn_context: &TurnContext, raw_text: &str) {
    for artifact in extract_plan_artifacts_from_assistant_text(raw_text) {
        let item = TurnItem::Plan(PlanItem {
            id: format!(
                "{}-assistant-plan-{}",
                turn_context.sub_id, artifact.plan_id
            ),
            artifact,
        });
        sess.emit_turn_item_started(turn_context, &item).await;
        sess.emit_turn_item_completed(turn_context, item).await;
    }
}

pub(crate) fn raw_assistant_output_text_from_item(item: &ResponseItem) -> Option<String> {
    if let ResponseItem::Message { role, content, .. } = item
        && role == "assistant"
    {
        let combined = content
            .iter()
            .filter_map(|ci| match ci {
                lyra_protocol::models::ContentItem::OutputText { text } => Some(text.as_str()),
                _ => None,
            })
            .collect::<String>();
        return Some(combined);
    }
    None
}

async fn save_image_generation_result(
    lyra_home: &AbsolutePathBuf,
    session_id: &str,
    call_id: &str,
    result: &str,
) -> Result<AbsolutePathBuf> {
    let bytes = BASE64_STANDARD
        .decode(result.trim().as_bytes())
        .map_err(|err| {
            LyraErr::InvalidRequest(format!("invalid image generation payload: {err}"))
        })?;
    let path = image_generation_artifact_path(lyra_home, session_id, call_id);
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    tokio::fs::write(&path, bytes).await?;
    Ok(path)
}

/// Persist a completed model response item and record any cited memory usage.
pub(crate) async fn record_completed_response_item(
    sess: &Session,
    turn_context: &TurnContext,
    item: &ResponseItem,
) {
    sess.record_conversation_items(turn_context, std::slice::from_ref(item))
        .await;
    if completed_item_defers_mailbox_delivery_to_next_turn(
        item,
        turn_context.collaboration_mode.mode == ModeKind::Plan,
    ) {
        sess.defer_mailbox_delivery_to_next_turn(&turn_context.sub_id)
            .await;
    }
    mark_thread_memory_mode_polluted_if_external_context(sess, turn_context, item).await;
    record_stage1_output_usage_for_completed_item(turn_context, item).await;
}

fn response_item_may_include_external_context(item: &ResponseItem) -> bool {
    matches!(
        item,
        ResponseItem::ToolSearchCall { .. }
            | ResponseItem::ToolSearchOutput { .. }
            | ResponseItem::WebSearchCall { .. }
    )
}

pub(crate) async fn mark_thread_memory_mode_polluted_if_external_context(
    sess: &Session,
    turn_context: &TurnContext,
    item: &ResponseItem,
) {
    if !turn_context.config.memories.disable_on_external_context
        || !response_item_may_include_external_context(item)
    {
        return;
    }
    state_db::mark_thread_memory_mode_polluted(
        sess.services.state_db.as_deref(),
        sess.conversation_id,
        "record_completed_response_item",
    )
    .await;
}

async fn record_stage1_output_usage_for_completed_item(
    turn_context: &TurnContext,
    item: &ResponseItem,
) {
    let Some(raw_text) = raw_assistant_output_text_from_item(item) else {
        return;
    };

    let (_, citations) = strip_citations(&raw_text);
    let thread_ids = get_thread_id_from_citations(citations);
    if thread_ids.is_empty() {
        return;
    }

    if let Some(db) = state_db::get_state_db(turn_context.config.as_ref()).await {
        let _ = db.record_stage1_output_usage(&thread_ids).await;
    }
}

/// Handle a completed output item from the model stream, recording it and
/// queuing any tool execution futures. This records items immediately so
/// history and rollout stay in sync even if the turn is later cancelled.
pub(crate) type InFlightFuture<'f> =
    Pin<Box<dyn Future<Output = Result<ResponseInputItem>> + Send + 'f>>;

#[derive(Default)]
pub(crate) struct OutputItemResult {
    pub last_agent_message: Option<String>,
    pub needs_follow_up: bool,
    pub tool_future: Option<InFlightFuture<'static>>,
}

pub(crate) struct HandleOutputCtx {
    pub sess: Arc<Session>,
    pub turn_context: Arc<TurnContext>,
    pub tool_runtime: ToolCallRuntime,
    pub cancellation_token: CancellationToken,
}

#[instrument(level = "trace", skip_all)]
pub(crate) async fn handle_output_item_done(
    ctx: &mut HandleOutputCtx,
    item: ResponseItem,
    previously_active_item: Option<TurnItem>,
) -> Result<OutputItemResult> {
    let mut output = OutputItemResult::default();
    let plan_mode = ctx.turn_context.collaboration_mode.mode == ModeKind::Plan;

    match ToolRouter::build_tool_call(ctx.sess.as_ref(), item.clone()).await {
        // The model emitted a tool call; log it, persist the item immediately, and queue the tool execution.
        Ok(Some(call)) => {
            ctx.sess
                .accept_mailbox_delivery_for_current_turn(&ctx.turn_context.sub_id)
                .await;

            let payload_preview = call.payload.log_payload().into_owned();
            tracing::info!(
                thread_id = %ctx.sess.conversation_id,
                "ToolCall: {} {}",
                call.tool_name.display(),
                payload_preview
            );

            if let Some(mut consumer) = ctx.tool_runtime.create_diff_consumer(&call.tool_name)
                && let Some(event) = consumer.consume_complete(
                    ctx.turn_context.as_ref(),
                    call.call_id.clone(),
                    &call.payload,
                )
            {
                ctx.sess.send_event(&ctx.turn_context, event).await;
            }

            record_completed_response_item(ctx.sess.as_ref(), ctx.turn_context.as_ref(), &item)
                .await;

            let cancellation_token = ctx.cancellation_token.child_token();
            let tool_future: InFlightFuture<'static> = Box::pin(
                ctx.tool_runtime
                    .clone()
                    .handle_tool_call(call, cancellation_token),
            );

            output.needs_follow_up = true;
            output.tool_future = Some(tool_future);
        }
        // No tool call: convert messages/reasoning into turn items and mark them as complete.
        Ok(None) => {
            if let Some(turn_item) = handle_non_tool_response_item(
                ctx.sess.as_ref(),
                ctx.turn_context.as_ref(),
                &item,
                plan_mode,
            )
            .await
            {
                if previously_active_item.is_none() {
                    let mut started_item = turn_item.clone();
                    if let TurnItem::ImageGeneration(item) = &mut started_item {
                        item.status = "in_progress".to_string();
                        item.revised_prompt = None;
                        item.result.clear();
                        item.saved_path = None;
                    }
                    ctx.sess
                        .emit_turn_item_started(&ctx.turn_context, &started_item)
                        .await;
                }

                ctx.sess
                    .emit_turn_item_completed(&ctx.turn_context, turn_item)
                    .await;
            }
            record_completed_response_item(ctx.sess.as_ref(), ctx.turn_context.as_ref(), &item)
                .await;
            let last_agent_message = last_assistant_message_from_item(&item, plan_mode);
            if plan_mode && let Some(raw_text) = raw_assistant_output_text_from_item(&item) {
                emit_assistant_plan_artifacts(
                    ctx.sess.as_ref(),
                    ctx.turn_context.as_ref(),
                    &raw_text,
                )
                .await;
            }

            output.last_agent_message = last_agent_message;
        }
        // Guardrail: the model issued a LocalShellCall without an id; surface the error back into history.
        Err(FunctionCallError::MissingLocalShellCallId) => {
            let msg = "LocalShellCall without call_id or id";
            ctx.turn_context
                .session_telemetry
                .log_tool_failed("local_shell", msg);
            tracing::error!(msg);

            let response = ResponseInputItem::FunctionCallOutput {
                call_id: String::new(),
                output: FunctionCallOutputPayload {
                    body: FunctionCallOutputBody::Text(msg.to_string()),
                    ..Default::default()
                },
            };
            record_completed_response_item(ctx.sess.as_ref(), ctx.turn_context.as_ref(), &item)
                .await;
            if let Some(response_item) = response_input_to_response_item(&response) {
                ctx.sess
                    .record_conversation_items(
                        &ctx.turn_context,
                        std::slice::from_ref(&response_item),
                    )
                    .await;
            }

            output.needs_follow_up = true;
        }
        // The tool request should be answered directly (or was denied); push that response into the transcript.
        Err(FunctionCallError::RespondToModel(message)) => {
            let response = ResponseInputItem::FunctionCallOutput {
                call_id: String::new(),
                output: FunctionCallOutputPayload {
                    body: FunctionCallOutputBody::Text(message),
                    ..Default::default()
                },
            };
            record_completed_response_item(ctx.sess.as_ref(), ctx.turn_context.as_ref(), &item)
                .await;
            if let Some(response_item) = response_input_to_response_item(&response) {
                ctx.sess
                    .record_conversation_items(
                        &ctx.turn_context,
                        std::slice::from_ref(&response_item),
                    )
                    .await;
            }

            output.needs_follow_up = true;
        }
        // A fatal error occurred; surface it back into history.
        Err(FunctionCallError::Fatal(message)) => {
            return Err(LyraErr::Fatal(message));
        }
    }

    Ok(output)
}

pub(crate) async fn handle_non_tool_response_item(
    sess: &Session,
    turn_context: &TurnContext,
    item: &ResponseItem,
    plan_mode: bool,
) -> Option<TurnItem> {
    debug!(?item, "Output item");

    match item {
        ResponseItem::Message { .. }
        | ResponseItem::Reasoning { .. }
        | ResponseItem::WebSearchCall { .. }
        | ResponseItem::ImageGenerationCall { .. } => {
            let mut turn_item = parse_turn_item(item)?;
            if let TurnItem::AgentMessage(agent_message) = &mut turn_item {
                let combined = agent_message
                    .content
                    .iter()
                    .map(|entry| match entry {
                        lyra_protocol::items::AgentMessageContent::Text { text } => text.as_str(),
                    })
                    .collect::<String>();
                let (stripped, memory_citation) =
                    strip_hidden_assistant_markup_and_parse_memory_citation(&combined, plan_mode);
                agent_message.content =
                    vec![lyra_protocol::items::AgentMessageContent::Text { text: stripped }];
                agent_message.memory_citation = memory_citation;
            }
            if let TurnItem::ImageGeneration(image_item) = &mut turn_item {
                let session_id = sess.conversation_id.to_string();
                match save_image_generation_result(
                    &turn_context.config.lyra_home,
                    &session_id,
                    &image_item.id,
                    &image_item.result,
                )
                .await
                {
                    Ok(path) => {
                        image_item.saved_path = Some(path);
                        let image_output_path = image_generation_artifact_path(
                            &turn_context.config.lyra_home,
                            &session_id,
                            "<image_id>",
                        );
                        let image_output_dir = image_output_path
                            .parent()
                            .unwrap_or_else(|| turn_context.config.lyra_home.clone());
                        let message: ResponseItem = DeveloperInstructions::new(format!(
                            "Generated images are saved to {} as {} by default.\nIf you need to use a generated image at another path, copy it and leave the original in place unless the user explicitly asks you to delete it.",
                            image_output_dir.display(),
                            image_output_path.display(),
                        ))
                        .into();
                        sess.record_conversation_items(turn_context, &[message])
                            .await;
                    }
                    Err(err) => {
                        let output_path = image_generation_artifact_path(
                            &turn_context.config.lyra_home,
                            &session_id,
                            &image_item.id,
                        );
                        let output_dir = output_path
                            .parent()
                            .unwrap_or_else(|| turn_context.config.lyra_home.clone());
                        tracing::warn!(
                            call_id = %image_item.id,
                            output_dir = %output_dir.display(),
                            "failed to save generated image: {err}"
                        );
                    }
                }
            }
            Some(turn_item)
        }
        ResponseItem::FunctionCallOutput { .. }
        | ResponseItem::CustomToolCallOutput { .. }
        | ResponseItem::ToolSearchOutput { .. } => {
            debug!("unexpected tool output from stream");
            None
        }
        _ => None,
    }
}

pub(crate) fn last_assistant_message_from_item(
    item: &ResponseItem,
    plan_mode: bool,
) -> Option<String> {
    if let Some(combined) = raw_assistant_output_text_from_item(item) {
        if combined.is_empty() {
            return None;
        }
        let stripped = strip_hidden_assistant_markup(&combined, plan_mode);
        if stripped.trim().is_empty() {
            return None;
        }
        return Some(stripped);
    }
    None
}

fn completed_item_defers_mailbox_delivery_to_next_turn(
    item: &ResponseItem,
    plan_mode: bool,
) -> bool {
    match item {
        ResponseItem::Message { role, phase, .. } => {
            if role != "assistant" || matches!(phase, Some(MessagePhase::Commentary)) {
                return false;
            }
            // Treat `None` like final-answer text so untagged providers default
            // to the safer "defer mailbox mail" behavior.
            last_assistant_message_from_item(item, plan_mode).is_some()
        }
        ResponseItem::ImageGenerationCall { .. } => true,
        _ => false,
    }
}

pub(crate) fn response_input_to_response_item(input: &ResponseInputItem) -> Option<ResponseItem> {
    match input {
        ResponseInputItem::FunctionCallOutput { call_id, output } => {
            Some(ResponseItem::FunctionCallOutput {
                call_id: call_id.clone(),
                output: output.clone(),
            })
        }
        ResponseInputItem::CustomToolCallOutput {
            call_id,
            name,
            output,
        } => Some(ResponseItem::CustomToolCallOutput {
            call_id: call_id.clone(),
            name: name.clone(),
            output: output.clone(),
        }),
        ResponseInputItem::McpToolCallOutput { call_id, output } => {
            let output = output.as_function_call_output_payload();
            Some(ResponseItem::FunctionCallOutput {
                call_id: call_id.clone(),
                output,
            })
        }
        ResponseInputItem::ToolSearchOutput {
            call_id,
            status,
            execution,
            tools,
        } => Some(ResponseItem::ToolSearchOutput {
            call_id: Some(call_id.clone()),
            status: status.clone(),
            execution: execution.clone(),
            tools: tools.clone(),
        }),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn proposed_plan_markdown_becomes_plan_artifact() {
        let artifacts = extract_plan_artifacts_from_assistant_text(
            r#"Intro
<proposed_plan>
# Plan Mode Fix

## Summary
Make plan review a normal completed turn.

## Tests
- Verify proposed plans complete the turn.
</proposed_plan>
Outro"#,
        );

        assert_eq!(artifacts.len(), 1);
        let artifact = &artifacts[0];
        assert_eq!(artifact.status, PlanArtifactStatus::Proposed);
        assert_eq!(artifact.title, "Plan Mode Fix");
        assert_eq!(
            artifact.summary,
            "Make plan review a normal completed turn."
        );
        assert_eq!(artifact.steps.len(), 1);
        assert_eq!(artifact.tests.len(), 1);
    }

    #[test]
    fn untagged_plan_markdown_becomes_plan_artifact() {
        let artifacts = extract_plan_artifacts_from_assistant_text(
            r#"看起来当前处于计划模式，我无法直接写入文件。让我为你整理一个实施计划：

## 实施计划：简约现代风格企业官网

**技术方案**：纯 HTML/CSS/JS 单文件，无外部依赖

**网站结构**：
1. 导航栏
2. Hero 区
3. 联系我们

需要我开始创建吗？"#,
        );

        assert_eq!(artifacts.len(), 1);
        let artifact = &artifacts[0];
        assert_eq!(artifact.status, PlanArtifactStatus::Proposed);
        assert_eq!(artifact.title, "实施计划：简约现代风格企业官网");
        assert_eq!(
            artifact.summary,
            "**技术方案**：纯 HTML/CSS/JS 单文件，无外部依赖"
        );
        assert_eq!(artifact.steps.len(), 1);
    }

    #[test]
    fn plan_artifact_ignores_conversational_preamble_before_heading() {
        let artifacts = extract_plan_artifacts_from_assistant_text(
            r#"好的，我处于计划模式，需要先提交方案供您确认。以下是完整的官网建设计划：

---

## 官网建设计划

### 项目概述
为 **MyBrand** 创建一个现代、专业的中文企业官网，纯前端实现（HTML + CSS + JS），无需构建工具，直接浏览器打开即可预览。

### 文件结构
```
Webtest/
├── index.html
├── style.css
└── script.js
```

### 测试
- 直接打开 index.html 验证页面。"#,
        );

        assert_eq!(artifacts.len(), 1);
        let artifact = &artifacts[0];
        assert_eq!(artifact.title, "官网建设计划");
        assert_eq!(
            artifact.summary,
            "为 **MyBrand** 创建一个现代、专业的中文企业官网，纯前端实现（HTML + CSS + JS），无需构建工具，直接浏览器打开即可预览。"
        );
        assert_eq!(artifact.objective, artifact.summary);
        assert!(artifact.steps.iter().any(|block| block.title == "项目概述"));
        assert_eq!(artifact.tests.len(), 1);
    }

    #[test]
    fn plan_tags_are_stripped_from_visible_assistant_text_in_plan_mode() {
        let visible = strip_hidden_assistant_markup(
            "Before\n<proposed_plan>\n# Hidden\n</proposed_plan>\nAfter",
            true,
        );

        assert_eq!(visible, "Before\n\nAfter");
    }

    #[test]
    fn untagged_plan_markdown_is_stripped_from_visible_assistant_text_in_plan_mode() {
        let visible = strip_hidden_assistant_markup(
            "## 实施计划：简约现代风格企业官网\n\n**技术方案**：纯 HTML/CSS/JS\n\n1. 创建 HTML\n2. 验证响应式",
            true,
        );

        assert_eq!(visible, "");
    }
}
