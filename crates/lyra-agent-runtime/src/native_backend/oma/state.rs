use super::*;

pub(super) fn default_oma_state() -> Value {
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

pub(super) fn ensure_default_oma_agents(oma: &mut Value) -> bool {
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

pub(super) fn refresh_builtin_oma_agent_definitions(oma: &mut Value) -> bool {
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

pub(super) fn builtin_agent_to_value(agent: &BuiltinOmaPackage) -> Value {
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

pub(super) fn builtin_available_agent_to_value(agent: &BuiltinOmaPackage) -> Value {
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

pub(super) fn direct_channel_value(agent: &Value, session_agent_id: &str) -> Value {
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

pub(super) fn mutate_oma_session(
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

pub(super) const OMA_CHANNEL_CONTEXT_KEYS: &[&str] = &[
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

pub(super) fn empty_oma_channel_context() -> Value {
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

pub(super) fn take_oma_channel_context(snapshot: &mut Value) -> Value {
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

pub(super) fn restore_oma_channel_context(snapshot: &mut Value, context: Value) {
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

pub(super) fn channel_context_messages_mut(context: &mut Value) -> &mut Vec<Value> {
    context["messages"]
        .as_array_mut()
        .expect("Oma channel context messages is an array")
}

pub(super) fn invalidate_context_token_estimate(context: &mut Value) {
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

pub(super) fn normalize_oma_channel_context(context: &mut Value) {
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

pub(super) fn discard_legacy_oma_scheduling(snapshot: &mut Value) {
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

pub(super) fn strip_oma_scheduling_metadata(messages: Option<&mut Value>) {
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

pub(super) fn migrate_oma_session_agent_ids(snapshot: &mut Value) {
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
    if let Some(oma) = snapshot.get_mut("oma") {
        for key in [
            "privateProviderContextsByAgent",
            "privateProviderMetadataByAgent",
        ] {
            let Some(entries) = oma.get_mut(key).and_then(Value::as_object_mut) else {
                continue;
            };
            for (old, new) in &remap {
                let Some(old_value) = entries.remove(old) else {
                    continue;
                };
                let Some(existing) = entries.get_mut(new) else {
                    entries.insert(new.clone(), old_value);
                    continue;
                };
                if let (Some(existing), Some(old_values)) =
                    (existing.as_object_mut(), old_value.as_object())
                {
                    for (message_id, value) in old_values {
                        existing
                            .entry(message_id.clone())
                            .or_insert_with(|| value.clone());
                    }
                }
            }
        }
    }
}

pub(super) fn remap_oma_ids_in_value(
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

pub(super) fn discard_legacy_custom_groups(snapshot: &mut Value) {
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

pub(super) fn invalidate_oma_channel_token_estimate(snapshot: &mut Value) {
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

pub(super) fn oma_channel_context_field<'a>(
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

pub(super) fn set_oma_channel_context_field(
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
