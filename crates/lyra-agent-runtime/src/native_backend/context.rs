use super::*;

fn browser_snapshot_active_tab(snapshot: &Value) -> Option<&Value> {
    let active_tab_id = snapshot.get("activeTabId").and_then(Value::as_str)?;
    snapshot
        .get("tabs")
        .and_then(Value::as_array)?
        .iter()
        .find(|tab| tab.get("tabId").and_then(Value::as_str) == Some(active_tab_id))
}

fn compact_browser_storage_state(snapshot: &Value) -> Value {
    let Some(storage) = snapshot
        .get("storageState")
        .filter(|value| value.is_object())
    else {
        return Value::Null;
    };
    let sites = storage
        .get("sites")
        .and_then(Value::as_array)
        .map(|items| items.iter().take(8).cloned().collect::<Vec<_>>())
        .unwrap_or_default();
    json!({
        "schemaVersion": storage.get("schemaVersion").cloned().unwrap_or(Value::Null),
        "profileId": storage.get("profileId").cloned().unwrap_or(Value::Null),
        "profileMode": storage.get("profileMode").cloned().unwrap_or(Value::Null),
        "profilePartition": storage.get("profilePartition").cloned().unwrap_or(Value::Null),
        "persistence": storage.get("persistence").cloned().unwrap_or(Value::Null),
        "cookies": storage.get("cookies").cloned().unwrap_or(Value::Null),
        "localStorage": storage.get("localStorage").cloned().unwrap_or(Value::Null),
        "indexedDB": storage.get("indexedDB").cloned().unwrap_or(Value::Null),
        "sessionStorage": storage.get("sessionStorage").cloned().unwrap_or(Value::Null),
        "cacheStorage": storage.get("cacheStorage").cloned().unwrap_or(Value::Null),
        "relationship": storage.get("relationship").cloned().unwrap_or(Value::Null),
        "sites": sites,
        "privacy": {
            "cookieValues": "not_exposed",
            "storageValues": "not_exposed",
            "sensitiveValues": "metadata_only"
        }
    })
}

fn compact_browser_tab(tab: &Value) -> Value {
    let restore = tab.get("restoreState").unwrap_or(&Value::Null);
    let history = restore.get("history").unwrap_or(&Value::Null);
    let history_entries = history
        .get("entries")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let current_index = history
        .get("currentIndex")
        .and_then(Value::as_i64)
        .unwrap_or(-1);
    let current_entry = usize::try_from(current_index)
        .ok()
        .and_then(|index| history_entries.get(index))
        .cloned()
        .unwrap_or(Value::Null);

    json!({
        "tabId": tab.get("tabId").cloned().unwrap_or(Value::Null),
        "address": tab.get("address").cloned().unwrap_or(Value::Null),
        "title": tab.get("title").cloned().unwrap_or(Value::Null),
        "profilePartition": tab.get("profilePartition").cloned().unwrap_or(Value::Null),
        "lifecycleState": tab.get("lifecycleState").cloned().unwrap_or(Value::Null),
        "recoveryFailure": tab.get("recoveryFailure").cloned().unwrap_or(Value::Null),
        "restoreState": {
            "scrollX": restore.get("scrollX").cloned().unwrap_or(Value::Null),
            "scrollY": restore.get("scrollY").cloned().unwrap_or(Value::Null),
            "viewport": restore.get("viewport").cloned().unwrap_or(Value::Null),
            "loadState": restore.get("loadState").cloned().unwrap_or(Value::Null),
            "activeElement": restore.get("activeElement").cloned().unwrap_or(Value::Null),
            "formDraft": restore.get("formDraft").cloned().unwrap_or(Value::Null),
            "targetRegistry": restore.get("targetRegistry").cloned().unwrap_or(Value::Null),
            "storage": restore.get("storage").cloned().unwrap_or(Value::Null),
            "textHash": restore.get("textHash").cloned().unwrap_or(Value::Null),
            "capturedAt": restore.get("capturedAt").cloned().unwrap_or(Value::Null),
            "history": {
                "currentIndex": current_index,
                "entryCount": history_entries.len(),
                "currentEntry": current_entry,
                "canGoBack": tab.get("canGoBack").cloned().unwrap_or(Value::Null),
                "canGoForward": tab.get("canGoForward").cloned().unwrap_or(Value::Null)
            }
        }
    })
}

fn browser_recovery_failures(snapshot: &Value) -> Vec<Value> {
    snapshot
        .get("tabs")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|tab| {
            let failure = tab.get("recoveryFailure")?.clone();
            Some(json!({
                "tabId": tab.get("tabId").cloned().unwrap_or(Value::Null),
                "address": tab.get("address").cloned().unwrap_or(Value::Null),
                "title": tab.get("title").cloned().unwrap_or(Value::Null),
                "failure": failure
            }))
        })
        .collect()
}

