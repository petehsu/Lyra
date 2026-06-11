use super::*;

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
