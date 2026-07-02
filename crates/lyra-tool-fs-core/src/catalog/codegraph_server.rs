use crate::model::ToolManifest;
use crate::schema::attach_schema_id;

pub(super) fn manifests() -> Vec<ToolManifest> {
    codegraph_server::mcp::tools::get_all_tools()
        .into_iter()
        .map(|tool| {
            let operation = tool
                .name
                .strip_prefix("codegraph_")
                .unwrap_or(&tool.name)
                .to_string();
            let path = format!("/tools/codegraph/{operation}");
            let schema = attach_schema_id(
                &path,
                serde_json::to_value(&tool.input_schema)
                    .unwrap_or_else(|_| serde_json::json!({ "type": "object" })),
            );
            let example = format!("tool_fs_run path=\"{path}\" args={{...}}");
            ToolManifest {
                path,
                handle: Some(tool.name.clone()),
                domain: "codegraph".to_string(),
                operation,
                title: title_from_tool_name(&tool.name),
                summary: first_sentence(tool.description.as_deref().unwrap_or("CodeGraph tool.")),
                description: tool.description.unwrap_or_default(),
                aliases: vec![tool.name.replace('_', " ")],
                examples: vec![example],
                tags: vec![
                    "codegraph".to_string(),
                    "code".to_string(),
                    "graph".to_string(),
                ],
                risk_level: "read".to_string(),
                permission_policy: "runtime_policy".to_string(),
                input_schema: schema,
                output_kind: "json".to_string(),
                activity_kind: "search".to_string(),
                renderer_hint: "search".to_string(),
            }
        })
        .collect()
}

fn title_from_tool_name(name: &str) -> String {
    name.strip_prefix("codegraph_")
        .unwrap_or(name)
        .split('_')
        .map(|part| {
            let mut chars = part.chars();
            match chars.next() {
                Some(first) => first.to_uppercase().chain(chars).collect::<String>(),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn first_sentence(value: &str) -> String {
    value
        .split('.')
        .next()
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .unwrap_or(value)
        .to_string()
}
