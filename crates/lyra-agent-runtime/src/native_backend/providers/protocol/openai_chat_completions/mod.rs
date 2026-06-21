mod request;

use super::super::types::ProtocolCatalogEntry;

pub(crate) const PROTOCOL_ID: &str = "openai_chat_completions";
pub(crate) const PROTOCOL_FAMILY: &str = "openai_chat_completions";

pub(crate) use super::openai_common::{
    SseEvent, StreamingThinkScrubber, StreamingToolCallAccumulator, finalize_streaming_tool_calls,
    is_valid_tool_call_id, message_content, message_reasoning_text, parse_sse_line,
    parse_tool_call, repair_tool_name, scrub_think_blocks, tool_name_set,
};
pub(crate) use request::build_request_body;

pub(crate) fn catalog_entry() -> ProtocolCatalogEntry {
    ProtocolCatalogEntry {
        id: PROTOCOL_ID.to_string(),
        family: PROTOCOL_FAMILY.to_string(),
        label: "OpenAI Chat Completions".to_string(),
        transport: "http_json_stream".to_string(),
        runtime_supported: true,
        streaming_supported: true,
        tool_calling_supported: true,
    }
}
