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

#[test]
fn tool_fs_design_skills_and_mcp_are_discoverable_inspectable_and_runnable() {
    let backend = LyraAgentBackend;
    let created = backend
        .call_agent_method(
            "agent.session.create",
            json!({ "title": "Runtime Domain Tool-FS Test" }),
        )
        .expect("create session");
    let session_id = created["id"].as_str().expect("session id").to_string();
    let turn_id = start_test_runtime_turn(&session_id);
    let cancellation = Arc::new(AtomicBool::new(false));

    let design_directory = execute_model_tool(
        &session_id,
        &turn_id,
        &None,
        &cancellation,
        ModelToolCall {
            id: "tool-design-list".to_string(),
            name: "tool_fs_list".to_string(),
            arguments: json!({ "path": "/tools/design" }),
        },
    );
    assert_eq!(design_directory["status"].as_str(), Some("completed"));
    assert!(
        design_directory
            .pointer("/raw/tools")
            .and_then(Value::as_array)
            .is_some_and(|tools| tools.iter().any(|tool| {
                tool.get("path").and_then(Value::as_str) == Some("/tools/design/search_styles")
            }))
    );
    let design_manifest = execute_model_tool(
        &session_id,
        &turn_id,
        &None,
        &cancellation,
        ModelToolCall {
            id: "tool-design-inspect".to_string(),
            name: "tool_fs_inspect".to_string(),
            arguments: json!({ "path": "/tools/design/search_styles" }),
        },
    );
    assert_eq!(
        design_manifest
            .pointer("/raw/title")
            .and_then(Value::as_str),
        Some("Search design styles")
    );

    let skill_directory = execute_model_tool(
        &session_id,
        &turn_id,
        &None,
        &cancellation,
        ModelToolCall {
            id: "tool-skill-list".to_string(),
            name: "tool_fs_list".to_string(),
            arguments: json!({ "path": "/tools/skills" }),
        },
    );
    assert!(
        skill_directory
            .pointer("/raw/tools")
            .and_then(Value::as_array)
            .is_some_and(|tools| tools.iter().any(|tool| {
                tool.get("path").and_then(Value::as_str) == Some("/tools/skills/activate")
            }))
    );
    let skill_manifest = execute_model_tool(
        &session_id,
        &turn_id,
        &None,
        &cancellation,
        ModelToolCall {
            id: "tool-skill-inspect".to_string(),
            name: "tool_fs_inspect".to_string(),
            arguments: json!({ "path": "/tools/skills/inspect" }),
        },
    );
    assert_eq!(
        skill_manifest.pointer("/raw/title").and_then(Value::as_str),
        Some("Inspect skill")
    );
    assert!(
        skill_manifest
            .pointer("/raw/inputSchema/$id")
            .and_then(Value::as_str)
            .is_some_and(|schema_id| schema_id.contains("/tools/skills/inspect/input"))
    );

    let design_search = execute_model_tool(
        &session_id,
        &turn_id,
        &None,
        &cancellation,
        tool_fs_run_call(
            "tool-design-search",
            "/tools/design/search_styles",
            json!({ "query": "dashboard", "limit": 1 }),
        ),
    );
    assert_eq!(design_search["status"].as_str(), Some("completed"));
    assert_eq!(
        design_search["toolPath"].as_str(),
        Some("/tools/design/search_styles")
    );
    assert!(
        design_search["content"]
            .as_str()
            .expect("design content")
            .contains("Lyra design references")
    );

    let skill_activate = execute_model_tool(
        &session_id,
        &turn_id,
        &None,
        &cancellation,
        tool_fs_run_call(
            "tool-skill-activate",
            "/tools/skills/activate",
            json!({ "skillId": "lyra-design-research" }),
        ),
    );
    assert_eq!(skill_activate["status"].as_str(), Some("completed"));
    assert_eq!(
        skill_activate["raw"]["skill"]["active"].as_bool(),
        Some(true)
    );
    assert!(
        skill_activate["changes"]
            .as_array()
            .is_some_and(|changes| changes.iter().any(|change| {
                change["kind"] == "runtime"
                    && change["operation"] == "activate"
                    && change["path"] == "/tools/skills/activate"
            }))
    );
    assert!(
        state()
            .lock()
            .expect("state lock")
            .active_skills
            .contains("lyra-design-research")
    );

    let mcp_directory = execute_model_tool(
        &session_id,
        &turn_id,
        &None,
        &cancellation,
        ModelToolCall {
            id: "tool-mcp-list".to_string(),
            name: "tool_fs_list".to_string(),
            arguments: json!({ "path": "/tools/mcp" }),
        },
    );
    assert!(
        mcp_directory
            .pointer("/raw/tools")
            .and_then(Value::as_array)
            .is_some_and(|tools| tools.iter().any(|tool| {
                tool.get("path").and_then(Value::as_str) == Some("/tools/mcp/server_list")
            }))
    );
    let mcp_manifest = execute_model_tool(
        &session_id,
        &turn_id,
        &None,
        &cancellation,
        ModelToolCall {
            id: "tool-mcp-inspect".to_string(),
            name: "tool_fs_inspect".to_string(),
            arguments: json!({ "path": "/tools/mcp/server_list" }),
        },
    );
    assert_eq!(
        mcp_manifest.pointer("/raw/title").and_then(Value::as_str),
        Some("List MCP servers")
    );
    let mcp_list = execute_model_tool(
        &session_id,
        &turn_id,
        &None,
        &cancellation,
        tool_fs_run_call("tool-mcp-server-list", "/tools/mcp/server_list", json!({})),
    );
    assert_eq!(mcp_list["status"].as_str(), Some("failed"));
    assert_eq!(
        mcp_list.pointer("/error/code").and_then(Value::as_str),
        Some("no_configured_mcp_servers")
    );
    assert_eq!(
        mcp_list["notRunReason"].as_str(),
        Some("no_configured_mcp_servers")
    );
    assert_eq!(mcp_list["raw"]["available"].as_bool(), Some(false));
}

