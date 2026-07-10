use super::*;
use lyra_runtime_protocol::AgentPackageManifest;

pub(crate) const OMA_DEFAULT_CHANNEL_ID: &str = "group:default";
const OMA_LEAD_ID: &str = "did:lyra:agent:builtin:lead";
const OMA_DEFAULTS_VERSION: u64 = 5;

pub(crate) struct EmbeddedOmaPackage {
    manifest: &'static str,
    prompt: &'static str,
    avatar_svg: &'static str,
}

include!(concat!(env!("OUT_DIR"), "/oma_package_catalog.rs"));

#[derive(Clone)]
pub(crate) struct BuiltinOmaPackage {
    pub(crate) manifest: AgentPackageManifest,
    pub(crate) prompt: &'static str,
    pub(crate) avatar_svg: &'static str,
}

pub(crate) fn builtin_oma_packages() -> &'static [BuiltinOmaPackage] {
    static PACKAGES: OnceLock<Vec<BuiltinOmaPackage>> = OnceLock::new();
    PACKAGES
        .get_or_init(|| {
            EMBEDDED_OMA_PACKAGES
                .iter()
                .map(|embedded| BuiltinOmaPackage {
                    manifest: serde_json::from_str(embedded.manifest)
                        .expect("build.rs validates embedded Oma package manifests"),
                    prompt: embedded.prompt,
                    avatar_svg: embedded.avatar_svg,
                })
                .collect()
        })
        .as_slice()
}

pub(crate) fn new_session_agent_fields(snapshot: &mut Value) {
    snapshot["agentMode"] = json!("solo");
    snapshot["oma"] = Value::Null;
    snapshot["modeContexts"] = json!({});
}

pub(crate) fn initialize_oma_session(snapshot: &mut Value) {
    snapshot["agentMode"] = json!("oma");
    snapshot["oma"] = default_oma_state();
    ensure_oma_channel_message_contexts(snapshot);
}

pub(crate) fn set_agent_mode(payload: Value) -> AgentRuntimeResult<Value> {
    let id = required_session_id(&payload)?;
    let mode = string_opt(&payload, "mode")
        .ok_or_else(|| AgentRuntimeError::Core("mode is required".to_string()))?;
    if mode != "solo" && mode != "oma" {
        return Err(AgentRuntimeError::Core(
            "mode must be either solo or oma".to_string(),
        ));
    }
    mutate_session(&id, |session| {
        let current_mode = session
            .snapshot
            .get("agentMode")
            .and_then(Value::as_str)
            .unwrap_or("solo")
            .to_string();
        if current_mode == mode {
            if mode == "oma" {
                let defaults_changed = session
                    .snapshot
                    .get_mut("oma")
                    .is_some_and(ensure_default_oma_agents);
                let had_channel_contexts = session
                    .snapshot
                    .pointer("/oma/channelContexts")
                    .is_some_and(Value::is_object);
                ensure_oma_channel_message_contexts(&mut session.snapshot);
                if defaults_changed || !had_channel_contexts {
                    touch_session(session);
                }
            }
            return Ok(session.snapshot.clone());
        }
        if session
            .snapshot
            .get("activeTurnId")
            .and_then(Value::as_str)
            .is_some()
        {
            return Err(AgentRuntimeError::Core(
                "cannot switch agent mode while a turn is running".to_string(),
            ));
        }

        let mut current_context = mode_context_from_snapshot(&session.snapshot);
        let mut contexts = session
            .snapshot
            .get("modeContexts")
            .and_then(Value::as_object)
            .cloned()
            .unwrap_or_default();
        if contexts.is_empty() {
            // Sessions created before modeContexts existed stored both histories in
            // one transcript. Split only the messages we can identify reliably;
            // never carry an Oma message into the Solo context (or vice versa).
            let other_mode = if current_mode == "oma" { "solo" } else { "oma" };
            let messages = session
                .snapshot
                .get("messages")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            current_context["messages"] = Value::Array(
                messages
                    .iter()
                    .filter(|message| message_belongs_to_mode(message, &current_mode))
                    .cloned()
                    .collect(),
            );
            let mut other_context = new_mode_context(other_mode);
            other_context["messages"] = Value::Array(
                messages
                    .iter()
                    .filter(|message| message_belongs_to_mode(message, other_mode))
                    .cloned()
                    .collect(),
            );
            contexts.insert(other_mode.to_string(), other_context);
        }
        contexts.insert(current_mode, current_context);
        let next_context = contexts
            .get(&mode)
            .cloned()
            .filter(Value::is_object)
            .unwrap_or_else(|| new_mode_context(&mode));
        session.snapshot["modeContexts"] = Value::Object(contexts);
        restore_mode_context(&mut session.snapshot, next_context);
        session.snapshot["agentMode"] = json!(mode);
        if mode == "oma" {
            if let Some(oma) = session.snapshot.get_mut("oma") {
                ensure_default_oma_agents(oma);
            }
            ensure_oma_channel_message_contexts(&mut session.snapshot);
        }
        touch_session(session);
        Ok(session.snapshot.clone())
    })
}

fn mode_context_from_snapshot(snapshot: &Value) -> Value {
    let Some(values) = snapshot.as_object() else {
        return json!({});
    };
    Value::Object(
        values
            .iter()
            .filter(|(key, _)| !is_shared_session_field(key))
            .map(|(key, value)| (key.clone(), value.clone()))
            .collect(),
    )
}

fn restore_mode_context(snapshot: &mut Value, context: Value) {
    let Some(snapshot_values) = snapshot.as_object_mut() else {
        return;
    };
    snapshot_values.retain(|key, _| is_shared_session_field(key));
    if let Some(context_values) = context.as_object() {
        snapshot_values.extend(context_values.clone());
    }
}

fn is_shared_session_field(key: &str) -> bool {
    matches!(
        key,
        "id" | "title"
            | "sessionKind"
            | "workingDir"
            | "projectBound"
            | "workingDirIsHome"
            | "agentMode"
            | "modeContexts"
            | "updatedAt"
    )
}

fn new_mode_context(mode: &str) -> Value {
    json!({
        "messages": [],
        "tools": [],
        "todos": [],
        "turnStatus": "idle",
        "activeTurnId": Value::Null,
        "follow": { "running": false, "activity": Value::Null },
        "sessionResilience": {
            "blockedBrowser": Value::Null,
            "updatedAt": Value::Null
        },
        "taskMilestones": [],
        "memory": Value::Null,
        "oma": if mode == "oma" { default_oma_state() } else { Value::Null }
    })
}

fn message_belongs_to_mode(message: &Value, mode: &str) -> bool {
    let is_oma = message
        .pointer("/metadata/oma")
        .is_some_and(Value::is_object);
    (mode == "oma") == is_oma
}

pub(crate) fn add_oma_agent(payload: Value) -> AgentRuntimeResult<Value> {
    let id = required_session_id(&payload)?;
    let agent_id = string_opt(&payload, "agentId")
        .ok_or_else(|| AgentRuntimeError::Core("agentId is required".to_string()))?;
    mutate_oma_session(&id, |oma| {
        let package = builtin_oma_packages()
            .iter()
            .find(|package| package.manifest.agent_id == agent_id)
            .ok_or_else(|| AgentRuntimeError::Core(format!("unknown Oma agent: {agent_id}")))?;
        let agents = oma["agents"]
            .as_array_mut()
            .ok_or_else(|| AgentRuntimeError::Core("oma.agents is invalid".to_string()))?;
        if !agents
            .iter()
            .any(|agent| agent.get("agentId").and_then(Value::as_str) == Some(agent_id.as_str()))
        {
            agents.push(builtin_agent_to_value(package));
        }
        let session_agent_id =
            find_session_agent_id_for_package(oma, &agent_id).expect("Oma agent was just added");
        add_agent_to_default_group(oma, &session_agent_id);
        ensure_direct_channel(oma, &session_agent_id);
        Ok(())
    })
}

