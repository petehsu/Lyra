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
    assert_eq!(
        registry.root_summary_for_scene(ToolScene::Git)["domains"][0],
        "codegraph"
    );
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

    for visible_domain in ["filesystem", "shell"] {
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
    assert!(
        registry
            .pinned_handles(ToolScene::ProjectCode)
            .iter()
            .any(|handle| handle.handle == "todo_write")
    );
}

#[test]
fn pinned_handles_include_manifest_metadata() {
    let registry = ToolFsRegistry::default();
    let handles = registry.pinned_handles(ToolScene::Git);
    assert!(
        handles
            .iter()
            .any(|handle| handle.handle == "terminal_list")
    );
    assert!(
        handles
            .iter()
            .any(|handle| handle.path == "/tools/terminal/read")
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
        "设计审查 去除模板化 AI 味",
    ] {
        let results = registry
            .search(query, None, 0, 5, ToolScene::General)
            .expect("design quality search");
        assert_eq!(
            results.results.first().map(|result| result.path.as_str()),
            Some("/tools/design/quality"),
            "{query}"
        );
    }
}

#[test]
fn computer_internal_surface_routes_are_declared_in_schemas() {
    let registry = ToolFsRegistry::default();
    for path in [
        "/tools/computer/map",
        "/tools/computer/find",
        "/tools/computer/explain",
    ] {
        let manifest = registry.inspect_path(path).expect("computer manifest");
        let properties = &manifest.input_schema["properties"];
        assert!(
            properties.get("surface").is_some(),
            "{path} is missing the documented surface route"
        );
        assert!(
            properties.get("tabId").is_some(),
            "{path} is missing the documented tabId route"
        );
    }
}
