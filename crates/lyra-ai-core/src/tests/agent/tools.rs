use std::fs::{create_dir_all, write};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use once_cell::sync::Lazy;
use serde_json::{json, Value};

use crate::agent::terminal_policy::{
    select_terminal_interaction_policy, TerminalInteractionPolicy,
};
use crate::agent::tools::{
    clear_external_tools, execute_readonly_tool, execute_tool_with_progress, grant_approval_once,
    plan_mode_tool_definitions_for_input, readonly_tool_definitions_for_input,
    readonly_tool_definitions_for_input_with_context, register_external_tool,
    register_host_tools_bridge, render_mcp_tools_prompt_json, tool_executes_serially,
    unregister_host_tool_set, AgentToolError, BrowserStrategyRoutingContext,
    ExternalToolApprovalMode, ExternalToolMetadata, ExternalToolSideEffects, HostToolDescriptor,
    RegisteredExternalTool, ToolExecutionContext, ToolExecutionMode, ToolRankingContext,
    WorkbenchWebRoutingContext,
};
use crate::agent::types::{
    AgentCreateSessionRequest, AgentToolCall, AGENT_PLAN_APPROVAL_REQUIRED,
    AGENT_PLAN_QUESTION_REQUIRED, AGENT_TOOL_READ_BLOCKED,
};
use crate::storage::registry_db;
use crate::tests::support::TempStorageRoot;
use lyra_sandbox::permissions::{PermissionDecision, PermissionsStore};

static EXTERNAL_TOOL_TEST_GUARD: Lazy<Mutex<()>> = Lazy::new(|| Mutex::new(()));
static TERMINAL_SESSION_TEST_GUARD: Lazy<Mutex<()>> = Lazy::new(|| Mutex::new(()));

fn create_workspace_root(temp: &TempStorageRoot) -> PathBuf {
    let root = PathBuf::from(temp.as_string()).join("workspace");
    create_dir_all(&root).expect("create workspace root");
    root
}

fn tool_context<'a>(
    storage_root: Option<&'a str>,
    project_root: Option<&'a str>,
    tool_call_id: Option<&'a str>,
    terminal_policy: Option<&'a TerminalInteractionPolicy>,
    plan_mode: bool,
) -> ToolExecutionContext<'a> {
    ToolExecutionContext {
        storage_root,
        project_root,
        agent_session_id: Some("test-agent-session"),
        agent_turn_id: Some("test-turn"),
        tool_call_id,
        terminal_policy,
        plan_mode,
    }
}

fn tool_rank(tools: &[crate::provider::types::AgentToolDefinition], name: &str) -> usize {
    tools
        .iter()
        .position(|tool| tool.name == name)
        .unwrap_or_else(|| panic!("tool not found in ranking: {name}"))
}

fn register_test_external_tool(name: &str, description: &str) {
    register_test_external_tool_with_metadata(
        name,
        description,
        ExternalToolApprovalMode::Auto,
        ExternalToolSideEffects::read_only(),
    );
}

fn register_test_external_tool_with_metadata(
    name: &str,
    description: &str,
    approval_mode: ExternalToolApprovalMode,
    side_effects: ExternalToolSideEffects,
) {
    register_external_tool(RegisteredExternalTool {
        definition: crate::provider::types::AgentToolDefinition {
            name: name.to_string(),
            description: description.to_string(),
            input_schema: json!({
                "type": "object",
                "additionalProperties": false
            }),
        },
        metadata: ExternalToolMetadata {
            output_schema: json!({"type": "object"}),
            approval_mode,
            side_effects,
        },
        executor: Arc::new(|_, _context| Ok(json!({"ok": true}))),
        execution_mode: ToolExecutionMode::Serial,
    });
}

fn test_tool_call(
    tool_name: &str,
    output: Option<Value>,
    error_code: Option<&str>,
    status: &str,
) -> AgentToolCall {
    AgentToolCall {
        id: format!("call-{tool_name}"),
        session_id: "session".to_string(),
        turn_id: "turn".to_string(),
        tool_name: tool_name.to_string(),
        input: json!({}),
        output,
        status: status.to_string(),
        error_code: error_code.map(ToString::to_string),
        error_message: error_code.map(|code| format!("failed: {code}")),
        started_at: 1,
        finished_at: Some(2),
    }
}

#[test]
fn filesystem_list_respects_limit() {
    let temp = TempStorageRoot::new();
    let root = create_workspace_root(&temp);
    write(root.join("a.txt"), "a").expect("write a.txt");
    write(root.join("b.txt"), "b").expect("write b.txt");

    let result = execute_readonly_tool(
        "filesystem.list",
        &json!({
            "path": root.to_string_lossy(),
            "limit": 1,
        }),
        None,
    )
    .expect("run list tool");

    assert_eq!(result.get("truncated").and_then(Value::as_bool), Some(true));
    let entries = result
        .get("entries")
        .and_then(Value::as_array)
        .expect("list entries");
    assert_eq!(entries.len(), 1);
}

#[test]
fn filesystem_search_honors_glob_filter() {
    let temp = TempStorageRoot::new();
    let root = create_workspace_root(&temp);
    let src_dir = root.join("src");
    create_dir_all(&src_dir).expect("create src dir");
    write(
        src_dir.join("main.rs"),
        "fn main() { println!(\"Hello Agent\"); }\n",
    )
    .expect("write rust file");
    write(root.join("notes.txt"), "agent appears here too\n").expect("write text file");

    let result = execute_readonly_tool(
        "filesystem.search",
        &json!({
            "pattern": "agent",
            "path": root.to_string_lossy(),
            "glob": "*.rs",
            "limit": 20,
        }),
        None,
    )
    .expect("run search tool");

    let matches = result
        .get("matches")
        .and_then(Value::as_array)
        .expect("search matches");
    assert_eq!(matches.len(), 1);
    let relative_path = matches[0]
        .get("relativePath")
        .and_then(Value::as_str)
        .expect("relative path");
    assert_eq!(relative_path, "src/main.rs");
}

#[test]
fn filesystem_read_range_reports_unsupported_for_missing_file() {
    let temp = TempStorageRoot::new();
    let root = create_workspace_root(&temp);
    let missing_path = root.join("missing.txt");

    let result = execute_readonly_tool(
        "filesystem.read_range",
        &json!({
            "path": missing_path.to_string_lossy(),
            "startLine": 1,
            "endLine": 5,
        }),
        None,
    )
    .expect("run read_range tool");

    assert_eq!(
        result.get("kind").and_then(Value::as_str),
        Some("unsupported")
    );
}

#[test]
fn rejects_unknown_tool_names() {
    let error = execute_readonly_tool("filesystem.unknown", &json!({}), None)
        .expect_err("unknown tool should fail");
    assert_eq!(error.code, AGENT_TOOL_READ_BLOCKED);
}

#[test]
fn builtin_tool_execution_modes_are_centralized() {
    assert!(!tool_executes_serially("filesystem.list"));
    assert!(tool_executes_serially("filesystem.write"));
    assert!(tool_executes_serially("terminal.exec"));
}

#[test]
fn standard_tool_ranking_prefers_read_only_tools_for_generic_inspection() {
    let ranked = readonly_tool_definitions_for_input("inspect the repository structure");

    assert!(tool_rank(&ranked, "filesystem.list") < tool_rank(&ranked, "filesystem.edit"));
    assert!(tool_rank(&ranked, "filesystem.read_range") < tool_rank(&ranked, "terminal.exec"));
}

#[test]
fn standard_tool_ranking_keeps_terminal_exec_below_safe_readers_by_default() {
    let ranked = readonly_tool_definitions_for_input("run tests and inspect failures");

    assert!(tool_rank(&ranked, "filesystem.list") < tool_rank(&ranked, "terminal.exec"));
    assert!(tool_rank(&ranked, "filesystem.read_range") < tool_rank(&ranked, "terminal.exec"));
}

#[test]
fn plan_tool_ranking_starts_with_coordination_tools_by_default() {
    let clarify_ranked =
        plan_mode_tool_definitions_for_input("ask the user to clarify the deployment target");
    assert!(
        tool_rank(&clarify_ranked, "request_user_input")
            < tool_rank(&clarify_ranked, "filesystem.list")
    );

    let approval_ranked = plan_mode_tool_definitions_for_input(
        "submit the plan for approval once the draft is complete",
    );
    assert!(
        tool_rank(&approval_ranked, "plan.update_draft")
            < tool_rank(&approval_ranked, "plan.submit_for_approval")
    );
}

#[test]
fn external_tools_use_registered_execution_mode() {
    let _guard = EXTERNAL_TOOL_TEST_GUARD
        .lock()
        .expect("external tool test guard");
    clear_external_tools();
    register_external_tool(RegisteredExternalTool {
        definition: crate::provider::types::AgentToolDefinition {
            name: "external.parallel".to_string(),
            description: "parallel external tool".to_string(),
            input_schema: json!({
                "type": "object",
                "additionalProperties": false
            }),
        },
        metadata: ExternalToolMetadata::read_only_json(),
        executor: Arc::new(|_, _context| Ok(json!({"ok": true}))),
        execution_mode: ToolExecutionMode::ParallelReadOnly,
    });
    register_external_tool(RegisteredExternalTool {
        definition: crate::provider::types::AgentToolDefinition {
            name: "external.serial".to_string(),
            description: "serial external tool".to_string(),
            input_schema: json!({
                "type": "object",
                "additionalProperties": false
            }),
        },
        metadata: ExternalToolMetadata {
            output_schema: json!({"type": "object"}),
            approval_mode: ExternalToolApprovalMode::Ask,
            side_effects: ExternalToolSideEffects::workspace_write(),
        },
        executor: Arc::new(|_, _context| Ok(json!({"ok": true}))),
        execution_mode: ToolExecutionMode::Serial,
    });

    assert!(!tool_executes_serially("external.parallel"));
    assert!(tool_executes_serially("external.serial"));

    clear_external_tools();
}

