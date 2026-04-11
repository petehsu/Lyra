use super::*;

fn default_plan_state() -> AgentPlanState {
    AgentPlanState {
        status: AgentPlanStatus::Draft,
        version: 0,
        draft_markdown: String::new(),
        proposed_markdown: None,
        approved_markdown: None,
        last_submitted_version: None,
        updated_at: now_ms(),
    }
}

fn load_plan_state(storage_root: &str, session_id: &str) -> Result<AgentPlanState, AgentToolError> {
    registry_db::read_agent_plan(storage_root, session_id)
        .map_err(|error| {
            AgentToolError::exec_failed(format!("failed to read plan state: {error}"))
        })?
        .map(Ok)
        .unwrap_or_else(|| {
            registry_db::upsert_agent_plan(storage_root, session_id, &default_plan_state()).map_err(
                |error| {
                    AgentToolError::exec_failed(format!("failed to initialize plan state: {error}"))
                },
            )
        })
}

fn require_interaction_context<'a>(
    context: ToolExecutionContext<'a>,
) -> Result<(&'a str, &'a str, &'a str, &'a str), AgentToolError> {
    let storage_root = context
        .storage_root
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| AgentToolError::exec_failed("storage root is required"))?;
    let session_id = context
        .agent_session_id
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| AgentToolError::exec_failed("agent session id is required"))?;
    let turn_id = context
        .agent_turn_id
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| AgentToolError::exec_failed("agent turn id is required"))?;
    let request_id = context
        .tool_call_id
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| AgentToolError::exec_failed("tool call id is required"))?;
    Ok((storage_root, session_id, turn_id, request_id))
}

pub(super) fn run_request_user_input(
    input: &Value,
    context: ToolExecutionContext<'_>,
) -> Result<Value, AgentToolError> {
    let obj = as_object(input)?;
    let (_, session_id, turn_id, request_id) = require_interaction_context(context)?;
    let questions = obj
        .get("questions")
        .and_then(Value::as_array)
        .filter(|items| !items.is_empty())
        .ok_or_else(|| AgentToolError::exec_failed("questions is required"))?;
    if questions.len() > 4 {
        return Err(AgentToolError::exec_failed(
            "request_user_input supports at most 4 questions",
        ));
    }
    let allow_note = optional_bool(obj, "allowNote").unwrap_or(false);
    Err(AgentToolError::plan_question_required(
        "additional user input required",
        json!({
            "requestId": request_id,
            "sessionId": session_id,
            "turnId": turn_id,
            "questions": questions,
            "allowNote": allow_note,
        }),
    ))
}

pub(super) fn run_plan_update_draft(
    input: &Value,
    context: ToolExecutionContext<'_>,
) -> Result<Value, AgentToolError> {
    let obj = as_object(input)?;
    let draft_markdown = required_nonempty_raw_string(obj, "draftMarkdown")?;
    let (storage_root, session_id, _turn_id, _request_id) = require_interaction_context(context)?;
    let mut plan = load_plan_state(storage_root, session_id)?;
    plan.draft_markdown = draft_markdown;
    plan.status = AgentPlanStatus::Draft;
    plan.version += 1;
    plan.updated_at = now_ms();
    let plan =
        registry_db::upsert_agent_plan(storage_root, session_id, &plan).map_err(|error| {
            AgentToolError::exec_failed(format!("failed to update plan draft: {error}"))
        })?;
    Ok(json!({
        "kind": "plan_draft_updated",
        "status": "draft",
        "version": plan.version,
        "draftMarkdown": plan.draft_markdown,
        "updatedAt": plan.updated_at,
    }))
}

pub(super) fn run_plan_submit_for_approval(
    input: &Value,
    context: ToolExecutionContext<'_>,
) -> Result<Value, AgentToolError> {
    let obj = as_object(input)?;
    let plan_markdown = required_nonempty_raw_string(obj, "planMarkdown")?;
    let summary = optional_string(obj, "summary").unwrap_or_else(|| {
        plan_markdown
            .lines()
            .find(|line| !line.trim().is_empty())
            .unwrap_or("Proposed plan")
            .trim()
            .to_string()
    });
    let (storage_root, session_id, turn_id, request_id) = require_interaction_context(context)?;
    let mut plan = load_plan_state(storage_root, session_id)?;
    if plan.draft_markdown != plan_markdown {
        plan.version += 1;
        plan.draft_markdown = plan_markdown.clone();
    } else if plan.version == 0 {
        plan.version = 1;
    }
    plan.status = AgentPlanStatus::Submitted;
    plan.proposed_markdown = Some(plan_markdown.clone());
    plan.last_submitted_version = Some(plan.version);
    plan.updated_at = now_ms();
    let plan =
        registry_db::upsert_agent_plan(storage_root, session_id, &plan).map_err(|error| {
            AgentToolError::exec_failed(format!("failed to submit plan for approval: {error}"))
        })?;
    Err(AgentToolError::plan_approval_required(
        "plan approval required",
        json!({
            "requestId": request_id,
            "sessionId": session_id,
            "turnId": turn_id,
            "version": plan.version,
            "status": "submitted",
            "summary": summary,
            "proposedMarkdown": plan.proposed_markdown,
            "draftMarkdown": plan.draft_markdown,
        }),
    ))
}
