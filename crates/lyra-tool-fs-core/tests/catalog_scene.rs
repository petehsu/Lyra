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
        session_kind: Some("selfdev".to_string()),
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
        active_skills: vec!["lyra-design-research".to_string()],
        ..ToolSceneSignals::default()
    };
    assert_eq!(infer_scene(&signals), ToolScene::Design);

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
    let git_root = registry
        .list("/tools", 0, 100, ToolScene::Git)
        .expect("git tools root");
    assert_eq!(
        registry.root_summary_for_scene(ToolScene::Git)["domains"][0],
        "git"
    );
    let general_domains = general_root
        .directories
        .iter()
        .map(|entry| entry.name.as_str())
        .collect::<HashSet<_>>();
    let git_domains = git_root
        .directories
        .iter()
        .map(|entry| entry.name.as_str())
        .collect::<HashSet<_>>();
    assert_eq!(general_domains, git_domains);
    assert_ne!(
        general_root.directories[0].name,
        git_root.directories[0].name
    );

    let general_filesystem = registry
        .list("/tools/filesystem", 0, 200, ToolScene::General)
        .expect("general filesystem tools");
    let project_filesystem = registry
        .list("/tools/filesystem", 0, 200, ToolScene::ProjectCode)
        .expect("project filesystem tools");
    let general_paths = general_filesystem
        .tools
        .iter()
        .map(|manifest| manifest.path.as_str())
        .collect::<HashSet<_>>();
    let project_paths = project_filesystem
        .tools
        .iter()
        .map(|manifest| manifest.path.as_str())
        .collect::<HashSet<_>>();
    assert_eq!(general_paths, project_paths);
    assert_eq!(project_filesystem.tools[0].path, "/tools/filesystem/glob");
    assert!(
        registry
            .pinned_handles(ToolScene::ProjectCode)
            .iter()
            .any(|handle| handle.handle == "strict_edit")
    );
}

#[test]
fn pinned_handles_include_manifest_metadata() {
    let registry = ToolFsRegistry::default();
    let handles = registry.pinned_handles(ToolScene::Git);
    assert!(handles.iter().any(|handle| handle.handle == "git_status"));
    assert!(
        handles
            .iter()
            .any(|handle| handle.path == "/tools/git/diff")
    );
}
