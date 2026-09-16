use std::collections::HashSet;

use lyra_tool_fs_core::{ToolFsRegistry, ToolScene, provider_tool_names};

#[test]
fn builtin_catalog_has_unique_paths_handles_and_required_fields() {
    let registry = ToolFsRegistry::default();
    let mut paths = HashSet::new();
    let mut handles = HashSet::new();

    for manifest in registry.manifests() {
        assert!(
            paths.insert(manifest.path.as_str()),
            "duplicate tool path: {}",
            manifest.path
        );
        if let Some(handle) = manifest.handle.as_deref() {
            assert!(handles.insert(handle), "duplicate tool handle: {handle}");
        }
        assert!(
            manifest.path.starts_with("/tools/"),
            "bad path: {}",
            manifest.path
        );
        assert!(
            !manifest.domain.trim().is_empty(),
            "missing domain: {}",
            manifest.path
        );
        assert!(
            !manifest.operation.trim().is_empty(),
            "missing operation: {}",
            manifest.path
        );
        assert!(
            !manifest.title.trim().is_empty(),
            "missing title: {}",
            manifest.path
        );
        assert!(
            !manifest.summary.trim().is_empty(),
            "missing summary: {}",
            manifest.path
        );
        assert!(
            manifest.input_schema.get("type").is_some(),
            "missing input schema type: {}",
            manifest.path
        );
        assert!(
            manifest.input_schema.get("$id").is_some(),
            "missing input schema id: {}",
            manifest.path
        );
    }
}

#[test]
fn search_top_results_for_core_intents_stay_stable() {
    let registry = ToolFsRegistry::default();
    let exact = registry
        .search("web_search", None, 0, 3, ToolScene::General)
        .expect("exact name");
    assert_eq!(
        exact.results.first().map(|result| result.path.as_str()),
        Some("/tools/web/search")
    );

    let cases = [
        (
            "open url in browser",
            ToolScene::Browser,
            "/tools/browser/navigate",
        ),
        (
            "deep web research",
            ToolScene::General,
            "/tools/web/research",
        ),
        (
            "mcp server upsert",
            ToolScene::General,
            "/tools/mcp/server_upsert",
        ),
        ("enable skill", ToolScene::General, "/tools/skills/activate"),
    ];

    for (query, scene, expected_path) in cases {
        let response = registry
            .search(query, None, 0, 8, scene)
            .unwrap_or_else(|error| panic!("search failed for {query}: {error}"));
        assert!(
            response
                .results
                .iter()
                .any(|result| result.path == expected_path),
            "query {query:?} should include {expected_path} in {:?}",
            response
                .results
                .iter()
                .map(|result| result.path.as_str())
                .collect::<Vec<_>>()
        );
    }
}

#[test]
fn duplicate_dead_and_hardware_manifests_are_absent() {
    let registry = ToolFsRegistry::default();
    for path in [
        "/tools/filesystem/read_file",
        "/tools/filesystem/grep",
        "/tools/filesystem/glob",
        "/tools/shell/run",
        "/tools/clarification/ask",
        "/tools/todo/write",
        "/tools/terminal/read",
        "/tools/hardware/list",
    ] {
        assert!(
            registry.inspect_path(path).is_err(),
            "removed Tool-FS manifest still exists: {path}"
        );
    }

    for path in ["/tools/filesystem/list_files", "/tools/todo/read"] {
        assert!(
            registry.inspect_path(path).is_ok(),
            "non-duplicate Tool-FS manifest was removed: {path}"
        );
    }
}

#[test]
fn provider_visible_tool_names_are_minimal_and_ordered() {
    assert_eq!(provider_tool_names(), Vec::<String>::new());
}
