use lyra_tool_fs_core::*;
use serde_json::Value;
use std::collections::HashSet;

#[test]
fn builtin_manifests_have_searchable_metadata() {
    let registry = ToolFsRegistry::default();
    for manifest in registry.manifests() {
        assert!(!manifest.description.trim().is_empty(), "{}", manifest.path);
        assert!(!manifest.aliases.is_empty(), "{}", manifest.path);
        assert!(!manifest.examples.is_empty(), "{}", manifest.path);
        assert!(!manifest.tags.is_empty(), "{}", manifest.path);
    }
}

#[test]
fn manifest_input_schemas_have_stable_ids() {
    let registry = ToolFsRegistry::default();
    for manifest in registry.manifests() {
        let expected = schema_id_for_path(&manifest.path);
        assert_eq!(
            manifest.input_schema.get("$id").and_then(Value::as_str),
            Some(expected.as_str()),
            "{} schema id",
            manifest.path
        );
    }
}

#[test]
fn scene_package_uses_state_signals() {
    let signals = ToolSceneSignals {
        session_kind: Some("project-code".to_string()),
        ..ToolSceneSignals::default()
    };
    assert_eq!(infer_scene(&signals), ToolScene::ProjectCode);

    let signals = ToolSceneSignals {
        project_bound: true,
        git_repo: false,
        ..ToolSceneSignals::default()
    };
    assert_eq!(infer_scene(&signals), ToolScene::ProjectCode);

    let signals = ToolSceneSignals {
        git_repo: true,
        ..ToolSceneSignals::default()
    };
    assert_eq!(infer_scene(&signals), ToolScene::Git);

    let signals = ToolSceneSignals {
        terminal_active: true,
        ..ToolSceneSignals::default()
    };
    assert_eq!(infer_scene(&signals), ToolScene::Terminal);

    let signals = ToolSceneSignals {
        browser_active: true,
        ..ToolSceneSignals::default()
    };
    assert_eq!(infer_scene(&signals), ToolScene::Browser);

    let signals = ToolSceneSignals {
        editor_active: true,
        ..ToolSceneSignals::default()
    };
    assert_eq!(infer_scene(&signals), ToolScene::ProjectCode);

    let signals = ToolSceneSignals {
        software_active: true,
        ..ToolSceneSignals::default()
    };
    assert_eq!(infer_scene(&signals), ToolScene::Automation);

    let signals = ToolSceneSignals {
        active_tab_kind: Some("workbench".to_string()),
        ..ToolSceneSignals::default()
    };
    assert_eq!(infer_scene(&signals), ToolScene::Workbench);
}

#[test]
fn scene_changes_sorting_and_pins_without_hiding_tools() {
    let registry = ToolFsRegistry::default();
    let general_root = registry
        .list("/tools", 0, 100, ToolScene::General)
        .expect("general tools root");
    let project_root = registry
        .list("/tools", 0, 100, ToolScene::Git)
        .expect("git tools root");
    let general_domains = general_root
        .directories
        .iter()
        .map(|entry| entry.name.as_str())
        .collect::<HashSet<_>>();
    let project_domains = project_root
        .directories
        .iter()
        .map(|entry| entry.name.as_str())
        .collect::<HashSet<_>>();
    assert_eq!(general_domains, project_domains);
    assert_ne!(
        general_root.directories[0].name,
        project_root.directories[0].name
    );

    for visible_domain in ["filesystem"] {
        let listed = registry
            .list(
                &format!("/tools/{visible_domain}"),
                0,
                200,
                ToolScene::ProjectCode,
            )
            .unwrap_or_else(|error| {
                panic!(
                    "{visible_domain} should remain discoverable; scenes only reorder and pin tools: {error:?}"
                )
        });
        assert!(
            !listed.tools.is_empty(),
            "{visible_domain} should remain discoverable; scenes only reorder and pin tools"
        );
    }
    assert!(registry.pinned_handles(ToolScene::ProjectCode).is_empty());
}

#[test]
fn pinned_handles_ignore_removed_manifest_handles() {
    let registry = ToolFsRegistry::default();
    assert!(registry.pinned_handles(ToolScene::Git).is_empty());
    assert!(registry.pinned_handles(ToolScene::Terminal).is_empty());
    assert_eq!(
        registry
            .pinned_handles(ToolScene::Automation)
            .first()
            .map(|handle| handle.path.as_str()),
        Some("/tools/todo/read")
    );
}

#[test]
fn tool_directory_listing_rejects_local_filesystem_paths() {
    let registry = ToolFsRegistry::default();
    let error = registry
        .list("/Users/petehsu/Documents/test", 0, 80, ToolScene::General)
        .expect_err("local paths are not Tool-FS directories");
    assert_eq!(error.code, "invalid_tool_fs_path");
    assert!(error.recommended_next_action.contains("filesystem list"));
}

