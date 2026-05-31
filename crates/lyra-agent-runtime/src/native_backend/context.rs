use super::*;

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
                    "targetMode": { "type": "string", "enum": ["isolated", "live"], "default": "isolated" },
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
                    "targetMode": { "type": "string", "enum": ["isolated", "live"], "default": "isolated" },
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
                    "targetMode": { "type": "string", "enum": ["isolated", "live"], "default": "isolated" },
                    "timeoutMs": { "type": "number" }
                }
            }),
        ),
        function_tool(
            "lyra_lumen_act",
            "Click, double-click, right-click, or hover an element or point on a Lyra browser page.",
            json!({
                "type": "object",
                "properties": {
                    "tabId": { "type": "string" },
                    "targetMode": { "type": "string", "enum": ["isolated", "live"], "default": "isolated" },
                    "elementId": { "type": "number" },
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
            "Type text into a browser editable element. Prefer passing elementId from lyra_lumen_map; if omitted, Lyra uses the current or last confirmed editable target.",
            json!({
                "type": "object",
                "properties": {
                    "tabId": { "type": "string" },
                    "targetMode": { "type": "string", "enum": ["isolated", "live"], "default": "isolated" },
                    "elementId": { "type": "number" },
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
            "Press a keyboard key in the Lyra browser agent page.",
            json!({
                "type": "object",
                "properties": {
                    "tabId": { "type": "string" },
                    "targetMode": { "type": "string", "enum": ["isolated", "live"], "default": "isolated" },
                    "elementId": { "type": "number" },
                    "targetRef": { "type": "string", "description": "Stable target reference returned by lyra_lumen_map." },
                    "key": { "type": "string" },
                    "timeoutMs": { "type": "number" }
                },
                "required": ["key"]
            }),
        ),
        function_tool(
            "lyra_lumen_submit",
            "Submit the focused or selected Lyra browser control, normally by pressing Enter.",
            json!({
                "type": "object",
                "properties": {
                    "tabId": { "type": "string" },
                    "targetMode": { "type": "string", "enum": ["isolated", "live"], "default": "isolated" },
                    "elementId": { "type": "number" },
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
                    "targetMode": { "type": "string", "enum": ["isolated", "live"], "default": "isolated" },
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
                    "targetMode": { "type": "string", "enum": ["isolated", "live"], "default": "isolated" },
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
                    "targetMode": { "type": "string", "enum": ["isolated", "live"], "default": "isolated" },
                    "timeoutMs": { "type": "number" }
                },
                "required": ["url"]
            }),
        ),
        function_tool(
            "lyra_lumen_reveal",
            "Hover or otherwise reveal hidden browser elements, then return newly exposed actions.",
            json!({
                "type": "object",
                "properties": {
                    "tabId": { "type": "string" },
                    "targetMode": { "type": "string", "enum": ["isolated", "live"], "default": "isolated" },
                    "elementId": { "type": "number" },
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
                    "targetMode": { "type": "string", "enum": ["isolated", "live"], "default": "isolated" },
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
                    "maxActions": { "type": "number" }
                }
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
                    "maxEntries": { "type": "number" }
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
    ]
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
    json!({
        "type": "function",
        "function": {
            "name": name,
            "description": description,
            "parameters": with_additional_properties(parameters),
        }
    })
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
        "lyra_lumen_audit",
        "lyra_lumen_elevate",
    ]
    .into_iter()
    .map(str::to_string)
    .collect()
}