pub(crate) fn remove_oma_agent(payload: Value) -> AgentRuntimeResult<Value> {
    let id = required_session_id(&payload)?;
    let agent_id = string_opt(&payload, "agentId")
        .ok_or_else(|| AgentRuntimeError::Core("agentId is required".to_string()))?;
    mutate_oma_session(&id, |oma| {
        let session_agent_id = find_session_agent_id_for_identifier(oma, &agent_id)
            .ok_or_else(|| AgentRuntimeError::Core(format!("unknown Oma agent: {agent_id}")))?;
        if oma_agent_is_running(oma, &session_agent_id) {
            return Err(AgentRuntimeError::Core(
                "agent is running; cancel or wait before removing it".to_string(),
            ));
        }
        if is_lead_session_agent(oma, &session_agent_id) {
            return Err(AgentRuntimeError::Core(
                "Lyra Lead cannot be removed from an Oma session".to_string(),
            ));
        }
        let agents = oma["agents"]
            .as_array_mut()
            .ok_or_else(|| AgentRuntimeError::Core("oma.agents is invalid".to_string()))?;
        agents.retain(|agent| {
            agent.get("id").and_then(Value::as_str) != Some(session_agent_id.as_str())
        });
        remove_agent_from_channels(oma, &session_agent_id);
        if active_channel_missing_or_archived(oma) {
            oma["activeChannelId"] = json!(OMA_DEFAULT_CHANNEL_ID);
        }
        Ok(())
    })
}

pub(crate) fn set_oma_active_channel(payload: Value) -> AgentRuntimeResult<Value> {
    let id = required_session_id(&payload)?;
    let channel_id = string_opt(&payload, "channelId")
        .ok_or_else(|| AgentRuntimeError::Core("channelId is required".to_string()))?;
    mutate_session(&id, |session| {
        if session.snapshot.get("agentMode").and_then(Value::as_str) != Some("oma") {
            return Err(AgentRuntimeError::Core(
                "session is not in Oma mode".to_string(),
            ));
        }
        ensure_oma_channel_message_contexts(&mut session.snapshot);
        let oma = session
            .snapshot
            .get("oma")
            .ok_or_else(|| AgentRuntimeError::Core("oma state is required".to_string()))?;
        let channel = channel(oma, &channel_id)
            .ok_or_else(|| AgentRuntimeError::Core(format!("channel not found: {channel_id}")))?;
        if channel
            .get("archived")
            .and_then(Value::as_bool)
            .unwrap_or(false)
        {
            return Err(AgentRuntimeError::Core(
                "archived channel cannot be activated".to_string(),
            ));
        }
        activate_oma_channel(&mut session.snapshot, &channel_id)?;
        touch_session(session);
        Ok(session.snapshot.clone())
    })
}

pub(crate) fn apply_oma_user_turn(
    session: &mut NativeSession,
    payload: &Value,
    text: &str,
    user_message: &mut Value,
) -> AgentRuntimeResult<()> {
    if session.snapshot.get("agentMode").and_then(Value::as_str) != Some("oma") {
        return Ok(());
    }
    ensure_oma_channel_message_contexts(&mut session.snapshot);
    let oma = session
        .snapshot
        .get_mut("oma")
        .ok_or_else(|| AgentRuntimeError::Core("oma state is required in Oma mode".to_string()))?;
    let channel_id = string_opt(payload, "channelId")
        .or_else(|| {
            oma.get("activeChannelId")
                .and_then(Value::as_str)
                .map(str::to_string)
        })
        .unwrap_or_else(|| OMA_DEFAULT_CHANNEL_ID.to_string());
    if oma.get("activeChannelId").and_then(Value::as_str) != Some(channel_id.as_str()) {
        return Err(AgentRuntimeError::Core(
            "send the turn from the active Oma channel".to_string(),
        ));
    }
    let channel = channel(&oma, &channel_id)
        .ok_or_else(|| AgentRuntimeError::Core(format!("channel not found: {channel_id}")))?
        .clone();
    if channel
        .get("archived")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        return Err(AgentRuntimeError::Core(
            "archived channel cannot receive messages".to_string(),
        ));
    }
    let mentions = structured_oma_mentions(&oma, payload, text)?;
    let members = channel_member_ids(&channel);
    if let Some(agent_id) = mentions
        .iter()
        .filter_map(|mention| mention.get("sessionAgentId").and_then(Value::as_str))
        .find(|agent_id| !members.iter().any(|member| member == agent_id))
    {
        return Err(AgentRuntimeError::Core(format!(
            "mentioned Oma agent is not a member of this channel: {agent_id}"
        )));
    }
    if channel_id != OMA_DEFAULT_CHANNEL_ID && !mentions.is_empty() {
        return Err(AgentRuntimeError::Core(
            "Oma @ assignments are available only in the default group".to_string(),
        ));
    }
    let target_agent_ids = route_target_agents(&oma, &channel, &mentions);
    for agent_id in &target_agent_ids {
        set_agent_status(&mut *oma, agent_id, "queued");
    }
    let assignments = oma_assignments_for_mentions(text, &mentions);
    let metadata = json!({
        "channelId": channel_id,
        "sender": "user",
        "mentions": mentions,
        "assignments": assignments,
        "targetSessionAgentIds": target_agent_ids,
    });
    merge_oma_metadata(user_message, metadata);
    oma["turnChannelId"] = json!(channel_id);
    Ok(())
}

pub(crate) fn oma_runtime_context_for_prompt(
    snapshot: &Value,
    messages: &[Value],
) -> Option<Value> {
    if snapshot.get("agentMode").and_then(Value::as_str) != Some("oma") {
        return None;
    }
    let oma = snapshot.get("oma")?.clone();
    let latest_turn = messages
        .iter()
        .rev()
        .find(|message| message.get("role").and_then(Value::as_str) == Some("user"))
        .and_then(|message| message.pointer("/metadata/oma").cloned())
        .unwrap_or(Value::Null);
    Some(json!({
        "mode": "oma",
        "state": oma,
        "latestTurn": latest_turn,
    }))
}

pub(crate) fn oma_messages_for_active_channel(snapshot: &Value, messages: &[Value]) -> Vec<Value> {
    if snapshot.get("agentMode").and_then(Value::as_str) != Some("oma") {
        return messages.to_vec();
    }
    // Oma keeps only the active channel in snapshot.messages. Other channels
    // live in oma.channelContexts and are swapped in atomically on selection.
    messages.to_vec()
}

