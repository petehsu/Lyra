use super::*;

#[test]
fn native_tool_surface_dispatches_file_search_shell_render_and_todo() {
    let backend = LyraAgentBackend;
    let temp = tempfile::tempdir().expect("tempdir");
    fs::create_dir_all(temp.path().join("src")).expect("create src");
    fs::write(temp.path().join("README.md"), "needle in docs\nsecond line").expect("write readme");
    fs::write(
        temp.path().join("src").join("main.rs"),
        "pub fn main() {\n    println!(\"needle\");\n}\n",
    )
    .expect("write main");
    let created = backend
        .call_agent_method(
            "agent.session.create",
            json!({
                "title": "Native Tool Surface Test",
                "workingDir": temp.path().display().to_string()
            }),
        )
        .expect("create session");
    let session_id = created["id"].as_str().expect("session id").to_string();
    let turn_id = start_test_runtime_turn(&session_id);
    let cancellation = Arc::new(AtomicBool::new(false));
    ensure_test_local_search_index_ready(temp.path());
    let read = execute_model_tool(
        &session_id,
        &turn_id,
        &None,
        &cancellation,
        tool_fs_run_call(
            "tool-read",
            "/tools/filesystem/read_file",
            json!({ "path": "README.md", "startLine": 1, "endLine": 1 }),
        ),
    );
    assert!(read["content"].as_str().unwrap().contains("needle in docs"));
    assert_eq!(read["schemaVersion"].as_u64(), Some(1));
    assert_eq!(read["status"].as_str(), Some("completed"));
    assert_eq!(read["runtimeTurnId"].as_str(), Some(turn_id.as_str()));
    assert_eq!(
        read["toolPath"].as_str(),
        Some("/tools/filesystem/read_file")
    );
    assert_eq!(read["manifestTitle"].as_str(), Some("Read file"));
    assert!(read["traceId"].as_str().is_some());
    assert!(
        read["trace"]
            .as_array()
            .is_some_and(|trace| trace.iter().any(|record| record["phase"] == "validated"))
    );
    let glob = execute_model_tool(
        &session_id,
        &turn_id,
        &None,
        &cancellation,
        tool_fs_run_call(
            "tool-glob",
            "/tools/filesystem/glob",
            json!({ "pattern": "**/*.rs" }),
        ),
    );
    assert!(glob["content"].as_str().unwrap().contains("src/main.rs"));
    let search = execute_model_tool(
        &session_id,
        &turn_id,
        &None,
        &cancellation,
        tool_fs_run_call(
            "tool-search",
            "/tools/code/search_project",
            json!({ "query": "needle" }),
        ),
    );
    assert!(search["content"].as_str().unwrap().contains("README.md"));
    let symbol = execute_model_tool(
        &session_id,
        &turn_id,
        &None,
        &cancellation,
        tool_fs_run_call(
            "tool-symbol",
            "/tools/code/search_symbol",
            json!({ "query": "main" }),
        ),
    );
    assert!(symbol["content"].as_str().unwrap().contains("src/main.rs"));
    let shell = execute_model_tool(
        &session_id,
        &turn_id,
        &None,
        &cancellation,
        tool_fs_run_call(
            "tool-shell",
            "/tools/shell/run_command",
            json!({ "command": "printf hello", "cwd": "." }),
        ),
    );
    assert!(shell["content"].as_str().unwrap().contains("hello"));
    assert_eq!(shell["raw"]["exitCode"].as_i64(), Some(0));
    assert_eq!(shell["status"].as_str(), Some("completed"));
    assert_eq!(shell["activityKind"].as_str(), Some("shell"));
    assert!(shell["stdoutRef"].is_object());
    assert_eq!(
        shell.pointer("/stdoutRef/kind").and_then(Value::as_str),
        Some("stdout")
    );
    assert_eq!(
        shell
            .pointer("/raw/policyDecision/mode")
            .and_then(Value::as_str),
        Some("auto_approved")
    );
    assert!(
        shell["artifactRefs"]
            .as_array()
            .is_some_and(|artifacts| artifacts.iter().any(|artifact| artifact["id"].is_string()))
    );
    assert!(
        shell["changes"]
            .as_array()
            .is_some_and(|changes| changes.iter().any(|change| {
                change["kind"] == "process" && change["detail"]["stdoutRef"].is_object()
            }))
    );
    let rendered = execute_model_tool(
        &session_id,
        &turn_id,
        &None,
        &cancellation,
        tool_fs_run_call(
            "tool-render",
            "/tools/render/surface",
            json!({
                "surfaceId": "test-dashboard",
                "title": "Test Dashboard",
                "kind": "html",
                "content": "<section><h1>Inline dashboard</h1><button data-lyra-action=\"refresh\">Refresh</button></section>",
                "height": 260,
                "summary": "A render surface produced by the native tool dispatch path."
            }),
        ),
    );
    assert!(
        rendered["content"]
            .as_str()
            .unwrap()
            .contains("Test Dashboard")
    );
    assert_eq!(rendered["raw"]["kind"].as_str(), Some("render_surface"));
    assert_eq!(
        rendered["raw"]["surfaceId"].as_str(),
        Some("test-dashboard")
    );
    assert_eq!(rendered["raw"]["format"].as_str(), Some("html"));
    assert_eq!(rendered["raw"]["height"].as_u64(), Some(260));
    assert_eq!(
        rendered
            .pointer("/raw/security/node")
            .and_then(Value::as_bool),
        Some(false)
    );
    let todos = execute_model_tool(
        &session_id,
        &turn_id,
        &None,
        &cancellation,
        tool_fs_run_call(
            "tool-todo",
            "/tools/todo/write",
            json!({
                "todos": [{
                    "id": "todo-test",
                    "content": "verify native tool surface",
                    "status": "in_progress"
                }]
            }),
        ),
    );
    assert!(
        todos["content"]
            .as_str()
            .unwrap()
            .contains("Updated 1 todos")
    );
    assert!(todos["changes"].as_array().is_some_and(|changes| {
        changes
            .iter()
            .any(|change| change["kind"] == "todo" && change["operation"] == "write")
    }));
    let read_session = backend
        .call_agent_method(
            "agent.session.read",
            json!({ "sessionId": session_id.clone() }),
        )
        .expect("read session");
    assert_eq!(
        read_session["todos"][0]["content"].as_str(),
        Some("verify native tool surface")
    );
    let todo_read = execute_model_tool(
        &session_id,
        &turn_id,
        &None,
        &cancellation,
        tool_fs_run_call("tool-todo-read", "/tools/todo/read", json!({})),
    );
    assert_eq!(todo_read["status"].as_str(), Some("completed"));
    assert_eq!(todo_read["toolPath"].as_str(), Some("/tools/todo/read"));
    assert!(
        todo_read["content"]
            .as_str()
            .expect("todo read content")
            .contains("verify native tool surface")
    );
    let outside = execute_model_tool(
        &session_id,
        &turn_id,
        &None,
        &cancellation,
        tool_fs_run_call(
            "tool-outside",
            "/tools/filesystem/read_file",
            json!({ "path": "/etc/passwd" }),
        ),
    );
    assert_eq!(
        outside.pointer("/error/code").and_then(Value::as_str),
        Some("permission_denied")
    );
    let agent_root = state()
        .lock()
        .expect("state lock")
        .root
        .parent()
        .expect("agent root")
        .to_path_buf();
    let lumen_dir = agent_root.join("lumen-evidence");
    fs::create_dir_all(&lumen_dir).expect("create lumen evidence dir");
    let lumen_path = lumen_dir.join("lumen-see-test-browser-tab-1.png");
    fs::write(&lumen_path, b"\x89PNG\r\n\x1a\nlyra-test-image").expect("write lumen image");
    let artifact = execute_model_tool(
        &session_id,
        &turn_id,
        &None,
        &cancellation,
        tool_fs_run_call(
            "tool-lumen-artifact",
            "/tools/filesystem/read_file",
            json!({ "path": lumen_path.display().to_string() }),
        ),
    );
    assert_eq!(artifact["raw"]["kind"], "lyra_artifact_read");
    assert_eq!(artifact["raw"]["mediaType"], "image/png");
    let lumen_path_text = lumen_path
        .canonicalize()
        .expect("canonical lumen path")
        .display()
        .to_string();
    assert_eq!(
        artifact
            .pointer("/raw/providerImage/path")
            .and_then(Value::as_str),
        Some(lumen_path_text.as_str())
    );
    assert!(
        artifact["content"]
            .as_str()
            .unwrap()
            .contains("will be attached to the next provider request")
    );
    let modules_root = agent_root.parent().expect("modules root");
    let terminal_memory_dir = modules_root
        .join("terminal")
        .join("terminal-memory")
        .join("sessions")
        .join("terminal-session-1")
        .join("outputs");
    fs::create_dir_all(&terminal_memory_dir).expect("create terminal memory dir");
    let terminal_output_path = terminal_memory_dir.join("session-output.txt");
    fs::write(&terminal_output_path, "terminal artifact output").expect("write terminal output");
    let terminal_artifact = execute_model_tool(
        &session_id,
        &turn_id,
        &None,
        &cancellation,
        tool_fs_run_call(
            "tool-terminal-artifact",
            "/tools/filesystem/read_file",
            json!({ "path": terminal_output_path.display().to_string() }),
        ),
    );
    assert_eq!(terminal_artifact["raw"]["kind"], "lyra_artifact_read");
    assert_eq!(terminal_artifact["raw"]["artifactKind"], "terminal_memory");
    assert!(
        terminal_artifact["content"]
            .as_str()
            .unwrap()
            .contains("terminal artifact output")
    );
}
