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
    call.name == TOOL_SEARCH_TOOL_NAME
        || ["mcp", "skill", "software"]
            .iter()
            .any(|prefix| call.name.starts_with(prefix))
        || call
            .arguments
            .get("path")
            .and_then(Value::as_str)
            .is_some_and(|path| {
                ["/tools/mcp/", "/tools/skills/", "/tools/software/"]
                    .iter()
                    .any(|prefix| path.starts_with(prefix))
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
            "skills_install",
            "software_invoke",
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