fn compact_browser_recovery_context(snapshot: Value) -> Value {
    if snapshot.is_null() {
        return json!({
            "hostCapabilityAvailable": true,
            "snapshotAvailable": false,
            "message": "No BrowserSessionSnapshot has been captured yet."
        });
    }
    let active_tab = browser_snapshot_active_tab(&snapshot)
        .map(compact_browser_tab)
        .unwrap_or(Value::Null);
    json!({
        "hostCapabilityAvailable": true,
        "snapshotAvailable": true,
        "schemaVersion": snapshot.get("schemaVersion").cloned().unwrap_or(Value::Null),
        "snapshotId": snapshot.get("snapshotId").cloned().unwrap_or(Value::Null),
        "capturedAt": snapshot.get("capturedAt").cloned().unwrap_or(Value::Null),
        "activeTabId": snapshot.get("activeTabId").cloned().unwrap_or(Value::Null),
        "activeTab": active_tab,
        "recoveryAnchor": snapshot.get("recoveryAnchor").cloned().unwrap_or(Value::Null),
        "storageState": compact_browser_storage_state(&snapshot),
        "recoveryFailures": browser_recovery_failures(&snapshot),
        "privacy": {
            "cookieValues": "not_exposed",
            "storageValues": "not_exposed",
            "formDraftValues": "redacted_metadata_only",
            "modelMayReadAuthState": "logged_in_or_requires_user_metadata_only"
        }
    })
}

fn browser_recovery_context(dispatcher: Option<&Arc<HostCapabilityDispatcher>>) -> Value {
    let Some(dispatcher) = dispatcher else {
        return json!({
            "hostCapabilityAvailable": false,
            "snapshotAvailable": false,
            "message": "Browser session recovery bridge is not available."
        });
    };
    match invoke_host_capability(
        dispatcher,
        "workbench.browser.readSessionSnapshot",
        json!({ "includeRecoveryAnchor": true, "includeStorageState": true }),
    ) {
        Ok(snapshot) => compact_browser_recovery_context(snapshot),
        Err(error) => json!({
            "hostCapabilityAvailable": false,
            "snapshotAvailable": false,
            "error": error
        }),
    }
}

pub(crate) fn build_runtime_context(
    dispatcher: Option<&Arc<HostCapabilityDispatcher>>,
    memory_records: &[LongTermMemoryRecord],
    capabilities: &ModelCapabilityProfile,
) -> Value {
    let workbench = dispatcher
        .and_then(|dispatcher| {
            invoke_host_capability(
                dispatcher,
                "workbench.listTabs",
                json!({ "scope": "all", "includeUnsupported": true }),
            )
            .ok()
        })
        .unwrap_or_else(|| {
            json!({
                "hostCapabilityAvailable": false,
                "message": "Workbench observation bridge is not available."
            })
        });
    let software = dispatcher
        .and_then(|dispatcher| {
            invoke_host_capability(
                dispatcher,
                "software.listCapabilities",
                json!({ "includeSchemas": false }),
            )
            .ok()
        })
        .unwrap_or_else(|| {
            json!({
                "hostCapabilityAvailable": false,
                "software": [],
                "message": "Software capability bridge is not available."
            })
        });
    let memory = memory_records
        .iter()
        .rev()
        .take(12)
        .map(|record| {
            json!({
                "id": record.id,
                "scope": record.scope,
                "category": record.category,
                "fact": record.fact,
                "status": record.status,
                "content": record.content,
                "confidence": record.confidence,
                "sourceType": record.source_type,
                "updatedAt": record.updated_at,
                "priority": record.priority,
                "lastAccessedAt": record.last_accessed_at,
                "accessCount": record.access_count,
            })
        })
        .collect::<Vec<_>>();
    json!({
        "identity": "Lyra Agent",
        "workbench": workbench,
        "browserRecovery": browser_recovery_context(dispatcher),
        "browserModePolicy": {
            "defaultTargetMode": "live",
            "followControl": "visible Follow cursor is controlled by the user's real Follow toggle, not by targetMode",
            "isolatedAuthState": "isolated pages use a separate profile unless a tool explicitly requests authState=borrowLiveLogin and the user grants permission",
            "modeEvidence": "Lumen results include browserMode with targetMode, visibleFollow, authState, reason, and profilePartition"
        },
        "software": software,
        "memory": memory,
        "tools": if capabilities.supports_tool_calling { model_tool_names(false) } else { Vec::new() },
        "network": network_runtime_context(),
        "sensitiveValues": {
            "refKind": "lyra-sensitive-value-ref",
            "ownership": "user_owned",
            "modelVisibility": "metadata_only",
            "plaintextVisibility": "user_reveal_only",
            "rule": "Use refs as model-opaque ownership handles. Never request or emit plaintext secrets in model-visible content."
        },
        "capabilities": {
            "supportsImageInput": capabilities.supports_image_input,
            "supportsToolCalling": capabilities.supports_tool_calling,
            "supportsStreaming": capabilities.supports_streaming,
            "contextWindow": capabilities.context_window,
        },
    })
}

pub(crate) fn build_system_prompt(
    runtime_context: &Value,
    active_skill_prompt: &str,
    design_research_required: bool,
    memory_prompt: &str,
) -> String {
    prompt_policy::build_system_prompt(&PromptPolicyInput {
        runtime_context: runtime_context.clone(),
        active_skill_prompt: active_skill_prompt.to_string(),
        memory_prompt: memory_prompt.to_string(),
        design_research_required,
        accounting: PromptAccounting {
            system_budget: 1200,
            tools_budget: 800,
            memory_budget: 600,
            history_budget: 0,
            artifact_budget: 0,
        },
    })
}