pub(crate) fn oma_prompt_message(context: &Value) -> Option<Value> {
    let state = context.get("state")?;
    let latest_turn = context.get("latestTurn").cloned().unwrap_or(Value::Null);
    let active_channel_id = latest_turn
        .get("channelId")
        .and_then(Value::as_str)
        .or_else(|| state.get("activeChannelId").and_then(Value::as_str))
        .unwrap_or(OMA_DEFAULT_CHANNEL_ID);
    let target_ids = latest_turn
        .get("targetSessionAgentIds")
        .and_then(Value::as_array)
        .map(|ids| {
            ids.iter()
                .filter_map(Value::as_str)
                .collect::<Vec<_>>()
                .join(", ")
        })
        .unwrap_or_default();
    let assignment = state
        .get("executingAssignment")
        .cloned()
        .or_else(|| {
            let executing = state
                .get("executingSessionAgentId")
                .and_then(Value::as_str)?;
            latest_turn
                .get("assignments")
                .and_then(Value::as_array)?
                .iter()
                .find(|assignment| {
                    assignment.get("sessionAgentId").and_then(Value::as_str) == Some(executing)
                })
                .cloned()
        })
        .unwrap_or(Value::Null);
    let selected_agent = state
        .get("executingSessionAgentId")
        .and_then(Value::as_str)
        .or_else(|| {
            latest_turn
                .get("targetSessionAgentIds")
                .and_then(Value::as_array)
                .and_then(|ids| ids.first())
                .and_then(Value::as_str)
        })
        .and_then(|id| {
            state
                .get("agents")
                .and_then(Value::as_array)?
                .iter()
                .find(|agent| agent.get("id").and_then(Value::as_str) == Some(id))
        });
    let selected_agent = selected_agent.or_else(|| {
        lead_session_agent_id(state).and_then(|lead_id| {
            state
                .get("agents")
                .and_then(Value::as_array)?
                .iter()
                .find(|agent| agent.get("id").and_then(Value::as_str) == Some(lead_id.as_str()))
        })
    });
    let identity = selected_agent
        .map(|agent| {
            format!(
                "{} ({})\n{}",
                agent
                    .get("name")
                    .and_then(Value::as_str)
                    .unwrap_or("Oma Agent"),
                agent
                    .get("role")
                    .and_then(Value::as_str)
                    .unwrap_or("specialist"),
                agent
                    .get("prompt")
                    .and_then(Value::as_str)
                    .unwrap_or_default(),
            )
        })
        .unwrap_or_else(|| "Lyra Lead (lead)".to_string());
    Some(json!({
        "role": "system",
        "content": format!(
            "Oma mode is active (Oh My Agents). This is an isolated channel worker, not the Solo assistant.\n\nYour sealed identity:\n{identity}\n\nCurrent channel: {active_channel_id}. Routed target agent ids: {target_ids}.\n\nYour assignment for this turn (if present):\n{}\n\nRules: speak only as your sealed identity. Never simulate a response from another Agent, even if several ids are listed; use the Agent communication tools to ask or hand off instead. A direct channel contains only that Agent's private conversation. In the default group, make your own contribution and identify uncertainty rather than fabricating consensus. @mentions are authoritative. /tools/agent/ask runs a target package and returns its real private-channel reply; send and handoff queue private follow-up work for the unified executor.",
            serde_json::to_string_pretty(&assignment).unwrap_or_else(|_| "{}".to_string())
        )
    }))
}

pub(crate) fn oma_finish_metadata(snapshot: &Value, metadata: Option<Value>) -> Option<Value> {
    if snapshot.get("agentMode").and_then(Value::as_str) != Some("oma") {
        return metadata;
    }
    let latest_oma = snapshot
        .get("messages")
        .and_then(Value::as_array)
        .and_then(|messages| {
            messages
                .iter()
                .rev()
                .find(|message| message.get("role").and_then(Value::as_str) == Some("user"))
        })
        .and_then(|message| message.pointer("/metadata/oma"))
        .cloned()
        .unwrap_or_else(|| json!({ "channelId": OMA_DEFAULT_CHANNEL_ID }));
    let target_ids = latest_oma
        .get("targetSessionAgentIds")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let sender_agent_id = if target_ids.len() == 1 {
        target_ids.first().cloned().unwrap_or(Value::Null)
    } else {
        Value::Null
    };
    let mut oma = latest_oma;
    oma["sender"] = json!("agent");
    oma["senderAgentId"] = sender_agent_id;
    merge_metadata(metadata, json!({ "oma": oma }))
}

pub(crate) fn oma_mark_turn_finished(session: &mut NativeSession) {
    let Some(oma) = session.snapshot.get_mut("oma") else {
        return;
    };
    oma["turnChannelId"] = Value::Null;
    for agent in oma
        .get_mut("agents")
        .and_then(Value::as_array_mut)
        .into_iter()
        .flatten()
    {
        agent["status"] = json!("idle");
    }
}

pub(crate) fn tool_oma_agent(
    session_id: &str,
    turn_id: &str,
    input: &Value,
) -> super::tools::NativeToolResult {
    let action = input
        .get("action")
        .and_then(Value::as_str)
        .unwrap_or_default();
    match action {
        "ask" => tool_oma_ask(session_id, turn_id, input),
        "send" => tool_oma_send(session_id, input),
        "handoff" => tool_oma_handoff(session_id, input),
        _ => Err(super::tools::NativeToolFailure::new(
            "unsupported_oma_agent_action",
            format!("Unsupported Oma agent action: {action}"),
            "Use send, ask, or handoff.",
        )),
    }
}

fn tool_oma_ask(session_id: &str, turn_id: &str, input: &Value) -> super::tools::NativeToolResult {
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
    let (source, targets) = {
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
        (source, targets)
    };
    let replies = targets
        .iter()
        .map(|target| {
            super::run_oma_direct_ask(session_id, turn_id, &source, target, text.clone())
                .map(|reply| json!({ "sessionAgentId": target, "reply": reply }))
        })
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| {
            super::tools::NativeToolFailure::new(
                "oma_ask_failed",
                error.to_string(),
                "Retry after the target Agent's direct channel is available.",
            )
        })?;
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

fn default_oma_state() -> Value {
    let agents = builtin_oma_packages()
        .iter()
        .map(builtin_agent_to_value)
        .collect::<Vec<_>>();
    let available_agents = builtin_oma_packages()
        .iter()
        .map(builtin_available_agent_to_value)
        .collect::<Vec<_>>();
    let member_agent_ids = agents
        .iter()
        .filter_map(|agent| agent.get("id").and_then(Value::as_str))
        .map(|id| Value::String(id.to_string()))
        .collect::<Vec<_>>();
    let mut channels = vec![json!({
        "id": OMA_DEFAULT_CHANNEL_ID,
        "kind": "group",
        "name": "Oma",
        "memberAgentIds": member_agent_ids,
        "createdBy": "system",
        "archived": false,
    })];
    for agent in &agents {
        if let Some(session_agent_id) = agent.get("id").and_then(Value::as_str) {
            channels.push(direct_channel_value(agent, session_agent_id));
        }
    }
    json!({
        "defaultsVersion": OMA_DEFAULTS_VERSION,
        "enabled": true,
        "activeChannelId": OMA_DEFAULT_CHANNEL_ID,
        "agents": agents,
        "availableAgents": available_agents,
        "channels": channels,
        "channelContexts": {},
    })
}

fn ensure_default_oma_agents(oma: &mut Value) -> bool {
    oma["availableAgents"] = Value::Array(
        builtin_oma_packages()
            .iter()
            .map(builtin_available_agent_to_value)
            .collect(),
    );
    let must_restore_lead = lead_session_agent_id(oma).is_none();
    let needs_default_upgrade = !oma
        .get("defaultsVersion")
        .and_then(Value::as_u64)
        .is_some_and(|version| version >= OMA_DEFAULTS_VERSION);
    let definitions_changed = refresh_builtin_oma_agent_definitions(oma);
    if !needs_default_upgrade && !must_restore_lead {
        return definitions_changed;
    }
    let missing = builtin_oma_packages()
        .iter()
        .filter(|agent| {
            (needs_default_upgrade || agent.manifest.agent_id == OMA_LEAD_ID)
                && find_session_agent_id_for_package(oma, &agent.manifest.agent_id).is_none()
        })
        .collect::<Vec<_>>();
    if let Some(agents) = oma.get_mut("agents").and_then(Value::as_array_mut) {
        agents.extend(missing.iter().map(|agent| builtin_agent_to_value(agent)));
    }
    for agent in missing {
        let session_agent_id = find_session_agent_id_for_package(oma, &agent.manifest.agent_id)
            .expect("new Oma agent is present");
        add_agent_to_default_group(oma, &session_agent_id);
        ensure_direct_channel(oma, &session_agent_id);
    }
    oma["defaultsVersion"] = json!(OMA_DEFAULTS_VERSION);
    true
}

