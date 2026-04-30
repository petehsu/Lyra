use crate::ToolDefinition;
use crate::parse_tool_input_schema;
use lyra_protocol::dynamic_tools::DynamicToolSpec;

pub fn parse_dynamic_tool(tool: &DynamicToolSpec) -> Result<ToolDefinition, serde_json::Error> {
    let DynamicToolSpec {
        namespace: _,
        name,
        host_method: _,
        description,
        input_schema,
        defer_loading,
        side_effects: _,
        approval_mode: _,
        risk: _,
        model_input_capabilities: _,
    } = tool;
    Ok(ToolDefinition {
        name: name.clone(),
        description: description.clone(),
        input_schema: parse_tool_input_schema(input_schema)?,
        output_schema: None,
        defer_loading: *defer_loading,
    })
}

#[cfg(test)]
#[path = "dynamic_tool_tests.rs"]
mod tests;