#[test]
fn native_file_tools_enforce_policy_budgets_edits_and_patch_artifacts() {
    let backend = LyraAgentBackend;
    let temp = tempfile::tempdir().expect("tempdir");
    fs::create_dir_all(temp.path().join("src")).expect("create src");
    fs::write(temp.path().join("src").join("main.rs"), "alpha\nbeta\n").expect("write main");
    fs::write(temp.path().join("dupes.txt"), "same\nsame\n").expect("write dupes");
    fs::write(temp.path().join("first.txt"), "one").expect("write first");
    fs::write(temp.path().join("second.txt"), "two").expect("write second");
    fs::write(temp.path().join("delete.txt"), "remove me").expect("write delete");
    fs::write(temp.path().join("large.txt"), "x".repeat(128)).expect("write large");
    let created = backend
        .call_agent_method(
            "agent.session.create",
            json!({ "title": "File Tool Coverage", "workingDir": temp.path().display().to_string() }),
        )
        .expect("create session");
    let session_id = created["id"].as_str().expect("session id").to_string();
    let turn_id = start_test_runtime_turn(&session_id);
    let cancellation = Arc::new(AtomicBool::new(false));
    let listed = execute_model_tool(
        &session_id,
        &turn_id,
        &None,
        &cancellation,
        tool_fs_run_call(
            "tool-list",
            "/tools/filesystem/list_files",
            json!({ "path": ".", "recursive": true }),
        ),
    );
    assert!(listed["content"].as_str().unwrap().contains("src/main.rs"));
    let missing = execute_model_tool(
        &session_id,
        &turn_id,
        &None,
        &cancellation,
        tool_fs_run_call(
            "tool-missing-file",
            "/tools/filesystem/read_file",
            json!({ "path": "missing.txt" }),
        ),
    );
    assert_eq!(
        missing.pointer("/error/code").and_then(Value::as_str),
        Some("path_not_found")
    );
    let large = execute_model_tool(
        &session_id,
        &turn_id,
        &None,
        &cancellation,
        tool_fs_run_call(
            "tool-large-read",
            "/tools/filesystem/read_file",
            json!({ "path": "large.txt", "maxBytes": 8 }),
        ),
    );
    assert_eq!(large["raw"]["truncated"], true);
    assert!(large["raw"]["artifactRef"].is_object());
    assert_eq!(
        large
            .pointer("/raw/artifactRef/kind")
            .and_then(Value::as_str),
        Some("raw_data")
    );
    let outside_write = tool_file_write(
        &session_id,
        &turn_id,
        "tool-outside-write",
        &json!({ "path": "../outside.txt", "content": "no", "overwrite": true }),
    )
    .expect_err("outside write should fail");
    assert_eq!(outside_write.code, "permission_denied");
    let unread_edit = tool_file_edit(
        &session_id,
        &turn_id,
        "tool-unread-edit",
        &json!({ "path": "src/main.rs", "oldString": "beta", "newString": "gamma" }),
    )
    .expect_err("strict edit requires read first");
    assert_eq!(unread_edit.code, "must_read_first");
    tool_file_read(
        &session_id,
        &turn_id,
        "tool-read-before-edit",
        &json!({ "path": "src/main.rs" }),
    )
    .expect("read before edit");
    let edit = tool_file_edit(
        &session_id,
        &turn_id,
        "tool-edit",
        &json!({ "path": "src/main.rs", "oldString": "beta", "newString": "gamma" }),
    )
    .expect("edit file");
    assert!(edit.raw["diffArtifactRef"].is_object());
    assert_eq!(
        edit.raw
            .pointer("/diffArtifactRef/kind")
            .and_then(Value::as_str),
        Some("diff")
    );
    assert!(edit.raw["changedFiles"][0]["beforeRef"].is_object());
    assert_eq!(
        edit.raw
            .pointer("/changedFiles/0/beforeRef/kind")
            .and_then(Value::as_str),
        Some("snapshot")
    );
    assert!(edit.raw["changedFiles"][0]["afterRef"].is_object());
    assert!(edit.raw["changedFiles"][0]["diffRef"].is_object());
    assert!(
        fs::read_to_string(temp.path().join("src").join("main.rs"))
            .expect("read edited")
            .contains("gamma")
    );
    tool_file_read(
        &session_id,
        &turn_id,
        "tool-read-before-duplicate-edit",
        &json!({ "path": "dupes.txt" }),
    )
    .expect("read dupes before duplicate edit");
    let duplicate = tool_file_edit(
        &session_id,
        &turn_id,
        "tool-duplicate-edit",
        &json!({ "path": "dupes.txt", "oldString": "same", "newString": "once" }),
    )
    .expect_err("duplicate oldString should fail");
    assert_eq!(duplicate.code, "edit_not_unique");
    let failed_multiedit = tool_file_multiedit(
        &session_id,
        &turn_id,
        "tool-multiedit-fail",
        &json!({
            "edits": [
                { "path": "first.txt", "oldString": "one", "newString": "ONE" },
                { "path": "second.txt", "oldString": "missing", "newString": "TWO" }
            ]
        }),
    )
    .expect_err("failed staged edit");
    assert_eq!(failed_multiedit.code, "edit_not_found");
    assert_eq!(
        fs::read_to_string(temp.path().join("first.txt")).expect("first unchanged"),
        "one"
    );
    let multiedit = tool_file_multiedit(
        &session_id,
        &turn_id,
        "tool-multiedit",
        &json!({
            "edits": [
                { "path": "first.txt", "oldString": "one", "newString": "ONE" },
                { "path": "second.txt", "oldString": "two", "newString": "TWO" }
            ]
        }),
    )
    .expect("successful multiedit");
    assert_eq!(
        multiedit.raw["changedFiles"].as_array().map(Vec::len),
        Some(2)
    );
    assert!(multiedit.raw["diffArtifactRef"].is_object());
    assert_eq!(
        multiedit
            .raw
            .pointer("/diffArtifactRef/kind")
            .and_then(Value::as_str),
        Some("diff")
    );
    assert!(
        multiedit.raw["changedFiles"]
            .as_array()
            .is_some_and(|files| files.iter().all(|file| {
                file["beforeRef"].is_object()
                    && file["afterRef"].is_object()
                    && file["diffRef"].is_object()
            }))
    );
    assert_eq!(
        fs::read_to_string(temp.path().join("second.txt")).expect("read second"),
        "TWO"
    );
    tool_file_read(
        &session_id,
        &turn_id,
        "tool-read-before-patch",
        &json!({ "path": "first.txt" }),
    )
    .expect("read before patch update");
    let patch = tool_apply_patch(
        &session_id,
        &turn_id,
        "tool-patch",
        &json!({
            "operations": [
                { "op": "add", "path": "added.txt", "content": "added" },
                { "op": "update", "path": "first.txt", "oldString": "ONE", "newString": "uno" },
                { "op": "move", "path": "second.txt", "newPath": "moved.txt" },
                { "op": "delete", "path": "delete.txt" }
            ]
        }),
    )
    .expect("apply patch");
    assert!(patch.raw["diffArtifactRef"].is_object());
    assert_eq!(
        patch
            .raw
            .pointer("/diffArtifactRef/kind")
            .and_then(Value::as_str),
        Some("diff")
    );
    assert!(
        patch.raw["changedFiles"]
            .as_array()
            .is_some_and(|files| files.iter().all(|file| {
                file["beforeRef"].is_object()
                    && file["afterRef"].is_object()
                    && file["diffRef"].is_object()
            }))
    );
    assert!(temp.path().join("moved.txt").exists());
    assert!(!temp.path().join("delete.txt").exists());
}

