use super::*;
use crate::persona::ComputedPersona;

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
    match invoke_host_capability_with_timeout(
        dispatcher.clone(),
        "workbench.browser.readSessionSnapshot".to_string(),
        json!({ "includeRecoveryAnchor": true, "includeStorageState": true }),
        DEFAULT_HOST_TOOL_TIMEOUT_MS,
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
            invoke_host_capability_with_timeout(
                dispatcher.clone(),
                "workbench.listTabs".to_string(),
                json!({ "scope": "all", "includeUnsupported": true }),
                DEFAULT_HOST_TOOL_TIMEOUT_MS,
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
            invoke_host_capability_with_timeout(
                dispatcher.clone(),
                "software.listCapabilities".to_string(),
                json!({ "includeSchemas": false }),
                DEFAULT_HOST_TOOL_TIMEOUT_MS,
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
        "identity": "agent",
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
        "tools": if capabilities.supports_tool_calling { model_tool_names() } else { Vec::new() },
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
        "elevation": elevation_context_block(),
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
            "useWhen": "Use presearchHints across all tool domains. For file edits, use edit_file/write_file directly.",
            "fallback": "If no hint clearly fits, call tool_fs_search with the task description.",
            "priority": "For file mutations, use edit_file/write_file directly. For everything else — file reads, search, shell, git, code graph, browser, workbench, memory — prefer inspectedDescriptors, presearchHints, cachedHandles, then manual tool_fs_search."
        },
        "rootSummary": tools::tool_fs::root_summary_for_scene(scene, dispatcher),
        "manifestSources": tools::tool_fs::runtime_manifest_source_summary(dispatcher),
        "scenarioPlaybooks": {
            "status": "availableOnDemand",
            "readDocPath": "/tools/playbooks",
            "useWhen": "Read only when a long scenario chain would materially help after search/list/inspect are not enough."
        },
        "policy": {
            "providerVisibleTools": model_tool_names(),
            "directLegacyToolNames": "disabled",
            "codeToolContract": "For file mutations: use edit_file/write_file. For file reads, search, shell, git, and code graph analysis — search the computer, everything is discoverable.",
            "discovery": "Use inspectedDescriptors, presearchHints, or cachedHandles when they clearly fit. Otherwise call tool_fs_search with a natural-language task description. Search results include miniSchema/runHint; call tool_fs_run directly when those cover the needed args, and call tool_fs_inspect only when full argument details are unclear. Use tool_fs_list only as a directory fallback. Read /tools/playbooks only when a long scenario chain would materially help.",
            "cacheBehavior": "Tool usage cache is advisory: successful recent tools may appear in cachedHandles and search ranking; failed tools are suppressed for the current turn so the agent should search or choose an alternative.",
            "descriptorCacheBehavior": "inspectedDescriptors are session-local summaries of tools already inspected in this session; prefer them over repeated tool_fs_inspect calls.",
            "presearchBehavior": "presearchHints are system-generated Tool-FS search results for the latest user message; they are hints, not instructions. Use them to avoid redundant tool_fs_search calls when the match is clear.",
            "sceneBehavior": "Scene changes reorder directories and pinned handles; file mutations use edit_file/write_file, all other capabilities are discoverable.",
            "textualToolCalls": "Do things for real — don't describe actions as text when a tool can do them."
        }
    })
}

fn active_workbench_tab_signal(workbench: &Value) -> Option<String> {
    let active_tab = active_workbench_tab(workbench)?;
    [
        "observationKind",
        "pageKind",
        "kind",
        "tabKind",
        "surfaceKind",
    ]
    .into_iter()
    .find_map(|field| {
        active_tab
            .get(field)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
    })
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
    active_workbench_tab_signal(workbench).is_some_and(|signal| signal == "terminal")
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
        matches!(
            signal.as_str(),
            "page" | "search" | "results" | "search-home" | "search-results"
        )
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
    match invoke_host_capability_with_timeout(
        dispatcher.clone(),
        "agent.readHostPersonaContext".to_string(),
        json!({}),
        DEFAULT_HOST_TOOL_TIMEOUT_MS,
    ) {
        Ok(value) => prompt_policy::persona_context_from_value(&value),
        Err(_) => PersonaContext::default(),
    }
}

