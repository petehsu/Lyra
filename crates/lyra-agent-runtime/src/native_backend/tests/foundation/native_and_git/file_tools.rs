use super::*;

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
    let outside_path = temp
        .path()
        .parent()
        .expect("temp parent")
        .join("outside-tool-test.txt");
    tool_file_write(
        &session_id,
        &turn_id,
        "tool-outside-write",
        &json!({
            "path": outside_path.display().to_string(),
            "content": "outside workspace write",
            "overwrite": true
        }),
    )
    .expect("direct file tool can write outside workspace after approval layer is bypassed");
    assert_eq!(
        fs::read_to_string(&outside_path).expect("read outside file"),
        "outside workspace write"
    );
    let _ = fs::remove_file(&outside_path);
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