#[test]
fn design_quality_tool_has_native_schema_and_bilingual_search_intent() {
    let registry = ToolFsRegistry::default();
    let manifest = registry
        .inspect_path("/tools/design/quality")
        .expect("design quality manifest");
    assert_eq!(manifest.handle.as_deref(), Some("design_quality"));
    assert_eq!(
        manifest.input_schema["properties"]["action"]["enum"],
        serde_json::json!(["list_rules", "read_rule", "audit_source", "audit_rendered"])
    );
    for property in [
        "ruleId",
        "path",
        "includeGlobs",
        "excludeGlobs",
        "categories",
        "ruleIds",
        "surfaceKind",
        "url",
        "targetSelector",
        "viewport",
        "maxFiles",
        "maxElements",
        "maxFindings",
        "includeScreenshot",
    ] {
        assert!(
            manifest.input_schema["properties"].get(property).is_some(),
            "missing design quality schema field {property}"
        );
    }

    for query in [
        "UI quality audit remove template AI slop",
        "design quality audit frontend",
    ] {
        let results = registry
            .search(query, None, 0, 8, ToolScene::General)
            .expect("design quality search");
        assert!(
            results
                .results
                .iter()
                .any(|result| result.path == "/tools/design/quality"),
            "{query} -> {:?}",
            results
                .results
                .iter()
                .map(|result| result.path.as_str())
                .collect::<Vec<_>>()
        );
    }
}

#[test]
fn computer_schemas_match_this_os_and_stay_native() {
    let registry = ToolFsRegistry::default();
    for path in [
        "/tools/computer/map",
        "/tools/computer/find",
        "/tools/computer/explain",
    ] {
        let manifest = registry.inspect_path(path).expect("computer manifest");
        let properties = &manifest.input_schema["properties"];
        assert!(
            properties.get("surface").is_none(),
            "{path} must not advertise Lyra surface routing"
        );
        assert!(
            properties.get("tabId").is_none(),
            "{path} must not advertise Lyra tab routing"
        );
        assert!(
            !manifest.summary.contains("lyra-browser"),
            "{path} summary still mentions lyra-browser"
        );
    }

    let act = registry
        .inspect_path("/tools/computer/act")
        .expect("computer act");
    let os_ref = act.input_schema["properties"]["osRef"]["description"]
        .as_str()
        .expect("osRef description");
    let actions = act.input_schema["properties"]["action"]["enum"]
        .as_array()
        .expect("action enum");
    let action_names: Vec<&str> = actions
        .iter()
        .filter_map(serde_json::Value::as_str)
        .collect();
    assert!(!os_ref.contains("lyb"));
    assert!(!os_ref.contains("osax:") || cfg!(target_os = "macos"));
    assert!(!os_ref.contains("uia:") || cfg!(windows));
    assert!(!os_ref.contains("atspi:") || cfg!(target_os = "linux"));

    #[cfg(target_os = "linux")]
    {
        assert!(os_ref.contains("atspi:"));
        assert!(!action_names.contains(&"pressKey"));
        assert!(!action_names.contains(&"drag"));
        assert!(!act.description.contains("AXShowMenu"));
        assert!(!act.description.contains("cmd+c"));
        let focus = registry
            .inspect_path("/tools/computer/focus")
            .expect("computer focus");
        let focus_props = &focus.input_schema["properties"];
        assert!(focus_props.get("lyraTabId").is_none());
        assert!(focus_props.get("bundleId").is_none());
        assert!(focus_props.get("pid").is_none());
    }

    #[cfg(target_os = "macos")]
    {
        assert!(os_ref.contains("osax:"));
        assert!(action_names.contains(&"pressKey"));
        assert!(act.description.contains("cmd+c"));
    }

    #[cfg(windows)]
    {
        assert!(os_ref.contains("uia:"));
        assert!(action_names.contains(&"pressKey"));
        assert!(act.description.contains("ctrl+c"));
    }
}

#[test]
fn capture_visual_evidence_schema_declares_scope() {
    let registry = ToolFsRegistry::default();
    let manifest = registry
        .inspect_path("/tools/workbench/capture_visual_evidence")
        .expect("capture visual evidence manifest");
    let properties = &manifest.input_schema["properties"];
    assert_eq!(
        properties["scope"]["enum"],
        serde_json::json!(["workspace_window", "active_tab"])
    );
    assert!(properties.get("tabId").is_some());
}

#[test]
fn memory_search_and_write_replace_list_and_crud_verbs() {
    let registry = ToolFsRegistry::default();
    let search = registry
        .inspect_path("/tools/memory/search")
        .expect("memory search");
    assert_eq!(search.handle.as_deref(), Some("memory_search"));
    assert!(
        search.input_schema["properties"]["query"]["description"]
            .as_str()
            .is_some_and(|text| text.contains("empty"))
    );

    let write = registry
        .inspect_path("/tools/memory/write")
        .expect("memory write");
    assert_eq!(write.handle.as_deref(), Some("memory_write"));
    assert_eq!(write.risk_level, "memory_mutation");
    assert_eq!(
        write.input_schema["required"],
        serde_json::json!(["action"])
    );
    let actions = write.input_schema["properties"]["action"]["enum"]
        .as_array()
        .expect("action enum");
    let action_names: Vec<&str> = actions
        .iter()
        .filter_map(serde_json::Value::as_str)
        .collect();
    assert_eq!(action_names, vec!["remember", "update", "forget", "link"]);

    for gone in [
        "/tools/memory/list",
        "/tools/memory/remember",
        "/tools/memory/update",
        "/tools/memory/forget",
        "/tools/memory/link",
    ] {
        assert!(
            registry.inspect_path(gone).is_err(),
            "{gone} must not remain in the catalog"
        );
    }
}