#[test]
fn host_tool_errors_preserve_structured_diagnostics_metadata() {
    let _guard = EXTERNAL_TOOL_TEST_GUARD
        .lock()
        .expect("external tool test guard");
    clear_external_tools();
    unregister_host_tool_set("test.host");

    register_host_tools_bridge(
        "test.host",
        vec![HostToolDescriptor {
            name: "workbench.document.read".to_string(),
            description: "Read active workbench document".to_string(),
            input_schema: json!({"type": "object"}),
            output_schema: json!({"type": "object"}),
            execution_mode: ToolExecutionMode::Serial,
            approval_mode: ExternalToolApprovalMode::Auto,
            side_effects: ExternalToolSideEffects::read_only(),
            host_method: "workbench.document.read".to_string(),
        }],
        Arc::new(|_descriptor, _input, _context| {
            Err(AgentToolError {
                code: "HOST_TOOL_ERROR".to_string(),
                message: "document format is unsupported".to_string(),
                metadata: Some(json!({
                    "domain": "workbench.document",
                    "stage": "parse",
                    "fetch": {
                        "contentSignature": "html_doctype",
                        "likelyCause": "resolved_document_url_returned_html_wrapper_instead_of_pdf_bytes"
                    }
                })),
            })
        }),
    );

    let error = execute_readonly_tool("workbench.document.read", &json!({}), None)
        .expect_err("host tool should fail");

    assert_eq!(error.code, "HOST_TOOL_ERROR");
    let metadata = error.metadata.expect("structured diagnostics metadata");
    assert_eq!(
        metadata.get("domain").and_then(Value::as_str),
        Some("workbench.document")
    );
    assert_eq!(
        metadata
            .get("fetch")
            .and_then(Value::as_object)
            .and_then(|fetch| fetch.get("likelyCause"))
            .and_then(Value::as_str),
        Some("resolved_document_url_returned_html_wrapper_instead_of_pdf_bytes")
    );

    unregister_host_tool_set("test.host");
    clear_external_tools();
}

#[test]
fn external_tool_ranking_prefers_safer_tools_when_relevance_is_similar() {
    let _guard = EXTERNAL_TOOL_TEST_GUARD
        .lock()
        .expect("external tool test guard");
    clear_external_tools();

    register_external_tool(RegisteredExternalTool {
        definition: crate::provider::types::AgentToolDefinition {
            name: "external.fetch_status".to_string(),
            description: "inspect deployment status for a service".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "service": { "type": "string" }
                },
                "additionalProperties": false
            }),
        },
        metadata: ExternalToolMetadata {
            output_schema: json!({"type": "object"}),
            approval_mode: ExternalToolApprovalMode::Auto,
            side_effects: ExternalToolSideEffects::network_read(),
        },
        executor: Arc::new(|_, _context| Ok(json!({"ok": true}))),
        execution_mode: ToolExecutionMode::ParallelReadOnly,
    });
    register_external_tool(RegisteredExternalTool {
        definition: crate::provider::types::AgentToolDefinition {
            name: "external.deploy_service".to_string(),
            description: "inspect deployment status for a service".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "service": { "type": "string" }
                },
                "additionalProperties": false
            }),
        },
        metadata: ExternalToolMetadata {
            output_schema: json!({"type": "object"}),
            approval_mode: ExternalToolApprovalMode::Ask,
            side_effects: ExternalToolSideEffects::external_mutation(),
        },
        executor: Arc::new(|_, _context| Ok(json!({"ok": true}))),
        execution_mode: ToolExecutionMode::Serial,
    });

    let ranked =
        readonly_tool_definitions_for_input("inspect deployment status for the api service");
    assert!(
        tool_rank(&ranked, "external.fetch_status") < tool_rank(&ranked, "external.deploy_service")
    );

    clear_external_tools();
}

#[test]
fn external_tool_ranking_keeps_risky_mutations_below_safe_reads_by_default() {
    let _guard = EXTERNAL_TOOL_TEST_GUARD
        .lock()
        .expect("external tool test guard");
    clear_external_tools();

    register_external_tool(RegisteredExternalTool {
        definition: crate::provider::types::AgentToolDefinition {
            name: "external.fetch_status".to_string(),
            description: "fetch deployment status for a service".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "service": { "type": "string" }
                },
                "additionalProperties": false
            }),
        },
        metadata: ExternalToolMetadata {
            output_schema: json!({"type": "object"}),
            approval_mode: ExternalToolApprovalMode::Auto,
            side_effects: ExternalToolSideEffects::network_read(),
        },
        executor: Arc::new(|_, _context| Ok(json!({"ok": true}))),
        execution_mode: ToolExecutionMode::ParallelReadOnly,
    });
    register_external_tool(RegisteredExternalTool {
        definition: crate::provider::types::AgentToolDefinition {
            name: "external.deploy_release".to_string(),
            description: "deploy release to production for a service".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "service": { "type": "string" }
                },
                "additionalProperties": false
            }),
        },
        metadata: ExternalToolMetadata {
            output_schema: json!({"type": "object"}),
            approval_mode: ExternalToolApprovalMode::Ask,
            side_effects: ExternalToolSideEffects::external_mutation(),
        },
        executor: Arc::new(|_, _context| Ok(json!({"ok": true}))),
        execution_mode: ToolExecutionMode::Serial,
    });

    let ranked =
        readonly_tool_definitions_for_input("deploy release to production for the api service");
    assert!(
        tool_rank(&ranked, "external.fetch_status") < tool_rank(&ranked, "external.deploy_release")
    );

    clear_external_tools();
}

#[test]
fn workbench_tool_ranking_prefers_structured_read_for_summary_requests() {
    let _guard = EXTERNAL_TOOL_TEST_GUARD
        .lock()
        .expect("external tool test guard");
    clear_external_tools();

    register_test_external_tool("workbench.tabs.list", "list open workbench tabs");
    register_test_external_tool(
        "workbench.document.inspect",
        "inspect the active workbench document metadata",
    );
    register_test_external_tool(
        "workbench.document.read",
        "read the active workbench document",
    );
    register_test_external_tool(
        "workbench.tab.read",
        "read the structured contents of a workbench tab",
    );
    register_test_external_tool(
        "workbench.document.search",
        "search the active workbench document",
    );
    register_test_external_tool(
        "workbench.tab.extract_text",
        "extract copy-like text from a workbench tab",
    );
    register_test_external_tool(
        "workbench.tab.capture_visual",
        "capture the visible workbench tab as an image",
    );

    let ranked = readonly_tool_definitions_for_input("summarize the current webpage");
    assert!(
        tool_rank(&ranked, "workbench.tabs.list")
            < tool_rank(&ranked, "workbench.document.inspect")
    );
    assert!(
        tool_rank(&ranked, "workbench.document.inspect")
            < tool_rank(&ranked, "workbench.document.read")
    );
    assert!(
        tool_rank(&ranked, "workbench.document.read") < tool_rank(&ranked, "workbench.tab.read")
    );
    assert!(
        tool_rank(&ranked, "workbench.tab.read") < tool_rank(&ranked, "workbench.document.search")
    );
    assert!(
        tool_rank(&ranked, "workbench.document.search")
            < tool_rank(&ranked, "workbench.tab.extract_text")
    );
    assert!(
        tool_rank(&ranked, "workbench.tab.extract_text")
            < tool_rank(&ranked, "workbench.tab.capture_visual")
    );

    clear_external_tools();
}

#[test]
fn workbench_tool_ranking_uses_the_same_default_observation_order_for_full_text_requests() {
    let _guard = EXTERNAL_TOOL_TEST_GUARD
        .lock()
        .expect("external tool test guard");
    clear_external_tools();

    register_test_external_tool("workbench.tabs.list", "list open workbench tabs");
    register_test_external_tool(
        "workbench.document.inspect",
        "inspect the active workbench document metadata",
    );
    register_test_external_tool(
        "workbench.document.read",
        "read the active workbench document",
    );
    register_test_external_tool(
        "workbench.tab.read",
        "read the structured contents of a workbench tab",
    );
    register_test_external_tool(
        "workbench.document.search",
        "search the active workbench document",
    );
    register_test_external_tool(
        "workbench.tab.extract_text",
        "extract copy-like text from a workbench tab",
    );

    let ranked = readonly_tool_definitions_for_input(
        "copy the full text of this article so I can read the entire page",
    );
    assert!(
        tool_rank(&ranked, "workbench.tabs.list")
            < tool_rank(&ranked, "workbench.document.inspect")
    );
    assert!(
        tool_rank(&ranked, "workbench.document.inspect")
            < tool_rank(&ranked, "workbench.document.read")
    );
    assert!(
        tool_rank(&ranked, "workbench.document.read") < tool_rank(&ranked, "workbench.tab.read")
    );
    assert!(
        tool_rank(&ranked, "workbench.tab.read") < tool_rank(&ranked, "workbench.document.search")
    );
    assert!(
        tool_rank(&ranked, "workbench.document.search")
            < tool_rank(&ranked, "workbench.tab.extract_text")
    );

    clear_external_tools();
}

#[test]
fn workbench_tool_ranking_does_not_change_with_language_specific_phrasing() {
    let _guard = EXTERNAL_TOOL_TEST_GUARD
        .lock()
        .expect("external tool test guard");
    clear_external_tools();

    register_test_external_tool("workbench.tabs.list", "list open workbench tabs");
    register_test_external_tool(
        "workbench.document.inspect",
        "inspect the active workbench document metadata",
    );
    register_test_external_tool(
        "workbench.document.read",
        "read the active workbench document",
    );
    register_test_external_tool(
        "workbench.tab.read",
        "read the structured contents of a workbench tab",
    );
    register_test_external_tool(
        "workbench.document.search",
        "search the active workbench document",
    );
    register_test_external_tool(
        "workbench.tab.extract_text",
        "extract copy-like text from a workbench tab",
    );

    let ranked = readonly_tool_definitions_for_input("再看一下现在这页标签内容是什么");
    assert!(
        tool_rank(&ranked, "workbench.tabs.list")
            < tool_rank(&ranked, "workbench.document.inspect")
    );
    assert!(
        tool_rank(&ranked, "workbench.document.inspect")
            < tool_rank(&ranked, "workbench.document.read")
    );
    assert!(
        tool_rank(&ranked, "workbench.document.read") < tool_rank(&ranked, "workbench.tab.read")
    );
    assert!(
        tool_rank(&ranked, "workbench.tab.read") < tool_rank(&ranked, "workbench.document.search")
    );
    assert!(
        tool_rank(&ranked, "workbench.document.search")
            < tool_rank(&ranked, "workbench.tab.extract_text")
    );

    clear_external_tools();
}

