use std::{future::Future, pin::Pin};

use super::*;

pub(crate) fn tool_oma_agent(
    session_id: &str,
    turn_id: &str,
    input: &Value,
) -> Pin<Box<dyn Future<Output = super::tools::NativeToolResult> + Send>> {
    let action = input
        .get("action")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let session_id = session_id.to_string();
    let turn_id = turn_id.to_string();
    let input = input.clone();
    Box::pin(async move {
        match action.as_str() {
            "ask" => tool_oma_ask(&session_id, &turn_id, &input).await,
            "send" => tool_oma_send(&session_id, &input),
            "handoff" => tool_oma_handoff(&session_id, &input),
            "team_plan" => tool_oma_team_plan(&session_id, &turn_id, &input),
            "create_role" => tool_oma_create_role(&session_id, &input),
            _ => Err(super::tools::NativeToolFailure::new(
                "unsupported_oma_agent_action",
                format!("Unsupported Oma agent action: {action}"),
                "Use send, ask, handoff, team_plan, or create_role.",
            )),
        }
    })
}

async fn oma_ask_task(
    host_session_id: String,
    turn_id: String,
    source: String,
    target: String,
    text: String,
    publish_to_group: bool,
) -> AgentRuntimeResult<Value> {
    super::run_oma_direct_ask(
        &host_session_id,
        &turn_id,
        &source,
        &target,
        text,
        publish_to_group,
    )
    .await
    .map(|reply| json!({ "sessionAgentId": target, "reply": reply }))
}

async fn tool_oma_ask(
    session_id: &str,
    turn_id: &str,
    input: &Value,
) -> super::tools::NativeToolResult {
    let text = string_opt(input, "text")
        .or_else(|| string_opt(input, "message"))
        .ok_or_else(|| {
            super::tools::NativeToolFailure::new(
                "missing_message",
                "Oma ask requires text.",
                "Retry with a text field.",
            )
        })?;
    let requested_targets = string_array(input, "targetSessionAgentIds");
    let requested_targets = if requested_targets.is_empty() {
        string_array(input, "targetAgentIds")
    } else {
        requested_targets
    };
    let (host_session_id, source, targets) = {
        let state = state().lock().map_err(|_| {
            super::tools::NativeToolFailure::new(
                "state_lock_failed",
                "agent runtime state lock failed",
                "Retry after the current runtime operation finishes.",
            )
        })?;
        let session = state.sessions.get(session_id).ok_or_else(|| {
            super::tools::NativeToolFailure::new(
                "session_not_found",
                format!("session not found: {session_id}"),
                "Retry in an active Oma session.",
            )
        })?;
        let oma = session.snapshot.get("oma").ok_or_else(|| {
            super::tools::NativeToolFailure::new(
                "oma_required",
                "Oma state is required.",
                "Switch the session to Oma mode before using /tools/agent/*.",
            )
        })?;
        let host_session_id = oma
            .get("parentSessionId")
            .and_then(Value::as_str)
            .unwrap_or(session_id)
            .to_string();
        let source = string_opt(input, "sourceSessionAgentId")
            .or_else(|| string_opt(input, "sourceAgentId"))
            .and_then(|id| find_session_agent_id_for_identifier(oma, &id))
            .or_else(|| {
                oma.get("executingSessionAgentId")
                    .and_then(Value::as_str)
                    .map(str::to_string)
            })
            .or_else(|| lead_session_agent_id(oma))
            .ok_or_else(|| {
                super::tools::NativeToolFailure::new(
                    "agent_not_active",
                    "No active Oma source Agent is available.",
                    "Retry after the Oma roster is restored.",
                )
            })?;
        let targets = requested_targets
            .iter()
            .filter_map(|id| find_session_agent_id_for_identifier(oma, id))
            .collect::<Vec<_>>();
        if targets.is_empty() {
            return Err(super::tools::NativeToolFailure::new(
                "missing_target_agent",
                "Oma ask requires an active targetAgentIds entry.",
                "Retry with one target Agent from the current Oma roster.",
            ));
        }
        (host_session_id, source, targets)
    };
    let publish_to_group = input
        .get("publishToGroup")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let mut unique_targets = Vec::new();
    for target in targets {
        if !unique_targets.contains(&target) {
            unique_targets.push(target);
        }
    }
    let tasks = unique_targets
        .into_iter()
        .map(|target| {
            let host_session_id = host_session_id.clone();
            let turn_id = turn_id.to_string();
            let source = source.clone();
            let text = text.clone();
            Box::pin(oma_ask_task(
                host_session_id,
                turn_id,
                source,
                target,
                text,
                publish_to_group,
            )) as Pin<Box<dyn Future<Output = AgentRuntimeResult<Value>> + Send>>
        })
        .collect::<Vec<_>>();
    let mut replies = Vec::new();
    let timeout = super::turn_engine::oma_worker_timeout();
    for worker in super::turn_engine::run_batch_for_turn(tasks, timeout, turn_id).await {
        let reply = match worker {
            Ok(result) => result,
            Err(super::turn_engine::BlockingTaskFailure::Timeout) => {
                super::session_runtime::request_turn_cancellation(turn_id);
                return Err(super::tools::NativeToolFailure::new(
                    "oma_ask_failed",
                    "Oma ask worker timed out.",
                    "Retry the consultation in a new turn.",
                ));
            }
            Err(super::turn_engine::BlockingTaskFailure::Panic) => {
                return Err(super::tools::NativeToolFailure::new(
                    "oma_ask_failed",
                    "Oma ask worker panicked.",
                    "Retry the consultation.",
                ));
            }
        }
        .map_err(|error| {
            super::tools::NativeToolFailure::new(
                "oma_ask_failed",
                error.to_string(),
                "Retry after the target Agent's direct channel is available.",
            )
        })?;
        replies.push(reply);
    }
    Ok(super::tools::NativeToolSuccess {
        content: replies
            .iter()
            .filter_map(|reply| reply.get("reply").and_then(Value::as_str))
            .collect::<Vec<_>>()
            .join("\n\n"),
        raw: json!({ "responses": replies }),
        recommended_next_action: None,
    })
}