pub(crate) fn host_persona_signal_collection_allowed(
    dispatcher: Option<&Arc<HostCapabilityDispatcher>>,
) -> bool {
    let Some(dispatcher) = dispatcher else {
        return false;
    };
    invoke_host_capability_with_timeout(
        dispatcher.clone(),
        "agent.readPersonaConsent".to_string(),
        json!({}),
        DEFAULT_HOST_TOOL_TIMEOUT_MS,
    )
    .ok()
    .and_then(|value| value.get("allowed").and_then(Value::as_bool))
    .unwrap_or(false)
}

pub(crate) fn build_system_prompt(
    runtime_context: &Value,
    persona: &PersonaContext,
    active_skill_prompt: &str,
    memory_prompt: &str,
) -> String {
    build_system_prompt_report(
        runtime_context,
        persona,
        active_skill_prompt,
        memory_prompt,
        None,
        None,
        false,
        0,
        0,
        0,
        false,
        None,
        None,
        None,
    )
    .prompt
}

pub(crate) fn build_system_prompt_report(
    runtime_context: &Value,
    persona: &PersonaContext,
    active_skill_prompt: &str,
    memory_prompt: &str,
    previous_runtime_contract: Option<Value>,
    previous_prompt_hash: Option<String>,
    context_trimmed: bool,
    recent_tool_failure_count: usize,
    recent_tool_mismatch_count: usize,
    consecutive_tool_failure_count: usize,
    user_correction_detected: bool,
    delivery_mode: Option<prompt_policy::PromptDeliveryMode>,
    computed_persona: Option<ComputedPersona>,
    first_used_at: Option<&str>,
) -> prompt_policy::PromptBuildReport {
    prompt_policy::build_system_prompt_report(&PromptPolicyInput {
        runtime_context: runtime_context.clone(),
        persona: persona.clone(),
        active_skill_prompt: active_skill_prompt.to_string(),
        memory_prompt: memory_prompt.to_string(),
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
        computed_persona,
        first_used_at: first_used_at.map(str::to_string),
    })
}

pub(crate) fn model_tools() -> Vec<Value> {
    let mut tools = vec![clarification_ask_model_tool()];
    tools.extend(plan_model_tools());
    tools.extend(todo_model_tools());
    tools.extend(codex_code_model_tools());
    tools.extend(tools::tool_fs::model_provider_tools());
    tools.push(session_read_message_model_tool());
    tools
}

fn plan_model_tools() -> Vec<Value> {
    vec![
        function_tool(
            tools::PLAN_BEGIN_MODEL_TOOL,
            "Enter Plan Mode when the task needs an explicit user-reviewed plan. The agent decides whether planning is appropriate.",
            json!({
                "type": "object",
                "properties": {
                    "title": { "type": "string", "description": "Short human-readable plan title." },
                    "reason": { "type": "string", "description": "Optional reason for planning." },
                    "scope": { "type": "string", "description": "Optional scope and boundaries." }
                },
                "required": ["title"]
            }),
        ),
        function_tool(
            tools::PLAN_WRITE_MODEL_TOOL,
            "Append to or replace the active Plan Markdown draft.",
            json!({
                "type": "object",
                "properties": {
                    "planId": { "type": "string", "description": "Optional active plan id. Defaults to the current draft." },
                    "markdownDelta": { "type": "string", "description": "Markdown to append, or the full replacement when replace=true." },
                    "replace": { "type": "boolean", "description": "Replace the current draft instead of appending. Default false." }
                },
                "required": ["markdownDelta"]
            }),
        ),
        function_tool(
            tools::PLAN_FINALIZE_MODEL_TOOL,
            "Finalize the non-empty active Plan for user review. Runtime verifies that substantive investigation occurred during this Plan lifecycle.",
            json!({
                "type": "object",
                "properties": {
                    "planId": { "type": "string", "description": "Optional active plan id. Defaults to the current draft." },
                    "summary": { "type": "string", "description": "Optional short summary shown in the review panel." }
                }
            }),
        ),
        function_tool(
            tools::PLAN_REVISE_MODEL_TOOL,
            "Revise the active Plan after user edits, annotations, or Plan Chat feedback.",
            json!({
                "type": "object",
                "properties": {
                    "planId": { "type": "string", "description": "Optional active plan id. Defaults to the current draft." },
                    "markdown": { "type": "string", "description": "Optional full revised Markdown." },
                    "annotations": {
                        "type": "array",
                        "description": "Optional line or block annotations from user feedback.",
                        "items": { "type": "object" }
                    }
                }
            }),
        ),
    ]
}