#[test]
fn workbench_tool_ranking_keeps_visual_capture_as_an_expensive_fallback() {
    let _guard = EXTERNAL_TOOL_TEST_GUARD
        .lock()
        .expect("external tool test guard");
    clear_external_tools();

    register_test_external_tool("workbench.tabs.list", "list open workbench tabs");
    register_test_external_tool(
        "workbench.document.inspect",
        "inspect the active workbench document metadata",
    );
    register_test_external_tool(
        "workbench.document.read",
        "read the active workbench document",
    );
    register_test_external_tool(
        "workbench.tab.read",
        "read the structured contents of a workbench tab",
    );
    register_test_external_tool(
        "workbench.document.search",
        "search the active workbench document",
    );
    register_test_external_tool(
        "workbench.tab.capture_visual",
        "capture the visible workbench tab as an image",
    );

    let ranked = readonly_tool_definitions_for_input("show me what this webpage layout looks like");
    assert!(
        tool_rank(&ranked, "workbench.tabs.list")
            < tool_rank(&ranked, "workbench.document.inspect")
    );
    assert!(
        tool_rank(&ranked, "workbench.document.inspect")
            < tool_rank(&ranked, "workbench.document.read")
    );
    assert!(
        tool_rank(&ranked, "workbench.document.read") < tool_rank(&ranked, "workbench.tab.read")
    );
    assert!(
        tool_rank(&ranked, "workbench.tab.read") < tool_rank(&ranked, "workbench.document.search")
    );
    assert!(
        tool_rank(&ranked, "workbench.document.search")
            < tool_rank(&ranked, "workbench.tab.capture_visual")
    );

    clear_external_tools();
}

#[test]
fn workbench_web_tool_ranking_prefers_live_scan_before_graph_fallbacks() {
    let _guard = EXTERNAL_TOOL_TEST_GUARD
        .lock()
        .expect("external tool test guard");
    clear_external_tools();

    register_test_external_tool(
        "lyra.web.skeleton.read",
        "read the current page's human-operable map",
    );
    register_test_external_tool(
        "lyra.web.focus.probe",
        "probe keyboard focus on the current page",
    );
    register_test_external_tool(
        "lyra.web.context.read",
        "scan widgets from the current page",
    );
    register_test_external_tool(
        "lyra.web.query.find",
        "scan the visible page for likely interactive targets",
    );
    register_test_external_tool(
        "workbench.tab.read",
        "read summary state from the current page tab",
    );
    register_test_external_tool(
        "workbench.tab.extract_text",
        "extract readable text from the current page tab",
    );
    register_test_external_tool(
        "lyra.web.context.read",
        "scan widgets from the current page",
    );
    register_test_external_tool(
        "lyra.web.graph.build",
        "build selector-addressable graph for current webpage",
    );
    register_test_external_tool(
        "lyra.web.graph.query",
        "query interactable nodes from page graph",
    );
    register_test_external_tool("lyra.web.action.safe", "run safe web action in page");
    register_test_external_tool_with_metadata(
        "lyra.web.action.mutate",
        "run mutating web action in page",
        ExternalToolApprovalMode::Ask,
        ExternalToolSideEffects::session_mutation(),
    );
    register_test_external_tool_with_metadata(
        "lyra.web.action.navigate",
        "run navigation action in page",
        ExternalToolApprovalMode::Ask,
        ExternalToolSideEffects::network_read(),
    );
    register_test_external_tool("lyra.web.action.wait", "wait for target state in page");

    let ranked_english = readonly_tool_definitions_for_input("open this page and click a button");
    let ranked_chinese = readonly_tool_definitions_for_input("帮我在当前网页里点按钮并输入内容");

    for ranked in [&ranked_english, &ranked_chinese] {
        assert!(
            tool_rank(ranked, "lyra.web.skeleton.read") < tool_rank(ranked, "lyra.web.graph.build")
        );
        assert!(
            tool_rank(ranked, "lyra.web.query.find") < tool_rank(ranked, "lyra.web.graph.build")
        );
        assert!(
            tool_rank(ranked, "lyra.web.query.find") < tool_rank(ranked, "lyra.web.action.safe")
        );
        assert!(
            tool_rank(ranked, "lyra.web.query.find") < tool_rank(ranked, "lyra.web.graph.query")
        );
        assert!(
            tool_rank(ranked, "lyra.web.action.safe") < tool_rank(ranked, "lyra.web.action.wait")
        );
        assert!(
            tool_rank(ranked, "lyra.web.action.wait") < tool_rank(ranked, "lyra.web.action.mutate")
        );
        assert!(
            tool_rank(ranked, "lyra.web.action.wait")
                < tool_rank(ranked, "lyra.web.action.navigate")
        );
    }

    clear_external_tools();
}

#[test]
fn workbench_web_tool_ranking_prefers_operability_before_probe_and_graph_fallback() {
    let _guard = EXTERNAL_TOOL_TEST_GUARD
        .lock()
        .expect("external tool test guard");
    clear_external_tools();

    register_test_external_tool(
        "lyra.web.skeleton.read",
        "read the current page's human-operable map",
    );
    register_test_external_tool(
        "lyra.web.focus.probe",
        "probe keyboard focus on the current page",
    );
    register_test_external_tool(
        "lyra.web.query.find",
        "scan the visible page for likely interactive targets",
    );
    register_test_external_tool(
        "lyra.web.graph.build",
        "build selector-addressable graph for current webpage",
    );

    let ranked =
        readonly_tool_definitions_for_input("inspect the current page and find the next control");

    assert!(
        tool_rank(&ranked, "lyra.web.skeleton.read") < tool_rank(&ranked, "lyra.web.focus.probe")
    );
    assert!(
        tool_rank(&ranked, "lyra.web.focus.probe") < tool_rank(&ranked, "lyra.web.graph.build")
    );

    clear_external_tools();
}

#[test]
fn workbench_web_tool_ranking_prefers_actions_after_successful_live_scan() {
    let _guard = EXTERNAL_TOOL_TEST_GUARD
        .lock()
        .expect("external tool test guard");
    clear_external_tools();

    register_test_external_tool(
        "lyra.web.skeleton.read",
        "scan widgets from the current page",
    );
    register_test_external_tool(
        "lyra.web.query.find",
        "scan the visible page for likely interactive targets",
    );
    register_test_external_tool(
        "workbench.tab.read",
        "read summary state from the current page tab",
    );
    register_test_external_tool(
        "workbench.tab.extract_text",
        "extract readable text from the current page tab",
    );
    register_test_external_tool(
        "lyra.web.graph.build",
        "build selector-addressable graph for current webpage",
    );
    register_test_external_tool(
        "lyra.web.graph.query",
        "query interactable nodes from page graph",
    );
    register_test_external_tool("lyra.web.action.safe", "run safe web action in page");
    register_test_external_tool_with_metadata(
        "lyra.web.action.mutate",
        "run mutating web action in page",
        ExternalToolApprovalMode::Ask,
        ExternalToolSideEffects::session_mutation(),
    );
    register_test_external_tool("lyra.web.action.wait", "wait for target state in page");

    let ranked = readonly_tool_definitions_for_input_with_context(
        "continue the current webpage interaction",
        Some(&ToolRankingContext {
            workbench_web: Some(WorkbenchWebRoutingContext {
                has_live_scan_session: true,
                has_live_candidates: true,
                ..WorkbenchWebRoutingContext::default()
            }),
            browser_strategy: None,
        }),
    );

    assert!(tool_rank(&ranked, "lyra.web.action.safe") < tool_rank(&ranked, "lyra.web.query.find"));
    assert!(
        tool_rank(&ranked, "lyra.web.skeleton.read") < tool_rank(&ranked, "lyra.web.graph.build")
    );
    assert!(
        tool_rank(&ranked, "lyra.web.action.wait") < tool_rank(&ranked, "lyra.web.graph.query")
    );
    assert!(
        tool_rank(&ranked, "lyra.web.action.mutate") < tool_rank(&ranked, "lyra.web.graph.build")
    );

    clear_external_tools();
}

#[test]
fn workbench_web_tool_routing_context_reads_recent_scan_results() {
    let context = crate::agent::tools::derive_workbench_web_routing_context(&[
        test_tool_call(
            "lyra.web.skeleton.read",
            Some(json!({
                "pageMode": "chat",
                "nodes": [{
                    "nodeId": "node-1",
                    "widgetId": "widget-1",
                    "widgetKind": "chat-composer"
                }]
            })),
            None,
            "completed",
        ),
        test_tool_call(
            "lyra.web.query.find",
            Some(json!({
                "scanSessionId": "scan-1",
                "pageMode": "chat",
                "bestMatch": {
                    "nodeId": "cand-1",
                    "capabilities": {
                        "editable": true,
                        "clickable": false
                    }
                },
                "matches": [{
                    "nodeId": "cand-1",
                    "capabilities": {
                        "editable": true,
                        "clickable": false
                    }
                }]
            })),
            None,
            "completed",
        ),
        test_tool_call(
            "lyra.web.action.mutate",
            None,
            Some("candidate_stale"),
            "failed",
        ),
    ])
    .expect("routing context");

    assert!(context.has_live_scan_session);
    assert!(context.has_live_candidates);
    assert!(context.has_typable_candidate);
    assert!(!context.has_clickable_candidate);
    assert_eq!(context.page_mode.as_deref(), Some("chat"));
    assert!(context.widget_graph_ready);
    assert!(context.native_widget_ready);
    assert_eq!(
        context.last_failure_code.as_deref(),
        Some("candidate_stale")
    );
    assert_eq!(
        context.last_web_tool_name.as_deref(),
        Some("lyra.web.action.mutate")
    );
}

