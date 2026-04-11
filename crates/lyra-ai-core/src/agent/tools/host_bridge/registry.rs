use std::collections::HashMap;
use std::sync::Mutex;

use once_cell::sync::Lazy;

use super::executor::{build_host_tool_executor, HostToolInvoker};
use super::types::HostToolDescriptor;
use crate::agent::tools::{
    register_external_tool, unregister_external_tool, ExternalToolMetadata, RegisteredExternalTool,
};
use crate::provider::types::AgentToolDefinition;

static HOST_TOOL_SETS: Lazy<Mutex<HashMap<String, Vec<String>>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

pub fn register_host_tools_bridge(
    tool_set_id: &str,
    tools: Vec<HostToolDescriptor>,
    invoker: HostToolInvoker,
) {
    unregister_host_tool_set(tool_set_id);

    let mut registered_names = Vec::with_capacity(tools.len());
    for tool in tools {
        registered_names.push(tool.name.clone());
        register_external_tool(RegisteredExternalTool {
            definition: AgentToolDefinition {
                name: tool.name.clone(),
                description: tool.description.clone(),
                input_schema: tool.input_schema.clone(),
            },
            metadata: ExternalToolMetadata {
                output_schema: tool.output_schema.clone(),
                approval_mode: tool.approval_mode,
                side_effects: tool.side_effects.clone(),
            },
            execution_mode: tool.execution_mode,
            executor: build_host_tool_executor(tool, invoker.clone()),
        });
    }

    if let Ok(mut guard) = HOST_TOOL_SETS.lock() {
        guard.insert(tool_set_id.to_string(), registered_names);
    }
}

pub fn unregister_host_tool_set(tool_set_id: &str) {
    let names = HOST_TOOL_SETS
        .lock()
        .ok()
        .and_then(|mut guard| guard.remove(tool_set_id))
        .unwrap_or_default();
    for name in names {
        unregister_external_tool(&name);
    }
}
