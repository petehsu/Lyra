//! Memory tool for storing and recalling information across sessions

use super::{Tool, ToolContext, ToolOutput};
use crate::memory::agent_runtime::{AgentMemoryStore, SharedMemoryRecord, SharedMemoryStatus};
use anyhow::Result;
use async_trait::async_trait;
use serde::Deserialize;
use serde_json::{Value, json};

pub struct MemoryTool;

impl MemoryTool {
    pub fn new() -> Self {
        Self
    }

    /// Create a memory tool in test mode.
    ///
    /// Isolation is controlled by LYRA_AGENT_MEMORY_HOME so the tool always
    /// talks to the same structured store as the runtime.
    pub fn new_test() -> Self {
        Self
    }

    fn parse_scope(scope: Option<&str>, default: MemoryToolScope) -> Result<MemoryToolScope> {
        match scope.unwrap_or(default.as_input_str()) {
            "project" => Ok(MemoryToolScope::Project),
            "global" => Ok(MemoryToolScope::Global),
            "all" => Ok(MemoryToolScope::All),
            other => Err(anyhow::anyhow!(
                "Unknown scope: {}. Use project, global, or all",
                other
            )),
        }
    }

    fn parse_category(category: Option<&str>) -> Result<&'static str> {
        match category.unwrap_or("fact") {
            "fact" => Ok("fact"),
            "preference" => Ok("preference"),
            "entity" => Ok("entity"),
            "correction" => Ok("correction"),
            other => Err(anyhow::anyhow!(
                "invalid memory category: {}. Use fact, preference, entity, or correction",
                other
            )),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum MemoryToolScope {
    Project,
    Global,
    All,
}

impl MemoryToolScope {
    fn as_input_str(self) -> &'static str {
        match self {
            Self::Project => "project",
            Self::Global => "global",
            Self::All => "all",
        }
    }

    fn storage_filter(self) -> Option<&'static str> {
        match self {
            Self::Project => Some("project"),
            Self::Global => Some("global"),
            Self::All => None,
        }
    }

    fn remember_scope(self) -> &'static str {
        match self {
            Self::Project => "project",
            Self::Global | Self::All => "global",
        }
    }
}

#[derive(Debug, Deserialize)]
struct MemoryInput {
    action: String,
    #[serde(default)]
    content: Option<String>,
    #[serde(default)]
    category: Option<String>,
    #[serde(default)]
    query: Option<String>,
    #[serde(default)]
    id: Option<String>,
    #[serde(default)]
    tags: Option<Vec<String>>,
    #[serde(default)]
    scope: Option<String>,
    /// For link action: source memory ID
    #[serde(default)]
    from_id: Option<String>,
    /// For link action: target memory ID
    #[serde(default)]
    to_id: Option<String>,
    /// For link action: relationship weight (0.0-1.0)
    #[serde(default)]
    weight: Option<f32>,
    /// For related action: traversal depth (default: 2)
    #[serde(default)]
    depth: Option<usize>,
    /// For recall action: max results (default: 10)
    #[serde(default)]
    limit: Option<usize>,
    /// For recall action: retrieval mode
    #[serde(default)]
    mode: Option<String>,
}

#[async_trait]
impl Tool for MemoryTool {
    fn name(&self) -> &str {
        "memory"
    }

    fn description(&self) -> &str {
        "Manage memory."
    }

