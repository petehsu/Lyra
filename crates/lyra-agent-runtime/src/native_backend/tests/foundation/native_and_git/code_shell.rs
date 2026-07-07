use super::*;

#[test]
fn codex_direct_tool_chain_runs_core_code_tools() {
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
    let read_handle = execute_model_tool(
        &session_id,
        &turn_id,
        &None,
        &cancellation,
        ModelToolCall {
            id: "tool-legacy-handle-read".to_string(),
            name: "tool_fs_run".to_string(),
            arguments: json!({
                "toolHandle": "read_file",
                "args": { "path": "src/lib.rs" },
            }),
        },
    );
    assert_eq!(read_handle["status"].as_str(), Some("completed"));
    assert_eq!(
        read_handle["toolPath"].as_str(),
        Some("/tools/filesystem/read_file")
    );
    assert!(
        read_handle["content"]
            .as_str()
            .is_some_and(|text| text.contains("hello"))
    );

    let read = execute_model_tool(
        &session_id,
        &turn_id,
        &None,
        &cancellation,
        tool_fs_run_call(
            "tool-read-source",
            "/tools/shell/run",
            json!({ "command": "sed -n '1,80p' src/lib.rs" }),
        ),
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
        tool_fs_run_call(
            "tool-rg-search",
            "/tools/shell/run",
            json!({ "command": "rg -n greeting src" }),
        ),
    );
    assert!(
        search["content"]
            .as_str()
            .is_some_and(|text| text.contains("src/lib.rs"))
    );

    let patch_session_id = session_id.clone();
    let patch_turn_id = turn_id.clone();
    let patch_cancellation = cancellation.clone();
    let patch_text = "*** Begin Patch\n*** Update File: src/lib.rs\n@@\n-pub fn greeting() -> &'static str { \"hello\" }\n+pub fn greeting() -> &'static str { \"hello lyra\" }\n*** End Patch\n";
    let patch_handle = thread::spawn(move || {
        execute_model_tool(
            &patch_session_id,
            &patch_turn_id,
            &None,
            &patch_cancellation,
            ModelToolCall {
                id: "tool-direct-patch".to_string(),
                name: "apply_patch".to_string(),
                arguments: json!({ "patch": patch_text }),
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
    assert_eq!(patch["activityKind"].as_str(), Some("edit"));
    assert!(
        patch["raw"]["changedFiles"]
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
        tool_fs_run_call(
            "tool-direct-shell",
            "/tools/shell/run",
            json!({ "command": "printf pinned" }),
        ),
    );
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
        tool_fs_run_call(
            "tool-git-status",
            "/tools/shell/run",
            json!({ "command": "git status --short" }),
        ),
    );
    assert!(
        status
            .pointer("/raw/stdout")
            .and_then(Value::as_str)
            .is_some_and(|text| text.contains("src/lib.rs"))
    );

    let diff = execute_model_tool(
        &session_id,
        &turn_id,
        &None,
        &cancellation,
        tool_fs_run_call(
            "tool-git-diff",
            "/tools/shell/run",
            json!({ "command": "git diff -- src/lib.rs" }),
        ),
    );
    assert!(
        diff.pointer("/raw/stdout")
            .and_then(Value::as_str)
            .is_some_and(|text| text.contains("hello lyra"))
    );
}

#[cfg(unix)]
#[test]
fn shell_run_cleans_up_background_descendant_pipe_leak() {
    let backend = LyraAgentBackend;
    let temp = tempfile::tempdir().expect("tempdir");
    let created = backend
        .call_agent_method(
            "agent.session.create",
            json!({ "title": "Shell Pipe Leak", "workingDir": temp.path().display().to_string() }),
        )
        .expect("create session");
    let session_id = created["id"].as_str().expect("session id").to_string();

    let started = Instant::now();
    let result = tool_shell_run(
        &session_id,
        "turn-shell-leak",
        "tool-shell-leak",
        &json!({ "command": "sleep 5 & printf done", "timeoutMs": 3000 }),
    )
    .expect("shell result should not hang on inherited pipes");

    assert!(
        started.elapsed() < Duration::from_millis(2500),
        "shell_run should not wait for background descendants that hold stdout open"
    );
    assert_eq!(result.raw["timedOut"].as_bool(), Some(false));
    assert_eq!(result.raw["processGroupTerminated"].as_bool(), Some(true));
    assert_eq!(result.raw["success"].as_bool(), Some(false));
    assert!(
        result.raw["stdout"]
            .as_str()
            .is_some_and(|stdout| stdout.contains("done"))
    );
    assert!(
        result
            .recommended_next_action
            .as_deref()
            .is_some_and(|action| action.contains("terminal session"))
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
    let grep = tool_code_grep_text(
        &session_id,
        &json!({ "query": "build_widget", "glob": "*.rs", "limit": 10 }),
    )
    .expect("grep text");
    assert!(grep.content.contains("src/lib.rs:2"));
    let regex = tool_code_grep_text(
        &session_id,
        &json!({ "query": "build_\\w+", "regex": true, "glob": "*.rs", "limit": 10 }),
    )
    .expect("regex grep");
    assert!(regex.content.contains("src/lib.rs:2"));
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
        json!({
            "markdown": "raw evidence ".repeat(4_000),
            "ok": true,
            "activityKind": "edit",
            "rendererHint": "edit",
            "changedFiles": [{ "path": "index.html", "operation": "write" }],
            "diffArtifactRef": { "artifactId": "diff-1", "kind": "diff" }
        }),
        None,
    );
    assert_eq!(budgeted_raw["raw"]["kind"], "tool_raw_ref");
    assert!(budgeted_raw["rawArtifactRef"].is_object());
    assert!(budgeted_raw["raw"]["artifactRef"].is_object());
    assert_eq!(budgeted_raw["activityKind"], "edit");
    assert_eq!(budgeted_raw["rendererHint"], "edit");
    assert_eq!(
        budgeted_raw["raw"]["changedFiles"][0]["path"].as_str(),
        Some("index.html")
    );
    assert_eq!(
        budgeted_raw["raw"]["diffArtifactRef"]["artifactId"].as_str(),
        Some("diff-1")
    );
}