fn tool_oma_team_plan(
    session_id: &str,
    turn_id: &str,
    input: &Value,
) -> super::tools::NativeToolResult {
    let title = string_opt(input, "title").unwrap_or_else(|| "Oma Team Plan".to_string());
    let summary = string_opt(input, "summary").unwrap_or_else(|| title.clone());
    let requested_packages = input
        .get("workPackages")
        .or_else(|| input.get("work_packages"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    if requested_packages.is_empty() {
        return Err(super::tools::NativeToolFailure::new(
            "missing_work_packages",
            "Oma Team Plan requires at least one work package.",
            "Provide workPackages with an assignee, task, acceptance criteria, and deliverable.",
        ));
    }
    let package_count = requested_packages.len();
    let host_session_id = {
        let state = state().lock().map_err(|_| {
            super::tools::NativeToolFailure::new(
                "state_lock_failed",
                "agent runtime state lock failed",
                "Retry after the current runtime operation finishes.",
            )
        })?;
        state
            .sessions
            .get(session_id)
            .and_then(|session| session.snapshot.pointer("/oma/parentSessionId"))
            .and_then(Value::as_str)
            .unwrap_or(session_id)
            .to_string()
    };
    {
        let state = state().lock().map_err(|_| {
            super::tools::NativeToolFailure::new(
                "state_lock_failed",
                "agent runtime state lock failed",
                "Retry after the current runtime operation finishes.",
            )
        })?;
        let session = state.sessions.get(&host_session_id).ok_or_else(|| {
            super::tools::NativeToolFailure::new(
                "session_not_found",
                format!("session not found: {host_session_id}"),
                "Retry in an active Oma session.",
            )
        })?;
    }
    let (callback, snapshot, plan, source_session_agent_id) = {
        let mut state = state().lock().map_err(|_| {
            super::tools::NativeToolFailure::new(
                "state_lock_failed",
                "agent runtime state lock failed",
                "Retry after the current runtime operation finishes.",
            )
        })?;
        let source_session_agent_id = state
            .sessions
            .get(session_id)
            .and_then(|session| session.snapshot.pointer("/oma/executingSessionAgentId"))
            .and_then(Value::as_str)
            .map(str::to_string)
            .ok_or_else(|| {
                super::tools::NativeToolFailure::new(
                    "lead_required",
                    "Only the active Lyra Lead can publish an Oma Team Plan.",
                    "Have Lyra Lead create the Team Plan from the default group.",
                )
            })?;
        let session = state.sessions.get_mut(&host_session_id).ok_or_else(|| {
            super::tools::NativeToolFailure::new(
                "session_not_found",
                format!("session not found: {host_session_id}"),
                "Retry in an active Oma session.",
            )
        })?;
        ensure_oma_channel_message_contexts(&mut session.snapshot);
        let oma = session.snapshot.get("oma").ok_or_else(|| {
            super::tools::NativeToolFailure::new(
                "oma_required",
                "Oma state is required.",
                "Switch the session to Oma mode before publishing a Team Plan.",
            )
        })?;
        if lead_session_agent_id(oma).as_deref() != Some(source_session_agent_id.as_str()) {
            return Err(super::tools::NativeToolFailure::new(
                "lead_required",
                "Only Lyra Lead can publish the group Team Plan.",
                "Ask Lyra Lead to synthesize the consultation into one Team Plan.",
            ));
        }
        let mut work_packages = normalize_oma_work_packages(oma, requested_packages).map_err(
            |message| {
                super::tools::NativeToolFailure::new(
                    "invalid_work_packages",
                    message,
                    "Use active sessionAgentId values from the organization chart and valid dependency ids.",
                )
            },
        )?;
        validate_oma_work_package_contract(oma, &work_packages).map_err(
            |message| {
                super::tools::NativeToolFailure::new(
                    "invalid_work_package_contract",
                    message,
                    "Give every package concrete acceptance criteria and a deliverable. Major UI plans must use Designer definition -> Builder implementation -> Designer conformance review, with Reviewer depending on both implementation and conformance when present.",
                )
            },
        )?;
        let team_id = format!("oma-team-{}", Uuid::new_v4());
        let plan_id = format!("plan-{}", Uuid::new_v4());
        let version_id = format!("plan-version-{}", Uuid::new_v4());
        for package in &mut work_packages {
            package["teamId"] = json!(team_id);
        }
        let markdown = string_opt(input, "markdown")
            .unwrap_or_else(|| oma_team_plan_markdown(&title, &summary, &work_packages));
        let plan = json!({
            "activePlanId": plan_id,
            "activeVersionId": version_id,
            "projectKey": Value::Null,
            "title": title,
            "phase": PLAN_PHASE_REVIEWING,
            "markdown": markdown,
            "annotations": [],
            "review": { "status": "pending", "summary": summary },
            "reason": "Oma autonomous team plan",
            "scope": "session",
            "qualityGate": {
                "investigationVerified": true,
                "verifiedAt": now(),
                "turnId": turn_id,
            },
        });
        let project_todo = json!({
            "todoListId": format!("todo-list-{}", Uuid::new_v4()),
            "planId": plan["activePlanId"].clone(),
            "versionId": plan["activeVersionId"].clone(),
            "status": "pending",
            "currentIndex": 0,
            "todos": work_packages.iter().map(oma_work_package_todo).collect::<Vec<_>>(),
            "summary": plan["review"]["summary"].clone(),
        });
        set_oma_channel_context_field(
            &mut session.snapshot,
            OMA_DEFAULT_CHANNEL_ID,
            "plan",
            plan.clone(),
        )
        .map_err(native_failure_to_tool)?;
        set_oma_channel_context_field(
            &mut session.snapshot,
            OMA_DEFAULT_CHANNEL_ID,
            "projectTodo",
            project_todo,
        )
        .map_err(native_failure_to_tool)?;
        let oma = session
            .snapshot
            .get_mut("oma")
            .expect("validated Oma state");
        oma["team"] = json!({
            "id": team_id,
            "title": plan["title"].clone(),
            "summary": plan["review"]["summary"].clone(),
            "status": "reviewing",
            "planId": plan["activePlanId"].clone(),
            "versionId": plan["activeVersionId"].clone(),
            "workPackages": work_packages,
        });
        touch_session(session);
        let snapshot = session.snapshot.clone();
        let callback = event_callback();
        state.save_state().map_err(|error| {
            super::tools::NativeToolFailure::new(
                "save_failed",
                error.to_string(),
                "Retry after the session can be saved.",
            )
        })?;
        (callback, snapshot, plan, source_session_agent_id)
    };
    emit_with_callback(
        &callback,
        json!({
            "kind": "planUpdated",
            "sessionId": session_id,
            "plan": plan.clone(),
            "omaSource": {
                "sessionAgentId": source_session_agent_id.clone(),
                "channelId": OMA_DEFAULT_CHANNEL_ID,
            },
        }),
    );
    emit_with_callback(
        &callback,
        json!({
            "kind": "planReviewRequested",
            "sessionId": session_id,
            "turnId": turn_id,
            "planId": plan["activePlanId"].clone(),
            "versionId": plan["activeVersionId"].clone(),
            "title": plan["title"].clone(),
            "summary": plan["review"]["summary"].clone(),
            "plan": plan,
            "omaSource": {
                "sessionAgentId": source_session_agent_id,
                "channelId": OMA_DEFAULT_CHANNEL_ID,
            },
        }),
    );
    emit_with_callback(
        &callback,
        json!({ "kind": "sessionSnapshot", "snapshot": snapshot }),
    );
    Ok(super::tools::NativeToolSuccess {
        content: format!("Published Team Plan with {package_count} approval-gated work packages."),
        raw: json!({ "plan": plan, "workPackageCount": package_count }),
        recommended_next_action: Some(
            "Wait for the user's Plan Review approval before any work package executes."
                .to_string(),
        ),
    })
}

fn native_failure_to_tool(error: AgentRuntimeError) -> super::tools::NativeToolFailure {
    super::tools::NativeToolFailure::new(
        "oma_context_failed",
        error.to_string(),
        "Retry after the Oma channel context is repaired.",
    )
}

fn normalize_oma_work_packages(oma: &Value, requested: Vec<Value>) -> Result<Vec<Value>, String> {
    let mut packages = Vec::new();
    let mut ids = HashSet::new();
    for (index, requested) in requested.into_iter().enumerate() {
        let id =
            string_opt(&requested, "id").unwrap_or_else(|| format!("oma-work-{}", Uuid::new_v4()));
        if !ids.insert(id.clone()) {
            return Err(format!("duplicate work package id: {id}"));
        }
        let assignee = string_opt(&requested, "assigneeSessionAgentId")
            .or_else(|| string_opt(&requested, "assignedTo"))
            .or_else(|| string_opt(&requested, "owner"))
            .and_then(|identifier| find_session_agent_id_for_identifier(oma, &identifier))
            .ok_or_else(|| format!("work package {id} needs an active assigneeSessionAgentId"))?;
        let title = string_opt(&requested, "title")
            .unwrap_or_else(|| format!("Work package {}", index + 1));
        let task = string_opt(&requested, "task")
            .or_else(|| string_opt(&requested, "description"))
            .unwrap_or_else(|| title.clone());
        let dependencies = requested
            .get("dependencies")
            .or_else(|| requested.get("dependsOn"))
            .and_then(Value::as_array)
            .map(|items| {
                items
                    .iter()
                    .filter_map(Value::as_str)
                    .map(str::to_string)
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        packages.push(json!({
            "id": id,
            "title": title,
            "task": task,
            "assigneeSessionAgentId": assignee,
            "dependencies": dependencies,
            "acceptanceCriteria": requested.get("acceptanceCriteria").or_else(|| requested.get("acceptance")).cloned().unwrap_or_else(|| json!([])),
            "deliverable": requested.get("deliverable").cloned().unwrap_or(Value::Null),
            "status": "queued",
            "summary": Value::Null,
            "failureReason": Value::Null,
            "replanCount": 0,
        }));
    }
    for package in &packages {
        for dependency in package
            .get("dependencies")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
        {
            if !ids.contains(dependency) {
                return Err(format!(
                    "work package {} depends on unknown package {dependency}",
                    package
                        .get("id")
                        .and_then(Value::as_str)
                        .unwrap_or("unknown")
                ));
            }
        }
    }
    Ok(packages)
}

fn validate_oma_work_package_contract(_oma: &Value, work_packages: &[Value]) -> Result<(), String> {
    for package in work_packages {
        let id = package
            .get("id")
            .and_then(Value::as_str)
            .unwrap_or("unknown");
        let acceptance_present = package
            .get("acceptanceCriteria")
            .is_some_and(non_empty_contract_value);
        let deliverable_present = package
            .get("deliverable")
            .is_some_and(non_empty_contract_value);
        if !acceptance_present || !deliverable_present {
            return Err(format!(
                "work package {id} requires non-empty acceptanceCriteria and deliverable"
            ));
        }
    }

    Ok(())
}

fn non_empty_contract_value(value: &Value) -> bool {
    match value {
        Value::String(text) => !text.trim().is_empty(),
        Value::Array(items) => !items.is_empty(),
        Value::Object(object) => !object.is_empty(),
        _ => false,
    }
}

fn oma_work_package_role<'a>(oma: &'a Value, package: &Value) -> Option<&'a str> {
    let assignee = package
        .get("assigneeSessionAgentId")
        .and_then(Value::as_str)?;
    oma.get("agents")
        .and_then(Value::as_array)?
        .iter()
        .find(|agent| {
            agent.get("id").and_then(Value::as_str) == Some(assignee)
                || agent.get("sessionAgentId").and_then(Value::as_str) == Some(assignee)
        })
        .and_then(|agent| agent.get("role"))
        .and_then(Value::as_str)
}

fn package_id(package: &Value) -> &str {
    package
        .get("id")
        .and_then(Value::as_str)
        .unwrap_or_default()
}

fn package_dependencies(package: &Value) -> HashSet<&str> {
    package
        .get("dependencies")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .collect()
}

fn oma_team_plan_markdown(title: &str, summary: &str, work_packages: &[Value]) -> String {
    let packages = work_packages
        .iter()
        .map(|package| {
            let dependencies = package
                .get("dependencies")
                .and_then(Value::as_array)
                .filter(|items| !items.is_empty())
                .map(|items| {
                    format!(
                        " Depends on: {}.",
                        items
                            .iter()
                            .filter_map(Value::as_str)
                            .collect::<Vec<_>>()
                            .join(", ")
                    )
                })
                .unwrap_or_default();
            format!(
                "- **{}** — owner `{}`. {}{}",
                package
                    .get("title")
                    .and_then(Value::as_str)
                    .unwrap_or("Work package"),
                package
                    .get("assigneeSessionAgentId")
                    .and_then(Value::as_str)
                    .unwrap_or("unassigned"),
                package
                    .get("task")
                    .and_then(Value::as_str)
                    .unwrap_or_default(),
                dependencies
            )
        })
        .collect::<Vec<_>>()
        .join("\n");
    format!("# {title}\n\n{summary}\n\n## Work packages\n{packages}")
}

fn oma_work_package_todo(package: &Value) -> Value {
    json!({
        "id": package["id"].clone(),
        "content": package["title"].clone(),
        "status": "pending",
        "priority": "normal",
        "blockedBy": package["dependencies"].clone(),
        "assignedTo": package["assigneeSessionAgentId"].clone(),
    })
}

fn tool_oma_create_role(session_id: &str, input: &Value) -> super::tools::NativeToolResult {
    let name = string_opt(input, "name").ok_or_else(|| {
        super::tools::NativeToolFailure::new(
            "missing_name",
            "Creating an Oma role requires a name.",
            "Provide name, role, description, and prompt.",
        )
    })?;
    let role = string_opt(input, "role").unwrap_or_else(|| "specialist".to_string());
    let description = string_opt(input, "description").unwrap_or_else(|| role.clone());
    let prompt = string_opt(input, "prompt").ok_or_else(|| {
        super::tools::NativeToolFailure::new(
            "missing_prompt",
            "Creating an Oma role requires a sealed main prompt.",
            "Provide the role's focused prompt in prompt.",
        )
    })?;
    let temporary = input
        .get("temporary")
        .and_then(Value::as_bool)
        .unwrap_or(true);
    let delegation = input
        .get("delegation")
        .cloned()
        .and_then(|value| serde_json::from_value::<AgentPackageDelegation>(value).ok())
        .unwrap_or_else(|| AgentPackageDelegation {
            specialties: vec![role.clone()],
            accepted_work: vec![description.clone()],
            deliverables: Vec::new(),
            collaboration_hints: Vec::new(),
        });
    let (callback, snapshot, agent) = {
        let mut state = state().lock().map_err(|_| {
            super::tools::NativeToolFailure::new(
                "state_lock_failed",
                "agent runtime state lock failed",
                "Retry after the current runtime operation finishes.",
            )
        })?;
        let host_session_id = state
            .sessions
            .get(session_id)
            .and_then(|session| session.snapshot.pointer("/oma/parentSessionId"))
            .and_then(Value::as_str)
            .unwrap_or(session_id)
            .to_string();
        let root = state.root.clone();
        let source = state
            .sessions
            .get(session_id)
            .and_then(|session| session.snapshot.pointer("/oma/executingSessionAgentId"))
            .and_then(Value::as_str)
            .map(str::to_string)
            .ok_or_else(|| {
                super::tools::NativeToolFailure::new(
                    "lead_required",
                    "Only Lyra Lead can create an Oma role.",
                    "Have Lyra Lead propose the role in the Team Plan.",
                )
            })?;
        let work_package_id = state
            .sessions
            .get(session_id)
            .and_then(|session| session.snapshot.pointer("/oma/executingWorkPackageId"))
            .and_then(Value::as_str)
            .map(str::to_string)
            .ok_or_else(|| {
                super::tools::NativeToolFailure::new(
                    "approved_team_plan_required",
                    "Creating an Oma role must be an approved Lead work package.",
                    "Add the staffing change to the Team Plan, then create the role after approval.",
                )
            })?;
        let session = state.sessions.get_mut(&host_session_id).ok_or_else(|| {
            super::tools::NativeToolFailure::new(
                "session_not_found",
                format!("session not found: {host_session_id}"),
                "Retry in an active Oma session.",
            )
        })?;
        ensure_oma_channel_message_contexts(&mut session.snapshot);
        let oma = session.snapshot.get_mut("oma").ok_or_else(|| {
            super::tools::NativeToolFailure::new(
                "oma_required",
                "Oma state is required.",
                "Switch the session to Oma mode before creating a role.",
            )
        })?;
        if lead_session_agent_id(oma).as_deref() != Some(source.as_str()) {
            return Err(super::tools::NativeToolFailure::new(
                "lead_required",
                "Only Lyra Lead can create a role.",
                "Use the Lead's Team Plan to propose staffing changes.",
            ));
        }
        let staffing_is_approved = oma
            .get("team")
            .filter(|team| team.get("status").and_then(Value::as_str) == Some("executing"))
            .and_then(|team| team.get("workPackages"))
            .and_then(Value::as_array)
            .and_then(|packages| {
                packages.iter().find(|package| {
                    package.get("id").and_then(Value::as_str) == Some(work_package_id.as_str())
                })
            })
            .is_some_and(|package| {
                package
                    .get("assigneeSessionAgentId")
                    .and_then(Value::as_str)
                    == Some(source.as_str())
                    && matches!(
                        package.get("status").and_then(Value::as_str),
                        Some("queued" | "running")
                    )
            });
        if !staffing_is_approved {
            return Err(super::tools::NativeToolFailure::new(
                "approved_team_plan_required",
                "Creating an Oma role requires an approved Lead staffing work package.",
                "Update the Team Plan with a Lead-owned staffing package and request approval.",
            ));
        }
        let agent_id = format!("did:lyra:agent:local:{}", Uuid::new_v4());
        let package = json!({
            "agentId": agent_id,
            "packageVersion": "1.0.0",
            "name": name,
            "shortName": name.chars().take(12).collect::<String>(),
            "role": role,
            "description": description,
            "profile": { "facts": [] },
            "delegation": delegation,
            "avatar": { "kind": "text", "value": name.chars().next().unwrap_or('A').to_string() },
            "prompt": prompt,
            "builtIn": false,
            "source": "lead_local",
            "temporary": false,
        });
        if !temporary {
            let mut packages = read_oma_local_packages(&root);
            packages.push(package.clone());
            write_oma_local_packages(&root, packages).map_err(|error| {
                super::tools::NativeToolFailure::new(
                    "registry_save_failed",
                    error.to_string(),
                    "Retry after the local Agent Package Registry is writable.",
                )
            })?;
        }
        let mut agent = session_agent_from_available_package(&package);
        agent["source"] = json!(if temporary {
            "lead_temporary"
        } else {
            "lead_local"
        });
        agent["temporary"] = json!(temporary);
        let session_agent_id = agent["id"]
            .as_str()
            .expect("session Agent id exists")
            .to_string();
        oma["agents"]
            .as_array_mut()
            .expect("Oma agents is an array")
            .push(agent.clone());
        add_agent_to_default_group(oma, &session_agent_id);
        ensure_direct_channel(oma, &session_agent_id);
        if !temporary {
            oma["localPackages"] = json!(read_oma_local_packages(&root));
            oma["availableAgents"] =
                json!(oma_available_agent_registry(Some(&oma["localPackages"])));
        }
        touch_session(session);
        let snapshot = session.snapshot.clone();
        let callback = event_callback();
        state.save_state().map_err(|error| {
            super::tools::NativeToolFailure::new(
                "save_failed",
                error.to_string(),
                "Retry after the session can be saved.",
            )
        })?;
        (callback, snapshot, agent)
    };
    emit_with_callback(
        &callback,
        json!({
            "kind": "omaRoleCreated",
            "sessionId": session_id,
            "agent": agent,
        }),
    );
    emit_with_callback(
        &callback,
        json!({ "kind": "sessionSnapshot", "snapshot": snapshot }),
    );
    Ok(super::tools::NativeToolSuccess {
        content: if temporary {
            "Created a temporary Oma role for this session.".to_string()
        } else {
            "Created a local reusable Oma role package for this session.".to_string()
        },
        raw: json!({ "agent": agent, "temporary": temporary }),
        recommended_next_action: Some(
            "Assign the new role only through an approved Team Plan when it has execution work."
                .to_string(),
        ),
    })
}

fn tool_oma_send(session_id: &str, input: &Value) -> super::tools::NativeToolResult {
    let text = string_opt(input, "text")
        .or_else(|| string_opt(input, "message"))
        .ok_or_else(|| {
            super::tools::NativeToolFailure::new(
                "missing_message",
                "Oma send requires text.",
                "Retry with a text field.",
            )
        })?;
    queue_oma_agent_work(session_id, input, text, "agent_send")
}

fn tool_oma_handoff(session_id: &str, input: &Value) -> super::tools::NativeToolResult {
    let target_agent_id = string_opt(input, "targetAgentId").ok_or_else(|| {
        super::tools::NativeToolFailure::new(
            "missing_target_agent",
            "Oma handoff requires targetAgentId.",
            "Retry with targetAgentId.",
        )
    })?;
    let text = string_opt(input, "text")
        .or_else(|| string_opt(input, "message"))
        .unwrap_or_else(|| "Continue this task from the handoff context.".to_string());
    let mut queued = input.clone();
    queued["targetSessionAgentIds"] = json!([target_agent_id]);
    queue_oma_agent_work(session_id, &queued, text, "agent_handoff")
}

fn queue_oma_agent_work(
    session_id: &str,
    input: &Value,
    text: String,
    kind: &str,
) -> super::tools::NativeToolResult {
    let requested_targets = string_array(input, "targetSessionAgentIds");
    let requested_targets = if requested_targets.is_empty() {
        string_array(input, "targetAgentIds")
    } else {
        requested_targets
    };
    let mut state = state().lock().map_err(|_| {
        super::tools::NativeToolFailure::new(
            "state_lock_failed",
            "agent runtime state lock failed",
            "Retry after the current runtime operation finishes.",
        )
    })?;
    let host_session_id = state
        .sessions
        .get(session_id)
        .and_then(|session| session.snapshot.pointer("/oma/parentSessionId"))
        .and_then(Value::as_str)
        .unwrap_or(session_id)
        .to_string();
    let session = state.sessions.get_mut(&host_session_id).ok_or_else(|| {
        super::tools::NativeToolFailure::new(
            "session_not_found",
            format!("session not found: {host_session_id}"),
            "Retry in an active Oma session.",
        )
    })?;
    if session.snapshot.get("agentMode").and_then(Value::as_str) != Some("oma") {
        return Err(super::tools::NativeToolFailure::new(
            "oma_required",
            "Session is not in Oma mode.",
            "Switch the session to Oma mode before using /tools/agent/*.",
        ));
    }
    ensure_oma_channel_message_contexts(&mut session.snapshot);
    let (source, targets) = {
        let oma = session.snapshot.get("oma").ok_or_else(|| {
            super::tools::NativeToolFailure::new(
                "oma_required",
                "Oma state is required.",
                "Switch the session to Oma mode before using /tools/agent/*.",
            )
        })?;
        let source = string_opt(input, "sourceSessionAgentId")
            .or_else(|| string_opt(input, "sourceAgentId"))
            .and_then(|id| find_session_agent_id_for_identifier(oma, &id))
            .or_else(|| {
                oma.get("executingSessionAgentId")
                    .and_then(Value::as_str)
                    .map(str::to_string)
            })
            .or_else(|| lead_session_agent_id(oma))
            .ok_or_else(|| {
                super::tools::NativeToolFailure::new(
                    "agent_not_active",
                    "No active Oma source Agent is available.",
                    "Retry after the Oma roster is restored.",
                )
            })?;
        let targets = requested_targets
            .iter()
            .filter_map(|id| find_session_agent_id_for_identifier(oma, id))
            .collect::<Vec<_>>();
        (source, targets)
    };
    if targets.is_empty() {
        return Err(super::tools::NativeToolFailure::new(
            "missing_target_agent",
            "Oma send or handoff requires targetAgentIds.",
            "Retry with an active target Agent from the current Oma roster.",
        ));
    }
    for target in &targets {
        {
            let oma = session
                .snapshot
                .get_mut("oma")
                .expect("validated Oma state");
            ensure_direct_channel(oma, target);
        }
        let channel_id = direct_channel_id(target);
        let mut message = user_message(text.clone(), Vec::new(), now());
        message["metadata"] = json!({
            "oma": {
                "channelId": channel_id,
                "sender": "agent",
                "senderAgentId": source,
                "targetSessionAgentIds": [target],
                "kind": kind,
            }
        });
        push_oma_message_to_channel(&mut session.snapshot, &channel_id, message).map_err(
            |error| {
                super::tools::NativeToolFailure::new(
                    "message_store_failed",
                    error.to_string(),
                    "Retry after the Oma channel context is repaired.",
                )
            },
        )?;
        let oma = session
            .snapshot
            .get_mut("oma")
            .expect("validated Oma state");
        if !oma["pendingAgentTurns"].is_array() {
            oma["pendingAgentTurns"] = json!([]);
        }
        oma["pendingAgentTurns"]
            .as_array_mut()
            .expect("pending turn array")
            .push(json!({
                    "channelId": channel_id,
                    "sessionAgentId": target,
            }));
    }
    touch_session(session);
    state.save_state().map_err(|error| {
        super::tools::NativeToolFailure::new(
            "save_failed",
            error.to_string(),
            "Retry after the session can be saved.",
        )
    })?;
    Ok(super::tools::NativeToolSuccess {
        content: "Oma Agent work was queued in the target private channel.".to_string(),
        raw: json!({ "targetSessionAgentIds": targets }),
        recommended_next_action: None,
    })
}

#[cfg(test)]
mod design_workflow_tests {
    use super::*;

    fn oma_fixture() -> Value {
        json!({
            "agents": [
                { "id": "designer", "role": "design" },
                { "id": "builder", "role": "implementation" },
                { "id": "reviewer", "role": "review" }
            ]
        })
    }

    fn work_package(id: &str, assignee: &str, dependencies: &[&str], task: &str) -> Value {
        json!({
            "id": id,
            "title": id,
            "task": task,
            "assigneeSessionAgentId": assignee,
            "dependencies": dependencies,
            "acceptanceCriteria": ["verified"],
            "deliverable": "evidence package"
        })
    }

    #[test]
    fn oma_work_packages_require_acceptance_and_deliverables() {
        let mut package = work_package("research", "designer", &[], "Research references");
        package["acceptanceCriteria"] = json!([]);
        let error = validate_oma_work_package_contract(&oma_fixture(), &[package])
            .expect_err("empty acceptance criteria must be rejected");
        assert!(error.contains("acceptanceCriteria"));
    }

    #[test]
    fn session_agent_id_migration_rekeys_private_provider_ledgers() {
        let mut snapshot = json!({
            "oma": {
                "agents": [{
                    "id": "legacy-agent",
                    "sessionAgentId": "session-agent",
                    "agentId": "did:lyra:agent:test"
                }],
                "privateProviderContextsByAgent": {
                    "legacy-agent": {
                        "user-1": { "renderedTail": "private tail" }
                    }
                },
                "privateProviderMetadataByAgent": {
                    "legacy-agent": {
                        "assistant-1": { "openaiResponsesReplay": ["private replay"] }
                    }
                }
            }
        });

        migrate_oma_session_agent_ids(&mut snapshot);

        for key in [
            "privateProviderContextsByAgent",
            "privateProviderMetadataByAgent",
        ] {
            let ledger = snapshot
                .pointer(&format!("/oma/{key}"))
                .and_then(Value::as_object)
                .expect("private provider ledger");
            assert!(ledger.get("legacy-agent").is_none());
            assert!(ledger.get("session-agent").is_some());
        }
    }

    #[test]
    fn removing_agent_clears_its_private_provider_ledgers() {
        let mut oma = json!({
            "channels": [{
                "id": "direct:removed-agent",
                "memberAgentIds": ["removed-agent"]
            }],
            "channelContexts": {
                "direct:removed-agent": { "messages": [] }
            },
            "privateProviderContextsByAgent": {
                "removed-agent": { "user-1": { "renderedTail": "private tail" } },
                "kept-agent": { "user-2": { "renderedTail": "kept tail" } }
            },
            "privateProviderMetadataByAgent": {
                "removed-agent": { "assistant-1": { "providerTranscript": ["private"] } },
                "kept-agent": { "assistant-2": { "providerTranscript": ["kept"] } }
            }
        });

        remove_agent_from_channels(&mut oma, "removed-agent");

        assert!(
            oma.pointer("/privateProviderContextsByAgent/removed-agent")
                .is_none()
        );
        assert!(
            oma.pointer("/privateProviderMetadataByAgent/removed-agent")
                .is_none()
        );
        assert!(
            oma.pointer("/privateProviderContextsByAgent/kept-agent")
                .is_some()
        );
        assert!(
            oma.pointer("/privateProviderMetadataByAgent/kept-agent")
                .is_some()
        );
    }
}
