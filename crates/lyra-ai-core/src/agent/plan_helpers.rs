use napi::Result;
use once_cell::sync::Lazy;
use regex::Regex;
use serde_json::Value;

use crate::agent::types::{AgentPlanState, AgentPlanStatus, AgentToolCall};
use crate::storage::registry_db;

static PROPOSED_PLAN_BLOCK_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?s)<proposed_plan>(.*?)</proposed_plan>").expect("valid proposed_plan regex")
});

pub fn approved_plan_from_tool_calls(tool_calls: &[AgentToolCall]) -> Option<String> {
    tool_calls.iter().find_map(|tool_call| {
        let output = tool_call.output.as_ref()?;
        if output.get("kind").and_then(Value::as_str) != Some("plan_approval_resolved") {
            return None;
        }
        if output.get("decision").and_then(Value::as_str) != Some("approve_and_implement") {
            return None;
        }
        output
            .get("proposedMarkdown")
            .and_then(Value::as_str)
            .map(str::to_string)
    })
}

pub fn proposed_plan_from_content(content: &str) -> Option<String> {
    let captures = PROPOSED_PLAN_BLOCK_RE.captures(content)?;
    let body = captures.get(1)?.as_str().trim();
    if body.is_empty() {
        return None;
    }
    Some(body.to_string())
}

pub fn summarize_proposed_plan(plan_markdown: &str) -> String {
    plan_markdown
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or("Proposed plan")
        .to_string()
}

pub fn build_plan_mode_enforcement_prompt(previous_draft: &str) -> String {
    let trimmed = previous_draft.trim();
    if trimmed.is_empty() {
        return "[Lyra Plan Mode Enforcement] You are still in Plan Mode. Do not continue with plain text. End this turn by doing exactly one of the following:\n1. Call `request_user_input` with 1-4 structured blocking questions and 2-4 options each.\n2. Call `plan.submit_for_approval` with a complete decision-ready plan.\nDo not implement, do not narrate intended implementation, and do not answer in plain text.".to_string();
    }

    format!(
        "[Lyra Plan Mode Enforcement] Your previous draft reply did not satisfy Plan Mode because it ended in plain text.\n\nPrevious draft reply:\n{trimmed}\n\nNow correct this immediately. End this turn by doing exactly one of the following:\n1. Call `request_user_input` with 1-4 structured blocking questions and 2-4 options each.\n2. Call `plan.submit_for_approval` with a complete decision-ready plan.\nDo not implement, do not keep exploring, and do not answer in plain text."
    )
}

pub fn build_plan_reentry_guidance(plan: Option<&AgentPlanState>) -> String {
    let Some(plan) = plan else {
        return "No existing plan draft exists yet. Start by exploring and drafting a complete plan."
            .to_string();
    };
    if plan.version == 0 || plan.draft_markdown.trim().is_empty() {
        return "No existing plan draft exists yet. Start by exploring and drafting a complete plan."
            .to_string();
    }
    match plan.status {
        AgentPlanStatus::Submitted => {
            "An existing submitted plan is present. Re-open it, verify whether the latest user input changes scope, and replace the full draft if needed."
                .to_string()
        }
        AgentPlanStatus::Approved => {
            "A previously approved plan exists. Only revise it if the user is clearly changing the task; otherwise continue from the approved context."
                .to_string()
        }
        AgentPlanStatus::Rejected => {
            "A previously rejected plan exists. Use it as historical context only and replace it with a corrected full draft."
                .to_string()
        }
        AgentPlanStatus::Draft => {
            "An existing draft is available. Continue refining it if the task is still the same, otherwise replace the full draft."
                .to_string()
        }
    }
}

pub fn build_plan_scope_reset_guidance(project_root: Option<&str>) -> String {
    let project_root = project_root.unwrap_or("unknown");
    format!(
        "The bound project root for this turn is now `{project_root}`. Treat this as a fresh planning scope unless the user explicitly says to continue older work. Ignore stale file paths, older project-specific assumptions, and replace any previous draft that targeted another root."
    )
}

pub fn select_plan_handoff_input(
    storage_root: &str,
    session_id: &str,
    fallback: &str,
) -> Result<String> {
    let messages = registry_db::list_agent_messages(storage_root, session_id)?;
    let best = messages
        .iter()
        .rev()
        .find(|message| message.role == "user" && message.content.trim().chars().count() >= 24)
        .or_else(|| {
            messages
                .iter()
                .rev()
                .find(|message| message.role == "user" && !message.content.trim().is_empty())
        })
        .map(|message| message.content.trim().to_string());
    Ok(best.unwrap_or_else(|| fallback.trim().to_string()))
}
