use super::*;
use lyra_tool_fs_core::{
    CatalogEntry, ToolFsRegistry, ToolManifest, build_catalog_listing, catalog_entry_from_manifest,
    deferred_tool_name, search_catalog,
};
use std::collections::HashSet;
use std::sync::OnceLock;

pub(crate) const TOOL_SEARCH_TOOL_NAME: &str = "ToolSearch";
pub(crate) const DISCOVERED_TOOL_NAMES_KEY: &str = "discoveredToolNames";
const DEFAULT_SEARCH_LIMIT: usize = 5;
const MAX_SEARCH_LIMIT: usize = 25;
const LISTING_MAX_TOKENS: usize = 4000;
const LISTING_CONTEXT_PCT: f64 = 5.0;

const EAGER_DEFERRED_EXCLUSIONS: &[&str] = &["agent_spawn"];

const TOOL_SEARCH_PROMPT_HEAD: &str =
    "Fetches full schema definitions for deferred tools so they can be called.";
const TOOL_SEARCH_PROMPT_TAIL: &str = " Until fetched, only the name is known — there is no parameter schema, so the tool cannot be invoked. Query forms:\n- \"select:web_search,browser_read\" — fetch these exact tools by name\n- \"notebook jupyter\" — keyword search, up to max_results best matches";

#[derive(Clone, Debug)]
pub(crate) struct DeferredTool {
    pub name: String,
    pub description: String,
    pub source_name: String,
    pub schema: Value,
    pub manifest: Option<ToolManifest>,
}

pub(crate) fn is_tool_search_name(name: &str) -> bool {
    name == TOOL_SEARCH_TOOL_NAME
}

pub(crate) fn schema_not_sent_hint(name: &str) -> Value {
    json!({
        "content": format!(
            "Schema for `{name}` was not sent. Call `{TOOL_SEARCH_TOOL_NAME}` with query \"select:{name}\" first, then invoke `{name}` by name."
        ),
        "error": {
            "code": "tool_schema_not_sent",
            "message": format!("Deferred tool `{name}` is not loaded in this request."),
        },
        "recommendedNextAction": format!("Call {TOOL_SEARCH_TOOL_NAME} with select:{name}"),
    })
}

fn push_unique_name(names: &mut Vec<String>, name: &str) {
    let name = name.trim();
    if name.is_empty() || names.iter().any(|existing| existing == name) {
        return;
    }
    names.push(name.to_string());
}

fn names_from_value_list(value: Option<&Value>) -> Vec<String> {
    value
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .collect()
}

pub(crate) fn discovered_tool_names(snapshot: &Value) -> Vec<String> {
    let mut names = Vec::new();
    for name in names_from_value_list(snapshot.get(DISCOVERED_TOOL_NAMES_KEY)) {
        push_unique_name(&mut names, &name);
    }
    if let Some(messages) = snapshot.get("messages").and_then(Value::as_array) {
        for message in messages {
            for name in names_from_value_list(message.get("lyraDiscoveredTools")) {
                push_unique_name(&mut names, &name);
            }
        }
    }
    if snapshot.pointer("/subagent/origin").and_then(Value::as_str) == Some("todo") {
        for name in [
            TODO_WRITE_MODEL_TOOL,
            TODO_UPDATE_MODEL_TOOL,
            TODO_FINISH_MODEL_TOOL,
        ] {
            push_unique_name(&mut names, name);
        }
    }
    names
}

pub(crate) fn record_discovered_tool_names(session_id: &str, names: &[String]) {
    if names.is_empty() {
        return;
    }
    let Ok(mut state) = state().lock() else {
        return;
    };
    let Some(session) = state.sessions.get_mut(session_id) else {
        return;
    };
    let mut existing = discovered_tool_names(&session.snapshot);
    for name in names {
        if !existing.iter().any(|existing| existing == name) {
            existing.push(name.clone());
        }
    }
    session.snapshot[DISCOVERED_TOOL_NAMES_KEY] = json!(existing);
    session.dirty = true;
}

pub(crate) fn listing_token_budget(context_window: u64) -> usize {
    let pct = ((context_window as f64) * LISTING_CONTEXT_PCT / 100.0) as usize;
    LISTING_MAX_TOKENS.min(pct.max(200))
}

fn synthetic_todo_tools() -> Vec<DeferredTool> {
    todo_model_tools()
        .into_iter()
        .filter_map(|schema| {
            let name = schema
                .pointer("/function/name")
                .and_then(Value::as_str)?
                .to_string();
            let description = schema
                .pointer("/function/description")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            Some(DeferredTool {
                name,
                description,
                source_name: "todo".to_string(),
                schema,
                manifest: None,
            })
        })
        .collect()
}

