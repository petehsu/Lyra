use super::*;

pub(super) fn string_array(payload: &Value, key: &str) -> Vec<String> {
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

pub(super) fn channel<'a>(oma: &'a Value, channel_id: &str) -> Option<&'a Value> {
    oma.get("channels")
        .and_then(Value::as_array)?
        .iter()
        .find(|channel| channel.get("id").and_then(Value::as_str) == Some(channel_id))
}

pub(super) fn channel_mut<'a>(oma: &'a mut Value, channel_id: &str) -> Option<&'a mut Value> {
    oma.get_mut("channels")
        .and_then(Value::as_array_mut)?
        .iter_mut()
        .find(|channel| channel.get("id").and_then(Value::as_str) == Some(channel_id))
}

pub(super) fn active_channel_missing_or_archived(oma: &Value) -> bool {
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

pub(super) fn active_agent_ids(oma: &Value) -> Vec<String> {
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

pub(super) fn find_session_agent_id_for_package(oma: &Value, agent_id: &str) -> Option<String> {
    oma.get("agents")
        .and_then(Value::as_array)?
        .iter()
        .find(|agent| agent.get("agentId").and_then(Value::as_str) == Some(agent_id))
        .and_then(|agent| agent.get("id").and_then(Value::as_str))
        .map(str::to_string)
}

pub(super) fn find_session_agent_id_for_identifier(
    oma: &Value,
    identifier: &str,
) -> Option<String> {
    active_agent_ids(oma)
        .into_iter()
        .find(|id| id == identifier)
        .or_else(|| find_session_agent_id_for_package(oma, identifier))
}

pub(super) fn lead_session_agent_id(oma: &Value) -> Option<String> {
    find_session_agent_id_for_package(oma, OMA_LEAD_ID)
}

pub(super) fn is_lead_session_agent(oma: &Value, session_agent_id: &str) -> bool {
    lead_session_agent_id(oma).as_deref() == Some(session_agent_id)
}

pub(super) fn structured_oma_mentions(
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

pub(super) fn oma_mention_marker_ids_in_order(text: &str) -> AgentRuntimeResult<Vec<String>> {
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

pub(super) fn oma_assignments_for_mentions(text: &str, mentions: &[Value]) -> Vec<Value> {
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

pub(super) fn route_target_agents(oma: &Value, channel: &Value, mentions: &[Value]) -> Vec<String> {
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

pub(super) fn channel_member_ids(channel: &Value) -> Vec<String> {
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

pub(super) fn set_agent_status_impl(oma: &mut Value, agent_id: &str, status: &str) {
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

pub(super) fn oma_agent_is_running(oma: &Value, agent_id: &str) -> bool {
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

pub(super) fn add_agent_to_default_group(oma: &mut Value, agent_id: &str) {
    if let Some(channel) = channel_mut(oma, OMA_DEFAULT_CHANNEL_ID) {
        add_member_to_channel(channel, agent_id);
    }
}

pub(super) fn add_member_to_channel(channel: &mut Value, agent_id: &str) {
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

pub(super) fn ensure_direct_channel(oma: &mut Value, agent_id: &str) {
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

pub(super) fn remove_agent_from_channels(oma: &mut Value, agent_id: &str) {
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
    for key in [
        "privateProviderContextsByAgent",
        "privateProviderMetadataByAgent",
    ] {
        if let Some(entries) = oma.get_mut(key).and_then(Value::as_object_mut) {
            entries.remove(agent_id);
        }
    }
}

pub(super) fn merge_oma_metadata(message: &mut Value, oma_metadata: Value) {
    let current = message
        .get("metadata")
        .cloned()
        .filter(Value::is_object)
        .unwrap_or_else(|| json!({}));
    message["metadata"] =
        merge_metadata(Some(current), json!({ "oma": oma_metadata })).unwrap_or_else(|| json!({}));
}

pub(super) fn merge_metadata(current: Option<Value>, incoming: Value) -> Option<Value> {
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
