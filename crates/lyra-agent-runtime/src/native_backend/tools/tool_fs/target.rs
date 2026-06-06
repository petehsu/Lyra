use super::*;

pub(crate) enum RuntimeToolTarget {
    MemoryAdapter {
        tool_name: &'static str,
        action: &'static str,
    },
    Clarification,
    NativeAdapter {
        tool_name: &'static str,
        display_name: &'static str,
        action: &'static str,
    },
    DesignAdapter {
        tool_name: &'static str,
        action: &'static str,
    },
    SkillAdapter {
        tool_name: &'static str,
        action: &'static str,
    },
    McpAdapter {
        tool_name: &'static str,
        action: &'static str,
    },
    HostAdapter {
        host_method: &'static str,
        display_name: &'static str,
        action: &'static str,
    },
    SoftwareCapability {
        software_id: String,
        action_id: String,
    },
    Git,
}

pub(crate) fn runtime_target_for_manifest(manifest: &ToolManifest) -> Option<RuntimeToolTarget> {
    if let Some((software_id, action_id)) = parse_software_capability_path(&manifest.path) {
        return Some(RuntimeToolTarget::SoftwareCapability {
            software_id,
            action_id,
        });
    }
    if manifest.domain == "terminal"
        && let Some(spec) = terminal_action_spec(&manifest.operation)
    {
        return Some(RuntimeToolTarget::HostAdapter {
            host_method: spec.host_method,
            display_name: "terminal",
            action: spec.action,
        });
    }
    let host = |host_method, display_name, action| RuntimeToolTarget::HostAdapter {
        host_method,
        display_name,
        action,
    };
    let memory = |tool_name, action| RuntimeToolTarget::MemoryAdapter { tool_name, action };
    let native = |tool_name, display_name, action| RuntimeToolTarget::NativeAdapter {
        tool_name,
        display_name,
        action,
    };
    let design = |tool_name, action| RuntimeToolTarget::DesignAdapter { tool_name, action };
    let skill = |tool_name, action| RuntimeToolTarget::SkillAdapter { tool_name, action };
    let mcp = |tool_name, action| RuntimeToolTarget::McpAdapter { tool_name, action };
    let git = RuntimeToolTarget::Git;
    Some(match manifest.path.as_str() {
        "/tools/runtime/artifact_read" => native("artifact_read", "artifact", "read"),
        "/tools/memory/search" => memory("memory_search", "search"),
        "/tools/memory/remember" => memory("memory_remember", "remember"),
        "/tools/memory/update" => memory("memory_update", "update"),
        "/tools/memory/forget" => memory("memory_forget", "forget"),
        "/tools/memory/list" => memory("memory_list", "list"),
        "/tools/memory/link" => memory("memory_link", "link"),
        "/tools/memory/review_candidates" => {
            memory("memory_review_candidates", "review_candidates")
        }
        "/tools/memory/apply_candidate" => memory("memory_apply_candidate", "apply_candidate"),
        "/tools/memory/reject_candidate" => memory("memory_reject_candidate", "reject_candidate"),
        "/tools/memory/explain_injection" => {
            memory("memory_explain_injection", "explain_injection")
        }
        "/tools/clarification/ask" => RuntimeToolTarget::Clarification,
        "/tools/workbench/list_tabs" => host("workbench.listTabs", "workbench", "list_tabs"),
        "/tools/workbench/read_workspace" => {
            host("workbench.readWorkspace", "workbench", "read_workspace")
        }
        "/tools/workbench/read_tab" => host("workbench.readTab", "workbench", "read_tab"),
        "/tools/workbench/activate_tab" => {
            host("workbench.activateTab", "workbench", "activate_tab")
        }
        "/tools/software/list_capabilities" => {
            host("software.listCapabilities", "software", "list_capabilities")
        }
        "/tools/software/inspect_capability" => host(
            "software.inspectCapability",
            "software",
            "inspect_capability",
        ),
        "/tools/software/read_state" => host("software.readState", "software", "read_state"),
        "/tools/software/invoke_capability" => {
            host("software.invokeCapability", "software", "invoke_capability")
        }
        "/tools/browser/map" => host("lyraLumen.map", "lyra_lumen", "map"),
        "/tools/browser/read" => host("lyraLumen.read", "lyra_lumen", "read"),
        "/tools/browser/find" => host("lyraLumen.find", "lyra_lumen", "find"),
        "/tools/browser/locate" => host("lyraLumen.locate", "lyra_lumen", "locate"),
        "/tools/browser/see" => host("lyraLumen.see", "lyra_lumen", "see"),
        "/tools/browser/act" => host("lyraLumen.act", "lyra_lumen", "act"),
        "/tools/browser/type" => host("lyraLumen.type", "lyra_lumen", "type"),
        "/tools/browser/press" => host("lyraLumen.press", "lyra_lumen", "press"),
        "/tools/browser/submit" => host("lyraLumen.submit", "lyra_lumen", "submit"),
        "/tools/browser/scroll" => host("lyraLumen.scroll", "lyra_lumen", "scroll"),
        "/tools/browser/scroll_to_target" => {
            host("lyraLumen.scroll", "lyra_lumen", "scroll_to_target")
        }
        "/tools/browser/ensure_visible" => host("lyraLumen.scroll", "lyra_lumen", "ensure_visible"),
        "/tools/browser/wait" => host("lyraLumen.wait", "lyra_lumen", "wait"),
        "/tools/browser/read_until" => host("lyraLumen.wait", "lyra_lumen", "read_until"),
        "/tools/browser/navigate" => host("lyraLumen.navigate", "lyra_lumen", "navigate"),
        "/tools/browser/reveal" => host("lyraLumen.reveal", "lyra_lumen", "reveal"),
        "/tools/browser/focus_scan" => host("lyraLumen.focusScan", "lyra_lumen", "focus_scan"),
        "/tools/browser/follow_audit" => {
            host("lyraLumen.followAudit", "lyra_lumen", "follow_audit")
        }
        "/tools/browser/explain_target" => {
            host("lyraLumen.explainTarget", "lyra_lumen", "explain_target")
        }
        "/tools/browser/audit" => host("lyraLumen.audit", "lyra_lumen", "audit"),
        "/tools/browser/elevate" => host("lyraLumen.elevate", "lyra_lumen", "elevate"),
        "/tools/filesystem/list_files" => native("file_list", "file", "list"),
        "/tools/filesystem/read_file" | "/tools/filesystem/read_range" => {
            native("file_read", "file", "read")
        }
        "/tools/filesystem/glob" => native("file_glob", "file", "glob"),
        "/tools/filesystem/write_file" => native("file_write", "file", "write"),
        "/tools/filesystem/edit_file" => native("file_edit", "file", "edit"),
        "/tools/filesystem/strict_edit" => native("file_strict_edit", "file", "strict_edit"),
        "/tools/filesystem/multi_edit" => native("file_multiedit", "file", "multiedit"),
        "/tools/filesystem/apply_patch" => native("apply_patch", "file", "apply_patch"),
        "/tools/code/search_project" => native("project_search", "search", "project"),
        "/tools/code/search_code" => native("code_search_text", "code", "search_text"),
        "/tools/code/search_symbol" => native("code_search_symbol", "code", "search_symbol"),
        "/tools/code/graph_expand" => native("code_graph_expand", "code", "graph_expand"),
        "/tools/code/lsp_query" => native("lsp_query", "lsp", "query"),
        "/tools/shell/run_command" => native("shell_run", "shell", "run"),
        "/tools/git/status" | "/tools/git/diff" | "/tools/git/stage" | "/tools/git/unstage"
        | "/tools/git/discard" | "/tools/git/log" | "/tools/git/show" | "/tools/git/branch" => git,
        "/tools/network/status" => native("network_status", "network", "status"),
        "/tools/web/search" => native("web_search", "web", "search"),
        "/tools/web/fetch" => native("web_fetch", "web", "fetch"),
        "/tools/render/surface" => native("render_surface", "render", "surface"),
        "/tools/todo/read" => native("todo_read", "todo", "read"),
        "/tools/todo/write" => native("todo_write", "todo", "write"),
        "/tools/design/search_styles" => design("lyra_design_search_styles", "search_styles"),
        "/tools/design/get_style_details" => {
            design("lyra_design_get_style_details", "get_style_details")
        }
        "/tools/skills/list" => skill("skill_list", "list"),
        "/tools/skills/inspect" => skill("skill_inspect", "inspect"),
        "/tools/skills/activate" => skill("skill_activate", "activate"),
        "/tools/skills/deactivate" => skill("skill_deactivate", "deactivate"),
        "/tools/mcp/server_list" => mcp("mcp_server_list", "server_list"),
        "/tools/mcp/server_connect" => mcp("mcp_server_connect", "server_connect"),
        "/tools/mcp/server_disconnect" => mcp("mcp_server_disconnect", "server_disconnect"),
        "/tools/mcp/server_reload" => mcp("mcp_server_reload", "server_reload"),
        "/tools/mcp/tool_discover" => mcp("mcp_tool_discover", "tool_discover"),
        "/tools/mcp/tool_inspect" => mcp("mcp_tool_inspect", "tool_inspect"),
        "/tools/mcp/tool_execute" => mcp("mcp_tool_execute", "tool_execute"),
        _ => return None,
    })
}

