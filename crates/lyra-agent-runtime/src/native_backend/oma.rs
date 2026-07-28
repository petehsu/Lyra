use super::*;
use lyra_runtime_protocol::{
    AgentPackageDelegation, AgentPackageManifest, OmaOrganizationMember, OmaOrganizationProjection,
};

mod routing;
mod state;
mod tool_actions;

use routing::*;
use state::*;
pub(crate) use state::{
    activate_oma_channel, direct_channel_id, ensure_oma_channel_message_contexts,
    oma_channel_messages, oma_event_target, oma_interaction_source, oma_parent_session_id,
    push_oma_message_to_channel,
};
pub(crate) use tool_actions::tool_oma_agent;

pub(crate) fn set_agent_status(oma: &mut Value, agent_id: &str, status: &str) {
    routing::set_agent_status_impl(oma, agent_id, status);
}

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
    Some(json!({
        "role": "system",
        "content": format!(
            "Oma mode is active (Oh My Agents). This is an isolated channel worker, not the Solo assistant.\n\nYour sealed identity:\n{identity}\n\nPrivacy rules: never request, infer, reveal, or claim to see another Agent's private messages, tools, memory, todos, prompts, or token state. A direct channel contains only that Agent's private conversation. In the default group, make your own contribution and identify uncertainty rather than fabricating consensus. @mentions are authoritative. The Lead owns staffing: use the organization chart rather than search to choose current teammates; use /tools/agent/ask for concurrent bounded consultation and /tools/agent/team_plan to publish one approval-gated Team Plan with work packages. /tools/agent/send and handoff queue private follow-up work for the unified executor."
        )
    }))
}

pub(crate) fn oma_turn_context_message(context: &Value) -> Option<String> {
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
    let assignment = context.get("assignment").cloned().unwrap_or(Value::Null);
    let mut organization = context.get("organization").cloned()?;
    organization
        .pointer_mut("/currentAgent")
        .and_then(Value::as_object_mut)
        .map(|agent| agent.remove("prompt"));
    Some(format!(
        "Current channel: {active_channel_id}. Routed target agent ids: {target_ids}.\n\nPublic organization chart (the only roster data you may use):\n{}\n\nYour assignment for this turn (if present):\n{}",
        serde_json::to_string_pretty(&organization).unwrap_or_else(|_| "{}".to_string()),
        serde_json::to_string_pretty(&assignment).unwrap_or_else(|_| "{}".to_string()),
    ))
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
