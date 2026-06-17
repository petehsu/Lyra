mod content;
mod discovery;
mod schema;
mod sse;
mod tools;

pub(crate) use content::{content_to_plain_text, message_content, message_reasoning_text};
pub(crate) use discovery::{ModelDiscoveryScope, discover_models, is_supported_text_model_id};
pub(crate) use schema::strict_tool_schema;
pub(crate) use sse::{SseEvent, parse_sse_line};
pub(crate) use tools::{
    StreamingToolCallAccumulator, finalize_streaming_tool_calls, is_valid_tool_call_id,
    parse_tool_arguments, parse_tool_call, repair_tool_name, tool_name_set,
};