    fn parameters_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "intent": super::intent_schema_property(),
                "action": {
                    "type": "string",
                    "enum": ["remember", "recall", "search", "list", "forget", "tag", "link", "related"],
                    "description": "Action."
                },
                "content": { "type": "string" },
                "category": {
                    "type": "string",
                    "enum": ["fact", "preference", "entity", "correction"]
                },
                "query": { "type": "string" },
                "id": { "type": "string" },
                "tags": { "type": "array", "items": { "type": "string" } },
                "scope": { "type": "string", "enum": ["project", "global", "all"] },
                "from_id": { "type": "string" },
                "to_id": { "type": "string" },
                "limit": { "type": "integer", "description": "Max results." }
            },
            "required": ["action"]
        })
    }

    async fn execute(&self, input: Value, ctx: ToolContext) -> Result<ToolOutput> {
        use crate::memory;
        use crate::memory_types::{MemoryEventKind, MemoryState};

        let input: MemoryInput = serde_json::from_value(input)?;
        let action_label = input.action.clone();
        let session_id_for_error = ctx.session_id.clone();

        match input.action.as_str() {
            "remember" => {
                let content = input
                    .content
                    .ok_or_else(|| anyhow::anyhow!("content required"))?;
                let category = Self::parse_category(input.category.as_deref())?;
                let scope = Self::parse_scope(input.scope.as_deref(), MemoryToolScope::Project)?;
                let storage_scope = scope.remember_scope();
                memory::set_state(MemoryState::ToolAction {
                    action: "remember".into(),
                    detail: truncate_for_widget(&content, 40),
                });
                let tags = input.tags.unwrap_or_default();
                let store = AgentMemoryStore::new_default()?;
                let record = store.update_shared_memory(
                    storage_scope,
                    json!({
                        "category": category,
                        "content": content,
                        "tags": tags,
                        "sourceSessionId": ctx.session_id.clone(),
                        "sourceMessageId": ctx.message_id.clone(),
                        "sourceToolCallId": ctx.tool_call_id.clone(),
                        "scope": storage_scope
                    }),
                    evidence_refs_for_tool(&ctx),
                    SharedMemoryStatus::Active,
                    false,
                )?;
                memory::add_event(MemoryEventKind::ToolRemembered {
                    content: truncate_for_widget(&content, 60),
                    scope: storage_scope.to_string(),
                    category: category.to_string(),
                });
                memory::set_state(MemoryState::Idle);
                Ok(ToolOutput::new(format!(
                    "Remembered {} ({}): \"{}\" [id: {}]",
                    category, storage_scope, content, record.memory_id
                )))
            }
            "recall" => {
                let limit = input.limit.unwrap_or(10);
                let scope = Self::parse_scope(input.scope.as_deref(), MemoryToolScope::All)?;
                let mode = input.mode.as_deref().unwrap_or_else(|| {
                    if input.query.is_some() {
                        "cascade"
                    } else {
                        "recent"
                    }
                });

                match mode {
                    "recent" => {
                        memory::set_state(MemoryState::ToolAction {
                            action: "recall".into(),
                            detail: "recent".into(),
                        });
                        let store = AgentMemoryStore::new_default()?;
                        let results = limited_records(
                            store.search_shared_memory_scoped(None, scope.storage_filter())?,
                            limit,
                        );
                        memory::add_event(MemoryEventKind::ToolRecalled {
                            query: "(recent)".into(),
                            count: results.len(),
                        });
                        let result = if results.is_empty() {
                            Ok(ToolOutput::new("No memories stored yet."))
                        } else {
                            Ok(ToolOutput::new(format_records(
                                &format!("Recent memories ({})", results.len()),
                                &results,
                            )))
                        };
                        memory::set_state(MemoryState::Idle);
                        result
                    }
                    "semantic" | "cascade" => {
                        let query = match &input.query {
                            Some(q) => q.clone(),
                            None => {
                                return Err(anyhow::anyhow!(
                                    "query required for semantic/cascade mode"
                                ));
                            }
                        };
                        memory::set_state(MemoryState::ToolAction {
                            action: "recall".into(),
                            detail: truncate_for_widget(&query, 40),
                        });

                        let store = AgentMemoryStore::new_default()?;
                        let (results, fallback_used) =
                            search_runtime_memories(&store, &query, scope, limit)?;

                        memory::add_event(MemoryEventKind::ToolRecalled {
                            query: truncate_for_widget(&query, 40),
                            count: results.len(),
                        });
                        memory::set_state(MemoryState::Idle);

                        if results.is_empty() {
                            Ok(ToolOutput::new(format!(
                                "No memories found matching '{}'. Try recall without query to see recent memories.",
                                query
                            )))
                        } else {
                            let title = if fallback_used {
                                format!(
                                    "No exact text match for '{}'; active runtime memories ({})",
                                    query,
                                    results.len()
                                )
                            } else {
                                format!("Found {} memories for '{}'", results.len(), query)
                            };
                            Ok(ToolOutput::new(format_records(&title, &results)))
                        }
                    }
                    other => Err(anyhow::anyhow!(
                        "Unknown mode: {}. Use recent, semantic, or cascade",
                        other
                    )),
                }
            }
            "search" => {
                let query = input
                    .query
                    .ok_or_else(|| anyhow::anyhow!("query required"))?;
                let scope = Self::parse_scope(input.scope.as_deref(), MemoryToolScope::All)?;
                let limit = input.limit.unwrap_or(10);
                memory::set_state(MemoryState::ToolAction {
                    action: "search".into(),
                    detail: truncate_for_widget(&query, 40),
                });
                let store = AgentMemoryStore::new_default()?;
                let (results, fallback_used) = search_runtime_memories(&store, &query, scope, limit)?;
                memory::add_event(MemoryEventKind::ToolRecalled {
                    query: truncate_for_widget(&query, 40),
                    count: results.len(),
                });
                memory::set_state(MemoryState::Idle);
                if results.is_empty() {
                    Ok(ToolOutput::new(format!("No memories matching '{}'", query)))
                } else {
                    let title = if fallback_used {
                        format!(
                            "No exact text match for '{}'; active runtime memories ({})",
                            query,
                            results.len()
                        )
                    } else {
                        format!("Found {} memories for '{}'", results.len(), query)
                    };
                    Ok(ToolOutput::new(format_records(&title, &results)))
                }
            }
            "list" => {
                let scope = Self::parse_scope(input.scope.as_deref(), MemoryToolScope::All)?;
                let limit = input.limit.unwrap_or(50);
                memory::set_state(MemoryState::ToolAction {
                    action: "list".into(),
                    detail: String::new(),
                });
                let store = AgentMemoryStore::new_default()?;
                let all = limited_records(
                    store.search_shared_memory_scoped(None, scope.storage_filter())?,
                    limit,
                );
                memory::add_event(MemoryEventKind::ToolListed { count: all.len() });
                memory::set_state(MemoryState::Idle);
                if all.is_empty() {
                    Ok(ToolOutput::new("No memories stored."))
                } else {
                    Ok(ToolOutput::new(format_records(
                        &format!("All memories ({})", all.len()),
                        &all,
                    )))
                }
            }
            "forget" => {
                let id = input.id.ok_or_else(|| anyhow::anyhow!("id required"))?;
                memory::set_state(MemoryState::ToolAction {
                    action: "forget".into(),
                    detail: truncate_for_widget(&id, 30),
                });
                let store = AgentMemoryStore::new_default()?;
                let found = store.deprecate_shared_memory(&id)?;
                memory::add_event(MemoryEventKind::ToolForgot { id: id.clone() });
                memory::set_state(MemoryState::Idle);
                if found {
                    Ok(ToolOutput::new(format!("Forgot: {}", id)))
                } else {
                    Ok(ToolOutput::new(format!("Not found: {}", id)))
                }
            }
            "tag" => {
                let id = input.id.ok_or_else(|| anyhow::anyhow!("id required"))?;
                let tags = input.tags.ok_or_else(|| anyhow::anyhow!("tags required"))?;

                if tags.is_empty() {
                    return Err(anyhow::anyhow!("At least one tag required"));
                }

                memory::set_state(MemoryState::ToolAction {
                    action: "tag".into(),
                    detail: format!("{} +{}", truncate_for_widget(&id, 20), tags.join(",")),
                });
                let tags_str = tags.join(", ");
                memory::set_state(MemoryState::Idle);

                Ok(ToolOutput::new(format!(
                    "Memory tagging is not a separate graph operation in the runtime store. Use memory remember with tags to create a structured memory instead. Requested tag update for {}: {}",
                    id, tags_str
                )))
            }
            "link" => {
                let from_id = input
                    .from_id
                    .ok_or_else(|| anyhow::anyhow!("from_id required"))?;
                let to_id = input
                    .to_id
                    .ok_or_else(|| anyhow::anyhow!("to_id required"))?;
                let weight = input.weight.unwrap_or(0.5);

                memory::set_state(MemoryState::ToolAction {
                    action: "link".into(),
                    detail: format!(
                        "{} -> {}",
                        truncate_for_widget(&from_id, 15),
                        truncate_for_widget(&to_id, 15)
                    ),
                });
                memory::set_state(MemoryState::Idle);
                Ok(ToolOutput::new(format!(
                    "Runtime memory does not maintain editable graph links. Active memories are returned through structured search/context. Requested link {} -> {} (weight {:.2}) was not written to legacy storage.",
                    from_id, to_id, weight
                )))
            }
            "related" => {
                let id = input.id.ok_or_else(|| anyhow::anyhow!("id required"))?;
                let depth = input.depth.unwrap_or(2);

                memory::set_state(MemoryState::ToolAction {
                    action: "related".into(),
                    detail: truncate_for_widget(&id, 30),
                });
                let store = AgentMemoryStore::new_default()?;
                let related = limited_records(
                    store.search_shared_memory_scoped(None, None)?,
                    input.limit.unwrap_or(depth.max(1) * 5),
                );
                memory::add_event(MemoryEventKind::ToolRecalled {
                    query: format!("related:{}", truncate_for_widget(&id, 20)),
                    count: related.len(),
                });
                memory::set_state(MemoryState::Idle);

                if related.is_empty() {
                    Ok(ToolOutput::new(format!(
                        "No active runtime memories available while checking related memories for {}",
                        id
                    )))
                } else {
                    Ok(ToolOutput::new(format_records(
                        &format!(
                            "Runtime memory has no graph traversal; active memories while checking {} (depth {})",
                            id, depth
                        ),
                        &related,
                    )))
                }
            }
            other => Err(anyhow::anyhow!("Unknown action: {}", other)),
        }
        .map_err(|err| {
            crate::logging::warn(&format!(
                "[tool:memory] action failed action={} session_id={} error={}",
                action_label, session_id_for_error, err
            ));
            err
        })
    }
}