#[test]
fn workbench_web_tool_routing_context_reads_scan_and_act_output() {
    let context = crate::agent::tools::derive_workbench_web_routing_context(&[test_tool_call(
        "lyra.web.scan.act",
        Some(json!({
            "scanSessionId": "scan-atomic-1",
            "pageMode": "chat",
            "ok": true,
            "verified": true,
            "goalSatisfied": true,
            "selectedCandidate": {
                "nodeId": "cand-atomic-1",
                "widgetId": "composer-widget",
                "widgetKind": "chat-composer",
                "role": "textbox",
                "tagName": "textarea",
                "interactable": {
                    "typable": true,
                    "clickable": true
                }
            },
            "actionResult": {
                "verification": {
                    "stateTransition": "message_submitted",
                    "widgetId": "composer-widget",
                    "widgetKind": "chat-composer"
                }
            }
        })),
        None,
        "completed",
    )])
    .expect("routing context");

    assert!(context.has_live_scan_session);
    assert!(context.has_live_candidates);
    assert!(context.has_typable_candidate);
    assert!(context.has_clickable_candidate);
    assert!(context.last_action_verified);
    assert_eq!(context.active_widget_id.as_deref(), Some("composer-widget"));
}

#[test]
fn workbench_web_tool_routing_context_reads_focus_atlas_state() {
    let context = crate::agent::tools::derive_workbench_web_routing_context(&[
        test_tool_call(
            "lyra.web.skeleton.read",
            Some(json!({
                "pageMode": "chat",
                "skeletonVersion": "atlas-v1",
                "activeRegionId": "region:sidebar",
                "regions": [{
                    "regionId": "region:sidebar",
                    "kind": "sidebar"
                }],
                "nodes": [{
                    "nodeId": "focus:sidebar-toggle"
                }]
            })),
            None,
            "completed",
        ),
        test_tool_call(
            "lyra.web.query.find",
            Some(json!({
                "scanSessionId": "scan-2",
                "skeletonVersion": "atlas-v1",
                "activeRegionId": "region:sidebar",
                "bestMatch": {
                    "nodeId": "cand-1",
                    "widgetId": "sidebar",
                    "capabilities": {
                        "editable": false,
                        "clickable": true
                    }
                },
                "matches": [{
                    "nodeId": "cand-1",
                    "widgetId": "sidebar",
                    "capabilities": {
                        "editable": false,
                        "clickable": true
                    }
                }]
            })),
            None,
            "completed",
        ),
    ])
    .expect("routing context");

    assert!(context.focus_atlas_ready);
    assert_eq!(
        context.active_focus_region_id.as_deref(),
        Some("region:sidebar")
    );
}

#[test]
fn workbench_web_tool_routing_context_reads_operability_and_probe_state() {
    let context = crate::agent::tools::derive_workbench_web_routing_context(&[
        test_tool_call(
            "lyra.web.query.find",
            Some(json!({
                "pageMode": "chat",
                "skeletonVersion": "atlas-v2",
                "activeRegionId": "region:composer",
                "bestMatch": {
                    "nodeId": "cand-1",
                    "widgetId": "composer",
                    "capabilities": {
                        "editable": true,
                        "clickable": true
                    }
                },
                "matches": [{
                    "nodeId": "cand-1",
                    "widgetId": "composer",
                    "capabilities": {
                        "editable": true,
                        "clickable": true
                    }
                }]
            })),
            None,
            "completed",
        ),
        test_tool_call(
            "lyra.web.focus.probe",
            Some(json!({
                "focusProbeVerified": true,
                "focusDeltaObserved": true,
                "activeFocusRegionId": "region:composer",
                "atlas": {
                    "pageMode": "chat",
                    "activeFocusRegionId": "region:composer"
                }
            })),
            None,
            "completed",
        ),
    ])
    .expect("routing context");

    assert!(context.focus_atlas_ready);
    assert!(context.has_live_candidates);
    assert!(context.has_typable_candidate);
    assert!(context.last_focus_probe_verified);
    assert!(context.last_focus_delta_observed);
    assert_eq!(
        context.active_focus_region_id.as_deref(),
        Some("region:composer")
    );
}

#[test]
fn workbench_web_tool_routing_context_tracks_reveal_subgoals() {
    let context = crate::agent::tools::derive_workbench_web_routing_context(&[
        test_tool_call(
            "lyra.web.query.find",
            Some(json!({
                "scanSessionId": "scan-1",
                "pageMode": "chat",
                "bestMatch": {
                    "nodeId": "cand-1",
                    "widgetId": "row-1",
                    "widgetKind": "menu-trigger",
                    "discoveryMode": "hover_revealed",
                    "capabilities": {
                        "editable": false,
                        "clickable": true
                    }
                },
                "matches": [{
                    "nodeId": "cand-1",
                    "widgetId": "row-1",
                    "widgetKind": "menu-trigger",
                    "discoveryMode": "hover_revealed",
                    "capabilities": {
                        "editable": false,
                        "clickable": true
                    }
                }]
            })),
            None,
            "completed",
        ),
        test_tool_call(
            "lyra.web.action.safe",
            None,
            Some("reveal_not_observed"),
            "failed",
        ),
    ])
    .expect("routing context");

    assert_eq!(context.active_widget_id.as_deref(), Some("row-1"));
    assert_eq!(context.active_item_id.as_deref(), Some("row-1"));
    assert!(context.last_reveal_observed);
    assert_eq!(
        context.current_browser_subgoal.as_deref(),
        Some("reveal item actions")
    );
    assert_eq!(
        context.last_workflow_failure.as_deref(),
        Some("reveal_not_observed")
    );
}

#[test]
fn workbench_web_tool_routing_context_tracks_draft_only_mutations() {
    let context = crate::agent::tools::derive_workbench_web_routing_context(&[test_tool_call(
        "lyra.web.action.mutate",
        Some(json!({
            "actionKind": "type",
            "submitted": false,
            "draftOnly": true,
            "submissionMethod": "none",
            "verified": true,
            "verification": {
                "reason": "target field value changed"
            }
        })),
        None,
        "completed",
    )])
    .expect("routing context");

    assert!(context.last_mutate_draft_only);
    assert!(!context.last_mutate_submitted);
    assert!(context.last_action_verified);
    assert_eq!(
        context.last_verification_failure.as_deref(),
        Some("target field value changed")
    );
}

#[test]
fn workbench_web_tool_routing_context_ignores_cross_origin_graph_placeholder() {
    let context = crate::agent::tools::derive_workbench_web_routing_context(&[test_tool_call(
        "lyra.web.graph.build",
        Some(json!({
            "nodeCount": 1,
            "highlights": {
                "clickable": [{
                    "tagName": "iframe",
                    "textSnippet": "[cross-origin frame: about:blank]"
                }]
            }
        })),
        None,
        "completed",
    )]);

    assert!(context.is_none());
}

#[test]
fn workbench_web_tool_routing_context_treats_unconfirmed_enter_as_draft_only() {
    let context = crate::agent::tools::derive_workbench_web_routing_context(&[test_tool_call(
        "lyra.web.action.mutate",
        Some(json!({
            "actionKind": "press_key",
            "submitted": false,
            "submissionMethod": "enter"
        })),
        None,
        "completed",
    )])
    .expect("routing context");

    assert!(context.last_mutate_draft_only);
    assert!(!context.last_mutate_submitted);
}

#[test]
fn workbench_web_tool_ranking_avoids_wait_after_draft_only_type() {
    let _guard = EXTERNAL_TOOL_TEST_GUARD
        .lock()
        .expect("external tool test guard");
    clear_external_tools();
    register_test_external_tool(
        "lyra.web.skeleton.read",
        "scan widgets from the current page",
    );
    register_test_external_tool(
        "lyra.web.query.find",
        "scan the visible page for likely interactive targets",
    );
    register_test_external_tool(
        "workbench.tab.read",
        "read summary state from the current page tab",
    );
    register_test_external_tool(
        "workbench.tab.extract_text",
        "extract readable text from the current page tab",
    );
    register_test_external_tool(
        "lyra.web.graph.build",
        "build selector-addressable graph for current webpage",
    );
    register_test_external_tool(
        "lyra.web.graph.query",
        "query interactable nodes from page graph",
    );
    register_test_external_tool("lyra.web.action.safe", "run safe web action in page");
    register_test_external_tool_with_metadata(
        "lyra.web.action.mutate",
        "run mutating web action in page",
        ExternalToolApprovalMode::Ask,
        ExternalToolSideEffects::session_mutation(),
    );
    register_test_external_tool("lyra.web.action.wait", "wait for target state in page");

    let ranked = readonly_tool_definitions_for_input_with_context(
        "continue the current webpage interaction",
        Some(&ToolRankingContext {
            workbench_web: Some(WorkbenchWebRoutingContext {
                has_live_scan_session: true,
                has_live_candidates: true,
                has_typable_candidate: true,
                widget_graph_ready: true,
                native_widget_ready: true,
                last_mutate_draft_only: true,
                ..WorkbenchWebRoutingContext::default()
            }),
            browser_strategy: None,
        }),
    );

    assert!(
        tool_rank(&ranked, "lyra.web.action.mutate") < tool_rank(&ranked, "lyra.web.action.wait")
    );
    assert!(
        tool_rank(&ranked, "lyra.web.action.mutate") < tool_rank(&ranked, "lyra.web.skeleton.read")
    );
    assert!(tool_rank(&ranked, "lyra.web.query.find") < tool_rank(&ranked, "lyra.web.action.wait"));
    assert!(
        tool_rank(&ranked, "lyra.web.action.mutate")
            < tool_rank(&ranked, "workbench.tab.extract_text")
    );
    assert!(
        tool_rank(&ranked, "lyra.web.action.mutate") < tool_rank(&ranked, "workbench.tab.read")
    );

    clear_external_tools();
}