#[test]
fn git_tool_fs_mutations_emit_change_records_and_artifacts() {
    let backend = LyraAgentBackend;
    let temp = tempfile::tempdir().expect("tempdir");
    let root = temp.path();
    let git = |args: &[&str]| {
        let output = std::process::Command::new("git")
            .current_dir(root)
            .args(args)
            .output()
            .expect("run git");
        assert!(
            output.status.success(),
            "git {:?} failed\nstdout:\n{}\nstderr:\n{}",
            args,
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
    };
    git(&["init"]);
    git(&["config", "user.email", "lyra@example.test"]);
    git(&["config", "user.name", "Lyra Test"]);
    fs::write(root.join("tracked.txt"), "one\n").expect("write tracked");
    git(&["add", "tracked.txt"]);
    git(&["commit", "-m", "initial"]);
    fs::write(root.join("tracked.txt"), "two\n").expect("modify tracked");

    let created = backend
        .call_agent_method(
            "agent.session.create",
            json!({
                "title": "Git Tool-FS Coverage",
                "workingDir": root.display().to_string()
            }),
        )
        .expect("create session");
    let session_id = created["id"].as_str().expect("session id").to_string();
    let turn_id = start_test_runtime_turn(&session_id);
    let cancellation = Arc::new(AtomicBool::new(false));
    let status = execute_model_tool(
        &session_id,
        &turn_id,
        &None,
        &cancellation,
        tool_fs_run_call("tool-git-status", "/tools/git/status", json!({})),
    );
    assert_eq!(status["status"].as_str(), Some("completed"));
    assert_eq!(status["toolPath"].as_str(), Some("/tools/git/status"));
    assert!(
        status
            .pointer("/raw/summary/changed")
            .and_then(Value::as_u64)
            .is_some_and(|changed| changed >= 1)
    );
    let diff = execute_model_tool(
        &session_id,
        &turn_id,
        &None,
        &cancellation,
        tool_fs_run_call(
            "tool-git-diff",
            "/tools/git/diff",
            json!({ "path": "tracked.txt" }),
        ),
    );
    assert_eq!(diff["status"].as_str(), Some("completed"));
    assert_eq!(diff["toolPath"].as_str(), Some("/tools/git/diff"));
    assert!(
        diff.pointer("/raw/diff")
            .and_then(Value::as_str)
            .is_some_and(|text| text.contains("two"))
    );
    let log = execute_model_tool(
        &session_id,
        &turn_id,
        &None,
        &cancellation,
        tool_fs_run_call("tool-git-log", "/tools/git/log", json!({ "limit": 3 })),
    );
    assert_eq!(log["status"].as_str(), Some("completed"));
    assert_eq!(log["toolPath"].as_str(), Some("/tools/git/log"));
    assert!(
        log.pointer("/raw/commits")
            .and_then(Value::as_array)
            .is_some_and(|commits| !commits.is_empty())
    );
    let assert_git_change = |output: &Value, operation: &str, reversible: bool| {
        assert_eq!(output["status"].as_str(), Some("completed"));
        let expected_tool_path = format!("/tools/git/{operation}");
        assert_eq!(output["toolPath"], expected_tool_path);
        assert_eq!(
            output
                .pointer("/raw/toolOperation/path")
                .and_then(Value::as_str),
            Some(expected_tool_path.as_str())
        );
        assert_eq!(
            output
                .pointer("/raw/policyDecision/mode")
                .and_then(Value::as_str),
            Some("auto_approved")
        );
        assert!(output["raw"]["diffArtifactRef"].is_object());
        assert_eq!(
            output
                .pointer("/raw/diffArtifactRef/kind")
                .and_then(Value::as_str),
            Some("diff")
        );
        assert!(
            output["artifactRefs"]
                .as_array()
                .is_some_and(|refs| refs.len() >= 3 && refs.iter().all(Value::is_object))
        );
        let raw_change = &output["raw"]["changedFiles"][0];
        assert_eq!(raw_change["operation"].as_str(), Some(operation));
        assert_eq!(raw_change["path"].as_str(), Some("tracked.txt"));
        assert_eq!(raw_change["reversible"].as_bool(), Some(reversible));
        assert!(raw_change["beforeRef"].is_object());
        assert!(raw_change["afterRef"].is_object());
        assert!(raw_change["diffRef"].is_object());
        let change = &output["changes"][0];
        assert_eq!(change["kind"].as_str(), Some("git"));
        assert_eq!(change["operation"].as_str(), Some(operation));
        assert_eq!(change["path"].as_str(), Some("tracked.txt"));
        assert_eq!(change["reversible"].as_bool(), Some(reversible));
        assert!(change["beforeRef"].is_object());
        assert!(change["afterRef"].is_object());
        assert!(change["diffRef"].is_object());
    };

    let stage = execute_model_tool(
        &session_id,
        &turn_id,
        &None,
        &cancellation,
        tool_fs_run_call(
            "tool-git-stage",
            "/tools/git/stage",
            json!({ "path": "tracked.txt" }),
        ),
    );
    assert_git_change(&stage, "stage", true);

    let unstage = execute_model_tool(
        &session_id,
        &turn_id,
        &None,
        &cancellation,
        tool_fs_run_call(
            "tool-git-unstage",
            "/tools/git/unstage",
            json!({ "path": "tracked.txt" }),
        ),
    );
    assert_git_change(&unstage, "unstage", true);

    let discard = execute_model_tool(
        &session_id,
        &turn_id,
        &None,
        &cancellation,
        tool_fs_run_call(
            "tool-git-discard",
            "/tools/git/discard",
            json!({ "path": "tracked.txt" }),
        ),
    );
    assert_git_change(&discard, "discard", false);
    assert_eq!(
        fs::read_to_string(root.join("tracked.txt")).expect("read tracked"),
        "one\n"
    );
}

#[test]
fn pinned_handle_code_task_chain_runs_core_code_tools() {
    let backend = LyraAgentBackend;
    let temp = tempfile::tempdir().expect("tempdir");
    let root = temp.path();
    fs::create_dir_all(root.join("src")).expect("create src");
    fs::write(
        root.join("src").join("lib.rs"),
        "pub fn greeting() -> &'static str { \"hello\" }\n",
    )
    .expect("write source");
    let git = |args: &[&str]| {
        let output = std::process::Command::new("git")
            .current_dir(root)
            .args(args)
            .output()
            .expect("run git");
        assert!(
            output.status.success(),
            "git {:?} failed\nstdout:\n{}\nstderr:\n{}",
            args,
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
    };
    git(&["init"]);
    git(&["config", "user.email", "lyra@example.test"]);
    git(&["config", "user.name", "Lyra Test"]);
    git(&["add", "."]);
    git(&["commit", "-m", "initial"]);

    let created = backend
        .call_agent_method(
            "agent.session.create",
            json!({
                "title": "Pinned Handle Code Task",
                "workingDir": root.display().to_string()
            }),
        )
        .expect("create session");
    let session_id = created["id"].as_str().expect("session id").to_string();
    let turn_id = start_test_runtime_turn(&session_id);
    let cancellation = Arc::new(AtomicBool::new(false));
    let handle_call = |id: &str, tool_handle: &str, args: Value| ModelToolCall {
        id: id.to_string(),
        name: "tool_fs_run".to_string(),
        arguments: json!({
            "toolHandle": tool_handle,
            "args": args,
        }),
    };

    let read = execute_model_tool(
        &session_id,
        &turn_id,
        &None,
        &cancellation,
        handle_call(
            "tool-handle-read",
            "read_file",
            json!({ "path": "src/lib.rs" }),
        ),
    );
    assert_eq!(
        read["toolPath"].as_str(),
        Some("/tools/filesystem/read_file")
    );
    assert!(
        read["content"]
            .as_str()
            .is_some_and(|text| text.contains("hello"))
    );

    let search = execute_model_tool(
        &session_id,
        &turn_id,
        &None,
        &cancellation,
        handle_call(
            "tool-handle-search",
            "search_code",
            json!({ "query": "greeting", "path": "src", "limit": 10 }),
        ),
    );
    assert_eq!(search["toolPath"].as_str(), Some("/tools/code/search_code"));
    assert!(
        search["content"]
            .as_str()
            .is_some_and(|text| text.contains("src/lib.rs"))
    );

    let patch_session_id = session_id.clone();
    let patch_turn_id = turn_id.clone();
    let patch_cancellation = cancellation.clone();
    let patch_handle = thread::spawn(move || {
        execute_model_tool(
            &patch_session_id,
            &patch_turn_id,
            &None,
            &patch_cancellation,
            ModelToolCall {
                id: "tool-handle-patch".to_string(),
                name: "tool_fs_run".to_string(),
                arguments: json!({
                    "toolHandle": "apply_patch",
                    "args": {
                        "operations": [{
                            "op": "update",
                            "path": "src/lib.rs",
                            "oldString": "\"hello\"",
                            "newString": "\"hello lyra\""
                        }]
                    }
                }),
            },
        )
    });
    let permission_id = wait_for_pending_permission(&session_id);
    backend
        .call_agent_method(
            "agent.permission.respond",
            json!({ "sessionId": session_id.clone(), "permissionId": permission_id, "allowed": true }),
        )
        .expect("allow patch permission");
    let patch = patch_handle.join().expect("join patch");
    assert_eq!(
        patch["toolPath"].as_str(),
        Some("/tools/filesystem/apply_patch")
    );
    assert!(
        patch["changes"]
            .as_array()
            .is_some_and(|changes| !changes.is_empty())
    );
    assert!(
        fs::read_to_string(root.join("src").join("lib.rs"))
            .expect("read patched")
            .contains("hello lyra")
    );

    let shell = execute_model_tool(
        &session_id,
        &turn_id,
        &None,
        &cancellation,
        handle_call(
            "tool-handle-shell",
            "run_command",
            json!({ "command": "printf pinned", "workingDir": "." }),
        ),
    );
    assert_eq!(shell["toolPath"].as_str(), Some("/tools/shell/run_command"));
    assert!(
        shell["content"]
            .as_str()
            .is_some_and(|text| text.contains("pinned"))
    );

    let status = execute_model_tool(
        &session_id,
        &turn_id,
        &None,
        &cancellation,
        handle_call("tool-handle-git-status", "git_status", json!({})),
    );
    assert_eq!(status["toolPath"].as_str(), Some("/tools/git/status"));
    assert!(
        status
            .pointer("/raw/summary/changed")
            .and_then(Value::as_u64)
            .is_some_and(|changed| changed >= 1)
    );

    let diff = execute_model_tool(
        &session_id,
        &turn_id,
        &None,
        &cancellation,
        handle_call(
            "tool-handle-git-diff",
            "git_diff",
            json!({ "path": "src/lib.rs" }),
        ),
    );
    assert_eq!(diff["toolPath"].as_str(), Some("/tools/git/diff"));
    assert!(
        diff.pointer("/raw/diff")
            .and_then(Value::as_str)
            .is_some_and(|text| text.contains("hello lyra"))
    );
}

#[test]
fn native_shell_code_lsp_and_budget_guards_are_structured() {
    let backend = LyraAgentBackend;
    let temp = tempfile::tempdir().expect("tempdir");
    let outside = tempfile::tempdir().expect("outside tempdir");
    fs::create_dir_all(temp.path().join("src")).expect("create src");
    fs::write(
        temp.path().join("src").join("lib.rs"),
        "pub struct Widget;\npub fn build_widget() {}\n",
    )
    .expect("write source");
    let created = backend
        .call_agent_method(
            "agent.session.create",
            json!({ "title": "Shell Code Coverage", "workingDir": temp.path().display().to_string() }),
        )
        .expect("create session");
    let session_id = created["id"].as_str().expect("session id").to_string();
    let project_root = temp.path().canonicalize().expect("canonical project root");
    let outside_root = outside
        .path()
        .canonicalize()
        .expect("canonical outside root");
    let failed = tool_shell_run(
        &session_id,
        "turn-shell-direct",
        "tool-shell-failed",
        &json!({ "command": "false" }),
    )
    .expect("failed command still returns structured output");
    assert_eq!(failed.raw["success"], false);
    assert_eq!(failed.raw["exitCode"].as_i64(), Some(1));
    let timed_out = tool_shell_run(
        &session_id,
        "turn-shell-direct",
        "tool-shell-timeout",
        &json!({ "command": "sleep 1", "timeoutMs": 1 }),
    )
    .expect("timeout returns structured output");
    assert_eq!(timed_out.raw["timedOut"], true);
    let truncated = tool_shell_run(
        &session_id,
        "turn-shell-direct",
        "tool-shell-truncated",
        &json!({ "command": "printf 1234567890", "maxOutputBytes": 4 }),
    )
    .expect("truncated output");
    assert_eq!(truncated.raw["stdout"], "1234");
    assert_eq!(truncated.raw["stdoutTruncated"], true);
    let composite = tool_shell_run(
        &session_id,
        "turn-shell-direct",
        "tool-shell-composite",
        &json!({
            "command": "printf 'alpha\\nbeta\\n' | grep beta && printf done",
            "description": "Search piped output and print marker"
        }),
    )
    .expect("composite shell command");
    assert_eq!(composite.raw["success"], true);
    assert_eq!(composite.raw["commandKind"], "search");
    assert!(
        composite
            .raw
            .get("stdout")
            .and_then(Value::as_str)
            .is_some_and(|stdout| stdout.contains("beta") && stdout.contains("done"))
    );
    let dangerous = tool_shell_run(
        &session_id,
        "turn-shell-direct",
        "tool-shell-dangerous",
        &json!({ "command": "rm file.txt" }),
    )
    .expect_err("risk");
    assert_eq!(dangerous.code, "permission_required");
    let default_bound = tool_shell_run(
        &session_id,
        "turn-shell-direct",
        "tool-shell-default-bound",
        &json!({ "command": "pwd" }),
    )
    .expect("bound shell default cwd");
    assert_eq!(
        default_bound.raw["cwd"].as_str(),
        Some(project_root.to_str().expect("project root utf-8"))
    );
    let outside_bound = tool_shell_run(
        &session_id,
        "turn-shell-direct",
        "tool-shell-outside-bound",
        &json!({ "command": "pwd", "cwd": outside_root.display().to_string() }),
    )
    .expect("bound shell can run outside project");
    assert_eq!(
        outside_bound.raw["cwd"].as_str(),
        Some(outside_root.to_str().expect("outside root utf-8"))
    );
    let bad_cwd = tool_shell_run(
        &session_id,
        "turn-shell-direct",
        "tool-shell-bad-cwd",
        &json!({ "command": "pwd", "cwd": outside_root.join("missing").display().to_string() }),
    )
    .expect_err("missing cwd fails");
    assert_eq!(bad_cwd.code, "bad_cwd");
    let unbound = backend
        .call_agent_method("agent.session.create", json!({ "title": "Unbound Shell" }))
        .expect("create unbound session");
    let unbound_session_id = unbound["id"]
        .as_str()
        .expect("unbound session id")
        .to_string();
    let home = dirs::home_dir()
        .expect("home directory")
        .canonicalize()
        .expect("canonical home");
    let default_unbound = tool_shell_run(
        &unbound_session_id,
        "turn-shell-direct",
        "tool-shell-default-unbound",
        &json!({ "command": "pwd" }),
    )
    .expect("unbound shell default cwd");
    assert_eq!(
        default_unbound.raw["cwd"].as_str(),
        Some(home.to_str().expect("home utf-8"))
    );
    let outside_unbound = tool_shell_run(
        &unbound_session_id,
        "turn-shell-direct",
        "tool-shell-outside-unbound",
        &json!({ "command": "pwd", "cwd": outside_root.display().to_string() }),
    )
    .expect("unbound shell can use absolute cwd");
    assert_eq!(
        outside_unbound.raw["cwd"].as_str(),
        Some(outside_root.to_str().expect("outside root utf-8"))
    );
    let unbound_git_global = tool_shell_run(
        &unbound_session_id,
        "turn-shell-direct",
        "tool-shell-git-global-unbound",
        &json!({ "command": "git config --global --list >/dev/null 2>&1 || true" }),
    )
    .expect("unbound shell can run global git config check");
    assert_eq!(unbound_git_global.raw["success"].as_bool(), Some(true));
    let unbound_dangerous = tool_shell_run(
        &unbound_session_id,
        "turn-shell-direct",
        "tool-shell-dangerous-unbound",
        &json!({ "command": "rm file.txt", "cwd": outside_root.display().to_string() }),
    )
    .expect_err("unbound high-risk shell still needs permission");
    assert_eq!(unbound_dangerous.code, "permission_required");
    let text = tool_code_search_text(&session_id, &json!({ "query": "build_widget" }))
        .expect("text search");
    assert!(text.content.contains("src/lib.rs:2"));
    let graph = tool_code_graph_expand(&session_id, &json!({ "symbol": "Widget" }))
        .expect("graph fallback");
    assert_eq!(graph.raw["degraded"], true);
    let lsp =
        tool_lsp_query(&session_id, &json!({ "queryType": "diagnostics" })).expect("lsp fallback");
    assert_eq!(lsp.raw["available"], false);
    let budgeted = budgeted_tool_output(
        &session_id,
        "turn-budget",
        "tool-budget",
        "x".repeat(DEFAULT_TOOL_CONTENT_CHARS + 1),
        json!({ "ok": true }),
        Some("inspect artifact".to_string()),
    );
    assert_eq!(budgeted["truncated"], true);
    assert!(budgeted["artifactRef"].is_object());
    assert_eq!(budgeted["recommendedNextAction"], "inspect artifact");
    let (provider_content, evidence_ref) = guarded_tool_result_content(&budgeted, 8);
    assert!(provider_content.contains("Tool output truncated"));
    assert!(evidence_ref.is_some());
    let budgeted_raw = budgeted_tool_output(
        &session_id,
        "turn-budget",
        "tool-budget-raw",
        "short content".to_string(),
        json!({ "markdown": "raw evidence ".repeat(4_000), "ok": true }),
        None,
    );
    assert_eq!(budgeted_raw["raw"]["kind"], "tool_raw_ref");
    assert!(budgeted_raw["rawArtifactRef"].is_object());
    assert!(budgeted_raw["raw"]["artifactRef"].is_object());
}
#[test]
fn native_web_tools_parse_fetch_and_return_structured_failures() {
    let html = r#"
        <html>
          <head><title>Example Page</title></head>
          <body>
            <a rel="nofollow" href="https://example.com/result" class="result__a">Example Result</a>
            <a class="result__snippet">Snippet &amp; detail</a>
            <main>
              <p>alpha beta gamma delta epsilon zeta eta theta iota kappa lambda</p>
              <p>Read <a href="/next">Next evidence</a>.</p>
            </main>
          </body>
        </html>
    "#;
    let parsed = parse_duckduckgo_results(html, 5);
    assert_eq!(parsed[0]["title"], "Example Result");
    assert_eq!(parsed[0]["url"], "https://example.com/result");
    assert!(parsed[0]["snippet"].as_str().unwrap().contains("Snippet"));
    let url = serve_http_once("HTTP/1.1 200 OK", "text/html; charset=utf-8", html);
    let fetched = tool_web_fetch(
        "turn-web",
        "tool-web-fetch",
        &json!({ "url": url, "maxChars": 24, "extractText": true, "includeLinks": true, "allowPrivateNetwork": true }),
    )
    .expect("fetch local html");
    assert_eq!(fetched.raw["status"], 200);
    assert_eq!(fetched.raw["format"], "html");
    assert_eq!(fetched.raw["title"], "Example Page");
    assert_eq!(fetched.raw["truncated"], true);
    assert!(fetched.raw["artifactRef"].is_object());
    assert!(fetched.raw["rawArtifactRef"].is_object());
    assert!(fetched.raw["markdown"].is_null());
    assert_eq!(fetched.raw["kind"], "web_fetch_summary");
    assert!(fetched.content.contains("Title: Example Page"));
    assert!(fetched.raw["timing"]["totalMs"].as_u64().is_some());
    assert!(!fetched.content.contains("totalMs"));
    assert!(fetched.content.contains("alpha beta"));
    assert!(
        fetched.raw["links"]
            .as_array()
            .unwrap()
            .iter()
            .any(|link| link["url"].as_str().unwrap().ends_with("/next"))
    );
    let focused_url = serve_http_once(
        "HTTP/1.1 200 OK",
        "text/html; charset=utf-8",
        r#"<html><body>
            <nav>Remove me</nav>
            <main>
              <h1>Rust Topic</h1><p>Ownership and borrowing details.</p>
              <p>Fruit apples oranges.</p>
            </main>
          </body></html>"#,
    );
    let focused = tool_web_fetch(
        "turn-web",
        "tool-web-focused",
        &json!({
            "url": focused_url,
            "targetSelector": "main",
            "removeSelector": "nav",
            "queryFocus": "ownership",
            "chunking": { "mode": "block", "maxCharsPerChunk": 48 },
            "includeDebugTrace": true,
            "allowPrivateNetwork": true
        }),
    )
    .expect("focused fetch");
    assert!(focused.content.contains("Ownership"));
    assert!(!focused.content.contains("Remove me"));
    assert!(focused.raw["counts"]["chunks"].as_u64().unwrap_or(0) >= 2);
    assert!(focused.raw["rawArtifactRef"].is_object());
    assert!(focused.raw["debugTrace"].is_null());
    assert!(!focused.content.contains("debugTrace"));

    let pdf_url = serve_http_bytes_once(
        "HTTP/1.1 200 OK",
        "application/pdf",
        &build_simple_pdf("Runtime PDF text"),
    );
    let pdf = tool_web_fetch(
        "turn-web",
        "tool-web-pdf",
        &json!({ "url": pdf_url, "allowPrivateNetwork": true }),
    )
    .expect("pdf fetch");
    assert_eq!(pdf.raw["format"], "pdf");
    assert!(pdf.content.contains("Runtime PDF text"));

    let mut png = vec![0u8; 24];
    png[..8].copy_from_slice(b"\x89PNG\r\n\x1A\n");
    png[16..20].copy_from_slice(&16u32.to_be_bytes());
    png[20..24].copy_from_slice(&8u32.to_be_bytes());
    let image_url = serve_http_bytes_once("HTTP/1.1 200 OK", "image/png", &png);
    let image = tool_web_fetch(
        "turn-web",
        "tool-web-image",
        &json!({ "url": image_url, "allowPrivateNetwork": true }),
    )
    .expect("image fetch");
    assert_eq!(image.raw["format"], "image");
    assert!(image.content.contains("Dimensions: 16 x 8"));
    assert!(
        image.raw["warnings"]
            .as_array()
            .unwrap()
            .iter()
            .any(|warning| warning["code"] == "ocr_recommended")
    );
    let image_without_ocr_url = serve_http_bytes_once("HTTP/1.1 200 OK", "image/png", &png);
    let image_without_ocr = tool_web_fetch(
        "turn-web",
        "tool-web-image-no-ocr",
        &json!({
            "url": image_without_ocr_url,
            "allowPrivateNetwork": true,
            "useOcr": false,
            "useCaption": false
        }),
    )
    .expect("image fetch without OCR/caption");
    assert!(
        !image_without_ocr.raw["warnings"]
            .as_array()
            .unwrap()
            .iter()
            .any(|warning| matches!(
                warning["code"].as_str(),
                Some("ocr_recommended" | "ocr_unavailable" | "caption_unavailable")
            ))
    );

    let final_url = serve_http_once(
        "HTTP/1.1 200 OK",
        "text/html; charset=utf-8",
        "<html><head><title>Redirected</title></head><body><main>redirect body</main></body></html>",
    );
    let redirect_url = serve_http_redirect_once(&final_url);
    let redirected = tool_web_fetch(
        "turn-web",
        "tool-web-redirect",
        &json!({ "url": redirect_url, "allowPrivateNetwork": true }),
    )
    .expect("redirect fetch");
    assert_eq!(
        redirected.raw["finalUrl"].as_str(),
        Some(final_url.as_str())
    );
    assert_eq!(redirected.raw["title"].as_str(), Some("Redirected"));

    let private_blocked = tool_web_fetch(
        "turn-web",
        "tool-web-private-blocked",
        &json!({ "url": "http://127.0.0.1:9/private" }),
    )
    .expect_err("private network should be blocked by default");
    assert_eq!(private_blocked.code, "network_failed");
    assert!(private_blocked.message.contains("private"));

    let forbidden_url = serve_http_once(
        "HTTP/1.1 403 Forbidden",
        "text/html; charset=utf-8",
        "blocked",
    );
    let forbidden = tool_web_fetch(
        "turn-web",
        "tool-web-forbidden",
        &json!({ "url": forbidden_url, "allowPrivateNetwork": true }),
    )
    .expect_err("forbidden response");
    assert_eq!(forbidden.code, "permission_denied");
    assert_eq!(forbidden.detail.unwrap()["status"], 403);
    let oversized_url = serve_http_once(
        "HTTP/1.1 200 OK",
        "text/html; charset=utf-8",
        "<html><body><main>this body is intentionally larger than max bytes</main></body></html>",
    );
    let oversized = tool_web_fetch(
        "turn-web",
        "tool-web-oversized",
        &json!({ "url": oversized_url, "maxBytes": 8, "allowPrivateNetwork": true }),
    )
    .expect_err("oversized response");
    assert_eq!(oversized.code, "network_failed");
    let oversized_detail = oversized.detail.expect("oversized detail");
    assert_eq!(oversized_detail["status"], 200);
    assert!(
        oversized
            .message
            .contains("response body exceeded maxBytes limit")
    );
    let binary_url = serve_http_bytes_once(
        "HTTP/1.1 200 OK",
        "application/octet-stream",
        &[0, 159, 146, 150],
    );
    let binary = tool_web_fetch(
        "turn-web",
        "tool-web-binary",
        &json!({ "url": binary_url, "allowPrivateNetwork": true }),
    )
    .expect_err("binary response");
    assert_eq!(binary.code, "unsupported_content_type");
    let binary_detail = binary.detail.unwrap();
    assert_eq!(binary_detail["mimeType"], "application/octet-stream");
    assert_eq!(
        binary_detail["warnings"][0]["code"].as_str(),
        Some("unsupported_format")
    );
}

#[test]
fn native_web_research_deep_reads_mocked_search_results() {
    let success_url = serve_http_once(
        "HTTP/1.1 200 OK",
        "text/html; charset=utf-8",
        r#"<html><head><title>Ownership Guide</title></head><body>
            <main>
              <h1>Rust ownership</h1>
              <p>Ownership borrowing lifetimes are the core topic for this result.</p>
              <p>Other unrelated fruit words should matter less.</p>
            </main>
        </body></html>"#,
    );
    let failed_url = serve_http_bytes_once(
        "HTTP/1.1 200 OK",
        "application/octet-stream",
        &[0, 159, 146, 150],
    );
    let results = vec![
        json!({
            "title": "Ownership Guide",
            "url": success_url,
            "snippet": "Rust ownership and borrowing guide."
        }),
        json!({
            "title": "Binary Result",
            "url": failed_url,
            "snippet": "This result cannot be rendered."
        }),
    ];
    let researched = build_web_research_result("ownership borrowing", 200, results, 2, 800, true);
    assert!(researched.content.contains("Research: ownership borrowing"));
    assert!(researched.content.contains("## Deep Reads"));
    assert!(researched.content.contains("Ownership borrowing lifetimes"));
    assert!(researched.content.contains("## Failed Reads"));
    assert_eq!(researched.raw["readTopN"], 2);
    assert_eq!(researched.raw["readResults"].as_array().unwrap().len(), 1);
    assert_eq!(researched.raw["failedReads"].as_array().unwrap().len(), 1);
    assert_eq!(researched.raw["sources"].as_array().unwrap().len(), 2);
    assert!(
        researched.raw["readResults"][0]["fitMarkdown"]
            .as_str()
            .unwrap()
            .contains("Ownership")
    );
    assert!(
        researched
            .recommended_next_action
            .as_deref()
            .unwrap_or("")
            .contains("web_fetch")
    );

    let empty = build_web_research_result("empty query", 200, Vec::new(), 3, 800, true);
    assert!(empty.content.contains("No structured search results"));
    assert!(
        empty
            .recommended_next_action
            .as_deref()
            .unwrap_or("")
            .contains("Refine")
    );
}

#[test]
fn native_web_fetch_browser_engine_uses_rendered_snapshot() {
    let payloads = Arc::new(Mutex::new(Vec::<Value>::new()));
    let payloads_for_dispatch = payloads.clone();
    let dispatcher: Arc<HostCapabilityDispatcher> = Arc::new(move |method, payload| {
        assert_eq!(method, "workbench.browser.readRenderedSnapshot");
        let payload: Value = serde_json::from_str(&payload).expect("payload json");
        payloads_for_dispatch
            .lock()
            .expect("payload lock")
            .push(payload);
        Ok(serde_json::to_string(&json!({
            "ok": true,
            "kind": "workbenchBrowserRenderedSnapshot",
            "tabId": "browser-tab-1",
            "finalUrl": "https://example.test/app",
            "title": "Rendered Browser App",
            "html": "<html><head><title>Rendered Browser App</title></head><body><main id=\"app\"><h1>Rendered Browser App</h1><p>Dynamic browser content loaded.</p></main></body></html>",
            "bodyText": "Rendered Browser App Dynamic browser content loaded.",
            "selectedElement": {
                "selector": "#app",
                "html": "<main id=\"app\">Dynamic browser content loaded.</main>",
                "text": "Dynamic browser content loaded."
            },
            "media": [{
                "kind": "video",
                "url": "https://example.test/demo.mp4",
                "title": "Demo video",
                "mimeType": "video/mp4",
                "width": 640,
                "height": 360
            }],
            "viewport": { "width": 390, "height": 844, "deviceScaleFactor": 3 },
            "warnings": [{ "code": "browser_wait_timeout", "message": "minor wait warning" }],
            "screenshot": {
                "mimeType": "image/png",
                "imageBase64": "AAAA",
                "width": 1,
                "height": 1,
                "visibleOnly": true
            },
            "pageshot": {
                "mimeType": "image/png",
                "imageBase64": "BBBB",
                "width": 390,
                "height": 1200,
                "visibleOnly": false
            }
        }))
        .expect("json"))
    });

    let fetched = tool_web_fetch_with_browser(
        "turn-web",
        "tool-web-browser",
        &json!({
            "url": "https://example.test/app",
            "engine": "browser",
            "waitForSelector": "#app",
            "browserMode": "newTab",
            "includeScreenshot": true,
            "targetSelector": "#app",
            "viewport": { "width": 390, "height": 844, "deviceScaleFactor": 3 },
            "mobile": true,
            "includeIframes": true,
            "includeShadowDom": true,
            "includePageshot": true,
            "includeMedia": true
        }),
        Some(&dispatcher),
    )
    .expect("browser fetch");

    assert_eq!(fetched.raw["engineUsed"], "browser");
    assert!(fetched.content.contains("Dynamic browser content"));
    assert_eq!(fetched.raw["browser"]["tabId"], "browser-tab-1");
    assert!(fetched.raw["screenshotArtifactRef"].is_object());
    assert!(fetched.raw["pageshotArtifactRef"].is_object());
    assert!(fetched.raw["browser"]["screenshot"].is_null());
    assert!(fetched.raw["browser"]["pageshot"].is_null());
    assert_eq!(
        fetched.raw["browser"]["selectedElement"]["selector"],
        "#app"
    );
    assert_eq!(fetched.raw["browser"]["viewport"]["width"], 390);
    assert_eq!(
        fetched.raw["media"][0]["url"],
        "https://example.test/demo.mp4"
    );
    assert!(
        fetched.raw["browserWarnings"]
            .as_array()
            .is_some_and(|warnings| !warnings.is_empty())
    );
    let first_payload = payloads.lock().expect("payload lock")[0].clone();
    assert_eq!(first_payload["waitForSelector"], "#app");
    assert_eq!(first_payload["browserMode"], "newTab");
    assert_eq!(first_payload["includeScreenshot"], true);
    assert_eq!(first_payload["targetSelector"], "#app");
    assert_eq!(first_payload["viewport"]["width"], 390);
    assert_eq!(first_payload["mobile"], true);
    assert_eq!(first_payload["includeIframes"], true);
    assert_eq!(first_payload["includeShadowDom"], true);
    assert_eq!(first_payload["includePageshot"], true);
    assert_eq!(first_payload["includeMedia"], true);
}

#[test]
fn native_web_fetch_include_media_defaults_to_summary_footer() {
    let url = serve_http_once(
        "HTTP/1.1 200 OK",
        "text/html; charset=utf-8",
        r#"<html><head><title>Media Page</title></head><body><main>
            <p>Static media page with enough readable text.</p>
            <video src="/movie.mp4" title="Demo video"></video>
        </main></body></html>"#,
    );

    let fetched = tool_web_fetch(
        "turn-web",
        "tool-web-media",
        &json!({
            "url": url,
            "engine": "http",
            "includeMedia": true,
            "allowPrivateNetwork": true
        }),
    )
    .expect("media fetch");

    assert!(
        fetched.raw["media"][0]["url"]
            .as_str()
            .is_some_and(|url| url.ends_with("/movie.mp4"))
    );
    assert!(fetched.content.contains("## Media"));
}

#[test]
fn native_web_fetch_retain_media_none_keeps_raw_media_without_footer() {
    let url = serve_http_once(
        "HTTP/1.1 200 OK",
        "text/html; charset=utf-8",
        r#"<html><head><title>Media Page</title></head><body><main>
            <p>Static media page with enough readable text.</p>
            <iframe src="https://www.youtube.com/embed/abc123" title="Demo clip"></iframe>
        </main></body></html>"#,
    );

    let fetched = tool_web_fetch(
        "turn-web",
        "tool-web-media-none",
        &json!({
            "url": url,
            "engine": "http",
            "includeMedia": true,
            "retainMedia": "none",
            "allowPrivateNetwork": true
        }),
    )
    .expect("media fetch");

    assert_eq!(
        fetched.raw["media"][0]["url"],
        "https://www.youtube.com/watch?v=abc123"
    );
    assert!(!fetched.content.contains("## Media"));
}

#[test]
fn native_web_fetch_markdown_citation_options_are_mapped() {
    let url = serve_http_once(
        "HTTP/1.1 200 OK",
        "text/html; charset=utf-8",
        r#"<html><head><title>Markdown Options</title></head><body><main>
            <h1>Markdown Options</h1>
            <p>Read <a href="https://example.test/docs">docs</a> and <mark onclick="bad()">highlight</mark>.</p>
        </main></body></html>"#,
    );

    let fetched = tool_web_fetch(
        "turn-web",
        "tool-web-markdown-options",
        &json!({
            "url": url,
            "engine": "http",
            "headingStyle": "setext",
            "citationFormat": "angle",
            "preserveHtmlTags": ["mark"],
            "allowPrivateNetwork": true
        }),
    )
    .expect("markdown options fetch");

    let markdown = fetched.content.as_str();
    assert!(markdown.contains("Markdown Options\n================"));
    assert!(markdown.contains("[docs](https://example.test/docs)⟨1⟩"));
    assert!(markdown.contains("⟨1⟩ docs — https://example.test/docs"));
    assert!(markdown.contains("<mark>highlight</mark>"));
    assert!(!markdown.contains("onclick"));
}

#[test]
fn native_web_fetch_http_engine_does_not_call_browser_dispatcher() {
    let url = serve_http_once(
        "HTTP/1.1 200 OK",
        "text/html; charset=utf-8",
        "<html><head><title>HTTP Only</title></head><body><main>static http body with enough readable words for the test</main></body></html>",
    );
    let dispatcher: Arc<HostCapabilityDispatcher> = Arc::new(|method, _payload| {
        panic!("unexpected browser host method {method}");
    });

    let fetched = tool_web_fetch_with_browser(
        "turn-web",
        "tool-web-http-only",
        &json!({ "url": url, "engine": "http", "allowPrivateNetwork": true }),
        Some(&dispatcher),
    )
    .expect("http fetch");

    assert_eq!(fetched.raw["engineUsed"], "http");
    assert_eq!(fetched.raw["title"], "HTTP Only");
}

#[test]
fn native_web_fetch_auto_falls_back_for_spa_shell() {
    let url = serve_http_once(
        "HTTP/1.1 200 OK",
        "text/html; charset=utf-8",
        r#"<html><head><title>Shell</title></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>"#,
    );
    let final_url = url.clone();
    let dispatcher: Arc<HostCapabilityDispatcher> = Arc::new(move |method, _payload| {
        assert_eq!(method, "workbench.browser.readRenderedSnapshot");
        Ok(serde_json::to_string(&json!({
            "ok": true,
            "kind": "workbenchBrowserRenderedSnapshot",
            "tabId": "browser-tab-2",
            "finalUrl": final_url,
            "title": "Rendered Shell",
            "html": "<html><head><title>Rendered Shell</title></head><body><main><p>SPA rendered evidence text.</p></main></body></html>",
            "bodyText": "SPA rendered evidence text.",
            "warnings": []
        }))
        .expect("json"))
    });

    let fetched = tool_web_fetch_with_browser(
        "turn-web",
        "tool-web-auto-browser",
        &json!({ "url": url, "allowPrivateNetwork": true }),
        Some(&dispatcher),
    )
    .expect("auto browser fetch");

    assert_eq!(fetched.raw["engineUsed"], "browser");
    assert!(fetched.content.contains("SPA rendered evidence"));
}

#[test]
fn native_web_fetch_auto_falls_back_for_forbidden_http_when_browser_available() {
    let url = serve_http_once(
        "HTTP/1.1 403 Forbidden",
        "text/html; charset=utf-8",
        "blocked",
    );
    let final_url = url.clone();
    let dispatcher: Arc<HostCapabilityDispatcher> = Arc::new(move |method, _payload| {
        assert_eq!(method, "workbench.browser.readRenderedSnapshot");
        Ok(serde_json::to_string(&json!({
            "ok": true,
            "kind": "workbenchBrowserRenderedSnapshot",
            "tabId": "browser-auth-tab",
            "finalUrl": final_url,
            "title": "Authorized Page",
            "html": "<html><head><title>Authorized Page</title></head><body><main><p>Browser session unlocked the blocked page.</p></main></body></html>",
            "bodyText": "Browser session unlocked the blocked page.",
            "warnings": []
        }))
        .expect("json"))
    });

    let fetched = tool_web_fetch_with_browser(
        "turn-web",
        "tool-web-auto-forbidden",
        &json!({ "url": url, "engine": "auto", "allowPrivateNetwork": true }),
        Some(&dispatcher),
    )
    .expect("browser fallback for forbidden page");

    assert_eq!(fetched.raw["engineUsed"], "browser");
    assert!(fetched.content.contains("unlocked the blocked page"));
}

#[test]
fn native_web_fetch_browser_unavailable_and_auto_http_recommendation() {
    let err = tool_web_fetch_with_browser(
        "turn-web",
        "tool-web-browser-missing",
        &json!({ "url": "https://example.test/app", "engine": "browser" }),
        None,
    )
    .expect_err("browser unavailable");
    assert_eq!(err.code, "browser_unavailable");

    let url = serve_http_once(
        "HTTP/1.1 200 OK",
        "text/html; charset=utf-8",
        r#"<html><body><div id="root"></div><script src="/bundle.js"></script></body></html>"#,
    );
    let fetched = tool_web_fetch_with_browser(
        "turn-web",
        "tool-web-auto-no-browser",
        &json!({ "url": url, "allowPrivateNetwork": true }),
        None,
    )
    .expect("auto http fallback");
    assert_eq!(fetched.raw["engineUsed"], "http");
    assert!(
        fetched
            .recommended_next_action
            .as_deref()
            .unwrap_or("")
            .contains("browser")
    );
}

#[test]
fn tool_fs_web_fetch_browser_engine_uses_host_dispatcher() {
    let backend = LyraAgentBackend;
    let created = backend
        .call_agent_method(
            "agent.session.create",
            json!({ "title": "Tool-FS Browser Fetch" }),
        )
        .expect("create session");
    let session_id = created["id"].as_str().expect("session id").to_string();
    let turn_id = start_test_runtime_turn(&session_id);
    let cancellation = Arc::new(AtomicBool::new(false));
    let dispatcher: Arc<HostCapabilityDispatcher> = Arc::new(move |method, payload| {
        assert_eq!(method, "workbench.browser.readRenderedSnapshot");
        let payload: Value = serde_json::from_str(&payload).expect("payload json");
        assert_eq!(payload["browserMode"], "matchingOrNewTab");
        Ok(serde_json::to_string(&json!({
            "ok": true,
            "kind": "workbenchBrowserRenderedSnapshot",
            "tabId": "browser-tab-tool-fs",
            "finalUrl": "https://example.test/tool-fs",
            "title": "Tool FS Rendered",
            "html": "<html><head><title>Tool FS Rendered</title></head><body><main>tool fs browser rendered text</main></body></html>",
            "bodyText": "tool fs browser rendered text",
            "warnings": []
        }))
        .expect("json"))
    });

    let output = execute_model_tool(
        &session_id,
        &turn_id,
        &Some(dispatcher),
        &cancellation,
        tool_fs_run_call(
            "tool-fs-web-browser-fetch",
            "/tools/web/fetch",
            json!({
                "url": "https://example.test/tool-fs",
                "engine": "browser"
            }),
        ),
    );

    assert_eq!(output["status"].as_str(), Some("completed"));
    assert_eq!(output["toolPath"].as_str(), Some("/tools/web/fetch"));
    assert_eq!(output["raw"]["engineUsed"], "browser");
    assert!(
        output["content"]
            .as_str()
            .expect("content")
            .contains("tool fs browser rendered text")
    );
}

#[test]
fn tool_fs_web_and_network_read_tools_are_runnable() {
    let backend = LyraAgentBackend;
    let created = backend
        .call_agent_method(
            "agent.session.create",
            json!({ "title": "Tool-FS Web Network Coverage" }),
        )
        .expect("create session");
    let session_id = created["id"].as_str().expect("session id").to_string();
    let turn_id = start_test_runtime_turn(&session_id);
    let cancellation = Arc::new(AtomicBool::new(false));
    let url = serve_http_once(
        "HTTP/1.1 200 OK",
        "text/html; charset=utf-8",
        "<html><head><title>Tool FS Web</title></head><body>local web evidence</body></html>",
    );
    let fetched = execute_model_tool(
        &session_id,
        &turn_id,
        &None,
        &cancellation,
        tool_fs_run_call(
            "tool-fs-web-fetch",
            "/tools/web/fetch",
            json!({
                "url": url,
                "maxChars": 128,
                "extractText": true,
                "allowPrivateNetwork": true
            }),
        ),
    );
    assert_eq!(fetched["status"].as_str(), Some("completed"));
    assert_eq!(fetched["toolPath"].as_str(), Some("/tools/web/fetch"));
    assert_eq!(fetched["raw"]["title"].as_str(), Some("Tool FS Web"));
    assert!(
        fetched["content"]
            .as_str()
            .expect("web fetch content")
            .contains("Tool FS Web")
    );

    let network = execute_model_tool(
        &session_id,
        &turn_id,
        &None,
        &cancellation,
        tool_fs_run_call("tool-fs-network", "/tools/network/status", json!({})),
    );
    assert_eq!(network["status"].as_str(), Some("completed"));
    assert_eq!(network["toolPath"].as_str(), Some("/tools/network/status"));
    assert_eq!(
        network
            .pointer("/raw/nativeHttpClient/implementation")
            .and_then(Value::as_str),
        Some("reqwest")
    );
}