fn truncate_for_widget(s: &str, max: usize) -> String {
    if s.chars().count() > max {
        let truncated: String = s.chars().take(max).collect();
        format!("{}…", truncated)
    } else {
        s.to_string()
    }
}

fn evidence_refs_for_tool(ctx: &ToolContext) -> Vec<String> {
    [
        ("session", ctx.session_id.as_str()),
        ("message", ctx.message_id.as_str()),
        ("tool_call", ctx.tool_call_id.as_str()),
    ]
    .into_iter()
    .filter_map(|(kind, value)| {
        let value = value.trim();
        if value.is_empty() {
            None
        } else {
            Some(format!("{kind}:{value}"))
        }
    })
    .collect()
}

fn search_runtime_memories(
    store: &AgentMemoryStore,
    query: &str,
    scope: MemoryToolScope,
    limit: usize,
) -> Result<(Vec<SharedMemoryRecord>, bool)> {
    let exact = limited_records(
        store.search_shared_memory_scoped(Some(query), scope.storage_filter())?,
        limit,
    );
    if !exact.is_empty() {
        return Ok((exact, false));
    }

    let active = limited_records(
        store.search_shared_memory_scoped(None, scope.storage_filter())?,
        limit,
    );
    let fallback_used = !active.is_empty();
    Ok((active, fallback_used))
}

