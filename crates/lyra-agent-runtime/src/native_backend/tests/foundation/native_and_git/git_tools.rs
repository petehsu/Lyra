use super::*;

#[test]
fn git_tool_fs_paths_are_removed_and_git_checks_use_exec_command() {
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
                "title": "Git Codex Tool Coverage",
                "workingDir": root.display().to_string()
            }),
        )
        .expect("create session");
    let session_id = created["id"].as_str().expect("session id").to_string();
    let turn_id = start_test_runtime_turn(&session_id);
    let cancellation = CancellationToken::new();

    for path in [
        "/tools/git/status",
        "/tools/git/diff",
        "/tools/git/log",
        "/tools/git/stage",
        "/tools/git/unstage",
        "/tools/git/discard",
    ] {
        let output = execute_model_tool_sync(
            &session_id,
            &turn_id,
            &None,
            &cancellation,
            tool_fs_run_call("tool-legacy-git", path, json!({ "path": "tracked.txt" })),
        );
        assert_eq!(
            output.pointer("/error/code").and_then(Value::as_str),
            Some("tool_not_found"),
            "{path}"
        );
    }

    let status = execute_model_tool_sync(
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
            .is_some_and(|text| text.contains("tracked.txt"))
    );

    let diff = execute_model_tool_sync(
        &session_id,
        &turn_id,
        &None,
        &cancellation,
        tool_fs_run_call(
            "tool-git-diff",
            "/tools/shell/run",
            json!({ "command": "git diff -- tracked.txt" }),
        ),
    );
    assert!(
        diff.pointer("/raw/stdout")
            .and_then(Value::as_str)
            .is_some_and(|text| text.contains("two"))
    );

    let log = execute_model_tool_sync(
        &session_id,
        &turn_id,
        &None,
        &cancellation,
        tool_fs_run_call(
            "tool-git-log",
            "/tools/shell/run",
            json!({ "command": "git log --oneline -3" }),
        ),
    );
    assert!(
        log.pointer("/raw/stdout")
            .and_then(Value::as_str)
            .is_some_and(|text| text.contains("initial"))
    );
}
