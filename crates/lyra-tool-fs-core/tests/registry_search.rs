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
    assert!(root.directories.iter().any(|entry| entry.name == "web"));
    assert!(
        root.directories
            .iter()
            .any(|entry| entry.name == "terminal")
    );
    assert!(
        !root
            .directories
            .iter()
            .any(|entry| matches!(entry.name.as_str(), "filesystem" | "code" | "shell" | "git"))
    );

    let web = registry
        .list("/tools/web", 0, 2, ToolScene::ProjectCode)
        .expect("web");
    assert_eq!(web.page_size, 2);
    assert_eq!(web.tools.len(), 2);
    assert!(web.has_more);
    let listed_json = serde_json::to_value(&web.tools[0]).expect("listed tool json");
    assert!(listed_json.get("path").is_some());
    assert!(listed_json.get("handle").is_some());
    assert!(listed_json.get("title").is_some());
    assert!(listed_json.get("domain").is_some());
    assert!(listed_json.get("operation").is_some());
    assert!(listed_json.get("summary").is_some());
    assert!(listed_json.get("riskLevel").is_some());
    assert!(listed_json.get("permissionPolicy").is_some());
    assert!(listed_json.get("runHint").is_some());
    assert!(listed_json.get("recommendedNextAction").is_some());
    assert!(listed_json.get("inputSchema").is_none());
    assert!(listed_json.get("description").is_none());
    assert!(listed_json.get("examples").is_none());
    assert!(listed_json.get("aliases").is_none());

    let web_page_2 = registry
        .list("/tools/web", 1, 2, ToolScene::ProjectCode)
        .expect("web page 2");
    assert_eq!(web_page_2.page, 1);
    assert_eq!(web_page_2.page_size, 2);
    assert_ne!(web.tools[0].path, web_page_2.tools[0].path);

    let terminal_tools = registry
        .list("/tools/terminal", 0, 20, ToolScene::Git)
        .expect("terminal tools");
    assert_eq!(
        terminal_tools
            .tools
            .first()
            .and_then(|tool| tool.handle.as_deref()),
        Some("terminal_list")
    );
}

#[test]
fn registry_reads_docs_and_inspects_path_and_handle() {
    let registry = ToolFsRegistry::default();
    let root_doc = registry.read_doc("/tools").expect("root doc");
    assert_eq!(root_doc["kind"], "tool_fs_doc");
    assert!(
        root_doc["content"]
            .as_str()
            .is_some_and(|content| !content.contains("Tool-FS scenario playbooks"))
    );
    let playbooks_doc = registry
        .read_doc("/tools/playbooks")
        .expect("playbooks doc");
    assert_eq!(playbooks_doc["path"], "/tools/playbooks");
    assert!(
        playbooks_doc["content"]
            .as_str()
            .is_some_and(|content| content.contains("Lyra Tool-FS scenario decision tree"))
    );

    let domain_doc = registry.read_doc("/tools/web").expect("web doc");
    assert_eq!(domain_doc["path"], "/tools/web");
    assert!(
        domain_doc["content"]
            .as_str()
            .is_some_and(|content| content.contains("web"))
    );
    assert!(registry.read_doc("/tools/git").is_err());

    let tool_doc = registry.read_doc("/tools/web/search").expect("tool doc");
    assert_eq!(tool_doc["path"], "/tools/web/search");
    assert_eq!(tool_doc["title"], "Web search");
    assert!(
        tool_doc["content"]
            .as_str()
            .is_some_and(|content| content.contains("current web search"))
    );

    assert!(
        registry
            .inspect_path("/tools/filesystem/read_file")
            .is_err()
    );
    let by_path = registry.inspect_path("/tools/web/search").expect("path");
    assert_eq!(by_path.handle.as_deref(), Some("web_search"));
    assert_eq!(by_path.input_schema["type"], "object");
    let inspected_json = serde_json::to_value(&by_path).expect("inspect json");
    assert!(inspected_json.get("inputSchema").is_some());
    assert!(inspected_json.get("description").is_some());
    assert!(inspected_json.get("examples").is_some());
    assert!(inspected_json.get("aliases").is_some());

    let by_handle = registry.inspect_handle("web_search").expect("handle");
    assert_eq!(by_handle.path, "/tools/web/search");
}