fn todo_model_tools() -> Vec<Value> {
    let todo_item = json!({
        "type": "object",
        "properties": {
            "id": { "type": "string" },
            "content": { "type": "string" },
            "title": { "type": "string" },
            "status": { "type": "string", "enum": ["pending", "in_progress", "completed", "failed", "skipped", "cancelled"] },
            "priority": { "type": "string" },
            "blockedBy": { "type": "array", "items": { "type": "string" } }
        },
        "required": ["content"]
    });
    let evidence_ids = json!({
        "type": "array",
        "description": "Legacy optional activity ids retained for compatibility. They do not control Todo state transitions.",
        "items": { "type": "string" }
    });
    let design_dispositions = json!({
        "type": "array",
        "description": "Optional retained or ignored design finding dispositions used later by the independent Completion Gate.",
        "items": {
            "type": "object",
            "properties": {
                "ruleId": { "type": "string" },
                "disposition": { "type": "string", "enum": ["retained", "ignored"] },
                "rationale": { "type": "string" },
                "evidenceIds": evidence_ids.clone()
            },
            "required": ["ruleId", "disposition"],
            "additionalProperties": false
        }
    });
    vec![
        function_tool(
            tools::TODO_WRITE_MODEL_TOOL,
            "Create or replace the complete executable Todo list after Plan approval.",
            json!({
                "type": "object",
                "properties": {
                    "todos": {
                        "type": "array",
                        "description": "Complete ordered Todo list covering the approved Plan.",
                        "items": todo_item
                    }
                },
                "required": ["todos"]
            }),
        ),
        function_tool(
            tools::TODO_UPDATE_MODEL_TOOL,
            "Update one Todo's execution status. Mark failed or skipped items with a concrete failureReason.",
            json!({
                "type": "object",
                "properties": {
                    "id": { "type": "string", "description": "Todo id to update." },
                    "status": {
                        "type": "string",
                        "enum": ["pending", "in_progress", "completed", "failed", "skipped", "cancelled"]
                    },
                    "note": { "type": "string", "description": "Optional progress note." },
                    "evidence": { "type": "string", "description": "Optional concise explanation retained in Todo history." },
                    "failureReason": { "type": "string", "description": "Required by Runtime for failed or skipped status." }
                },
                "required": ["id", "status"]
            }),
        ),
        function_tool(
            tools::TODO_FINISH_MODEL_TOOL,
            "Finish the native Goal after every Todo has a real terminal status. Test and UI verification are enforced separately by the Completion Gate.",
            json!({
                "type": "object",
                "properties": {
                    "status": {
                        "type": "string",
                        "enum": ["completed", "failed", "cancelled"]
                    },
                    "summary": { "type": "string", "description": "Summary of the Goal's real terminal outcome." },
                    "designFindingDispositions": design_dispositions
                },
                "required": ["status", "summary"]
            }),
        ),
    ]
}