#[test]
fn workbench_web_tool_ranking_prefers_mutate_over_reads_after_typable_scan() {
    let _guard = EXTERNAL_TOOL_TEST_GUARD
        .lock()
        .expect("external tool test guard");
    clear_external_tools();

    register_test_external_tool(
        "lyra.web.skeleton.read",
        "scan widgets from the current page",
    );
    register_test_external_tool(
        "lyra.web.query.find",
        "scan the visible page for likely interactive targets",
    );
    register_test_external_tool(
        "workbench.tab.read",
        "read summary state from the current page tab",
    );
    register_test_external_tool(
        "workbench.tab.extract_text",
        "extract readable text from the current page tab",
    );
    register_test_external_tool(
        "lyra.web.graph.build",
        "build selector-addressable graph for current webpage",
    );
    register_test_external_tool(
        "lyra.web.graph.query",
        "query interactable nodes from page graph",
    );
    register_test_external_tool("lyra.web.action.safe", "run safe web action in page");
    register_test_external_tool_with_metadata(
        "lyra.web.action.mutate",
        "run mutating web action in page",
        ExternalToolApprovalMode::Ask,
        ExternalToolSideEffects::session_mutation(),
    );
    register_test_external_tool("lyra.web.action.wait", "wait for target state in page");

    let ranked = readonly_tool_definitions_for_input_with_context(
        "continue the current webpage interaction",
        Some(&ToolRankingContext {
            workbench_web: Some(WorkbenchWebRoutingContext {
                has_live_scan_session: true,
                has_live_candidates: true,
                has_typable_candidate: true,
                widget_graph_ready: true,
                native_widget_ready: true,
                last_action_verified: true,
                ..WorkbenchWebRoutingContext::default()
            }),
            browser_strategy: None,
        }),
    );

    assert!(
        tool_rank(&ranked, "lyra.web.action.mutate") < tool_rank(&ranked, "workbench.tab.read")
    );
    assert!(
        tool_rank(&ranked, "lyra.web.action.mutate") < tool_rank(&ranked, "lyra.web.skeleton.read")
    );
    assert!(
        tool_rank(&ranked, "lyra.web.action.mutate")
            < tool_rank(&ranked, "workbench.tab.extract_text")
    );
    assert!(
        tool_rank(&ranked, "lyra.web.action.mutate") < tool_rank(&ranked, "lyra.web.graph.build")
    );

    clear_external_tools();
}

#[test]
fn workbench_web_tool_ranking_prefers_hover_reveal_over_terminal_escape() {
    let _guard = EXTERNAL_TOOL_TEST_GUARD
        .lock()
        .expect("external tool test guard");
    clear_external_tools();

    register_test_external_tool(
        "lyra.web.skeleton.read",
        "scan widgets from the current page",
    );
    register_test_external_tool(
        "lyra.web.query.find",
        "scan the visible page for likely interactive targets",
    );
    register_test_external_tool(
        "lyra.web.graph.build",
        "build selector-addressable graph for current webpage",
    );
    register_test_external_tool(
        "lyra.web.graph.query",
        "query interactable nodes from page graph",
    );
    register_test_external_tool("lyra.web.action.safe", "run safe web action in page");
    register_test_external_tool_with_metadata(
        "lyra.web.action.mutate",
        "run mutating web action in page",
        ExternalToolApprovalMode::Ask,
        ExternalToolSideEffects::session_mutation(),
    );

    let ranked = readonly_tool_definitions_for_input_with_context(
        "continue the current webpage interaction",
        Some(&ToolRankingContext {
            workbench_web: Some(WorkbenchWebRoutingContext {
                page_mode: Some("chat".to_string()),
                widget_graph_ready: true,
                native_widget_ready: true,
                active_widget_id: Some("row-1".to_string()),
                active_item_id: Some("row-1".to_string()),
                current_browser_subgoal: Some("reveal item actions".to_string()),
                last_workflow_failure: Some("hover_reveal_required".to_string()),
                ..WorkbenchWebRoutingContext::default()
            }),
            browser_strategy: None,
        }),
    );

    assert!(tool_rank(&ranked, "lyra.web.action.safe") < tool_rank(&ranked, "terminal.exec"));
    assert!(
        tool_rank(&ranked, "lyra.web.action.safe") < tool_rank(&ranked, "lyra.web.graph.build")
    );
    assert!(tool_rank(&ranked, "lyra.web.query.find") < tool_rank(&ranked, "terminal.exec"));

    clear_external_tools();
}

#[test]
fn browser_strategy_context_tracks_browser_use_readiness_and_native_failure() {
    let context = crate::agent::tools::derive_browser_strategy_routing_context(&[
        test_tool_call(
            "browser_use.session.prepare",
            Some(json!({
                "session": {
                    "sessionId": "browser-use-1",
                    "ready": true
                }
            })),
            None,
            "completed",
        ),
        test_tool_call(
            "lyra.web.query.find",
            Some(json!({
                "scanSessionId": "scan-1",
                "bestMatch": {
                    "nodeId": "cand-1",
                    "capabilities": {
                        "editable": false,
                        "clickable": true
                    }
                },
                "matches": [{
                    "nodeId": "cand-1",
                    "capabilities": {
                        "editable": false,
                        "clickable": true
                    }
                }]
            })),
            None,
            "completed",
        ),
        test_tool_call(
            "lyra.web.action.mutate",
            None,
            Some("pointer_intercepted"),
            "failed",
        ),
    ])
    .expect("browser strategy context");

    assert!(context.browser_use_session_ready);
    assert!(context.native_live_candidate_ready);
    assert_eq!(
        context.last_browser_failure_family.as_deref(),
        Some("native")
    );
}

#[test]
fn browser_strategy_prefers_browser_use_after_native_failure_when_session_is_ready() {
    let _guard = EXTERNAL_TOOL_TEST_GUARD
        .lock()
        .expect("external tool test guard");
    clear_external_tools();

    register_test_external_tool("lyra.web.action.mutate", "run mutating web action in page");
    register_test_external_tool(
        "lyra.web.query.find",
        "scan the visible page for likely interactive targets",
    );
    register_test_external_tool(
        "browser_use.session.prepare",
        "prepare a browser-use session",
    );
    register_test_external_tool("browser_use.page.state", "read browser-use state");
    register_test_external_tool_with_metadata(
        "browser_use.page.mutate",
        "run browser-use mutating page action",
        ExternalToolApprovalMode::Ask,
        ExternalToolSideEffects::session_mutation(),
    );

    let ranked = readonly_tool_definitions_for_input_with_context(
        "continue the browser task",
        Some(&ToolRankingContext {
            workbench_web: None,
            browser_strategy: Some(BrowserStrategyRoutingContext {
                last_browser_strategy: Some("browser_use".to_string()),
                browser_use_session_ready: true,
                native_live_candidate_ready: true,
                native_widget_ready: true,
                last_action_verified: true,
                strategy_lease_active: true,
                last_browser_failure_family: Some("native".to_string()),
                in_long_running_flow: false,
                preferred_engine: Some("smart".to_string()),
                browser_use_health: Some("healthy".to_string()),
                browser_use_tool_exposed: true,
            }),
        }),
    );

    assert!(
        tool_rank(&ranked, "browser_use.page.mutate")
            < tool_rank(&ranked, "lyra.web.action.mutate")
    );
    assert!(
        tool_rank(&ranked, "browser_use.page.state") < tool_rank(&ranked, "lyra.web.query.find")
    );

    clear_external_tools();
}

#[test]
fn mcp_prompt_json_includes_external_tool_metadata() {
    let _guard = EXTERNAL_TOOL_TEST_GUARD
        .lock()
        .expect("external tool test guard");
    clear_external_tools();
    register_external_tool(RegisteredExternalTool {
        definition: crate::provider::types::AgentToolDefinition {
            name: "mcp:test/read_file".to_string(),
            description: "read file through MCP".to_string(),
            input_schema: json!({
                "type": "object",
                "required": ["path"],
                "properties": {
                    "path": { "type": "string" }
                }
            }),
        },
        metadata: ExternalToolMetadata {
            output_schema: json!({
                "type": "object",
                "properties": {
                    "content": { "type": "string" }
                }
            }),
            approval_mode: ExternalToolApprovalMode::Auto,
            side_effects: ExternalToolSideEffects::read_only(),
        },
        executor: Arc::new(|_, _context| Ok(json!({"content": "hello"}))),
        execution_mode: ToolExecutionMode::ParallelReadOnly,
    });

    let rendered = render_mcp_tools_prompt_json();
    let parsed: Value = serde_json::from_str(&rendered).expect("parse rendered metadata");
    let tools = parsed.as_array().expect("prompt tools array");
    assert_eq!(tools.len(), 1);
    assert_eq!(
        tools[0].get("approvalMode").and_then(Value::as_str),
        Some("auto")
    );
    assert_eq!(
        tools[0]
            .get("sideEffects")
            .and_then(|value| value.get("level"))
            .and_then(Value::as_str),
        Some("read_only")
    );
    assert!(tools[0]
        .get("outputSchema")
        .and_then(|value| value.get("properties"))
        .and_then(|value| value.get("content"))
        .is_some());

    clear_external_tools();
}