#[test]
fn manifest_projection_does_not_expose_legacy_name() {
    let registry = ToolFsRegistry::default();
    let manifest = registry
        .inspect_path("/tools/web/search")
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
fn web_research_tool_is_discoverable_with_schema() {
    let registry = ToolFsRegistry::default();
    let research = registry
        .search(
            "web search research deep read rust ownership",
            Some("web"),
            0,
            5,
            ToolScene::General,
        )
        .expect("web research search");
    assert_eq!(
        research.results.first().map(|result| result.path.as_str()),
        Some("/tools/web/research")
    );
    assert!(
        research
            .results
            .first()
            .is_some_and(|result| result.match_reason.contains("web-research intent boost"))
    );

    let manifest = registry
        .inspect_path("/tools/web/research")
        .expect("web research manifest");
    assert_eq!(manifest.handle.as_deref(), Some("web_research"));
    assert_eq!(manifest.input_schema["required"], json!(["query"]));
    assert!(manifest.input_schema["properties"]["query"].is_object());
    assert!(manifest.input_schema["properties"]["readTopN"].is_object());
    assert!(manifest.input_schema["properties"]["maxCharsPerResult"].is_object());

    let resolved = registry
        .resolve_run_input(&json!({
            "path": "/tools/web/research",
            "args": {
                "query": "rust ownership",
                "readTopN": 2,
                "maxCharsPerResult": 1000
            }
        }))
        .expect("resolved web research input");
    assert_eq!(resolved.manifest.path, "/tools/web/research");
}

#[test]
fn web_fetch_schema_exposes_browser_engine_options() {
    let registry = ToolFsRegistry::default();
    let manifest = registry
        .inspect_path("/tools/web/fetch")
        .expect("web fetch manifest");
    let properties = &manifest.input_schema["properties"];
    assert_eq!(
        properties["engine"]["enum"],
        json!(["auto", "http", "browser"])
    );
    assert!(properties["waitForSelector"].is_object());
    assert_eq!(
        properties["browserMode"]["enum"],
        json!(["matchingOrNewTab", "activeTab", "newTab"])
    );
    assert!(properties["includeScreenshot"].is_object());
    assert!(properties["viewport"].is_object());
    assert!(properties["mobile"].is_object());
    assert!(properties["includeIframes"].is_object());
    assert!(properties["includeShadowDom"].is_object());
    assert!(properties["includePageshot"].is_object());
    assert!(properties["includeMedia"].is_object());
    assert_eq!(
        properties["retainMedia"]["enum"],
        json!(["link", "text", "summary", "html", "none"])
    );
    assert_eq!(properties["headingStyle"]["enum"], json!(["atx", "setext"]));
    assert_eq!(
        properties["citationFormat"]["enum"],
        json!(["square", "angle", "source"])
    );
    assert!(properties["preserveHtmlTags"].is_object());
    assert!(properties["useOcr"].is_object());
    assert!(properties["useCaption"].is_object());
    assert!(properties["includeDebugTrace"].is_object());
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
            .all(|result| !result.path.starts_with("/tools/filesystem/")
                && !result.path.starts_with("/tools/code/")
                && !result.path.starts_with("/tools/git/")
                && !result.path.starts_with("/tools/shell/"))
    );

    let command = registry
        .search("执行测试命令", None, 0, 5, ToolScene::ProjectCode)
        .expect("command search");
    assert!(
        command
            .results
            .iter()
            .all(|result| !result.path.starts_with("/tools/shell/")
                && !result.path.starts_with("/tools/filesystem/")
                && !result.path.starts_with("/tools/code/"))
    );

    let git = registry
        .search("查看 git diff 代码变更", None, 0, 5, ToolScene::Git)
        .expect("git search");
    assert!(
        git.results
            .iter()
            .all(|result| !result.path.starts_with("/tools/git/"))
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
    assert!(
        browser_locate
            .results
            .iter()
            .any(|result| result.run_hint.contains("tool_fs_run")
                && result.mini_schema.get("parameters").is_some())
    );

    let browser_navigation = registry
        .search(
            "打开网页 进入网站 go to url",
            None,
            0,
            5,
            ToolScene::Browser,
        )
        .expect("browser navigation search");
    assert_eq!(
        browser_navigation
            .results
            .first()
            .map(|result| result.path.as_str()),
        Some("/tools/browser/navigate")
    );
    assert!(
        browser_navigation
            .results
            .iter()
            .any(|result| result.path == "/tools/browser/navigate")
    );

    let browser_open_url = registry
        .search("open URL in browser tab", None, 0, 5, ToolScene::Browser)
        .expect("browser open url search");
    assert_eq!(
        browser_open_url
            .results
            .first()
            .map(|result| result.path.as_str()),
        Some("/tools/browser/navigate")
    );
    assert!(
        browser_open_url
            .results
            .first()
            .is_some_and(|result| result.match_reason.contains("open-url intent boost"))
    );

    let browser_actions = registry
        .search("点按钮 click button", None, 0, 5, ToolScene::Browser)
        .expect("browser act search");
    assert!(
        browser_actions.results.iter().any(
            |result| result.path == "/tools/browser/act" || result.path == "/tools/browser/map"
        )
    );

    let browser_page_search = registry
        .search(
            "页面搜索 搜索当前页 find text",
            None,
            0,
            5,
            ToolScene::Browser,
        )
        .expect("browser page search");
    assert!(browser_page_search.results.iter().any(|result| {
        result.path == "/tools/browser/find" || result.path == "/tools/browser/locate"
    }));

    let browser_google_search = registry
        .search("browser search Google", None, 0, 5, ToolScene::Browser)
        .expect("browser google search");
    assert_eq!(
        browser_google_search
            .results
            .first()
            .map(|result| result.path.as_str()),
        Some("/tools/web/search")
    );

    let browser_read_current = registry
        .search(
            "读取当前页 read current page",
            None,
            0,
            5,
            ToolScene::Browser,
        )
        .expect("browser read current page");
    assert!(
        browser_read_current
            .results
            .iter()
            .any(|result| result.path == "/tools/browser/read")
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

    let browser_visual_act = registry
        .search(
            "visual click canvas screenshot coordinates",
            None,
            0,
            8,
            ToolScene::Browser,
        )
        .expect("browser visual act search");
    assert!(
        browser_visual_act
            .results
            .iter()
            .any(|result| result.path == "/tools/browser/vact")
    );

    let code = registry
        .search(
            "search code snippet 新回话",
            Some("code"),
            0,
            5,
            ToolScene::ProjectCode,
        )
        .expect("code search");
    assert!(code.results.is_empty());

    let grep = registry
        .search(
            "grep exact regex text content",
            Some("code"),
            0,
            5,
            ToolScene::ProjectCode,
        )
        .expect("grep search");
    assert!(grep.results.is_empty());

    let symbol = registry
        .search(
            "find definition symbol component function",
            Some("code"),
            0,
            5,
            ToolScene::ProjectCode,
        )
        .expect("symbol search");
    assert!(symbol.results.is_empty());
}

#[test]
fn registry_search_handles_human_computer_intents_without_list_fallback() {
    let registry = ToolFsRegistry::default();

    let browser = registry
        .search("browser brower 浏览器操作", None, 0, 8, ToolScene::Browser)
        .expect("browser operation search");
    assert!(
        browser
            .results
            .iter()
            .any(|result| result.path.starts_with("/tools/browser/")),
        "browser intent should return concrete browser tools"
    );
    assert!(!browser.results.is_empty());

    let terminal = registry
        .search(
            "terminal shell 终端 跑测试",
            None,
            0,
            8,
            ToolScene::Terminal,
        )
        .expect("terminal shell search");
    assert_eq!(
        terminal.results.first().map(|result| result.path.as_str()),
        Some("/tools/terminal/run")
    );
    assert!(terminal.results.first().is_some_and(|result| {
        result
            .match_reason
            .contains("interactive-terminal intent boost")
    }));

    let edit = registry
        .search(
            "改代码 修改文件 apply patch",
            None,
            0,
            8,
            ToolScene::ProjectCode,
        )
        .expect("code edit search");
    assert!(edit.results.iter().all(|result| {
        !result.path.starts_with("/tools/filesystem/") && !result.path.starts_with("/tools/code/")
    }));

    let file_search = registry
        .search(
            "查文件 搜索代码 read file",
            None,
            0,
            8,
            ToolScene::ProjectCode,
        )
        .expect("file/code search");
    assert!(file_search.results.iter().all(|result| {
        !result.path.starts_with("/tools/filesystem/") && !result.path.starts_with("/tools/code/")
    }));

    let git_diff = registry
        .search("查看 git diff 代码变更", None, 0, 5, ToolScene::Git)
        .expect("git diff search");
    assert!(
        git_diff
            .results
            .iter()
            .all(|result| !result.path.starts_with("/tools/git/"))
    );

    let computer = registry
        .search("电脑 桌面 窗口 应用操作", None, 0, 8, ToolScene::Automation)
        .expect("computer-use search");
    assert!(
        computer
            .results
            .iter()
            .any(|result| result.path.starts_with("/tools/computer/"))
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
    assert_eq!(response.fallback_list_path, "/tools/workbench");
    assert!(response.recommended_next_action.contains("tool_fs_list"));
}

#[test]
fn registry_startup_validation_rejects_invalid_manifests() {
    let duplicate_path = TestManifestProvider {
        manifests: vec![test_manifest("/tools/web/search", None)],
    };
    assert_eq!(
        ToolFsRegistry::try_with_providers(&[&duplicate_path])
            .unwrap_err()
            .code,
        "duplicate_tool_path"
    );

    let duplicate_handle = TestManifestProvider {
        manifests: vec![test_manifest("/tools/test/read", Some("web_search"))],
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
            .resolve_run_input(&json!({ "toolHandle": "web_search", "args": [] }))
            .unwrap_err()
            .code,
        "invalid_tool_args"
    );
    let resolved = registry
        .resolve_run_input(&json!({
            "toolHandle": "web_search",
            "args": { "query": "Lyra" }
        }))
        .expect("resolved");
    assert_eq!(resolved.manifest.path, "/tools/web/search");
    assert_eq!(
        registry
            .resolve_run_input(&json!({
                "path": "/tools/web/search",
                "toolHandle": "web_fetch",
                "args": { "query": "Lyra" }
            }))
            .unwrap_err()
            .code,
        "ambiguous_tool_target"
    );
}
