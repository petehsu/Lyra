use http::HeaderMap;
use http::HeaderValue;
use lyra_protocol::protocol::SessionSource;

pub fn build_conversation_headers(conversation_id: Option<String>) -> HeaderMap {
    let mut headers = HeaderMap::new();
    if let Some(id) = conversation_id {
        insert_header(&mut headers, "session_id", &id);
    }
    headers
}

pub(crate) fn subagent_header(source: &Option<SessionSource>) -> Option<String> {
    let SessionSource::SubAgent(sub) = source.as_ref()? else {
        return None;
    };
    match sub {
        lyra_protocol::protocol::SubAgentSource::Review => Some("review".to_string()),
        lyra_protocol::protocol::SubAgentSource::MemoryConsolidation => {
            Some("memory_consolidation".to_string())
        }
        lyra_protocol::protocol::SubAgentSource::ThreadSpawn { .. } => {
            Some("collab_spawn".to_string())
        }
        lyra_protocol::protocol::SubAgentSource::Other(label) => Some(label.clone()),
    }
}

pub(crate) fn insert_header(headers: &mut HeaderMap, name: &str, value: &str) {
    if let (Ok(header_name), Ok(header_value)) = (
        name.parse::<http::HeaderName>(),
        HeaderValue::from_str(value),
    ) {
        headers.insert(header_name, header_value);
    }
}