fn refresh_builtin_oma_agent_definitions(oma: &mut Value) -> bool {
    let Some(agents) = oma.get_mut("agents").and_then(Value::as_array_mut) else {
        return false;
    };
    let mut changed = false;
    for agent in agents {
        let Some(agent_id) = agent.get("agentId").and_then(Value::as_str) else {
            continue;
        };
        let Some(package) = builtin_oma_packages()
            .iter()
            .find(|package| package.manifest.agent_id == agent_id)
        else {
            continue;
        };
        let status = agent
            .get("status")
            .cloned()
            .unwrap_or_else(|| json!("idle"));
        let id = agent
            .get("id")
            .cloned()
            .unwrap_or_else(|| json!(Uuid::new_v4().to_string()));
        let mut builtin = builtin_agent_to_value(package);
        builtin["id"] = id.clone();
        builtin["sessionAgentId"] = id;
        if agent.get("builtIn").and_then(Value::as_bool) != Some(true)
            || agent.get("prompt") != builtin.get("prompt")
            || agent.get("name") != builtin.get("name")
            || agent.get("shortName") != builtin.get("shortName")
            || agent.get("role") != builtin.get("role")
            || agent.get("avatar") != builtin.get("avatar")
        {
            *agent = builtin;
            agent["status"] = status;
            changed = true;
        }
    }
    changed
}

fn builtin_agent_to_value(agent: &BuiltinOmaPackage) -> Value {
    let session_agent_id = Uuid::new_v4().to_string();
    json!({
        "id": session_agent_id,
        "sessionAgentId": session_agent_id,
        "agentId": agent.manifest.agent_id,
        "packageVersion": agent.manifest.version,
        "name": agent.manifest.name,
        "shortName": agent.manifest.short_name,
        "role": agent.manifest.role,
        "description": agent.manifest.description,
        "profile": agent.manifest.profile,
        "avatar": {
            "kind": "svg",
            "value": agent.manifest.short_name.chars().next().unwrap_or('A').to_string(),
            "src": agent.avatar_svg,
        },
        "prompt": agent.prompt,
        "status": "idle",
        "builtIn": true,
    })
}

fn builtin_available_agent_to_value(agent: &BuiltinOmaPackage) -> Value {
    json!({
        "id": agent.manifest.agent_id,
        "agentId": agent.manifest.agent_id,
        "packageVersion": agent.manifest.version,
        "name": agent.manifest.name,
        "shortName": agent.manifest.short_name,
        "role": agent.manifest.role,
        "description": agent.manifest.description,
        "profile": agent.manifest.profile,
        "avatar": {
            "kind": "svg",
            "value": agent.manifest.short_name.chars().next().unwrap_or('A').to_string(),
            "src": agent.avatar_svg,
        },
        "prompt": agent.prompt,
        "status": "idle",
        "builtIn": true,
    })
}

fn direct_channel_value(agent: &Value, session_agent_id: &str) -> Value {
    json!({
        "id": direct_channel_id(session_agent_id),
        "kind": "direct",
        "name": agent.get("shortName").and_then(Value::as_str).unwrap_or("Agent"),
        "memberAgentIds": [session_agent_id],
        "createdBy": "system",
        "archived": false,
    })
}

pub(crate) fn direct_channel_id(session_agent_id: &str) -> String {
    format!("direct:{session_agent_id}")
}

fn mutate_oma_session(
    id: &str,
    mutate: impl FnOnce(&mut Value) -> AgentRuntimeResult<()>,
) -> AgentRuntimeResult<Value> {
    mutate_session(id, |session| {
        if session.snapshot.get("agentMode").and_then(Value::as_str) != Some("oma") {
            return Err(AgentRuntimeError::Core(
                "session is not in Oma mode".to_string(),
            ));
        }
        ensure_oma_channel_message_contexts(&mut session.snapshot);
        let active_channel_id = session
            .snapshot
            .pointer("/oma/activeChannelId")
            .and_then(Value::as_str)
            .unwrap_or(OMA_DEFAULT_CHANNEL_ID)
            .to_string();
        let oma = session
            .snapshot
            .get_mut("oma")
            .ok_or_else(|| AgentRuntimeError::Core("oma state is required".to_string()))?;
        mutate(oma)?;
        let next_channel_id = oma
            .get("activeChannelId")
            .and_then(Value::as_str)
            .unwrap_or(OMA_DEFAULT_CHANNEL_ID)
            .to_string();
        if next_channel_id != active_channel_id {
            activate_oma_channel(&mut session.snapshot, &next_channel_id)?;
        }
        touch_session(session);
        Ok(session.snapshot.clone())
    })
}

const OMA_CHANNEL_CONTEXT_KEYS: &[&str] = &[
    "messages",
    "tools",
    "todos",
    "memory",
    "promptRuntimeContract",
    "promptDelivery",
    "tokenEstimate",
    "tokenEstimateAtMs",
];

fn empty_oma_channel_context() -> Value {
    json!({
        "messages": [],
        "tools": [],
        "todos": [],
        "memory": Value::Null,
        "promptRuntimeContract": Value::Null,
        "promptDelivery": Value::Null,
        "tokenEstimate": Value::Null,
        "tokenEstimateAtMs": Value::Null,
    })
}

fn take_oma_channel_context(snapshot: &mut Value) -> Value {
    let mut context = empty_oma_channel_context();
    let Some(snapshot_fields) = snapshot.as_object_mut() else {
        return context;
    };
    let Some(context_fields) = context.as_object_mut() else {
        return context;
    };
    for key in OMA_CHANNEL_CONTEXT_KEYS {
        if let Some(value) = snapshot_fields.remove(*key) {
            context_fields.insert((*key).to_string(), value);
        }
    }
    context
}

fn restore_oma_channel_context(snapshot: &mut Value, context: Value) {
    let Some(snapshot_fields) = snapshot.as_object_mut() else {
        return;
    };
    let values = context.as_object();
    for key in OMA_CHANNEL_CONTEXT_KEYS {
        let value = values
            .and_then(|fields| fields.get(*key))
            .cloned()
            .unwrap_or_else(|| empty_oma_channel_context()[*key].clone());
        snapshot_fields.insert((*key).to_string(), value);
    }
}

fn channel_context_messages_mut(context: &mut Value) -> &mut Vec<Value> {
    context["messages"]
        .as_array_mut()
        .expect("Oma channel context messages is an array")
}

fn invalidate_context_token_estimate(context: &mut Value) {
    context["tokenEstimate"] = Value::Null;
    context["tokenEstimateAtMs"] = Value::Null;
}