fn codex_code_model_tools() -> Vec<Value> {
    vec![
        function_tool(
            tools::READ_FILE_MODEL_TOOL,
            "Read one regular UTF-8 text file. This tool rejects directories and binary files; use glob to enumerate a directory and grep to search text.",
            json!({
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Workspace-relative or absolute path to a regular text file. Do not pass a directory such as ."
                    },
                    "startLine": {
                        "type": "integer",
                        "minimum": 1,
                        "description": "Optional 1-based first line."
                    },
                    "endLine": {
                        "type": "integer",
                        "minimum": 1,
                        "description": "Optional 1-based last line, inclusive. Must be greater than or equal to startLine when both are supplied."
                    },
                    "maxBytes": {
                        "type": "integer",
                        "minimum": 1,
                        "description": "Optional maximum bytes returned."
                    },
                    "encoding": {
                        "type": "string",
                        "enum": ["utf-8", "lossy-utf8"],
                        "description": "Text decoding mode. Default utf-8."
                    }
                },
                "required": ["path"]
            }),
        ),
        function_tool(
            tools::GLOB_MODEL_TOOL,
            "Enumerate files by glob pattern. Use this instead of read_file for directories or when finding files by name/path.",
            json!({
                "type": "object",
                "properties": {
                    "pattern": {
                        "type": "string",
                        "description": "Glob pattern such as *, **/*.rs, or src/**/mod.rs."
                    },
                    "root": {
                        "type": "string",
                        "description": "Directory to search. Defaults to the workspace root."
                    },
                    "includeHidden": {
                        "type": "boolean",
                        "description": "Include hidden files and directories. Default false."
                    },
                    "limit": {
                        "type": "integer",
                        "minimum": 1,
                        "maximum": 2000,
                        "description": "Maximum matches returned."
                    }
                },
                "required": ["pattern"]
            }),
        ),
        function_tool(
            tools::GREP_MODEL_TOOL,
            "Search file contents with ripgrep. Use this for literal or regex text search; use CodeGraph only for symbols, references, dependencies, callers, callees, impact, or complexity.",
            json!({
                "type": "object",
                "properties": {
                    "pattern": {
                        "type": "string",
                        "description": "Ripgrep regular expression."
                    },
                    "path": {
                        "type": "string",
                        "description": "File or directory to search. Defaults to the workspace root."
                    },
                    "glob": {
                        "type": "string",
                        "description": "Optional ripgrep file glob such as *.rs."
                    },
                    "caseInsensitive": {
                        "type": "boolean",
                        "description": "Use case-insensitive matching. Default false."
                    },
                    "contextLines": {
                        "type": "integer",
                        "minimum": 0,
                        "maximum": 10,
                        "description": "Context lines around each match."
                    },
                    "maxResults": {
                        "type": "integer",
                        "minimum": 1,
                        "maximum": 2000,
                        "description": "Maximum matching lines returned."
                    }
                },
                "required": ["pattern"]
            }),
        ),
        function_tool(
            tools::EXEC_COMMAND_MODEL_TOOL,
            "Execute a bounded, non-interactive shell command for repository inspection, tests, builds, git, and validation. File mutations should use edit_file or write_file.",
            json!({
                "type": "object",
                "properties": {
                    "cmd": {
                        "type": "string",
                        "description": "Shell command to execute."
                    },
                    "workdir": {
                        "type": "string",
                        "description": "Optional working directory. Defaults to the bound workspace root."
                    },
                    "timeout_ms": {
                        "type": "integer",
                        "minimum": 1,
                        "description": "Optional command timeout in milliseconds."
                    },
                    "max_output_tokens": {
                        "type": "integer",
                        "minimum": 1,
                        "description": "Optional approximate stdout/stderr token budget."
                    }
                },
                "required": ["cmd"]
            }),
        ),
        function_tool(
            tools::WRITE_STDIN_MODEL_TOOL,
            "Write characters to an existing active terminal session. Never guess a session id; use only an id returned by a terminal creation or run result. One-shot commands must use exec_command.",
            json!({
                "type": "object",
                "properties": {
                    "sessionId": {
                        "type": "string",
                        "description": "Existing active terminal session id from a prior successful tool result."
                    },
                    "chars": {
                        "type": "string",
                        "description": "Characters to send."
                    },
                    "appendNewline": {
                        "type": "boolean",
                        "description": "Append a newline after chars. Default false."
                    }
                },
                "required": ["sessionId", "chars"]
            }),
        ),
        function_tool(
            tools::EDIT_FILE_MODEL_TOOL,
            "Make targeted edits to an existing file. Preferred tool for modifying code: send only the regions you change as old_text/new_text pairs, never the whole file. old_text is matched against the current file (whitespace/indentation differences are tolerated and the replacement is reindented to match); it must be unique unless replace_all is set. Apply several edits to the same file in one call via the edits array.",
            json!({
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Workspace-relative path of the file to edit. A leading ~/ is expanded to the user home directory; other tilde variants (~user, ~+, ~-) are rejected."
                    },
                    "edits": {
                        "type": "array",
                        "description": "Ordered edits applied to the file. Each later edit sees the result of the earlier ones.",
                        "items": {
                            "type": "object",
                            "properties": {
                                "old_text": { "type": "string", "description": "Exact text to find in the current file (a few surrounding lines for uniqueness)." },
                                "new_text": { "type": "string", "description": "Replacement text." },
                                "replace_all": { "type": "boolean", "description": "Replace every occurrence instead of requiring a unique match. Default false." }
                            },
                            "required": ["old_text", "new_text"]
                        }
                    }
                },
                "required": ["path", "edits"]
            }),
        ),
        function_tool(
            tools::WRITE_FILE_MODEL_TOOL,
            "Create a new file, or overwrite a file in full, with its complete contents. Use this for brand-new files and for large generated artifacts (HTML, CSS, bundles) — there is no size limit, so send the whole file in one call rather than a patch. To change part of an existing file, prefer edit_file. Set overwrite=true to replace an existing file.",
            json!({
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Path relative to the bound workspace root. Do not prefix the workspace folder name itself: if the root is /Users/me/project, use src/a.ts, not project/src/a.ts. Parent directories are created as needed. A leading ~/ is expanded to the user home directory; other tilde variants (~user, ~+, ~-) are rejected."
                    },
                    "content": {
                        "type": "string",
                        "description": "Full contents of the file."
                    },
                    "overwrite": {
                        "type": "boolean",
                        "description": "Allow replacing an existing file. Default false (creating a new file)."
                    }
                },
                "required": ["path", "content"]
            }),
        ),
    ]
}

