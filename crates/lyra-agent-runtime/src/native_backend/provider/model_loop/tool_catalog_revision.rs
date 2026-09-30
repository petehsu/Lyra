use super::*;

pub(super) fn current_tool_catalog_revision(session_id: &str) -> Value {
    state()
        .lock()
        .ok()
        .and_then(|state| {
            state.sessions.get(session_id).map(|session| {
                json!([
                    session.snapshot.get(DISCOVERED_TOOL_NAMES_KEY),
                    session.snapshot.get(EPHEMERAL_OFFICE_TOOLS_KEY),
                ])
            })
        })
        .unwrap_or(Value::Null)
}

pub(super) fn tool_can_change_catalog(call: &ModelToolCall) -> bool {
    // Discovery changes schemas; management changes registry membership.
    // Executing a capability, listing or reading its state changes neither.
    if call.name == TOOL_SEARCH_TOOL_NAME {
        return true;
    }
    const MANAGEMENT: &[&str] = &[
        "mcp_server_connect",
        "mcp_server_upsert",
        "mcp_server_remove",
        "mcp_server_disconnect",
        "mcp_server_reload",
        "mcp_tool_discover",
        "skills_activate",
        "skills_deactivate",
        "skills_install_local",
        "skills_install_git",
        "skills_install_store",
        "skills_uninstall",
    ];
    MANAGEMENT.contains(&call.name.as_str())
        || call
            .arguments
            .get("path")
            .and_then(Value::as_str)
            .is_some_and(|path| {
                let name = path.trim_start_matches("/tools/").replace('/', "_");
                MANAGEMENT.contains(&name.as_str())
            })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn browser_actions_do_not_refresh_unrelated_software_schemas() {
        for name in [
            "browser_act",
            "browser_type",
            "browser_wait",
            "exec_command",
            "read_file",
            "software_invoke",
            "software__file-manager__file-manager_openPath",
            "mcp__docs__search",
            "skills_list",
        ] {
            assert!(!tool_can_change_catalog(&ModelToolCall {
                id: "call".into(),
                name: name.into(),
                arguments: json!({})
            }));
        }
        for name in [
            TOOL_SEARCH_TOOL_NAME,
            "mcp_server_connect",
            "skills_install_local",
        ] {
            assert!(tool_can_change_catalog(&ModelToolCall {
                id: "call".into(),
                name: name.into(),
                arguments: json!({})
            }));
        }
    }

    #[test]
    fn first_map_promotes_actions_but_repeated_maps_keep_the_same_revision() {
        let created = LyraAgentBackend
            .call_agent_method(
                "agent.session.create",
                json!({"title":"catalog revision regression"}),
            )
            .unwrap();
        let session_id = created["id"].as_str().unwrap();
        let before = current_tool_catalog_revision(session_id);
        tools::tool_search::record_browser_follow_tools(session_id, "browser_map");
        let promoted = current_tool_catalog_revision(session_id);
        assert_ne!(before, promoted);
        assert!(promoted.to_string().contains("browser_upload"));
        tools::tool_search::record_browser_follow_tools(session_id, "browser_map");
        assert_eq!(promoted, current_tool_catalog_revision(session_id));
        tools::tool_search::record_discovered_tool_names(
            session_id,
            &["another_discovered_tool".into()],
        );
        assert_ne!(promoted, current_tool_catalog_revision(session_id));
    }
}