fn ensure_oma_channel_message_contexts(snapshot: &mut Value) {
    migrate_oma_session_agent_ids(snapshot);
    discard_legacy_oma_scheduling(snapshot);
    if let Some(oma) = snapshot.get_mut("oma") {
        ensure_default_oma_agents(oma);
    }
    let contexts_are_current = snapshot
        .pointer("/oma/channelContexts")
        .and_then(Value::as_object)
        .is_some_and(|contexts| contexts.values().all(Value::is_object));
    if contexts_are_current {
        discard_legacy_custom_groups(snapshot);
        return;
    }
    let active_channel_id = snapshot
        .pointer("/oma/activeChannelId")
        .and_then(Value::as_str)
        .unwrap_or(OMA_DEFAULT_CHANNEL_ID)
        .to_string();
    let mut active_context = take_oma_channel_context(snapshot);
    let messages = active_context["messages"].take();
    let mut contexts = serde_json::Map::new();
    if let Some(existing) = snapshot
        .pointer("/oma/channelContexts")
        .and_then(Value::as_object)
    {
        for (channel_id, value) in existing {
            let normalized = if value.is_array() {
                let mut context = empty_oma_channel_context();
                context["messages"] = value.clone();
                context
            } else {
                value.clone()
            };
            contexts.insert(channel_id.clone(), normalized);
        }
    }
    for message in messages.as_array().into_iter().flatten().cloned() {
        let channel_id = message
            .pointer("/metadata/oma/channelId")
            .and_then(Value::as_str)
            .unwrap_or(OMA_DEFAULT_CHANNEL_ID)
            .to_string();
        if channel_id == active_channel_id {
            channel_context_messages_mut(&mut active_context).push(message);
        } else {
            let context = contexts
                .entry(channel_id)
                .or_insert_with(empty_oma_channel_context);
            channel_context_messages_mut(context).push(message);
            invalidate_context_token_estimate(context);
        }
    }
    if let Some(oma) = snapshot.get_mut("oma") {
        contexts.remove(&active_channel_id);
        oma["channelContexts"] = Value::Object(contexts);
    }
    invalidate_context_token_estimate(&mut active_context);
    restore_oma_channel_context(snapshot, active_context);
    discard_legacy_custom_groups(snapshot);
}

fn discard_legacy_oma_scheduling(snapshot: &mut Value) {
    strip_oma_scheduling_metadata(snapshot.get_mut("messages"));
    let Some(oma) = snapshot.get_mut("oma") else {
        return;
    };
    if let Some(fields) = oma.as_object_mut() {
        fields.remove("schedulingMode");
    }
    for context in oma
        .get_mut("channelContexts")
        .and_then(Value::as_object_mut)
        .into_iter()
        .flat_map(|contexts| contexts.values_mut())
    {
        strip_oma_scheduling_metadata(context.get_mut("messages"));
    }
}

fn strip_oma_scheduling_metadata(messages: Option<&mut Value>) {
    for message in messages.and_then(Value::as_array_mut).into_iter().flatten() {
        if let Some(oma) = message
            .get_mut("metadata")
            .and_then(Value::as_object_mut)
            .and_then(|metadata| metadata.get_mut("oma"))
            .and_then(Value::as_object_mut)
        {
            oma.remove("schedulingMode");
        }
    }
}

fn migrate_oma_session_agent_ids(snapshot: &mut Value) {
    let mut remap = HashMap::new();
    let Some(agents) = snapshot
        .pointer_mut("/oma/agents")
        .and_then(Value::as_array_mut)
    else {
        return;
    };
    for agent in agents {
        let stable_id = agent
            .get("agentId")
            .and_then(Value::as_str)
            .or_else(|| agent.get("id").and_then(Value::as_str))
            .map(str::to_string);
        let Some(stable_id) = stable_id else {
            continue;
        };
        let legacy_id = agent
            .get("id")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        let session_id = agent
            .get("sessionAgentId")
            .and_then(Value::as_str)
            .filter(|id| !id.is_empty() && *id != stable_id)
            .map(str::to_string)
            .unwrap_or_else(|| Uuid::new_v4().to_string());
        if legacy_id != session_id {
            remap.insert(legacy_id, session_id.clone());
        }
        agent["id"] = json!(session_id);
        agent["sessionAgentId"] = agent["id"].clone();
        agent["agentId"] = json!(stable_id);
    }
    if remap.is_empty() {
        return;
    }
    let direct_channel_remap = remap
        .iter()
        .flat_map(|(old, new)| {
            let legacy_slug = old.rsplit(':').next().unwrap_or(old);
            [
                (direct_channel_id(old), direct_channel_id(new)),
                (format!("direct:{legacy_slug}"), direct_channel_id(new)),
            ]
        })
        .collect::<HashMap<_, _>>();
    remap_oma_ids_in_value(snapshot, &remap, &direct_channel_remap);
    if let Some(contexts) = snapshot
        .pointer_mut("/oma/channelContexts")
        .and_then(Value::as_object_mut)
    {
        for (old, new) in &direct_channel_remap {
            if let Some(context) = contexts.remove(old) {
                contexts.insert(new.clone(), context);
            }
        }
    }
}

fn remap_oma_ids_in_value(
    value: &mut Value,
    agent_remap: &HashMap<String, String>,
    channel_remap: &HashMap<String, String>,
) {
    match value {
        Value::Array(items) => {
            for item in items {
                remap_oma_ids_in_value(item, agent_remap, channel_remap);
            }
        }
        Value::Object(fields) => {
            for key in ["memberAgentIds", "targetAgentIds"] {
                if let Some(items) = fields.get_mut(key).and_then(Value::as_array_mut) {
                    for item in items {
                        if let Some(old) = item.as_str()
                            && let Some(new) = agent_remap.get(old)
                        {
                            *item = json!(new);
                        }
                    }
                }
            }
            for key in ["id", "sessionAgentId", "senderAgentId"] {
                if let Some(item) = fields.get_mut(key)
                    && let Some(old) = item.as_str()
                    && let Some(new) = agent_remap.get(old)
                {
                    *item = json!(new);
                }
            }
            for key in ["id", "channelId", "activeChannelId"] {
                if let Some(item) = fields.get_mut(key)
                    && let Some(old) = item.as_str()
                    && let Some(new) = channel_remap.get(old)
                {
                    *item = json!(new);
                }
            }
            for item in fields.values_mut() {
                remap_oma_ids_in_value(item, agent_remap, channel_remap);
            }
        }
        _ => {}
    }
}