#[test]
fn external_tool_approval_is_enforced_and_can_be_granted_once() {
    let _guard = EXTERNAL_TOOL_TEST_GUARD
        .lock()
        .expect("external tool test guard");
    clear_external_tools();
    let temp = TempStorageRoot::new();
    let root = create_workspace_root(&temp);
    let root_string = root.to_string_lossy().to_string();

    register_external_tool(RegisteredExternalTool {
        definition: crate::provider::types::AgentToolDefinition {
            name: "external.ask".to_string(),
            description: "external tool requiring approval".to_string(),
            input_schema: json!({
                "type": "object",
                "additionalProperties": false
            }),
        },
        metadata: ExternalToolMetadata {
            output_schema: json!({"type": "object"}),
            approval_mode: ExternalToolApprovalMode::Ask,
            side_effects: ExternalToolSideEffects::workspace_write(),
        },
        executor: Arc::new(|_, _context| Ok(json!({"ok": true}))),
        execution_mode: ToolExecutionMode::Serial,
    });

    let error = execute_tool_with_progress(
        "external.ask",
        &json!({}),
        tool_context(
            None,
            Some(root_string.as_str()),
            Some("external-ask"),
            None,
            false,
        ),
        |_| {},
    )
    .expect_err("external tool should require approval");
    assert_eq!(error.code, "AGENT_TOOL_APPROVAL_REQUIRED");
    let metadata = error.metadata.expect("approval metadata");
    assert_eq!(
        metadata.get("approvalKind").and_then(Value::as_str),
        Some("external_tool")
    );
    assert_eq!(
        metadata.get("approvalPattern").and_then(Value::as_str),
        Some("external_tool:external.ask")
    );

    grant_approval_once("external-ask", &metadata);

    let result = execute_tool_with_progress(
        "external.ask",
        &json!({}),
        tool_context(
            None,
            Some(root_string.as_str()),
            Some("external-ask"),
            None,
            false,
        ),
        |_| {},
    )
    .expect("one-time approved external tool should execute");
    assert_eq!(result.get("ok").and_then(Value::as_bool), Some(true));

    clear_external_tools();
}

#[test]
fn external_tool_honors_persisted_allow_policy() {
    let _guard = EXTERNAL_TOOL_TEST_GUARD
        .lock()
        .expect("external tool test guard");
    clear_external_tools();
    let temp = TempStorageRoot::new();
    let root = create_workspace_root(&temp);
    let root_string = root.to_string_lossy().to_string();

    register_external_tool(RegisteredExternalTool {
        definition: crate::provider::types::AgentToolDefinition {
            name: "external.persisted".to_string(),
            description: "external tool with persisted approval".to_string(),
            input_schema: json!({
                "type": "object",
                "additionalProperties": false
            }),
        },
        metadata: ExternalToolMetadata {
            output_schema: json!({"type": "object"}),
            approval_mode: ExternalToolApprovalMode::Ask,
            side_effects: ExternalToolSideEffects::workspace_write(),
        },
        executor: Arc::new(|_, _context| Ok(json!({"ok": true}))),
        execution_mode: ToolExecutionMode::Serial,
    });

    let mut permissions = PermissionsStore::default();
    permissions
        .add_rule(
            root_string.as_str(),
            "external_tool:external.persisted",
            PermissionDecision::AllowAlways,
        )
        .expect("persist permissions");

    let result = execute_tool_with_progress(
        "external.persisted",
        &json!({}),
        tool_context(
            None,
            Some(root_string.as_str()),
            Some("external-persisted"),
            None,
            false,
        ),
        |_| {},
    )
    .expect("persisted allow should bypass approval");
    assert_eq!(result.get("ok").and_then(Value::as_bool), Some(true));

    clear_external_tools();
}

#[test]
fn bound_project_root_scopes_relative_defaults() {
    let temp = TempStorageRoot::new();
    let root = create_workspace_root(&temp);
    write(root.join("scoped.txt"), "scoped\n").expect("write scoped file");

    let result =
        execute_readonly_tool("filesystem.list", &json!({}), Some(&root.to_string_lossy()))
            .expect("run list with bound scope");
    let listed_path = result
        .get("path")
        .and_then(Value::as_str)
        .expect("listed path");
    let listed_canonical = PathBuf::from(listed_path)
        .canonicalize()
        .expect("canonical listed path");
    let root_canonical = root.canonicalize().expect("canonical root path");
    assert_eq!(listed_canonical, root_canonical);
}

#[test]
fn bound_project_root_blocks_outside_paths() {
    let temp = TempStorageRoot::new();
    let root = create_workspace_root(&temp);
    let outside_file = PathBuf::from(temp.as_string()).join("outside.txt");
    write(&outside_file, "outside\n").expect("write outside file");

    let error = execute_readonly_tool(
        "filesystem.read_range",
        &json!({
            "path": outside_file.to_string_lossy(),
            "startLine": 1,
            "endLine": 1,
        }),
        Some(&root.to_string_lossy()),
    )
    .expect_err("outside path should be blocked");
    assert_eq!(error.code, AGENT_TOOL_READ_BLOCKED);
}

#[test]
fn filesystem_write_creates_file() {
    let temp = TempStorageRoot::new();
    let root = create_workspace_root(&temp);
    let file_path = root.join("src").join("main.rs");

    let result = execute_readonly_tool(
        "filesystem.write",
        &json!({
            "path": file_path.to_string_lossy(),
            "content": "fn main() {}\n",
        }),
        None,
    )
    .expect("write file");

    assert_eq!(result.get("created").and_then(Value::as_bool), Some(true));
    let saved = std::fs::read_to_string(file_path).expect("read saved file");
    assert_eq!(saved, "fn main() {}\n");
}

#[test]
fn filesystem_edit_replaces_text() {
    let temp = TempStorageRoot::new();
    let root = create_workspace_root(&temp);
    let file_path = root.join("app.txt");
    write(&file_path, "hello old world\n").expect("seed file");

    let result = execute_readonly_tool(
        "filesystem.edit",
        &json!({
            "path": file_path.to_string_lossy(),
            "oldText": "old",
            "newText": "new",
        }),
        None,
    )
    .expect("edit file");

    assert_eq!(result.get("replacements").and_then(Value::as_u64), Some(1));
    let saved = std::fs::read_to_string(file_path).expect("read edited file");
    assert_eq!(saved, "hello new world\n");
}

#[test]
fn filesystem_multi_edit_applies_all_replacements() {
    let temp = TempStorageRoot::new();
    let root = create_workspace_root(&temp);
    let file_path = root.join("multi.txt");
    write(&file_path, "hello world\nhello world\n").expect("seed multi file");

    let result = execute_readonly_tool(
        "filesystem.multi_edit",
        &json!({
            "path": file_path.to_string_lossy(),
            "edits": [
                {
                    "oldText": "hello",
                    "newText": "hi",
                    "replaceAll": true,
                },
                {
                    "oldText": "world",
                    "newText": "lyra",
                    "replaceAll": true,
                }
            ]
        }),
        None,
    )
    .expect("multi edit file");

    assert_eq!(result.get("editCount").and_then(Value::as_u64), Some(2));
    let saved = std::fs::read_to_string(file_path).expect("read multi edited file");
    assert_eq!(saved, "hi lyra\nhi lyra\n");
}

#[test]
fn filesystem_write_reports_first_changed_line_for_update() {
    let temp = TempStorageRoot::new();
    let root = create_workspace_root(&temp);
    let file_path = root.join("update.txt");
    write(&file_path, "line1\nline2\nline3\n").expect("seed update file");

    let result = execute_readonly_tool(
        "filesystem.write",
        &json!({
            "path": file_path.to_string_lossy(),
            "content": "line1\nline2-changed\nline3\n",
        }),
        None,
    )
    .expect("write update");

    assert_eq!(
        result.get("firstChangedLine").and_then(Value::as_u64),
        Some(2)
    );
}

#[test]
fn filesystem_edit_reports_first_changed_line() {
    let temp = TempStorageRoot::new();
    let root = create_workspace_root(&temp);
    let file_path = root.join("edit-line.txt");
    write(&file_path, "a\nb\nc\n").expect("seed edit line file");

    let result = execute_readonly_tool(
        "filesystem.edit",
        &json!({
            "path": file_path.to_string_lossy(),
            "oldText": "b",
            "newText": "b2",
        }),
        None,
    )
    .expect("edit line");

    assert_eq!(
        result.get("firstChangedLine").and_then(Value::as_u64),
        Some(2)
    );
}

#[test]
fn filesystem_write_progress_emits_text_chunks() {
    let temp = TempStorageRoot::new();
    let root = create_workspace_root(&temp);
    let file_path = root.join("progress.txt");
    let mut saw_chunk = false;
    let mut saw_baseline = false;

    let result = execute_tool_with_progress(
        "filesystem.write",
        &json!({
            "path": file_path.to_string_lossy(),
            "content": "chunk-a\nchunk-b\n",
        }),
        ToolExecutionContext::readonly(None),
        |progress: Value| {
            if progress
                .get("stage")
                .and_then(Value::as_str)
                .is_some_and(|value| value == "baseline")
            {
                saw_baseline = true;
            }
            if progress
                .get("chunkText")
                .and_then(Value::as_str)
                .is_some_and(|value| !value.is_empty())
            {
                saw_chunk = true;
            }
        },
    )
    .expect("write with progress");

    assert_eq!(result.get("kind").and_then(Value::as_str), Some("created"));
    assert!(saw_baseline);
    assert!(saw_chunk);
}

#[test]
fn filesystem_edit_returns_no_match_instead_of_error() {
    let temp = TempStorageRoot::new();
    let root = create_workspace_root(&temp);
    let file_path = root.join("no-match.txt");
    write(&file_path, "alpha\nbeta\ngamma\n").expect("seed no match file");

    let result = execute_readonly_tool(
        "filesystem.edit",
        &json!({
            "path": file_path.to_string_lossy(),
            "oldText": "missing-segment",
            "newText": "replacement",
        }),
        None,
    )
    .expect("edit should not fail on no match");

    assert_eq!(result.get("kind").and_then(Value::as_str), Some("no_match"));
    assert_eq!(result.get("replacements").and_then(Value::as_u64), Some(0));
    let saved = std::fs::read_to_string(file_path).expect("read untouched file");
    assert_eq!(saved, "alpha\nbeta\ngamma\n");
}