fn deferred_from_manifest(manifest: &ToolManifest) -> DeferredTool {
    DeferredTool {
        name: deferred_tool_name(manifest),
        description: if manifest.summary.is_empty() {
            manifest.description.clone()
        } else {
            manifest.summary.clone()
        },
        source_name: manifest.domain.clone(),
        schema: provider_schema_from_manifest(manifest),
        manifest: Some(manifest.clone()),
    }
}

fn dedupe_sort_deferred(tools: &mut Vec<DeferredTool>) {
    let mut seen = HashSet::new();
    tools.retain(|tool| seen.insert(tool.name.clone()));
    tools.sort_by(|left, right| left.name.cmp(&right.name));
}

fn cached_builtin_deferred_tools() -> &'static Vec<DeferredTool> {
    static CACHE: OnceLock<Vec<DeferredTool>> = OnceLock::new();
    CACHE.get_or_init(|| {
        let mut tools = ToolFsRegistry::builtin()
            .manifests()
            .iter()
            .filter(|manifest| !is_eager_exclusion(manifest))
            .map(deferred_from_manifest)
            .collect::<Vec<_>>();
        tools.extend(synthetic_todo_tools());
        dedupe_sort_deferred(&mut tools);
        tools
    })
}

fn include_deferred_manifest(manifest: &ToolManifest, enabled_media: &HashSet<String>) -> bool {
    !is_eager_exclusion(manifest)
        && (manifest.domain != "media" || enabled_media.contains(&manifest.path))
}

fn provider_schema_from_manifest(manifest: &ToolManifest) -> Value {
    let name = deferred_tool_name(manifest);
    let description = if manifest.summary.is_empty() {
        manifest.description.as_str()
    } else {
        manifest.summary.as_str()
    };
    let mut parameters = manifest.input_schema.clone();
    if let Some(object) = parameters.as_object_mut() {
        object.remove("$id");
        object.remove("schemaId");
    }
    function_tool(&name, description, parameters)
}

fn is_eager_exclusion(manifest: &ToolManifest) -> bool {
    let name = deferred_tool_name(manifest);
    EAGER_DEFERRED_EXCLUSIONS.contains(&name.as_str())
}

pub(crate) fn deferred_tools(
    dispatcher: Option<&Arc<HostCapabilityDispatcher>>,
) -> Vec<DeferredTool> {
    let enabled_media = tool_fs::enabled_media_tool_paths();
    let mut tools = cached_builtin_deferred_tools()
        .iter()
        .filter(|tool| {
            tool.manifest
                .as_ref()
                .is_none_or(|manifest| include_deferred_manifest(manifest, &enabled_media))
        })
        .cloned()
        .collect::<Vec<_>>();
    tools.extend(
        tool_fs::dynamic_capability_manifests(dispatcher)
            .iter()
            .filter(|manifest| include_deferred_manifest(manifest, &enabled_media))
            .map(deferred_from_manifest),
    );
    dedupe_sort_deferred(&mut tools);
    tools
}

pub(crate) fn lookup_deferred_tool(
    name: &str,
    dispatcher: Option<&Arc<HostCapabilityDispatcher>>,
) -> Option<DeferredTool> {
    if let Some(tool) = cached_builtin_deferred_tools()
        .iter()
        .find(|tool| tool.name == name)
    {
        return Some(tool.clone());
    }
    tool_fs::dynamic_capability_manifests(dispatcher)
        .iter()
        .map(deferred_from_manifest)
        .find(|tool| tool.name == name)
}

fn catalog_entries(tools: &[DeferredTool]) -> Vec<CatalogEntry> {
    tools
        .iter()
        .map(|tool| {
            if let Some(manifest) = &tool.manifest {
                catalog_entry_from_manifest(manifest)
            } else {
                CatalogEntry {
                    name: tool.name.clone(),
                    description: tool.description.clone(),
                    source_name: tool.source_name.clone(),
                    tokens: lyra_tool_fs_core::tokenize(&format!(
                        "{} {}",
                        tool.name.replace('_', " "),
                        tool.description
                    )),
                }
            }
        })
        .collect()
}

fn tool_search_description(tools: &[DeferredTool], max_tokens: usize) -> String {
    let entries = catalog_entries(tools);
    let (listing, _) = build_catalog_listing(&entries, max_tokens, TOOL_SEARCH_TOOL_NAME);
    match listing {
        Some(listing) => format!(
            "{TOOL_SEARCH_PROMPT_HEAD} Deferred tools are listed below. {TOOL_SEARCH_PROMPT_TAIL}\n\n{listing}"
        ),
        None => format!("{TOOL_SEARCH_PROMPT_HEAD}{TOOL_SEARCH_PROMPT_TAIL}"),
    }
}