fn discard_legacy_custom_groups(snapshot: &mut Value) {
    let obsolete = snapshot
        .pointer("/oma/channels")
        .and_then(Value::as_array)
        .map(|channels| {
            channels
                .iter()
                .filter(|channel| {
                    channel.get("kind").and_then(Value::as_str) == Some("group")
                        && channel.get("id").and_then(Value::as_str) != Some(OMA_DEFAULT_CHANNEL_ID)
                })
                .filter_map(|channel| channel.get("id").and_then(Value::as_str))
                .map(str::to_string)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    if obsolete.is_empty() {
        return;
    }
    let active_channel_id = snapshot
        .pointer("/oma/activeChannelId")
        .and_then(Value::as_str)
        .unwrap_or(OMA_DEFAULT_CHANNEL_ID)
        .to_string();
    let active_was_obsolete = obsolete.iter().any(|id| id == &active_channel_id);
    if active_was_obsolete {
        let _ = take_oma_channel_context(snapshot);
    } else if let Some(messages) = snapshot.get_mut("messages").and_then(Value::as_array_mut) {
        messages.retain(|message| {
            !message
                .pointer("/metadata/oma/channelId")
                .and_then(Value::as_str)
                .is_some_and(|channel_id| obsolete.iter().any(|id| id == channel_id))
        });
    }
    let next_context = {
        let Some(oma) = snapshot.get_mut("oma") else {
            return;
        };
        if let Some(channels) = oma.get_mut("channels").and_then(Value::as_array_mut) {
            channels.retain(|channel| {
                !channel
                    .get("id")
                    .and_then(Value::as_str)
                    .is_some_and(|id| obsolete.iter().any(|obsolete_id| obsolete_id == id))
            });
        }
        if active_was_obsolete {
            oma["activeChannelId"] = json!(OMA_DEFAULT_CHANNEL_ID);
        }
        let Some(contexts) = oma
            .get_mut("channelContexts")
            .and_then(Value::as_object_mut)
        else {
            return;
        };
        for channel_id in &obsolete {
            contexts.remove(channel_id);
        }
        if active_was_obsolete {
            contexts
                .remove(OMA_DEFAULT_CHANNEL_ID)
                .unwrap_or_else(empty_oma_channel_context)
        } else {
            empty_oma_channel_context()
        }
    };
    if active_was_obsolete {
        restore_oma_channel_context(snapshot, next_context);
    }
}

pub(crate) fn activate_oma_channel(
    snapshot: &mut Value,
    channel_id: &str,
) -> AgentRuntimeResult<()> {
    ensure_oma_channel_message_contexts(snapshot);
    let active_channel_id = snapshot
        .pointer("/oma/activeChannelId")
        .and_then(Value::as_str)
        .unwrap_or(OMA_DEFAULT_CHANNEL_ID)
        .to_string();
    if active_channel_id == channel_id {
        return Ok(());
    }
    let active_context = take_oma_channel_context(snapshot);
    let next_context = {
        let oma = snapshot
            .get_mut("oma")
            .ok_or_else(|| AgentRuntimeError::Core("oma state is required".to_string()))?;
        oma["activeChannelId"] = json!(channel_id);
        let contexts = oma["channelContexts"]
            .as_object_mut()
            .ok_or_else(|| AgentRuntimeError::Core("oma.channelContexts is invalid".to_string()))?;
        contexts.insert(active_channel_id, active_context);
        contexts
            .remove(channel_id)
            .unwrap_or_else(empty_oma_channel_context)
    };
    restore_oma_channel_context(snapshot, next_context);
    Ok(())
}

fn invalidate_oma_channel_token_estimate(snapshot: &mut Value) {
    if let Some(fields) = snapshot.as_object_mut() {
        fields.remove("tokenEstimate");
        fields.remove("tokenEstimateAtMs");
    }
}

pub(crate) fn push_oma_message_to_channel(
    snapshot: &mut Value,
    channel_id: &str,
    message: Value,
) -> AgentRuntimeResult<bool> {
    ensure_oma_channel_message_contexts(snapshot);
    let active_channel_id = snapshot
        .pointer("/oma/activeChannelId")
        .and_then(Value::as_str)
        .unwrap_or(OMA_DEFAULT_CHANNEL_ID);
    if active_channel_id == channel_id {
        push_array(snapshot, "messages", message);
        invalidate_oma_channel_token_estimate(snapshot);
        return Ok(true);
    }
    let oma = snapshot
        .get_mut("oma")
        .ok_or_else(|| AgentRuntimeError::Core("oma state is required".to_string()))?;
    oma["channelContexts"]
        .as_object_mut()
        .ok_or_else(|| AgentRuntimeError::Core("oma.channelContexts is invalid".to_string()))?
        .entry(channel_id.to_string())
        .or_insert_with(empty_oma_channel_context);
    let context = oma["channelContexts"]
        .get_mut(channel_id)
        .expect("inserted Oma channel context");
    channel_context_messages_mut(context).push(message);
    invalidate_context_token_estimate(context);
    Ok(false)
}

pub(crate) fn oma_assignment_for_agent(snapshot: &Value, session_agent_id: &str) -> Value {
    snapshot
        .get("messages")
        .and_then(Value::as_array)
        .and_then(|messages| {
            messages
                .iter()
                .rev()
                .find(|message| message.get("role").and_then(Value::as_str) == Some("user"))
        })
        .and_then(|message| message.pointer("/metadata/oma/assignments"))
        .and_then(Value::as_array)
        .and_then(|assignments| {
            assignments.iter().find(|assignment| {
                assignment.get("sessionAgentId").and_then(Value::as_str) == Some(session_agent_id)
            })
        })
        .cloned()
        .unwrap_or(Value::Null)
}

pub(crate) fn set_oma_execution_assignment(snapshot: &mut Value, assignment: Value) {
    if let Some(oma) = snapshot.get_mut("oma") {
        oma["executingAssignment"] = assignment;
    }
}

pub(crate) fn set_oma_execution_parent_status(execution_session_id: &str, status: &str) {
    let (callback, snapshot) = {
        let Ok(mut state) = state().lock() else {
            return;
        };
        let Some(execution) = state.sessions.get(execution_session_id) else {
            return;
        };
        let Some(parent_session_id) = execution
            .snapshot
            .pointer("/oma/parentSessionId")
            .and_then(Value::as_str)
            .map(str::to_string)
        else {
            return;
        };
        let Some(session_agent_id) = execution
            .snapshot
            .pointer("/oma/executingSessionAgentId")
            .and_then(Value::as_str)
            .map(str::to_string)
        else {
            return;
        };
        let callback = state.event_callback.clone();
        let Some(parent) = state.sessions.get_mut(&parent_session_id) else {
            return;
        };
        if let Some(oma) = parent.snapshot.get_mut("oma") {
            set_agent_status(oma, &session_agent_id, status);
        }
        touch_session(parent);
        let snapshot = parent.snapshot.clone();
        let _ = state.save_state();
        (callback, snapshot)
    };
    emit_with_callback(
        &callback,
        json!({ "kind": "sessionSnapshot", "snapshot": snapshot }),
    );
}

pub(crate) fn merge_oma_execution_channel_context(
    snapshot: &mut Value,
    channel_id: &str,
    execution_snapshot: &Value,
) -> AgentRuntimeResult<()> {
    ensure_oma_channel_message_contexts(snapshot);
    let source = OMA_CHANNEL_CONTEXT_KEYS
        .iter()
        .map(|key| ((*key).to_string(), execution_snapshot.get(*key).cloned()))
        .collect::<Vec<_>>();
    let active_channel_id = snapshot
        .pointer("/oma/activeChannelId")
        .and_then(Value::as_str)
        .unwrap_or(OMA_DEFAULT_CHANNEL_ID)
        .to_string();
    if active_channel_id == channel_id {
        merge_oma_execution_context_fields(snapshot, &source);
        return Ok(());
    }
    let oma = snapshot
        .get_mut("oma")
        .ok_or_else(|| AgentRuntimeError::Core("oma state is required".to_string()))?;
    let contexts = oma["channelContexts"]
        .as_object_mut()
        .ok_or_else(|| AgentRuntimeError::Core("oma.channelContexts is invalid".to_string()))?;
    let target = contexts
        .entry(channel_id.to_string())
        .or_insert_with(empty_oma_channel_context);
    merge_oma_execution_context_fields(target, &source);
    Ok(())
}

fn merge_oma_execution_context_fields(target: &mut Value, source: &[(String, Option<Value>)]) {
    for key in ["tools", "todos"] {
        let Some(source_values) = source
            .iter()
            .find(|(source_key, _)| source_key == key)
            .and_then(|(_, value)| value.as_ref())
            .and_then(Value::as_array)
        else {
            continue;
        };
        let target_values = target[key]
            .as_array_mut()
            .expect("Oma context arrays are valid");
        for candidate in source_values {
            let candidate_id = candidate.get("id").and_then(Value::as_str);
            let exists = target_values.iter().any(|existing| {
                candidate_id
                    .map(|id| existing.get("id").and_then(Value::as_str) == Some(id))
                    .unwrap_or_else(|| existing == candidate)
            });
            if !exists {
                target_values.push(candidate.clone());
            }
        }
    }
    for key in [
        "memory",
        "promptRuntimeContract",
        "promptDelivery",
        "tokenEstimate",
        "tokenEstimateAtMs",
    ] {
        if let Some(value) = source
            .iter()
            .find(|(source_key, _)| source_key == key)
            .and_then(|(_, value)| value.clone())
        {
            target[key] = value;
        }
    }
}

pub(crate) fn oma_turn_targets(snapshot: &Value) -> Option<(String, Vec<String>)> {
    let oma = snapshot.get("oma")?;
    let channel_id = oma
        .get("turnChannelId")
        .and_then(Value::as_str)
        .or_else(|| oma.get("activeChannelId").and_then(Value::as_str))?
        .to_string();
    let active_channel_id = oma
        .get("activeChannelId")
        .and_then(Value::as_str)
        .unwrap_or(OMA_DEFAULT_CHANNEL_ID);
    let messages = if active_channel_id == channel_id {
        snapshot.get("messages").and_then(Value::as_array)?
    } else {
        oma.pointer(&format!("/channelContexts/{channel_id}/messages"))
            .and_then(Value::as_array)?
    };
    let targets = messages
        .iter()
        .rev()
        .find(|message| message.get("role").and_then(Value::as_str) == Some("user"))?
        .pointer("/metadata/oma/targetSessionAgentIds")
        .and_then(Value::as_array)?
        .iter()
        .filter_map(Value::as_str)
        .map(str::to_string)
        .collect::<Vec<_>>();
    Some((channel_id, targets))
}

pub(crate) fn set_oma_execution_agent(snapshot: &mut Value, session_agent_id: Option<&str>) {
    if let Some(oma) = snapshot.get_mut("oma") {
        oma["executingSessionAgentId"] = session_agent_id.map_or(Value::Null, Value::from);
    }
}

pub(crate) fn take_pending_oma_turns(snapshot: &mut Value) -> Vec<(String, String)> {
    snapshot
        .pointer_mut("/oma/pendingAgentTurns")
        .and_then(Value::as_array_mut)
        .map(std::mem::take)
        .unwrap_or_default()
        .into_iter()
        .filter_map(|entry| {
            Some((
                entry.get("channelId")?.as_str()?.to_string(),
                entry.get("sessionAgentId")?.as_str()?.to_string(),
            ))
        })
        .collect()
}

fn string_array(payload: &Value, key: &str) -> Vec<String> {
    payload
        .get(key)
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default()
}

fn channel<'a>(oma: &'a Value, channel_id: &str) -> Option<&'a Value> {
    oma.get("channels")
        .and_then(Value::as_array)?
        .iter()
        .find(|channel| channel.get("id").and_then(Value::as_str) == Some(channel_id))
}