#[test]
fn filesystem_multi_edit_allows_partial_application() {
    let temp = TempStorageRoot::new();
    let root = create_workspace_root(&temp);
    let file_path = root.join("multi-partial.txt");
    write(&file_path, "first\nsecond\nthird\n").expect("seed partial multi file");

    let result = execute_readonly_tool(
        "filesystem.multi_edit",
        &json!({
            "path": file_path.to_string_lossy(),
            "edits": [
                {
                    "oldText": "first",
                    "newText": "FIRST",
                },
                {
                    "oldText": "missing",
                    "newText": "MISSING",
                },
                {
                    "oldText": "second",
                    "newText": "SECOND",
                }
            ]
        }),
        None,
    )
    .expect("multi edit partial should not fail");

    assert_eq!(result.get("kind").and_then(Value::as_str), Some("partial"));
    assert_eq!(
        result.get("appliedEditCount").and_then(Value::as_u64),
        Some(2)
    );
    assert_eq!(result.get("replacements").and_then(Value::as_u64), Some(2));
    let not_found = result
        .get("notFoundEditIndexes")
        .and_then(Value::as_array)
        .expect("not found edit indexes");
    assert_eq!(not_found.len(), 1);
    assert_eq!(not_found[0].as_u64(), Some(2));

    let saved = std::fs::read_to_string(file_path).expect("read partial multi edited file");
    assert_eq!(saved, "FIRST\nSECOND\nthird\n");
}

#[test]
fn terminal_exec_returns_interactive_advisory_for_tui_commands() {
    let _guard = TERMINAL_SESSION_TEST_GUARD
        .lock()
        .expect("terminal session test guard");
    let temp = TempStorageRoot::new();
    let root = create_workspace_root(&temp);
    let root_string = root.to_string_lossy().to_string();
    let policy = select_terminal_interaction_policy();

    let result = execute_tool_with_progress(
        "terminal.exec",
        &json!({
            "command": "htop",
        }),
        tool_context(
            None,
            Some(root_string.as_str()),
            Some("terminal-exec-advisory"),
            Some(&policy),
            false,
        ),
        |_| {},
    )
    .expect("terminal exec should return advisory");

    assert_eq!(
        result.get("kind").and_then(Value::as_str),
        Some("interactive_advisory")
    );
    assert_eq!(
        result.get("interactiveCategory").and_then(Value::as_str),
        Some("fullscreen_tui")
    );
    assert_eq!(
        result.get("suggestedTool").and_then(Value::as_str),
        Some("terminal.session.start")
    );
    assert!(
        result
            .get("suggestedAlternative")
            .and_then(Value::as_str)
            .is_some(),
        "expected non-interactive rewrite advice"
    );
}

#[test]
fn terminal_session_shell_mode_requires_approval_without_text_based_policy_inference() {
    let _guard = TERMINAL_SESSION_TEST_GUARD
        .lock()
        .expect("terminal session test guard");
    let temp = TempStorageRoot::new();
    let root = create_workspace_root(&temp);
    let root_string = root.to_string_lossy().to_string();
    let policy = select_terminal_interaction_policy();

    let error = execute_tool_with_progress(
        "terminal.session.start",
        &json!({
            "mode": "shell",
        }),
        tool_context(
            None,
            Some(root_string.as_str()),
            Some("terminal-shell-blocked"),
            Some(&policy),
            false,
        ),
        |_| {},
    )
    .expect_err("shell mode should require approval");

    assert_eq!(error.code, "AGENT_TOOL_APPROVAL_REQUIRED");
}

#[test]
fn terminal_session_command_mode_can_start_and_read_output() {
    let _guard = TERMINAL_SESSION_TEST_GUARD
        .lock()
        .expect("terminal session test guard");
    let temp = TempStorageRoot::new();
    let root = create_workspace_root(&temp);
    let root_string = root.to_string_lossy().to_string();
    let policy = select_terminal_interaction_policy();
    let command = "printf 'hello-from-session\\n'";

    grant_approval_once(
        "terminal-session-command",
        &json!({
            "command": command,
        }),
    );

    let started = execute_tool_with_progress(
        "terminal.session.start",
        &json!({
            "mode": "command",
            "command": command,
            "cwd": root_string,
        }),
        tool_context(
            None,
            Some(root_string.as_str()),
            Some("terminal-session-command"),
            Some(&policy),
            false,
        ),
        |_| {},
    )
    .expect("start command session");

    assert_eq!(started.get("kind").and_then(Value::as_str), Some("started"));
    let session_id = started
        .get("sessionId")
        .and_then(Value::as_str)
        .expect("session id")
        .to_string();

    let read = execute_tool_with_progress(
        "terminal.session.read",
        &json!({
            "sessionId": session_id,
            "waitMs": 1000,
        }),
        tool_context(None, Some(root_string.as_str()), None, Some(&policy), false),
        |_| {},
    )
    .expect("read command session");

    assert_eq!(read.get("kind").and_then(Value::as_str), Some("read"));
    assert!(
        read.get("output")
            .and_then(Value::as_str)
            .is_some_and(|value| value.contains("hello-from-session")),
        "expected command session output"
    );

    execute_tool_with_progress(
        "terminal.session.close",
        &json!({
            "sessionId": read
                .get("sessionId")
                .and_then(Value::as_str)
                .expect("session id in read response"),
        }),
        tool_context(None, Some(root_string.as_str()), None, Some(&policy), false),
        |_| {},
    )
    .expect("close command session");
}

#[test]
fn terminal_session_command_mode_write_defaults_to_newline() {
    let _guard = TERMINAL_SESSION_TEST_GUARD
        .lock()
        .expect("terminal session test guard");
    let temp = TempStorageRoot::new();
    let root = create_workspace_root(&temp);
    let root_string = root.to_string_lossy().to_string();
    let policy = select_terminal_interaction_policy();
    let command = "printf 'confirm? '; read answer; printf 'captured=%s\\n' \"$answer\"";

    grant_approval_once(
        "terminal-session-default-newline",
        &json!({
            "command": command,
        }),
    );

    let started = execute_tool_with_progress(
        "terminal.session.start",
        &json!({
            "mode": "command",
            "command": command,
            "cwd": root_string,
        }),
        tool_context(
            None,
            Some(root_string.as_str()),
            Some("terminal-session-default-newline"),
            Some(&policy),
            false,
        ),
        |_| {},
    )
    .expect("start command session");

    let session_id = started
        .get("sessionId")
        .and_then(Value::as_str)
        .expect("session id")
        .to_string();

    execute_tool_with_progress(
        "terminal.session.write",
        &json!({
            "sessionId": session_id,
            "text": "yes",
        }),
        tool_context(None, Some(root_string.as_str()), None, Some(&policy), false),
        |_| {},
    )
    .expect("write command response without explicit newline");

    let mut cursor: Option<String> = None;
    let mut observed_output = String::new();
    let deadline = Instant::now() + Duration::from_secs(4);
    let mut running = true;
    while Instant::now() < deadline && running {
        let read = execute_tool_with_progress(
            "terminal.session.read",
            &json!({
                "sessionId": session_id,
                "waitMs": 250,
                "cursor": cursor,
            }),
            tool_context(None, Some(root_string.as_str()), None, Some(&policy), false),
            |_| {},
        )
        .expect("read command session");

        if let Some(chunk) = read.get("output").and_then(Value::as_str) {
            observed_output.push_str(chunk);
        }
        cursor = read
            .get("cursor")
            .and_then(Value::as_str)
            .map(str::to_string);
        running = read.get("running").and_then(Value::as_bool).unwrap_or(true);
        if observed_output.contains("captured=yes") && !running {
            break;
        }
        thread::sleep(Duration::from_millis(50));
    }

    assert!(
        observed_output.contains("captured=yes"),
        "expected command response to be submitted by default newline behavior"
    );

    execute_tool_with_progress(
        "terminal.session.close",
        &json!({
            "sessionId": session_id,
        }),
        tool_context(None, Some(root_string.as_str()), None, Some(&policy), false),
        |_| {},
    )
    .expect("close command session");
}

#[test]
fn terminal_blocks_new_exec_while_command_session_is_running() {
    let _guard = TERMINAL_SESSION_TEST_GUARD
        .lock()
        .expect("terminal session test guard");
    let temp = TempStorageRoot::new();
    let root = create_workspace_root(&temp);
    let root_string = root.to_string_lossy().to_string();
    let policy = select_terminal_interaction_policy();
    let command = "printf 'blocked-check\\n'; read answer; printf 'done=%s\\n' \"$answer\"";

    grant_approval_once(
        "terminal-command-barrier",
        &json!({
            "command": command,
        }),
    );

    let started = execute_tool_with_progress(
        "terminal.session.start",
        &json!({
            "mode": "command",
            "command": command,
            "cwd": root_string,
        }),
        tool_context(
            None,
            Some(root_string.as_str()),
            Some("terminal-command-barrier"),
            Some(&policy),
            false,
        ),
        |_| {},
    )
    .expect("start blocking command session");

    let session_id = started
        .get("sessionId")
        .and_then(Value::as_str)
        .expect("session id")
        .to_string();

    let blocked_exec = execute_tool_with_progress(
        "terminal.exec",
        &json!({
            "command": "pwd",
        }),
        tool_context(None, Some(root_string.as_str()), None, Some(&policy), false),
        |_| {},
    )
    .expect("terminal.exec should return in-flight session barrier");
    assert_eq!(
        blocked_exec.get("kind").and_then(Value::as_str),
        Some("interactive_policy_blocked")
    );
    assert_eq!(
        blocked_exec.get("activeSessionId").and_then(Value::as_str),
        Some(session_id.as_str())
    );

    let blocked_start = execute_tool_with_progress(
        "terminal.session.start",
        &json!({
            "mode": "command",
            "command": "printf 'second\\n'",
            "cwd": root_string,
        }),
        tool_context(None, Some(root_string.as_str()), None, Some(&policy), false),
        |_| {},
    )
    .expect("second command session should be blocked");
    assert_eq!(
        blocked_start.get("kind").and_then(Value::as_str),
        Some("interactive_policy_blocked")
    );
    assert_eq!(
        blocked_start.get("activeSessionId").and_then(Value::as_str),
        Some(session_id.as_str())
    );

    execute_tool_with_progress(
        "terminal.session.write",
        &json!({
            "sessionId": session_id,
            "text": "ok",
            "appendNewline": true,
        }),
        tool_context(None, Some(root_string.as_str()), None, Some(&policy), false),
        |_| {},
    )
    .expect("unblock command session");

    let mut cursor: Option<String> = None;
    let deadline = Instant::now() + Duration::from_secs(3);
    let mut running = true;
    while Instant::now() < deadline && running {
        let read = execute_tool_with_progress(
            "terminal.session.read",
            &json!({
                "sessionId": session_id,
                "waitMs": 250,
                "cursor": cursor,
            }),
            tool_context(None, Some(root_string.as_str()), None, Some(&policy), false),
            |_| {},
        )
        .expect("read command session");
        cursor = read
            .get("cursor")
            .and_then(Value::as_str)
            .map(str::to_string);
        running = read.get("running").and_then(Value::as_bool).unwrap_or(true);
        thread::sleep(Duration::from_millis(25));
    }

    execute_tool_with_progress(
        "terminal.session.close",
        &json!({
            "sessionId": session_id,
        }),
        tool_context(None, Some(root_string.as_str()), None, Some(&policy), false),
        |_| {},
    )
    .expect("close command session");
}