pub(crate) fn tool_search_provider_tool(tools: &[DeferredTool], max_tokens: usize) -> Value {
    function_tool(
        TOOL_SEARCH_TOOL_NAME,
        &tool_search_description(tools, max_tokens),
        json!({
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Query to find deferred tools. Use \"select:<tool_name>\" for direct selection, or keywords to search."
                },
                "max_results": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": MAX_SEARCH_LIMIT,
                    "default": DEFAULT_SEARCH_LIMIT,
                    "description": "Maximum number of results to return (default: 5)"
                }
            },
            "required": ["query"]
        }),
    )
}

fn mark_defer_loading(mut tool: Value) -> Value {
    if let Some(object) = tool.as_object_mut() {
        object.insert("defer_loading".to_string(), json!(true));
    }
    tool
}

fn mcp_capability_connected(manifest: &ToolManifest) -> bool {
    if !manifest.path.starts_with("/tools/mcp/capability/") {
        return true;
    }
    let Some((server_id, _)) = tool_fs::parse_mcp_capability_path(&manifest.path) else {
        return false;
    };
    crate::native_backend::mcp_catalog::registry_snapshot()
        .servers
        .iter()
        .any(|server| server.id == server_id && server.enabled && server.state == "connected")
}

fn promotable_discovered_names(snapshot: &Value, deferred: &[DeferredTool]) -> Vec<String> {
    discovered_tool_names(snapshot)
        .into_iter()
        .filter(|name| {
            deferred.iter().any(|tool| {
                tool.name == *name && tool.manifest.as_ref().is_none_or(mcp_capability_connected)
            })
        })
        .collect()
}

pub(crate) fn persist_discovered_snapshot(
    session_id: &str,
    dispatcher: Option<&Arc<HostCapabilityDispatcher>>,
) {
    let deferred = deferred_tools(dispatcher);
    let Ok(mut state) = state().lock() else {
        return;
    };
    let Some(session) = state.sessions.get_mut(session_id) else {
        return;
    };
    let names = promotable_discovered_names(&session.snapshot, &deferred);
    let encoded = json!(names);
    if session.snapshot.get(DISCOVERED_TOOL_NAMES_KEY) != Some(&encoded) {
        session.snapshot[DISCOVERED_TOOL_NAMES_KEY] = encoded;
        session.dirty = true;
    }
}

pub(crate) fn assemble_provider_tools(
    snapshot: &Value,
    dispatcher: Option<&Arc<HostCapabilityDispatcher>>,
    context_window: Option<usize>,
    defer_loading: bool,
) -> Vec<Value> {
    let deferred = deferred_tools(dispatcher);
    let budget = listing_token_budget(context_window.unwrap_or(128_000) as u64);
    let mut tools = eager_model_tools_without_search();
    tools.push(tool_search_provider_tool(&deferred, budget));
    tools.push(session_read_message_model_tool());
    for name in promotable_discovered_names(snapshot, &deferred) {
        if let Some(entry) = deferred.iter().find(|tool| tool.name == name) {
            let schema = if defer_loading {
                mark_defer_loading(entry.schema.clone())
            } else {
                entry.schema.clone()
            };
            tools.push(schema);
        }
    }
    tools
}

fn eager_model_tools_without_search() -> Vec<Value> {
    let mut tools = vec![clarification_ask_model_tool()];
    tools.extend(plan_model_tools());
    tools.push(agent_spawn_model_tool(None));
    tools.extend(codex_code_model_tools());
    tools
}

fn parse_select_names(query: &str) -> Option<Vec<String>> {
    let rest = query.trim().strip_prefix("select:")?;
    let names = rest
        .split(',')
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .collect::<Vec<_>>();
    (!names.is_empty()).then_some(names)
}

pub(crate) fn execute_tool_search(
    session_id: &str,
    turn_id: &str,
    dispatcher: Option<&Arc<HostCapabilityDispatcher>>,
    call: &ModelToolCall,
    started_at: &str,
) -> Value {
    let query = call
        .arguments
        .get("query")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_string();
    let limit = call
        .arguments
        .get("max_results")
        .and_then(Value::as_u64)
        .unwrap_or(DEFAULT_SEARCH_LIMIT as u64)
        .clamp(1, MAX_SEARCH_LIMIT as u64) as usize;
    let deferred = deferred_tools(dispatcher);
    let matches = if query.is_empty() {
        Vec::new()
    } else if let Some(names) = parse_select_names(&query) {
        names
            .into_iter()
            .filter(|name| deferred.iter().any(|tool| tool.name == *name))
            .collect::<Vec<_>>()
    } else {
        let entries = catalog_entries(&deferred);
        search_catalog(&entries, &query, limit)
            .into_iter()
            .map(|entry| entry.name.clone())
            .collect()
    };
    record_discovered_tool_names(session_id, &matches);
    let raw = json!({
        "matches": matches,
        "query": query,
        "total_deferred_tools": deferred.len(),
    });
    let content = if matches.is_empty() {
        format!("No matching deferred tools found for `{query}`.")
    } else {
        format!(
            "Loaded deferred tools: {}. Call them by name on the next turn.",
            matches.join(", ")
        )
    };
    let output = json!({
        "content": content,
        "raw": raw,
        "ok": true,
        "status": "completed",
    });
    record_tool_activity(
        session_id,
        turn_id,
        tool_activity(
            &call.id,
            TOOL_SEARCH_TOOL_NAME,
            "",
            "completed",
            call.arguments.clone(),
            Some(output.clone()),
            started_at,
            Some(now()),
        ),
        "toolFinished",
    );
    output
}