fn channel_mut<'a>(oma: &'a mut Value, channel_id: &str) -> Option<&'a mut Value> {
    oma.get_mut("channels")
        .and_then(Value::as_array_mut)?
        .iter_mut()
        .find(|channel| channel.get("id").and_then(Value::as_str) == Some(channel_id))
}

fn active_channel_missing_or_archived(oma: &Value) -> bool {
    let active = oma
        .get("activeChannelId")
        .and_then(Value::as_str)
        .unwrap_or(OMA_DEFAULT_CHANNEL_ID);
    channel(oma, active)
        .map(|channel| {
            channel
                .get("archived")
                .and_then(Value::as_bool)
                .unwrap_or(false)
        })
        .unwrap_or(true)
}

fn active_agent_ids(oma: &Value) -> Vec<String> {
    oma.get("agents")
        .and_then(Value::as_array)
        .map(|agents| {
            agents
                .iter()
                .filter_map(|agent| agent.get("id").and_then(Value::as_str))
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default()
}

fn find_session_agent_id_for_package(oma: &Value, agent_id: &str) -> Option<String> {
    oma.get("agents")
        .and_then(Value::as_array)?
        .iter()
        .find(|agent| agent.get("agentId").and_then(Value::as_str) == Some(agent_id))
        .and_then(|agent| agent.get("id").and_then(Value::as_str))
        .map(str::to_string)
}

fn find_session_agent_id_for_identifier(oma: &Value, identifier: &str) -> Option<String> {
    active_agent_ids(oma)
        .into_iter()
        .find(|id| id == identifier)
        .or_else(|| find_session_agent_id_for_package(oma, identifier))
}

fn lead_session_agent_id(oma: &Value) -> Option<String> {
    find_session_agent_id_for_package(oma, OMA_LEAD_ID)
}

fn is_lead_session_agent(oma: &Value, session_agent_id: &str) -> bool {
    lead_session_agent_id(oma).as_deref() == Some(session_agent_id)
}

fn structured_oma_mentions(
    oma: &Value,
    payload: &Value,
    text: &str,
) -> AgentRuntimeResult<Vec<Value>> {
    let supplied = payload
        .get("omaMentions")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    if supplied.is_empty() {
        return Ok(Vec::new());
    }
    let by_mention_id = supplied
        .iter()
        .filter_map(|mention| {
            let mention_id = mention.get("mentionId")?.as_str()?.trim();
            let session_agent_id = mention.get("sessionAgentId")?.as_str()?.trim();
            let agent_id = mention.get("agentId")?.as_str()?.trim();
            (!mention_id.is_empty() && !session_agent_id.is_empty() && !agent_id.is_empty())
                .then_some((
                    mention_id.to_string(),
                    (session_agent_id.to_string(), agent_id.to_string()),
                ))
        })
        .collect::<HashMap<_, _>>();
    if by_mention_id.len() != supplied.len() {
        return Err(AgentRuntimeError::Core(
            "invalid structured Oma mention payload".to_string(),
        ));
    }
    let marker_ids = oma_mention_marker_ids_in_order(text)?;
    if marker_ids.is_empty() {
        return Err(AgentRuntimeError::Core(
            "structured Oma mentions require matching inline markers".to_string(),
        ));
    }
    let mut mentions = Vec::new();
    for mention_id in marker_ids {
        let Some((session_agent_id, agent_id)) = by_mention_id.get(&mention_id) else {
            return Err(AgentRuntimeError::Core(
                "Oma mention marker has no matching structured payload".to_string(),
            ));
        };
        let agent = oma
            .get("agents")
            .and_then(Value::as_array)
            .and_then(|agents| {
                agents.iter().find(|agent| {
                    agent.get("id").and_then(Value::as_str) == Some(session_agent_id)
                        && agent.get("agentId").and_then(Value::as_str) == Some(agent_id)
                })
            })
            .ok_or_else(|| {
                AgentRuntimeError::Core(
                    "structured Oma mention does not reference an active Agent".to_string(),
                )
            })?;
        mentions.push(json!({
            "mentionId": mention_id,
            "sessionAgentId": session_agent_id,
            "agentId": agent_id,
            "name": agent.get("name").cloned().unwrap_or(Value::String("Oma Agent".to_string())),
            "shortName": agent.get("shortName").cloned().unwrap_or(Value::Null),
            "role": agent.get("role").cloned().unwrap_or(Value::String("specialist".to_string())),
            "avatar": agent.get("avatar").cloned().unwrap_or(Value::Null),
        }));
    }
    Ok(mentions)
}

fn oma_mention_marker_ids_in_order(text: &str) -> AgentRuntimeResult<Vec<String>> {
    const PREFIX: &str = "⟦oma-agent:";
    let mut ids = Vec::new();
    let mut rest = text;
    while let Some(start) = rest.find(PREFIX) {
        let marker = &rest[start + PREFIX.len()..];
        let Some(end) = marker.find('⟧') else {
            return Err(AgentRuntimeError::Core(
                "unterminated Oma mention marker".to_string(),
            ));
        };
        let id = marker[..end].trim();
        if id.is_empty() {
            return Err(AgentRuntimeError::Core(
                "Oma mention marker id is empty".to_string(),
            ));
        }
        ids.push(id.to_string());
        rest = &marker[end + '⟧'.len_utf8()..];
    }
    Ok(ids)
}

fn oma_assignments_for_mentions(text: &str, mentions: &[Value]) -> Vec<Value> {
    let mut markers = Vec::new();
    let mut cursor = 0;
    for mention in mentions {
        let Some(mention_id) = mention.get("mentionId").and_then(Value::as_str) else {
            continue;
        };
        let marker = format!("⟦oma-agent:{mention_id}⟧");
        let Some(relative_start) = text[cursor..].find(&marker) else {
            continue;
        };
        let start = cursor + relative_start;
        markers.push((start, start + marker.len(), mention.clone()));
        cursor = start + marker.len();
    }
    let common_preamble = markers
        .first()
        .map(|(start, _, _)| text[..*start].trim().to_string())
        .unwrap_or_else(|| text.trim().to_string());
    let full_text = markers
        .iter()
        .fold(text.to_string(), |acc, (_, _, mention)| {
            let marker = mention
                .get("mentionId")
                .and_then(Value::as_str)
                .map(|id| format!("⟦oma-agent:{id}⟧"))
                .unwrap_or_default();
            let display = mention
                .get("shortName")
                .and_then(Value::as_str)
                .or_else(|| mention.get("name").and_then(Value::as_str))
                .unwrap_or("Agent");
            acc.replace(&marker, &format!("@{display}"))
        });
    let mut by_agent = HashMap::<String, usize>::new();
    let mut assignments = Vec::<Value>::new();
    for (index, (_, end, mention)) in markers.iter().enumerate() {
        let next = markers
            .get(index + 1)
            .map(|(start, _, _)| *start)
            .unwrap_or(text.len());
        let task = text[*end..next].trim();
        let Some(session_agent_id) = mention.get("sessionAgentId").and_then(Value::as_str) else {
            continue;
        };
        if let Some(existing) = by_agent.get(session_agent_id).copied() {
            assignments[existing]["taskParts"]
                .as_array_mut()
                .expect("Oma task parts is an array")
                .push(json!(task));
            continue;
        }
        let position = assignments.len();
        by_agent.insert(session_agent_id.to_string(), position);
        assignments.push(json!({
            "sessionAgentId": session_agent_id,
            "agentId": mention.get("agentId").cloned().unwrap_or(Value::Null),
            "name": mention.get("name").cloned().unwrap_or(Value::Null),
            "role": mention.get("role").cloned().unwrap_or(Value::Null),
            "commonPreamble": common_preamble,
            "fullText": full_text,
            "taskParts": [task],
        }));
    }
    for assignment in &mut assignments {
        let task = assignment["taskParts"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .filter(|part| !part.is_empty())
            .collect::<Vec<_>>()
            .join("\n\n");
        assignment["task"] = json!(task);
    }
    assignments
}

fn route_target_agents(oma: &Value, channel: &Value, mentions: &[Value]) -> Vec<String> {
    let mut seen = HashSet::new();
    let mentioned = mentions
        .iter()
        .filter_map(|mention| mention.get("sessionAgentId").and_then(Value::as_str))
        .filter(|session_agent_id| seen.insert((*session_agent_id).to_string()))
        .map(str::to_string)
        .collect::<Vec<_>>();
    if !mentioned.is_empty() {
        return mentioned;
    }
    let channel_members = channel_member_ids(channel);
    if channel.get("kind").and_then(Value::as_str) == Some("direct") {
        return channel_members;
    }
    if let Some(lead_id) = lead_session_agent_id(oma)
        && channel_members.iter().any(|agent_id| agent_id == &lead_id)
    {
        vec![lead_id]
    } else {
        channel_members.into_iter().take(1).collect()
    }
}

fn channel_member_ids(channel: &Value) -> Vec<String> {
    channel
        .get("memberAgentIds")
        .and_then(Value::as_array)
        .map(|members| {
            members
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default()
}

pub(crate) fn set_agent_status(oma: &mut Value, agent_id: &str, status: &str) {
    if let Some(agent) = oma
        .get_mut("agents")
        .and_then(Value::as_array_mut)
        .into_iter()
        .flatten()
        .find(|agent| agent.get("id").and_then(Value::as_str) == Some(agent_id))
    {
        agent["status"] = json!(status);
    }
}

fn oma_agent_is_running(oma: &Value, agent_id: &str) -> bool {
    oma.get("agents")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .any(|agent| {
            agent.get("id").and_then(Value::as_str) == Some(agent_id)
                && agent
                    .get("status")
                    .and_then(Value::as_str)
                    .is_some_and(|status| status != "idle")
        })
}

fn add_agent_to_default_group(oma: &mut Value, agent_id: &str) {
    if let Some(channel) = channel_mut(oma, OMA_DEFAULT_CHANNEL_ID) {
        add_member_to_channel(channel, agent_id);
    }
}

fn add_member_to_channel(channel: &mut Value, agent_id: &str) {
    if !channel.get("memberAgentIds").is_some_and(Value::is_array) {
        channel["memberAgentIds"] = json!([]);
    }
    let Some(members) = channel
        .get_mut("memberAgentIds")
        .and_then(Value::as_array_mut)
    else {
        return;
    };
    if !members
        .iter()
        .any(|member| member.as_str() == Some(agent_id))
    {
        members.push(json!(agent_id));
    }
}

fn ensure_direct_channel(oma: &mut Value, agent_id: &str) {
    let channel_id = direct_channel_id(agent_id);
    if channel(oma, &channel_id).is_some() {
        return;
    }
    let agent = oma
        .get("agents")
        .and_then(Value::as_array)
        .and_then(|agents| {
            agents
                .iter()
                .find(|agent| agent.get("id").and_then(Value::as_str) == Some(agent_id))
        })
        .cloned();
    if let Some(channels) = oma.get_mut("channels").and_then(Value::as_array_mut) {
        if let Some(agent) = agent {
            channels.push(direct_channel_value(&agent, agent_id));
        }
    }
}

fn remove_agent_from_channels(oma: &mut Value, agent_id: &str) {
    let direct_id = direct_channel_id(agent_id);
    if let Some(channels) = oma.get_mut("channels").and_then(Value::as_array_mut) {
        for channel in channels.iter_mut() {
            if let Some(members) = channel
                .get_mut("memberAgentIds")
                .and_then(Value::as_array_mut)
            {
                members.retain(|member| member.as_str() != Some(agent_id));
            }
        }
        channels.retain(|channel| {
            channel.get("id").and_then(Value::as_str) != Some(direct_id.as_str())
        });
    }
    if let Some(contexts) = oma
        .get_mut("channelContexts")
        .and_then(Value::as_object_mut)
    {
        contexts.remove(&direct_id);
    }
}

fn merge_oma_metadata(message: &mut Value, oma_metadata: Value) {
    let current = message
        .get("metadata")
        .cloned()
        .filter(Value::is_object)
        .unwrap_or_else(|| json!({}));
    message["metadata"] =
        merge_metadata(Some(current), json!({ "oma": oma_metadata })).unwrap_or_else(|| json!({}));
}

fn merge_metadata(current: Option<Value>, incoming: Value) -> Option<Value> {
    let mut merged = current
        .filter(Value::is_object)
        .and_then(|value| value.as_object().cloned())
        .unwrap_or_default();
    if let Some(object) = incoming.as_object() {
        for (key, value) in object {
            merged.insert(key.clone(), value.clone());
        }
    }
    if merged.is_empty() {
        None
    } else {
        Some(Value::Object(merged))
    }
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
    let session = state.sessions.get_mut(session_id).ok_or_else(|| {
        super::tools::NativeToolFailure::new(
            "session_not_found",
            format!("session not found: {session_id}"),
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
