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
    let cases = [
        (
            "open url in browser",
            ToolScene::Browser,
            "/tools/browser/navigate",
        ),
        (
            "run terminal command",
            ToolScene::Terminal,
            "/tools/shell/run",
        ),
        (
            "deep web research",
            ToolScene::General,
            "/tools/web/research",
        ),
        (
            "install mcp server",
            ToolScene::General,
            "/tools/mcp/server_upsert",
        ),
        ("enable skill", ToolScene::General, "/tools/skills/activate"),
    ];

    for (query, scene, expected_path) in cases {
        let response = registry
            .search(query, None, 0, 3, scene)
            .unwrap_or_else(|error| panic!("search failed for {query}: {error}"));
        assert_eq!(
            response.results.first().map(|result| result.path.as_str()),
            Some(expected_path),
            "query {query:?} should rank {expected_path} first"
        );
    }
}

#[test]
fn provider_visible_tool_names_are_minimal_and_ordered() {
    assert_eq!(
        provider_tool_names(),
        [
            "tool_fs_search",
            "tool_fs_list",
            "tool_fs_read_doc",
            "tool_fs_inspect",
            "tool_fs_run",
        ]
    );
}