pub(super) fn validate_runtime_target_availability(
    manifest: &ToolManifest,
    target: &RuntimeToolTarget,
    dispatcher: Option<&Arc<HostCapabilityDispatcher>>,
) -> Result<(), NativeToolFailure> {
    if matches!(
        target,
        RuntimeToolTarget::HostAdapter { .. } | RuntimeToolTarget::SoftwareCapability { .. }
    ) && dispatcher.is_none()
    {
        return Err(NativeToolFailure::new(
            "host_unavailable",
            format!(
                "Tool-FS target {} requires the Lyra host capability bridge, but it is not available.",
                manifest.path
            ),
            "Retry when the desktop host bridge is available, or choose a local-only Tool-FS target.",
        )
        .with_detail(json!({
            "toolPath": manifest.path,
            "domain": manifest.domain,
            "operation": manifest.operation,
            "permissionPolicy": manifest.permission_policy,
        })));
    }
    Ok(())
}

pub(super) fn validate_workspace_scope_for_manifest(
    session_id: &str,
    manifest: &ToolManifest,
) -> Result<(), NativeToolFailure> {
    if !manifest_requires_workspace_scope(manifest) {
        return Ok(());
    }
    session_workspace_root(session_id)
        .map(|_| ())
        .map_err(|failure| {
            let mut detail = json!({
                "toolPath": manifest.path,
                "domain": manifest.domain,
                "operation": manifest.operation,
                "permissionPolicy": manifest.permission_policy,
                "scope": "workspace",
            });
            if let Some(cause) = failure.detail {
                detail["cause"] = cause;
            }
            NativeToolFailure {
                code: failure.code,
                message: failure.message,
                recommended_next_action: failure.recommended_next_action,
                detail: Some(detail),
            }
        })
}