fn clarification_ask_model_tool() -> Value {
    function_tool(
        LYRA_CLARIFICATION_ASK_TOOL,
        "Structured blocking member question through the decision panel. Use only when progress genuinely needs member decision/input. Plain assistant text questions are non-blocking final text and never pause/resume the turn. Prefer safe assumptions when enough.",
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
        "Read the canonical full text of a prior session message. Accepts either messageId (from a lyra-transcript-cite block) or messageOrdinal (0-based index into the session message array).",
        json!({
            "type": "object",
            "properties": {
                "messageId": {
                    "type": "string",
                    "description": "Stable message id from a lyra-transcript-cite block."
                },
                "messageOrdinal": {
                    "type": "integer",
                    "description": "0-based index into the session message array. Use when you don't have a messageId."
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
            }
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

pub(crate) fn model_tool_names() -> Vec<String> {
    let mut names = Vec::new();
    names.push(LYRA_CLARIFICATION_ASK_TOOL.to_string());
    names.push(tools::PLAN_BEGIN_MODEL_TOOL.to_string());
    names.push(tools::PLAN_WRITE_MODEL_TOOL.to_string());
    names.push(tools::PLAN_FINALIZE_MODEL_TOOL.to_string());
    names.push(tools::PLAN_REVISE_MODEL_TOOL.to_string());
    names.push(tools::TODO_WRITE_MODEL_TOOL.to_string());
    names.push(tools::TODO_UPDATE_MODEL_TOOL.to_string());
    names.push(tools::TODO_FINISH_MODEL_TOOL.to_string());
    names.push(tools::READ_FILE_MODEL_TOOL.to_string());
    names.push(tools::GLOB_MODEL_TOOL.to_string());
    names.push(tools::GREP_MODEL_TOOL.to_string());
    names.push(tools::EXEC_COMMAND_MODEL_TOOL.to_string());
    names.push(tools::WRITE_STDIN_MODEL_TOOL.to_string());
    names.push(tools::EDIT_FILE_MODEL_TOOL.to_string());
    names.push(tools::WRITE_FILE_MODEL_TOOL.to_string());
    names.extend(tools::tool_fs::model_tool_names());
    names.push(LYRA_SESSION_READ_MESSAGE_TOOL.to_string());
    names
}
