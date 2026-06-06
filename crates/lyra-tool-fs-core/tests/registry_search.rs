mod common;

use common::*;
use lyra_tool_fs_core::*;
use serde_json::json;

#[test]
fn registry_lists_root_and_pages_domain_tools() {
    let registry = ToolFsRegistry::default();
    let root = registry
        .list("/tools", 0, 80, ToolScene::General)
        .expect("root");
    assert_eq!(root.path, "/tools");
    assert!(
        root.directories
            .iter()
            .any(|entry| entry.name == "filesystem")
    );
    assert!(root.directories.iter().any(|entry| entry.name == "git"));

    let files = registry
        .list("/tools/filesystem", 0, 2, ToolScene::ProjectCode)
        .expect("filesystem");
    assert_eq!(files.page_size, 2);
    assert_eq!(files.tools.len(), 2);
    assert!(files.has_more);

    let files_page_2 = registry
        .list("/tools/filesystem", 1, 2, ToolScene::ProjectCode)
        .expect("filesystem page 2");
    assert_eq!(files_page_2.page, 1);
    assert_eq!(files_page_2.page_size, 2);
    assert_ne!(files.tools[0].path, files_page_2.tools[0].path);

    let git_tools = registry
        .list("/tools/git", 0, 20, ToolScene::Git)
        .expect("git tools");
    assert_eq!(
        git_tools
            .tools
            .first()
            .and_then(|tool| tool.handle.as_deref()),
        Some("git_status")
    );
}

#[test]
fn registry_reads_docs_and_inspects_path_and_handle() {
    let registry = ToolFsRegistry::default();
    let root_doc = registry.read_doc("/tools").expect("root doc");
    assert_eq!(root_doc["kind"], "tool_fs_doc");

    let domain_doc = registry.read_doc("/tools/git").expect("git doc");
    assert_eq!(domain_doc["path"], "/tools/git");
    assert!(
        domain_doc["content"]
            .as_str()
            .is_some_and(|content| content.contains("Git"))
    );

    let tool_doc = registry
        .read_doc("/tools/shell/run_command")
        .expect("tool doc");
    assert_eq!(tool_doc["path"], "/tools/shell/run_command");
    assert_eq!(tool_doc["title"], "Run command");
    assert!(
        tool_doc["content"]
            .as_str()
            .is_some_and(|content| content.contains("bounded shell command"))
    );

    let by_path = registry
        .inspect_path("/tools/filesystem/read_file")
        .expect("path");
    assert_eq!(by_path.handle.as_deref(), Some("read_file"));
    assert_eq!(by_path.input_schema["type"], "object");

    let by_handle = registry.inspect_handle("run_command").expect("handle");
    assert_eq!(by_handle.path, "/tools/shell/run_command");
}

#[test]
fn manifest_projection_does_not_expose_legacy_name() {
    let registry = ToolFsRegistry::default();
    let manifest = registry
        .inspect_path("/tools/filesystem/read_file")
        .expect("manifest");
    let json = serde_json::to_value(manifest).expect("manifest json");
    let legacy_field = ["legacy", "Name"].join("");
    assert!(json.get(&legacy_field).is_none());
    assert!(json.get("inputSchema").is_some());
    assert!(json.get("handle").is_some());
}

#[test]
fn provider_visible_names_include_search_first() {
    assert_eq!(
        provider_tool_names(),
        vec![
            "tool_fs_search".to_string(),
            "tool_fs_list".to_string(),
            "tool_fs_read_doc".to_string(),
            "tool_fs_inspect".to_string(),
            "tool_fs_run".to_string(),
        ]
    );
}