#[test]
fn terminal_session_shell_mode_honors_one_time_approval() {
    let _guard = TERMINAL_SESSION_TEST_GUARD
        .lock()
        .expect("terminal session test guard");
    let temp = TempStorageRoot::new();
    let root = create_workspace_root(&temp);
    let root_string = root.to_string_lossy().to_string();
    let policy = select_terminal_interaction_policy();

    let error = execute_tool_with_progress(
        "terminal.session.start",
        &json!({
            "mode": "shell",
            "cwd": root_string,
        }),
        tool_context(
            None,
            Some(root_string.as_str()),
            Some("terminal-shell-approval"),
            Some(&policy),
            false,
        ),
        |_| {},
    )
    .expect_err("shell mode should require approval");
    assert_eq!(error.code, "AGENT_TOOL_APPROVAL_REQUIRED");

    grant_approval_once("terminal-shell-approval", &json!({}));

    let started = execute_tool_with_progress(
        "terminal.session.start",
        &json!({
            "mode": "shell",
            "cwd": root_string,
        }),
        tool_context(
            None,
            Some(root_string.as_str()),
            Some("terminal-shell-approval"),
            Some(&policy),
            false,
        ),
        |_| {},
    )
    .expect("approved shell mode should start");

    let session_id = started
        .get("sessionId")
        .and_then(Value::as_str)
        .expect("session id")
        .to_string();
    let shell_command = "printf 'shell-ready\\n'";

    grant_approval_once(
        "terminal-shell-write",
        &json!({
            "command": shell_command,
            "sessionId": session_id,
        }),
    );

    execute_tool_with_progress(
        "terminal.session.write",
        &json!({
            "sessionId": session_id,
            "text": shell_command,
            "appendNewline": true,
        }),
        tool_context(
            None,
            Some(root_string.as_str()),
            Some("terminal-shell-write"),
            Some(&policy),
            false,
        ),
        |_| {},
    )
    .expect("write safe shell command");

    let mut cursor: Option<String> = None;
    let mut observed_output = String::new();
    let deadline = Instant::now() + Duration::from_secs(3);
    while Instant::now() < deadline && !observed_output.contains("shell-ready") {
        let read = execute_tool_with_progress(
            "terminal.session.read",
            &json!({
                "sessionId": started
                    .get("sessionId")
                    .and_then(Value::as_str)
                    .expect("session id"),
                "waitMs": 250,
                "cursor": cursor,
            }),
            tool_context(None, Some(root_string.as_str()), None, Some(&policy), false),
            |_| {},
        )
        .expect("read shell session");

        if let Some(chunk) = read.get("output").and_then(Value::as_str) {
            observed_output.push_str(chunk);
        }
        cursor = read
            .get("cursor")
            .and_then(Value::as_str)
            .map(str::to_string);
        if observed_output.contains("shell-ready") {
            break;
        }
        thread::sleep(Duration::from_millis(50));
    }

    assert!(
        observed_output.contains("shell-ready"),
        "expected shell output after write"
    );

    execute_tool_with_progress(
        "terminal.session.close",
        &json!({
            "sessionId": session_id,
        }),
        tool_context(None, Some(root_string.as_str()), None, Some(&policy), false),
        |_| {},
    )
    .expect("close shell session");
}

#[test]
fn request_user_input_requires_plan_response() {
    let temp = TempStorageRoot::new();
    let storage_root = temp.as_string();

    let error = execute_tool_with_progress(
        "request_user_input",
        &json!({
            "questions": [
                {
                    "id": "scope",
                    "header": "Scope",
                    "question": "Which scope should Lyra target?",
                    "options": [
                        { "label": "A", "description": "Option A" },
                        { "label": "B", "description": "Option B" }
                    ]
                }
            ],
            "allowNote": true
        }),
        tool_context(
            Some(storage_root.as_str()),
            None,
            Some("plan-question-call"),
            None,
            true,
        ),
        |_| {},
    )
    .expect_err("request_user_input should wait on the UI");

    assert_eq!(error.code, AGENT_PLAN_QUESTION_REQUIRED);
    assert_eq!(
        error
            .metadata
            .as_ref()
            .and_then(|metadata| metadata.get("allowNote"))
            .and_then(Value::as_bool),
        Some(true)
    );
}

#[test]
fn request_user_input_is_available_outside_plan_mode() {
    let temp = TempStorageRoot::new();
    let storage_root = temp.as_string();

    let error = execute_tool_with_progress(
        "request_user_input",
        &json!({
            "questions": [
                {
                    "id": "layout",
                    "header": "Layout",
                    "question": "Which landing-page layout should Lyra use?",
                    "allowOther": true,
                    "options": [
                        { "label": "Hero first", "description": "Lead with the hero section", "preview": "<Hero />" },
                        { "label": "Product first", "description": "Lead with product proof" }
                    ]
                }
            ],
            "allowNote": true
        }),
        tool_context(
            Some(storage_root.as_str()),
            None,
            Some("default-question-call"),
            None,
            false,
        ),
        |_| {},
    )
    .expect_err("request_user_input should still wait on the UI in default mode");

    assert_eq!(error.code, AGENT_PLAN_QUESTION_REQUIRED);
    assert_eq!(
        error
            .metadata
            .as_ref()
            .and_then(|metadata| metadata.get("questions"))
            .and_then(Value::as_array)
            .and_then(|questions| questions.first())
            .and_then(Value::as_object)
            .and_then(|question| question.get("allowOther"))
            .and_then(Value::as_bool),
        Some(true)
    );
}

#[test]
fn plan_update_and_submit_persist_plan_state() {
    let temp = TempStorageRoot::new();
    let storage_root = temp.as_string();
    let session = crate::agent::service::create_session(AgentCreateSessionRequest {
        storage_root: storage_root.clone(),
        title: Some("Plan".to_string()),
        profile_id: None,
    })
    .expect("create session");

    let updated = execute_tool_with_progress(
        "plan.update_draft",
        &json!({
            "draftMarkdown": "# Plan\n\n1. Inspect\n2. Implement\n"
        }),
        ToolExecutionContext {
            storage_root: Some(storage_root.as_str()),
            project_root: None,
            agent_session_id: Some(session.id.as_str()),
            agent_turn_id: Some("plan-turn"),
            tool_call_id: Some("plan-update-call"),
            terminal_policy: None,
            plan_mode: true,
        },
        |_| {},
    )
    .expect("update draft");
    assert_eq!(
        updated.get("kind").and_then(Value::as_str),
        Some("plan_draft_updated")
    );

    let saved = registry_db::read_agent_plan(&storage_root, &session.id)
        .expect("read plan")
        .expect("plan exists");
    assert_eq!(saved.version, 1);
    assert_eq!(saved.draft_markdown, "# Plan\n\n1. Inspect\n2. Implement\n");

    let error = execute_tool_with_progress(
        "plan.submit_for_approval",
        &json!({
            "planMarkdown": "# Plan\n\n1. Inspect\n2. Implement\n",
            "summary": "Ready for implementation"
        }),
        ToolExecutionContext {
            storage_root: Some(storage_root.as_str()),
            project_root: None,
            agent_session_id: Some(session.id.as_str()),
            agent_turn_id: Some("plan-turn"),
            tool_call_id: Some("plan-submit-call"),
            terminal_policy: None,
            plan_mode: true,
        },
        |_| {},
    )
    .expect_err("submit should require approval");

    assert_eq!(error.code, AGENT_PLAN_APPROVAL_REQUIRED);
    let submitted = registry_db::read_agent_plan(&storage_root, &session.id)
        .expect("read submitted plan")
        .expect("submitted plan exists");
    assert_eq!(
        submitted.status,
        crate::agent::types::AgentPlanStatus::Submitted
    );
    assert_eq!(submitted.last_submitted_version, Some(1));
    assert_eq!(
        submitted.proposed_markdown.as_deref(),
        Some("# Plan\n\n1. Inspect\n2. Implement\n")
    );
}

#[test]
fn plan_mode_blocks_mutating_terminal_exec_commands() {
    let _guard = TERMINAL_SESSION_TEST_GUARD
        .lock()
        .expect("terminal session test guard");
    let temp = TempStorageRoot::new();
    let root = create_workspace_root(&temp);
    let root_string = root.to_string_lossy().to_string();
    let policy = select_terminal_interaction_policy();

    let result = execute_tool_with_progress(
        "terminal.exec",
        &json!({
            "command": "npm install",
            "cwd": root_string,
        }),
        tool_context(
            None,
            Some(root_string.as_str()),
            Some("plan-mode-terminal"),
            Some(&policy),
            true,
        ),
        |_| {},
    )
    .expect("plan mode should deny mutating command");

    assert_eq!(result.get("kind").and_then(Value::as_str), Some("denied"));
    assert_eq!(
        result.get("planModeReadonly").and_then(Value::as_bool),
        Some(true)
    );
}
