use super::*;
use lyra_runtime_protocol::{
    AgentPackageDelegation, AgentPackageManifest, OmaOrganizationMember, OmaOrganizationProjection,
};

pub(crate) const OMA_DEFAULT_CHANNEL_ID: &str = "group:default";
const OMA_LEAD_ID: &str = "did:lyra:agent:builtin:lead";
const OMA_DEFAULTS_VERSION: u64 = 7;
const OMA_LOCAL_PACKAGE_REGISTRY_FILE: &str = "oma-agent-packages.json";
const OMA_LOCAL_PACKAGE_REGISTRY_VERSION: u32 = 1;

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

#[derive(Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct OmaLocalPackageRegistry {
    #[serde(default)]
    schema_version: u32,
    #[serde(default)]
    packages: Vec<Value>,
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
        let package = oma
            .get("availableAgents")
            .and_then(Value::as_array)
            .and_then(|packages| {
                packages.iter().find(|package| {
                    package.get("agentId").and_then(Value::as_str) == Some(&agent_id)
                })
            })
            .cloned()
            .ok_or_else(|| AgentRuntimeError::Core(format!("unknown Oma agent: {agent_id}")))?;
        let agents = oma["agents"]
            .as_array_mut()
            .ok_or_else(|| AgentRuntimeError::Core("oma.agents is invalid".to_string()))?;
        if !agents
            .iter()
            .any(|agent| agent.get("agentId").and_then(Value::as_str) == Some(agent_id.as_str()))
        {
            agents.push(session_agent_from_available_package(&package));
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
    let oma = snapshot.get("oma")?;
    let latest_turn = messages
        .iter()
        .rev()
        .find(|message| message.get("role").and_then(Value::as_str) == Some("user"))
        .and_then(|message| message.pointer("/metadata/oma").cloned())
        .unwrap_or(Value::Null);
    let channel_id = latest_turn
        .get("channelId")
        .and_then(Value::as_str)
        .or_else(|| oma.get("turnChannelId").and_then(Value::as_str))
        .or_else(|| oma.get("activeChannelId").and_then(Value::as_str))
        .unwrap_or(OMA_DEFAULT_CHANNEL_ID);
    let lead_session_agent_id = lead_session_agent_id(oma);
    let executing_agent_id = oma
        .get("executingSessionAgentId")
        .and_then(Value::as_str)
        .or_else(|| {
            latest_turn
                .get("targetSessionAgentIds")
                .and_then(Value::as_array)
                .and_then(|ids| ids.first())
                .and_then(Value::as_str)
        })
        .or_else(|| {
            channel_id
                .strip_prefix("direct:")
                .filter(|id| !id.is_empty())
        })
        .or_else(|| lead_session_agent_id.as_deref());
    let organization = oma_organization_projection(oma, executing_agent_id);
    let assignment = oma
        .get("executingAssignment")
        .cloned()
        .or_else(|| {
            let executing_agent_id = executing_agent_id?;
            latest_turn
                .get("assignments")
                .and_then(Value::as_array)?
                .iter()
                .find(|assignment| {
                    assignment.get("sessionAgentId").and_then(Value::as_str)
                        == Some(executing_agent_id)
                })
                .cloned()
        })
        .unwrap_or(Value::Null);
    Some(json!({
        "mode": "oma",
        "channel": {
            "id": channel_id,
            "kind": if channel_id == OMA_DEFAULT_CHANNEL_ID { "group" } else { "direct" },
        },
        "organization": organization,
        "assignment": assignment,
        "latestTurn": safe_oma_turn_metadata(&latest_turn),
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
    let organization = context.get("organization")?;
    let current_agent = organization.get("currentAgent")?;
    let active_channel_id = context
        .pointer("/channel/id")
        .and_then(Value::as_str)
        .unwrap_or(OMA_DEFAULT_CHANNEL_ID);
    let latest_turn = context.get("latestTurn").cloned().unwrap_or(Value::Null);
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
    let identity = format!(
        "{} ({})\n{}",
        current_agent
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or("Oma Agent"),
        current_agent
            .get("role")
            .and_then(Value::as_str)
            .unwrap_or("specialist"),
        current_agent
            .get("prompt")
            .and_then(Value::as_str)
            .unwrap_or_default(),
    );
    let assignment = context.get("assignment").cloned().unwrap_or(Value::Null);
    let organization_json =
        serde_json::to_string_pretty(organization).unwrap_or_else(|_| "{}".to_string());
    Some(json!({
        "role": "system",
        "content": format!(
            "Oma mode is active (Oh My Agents). This is an isolated channel worker, not the Solo assistant.\n\nYour sealed identity:\n{identity}\n\nCurrent channel: {active_channel_id}. Routed target agent ids: {target_ids}.\n\nPublic organization chart (the only roster data you may use):\n{organization_json}\n\nYour assignment for this turn (if present):\n{}\n\nPrivacy rules: never request, infer, reveal, or claim to see another Agent's private messages, tools, memory, todos, prompts, or token state. A direct channel contains only that Agent's private conversation. In the default group, make your own contribution and identify uncertainty rather than fabricating consensus. @mentions are authoritative. The Lead owns staffing: use the organization chart rather than search to choose current teammates; use /tools/agent/ask for concurrent bounded consultation and /tools/agent/team_plan to publish one approval-gated Team Plan with work packages. /tools/agent/send and handoff queue private follow-up work for the unified executor.",
            serde_json::to_string_pretty(&assignment).unwrap_or_else(|_| "{}".to_string())
        )
    }))
}

fn oma_organization_projection(oma: &Value, current_session_agent_id: Option<&str>) -> Value {
    let members = oma
        .get("agents")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .map(oma_public_member)
        .collect::<Vec<_>>();
    let current_agent = current_session_agent_id.and_then(|id| {
        oma.get("agents")
            .and_then(Value::as_array)?
            .iter()
            .find(|agent| agent.get("id").and_then(Value::as_str) == Some(id))
            .map(|agent| {
                let mut member = oma_public_member(agent);
                member["prompt"] = agent.get("prompt").cloned().unwrap_or(Value::Null);
                member
            })
    });
    let team = oma.get("team").map(safe_oma_team_projection);
    let members = members
        .into_iter()
        .filter_map(|value| serde_json::from_value::<OmaOrganizationMember>(value).ok())
        .collect::<Vec<_>>();
    let mut projection = serde_json::to_value(OmaOrganizationProjection {
        current_agent: None,
        members,
        team,
    })
    .unwrap_or_else(|_| json!({ "members": [] }));
    projection["currentAgent"] = current_agent.unwrap_or(Value::Null);
    projection
}

fn oma_public_member(agent: &Value) -> Value {
    let delegation = agent
        .get("delegation")
        .cloned()
        .and_then(|value| serde_json::from_value::<AgentPackageDelegation>(value).ok())
        .unwrap_or_default();
    serde_json::to_value(OmaOrganizationMember {
        session_agent_id: agent
            .get("id")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
        agent_id: agent
            .get("agentId")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
        name: agent
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or("Oma Agent")
            .to_string(),
        short_name: agent
            .get("shortName")
            .and_then(Value::as_str)
            .unwrap_or("Agent")
            .to_string(),
        role: agent
            .get("role")
            .and_then(Value::as_str)
            .unwrap_or("specialist")
            .to_string(),
        description: agent
            .get("description")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
        status: agent
            .get("status")
            .and_then(Value::as_str)
            .unwrap_or("idle")
            .to_string(),
        source: agent
            .get("source")
            .and_then(Value::as_str)
            .unwrap_or_else(|| {
                if agent.get("builtIn").and_then(Value::as_bool) == Some(true) {
                    "builtin"
                } else {
                    "local"
                }
            })
            .to_string(),
        direct_channel_id: direct_channel_id(
            agent.get("id").and_then(Value::as_str).unwrap_or_default(),
        ),
        delegation,
    })
    .unwrap_or_else(|_| json!({}))
}

fn safe_oma_turn_metadata(turn: &Value) -> Value {
    json!({
        "channelId": turn.get("channelId").cloned().unwrap_or(Value::Null),
        "mentions": turn.get("mentions").cloned().unwrap_or_else(|| json!([])),
        "targetSessionAgentIds": turn.get("targetSessionAgentIds").cloned().unwrap_or_else(|| json!([])),
        "assignments": turn.get("assignments").cloned().unwrap_or_else(|| json!([])),
    })
}

fn safe_oma_team_projection(team: &Value) -> Value {
    json!({
        "id": team.get("id").cloned().unwrap_or(Value::Null),
        "title": team.get("title").cloned().unwrap_or(Value::Null),
        "summary": team.get("summary").cloned().unwrap_or(Value::Null),
        "status": team.get("status").cloned().unwrap_or(Value::Null),
        "workPackages": team.get("workPackages").cloned().unwrap_or_else(|| json!([])),
    })
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
    let busy_agents = oma
        .pointer("/team/workPackages")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter(|package| {
            matches!(
                package.get("status").and_then(Value::as_str),
                Some("queued" | "running" | "retrying")
            )
        })
        .filter_map(|package| {
            package
                .get("assigneeSessionAgentId")
                .and_then(Value::as_str)
                .map(str::to_string)
        })
        .collect::<HashSet<_>>();
    for agent in oma
        .get_mut("agents")
        .and_then(Value::as_array_mut)
        .into_iter()
        .flatten()
    {
        let is_running = matches!(
            agent.get("status").and_then(Value::as_str),
            Some("queued" | "running" | "retrying")
        );
        if is_running
            && !busy_agents.contains(agent.get("id").and_then(Value::as_str).unwrap_or_default())
        {
            agent["status"] = json!("idle");
        }
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
        "team_plan" => tool_oma_team_plan(session_id, turn_id, input),
        "create_role" => tool_oma_create_role(session_id, input),
        _ => Err(super::tools::NativeToolFailure::new(
            "unsupported_oma_agent_action",
            format!("Unsupported Oma agent action: {action}"),
            "Use send, ask, handoff, team_plan, or create_role.",
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
            Box::new(move || {
                super::run_oma_direct_ask(
                    &host_session_id,
                    &turn_id,
                    &source,
                    &target,
                    text,
                    publish_to_group,
                )
                .map(|reply| json!({ "sessionAgentId": target, "reply": reply }))
            }) as Box<dyn FnOnce() -> AgentRuntimeResult<Value> + Send>
        })
        .collect::<Vec<_>>();
    let mut replies = Vec::new();
    let timeout = super::session_runtime::remaining_turn_time(turn_id)
        .map(|remaining| remaining.min(super::turn_engine::oma_worker_timeout()))
        .unwrap_or_else(super::turn_engine::oma_worker_timeout);
    for worker in super::turn_engine::run_blocking_batch_for_turn(tasks, timeout, turn_id) {
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

fn oma_local_package_registry_path(root: &Path) -> PathBuf {
    root.join(OMA_LOCAL_PACKAGE_REGISTRY_FILE)
}

pub(crate) fn read_oma_local_packages(root: &Path) -> Vec<Value> {
    read_json::<OmaLocalPackageRegistry>(&oma_local_package_registry_path(root))
        .map(|registry| {
            registry
                .packages
                .into_iter()
                .filter_map(normalize_oma_local_package)
                .collect()
        })
        .unwrap_or_default()
}

pub(crate) fn write_oma_local_packages(
    root: &Path,
    packages: Vec<Value>,
) -> AgentRuntimeResult<()> {
    let mut ids = HashSet::new();
    let packages = packages
        .into_iter()
        .filter_map(normalize_oma_local_package)
        .filter(|package| {
            package
                .get("agentId")
                .and_then(Value::as_str)
                .is_some_and(|agent_id| ids.insert(agent_id.to_string()))
        })
        .collect();
    write_json(
        &oma_local_package_registry_path(root),
        &OmaLocalPackageRegistry {
            schema_version: OMA_LOCAL_PACKAGE_REGISTRY_VERSION,
            packages,
        },
    )
}

fn normalize_oma_local_package(mut package: Value) -> Option<Value> {
    let agent_id = package.get("agentId")?.as_str()?.trim().to_string();
    let name = package.get("name")?.as_str()?.trim().to_string();
    let role = package.get("role")?.as_str()?.trim().to_string();
    let description = package.get("description")?.as_str()?.trim().to_string();
    let prompt = package.get("prompt")?.as_str()?.trim().to_string();
    if agent_id.is_empty()
        || name.is_empty()
        || role.is_empty()
        || description.is_empty()
        || prompt.is_empty()
    {
        return None;
    }
    package["id"] = json!(agent_id);
    package["sessionAgentId"] = json!(agent_id);
    package["packageVersion"] = package
        .get("packageVersion")
        .cloned()
        .unwrap_or_else(|| json!("1.0.0"));
    package["shortName"] = package
        .get("shortName")
        .filter(|value| value.as_str().is_some_and(|value| !value.trim().is_empty()))
        .cloned()
        .unwrap_or_else(|| json!(name.chars().take(12).collect::<String>()));
    package["profile"] = package
        .get("profile")
        .filter(|value| value.is_object())
        .cloned()
        .unwrap_or_else(|| json!({ "facts": [] }));
    package["delegation"] = package
        .get("delegation")
        .and_then(|value| serde_json::from_value::<AgentPackageDelegation>(value.clone()).ok())
        .and_then(|delegation| serde_json::to_value(delegation).ok())
        .unwrap_or_else(|| {
            json!({
                "specialties": [role],
                "acceptedWork": [description],
                "deliverables": [],
                "collaborationHints": [],
            })
        });
    package["avatar"] = package
        .get("avatar")
        .filter(|value| value.is_object())
        .cloned()
        .unwrap_or_else(|| {
            json!({
                "kind": "text",
                "value": name.chars().next().unwrap_or('A').to_string(),
            })
        });
    let source = package
        .get("source")
        .and_then(Value::as_str)
        .filter(|source| matches!(*source, "user" | "lead_local"))
        .unwrap_or("lead_local")
        .to_string();
    package["status"] = json!("idle");
    package["builtIn"] = json!(false);
    package["source"] = json!(source);
    package["temporary"] = json!(false);
    Some(package)
}

fn oma_available_agent_registry(legacy_local_packages: Option<&Value>) -> Vec<Value> {
    let mut packages = builtin_oma_packages()
        .iter()
        .map(builtin_available_agent_to_value)
        .collect::<Vec<_>>();
    let mut local_packages = read_oma_local_packages(&runtime_root());
    let mut migrated = false;
    for legacy in legacy_local_packages
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .cloned()
        .filter_map(normalize_oma_local_package)
    {
        let known = local_packages
            .iter()
            .any(|package| package.get("agentId") == legacy.get("agentId"));
        if !known {
            local_packages.push(legacy);
            migrated = true;
        }
    }
    if migrated
        && let Err(error) = write_oma_local_packages(&runtime_root(), local_packages.clone())
    {
        eprintln!("[lyra-agent-runtime] failed to migrate Oma local package registry: {error}");
    }
    packages.extend(local_packages);
    packages
}

pub(crate) fn session_agent_from_available_package(package: &Value) -> Value {
    let mut agent = package.clone();
    let session_agent_id = Uuid::new_v4().to_string();
    agent["id"] = json!(session_agent_id);
    agent["sessionAgentId"] = agent["id"].clone();
    agent["status"] = json!("idle");
    agent
}

fn default_oma_state() -> Value {
    let agents = builtin_oma_packages()
        .iter()
        .map(builtin_agent_to_value)
        .collect::<Vec<_>>();
    let available_agents = oma_available_agent_registry(None);
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
    let available_agents = oma_available_agent_registry(oma.get("localPackages"));
    let available_agents_changed =
        oma.get("availableAgents") != Some(&Value::Array(available_agents.clone()));
    oma["availableAgents"] = Value::Array(available_agents);
    let must_restore_lead = lead_session_agent_id(oma).is_none();
    let needs_default_upgrade = !oma
        .get("defaultsVersion")
        .and_then(Value::as_u64)
        .is_some_and(|version| version >= OMA_DEFAULTS_VERSION);
    let definitions_changed = refresh_builtin_oma_agent_definitions(oma);
    if !needs_default_upgrade && !must_restore_lead {
        return definitions_changed || available_agents_changed;
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
            || agent.get("delegation") != builtin.get("delegation")
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
        "delegation": agent.manifest.delegation,
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
        "delegation": agent.manifest.delegation,
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

pub(crate) fn oma_parent_session_id(snapshot: &Value) -> Option<String> {
    snapshot
        .pointer("/oma/parentSessionId")
        .and_then(Value::as_str)
        .filter(|session_id| !session_id.is_empty())
        .map(str::to_string)
}

pub(crate) fn oma_interaction_source(snapshot: &Value) -> Option<Value> {
    let session_agent_id = snapshot
        .pointer("/oma/executingSessionAgentId")
        .and_then(Value::as_str)
        .filter(|agent_id| !agent_id.is_empty())?;
    let channel_id = snapshot
        .pointer("/oma/activeChannelId")
        .and_then(Value::as_str)
        .filter(|channel_id| !channel_id.is_empty())
        .unwrap_or(OMA_DEFAULT_CHANNEL_ID);
    Some(json!({
        "sessionAgentId": session_agent_id,
        "channelId": channel_id,
    }))
}

pub(crate) fn oma_event_target(session_id: &str) -> (String, Option<Value>) {
    let Ok(state) = state().lock() else {
        return (session_id.to_string(), None);
    };
    let Some(session) = state.sessions.get(session_id) else {
        return (session_id.to_string(), None);
    };
    let parent_session_id = oma_parent_session_id(&session.snapshot)
        .filter(|parent_session_id| state.sessions.contains_key(parent_session_id))
        .unwrap_or_else(|| session_id.to_string());
    (parent_session_id, oma_interaction_source(&session.snapshot))
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
    "plan",
    "projectTodo",
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
        "plan": Value::Null,
        "projectTodo": Value::Null,
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

pub(crate) fn ensure_oma_channel_message_contexts(snapshot: &mut Value) {
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
        if let Some(contexts) = snapshot
            .pointer_mut("/oma/channelContexts")
            .and_then(Value::as_object_mut)
        {
            for context in contexts.values_mut() {
                normalize_oma_channel_context(context);
            }
        }
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

fn normalize_oma_channel_context(context: &mut Value) {
    let Some(values) = context.as_object_mut() else {
        return;
    };
    let defaults = empty_oma_channel_context();
    for key in OMA_CHANNEL_CONTEXT_KEYS {
        values
            .entry((*key).to_string())
            .or_insert_with(|| defaults[*key].clone());
    }
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

pub(crate) fn oma_channel_messages(snapshot: &Value, channel_id: &str) -> Vec<Value> {
    let active_channel_id = snapshot
        .pointer("/oma/activeChannelId")
        .and_then(Value::as_str)
        .unwrap_or(OMA_DEFAULT_CHANNEL_ID);
    if active_channel_id == channel_id {
        return snapshot
            .get("messages")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
    }
    snapshot
        .pointer(&format!("/oma/channelContexts/{channel_id}/messages"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
}

fn oma_channel_context_field<'a>(
    snapshot: &'a Value,
    channel_id: &str,
    key: &str,
) -> Option<&'a Value> {
    let active_channel_id = snapshot
        .pointer("/oma/activeChannelId")
        .and_then(Value::as_str)
        .unwrap_or(OMA_DEFAULT_CHANNEL_ID);
    if active_channel_id == channel_id {
        return snapshot.get(key);
    }
    snapshot.pointer(&format!("/oma/channelContexts/{channel_id}/{key}"))
}

fn set_oma_channel_context_field(
    snapshot: &mut Value,
    channel_id: &str,
    key: &str,
    value: Value,
) -> AgentRuntimeResult<()> {
    ensure_oma_channel_message_contexts(snapshot);
    let active_channel_id = snapshot
        .pointer("/oma/activeChannelId")
        .and_then(Value::as_str)
        .unwrap_or(OMA_DEFAULT_CHANNEL_ID);
    if active_channel_id == channel_id {
        snapshot[key] = value;
        return Ok(());
    }
    let contexts = snapshot
        .pointer_mut("/oma/channelContexts")
        .and_then(Value::as_object_mut)
        .ok_or_else(|| AgentRuntimeError::Core("oma.channelContexts is invalid".to_string()))?;
    let context = contexts
        .entry(channel_id.to_string())
        .or_insert_with(empty_oma_channel_context);
    context[key] = value;
    Ok(())
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

pub(crate) fn oma_work_package_for_agent(
    snapshot: &Value,
    session_agent_id: &str,
) -> Option<Value> {
    let channel_id = direct_channel_id(session_agent_id);
    let messages = oma_channel_messages(snapshot, &channel_id);
    let work_package_id = messages
        .iter()
        .rev()
        .find(|message| {
            message.get("role").and_then(Value::as_str) == Some("user")
                && message
                    .pointer("/metadata/oma/workPackageId")
                    .and_then(Value::as_str)
                    .is_some()
        })
        .and_then(|message| message.pointer("/metadata/oma/workPackageId"))
        .and_then(Value::as_str)?;
    let work_package = snapshot
        .pointer("/oma/team/workPackages")
        .and_then(Value::as_array)?
        .iter()
        .find(|package| package.get("id").and_then(Value::as_str) == Some(work_package_id))
        .cloned()?;
    (work_package.get("status").and_then(Value::as_str) == Some("queued")).then_some(work_package)
}

pub(crate) fn set_oma_work_package_status(
    snapshot: &mut Value,
    work_package_id: &str,
    status: &str,
    summary: Option<&str>,
) {
    {
        let Some(team) = snapshot.pointer_mut("/oma/team") else {
            return;
        };
        let Some(packages) = team.get_mut("workPackages").and_then(Value::as_array_mut) else {
            return;
        };
        let Some(work_package) = packages
            .iter_mut()
            .find(|package| package.get("id").and_then(Value::as_str) == Some(work_package_id))
        else {
            return;
        };
        work_package["status"] = json!(status);
        if let Some(summary) = summary {
            work_package["summary"] = json!(summary);
        }
        if status == "failed" {
            work_package["failureReason"] =
                summary.map_or(Value::Null, |value| Value::String(value.to_string()));
        }
        let packages = team
            .get("workPackages")
            .and_then(Value::as_array)
            .expect("validated work packages");
        if packages
            .iter()
            .all(|package| package.get("status").and_then(Value::as_str) == Some("completed"))
        {
            team["status"] = json!("completed");
        } else if packages.iter().all(|package| {
            matches!(
                package.get("status").and_then(Value::as_str),
                Some("completed" | "failed" | "blocked")
            )
        }) {
            team["status"] = json!("failed");
        }
    }
    let todo_status = match status {
        "running" => "in_progress",
        "completed" => "completed",
        "failed" => "failed",
        "blocked" => "pending",
        _ => "pending",
    };
    let active_channel_id = snapshot
        .pointer("/oma/activeChannelId")
        .and_then(Value::as_str)
        .unwrap_or(OMA_DEFAULT_CHANNEL_ID);
    let project_todo = if active_channel_id == OMA_DEFAULT_CHANNEL_ID {
        snapshot.get_mut("projectTodo")
    } else {
        snapshot.pointer_mut("/oma/channelContexts/group:default/projectTodo")
    };
    if let Some(todos) = project_todo
        .and_then(|project_todo| project_todo.get_mut("todos"))
        .and_then(Value::as_array_mut)
    {
        if let Some(todo) = todos
            .iter_mut()
            .find(|todo| todo.get("id").and_then(Value::as_str) == Some(work_package_id))
        {
            todo["status"] = json!(todo_status);
        }
    }
}

pub(crate) fn replan_oma_work_package_once(
    snapshot: &mut Value,
    work_package_id: &str,
    failure: &str,
) -> bool {
    let Some(work_package) = snapshot
        .pointer_mut("/oma/team/workPackages")
        .and_then(Value::as_array_mut)
        .and_then(|packages| {
            packages
                .iter_mut()
                .find(|package| package.get("id").and_then(Value::as_str) == Some(work_package_id))
        })
    else {
        return false;
    };
    let replan_count = work_package
        .get("replanCount")
        .and_then(Value::as_u64)
        .unwrap_or_default();
    if replan_count >= 1 {
        return false;
    }
    work_package["replanCount"] = json!(replan_count + 1);
    work_package["status"] = json!("queued");
    work_package["enqueued"] = json!(false);
    work_package["failureReason"] = json!(failure);
    work_package["summary"] = json!(format!(
        "Automatic replan {}/1 after: {}",
        replan_count + 1,
        failure
    ));
    true
}

pub(crate) fn queue_oma_team_failure_lead_followup(
    snapshot: &mut Value,
    work_package_id: &str,
    failure: &str,
) {
    ensure_oma_channel_message_contexts(snapshot);
    let Some(oma) = snapshot.get_mut("oma") else {
        return;
    };
    let Some(lead_id) = lead_session_agent_id(oma) else {
        return;
    };
    let work_package = oma
        .pointer("/team/workPackages")
        .and_then(Value::as_array)
        .and_then(|packages| {
            packages
                .iter()
                .find(|package| package.get("id").and_then(Value::as_str) == Some(work_package_id))
        });
    let title = work_package
        .and_then(|package| package.get("title"))
        .and_then(Value::as_str)
        .unwrap_or("work package");
    let mut message = user_message(
        format!(
            "Runtime follow-up for Lead: `{title}` ({work_package_id}) failed after its one automatic replan. In the default group, state the public blocker and next decision. If progress needs user input, a permission, or a scope choice, use the existing clarification or permission flow; do not silently retry or rewrite the approved Team Plan.\n\nFailure: {failure}"
        ),
        Vec::new(),
        now(),
    );
    message["metadata"] = json!({
        "uiHidden": true,
        "oma": {
            "channelId": OMA_DEFAULT_CHANNEL_ID,
            "sender": "system",
            "targetSessionAgentIds": [lead_id],
            "kind": "team_failure_followup",
        }
    });
    if push_oma_message_to_channel(snapshot, OMA_DEFAULT_CHANNEL_ID, message).is_err() {
        return;
    }
    let oma = snapshot.get_mut("oma").expect("Oma state is present");
    if !oma["pendingAgentTurns"].is_array() {
        oma["pendingAgentTurns"] = json!([]);
    }
    oma["pendingAgentTurns"]
        .as_array_mut()
        .expect("pending turn array")
        .push(json!({
            "channelId": OMA_DEFAULT_CHANNEL_ID,
            "sessionAgentId": lead_id,
        }));
    set_agent_status(oma, &lead_id, "queued");
}

/// When the approved team reaches a terminal state, hand public synthesis back
/// to Lead once. Specialists keep their complete process in direct channels;
/// Lead receives only the public Team Plan projection and publishes the group
/// outcome from that projection.
pub(crate) fn queue_oma_team_completion_lead_followup(snapshot: &mut Value) {
    ensure_oma_channel_message_contexts(snapshot);
    let (lead_id, title, status) = {
        let Some(oma) = snapshot.get_mut("oma") else {
            return;
        };
        let Some(lead_id) = lead_session_agent_id(oma) else {
            return;
        };
        let Some(team) = oma.get_mut("team").filter(|team| team.is_object()) else {
            return;
        };
        let all_terminal = team
            .get("workPackages")
            .and_then(Value::as_array)
            .is_some_and(|packages| {
                !packages.is_empty()
                    && packages.iter().all(|package| {
                        matches!(
                            package.get("status").and_then(Value::as_str),
                            Some("completed" | "failed" | "blocked")
                        )
                    })
            });
        if !all_terminal || team.get("leadSummaryQueued").and_then(Value::as_bool) == Some(true) {
            return;
        }
        team["leadSummaryQueued"] = json!(true);
        (
            lead_id,
            team.get("title")
                .and_then(Value::as_str)
                .unwrap_or("Oma Team Plan")
                .to_string(),
            team.get("status")
                .and_then(Value::as_str)
                .unwrap_or("completed")
                .to_string(),
        )
    };
    let mut message = user_message(
        format!(
            "Runtime follow-up for Lead: `{title}` is now terminal with status `{status}`. In the default group, publish a concise outcome: completed deliverables, any unresolved blocker or residual risk, and the next user decision if one is needed. Use only the Team Plan's public work-package status, deliverable summaries, and failure reasons. Do not reveal or claim access to private direct-channel messages, tools, memory, todos, prompts, or token state."
        ),
        Vec::new(),
        now(),
    );
    message["metadata"] = json!({
        "uiHidden": true,
        "oma": {
            "channelId": OMA_DEFAULT_CHANNEL_ID,
            "sender": "system",
            "targetSessionAgentIds": [lead_id],
            "kind": "team_completion_followup",
        }
    });
    if push_oma_message_to_channel(snapshot, OMA_DEFAULT_CHANNEL_ID, message).is_err() {
        return;
    }
    let Some(oma) = snapshot.get_mut("oma") else {
        return;
    };
    if !oma["pendingAgentTurns"].is_array() {
        oma["pendingAgentTurns"] = json!([]);
    }
    oma["pendingAgentTurns"]
        .as_array_mut()
        .expect("pending turn array")
        .push(json!({
            "channelId": OMA_DEFAULT_CHANNEL_ID,
            "sessionAgentId": lead_id,
        }));
    set_agent_status(oma, &lead_id, "queued");
}

pub(crate) fn start_oma_team_work(session_id: &str) -> AgentRuntimeResult<bool> {
    let (callback, snapshot, started) = {
        let mut state = state()
            .lock()
            .map_err(|_| AgentRuntimeError::Core("agent runtime state lock failed".to_string()))?;
        let session = state
            .sessions
            .get_mut(session_id)
            .ok_or_else(|| AgentRuntimeError::Core(format!("session not found: {session_id}")))?;
        if session.snapshot.get("agentMode").and_then(Value::as_str) != Some("oma") {
            return Ok(false);
        }
        ensure_oma_channel_message_contexts(&mut session.snapshot);
        let plan_id = oma_channel_context_field(&session.snapshot, OMA_DEFAULT_CHANNEL_ID, "plan")
            .and_then(|plan| plan.get("activePlanId"))
            .and_then(Value::as_str)
            .map(str::to_string);
        let (lead_id, packages) = {
            let oma = session
                .snapshot
                .get_mut("oma")
                .ok_or_else(|| AgentRuntimeError::Core("oma state is required".to_string()))?;
            let lead_id = lead_session_agent_id(oma).unwrap_or_default();
            let team = oma.get_mut("team").filter(|team| team.is_object());
            let Some(team) = team else {
                return Ok(false);
            };
            match team.get("status").and_then(Value::as_str) {
                Some("reviewing")
                    if plan_id.as_deref() == team.get("planId").and_then(Value::as_str) =>
                {
                    team["status"] = json!("executing");
                }
                Some("executing") => {}
                _ => return Ok(false),
            }
            let packages = team
                .get("workPackages")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            (lead_id, packages)
        };
        let mut group_plan =
            oma_channel_context_field(&session.snapshot, OMA_DEFAULT_CHANNEL_ID, "plan")
                .cloned()
                .unwrap_or(Value::Null);
        if let Some(plan) = group_plan.as_object_mut() {
            plan.insert("phase".to_string(), json!(PLAN_PHASE_EXECUTING_TODO));
        }
        set_oma_channel_context_field(
            &mut session.snapshot,
            OMA_DEFAULT_CHANNEL_ID,
            "plan",
            group_plan,
        )?;
        let mut busy_assignees = session
            .snapshot
            .pointer("/oma/team/workPackages")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter(|package| {
                (package.get("enqueued").and_then(Value::as_bool) == Some(true)
                    && package.get("status").and_then(Value::as_str) == Some("queued"))
                    || package.get("status").and_then(Value::as_str) == Some("running")
            })
            .filter_map(|package| {
                package
                    .get("assigneeSessionAgentId")
                    .and_then(Value::as_str)
                    .map(str::to_string)
            })
            .collect::<HashSet<_>>();
        for package in packages {
            let dependencies_done = package
                .get("dependencies")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
                .all(|dependency| {
                    session
                        .snapshot
                        .pointer("/oma/team/workPackages")
                        .and_then(Value::as_array)
                        .and_then(|packages| {
                            packages.iter().find(|candidate| {
                                candidate.get("id").and_then(Value::as_str) == Some(dependency)
                            })
                        })
                        .and_then(|candidate| candidate.get("status").and_then(Value::as_str))
                        == Some("completed")
                });
            if package.get("enqueued").and_then(Value::as_bool) == Some(true)
                || package.get("status").and_then(Value::as_str) != Some("queued")
            {
                continue;
            }
            let dependency_failed = package
                .get("dependencies")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
                .any(|dependency| {
                    session
                        .snapshot
                        .pointer("/oma/team/workPackages")
                        .and_then(Value::as_array)
                        .and_then(|packages| {
                            packages.iter().find(|candidate| {
                                candidate.get("id").and_then(Value::as_str) == Some(dependency)
                            })
                        })
                        .and_then(|candidate| candidate.get("status").and_then(Value::as_str))
                        .is_some_and(|status| matches!(status, "failed" | "blocked"))
                });
            if dependency_failed {
                if let Some(work_package_id) = package.get("id").and_then(Value::as_str) {
                    set_oma_work_package_status(
                        &mut session.snapshot,
                        work_package_id,
                        "blocked",
                        Some("A required work package failed."),
                    );
                }
                continue;
            }
            if !dependencies_done {
                continue;
            }
            let Some(work_package_id) = package.get("id").and_then(Value::as_str) else {
                continue;
            };
            let Some(assignee) = package
                .get("assigneeSessionAgentId")
                .and_then(Value::as_str)
            else {
                continue;
            };
            if busy_assignees.contains(assignee) {
                continue;
            }
            let mut message = user_message(
                format!(
                    "Approved Team Plan work package: {}\n\nTask: {}\n\nAcceptance criteria: {}\n\nDeliverable: {}{}",
                    package.get("title").and_then(Value::as_str).unwrap_or("Work package"),
                    package.get("task").and_then(Value::as_str).unwrap_or_default(),
                    package
                        .get("acceptanceCriteria")
                        .map(|value| serde_json::to_string(value).unwrap_or_default())
                        .unwrap_or_default(),
                    package
                        .get("deliverable")
                        .and_then(Value::as_str)
                        .unwrap_or("Report the completed deliverable and verification."),
                    package
                        .get("replanCount")
                        .and_then(Value::as_u64)
                        .filter(|count| *count > 0)
                        .map(|count| {
                            format!(
                                "\n\nAutomatic replan {count}/1: the earlier attempt failed. Reassess the approach, use the recorded failure context, and pursue a materially safer alternative."
                            )
                        })
                        .unwrap_or_default(),
                ),
                Vec::new(),
                now(),
            );
            message["metadata"] = json!({
                "oma": {
                    "channelId": direct_channel_id(assignee),
                    "sender": "agent",
                    "senderAgentId": lead_id,
                    "targetSessionAgentIds": [assignee],
                    "workPackageId": work_package_id,
                    "kind": "team_work",
                }
            });
            push_oma_message_to_channel(
                &mut session.snapshot,
                &direct_channel_id(assignee),
                message,
            )?;
            if !session.snapshot["oma"]["pendingAgentTurns"].is_array() {
                session.snapshot["oma"]["pendingAgentTurns"] = json!([]);
            }
            session.snapshot["oma"]["pendingAgentTurns"]
                .as_array_mut()
                .expect("pending turn array")
                .push(json!({
                    "channelId": direct_channel_id(assignee),
                    "sessionAgentId": assignee,
                }));
            if let Some(work_packages) = session
                .snapshot
                .pointer_mut("/oma/team/workPackages")
                .and_then(Value::as_array_mut)
                && let Some(work_package) = work_packages.iter_mut().find(|candidate| {
                    candidate.get("id").and_then(Value::as_str) == Some(work_package_id)
                })
            {
                work_package["enqueued"] = json!(true);
            }
            set_agent_status(
                session.snapshot.get_mut("oma").expect("Oma state"),
                assignee,
                "queued",
            );
            busy_assignees.insert(assignee.to_string());
        }
        touch_session(session);
        let snapshot = session.snapshot.clone();
        let callback = event_callback();
        state.save_state()?;
        (callback, snapshot, true)
    };
    if started {
        emit_with_callback(
            &callback,
            json!({ "kind": "sessionSnapshot", "snapshot": snapshot }),
        );
    }
    Ok(started)
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
        let callback = event_callback();
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
        "plan",
        "projectTodo",
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
}
