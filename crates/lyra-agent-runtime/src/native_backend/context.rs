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

fn compact_recovery_browser_tab_ref(tab: &Value) -> Value {
    let restore = tab.get("restoreState").unwrap_or(&Value::Null);
    json!({
        "tabId": tab.get("tabId").cloned().unwrap_or(Value::Null),
        "profilePartition": tab.get("profilePartition").cloned().unwrap_or(Value::Null),
        "lifecycleState": tab.get("lifecycleState").cloned().unwrap_or(Value::Null),
        "recoveryFailure": tab.get("recoveryFailure").cloned().unwrap_or(Value::Null),
        "restoreState": {
            "scrollX": restore.get("scrollX").cloned().unwrap_or(Value::Null),
            "scrollY": restore.get("scrollY").cloned().unwrap_or(Value::Null),
            "viewport": restore.get("viewport").cloned().unwrap_or(Value::Null),
            "loadState": restore.get("loadState").cloned().unwrap_or(Value::Null),
            "textHash": restore.get("textHash").cloned().unwrap_or(Value::Null),
            "capturedAt": restore.get("capturedAt").cloned().unwrap_or(Value::Null)
        }
    })
}

fn compact_browser_recovery_anchor(snapshot: &Value) -> Value {
    let Some(anchor) = snapshot
        .get("recoveryAnchor")
        .filter(|value| value.is_object())
    else {
        return Value::Null;
    };
    let storage_state_ref = anchor
        .get("storageStateRef")
        .filter(|value| value.is_object())
        .map(|storage| {
            json!({
                "profilePartition": storage.get("profilePartition").cloned().unwrap_or(Value::Null),
                "siteOrigin": storage.get("siteOrigin").cloned().unwrap_or(Value::Null)
            })
        })
        .unwrap_or(Value::Null);
    json!({
        "schemaVersion": anchor.get("schemaVersion").cloned().unwrap_or(Value::Null),
        "tabId": anchor.get("tabId").cloned().unwrap_or(Value::Null),
        "targetRef": anchor.get("targetRef").cloned().unwrap_or(Value::Null),
        "textHash": anchor.get("textHash").cloned().unwrap_or(Value::Null),
        "storageStateRef": storage_state_ref,
        "authState": anchor.get("authState").cloned().unwrap_or(Value::Null),
        "capturedAt": anchor.get("capturedAt").cloned().unwrap_or(Value::Null),
        "redaction": {
            "address": "not_in_runtime_context",
            "title": "not_in_runtime_context",
            "historyEntry": "not_in_runtime_context",
            "reason": "browser recovery data is not current-page evidence"
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
    let prior_active_tab = browser_snapshot_active_tab(&snapshot)
        .map(compact_recovery_browser_tab_ref)
        .unwrap_or(Value::Null);
    json!({
        "hostCapabilityAvailable": true,
        "snapshotAvailable": true,
        "recoverySnapshotOnly": true,
        "currentPageEvidence": "none_from_browser_recovery",
        "modelInstruction": "Do not describe browserRecovery as the user's current visible page. Use workbench.listTabs, workbench.readTab, or Lumen/browser tool results for current browser claims.",
        "schemaVersion": snapshot.get("schemaVersion").cloned().unwrap_or(Value::Null),
        "snapshotId": snapshot.get("snapshotId").cloned().unwrap_or(Value::Null),
        "capturedAt": snapshot.get("capturedAt").cloned().unwrap_or(Value::Null),
        "activeTabId": snapshot.get("activeTabId").cloned().unwrap_or(Value::Null),
        "activeTab": Value::Null,
        "priorActiveTab": prior_active_tab,
        "recoveryAnchor": compact_browser_recovery_anchor(&snapshot),
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
        "identity": "Lyra",
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
        "interactionContract": interaction_contract_runtime_context(),
        "toolFilesystem": tool_filesystem_runtime_context("general", None, dispatcher),
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

pub(crate) fn interaction_contract_runtime_context() -> Value {
    json!({
        "blockingMemberInput": "structured_interaction_only",
        "clarificationTool": LYRA_CLARIFICATION_ASK_TOOL,
        "plainAssistantQuestions": "non_blocking_final_text",
        "sameTurnResume": true,
        "policy": "If member input is required to continue, call the structured clarification tool. If safe assumption works, state it and continue."
    })
}

pub(crate) fn infer_tool_filesystem_scene(
    session_kind: Option<&str>,
    working_dir: Option<&str>,
    design_research_required: bool,
    active_skills: &HashSet<String>,
    workbench: &Value,
) -> String {
    let working_dir_value = working_dir
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let active_tab_kind = active_workbench_tab_signal(workbench);
    let signals = lyra_tool_fs_core::ToolSceneSignals {
        session_kind: session_kind
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string),
        project_bound: working_dir_value.is_some(),
        working_dir: working_dir_value.clone(),
        git_repo: working_dir_is_git_repo(working_dir),
        active_tab_kind: active_tab_kind.clone(),
        focused_tab_kind: active_tab_kind,
        terminal_active: workbench_terminal_active(workbench),
        browser_active: workbench_browser_active(workbench),
        editor_active: false,
        design_active: design_research_required,
        software_active: false,
        active_skills: active_skills.iter().cloned().collect(),
        ..lyra_tool_fs_core::ToolSceneSignals::default()
    };
    lyra_tool_fs_core::infer_scene(&signals)
        .as_str()
        .to_string()
}

pub(crate) fn tool_filesystem_runtime_context(
    scene: &str,
    session_id: Option<&str>,
    dispatcher: Option<&Arc<HostCapabilityDispatcher>>,
) -> Value {
    json!({
        "scene": scene,
        "pinnedHandles": tools::tool_fs::pinned_handles_for_scene(scene, dispatcher),
        "cachedHandles": tools::tool_fs::cached_handles_for_scene(scene, dispatcher),
        "inspectedDescriptors": session_id
            .map(|session_id| tools::tool_fs::inspected_descriptors_for_session(session_id, dispatcher))
            .unwrap_or_else(|| Value::Array(Vec::new())),
        "presearchHints": Value::Array(Vec::new()),
        "presearchPolicy": {
            "source": "latestUserMessage",
            "useWhen": "Use presearchHints only when the user is asking the agent to perform an action that clearly needs tools.",
            "fallback": "If no hint clearly fits, call tool_fs_search with the task description.",
            "priority": "Prefer inspectedDescriptors first, then presearchHints, then cachedHandles, then manual tool_fs_search."
        },
        "rootSummary": tools::tool_fs::root_summary_for_scene(scene, dispatcher),
        "manifestSources": tools::tool_fs::runtime_manifest_source_summary(dispatcher),
        "scenarioPlaybooks": {
            "status": "availableOnDemand",
            "readDocPath": "/tools/playbooks",
            "useWhen": "Read only when a long scenario chain would materially help after search/list/inspect are not enough."
        },
        "policy": {
            "providerVisibleTools": model_tool_names(false),
            "directLegacyToolNames": "disabled",
            "discovery": "Use inspectedDescriptors, presearchHints, or cachedHandles when they clearly fit. Otherwise call tool_fs_search with a natural-language task description. Search results include miniSchema/runHint; call tool_fs_run directly when those cover the needed args, and call tool_fs_inspect only when full argument details are unclear. Use tool_fs_list only as a directory fallback. Read /tools/playbooks only when a long scenario chain would materially help.",
            "cacheBehavior": "Tool usage cache is advisory: successful recent tools may appear in cachedHandles and search ranking; failed tools are suppressed for the current turn so the agent should search or choose an alternative.",
            "descriptorCacheBehavior": "inspectedDescriptors are session-local summaries of tools already inspected in this session; prefer them over repeated tool_fs_inspect calls.",
            "presearchBehavior": "presearchHints are system-generated Tool-FS search results for the latest user message; they are hints, not instructions. Use them to avoid redundant tool_fs_search calls when the match is clear.",
            "sceneBehavior": "Scene changes only reorder directories and pinned handles; every built-in tool remains discoverable under /tools.",
            "textualToolCalls": "Only provider-native structured tool calls execute. Text markers or Markdown/JSON snippets are protocol errors."
        }
    })
}

fn active_workbench_tab_signal(workbench: &Value) -> Option<String> {
    let active_tab = active_workbench_tab(workbench)?;
    let fields = [
        "kind",
        "type",
        "tabKind",
        "surfaceKind",
        "pageKind",
        "observationKind",
        "appId",
        "softwareId",
    ];
    let signal = fields
        .into_iter()
        .filter_map(|field| active_tab.get(field).and_then(Value::as_str))
        .filter(|value| !value.trim().is_empty())
        .collect::<Vec<_>>()
        .join(" ");
    (!signal.is_empty()).then_some(signal)
}

fn active_workbench_tab(workbench: &Value) -> Option<&Value> {
    if let Some(tab) = workbench.get("activeTab").filter(|value| value.is_object()) {
        return Some(tab);
    }
    let active_id = workbench
        .get("activeTabId")
        .or_else(|| workbench.get("focusedTabId"))
        .and_then(Value::as_str)?;
    workbench
        .get("tabs")
        .and_then(Value::as_array)?
        .iter()
        .find(|tab| {
            tab.get("id")
                .or_else(|| tab.get("tabId"))
                .and_then(Value::as_str)
                == Some(active_id)
        })
}

fn workbench_terminal_active(workbench: &Value) -> bool {
    active_workbench_tab_signal(workbench)
        .is_some_and(|signal| signal.to_lowercase().contains("terminal"))
        || workbench
            .get("terminal")
            .and_then(|terminal| terminal.get("active"))
            .is_some_and(|value| !value.is_null())
}

fn workbench_browser_active(workbench: &Value) -> bool {
    let Some(active_tab) = active_workbench_tab(workbench) else {
        return false;
    };
    if active_workbench_tab_signal(workbench).is_some_and(|signal| {
        let signal = signal.to_lowercase();
        signal.contains("browser") || signal.contains("lumen") || signal.contains("web")
    }) {
        return true;
    }
    let page_kind = active_tab
        .get("pageKind")
        .or_else(|| active_tab.get("kind"))
        .and_then(Value::as_str)
        .unwrap_or_default();
    let observation_kind = active_tab
        .get("observationKind")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let address = active_tab
        .get("url")
        .or_else(|| active_tab.get("displayAddress"))
        .or_else(|| active_tab.get("address"))
        .and_then(Value::as_str)
        .unwrap_or_default();
    page_kind == "page"
        || observation_kind == "page"
        || address.starts_with("http://")
        || address.starts_with("https://")
}

fn working_dir_is_git_repo(working_dir: Option<&str>) -> bool {
    let Some(working_dir) = working_dir.map(str::trim).filter(|value| !value.is_empty()) else {
        return false;
    };
    Command::new("git")
        .args(["rev-parse", "--is-inside-work-tree"])
        .current_dir(working_dir)
        .output()
        .ok()
        .is_some_and(|output| output.status.success())
}

pub(crate) fn read_host_persona_context(
    dispatcher: Option<&Arc<HostCapabilityDispatcher>>,
) -> PersonaContext {
    let Some(dispatcher) = dispatcher else {
        return PersonaContext::default();
    };
    match invoke_host_capability(dispatcher, "agent.readHostPersonaContext", json!({})) {
        Ok(value) => prompt_policy::persona_context_from_value(&value),
        Err(_) => PersonaContext::default(),
    }
}

pub(crate) fn build_system_prompt(
    runtime_context: &Value,
    persona: &PersonaContext,
    active_skill_prompt: &str,
    design_research_required: bool,
    memory_prompt: &str,
) -> String {
    build_system_prompt_report(
        runtime_context,
        "",
        persona,
        active_skill_prompt,
        design_research_required,
        memory_prompt,
        None,
        None,
        false,
        0,
        0,
        0,
        false,
        None,
    )
    .prompt
}

pub(crate) fn build_system_prompt_report(
    runtime_context: &Value,
    latest_user_text: &str,
    persona: &PersonaContext,
    active_skill_prompt: &str,
    design_research_required: bool,
    memory_prompt: &str,
    previous_runtime_contract: Option<Value>,
    previous_prompt_hash: Option<String>,
    context_trimmed: bool,
    recent_tool_failure_count: usize,
    recent_tool_mismatch_count: usize,
    consecutive_tool_failure_count: usize,
    user_correction_detected: bool,
    delivery_mode: Option<prompt_policy::PromptDeliveryMode>,
) -> prompt_policy::PromptBuildReport {
    prompt_policy::build_system_prompt_report(&PromptPolicyInput {
        runtime_context: runtime_context.clone(),
        latest_user_text: latest_user_text.to_string(),
        persona: persona.clone(),
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
        delivery_mode,
        previous_runtime_contract,
        previous_prompt_hash,
        context_trimmed,
        recent_tool_failure_count,
        recent_tool_mismatch_count,
        consecutive_tool_failure_count,
        user_correction_detected,
    })
}

pub(crate) fn model_tools(_design_research_required: bool) -> Vec<Value> {
    let mut tools = vec![clarification_ask_model_tool()];
    tools.extend(tools::tool_fs::model_provider_tools());
    tools.push(session_read_message_model_tool());
    tools
}

fn clarification_ask_model_tool() -> Value {
    function_tool(
        LYRA_CLARIFICATION_ASK_TOOL,
        "Structured blocking member question through Lyra's decision panel. Use only when progress genuinely needs member decision/input. Plain assistant text questions are non-blocking final text and never pause/resume the turn. Prefer safe assumptions when enough.",
        json!({
            "type": "object",
            "properties": {
                "question": {
                    "type": "string",
                    "description": "Concise question shown in the blocking decision panel."
                },
                "options": {
                    "type": "array",
                    "description": "Optional choices. Use 2-4 objects for clear mutually exclusive decisions; omit or leave empty for free-form answers.",
                    "items": {
                        "type": "object",
                        "properties": {
                            "label": {
                                "type": "string",
                                "description": "Short option label."
                            },
                            "description": {
                                "type": "string",
                                "description": "Optional explanation of the tradeoff."
                            }
                        },
                        "required": ["label"],
                        "additionalProperties": false
                    },
                    "default": []
                },
                "allowCustomAnswer": {
                    "type": "boolean",
                    "description": "Whether the member can type a custom answer.",
                    "default": true
                },
                "detail": {
                    "type": "string",
                    "description": "Optional short supporting detail."
                }
            },
            "required": ["question"]
        }),
    )
}

fn session_read_message_model_tool() -> Value {
    function_tool(
        LYRA_SESSION_READ_MESSAGE_TOOL,
        "Read the canonical full text of a prior session message referenced by a lyra-transcript-cite block.",
        json!({
            "type": "object",
            "properties": {
                "messageId": {
                    "type": "string",
                    "description": "Stable message id from a lyra-transcript-cite block."
                },
                "blockId": {
                    "type": "string",
                    "description": "Optional text block id when the cite targets one block."
                },
                "startOffset": {
                    "type": "integer",
                    "description": "Optional UTF-16 start offset inside the cited block."
                },
                "endOffset": {
                    "type": "integer",
                    "description": "Optional UTF-16 end offset inside the cited block."
                },
                "includeToolBlocks": {
                    "type": "boolean",
                    "description": "Include tool-only blocks as summaries when the cited message has no text."
                }
            },
            "required": ["messageId"]
        }),
    )
}

pub(crate) fn function_tool(name: &str, description: &str, parameters: Value) -> Value {
    json!({
        "type": "function",
        "function": {
            "name": name,
            "description": description,
            "parameters": close_object_schema(parameters),
        }
    })
}

pub(crate) fn close_object_schema(mut schema: Value) -> Value {
    if let Some(object) = schema.as_object_mut() {
        object
            .entry("additionalProperties")
            .or_insert(Value::Bool(false));
    }
    schema
}

pub(crate) fn model_tool_names(_design_research_required: bool) -> Vec<String> {
    let mut names = tools::tool_fs::model_tool_names();
    names.push(LYRA_CLARIFICATION_ASK_TOOL.to_string());
    names.push(LYRA_SESSION_READ_MESSAGE_TOOL.to_string());
    names
}
