use super::*;

pub(super) fn run_update_plan_call(
    store: &AiStore,
    session_id: &str,
    turn_id: &str,
    tool_call: &ToolCall,
    messages: &mut Vec<ChatMessage>,
) -> Result<()> {
    let operation = tool_call::agent_operation(tool_call);
    tool_call::emit_tool_start(store, session_id, turn_id, &operation)?;
    let result = match create_runtime_plan(store, session_id, turn_id, tool_call) {
        Ok(content) => ToolResultEnvelope::completed(
            &operation,
            "Updated execution plan",
            serde_json::to_string_pretty(&content)?,
            false,
        ),
        Err(error) => ToolResultEnvelope::failed(
            &operation,
            crate::tool_runtime::operation::TOOL_EXECUTION_FAILED,
            error.to_string(),
        ),
    };
    tool_call::finish_agent_tool_result(
        store, session_id, turn_id, &operation, tool_call, result, messages,
    )
}

fn create_runtime_plan(
    store: &AiStore,
    session_id: &str,
    turn_id: &str,
    tool_call: &ToolCall,
) -> Result<Value> {
    let title =
        string_arg(&tool_call.arguments, "title").unwrap_or_else(|| "Execution plan".into());
    let objective =
        string_arg(&tool_call.arguments, "objectiveSummary").unwrap_or_else(|| title.clone());
    let steps = tool_call
        .arguments
        .get("steps")
        .and_then(Value::as_array)
        .ok_or_else(|| anyhow!("update_plan steps are required"))?;
    if steps.is_empty() {
        return Err(anyhow!("update_plan requires at least one step"));
    }
    let version = json!({
        "summary": objective,
        "steps": steps,
        "source": { "type": "tool_call", "toolCallId": tool_call.id }
    });
    let plan = store.create_planning_session(
        session_id,
        Some(turn_id),
        &title,
        &objective,
        json!({ "type": "update_plan_tool", "toolCallId": tool_call.id }),
        version,
    )?;
    let items = steps
        .iter()
        .enumerate()
        .map(|(index, step)| todo_item_from_plan_step(index, step))
        .collect::<Vec<_>>();
    let refs = store.create_execution_todo_list(
        session_id,
        Some(turn_id),
        "plan_bound",
        &title,
        json!({
            "type": "update_plan_tool",
            "planId": plan.plan_id,
            "versionId": plan.version_id,
            "toolCallId": tool_call.id,
        }),
        &items,
    )?;
    emit_store_event(
        store,
        session_id,
        Some(turn_id),
        "plan_updated",
        json!({ "planId": plan.plan_id, "versionId": plan.version_id, "panelId": plan.panel_id }),
    )?;
    emit_store_event(
        store,
        session_id,
        Some(turn_id),
        "todo_list_created",
        json!({
            "todoListId": refs.todo_list_id,
            "executionRunId": refs.execution_run_id,
            "kind": "plan_bound",
            "planId": plan.plan_id,
            "versionId": plan.version_id,
        }),
    )?;
    Ok(json!({
        "planId": plan.plan_id,
        "versionId": plan.version_id,
        "panelId": plan.panel_id,
        "todoListId": refs.todo_list_id,
        "executionRunId": refs.execution_run_id,
    }))
}

fn todo_item_from_plan_step(index: usize, step: &Value) -> CreateTodoItemInput {
    CreateTodoItemInput {
        title: string_arg(step, "title").unwrap_or_else(|| format!("Step {}", index + 1)),
        actions: string_array_arg(step, "actions"),
        expected_tools: string_array_arg(step, "expectedTools"),
        risk_level: string_arg(step, "riskLevel").unwrap_or_else(|| "medium".to_string()),
        completion_criteria: string_array_arg(step, "completionCriteria"),
        source: json!({
            "planStepId": string_arg(step, "id").unwrap_or_else(|| format!("step-{}", index + 1)),
            "planStep": step
        }),
    }
}

fn string_arg(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .and_then(trim_to_string)
}

fn string_array_arg(value: &Value, key: &str) -> Vec<String> {
    value
        .get(key)
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .filter_map(trim_to_string)
                .collect()
        })
        .unwrap_or_default()
}