#[test]
fn registry_search_finds_tools_by_natural_language_and_fuzzy_terms() {
    let registry = ToolFsRegistry::default();
    let edit = registry
        .search("修改文件 edit code", None, 0, 5, ToolScene::ProjectCode)
        .expect("edit search");
    assert!(
        edit.results
            .iter()
            .any(|result| result.path == "/tools/filesystem/apply_patch")
            || edit
                .results
                .iter()
                .any(|result| result.path == "/tools/filesystem/edit_file")
    );

    let command = registry
        .search("执行测试命令", None, 0, 5, ToolScene::ProjectCode)
        .expect("command search");
    assert!(
        command
            .results
            .iter()
            .any(|result| result.path == "/tools/shell/run_command")
    );

    let git = registry
        .search("查看 git diff 代码变更", None, 0, 5, ToolScene::Git)
        .expect("git search");
    assert_eq!(
        git.results.first().map(|result| result.path.as_str()),
        Some("/tools/git/diff")
    );

    let browser = registry
        .search("brower page text", None, 0, 5, ToolScene::Browser)
        .expect("browser fuzzy search");
    assert!(
        browser
            .results
            .iter()
            .any(|result| result.path == "/tools/browser/read")
    );

    let browser_find = registry
        .search(
            "search in page locate section",
            None,
            0,
            5,
            ToolScene::Browser,
        )
        .expect("browser find search");
    assert!(browser_find.results.iter().any(|result| {
        result.path == "/tools/browser/find" || result.path == "/tools/browser/locate"
    }));

    let browser_locate = registry
        .search("定位页面段落", None, 0, 5, ToolScene::Browser)
        .expect("browser locate search");
    assert!(
        browser_locate
            .results
            .iter()
            .any(|result| result.path == "/tools/browser/locate")
    );

    let browser_scroll = registry
        .search(
            "滚到按钮附近 bring target into view",
            None,
            0,
            5,
            ToolScene::Browser,
        )
        .expect("browser scroll search");
    assert!(browser_scroll.results.iter().any(|result| {
        result.path == "/tools/browser/scroll_to_target"
            || result.path == "/tools/browser/ensure_visible"
            || result.path == "/tools/browser/scroll"
    }));

    let code = registry
        .search(
            "search code snippet 新回话",
            Some("code"),
            0,
            5,
            ToolScene::ProjectCode,
        )
        .expect("code search");
    assert!(code.results.iter().all(|result| result.domain == "code"));
    assert!(
        code.results
            .iter()
            .any(|result| result.path == "/tools/code/search_code")
    );
}

#[test]
fn registry_search_returns_fallback_for_unknown_query() {
    let registry = ToolFsRegistry::default();
    let response = registry
        .search(
            "zzzzqqqq xxyyzzww",
            Some("filesystem"),
            0,
            5,
            ToolScene::General,
        )
        .expect("search response");
    assert!(response.results.is_empty());
    assert_eq!(response.fallback_list_path, "/tools/filesystem");
    assert!(response.recommended_next_action.contains("tool_fs_list"));
}

#[test]
fn registry_startup_validation_rejects_invalid_manifests() {
    let duplicate_path = TestManifestProvider {
        manifests: vec![test_manifest("/tools/filesystem/read_file", None)],
    };
    assert_eq!(
        ToolFsRegistry::try_with_providers(&[&duplicate_path])
            .unwrap_err()
            .code,
        "duplicate_tool_path"
    );

    let duplicate_handle = TestManifestProvider {
        manifests: vec![test_manifest("/tools/test/read", Some("read_file"))],
    };
    assert_eq!(
        ToolFsRegistry::try_with_providers(&[&duplicate_handle])
            .unwrap_err()
            .code,
        "duplicate_tool_handle"
    );

    let mut invalid_schema = test_manifest("/tools/test/no_schema", None);
    invalid_schema.input_schema = json!({ "type": "object", "properties": {} });
    let invalid_schema_provider = TestManifestProvider {
        manifests: vec![invalid_schema],
    };
    assert_eq!(
        ToolFsRegistry::try_with_providers(&[&invalid_schema_provider])
            .unwrap_err()
            .code,
        "invalid_tool_schema_id"
    );
}

#[test]
fn run_input_validation_is_structured() {
    let registry = ToolFsRegistry::default();
    assert_eq!(
        registry
            .resolve_run_input(&json!({ "args": {} }))
            .unwrap_err()
            .code,
        "tool_target_required"
    );
    assert_eq!(
        registry
            .resolve_run_input(&json!({ "path": "/tools/missing", "args": {} }))
            .unwrap_err()
            .code,
        "tool_not_found"
    );
    assert_eq!(
        registry
            .resolve_run_input(&json!({ "toolHandle": "read_file", "args": [] }))
            .unwrap_err()
            .code,
        "invalid_tool_args"
    );
    let resolved = registry
        .resolve_run_input(&json!({
            "toolHandle": "read_file",
            "args": { "path": "README.md" }
        }))
        .expect("resolved");
    assert_eq!(resolved.manifest.path, "/tools/filesystem/read_file");
    assert_eq!(
        registry
            .resolve_run_input(&json!({
                "path": "/tools/filesystem/read_file",
                "toolHandle": "find_files",
                "args": { "path": "README.md" }
            }))
            .unwrap_err()
            .code,
        "ambiguous_tool_target"
    );
}
