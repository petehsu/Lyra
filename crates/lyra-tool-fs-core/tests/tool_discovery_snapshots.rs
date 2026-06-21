use lyra_tool_fs_core::{ToolFsRegistry, ToolScene, ToolSearchResponse, ToolSearchResult};
use serde_json::{Value, json};

fn pretty(value: &Value) -> String {
    serde_json::to_string_pretty(value).expect("snapshot json")
}

fn search_projection(response: ToolSearchResponse) -> Value {
    json!({
        "query": response.query,
        "scene": response.scene,
        "domain": response.domain,
        "fallbackListPath": response.fallback_list_path,
        "recommendedNextAction": response.recommended_next_action,
        "total": response.total,
        "topResults": response
            .results
            .into_iter()
            .take(3)
            .map(search_result_projection)
            .collect::<Vec<_>>(),
    })
}

fn search_result_projection(result: ToolSearchResult) -> Value {
    let parameter_names = result
        .mini_schema
        .get("parameters")
        .and_then(Value::as_array)
        .map(|parameters| {
            parameters
                .iter()
                .filter_map(|parameter| parameter.get("name").and_then(Value::as_str))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    json!({
        "path": result.path,
        "handle": result.handle,
        "title": result.title,
        "domain": result.domain,
        "operation": result.operation,
        "summary": result.summary,
        "runHint": result.run_hint,
        "score": result.score,
        "matchedFields": result.matched_fields,
        "matchReason": result.match_reason,
        "miniSchemaRequired": result.mini_schema.get("required").cloned().unwrap_or_else(|| json!([])),
        "miniSchemaParameterNames": parameter_names,
    })
}

#[test]
fn tool_fs_root_and_docs_snapshot() {
    let registry = ToolFsRegistry::default();
    let snapshot = json!({
        "rootSummary": registry.root_summary_for_scene(ToolScene::ProjectCode),
        "rootDoc": registry.read_doc("/tools").expect("root doc"),
        "playbooksDoc": registry.read_doc("/tools/playbooks").expect("playbooks doc"),
    });
    insta::assert_snapshot!("tool_fs_root_and_docs", pretty(&snapshot));
}

#[test]
fn tool_fs_compact_list_snapshot() {
    let registry = ToolFsRegistry::default();
    let browser = registry
        .list("/tools/browser", 0, 5, ToolScene::Browser)
        .expect("browser list");
    let terminal = registry
        .list("/tools/terminal", 0, 5, ToolScene::Terminal)
        .expect("terminal list");
    let snapshot = json!({
        "browser": browser,
        "terminal": terminal,
    });
    insta::assert_snapshot!("tool_fs_compact_list", pretty(&snapshot));
}

#[test]
fn tool_fs_human_intent_search_snapshot() {
    let registry = ToolFsRegistry::default();
    let snapshot = json!({
        "browser": search_projection(registry
            .search("browser brower 浏览器操作", None, 0, 5, ToolScene::Browser)
            .expect("browser search")),
        "terminal": search_projection(registry
            .search("terminal shell 终端 跑测试", None, 0, 5, ToolScene::Terminal)
            .expect("terminal search")),
        "code": search_projection(registry
            .search("改代码 修改文件 apply patch", None, 0, 5, ToolScene::ProjectCode)
            .expect("code search")),
        "git": search_projection(registry
            .search("查看 git diff 代码变更", None, 0, 5, ToolScene::Git)
            .expect("git search")),
    });
    insta::assert_snapshot!("tool_fs_human_intent_search", pretty(&snapshot));
}