pub(crate) fn request_contains_tool(tools: &[Value], name: &str) -> bool {
    tools
        .iter()
        .any(|tool| tool.pointer("/function/name").and_then(Value::as_str) == Some(name))
}

pub(crate) fn schema_not_sent_if_needed(
    name: &str,
    request_tools: &[Value],
    dispatcher: Option<&Arc<HostCapabilityDispatcher>>,
) -> Option<Value> {
    if request_contains_tool(request_tools, name) || is_tool_search_name(name) {
        return None;
    }
    lookup_deferred_tool(name, dispatcher).map(|_| schema_not_sent_hint(name))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn select_query_promotes_exact_names() {
        let tools = deferred_tools(None);
        assert!(tools.iter().any(|tool| tool.name == "web_search"));
        let names = parse_select_names("select:web_search,missing_tool").unwrap();
        let matches = names
            .into_iter()
            .filter(|name| tools.iter().any(|tool| tool.name == *name))
            .collect::<Vec<_>>();
        assert_eq!(matches, vec!["web_search".to_string()]);
    }

    #[test]
    fn assemble_starts_with_eager_and_tool_search() {
        let tools = assemble_provider_tools(&json!({}), None, Some(128_000), false);
        let names: Vec<_> = tools
            .iter()
            .filter_map(|tool| tool.pointer("/function/name").and_then(Value::as_str))
            .collect();
        assert!(names.contains(&"read_file"));
        assert!(names.contains(&TOOL_SEARCH_TOOL_NAME));
        assert!(!names.contains(&"web_search"));
        assert!(!names.contains(&"todo_write"));
        assert!(!names.contains(&"tool_fs_run"));
    }

    #[test]
    fn assemble_promotes_discovered_tools() {
        let tools = assemble_provider_tools(
            &json!({ "discoveredToolNames": ["web_search"] }),
            None,
            Some(128_000),
            false,
        );
        let names: Vec<_> = tools
            .iter()
            .filter_map(|tool| tool.pointer("/function/name").and_then(Value::as_str))
            .collect();
        assert!(names.contains(&"web_search"));
    }

    #[test]
    fn compact_messages_rehydrate_discovered_names() {
        let tools = assemble_provider_tools(
            &json!({
                "messages": [{
                    "role": "tool",
                    "name": "ToolSearch",
                    "lyraDiscoveredTools": ["web_search"]
                }]
            }),
            None,
            Some(128_000),
            false,
        );
        let names: Vec<_> = tools
            .iter()
            .filter_map(|tool| tool.pointer("/function/name").and_then(Value::as_str))
            .collect();
        assert!(names.contains(&"web_search"));
    }

    #[test]
    fn schema_not_sent_for_undiscovered_deferred_name() {
        let hint = schema_not_sent_if_needed("web_search", &[], None).expect("hint");
        assert_eq!(
            hint.pointer("/error/code").and_then(Value::as_str),
            Some("tool_schema_not_sent")
        );
        assert!(
            hint["content"]
                .as_str()
                .is_some_and(|content| content.contains("select:web_search"))
        );
    }

    #[test]
    fn bm25_ranks_exact_deferred_name() {
        let tools = deferred_tools(None);
        let entries = catalog_entries(&tools);
        let matches = search_catalog(&entries, "web_search", 5);
        assert_eq!(
            matches.first().map(|entry| entry.name.as_str()),
            Some("web_search")
        );
    }

    #[test]
    fn assemble_drops_unknown_or_disconnected_mcp_names() {
        let tools = assemble_provider_tools(
            &json!({
                "discoveredToolNames": ["mcp__missing__tool", "web_search"]
            }),
            None,
            Some(128_000),
            false,
        );
        let names: Vec<_> = tools
            .iter()
            .filter_map(|tool| tool.pointer("/function/name").and_then(Value::as_str))
            .collect();
        assert!(names.contains(&"web_search"));
        assert!(!names.contains(&"mcp__missing__tool"));
    }
}