pub(super) fn manifest_requires_workspace_scope(manifest: &ToolManifest) -> bool {
    matches!(
        manifest.domain.as_str(),
        "filesystem" | "code" | "shell" | "git"
    )
}

pub(super) fn validate_runtime_turn_for_operation(
    session_id: &str,
    turn_id: &str,
) -> Result<(), NativeToolFailure> {
    let state = state().lock().map_err(|_| {
        NativeToolFailure::new(
            "runtime_state_unavailable",
            "agent runtime state lock failed",
            "Retry the tool call.",
        )
    })?;
    let session = state.sessions.get(session_id).ok_or_else(|| {
        NativeToolFailure::new(
            "session_not_found",
            format!("Agent session was not found: {session_id}"),
            "Create or restore an Agent session before running tools.",
        )
    })?;
    let active_turn = session
        .snapshot
        .get("activeTurnId")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let status = session
        .snapshot
        .get("turnStatus")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if status != "running" || active_turn != turn_id {
        return Err(NativeToolFailure::new(
            "runtime_turn_not_active",
            format!("Runtime turn {turn_id} is not active for session {session_id}."),
            "Stop this tool call and wait for the active Agent turn.",
        )
        .with_detail(json!({
            "turnStatus": status,
            "activeTurnId": active_turn,
        })));
    }
    let turn_exists = session.runtime_turns.iter().any(|turn| {
        turn.get("runtimeTurnId").and_then(Value::as_str) == Some(turn_id)
            && turn.get("sessionId").and_then(Value::as_str) == Some(session_id)
    });
    if !turn_exists {
        return Err(NativeToolFailure::new(
            "missing_runtime_turn",
            format!("Runtime turn record was not found: {turn_id}"),
            "Retry inside a valid Agent runtime turn.",
        ));
    }
    if state.cancelled_turns.contains(turn_id) {
        return Err(NativeToolFailure::new(
            "operation_cancelled",
            "Tool-FS operation was cancelled before execution.",
            "Stop this tool call and wait for a new user turn.",
        ));
    }
    Ok(())
}

pub(crate) fn path_for_activity(name: &str, action: &str) -> Option<String> {
    let registry = runtime_registry();
    registry
        .manifests()
        .iter()
        .find(|manifest| {
            if manifest.domain == name && manifest.operation == action {
                return true;
            }
            if name == "lyra_lumen" && manifest.domain == "browser" && manifest.operation == action
            {
                return true;
            }
            if name == "file" && manifest.domain == "filesystem" && manifest.operation == action {
                return true;
            }
            if name == "search" && manifest.path == "/tools/code/search_project" {
                return true;
            }
            if name == "code" && manifest.domain == "code" && manifest.operation == action {
                return true;
            }
            if name == "lsp" && manifest.path == "/tools/code/lsp_query" && action == "query" {
                return true;
            }
            if name == "artifact" && manifest.path == "/tools/runtime/artifact_read" {
                return true;
            }
            if name == "lyra_design" && manifest.domain == "design" && manifest.operation == action
            {
                return true;
            }
            false
        })
        .map(|manifest| manifest.path.clone())
}
