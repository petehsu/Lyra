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
fn shell_file_mutation_uses_the_same_investigation_gate_as_file_tools() {
    let backend = LyraAgentBackend;
    let temp = tempfile::tempdir().expect("tempdir");
    let created = backend
        .call_agent_method(
            "agent.session.create",
            json!({ "title": "Shell mutation gate", "workingDir": temp.path().display().to_string() }),
        )
        .expect("create session");
    let session_id = created["id"].as_str().expect("session id").to_string();
    let turn_id = "turn-shell-mutation";

    let blocked = tool_shell_run(
        &session_id,
        turn_id,
        "tool-shell-write-blocked",
        &json!({ "command": "printf changed > output.txt" }),
    )
    .expect_err("blind shell writes must be rejected");
    assert_eq!(blocked.code, "investigation_required_before_mutation");
    assert!(!temp.path().join("output.txt").exists());

    record_test_investigation(&session_id, turn_id, "tool-shell-write-reference");
    let written = tool_shell_run(
        &session_id,
        turn_id,
        "tool-shell-write-allowed",
        &json!({ "command": "printf changed > output.txt" }),
    )
    .expect("investigated shell mutation");
    assert_eq!(written.raw["commandKind"], "mutation");
    assert_eq!(
        fs::read_to_string(temp.path().join("output.txt")).expect("written output"),
        "changed"
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

#[test]
fn per_tool_char_budget_assigns_independent_limits() {
    // file_read: usize::MAX — has its own byte-level pre-truncation, skips
    // char-level truncation and artifact persistence entirely.
    assert_eq!(tool_content_char_budget("file", "read"), usize::MAX);
    // design read: 50 K chars — DESIGN.md max ~44 KB.
    assert_eq!(tool_content_char_budget("design", "read"), 50_000);
    // shell run: 32 K chars — already pre-truncated at 20 KB bytes.
    assert_eq!(tool_content_char_budget("shell", "run"), 32_000);
    // search / grep / glob / list: 32 K chars.
    assert_eq!(tool_content_char_budget("file", "grep"), 32_000);
    assert_eq!(tool_content_char_budget("file", "glob"), 32_000);
    assert_eq!(tool_content_char_budget("file", "list"), 32_000);
    assert_eq!(tool_content_char_budget("code", "search_text"), 32_000);
    // browser map/see/read: 8 K chars — compact structured snapshots.
    assert_eq!(tool_content_char_budget("lyra_lumen", "map"), 8_000);
    // default fallback: 16 K chars.
    assert_eq!(
        tool_content_char_budget("unknown", "action"),
        DEFAULT_TOOL_CONTENT_CHARS
    );
}

#[test]
fn persisted_output_tag_embeds_artifact_path() {
    let backend = LyraAgentBackend;
    let temp = tempfile::tempdir().expect("tempdir");
    let created = backend
        .call_agent_method(
            "agent.session.create",
            json!({ "title": "Persisted Output", "workingDir": temp.path().display().to_string() }),
        )
        .expect("create session");
    let session_id = created["id"].as_str().expect("session id").to_string();

    // Content just over the default 16 K char budget triggers truncation +
    // artifact persistence with a [persisted-output] tag.
    let oversized = "α".repeat(DEFAULT_TOOL_CONTENT_CHARS + 100);
    let output = budgeted_tool_output_with_budget(
        &session_id,
        "turn-persisted",
        "tool-persisted",
        oversized,
        json!({ "ok": true }),
        None,
        DEFAULT_TOOL_CONTENT_CHARS,
    );
    assert_eq!(output["truncated"], true);
    let content = output["content"].as_str().expect("content string");
    assert!(content.contains("[persisted-output]"));
    assert!(content.contains("Use read_file to access the full content."));
    // The artifact path should be embedded in the content text.
    let artifact_path = output["artifactRef"]["path"]
        .as_str()
        .expect("artifact path in JSON");
    assert!(content.contains(artifact_path));
    assert!(std::path::Path::new(artifact_path).exists());
}

#[test]
fn enforce_turn_tool_budget_spills_largest_output() {
    let backend = LyraAgentBackend;
    let temp = tempfile::tempdir().expect("tempdir");
    let created = backend
        .call_agent_method(
            "agent.session.create",
            json!({
                "title": "Turn Aggregate Budget",
                "workingDir": temp.path().display().to_string()
            }),
        )
        .expect("create session");
    let session_id = created["id"].as_str().expect("session id").to_string();

    // Three untruncated outputs whose combined size exceeds 200 K chars.
    // The largest (150 K) should be spilled first.
    let mut outputs = vec![
        json!({
            "content": "x".repeat(150_000),
            "truncated": false,
        }),
        json!({
            "content": "y".repeat(40_000),
            "truncated": false,
        }),
        json!({
            "content": "z".repeat(30_000),
            "truncated": false,
        }),
    ];
    let tool_call_ids: Vec<String> = (0..3).map(|i| format!("tool-turn-{i}")).collect();
    enforce_turn_tool_budget(&session_id, "turn-aggregate", &mut outputs, &tool_call_ids);

    // The largest output should now be truncated with a [persisted-output] tag.
    assert_eq!(outputs[0]["truncated"], true);
    let spilled_content = outputs[0]["content"].as_str().expect("spilled content");
    assert!(spilled_content.contains("[persisted-output]"));
    assert!(outputs[0]["artifactRef"].is_object());

    // The smaller outputs should remain untruncated.
    assert_eq!(outputs[1]["truncated"], false);
    assert_eq!(outputs[2]["truncated"], false);
}

#[test]
fn native_tool_input_preserves_user_action_parameter() {
    // design_reference accepts `action` as a user parameter (list vs read).
    // The Tool-FS target mapping's action is only a default when the user omits it.
    let input = native_tool_input("read", json!({"action": "list"}));
    assert_eq!(
        input["action"], "list",
        "user-supplied action must not be overwritten"
    );

    let input = native_tool_input("read", json!({}));
    assert_eq!(
        input["action"], "read",
        "default action applies when user omits it"
    );
}

#[test]
fn design_reference_lists_brands_in_content_and_reads_case_insensitively() {
    let workspace = tempfile::tempdir().expect("workspace");
    let created = LyraAgentBackend
        .call_agent_method(
            "agent.session.create",
            json!({ "title": "Design context", "workingDir": workspace.path().display().to_string() }),
        )
        .expect("create session");
    let session_id = created["id"].as_str().expect("session id").to_string();
    let list =
        tool_design_reference(&session_id, &json!({ "action": "all" })).expect("list designs");
    assert!(list.content.contains("design references available"));
    assert!(list.content.contains("- "));
    let brand = list.raw["references"][0]["brand"]
        .as_str()
        .expect("first brand");

    let read = tool_design_reference(
        &session_id,
        &json!({
            "action": "read",
            "brand": brand.to_ascii_uppercase(),
        }),
    )
    .expect("read design");
    assert_eq!(read.raw["brand"].as_str(), Some(brand));
    assert_eq!(
        read.raw["activeDesignContext"]["brand"].as_str(),
        Some(brand)
    );
    assert!(
        read.raw["activeDesignContext"]["documentHash"]
            .as_str()
            .is_some_and(|hash| hash.starts_with("sha256:"))
    );
    assert!(
        read.raw["activeDesignContext"]["cssVariables"]
            .as_str()
            .is_some_and(|variables| variables.contains(":root"))
    );
    assert!(
        read.raw["activeDesignContext"]["componentRules"]
            .as_str()
            .is_some_and(|rules| rules.contains("Components"))
    );
    assert!(!read.content.trim().is_empty());
    assert!(read.raw["bytes"].as_u64().is_some_and(|bytes| bytes > 0));
}

#[test]
fn active_design_context_requires_plan_citation_and_css_variables() {
    let workspace = tempfile::tempdir().expect("workspace");
    let created = LyraAgentBackend
        .call_agent_method(
            "agent.session.create",
            json!({ "title": "Design guard", "workingDir": workspace.path().display().to_string() }),
        )
        .expect("create session");
    let session_id = created["id"].as_str().expect("session id").to_string();
    let design =
        tool_design_reference(&session_id, &json!({ "action": "read", "brand": "cursor" }))
            .expect("activate cursor design");
    let document_hash = design.raw["activeDesignContext"]["documentHash"]
        .as_str()
        .expect("document hash");
    let css_variables = design.raw["activeDesignContext"]["cssVariables"]
        .as_str()
        .expect("css variables");
    let blocked = tool_file_write(
        &session_id,
        "turn-design-guard",
        "tool-raw-color",
        &json!({
            "path": "site.css",
            "content": "body { color: #123456; }",
            "overwrite": true,
        }),
    )
    .expect_err("raw color must be rejected");
    assert_eq!(blocked.code, "design_token_violation");
    let custom_variable = tool_file_write(
        &session_id,
        "turn-design-guard",
        "tool-custom-color-variable",
        &json!({
            "path": "site.css",
            "content": ":root { --brand-color: #123456; }\nbody { color: var(--brand-color); }",
            "overwrite": true,
        }),
    )
    .expect_err("custom color variables must be rejected");
    assert_eq!(custom_variable.code, "design_token_violation");
    tool_file_write(
        &session_id,
        "turn-design-guard",
        "tool-design-css",
        &json!({
            "path": "site.css",
            "content": format!("{css_variables}\nbody {{ color: var(--lyra-design-color-primary); border-radius: var(--lyra-design-radius-md); font-family: var(--lyra-design-type-body-md-font-family); }}"),
            "overwrite": true,
        }),
    )
    .expect("design variables are accepted");

    tool_plan_begin(
        &session_id,
        "turn-design-plan",
        &json!({ "title": "Build website" }),
    )
    .expect("start plan");
    record_tool_activity(
        &session_id,
        "turn-design-plan",
        tool_activity(
            "tool-design-plan-reference",
            "design",
            "Read design reference",
            "completed",
            json!({ "toolPath": "/tools/design/reference" }),
            Some(json!({ "content": "cursor design system inspected" })),
            &now(),
            Some(now()),
        ),
        "toolFinished",
    );
    tool_plan_write(
        &session_id,
        "turn-design-plan",
        &json!({ "markdown": "# Build\n\nImplement the landing page.", "replace": true }),
    )
    .expect("write incomplete plan");
    let missing = tool_plan_finalize(&session_id, "turn-design-plan", &json!({}))
        .expect_err("plan must cite active design context");
    assert_eq!(missing.code, "design_context_missing_from_plan");
    tool_plan_write(
        &session_id,
        "turn-design-plan",
        &json!({
            "markdown": format!("# Build\n\nReference evidence: Design system: cursor ({document_hash}).\n\nProduct facts: use only verified product content and omit unknown claims.\n\nArchitecture: keep page sections and shared components in maintainable module boundaries.\n\nVerification: run source checks and inspect desktop and narrow rendered layouts."),
            "replace": true,
        }),
    )
    .expect("write design-cited plan");
    tool_plan_finalize(&session_id, "turn-design-plan", &json!({}))
        .expect("finalize design-cited plan");
}

#[test]
fn active_design_context_requires_an_explicit_mixing_exemption() {
    let workspace = tempfile::tempdir().expect("workspace");
    let created = LyraAgentBackend
        .call_agent_method(
            "agent.session.create",
            json!({ "title": "Design mixing", "workingDir": workspace.path().display().to_string() }),
        )
        .expect("create session");
    let session_id = created["id"].as_str().expect("session id").to_string();
    tool_design_reference(&session_id, &json!({ "action": "read", "brand": "cursor" }))
        .expect("activate primary design");
    let missing =
        tool_design_reference(&session_id, &json!({ "action": "read", "brand": "framer" }))
            .expect_err("mixed reference requires an exemption");
    assert_eq!(missing.code, "design_system_mixing_requires_exemption");
    let mixed = tool_design_reference(
        &session_id,
        &json!({
            "action": "read",
            "brand": "framer",
            "mixingExemption": "Use Framer only for one documented product showcase.",
        }),
    )
    .expect("explicit exemption allows a second reference");
    assert_eq!(
        mixed.raw["activeDesignContext"]["mixingExemptions"][0]["brand"],
        "framer"
    );
    let document_hash = mixed.raw["activeDesignContext"]["documentHash"]
        .as_str()
        .expect("document hash");
    tool_plan_begin(
        &session_id,
        "turn-design-mixing-plan",
        &json!({ "title": "Build website" }),
    )
    .expect("start plan");
    record_tool_activity(
        &session_id,
        "turn-design-mixing-plan",
        tool_activity(
            "tool-design-mixing-reference",
            "design",
            "Read design reference",
            "completed",
            json!({ "toolPath": "/tools/design/reference" }),
            Some(json!({ "content": "mixed design references inspected" })),
            &now(),
            Some(now()),
        ),
        "toolFinished",
    );
    tool_plan_write(
        &session_id,
        "turn-design-mixing-plan",
        &json!({
            "markdown": format!("# Build\n\nDesign system: cursor ({document_hash})\n\nImplement the landing page."),
            "replace": true,
        }),
    )
    .expect("write plan missing mixing reason");
    let missing_reason = tool_plan_finalize(&session_id, "turn-design-mixing-plan", &json!({}))
        .expect_err("plan must explain the mixing exemption");
    assert_eq!(
        missing_reason.code,
        "design_system_exemption_missing_from_plan"
    );
    tool_plan_write(
        &session_id,
        "turn-design-mixing-plan",
        &json!({
            "markdown": format!("# Build\n\nReference evidence: Design system: cursor ({document_hash}).\n\nDesign-system exemption: Use Framer only for one documented product showcase.\n\nProduct facts: use only verified product content and omit unknown claims.\n\nArchitecture: keep the showcase and shared product UI in explicit component boundaries.\n\nVerification: run source checks and inspect desktop and narrow rendered layouts."),
            "replace": true,
        }),
    )
    .expect("write complete mixed-system plan");
    tool_plan_finalize(&session_id, "turn-design-mixing-plan", &json!({}))
        .expect("finalize mixed-system plan with documented exemption");
}