pub(crate) fn model_tools(design_research_required: bool) -> Vec<Value> {
    if env::var_os("LYRA_AGENT_DISABLE_TOOL_REGISTRY").is_none() {
        let mut tools = ToolActivityService::default().model_provider_tools();
        if design_research_required {
            tools.extend(design_tools::design_model_tools());
        }
        tools.push(turn_finish_model_tool());
        return tools;
    }
    vec![
        turn_finish_model_tool(),
        function_tool(
            "artifact_read",
            "Read a Lyra-owned artifact such as a Lumen screenshot, message image, or tool-output artifact by artifact id, path, source URI, or openTarget path.",
            json!({
                "type": "object",
                "properties": {
                    "artifactId": { "type": "string" },
                    "id": { "type": "string" },
                    "path": { "type": "string" },
                    "source": { "type": "string" },
                    "maxBytes": { "type": "number" }
                }
            }),
        ),
        function_tool(
            "memory_search",
            "Search Lyra long-term shared memory.",
            json!({
                "type": "object",
                "properties": {
                    "query": { "type": "string" },
                    "scope": { "type": "string" },
                    "category": { "type": "string" },
                    "status": { "type": "string", "enum": ["active", "archived", "superseded", "forgotten"] },
                    "includeRelated": { "type": "boolean", "default": true },
                    "explain": { "type": "boolean", "default": true },
                    "minScore": { "type": "number", "minimum": 0 },
                    "limit": { "type": "integer", "minimum": 1, "maximum": 500 }
                }
            }),
        ),
        function_tool(
            "memory_remember",
            "Write a durable fact, user preference, name, identity, or project instruction to Lyra long-term memory.",
            json!({
            "type": "object",
                "properties": {
                    "scope": { "type": "string", "default": "global" },
                    "fact": { "type": "string" },
                    "category": { "type": "string", "enum": ["user_profile", "preference", "project", "instruction", "goal", "other"], "default": "other" },
                    "confidence": { "type": "number", "minimum": 0, "maximum": 1 },
                    "sourceType": { "type": "string", "enum": ["user_declaration", "agent_inference", "tool_observation", "project_fact", "goal_sync", "imported"], "default": "agent_inference" },
                    "sourceRef": { "type": "string" },
                    "tags": { "type": "array", "items": { "type": "string" } },
                    "expiresAt": { "type": "string" }
                },
                "required": ["fact"]
            }),
        ),
        function_tool(
            "memory_update",
            "Update an existing Lyra long-term memory record by id.",
            json!({
                "type": "object",
                "properties": {
                    "id": { "type": "string" },
                    "fact": { "type": "string" },
                    "content": { "type": "object" },
                    "scope": { "type": "string" },
                    "category": { "type": "string", "enum": ["user_profile", "preference", "project", "instruction", "goal", "other"] },
                    "confidence": { "type": "number", "minimum": 0, "maximum": 1 },
                    "sourceType": { "type": "string", "enum": ["user_declaration", "agent_inference", "tool_observation", "project_fact", "goal_sync", "imported"] },
                    "tags": { "type": "array", "items": { "type": "string" } },
                    "expiresAt": { "type": "string" },
                    "status": { "type": "string", "enum": ["active", "archived", "superseded", "forgotten"] },
                    "supersedes": { "type": "string" },
                    "supersededBy": { "type": "string" }
                },
                "required": ["id"]
            }),
        ),
        function_tool(
            "memory_forget",
            "Archive, tombstone, or explicitly hard-delete a Lyra long-term memory record.",
            json!({
                "type": "object",
                "properties": {
                    "id": { "type": "string" },
                    "ids": { "type": "array", "items": { "type": "string" } },
                    "mode": { "type": "string", "enum": ["archive", "tombstone", "hard_delete"], "default": "archive" },
                    "reason": { "type": "string" }
                }
            }),
        ),
        function_tool(
            "memory_list",
            "List Lyra long-term memory summaries for audit.",
            json!({
                "type": "object",
                "properties": {
                    "query": { "type": "string" },
                    "scope": { "type": "string" },
                    "category": { "type": "string" },
                    "status": { "type": "string", "enum": ["active", "archived", "superseded", "forgotten"] },
                    "includeArchived": { "type": "boolean", "default": false },
                    "includeRelated": { "type": "boolean", "default": false },
                    "explain": { "type": "boolean", "default": true },
                    "minScore": { "type": "number", "minimum": 0 },
                    "limit": { "type": "integer", "minimum": 1, "maximum": 500 },
                    "offset": { "type": "integer", "minimum": 0 }
                }
            }),
        ),
        function_tool(
            "memory_link",
            "Create or update a relation between two Lyra long-term memory records.",
            json!({
                "type": "object",
                "properties": {
                    "sourceId": { "type": "string" },
                    "targetId": { "type": "string" },
                    "relation": {
                        "type": "string",
                        "enum": ["related_to", "supports", "contradicts", "supersedes", "belongs_to_project", "same_user_preference", "derived_from"],
                        "default": "related_to"
                    },
                    "confidence": { "type": "number", "minimum": 0, "maximum": 1, "default": 1 }
                },
                "required": ["sourceId", "targetId", "relation"]
            }),
        ),
        function_tool(
            "memory_review_candidates",
            "Review pending Lyra memory candidates without mixing them into chat messages.",
            json!({
                "type": "object",
                "properties": {
                    "status": { "type": "string", "enum": ["pending", "auto_applied", "needs_user_confirmation", "approved", "rejected", "expired"], "default": "pending" },
                    "limit": { "type": "integer", "minimum": 1, "maximum": 500 }
                }
            }),
        ),
        function_tool(
            "memory_apply_candidate",
            "Apply a reviewed Lyra memory candidate.",
            json!({
                "type": "object",
                "properties": {
                    "id": { "type": "string" }
                },
                "required": ["id"]
            }),
        ),
        function_tool(
            "memory_reject_candidate",
            "Reject a Lyra memory candidate.",
            json!({
                "type": "object",
                "properties": {
                    "id": { "type": "string" },
                    "reason": { "type": "string" }
                },
                "required": ["id"]
            }),
        ),
        function_tool(
            "memory_explain_injection",
            "Explain which long-term memories were injected for the current or requested turn and why.",
            json!({
                "type": "object",
                "properties": {
                    "sessionId": { "type": "string" },
                    "turnId": { "type": "string" }
                }
            }),
        ),
        function_tool(
            "ask_user",
            "Ask the user a structured clarification question through Lyra's decision panel. Use this instead of writing a plain assistant question when the turn is blocked on user input.",
            json!({
                "type": "object",
                "properties": {
                    "question": { "type": "string" },
                    "options": {
                        "type": "array",
                        "items": {
                            "oneOf": [
                                { "type": "string" },
                                {
                                    "type": "object",
                                    "properties": {
                                        "label": { "type": "string" },
                                        "description": { "type": "string" }
                                    },
                                    "required": ["label"]
                                }
                            ]
                        }
                    },
                    "allowCustomAnswer": { "type": "boolean", "default": true },
                    "detail": { "type": "string" }
                },
                "required": ["question"]
            }),
        ),
        function_tool(
            "workbench_list_tabs",
            "List Lyra workbench tabs, including browser, file, image, terminal, and other app tabs.",
            json!({
                "type": "object",
                "properties": {
                    "scope": { "type": "string", "enum": ["all", "visible", "active"], "default": "all" },
                    "includeUnsupported": { "type": "boolean", "default": true }
                }
            }),
        ),
        function_tool(
            "workbench_read_workspace",
            "Read the currently visible Lyra workspace state.",
            json!({
                "type": "object",
                "properties": {
                    "detail": { "type": "string", "enum": ["summary", "full"], "default": "summary" }
                }
            }),
        ),
        function_tool(
            "workbench_read_tab",
            "Read one Lyra workbench tab by id. Use this for non-browser app tabs or tab summaries.",
            json!({
                "type": "object",
                "properties": {
                    "tabId": { "type": "string" },
                    "detail": { "type": "string", "enum": ["summary", "full"], "default": "summary" }
                },
                "required": ["tabId"]
            }),
        ),
        function_tool(
            "workbench_activate_tab",
            "Activate a Lyra workbench tab by id.",
            json!({
                "type": "object",
                "properties": {
                    "tabId": { "type": "string" }
                },
                "required": ["tabId"]
            }),
        ),
        function_tool(
            "terminal_list",
            "List Agent private and visible Workbench terminal sessions.",
            json!({
                "type": "object",
                "properties": {}
            }),
        ),
        function_tool(
            "terminal_create",
            "Create or attach to a persistent Agent terminal. In Follow mode this controls the current Workbench terminal pane; otherwise it creates a private Agent terminal.",
            json!({
                "type": "object",
                "properties": {
                    "target": { "type": "string", "enum": ["auto", "private", "ui"], "default": "auto" },
                    "mode": { "type": "string", "enum": ["shell", "command"], "default": "shell" },
                    "command": { "type": "string" },
                    "cwd": { "type": "string" },
                    "title": { "type": "string" },
                    "cols": { "type": "number", "default": 80 },
                    "rows": { "type": "number", "default": 24 },
                    "maxBytes": { "type": "number", "default": 16000 }
                }
            }),
        ),
        function_tool(
            "terminal_read",
            "Read buffered terminal output without blocking.",
            json!({
                "type": "object",
                "properties": {
                    "sessionId": { "type": "string" },
                    "terminalTabId": { "type": "string" },
                    "paneId": { "type": "string" },
                    "cursor": { "type": "string" },
                    "maxBytes": { "type": "number", "default": 16000 }
                }
            }),
        ),
        function_tool(
            "terminal_wait",
            "Wait until terminal output advances, the process exits, or the timeout expires.",
            json!({
                "type": "object",
                "properties": {
                    "sessionId": { "type": "string" },
                    "terminalTabId": { "type": "string" },
                    "paneId": { "type": "string" },
                    "cursor": { "type": "string" },
                    "waitMs": { "type": "number", "default": 1000, "maximum": 30000 },
                    "maxBytes": { "type": "number", "default": 16000 }
                }
            }),
        ),
        function_tool(
            "terminal_write",
            "Write text, raw data, or key presses to a terminal session.",
            json!({
                "type": "object",
                "properties": {
                    "sessionId": { "type": "string" },
                    "terminalTabId": { "type": "string" },
                    "paneId": { "type": "string" },
                    "text": { "type": "string" },
                    "data": { "type": "string" },
                    "keys": { "type": "array", "items": { "type": "string" } },
                    "appendNewline": { "type": "boolean" },
                    "maxBytes": { "type": "number", "default": 16000 }
                }
            }),
        ),
        function_tool(
            "terminal_close",
            "Close a terminal session or Workbench terminal pane.",
            json!({
                "type": "object",
                "properties": {
                    "sessionId": { "type": "string" },
                    "terminalTabId": { "type": "string" },
                    "paneId": { "type": "string" }
                }
            }),
        ),
        function_tool(
            "software_list_capabilities",
            "List installed Lyra software adapters and their lightweight capabilities.",
            json!({
                "type": "object",
                "properties": {
                    "includeSchemas": { "type": "boolean", "default": false }
                }
            }),
        ),
        function_tool(
            "software_inspect_capability",
            "Inspect one Lyra software adapter capability, including full input/output schema and readable state hints.",
            json!({
                "type": "object",
                "properties": {
                    "softwareId": { "type": "string" },
                    "capabilityId": { "type": "string" }
                },
                "required": ["softwareId"]
            }),
        ),
        function_tool(
            "software_read_state",
            "Read lightweight state from installed Lyra software, such as the active image viewer, file manager, terminal, browser tabs, or software store.",
            json!({
                "type": "object",
                "properties": {
                    "softwareId": { "type": "string" },
                    "capabilityId": { "type": "string" }
                }
            }),
        ),
        function_tool(
            "software_invoke_capability",
            "Invoke a Lyra software adapter capability when the task requires an installed app.",
            json!({
                "type": "object",
                "properties": {
                    "softwareId": { "type": "string" },
                    "capabilityId": { "type": "string" },
                    "actionId": { "type": "string" },
                    "input": { "type": "object" }
                },
                "required": ["softwareId", "capabilityId"]
            }),
        ),
        function_tool(
            "lyra_lumen_map",
            "Map actionable elements on a Lyra browser page using selectors, focus scan, and weak DOM.",
            json!({
                "type": "object",
                "properties": {
                    "tabId": { "type": "string" },
                    "targetMode": { "type": "string", "enum": ["isolated", "live"], "default": "live" },
                    "strategy": { "type": "string", "enum": ["picker", "focus", "hybrid", "domFallback"], "default": "picker" },
                    "timeoutMs": { "type": "number" }
                }
            }),
        ),
        function_tool(
            "lyra_lumen_read",
            "Read text from a Lyra browser page without relying on screenshot OCR.",
            json!({
                "type": "object",
                "properties": {
                    "tabId": { "type": "string" },
                    "targetMode": { "type": "string", "enum": ["isolated", "live"], "default": "live" },
                    "strategy": { "type": "string", "enum": ["focus", "hybrid", "domFallback"], "default": "focus" },
                    "maxChars": { "type": "number" },
                    "timeoutMs": { "type": "number" }
                }
            }),
        ),
        function_tool(
            "lyra_lumen_see",
            "Capture a Lyra browser page as a visual evidence artifact. The image is returned by artifact reference, not inlined into model context.",
            json!({
                "type": "object",
                "properties": {
                    "tabId": { "type": "string" },
                    "targetMode": { "type": "string", "enum": ["isolated", "live"], "default": "live" },
                    "timeoutMs": { "type": "number" }
                }
            }),
        ),
        function_tool(
            "lyra_lumen_act",
            "Click, double-click, right-click, or hover a Lyra Lumen targetRef or visual fallback point. Prefer targetRef; elementId is observation-local compatibility only.",
            json!({
                "type": "object",
                "properties": {
                    "tabId": { "type": "string" },
                    "targetMode": { "type": "string", "enum": ["isolated", "live"], "default": "live" },
                    "elementId": { "type": "number", "description": "Observation-local numeric id from the same lyra_lumen_map result; prefer targetRef." },
                    "targetRef": { "type": "string", "description": "Stable target reference returned by lyra_lumen_map, preferred when available." },
                    "point": {
                        "type": "object",
                        "properties": {
                            "x": { "type": "number" },
                            "y": { "type": "number" },
                            "reason": { "type": "string" }
                        }
                    },
                    "interaction": { "type": "string", "enum": ["click", "doubleClick", "rightClick", "hover"], "default": "click" },
                    "timeoutMs": { "type": "number" }
                }
            }),
        ),
        function_tool(
            "lyra_lumen_type",
            "Type text into a browser editable element. Prefer targetRef from lyra_lumen_map; elementId is observation-local compatibility only. If omitted, Lyra uses the current or last confirmed editable target.",
            json!({
                "type": "object",
                "properties": {
                    "tabId": { "type": "string" },
                    "targetMode": { "type": "string", "enum": ["isolated", "live"], "default": "live" },
                    "elementId": { "type": "number", "description": "Observation-local numeric id from the same lyra_lumen_map result; prefer targetRef." },
                    "targetRef": { "type": "string", "description": "Stable target reference returned by lyra_lumen_map." },
                    "text": { "type": "string" },
                    "clear": { "type": "boolean", "default": false },
                    "timeoutMs": { "type": "number" }
                },
                "required": ["text"]
            }),
        ),
        function_tool(
            "lyra_lumen_press",
            "Press a keyboard key in the Lyra browser agent page. Prefer targetRef when focusing a target first; elementId is observation-local compatibility only.",
            json!({
                "type": "object",
                "properties": {
                    "tabId": { "type": "string" },
                    "targetMode": { "type": "string", "enum": ["isolated", "live"], "default": "live" },
                    "elementId": { "type": "number", "description": "Observation-local numeric id from the same lyra_lumen_map result; prefer targetRef." },
                    "targetRef": { "type": "string", "description": "Stable target reference returned by lyra_lumen_map." },
                    "key": { "type": "string" },
                    "timeoutMs": { "type": "number" }
                },
                "required": ["key"]
            }),
        ),
        function_tool(
            "lyra_lumen_submit",
            "Submit the focused or selected Lyra browser control, normally by pressing Enter. Prefer targetRef when selecting a control; elementId is observation-local compatibility only.",
            json!({
                "type": "object",
                "properties": {
                    "tabId": { "type": "string" },
                    "targetMode": { "type": "string", "enum": ["isolated", "live"], "default": "live" },
                    "elementId": { "type": "number", "description": "Observation-local numeric id from the same lyra_lumen_map result; prefer targetRef." },
                    "targetRef": { "type": "string", "description": "Stable target reference returned by lyra_lumen_map." },
                    "key": { "type": "string", "default": "Enter" },
                    "timeoutMs": { "type": "number" }
                }
            }),
        ),
        function_tool(
            "lyra_lumen_wait",
            "Wait for browser page loading, text changes, text stability, or text containment.",
            json!({
                "type": "object",
                "properties": {
                    "tabId": { "type": "string" },
                    "targetMode": { "type": "string", "enum": ["isolated", "live"], "default": "live" },
                    "until": { "type": "string", "enum": ["loadIdle", "textChanged", "textStable", "textContains"], "default": "textStable" },
                    "text": { "type": "string" },
                    "timeoutMs": { "type": "number" },
                    "idleMs": { "type": "number" },
                    "maxChars": { "type": "number" }
                }
            }),
        ),
        function_tool(
            "lyra_lumen_read_until",
            "Read the Lyra browser page repeatedly until text changes, stabilizes, contains target text, or load becomes idle.",
            json!({
                "type": "object",
                "properties": {
                    "tabId": { "type": "string" },
                    "targetMode": { "type": "string", "enum": ["isolated", "live"], "default": "live" },
                    "until": { "type": "string", "enum": ["loadIdle", "textChanged", "textStable", "textContains"], "default": "textStable" },
                    "text": { "type": "string" },
                    "timeoutMs": { "type": "number" },
                    "idleMs": { "type": "number" },
                    "maxChars": { "type": "number" }
                }
            }),
        ),
        function_tool(
            "lyra_lumen_navigate",
            "Navigate a Lyra browser page.",
            json!({
                "type": "object",
                "properties": {
                    "tabId": { "type": "string" },
                    "url": { "type": "string" },
                    "newTab": { "type": "boolean", "default": false },
                    "targetMode": { "type": "string", "enum": ["isolated", "live"], "default": "live" },
                    "timeoutMs": { "type": "number" }
                },
                "required": ["url"]
            }),
        ),
        function_tool(
            "lyra_lumen_reveal",
            "Hover or otherwise reveal hidden browser elements, then return newly exposed actions. Prefer targetRef; elementId is observation-local compatibility only.",
            json!({
                "type": "object",
                "properties": {
                    "tabId": { "type": "string" },
                    "targetMode": { "type": "string", "enum": ["isolated", "live"], "default": "live" },
                    "elementId": { "type": "number", "description": "Observation-local numeric id from the same lyra_lumen_map result; prefer targetRef." },
                    "targetRef": { "type": "string", "description": "Stable target reference returned by lyra_lumen_map." },
                    "point": { "type": "object" },
                    "interaction": { "type": "string", "enum": ["hover", "click"], "default": "hover" },
                    "idleMs": { "type": "number" },
                    "timeoutMs": { "type": "number" }
                }
            }),
        ),
        function_tool(
            "lyra_lumen_focus_scan",
            "Use focus navigation to scan focusable elements on a Lyra browser page.",
            json!({
                "type": "object",
                "properties": {
                    "tabId": { "type": "string" },
                    "targetMode": { "type": "string", "enum": ["isolated", "live"], "default": "live" },
                    "direction": { "type": "string", "enum": ["scan", "next", "previous"], "default": "scan" },
                    "steps": { "type": "number" },
                    "restoreFocus": { "type": "boolean" },
                    "timeoutMs": { "type": "number" }
                }
            }),
        ),
        function_tool(
            "lyra_lumen_follow_audit",
            "Read compact semantic Follow-mode browser action audit without injecting high-frequency visual frames.",
            json!({
                "type": "object",
                "properties": {
                    "tabId": { "type": "string" },
                    "targetMode": { "type": "string", "enum": ["isolated", "live"], "default": "live" },
                    "sessionId": { "type": "string" },
                    "turnId": { "type": "string" },
                    "maxActions": { "type": "number" },
                    "includeFrames": { "type": "boolean", "default": false }
                }
            }),
        ),
        function_tool(
            "lyra_lumen_explain_target",
            "Explain whether a Lyra Lumen targetRef is still usable and return a structured staleTarget with nearest candidates when it is not.",
            json!({
                "type": "object",
                "properties": {
                    "tabId": { "type": "string" },
                    "targetMode": { "type": "string", "enum": ["isolated", "live"], "default": "live" },
                    "targetRef": { "type": "string" },
                    "maxCandidates": { "type": "number" }
                },
                "required": ["targetRef"]
            }),
        ),
        function_tool(
            "lyra_lumen_audit",
            "Audit browser page diagnostics such as console errors, failed loads, and runtime reachability.",
            json!({
                "type": "object",
                "properties": {
                    "tabId": { "type": "string" },
                    "targetMode": { "type": "string", "enum": ["isolated", "live"], "default": "live" },
                    "includeConsole": { "type": "boolean" },
                    "includeNetwork": { "type": "boolean" },
                    "includeRuntime": { "type": "boolean" },
                    "severity": {
                        "oneOf": [
                            { "type": "string", "enum": ["info", "warning", "error"] },
                            {
                                "type": "array",
                                "items": { "type": "string", "enum": ["info", "warning", "error"] }
                            }
                        ]
                    },
                    "since": {
                        "description": "ISO timestamp or epoch milliseconds; only diagnostics at or after this time are returned.",
                        "oneOf": [{ "type": "string" }, { "type": "number" }]
                    },
                    "maxEntries": { "type": "number" },
                    "domain": { "type": "string" },
                    "path": { "type": "string" },
                    "status": { "type": "number" },
                    "method": { "type": "string" },
                    "includeResponseBody": { "type": "boolean" },
                    "responseBodyMaxBytes": { "type": "number" }
                }
            }),
        ),
        function_tool(
            "lyra_lumen_elevate",
            "Promote an isolated browser task to a visible Lyra browser tab when user action is required for CAPTCHA, OAuth, MFA, or another auth wall.",
            json!({
                "type": "object",
                "properties": {
                    "tabId": { "type": "string" },
                    "targetMode": { "type": "string", "enum": ["isolated", "live"], "default": "isolated" },
                    "reason": { "type": "string" }
                }
            }),
        ),
        function_tool(
            "render_surface",
            "Create or update an inline Lyra Render Surface inside the AI timeline for temporary mini apps, dashboards, diagrams, interactive HTML/SVG, markdown reports, JSON inspectors, and tables without writing local files or opening an external browser.",
            json!({
                "type": "object",
                "properties": {
                    "surfaceId": {
                        "type": "string",
                        "description": "Stable id for later updates. Reuse it when replacing or appending to the same surface."
                    },
                    "operation": {
                        "type": "string",
                        "enum": ["create", "update", "replace", "append"],
                        "default": "create"
                    },
                    "title": { "type": "string" },
                    "kind": {
                        "type": "string",
                        "enum": ["html", "markdown", "svg", "json", "table", "text"],
                        "default": "html"
                    },
                    "content": {
                        "type": "string",
                        "description": "HTML, markdown, SVG, or text content. Keep large assets in files or split across surfaces."
                    },
                    "data": {
                        "description": "Structured JSON data for json surfaces."
                    },
                    "columns": {
                        "type": "array",
                        "items": {
                            "oneOf": [
                                { "type": "string" },
                                {
                                    "type": "object",
                                    "properties": {
                                        "key": { "type": "string" },
                                        "label": { "type": "string" }
                                    },
                                    "required": ["key"]
                                }
                            ]
                        }
                    },
                    "rows": {
                        "type": "array",
                        "items": {
                            "oneOf": [
                                { "type": "array" },
                                { "type": "object" }
                            ]
                        }
                    },
                    "height": {
                        "type": "number",
                        "minimum": 140,
                        "maximum": 720,
                        "default": 320
                    },
                    "summary": {
                        "type": "string",
                        "description": "One-sentence model-visible description of what this surface shows."
                    },
                    "interactive": { "type": "boolean", "default": true },
                    "theme": { "type": "string", "enum": ["auto", "light", "dark"], "default": "auto" }
                },
                "required": ["title", "kind"]
            }),
        ),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn browser_recovery_context_reads_host_snapshot_as_metadata_only_anchor() {
        let dispatcher: Arc<HostCapabilityDispatcher> = Arc::new(|method, payload| {
            let input: Value = serde_json::from_str(&payload).expect("payload json");
            match method.as_str() {
                "workbench.listTabs" => Ok(serde_json::to_string(&json!({
                    "activeTabId": "browser-tab-1",
                    "tabs": []
                }))
                .expect("json")),
                "software.listCapabilities" => Ok(serde_json::to_string(&json!({
                    "software": []
                }))
                .expect("json")),
                "workbench.browser.readSessionSnapshot" => {
                    assert_eq!(input["includeRecoveryAnchor"], true);
                    Ok(serde_json::to_string(&json!({
                        "schemaVersion": 1,
                        "snapshotId": "browser-session-1",
                        "capturedAt": 100,
                        "activeTabId": "browser-tab-1",
                        "tabs": [{
                            "tabId": "browser-tab-1",
                            "address": "https://example.com/app",
                            "title": "Example App",
                            "isActive": true,
                            "canGoBack": true,
                            "canGoForward": false,
                            "profilePartition": "persist:lyra-browser-live",
                            "restoreState": {
                                "scrollX": 0,
                                "scrollY": 240,
                                "textHash": "sha256:abc",
                                "capturedAt": 100,
                                "history": {
                                    "currentIndex": 0,
                                    "entries": [{
                                        "url": "https://example.com/app",
                                        "title": "Example App",
                                        "timestamp": 100
                                    }]
                                }
                            }
                        }],
                        "storageState": {
                            "schemaVersion": 1,
                            "profileId": "lyra-browser-live",
                            "profileMode": "live",
                            "profilePartition": "persist:lyra-browser-live",
                            "persistence": "chromium-profile",
                            "cookies": { "availability": "available", "manifestOnly": true, "count": 2 },
                            "localStorage": { "availability": "available", "manifestOnly": true },
                            "indexedDB": { "availability": "unknown", "manifestOnly": true },
                            "sessionStorage": { "availability": "unknown", "manifestOnly": true },
                            "cacheStorage": { "availability": "unknown", "manifestOnly": true }
                        },
                        "recoveryAnchor": {
                            "schemaVersion": 1,
                            "tabId": "browser-tab-1",
                            "address": "https://example.com/app",
                            "title": "Example App",
                            "targetRef": "lumen:stable-target",
                            "textHash": "sha256:abc",
                            "storageStateRef": {
                                "profilePartition": "persist:lyra-browser-live",
                                "siteOrigin": "https://example.com"
                            },
                            "authState": "possibly_logged_in",
                            "capturedAt": 100
                        }
                    }))
                    .expect("json"))
                }
                other => panic!("unexpected capability {other}"),
            }
        });

        let runtime_context = build_runtime_context(
            Some(&dispatcher),
            &[],
            &ModelCapabilityProfile {
                supports_image_input: true,
                supports_tool_calling: true,
                supports_streaming: true,
                context_window: Some(128_000),
            },
        );

        assert_eq!(
            runtime_context.pointer("/browserRecovery/recoveryAnchor/targetRef"),
            Some(&json!("lumen:stable-target"))
        );
        assert_eq!(
            runtime_context.pointer("/browserRecovery/storageState/privacy/cookieValues"),
            Some(&json!("not_exposed"))
        );
        assert_eq!(
            runtime_context.pointer("/browserRecovery/activeTab/restoreState/scrollY"),
            Some(&json!(240))
        );
        let rendered = serde_json::to_string(&runtime_context).expect("context json");
        assert!(!rendered.contains("secret-cookie-value"));
    }
}

fn turn_finish_model_tool() -> Value {
    function_tool(
        LYRA_TURN_FINISH_TOOL,
        "Finish the current Lyra turn with a structured outcome after required tools are complete, or when no tool is needed.",
        json!({
            "type": "object",
            "properties": {
                "status": {
                    "type": "string",
                    "enum": ["answered", "completed", "blocked", "needs_user_input"]
                },
                "finalText": {
                    "type": "string",
                    "description": "The exact user-visible final answer to commit to the factual timeline."
                },
                "blocker": {
                    "type": "string",
                    "description": "Required when status is blocked."
                },
                "question": {
                    "type": "string",
                    "description": "Required when status is needs_user_input."
                },
                "evidenceSummary": {
                    "type": "string",
                    "description": "Brief summary of the Lyra tool evidence used, if any."
                }
            },
            "required": ["status", "finalText"]
        }),
    )
}

pub(crate) fn function_tool(name: &str, description: &str, parameters: Value) -> Value {
    let parameters = with_lumen_auth_state_schema(name, parameters);
    json!({
        "type": "function",
        "function": {
            "name": name,
            "description": description,
            "parameters": with_additional_properties(parameters),
        }
    })
}

fn with_lumen_auth_state_schema(name: &str, mut schema: Value) -> Value {
    if !name.starts_with("lyra_lumen_") {
        return schema;
    }
    let Some(properties) = schema
        .as_object_mut()
        .and_then(|object| object.get_mut("properties"))
        .and_then(Value::as_object_mut)
    else {
        return schema;
    };
    if !properties.contains_key("targetMode") {
        return schema;
    }
    properties.entry("authState".to_string()).or_insert_with(|| {
        json!({
            "type": "string",
            "enum": ["none", "borrowLiveLogin"],
            "default": "none",
            "description": "For targetMode=isolated only: request user-authorized borrowing of the current live Lyra browser login state for the hidden background page. This requires a permission prompt and never exposes cookie/password values to the model."
        })
    });
    properties
        .entry("useLiveLoginState".to_string())
        .or_insert_with(|| {
            json!({
                "type": "boolean",
                "default": false,
                "description": "Alias for authState=borrowLiveLogin. Use only when the task must operate a hidden isolated page with the user's current Lyra browser login state."
            })
        });
    schema
}

pub(crate) fn with_additional_properties(mut schema: Value) -> Value {
    if let Some(object) = schema.as_object_mut() {
        object
            .entry("additionalProperties")
            .or_insert(Value::Bool(false));
    }
    schema
}

pub(crate) fn model_tool_names(design_research_required: bool) -> Vec<String> {
    if env::var_os("LYRA_AGENT_DISABLE_TOOL_REGISTRY").is_none() {
        let mut names = ToolActivityService::default().model_tool_names();
        if design_research_required {
            names.extend(
                design_tools::design_tool_names()
                    .into_iter()
                    .map(str::to_string),
            );
        }
        names.push(LYRA_TURN_FINISH_TOOL.to_string());
        return names;
    }
    vec![
        LYRA_TURN_FINISH_TOOL,
        "artifact_read",
        "memory_search",
        "memory_remember",
        "memory_update",
        "memory_forget",
        "memory_list",
        "memory_link",
        "memory_review_candidates",
        "memory_apply_candidate",
        "memory_reject_candidate",
        "memory_explain_injection",
        "ask_user",
        "workbench_list_tabs",
        "workbench_read_workspace",
        "workbench_read_tab",
        "workbench_activate_tab",
        "terminal_list",
        "terminal_create",
        "terminal_read",
        "terminal_wait",
        "terminal_write",
        "terminal_close",
        "software_list_capabilities",
        "software_inspect_capability",
        "software_read_state",
        "software_invoke_capability",
        "lyra_lumen_map",
        "lyra_lumen_read",
        "lyra_lumen_see",
        "lyra_lumen_act",
        "lyra_lumen_type",
        "lyra_lumen_press",
        "lyra_lumen_submit",
        "lyra_lumen_wait",
        "lyra_lumen_read_until",
        "lyra_lumen_navigate",
        "lyra_lumen_reveal",
        "lyra_lumen_focus_scan",
        "lyra_lumen_follow_audit",
        "lyra_lumen_explain_target",
        "lyra_lumen_audit",
        "lyra_lumen_elevate",
        "render_surface",
    ]
    .into_iter()
    .map(str::to_string)
    .collect()
}