fn limited_records(mut records: Vec<SharedMemoryRecord>, limit: usize) -> Vec<SharedMemoryRecord> {
    records.truncate(limit);
    records
}

fn format_records(title: &str, records: &[SharedMemoryRecord]) -> String {
    let mut out = format!("{title}:\n\n");
    for record in records {
        let category = record_category(record);
        let content = record_content(record);
        let tags = record_tags(record);
        let tags = if tags.is_empty() {
            String::new()
        } else {
            format!(" [{}]", tags.join(", "))
        };
        out.push_str(&format!(
            "- [{}] {}{}\n  id: {}\n  scope: {}\n\n",
            category, content, tags, record.memory_id, record.scope
        ));
    }
    out
}

fn record_category(record: &SharedMemoryRecord) -> String {
    record
        .content_json
        .get("category")
        .and_then(Value::as_str)
        .unwrap_or("fact")
        .to_string()
}

fn record_content(record: &SharedMemoryRecord) -> String {
    record
        .content_json
        .get("content")
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| record.content_json.to_string())
}

fn record_tags(record: &SharedMemoryRecord) -> Vec<String> {
    record
        .content_json
        .get("tags")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::memory::agent_runtime::{ContextLayerKind, CreateSessionInput, NewSessionEvent};
    use crate::tool::ToolExecutionMode;
    use std::ffi::OsString;
    use std::sync::MutexGuard;

    struct AgentMemoryToolTestEnv {
        _guard: MutexGuard<'static, ()>,
        _dir: tempfile::TempDir,
        previous_memory_home: Option<OsString>,
    }

    impl Drop for AgentMemoryToolTestEnv {
        fn drop(&mut self) {
            if let Some(previous) = self.previous_memory_home.clone() {
                crate::env::set_var("LYRA_AGENT_MEMORY_HOME", previous);
            } else {
                crate::env::remove_var("LYRA_AGENT_MEMORY_HOME");
            }
        }
    }

    fn isolated_agent_memory_env() -> AgentMemoryToolTestEnv {
        let guard = crate::storage::lock_test_env();
        let dir = tempfile::TempDir::new().expect("agent memory temp dir");
        let previous_memory_home = std::env::var_os("LYRA_AGENT_MEMORY_HOME");
        crate::env::set_var("LYRA_AGENT_MEMORY_HOME", dir.path().join("agent-memory"));
        AgentMemoryToolTestEnv {
            _guard: guard,
            _dir: dir,
            previous_memory_home,
        }
    }

    fn test_context(session_id: &str) -> ToolContext {
        ToolContext {
            session_id: session_id.to_string(),
            message_id: "message_test".to_string(),
            tool_call_id: "tool_call_memory_test".to_string(),
            working_dir: None,
            stdin_request_tx: None,
            graceful_shutdown_signal: None,
            execution_mode: ToolExecutionMode::Direct,
        }
    }

    #[test]
    fn schema_only_advertises_core_memory_fields() {
        let schema = MemoryTool::new().parameters_schema();
        let props = schema["properties"]
            .as_object()
            .expect("memory schema should have properties");

        assert!(props.contains_key("action"));
        assert!(props.contains_key("content"));
        assert!(props.contains_key("category"));
        assert!(props.contains_key("query"));
        assert!(props.contains_key("id"));
        assert!(props.contains_key("tags"));
        assert!(props.contains_key("scope"));
        assert!(props.contains_key("from_id"));
        assert!(props.contains_key("to_id"));
        assert!(props.contains_key("limit"));
        assert!(!props.contains_key("weight"));
        assert!(!props.contains_key("depth"));
        assert!(!props.contains_key("mode"));
    }

    #[tokio::test]
    async fn remember_writes_active_shared_memory_and_context_injects_it() {
        let _env = isolated_agent_memory_env();
        let tool = MemoryTool::new();
        let output = tool
            .execute(
                json!({
                    "action": "remember",
                    "content": "用户的名字叫徐远豪",
                    "category": "entity",
                    "tags": ["identity"]
                }),
                test_context("session_memory_write"),
            )
            .await
            .expect("remember");
        assert!(output.output.contains("Remembered entity"));

        let store = AgentMemoryStore::new_default().expect("agent memory store");
        let records = store.search_shared_memory(None).expect("shared memories");
        assert_eq!(records.len(), 1);
        assert_eq!(records[0].status, SharedMemoryStatus::Active);
        assert_eq!(records[0].content_json["content"], "用户的名字叫徐远豪");

        let session = store
            .ensure_session_with_id("session_memory_context", CreateSessionInput::default())
            .expect("session");
        let user_event = store
            .append_event(
                &session.session_id,
                NewSessionEvent::user_message("你还记得我叫什么吗"),
            )
            .expect("user event");
        let turn = store
            .start_runtime_turn(&session.session_id, Some(&user_event.event_id), None)
            .expect("runtime turn");
        let context = store
            .build_context(&session.session_id, &turn.runtime_turn_id, 8_000)
            .expect("context");
        let shared_memory_layer = context
            .layers
            .iter()
            .find(|layer| layer.kind == ContextLayerKind::SharedFrozenMemory)
            .expect("shared memory layer");
        assert!(
            shared_memory_layer
                .payload_json
                .to_string()
                .contains("徐远豪")
        );
    }

    #[tokio::test]
    async fn search_and_forget_use_runtime_shared_memory() {
        let _env = isolated_agent_memory_env();
        let tool = MemoryTool::new();
        tool.execute(
            json!({
                "action": "remember",
                "content": "用户的名字叫徐远豪",
                "category": "entity"
            }),
            test_context("session_memory_search"),
        )
        .await
        .expect("remember");

        let search = tool
            .execute(
                json!({
                    "action": "search",
                    "query": "user identity info"
                }),
                test_context("session_memory_search"),
            )
            .await
            .expect("search");
        assert!(search.output.contains("徐远豪"));

        let store = AgentMemoryStore::new_default().expect("agent memory store");
        let id = store
            .search_shared_memory(None)
            .expect("shared memories")
            .pop()
            .expect("record")
            .memory_id;
        let forget = tool
            .execute(
                json!({
                    "action": "forget",
                    "id": id
                }),
                test_context("session_memory_search"),
            )
            .await
            .expect("forget");
        assert!(forget.output.contains("Forgot"));
        assert!(
            store
                .search_shared_memory(None)
                .expect("shared memories after forget")
                .is_empty()
        );
    }
}
