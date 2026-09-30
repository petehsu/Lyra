use super::*;

#[test]
fn explicit_project_policy_wins_over_global_defaults() {
    let mut project = Project::default();
    for global in [false, true] {
        assert_eq!(enabled(Some(&project), "mcp", "test", global), global);
        for value in [false, true] {
            project.mcp.insert("test".into(), value);
            assert_eq!(enabled(Some(&project), "mcp", "test", global), value);
            assert_eq!(enabled(None, "mcp", "test", global), global);
        }
        project.mcp.remove("test");
    }
}

#[test]
fn canonical_paths_deduplicate_and_missing_projects_survive() {
    let temp = tempfile::tempdir().unwrap();
    let mut registry = Registry::default();
    let path = temp.path().to_str().unwrap().to_string();
    let first = add_project(&mut registry, &path, "2026-01-01").unwrap();
    let again = add_project(&mut registry, &format!("{path}/."), "2026-02-01").unwrap();
    assert_eq!(first.id, again.id);
    assert_eq!(registry.projects.len(), 1);
    drop(temp);
    assert_eq!(project_value(&registry.projects[0])["available"], false);
    assert_eq!(
        add_project(&mut registry, &path, "2026-03-01").unwrap().id,
        first.id
    );
}

// This integration test owns the process-local test runtime. Other tests in
// this module are pure and never mutate its registries.
#[test]
fn history_and_live_policy_are_project_isolated() {
    let temp = tempfile::tempdir().unwrap();
    let a = temp.path().join("a");
    let b = temp.path().join("b");
    fs::create_dir_all(&a).unwrap();
    fs::create_dir_all(&b).unwrap();
    let a = a.to_str().unwrap();
    let b = b.to_str().unwrap();
    // Deliberately no transcript tables: backfill must only read metadata.
    for index in 0..503 {
        let db = session_store::session_db_path(
            &temp.path().join("history"),
            &format!("history-{index:04}"),
        );
        fs::create_dir_all(db.parent().unwrap()).unwrap();
        let conn = rusqlite::Connection::open(db).unwrap();
        conn.execute_batch("CREATE TABLE session_meta (working_dir TEXT, updated_at_iso TEXT, project_bound INTEGER, working_dir_is_home INTEGER, archived INTEGER)").unwrap();
        let root = if index == 0 { b } else { a };
        conn.execute(
            "INSERT INTO session_meta VALUES (?1, ?2, 1, ?3, ?4)",
            rusqlite::params![
                root,
                format!("2026-{index:04}"),
                i64::from(index == 502),
                i64::from(index == 0)
            ],
        )
        .unwrap();
    }
    let history = backfill_registry(&temp.path().join("history")).unwrap();
    assert_eq!(history.projects.len(), 2);
    assert!(
        history.projects.iter().any(|project| project.path == b),
        "old archived project must survive the 500-session boundary"
    );
    register_path(a).unwrap();
    register_path(b).unwrap();
    let offline_draft = temp.path().join("offline-draft");
    let offline = register_path(offline_draft.to_str().unwrap()).unwrap();
    assert_eq!(project_value(&offline)["available"], false);
    let draft = temp.path().join("unsent");
    fs::create_dir(&draft).unwrap();
    let draft_project = register_path(draft.to_str().unwrap()).unwrap();
    assert!(
        read_registry()
            .unwrap()
            .projects
            .iter()
            .any(|p| p.id == draft_project.id)
    );
    session_store::delete_session_store(&temp.path().join("history"), "history-0000").unwrap();
    assert!(for_root(Some(b)).unwrap().is_some());

    mcp_catalog::mcp_server_upsert(
        json!({"id":"shared", "command":"global-command", "enabled":true}),
    )
    .unwrap();
    set_override(a, "mcp", "shared", Some(false)).unwrap();
    assert!(
        !mcp_catalog::effective_registry(Some(a))
            .unwrap()
            .servers
            .iter()
            .find(|server| server.id == "shared")
            .unwrap()
            .enabled
    );
    assert!(
        mcp_catalog::effective_registry(Some(b))
            .unwrap()
            .servers
            .iter()
            .find(|server| server.id == "shared")
            .unwrap()
            .enabled
    );
    assert!(
        mcp_catalog::execute_for_project(
            "mcp_tool_execute",
            &json!({"serverId":"shared","toolName":"stale"}),
            Some(a)
        )
        .is_err()
    );
    mcp_catalog::set_enabled(json!({"serverId":"shared", "enabled":false})).unwrap();
    set_override(b, "mcp", "shared", Some(true)).unwrap();
    let mut catalog = mcp_catalog::registry_snapshot();
    let shared = catalog
        .servers
        .iter_mut()
        .find(|server| server.id == "shared")
        .unwrap();
    shared.state = "connected".into();
    shared.tools.push(mcp_catalog::McpToolInfo {
        name: "ping".into(),
        description: "Ping".into(),
        input_schema: None,
        output_schema: None,
    });
    mcp_catalog::write_registry_to(&mcp_catalog::mcp_storage_root(), &catalog).unwrap();
    let shared_path = "/tools/mcp/capability/shared/ping";
    assert!(
        !tools::tool_fs::dynamic_capability_manifests(None, Some(a))
            .iter()
            .any(|tool| tool.path == shared_path)
    );
    assert!(
        tools::tool_fs::dynamic_capability_manifests(None, Some(b))
            .iter()
            .any(|tool| tool.path == shared_path)
    );
    let session = create_session(json!({"workingDir":a})).unwrap();
    let runtime = tokio::runtime::Runtime::new().unwrap();
    runtime.block_on(async {
        let id = session["id"].as_str().unwrap();
        let supplied = json!({"projectRoot":b, "serverId":"shared", "toolName":"ping"});
        let direct = tools::execute_mcp_tool_adapter(
            id,
            "policy-test",
            "direct",
            "mcp_tool_execute",
            "execute",
            supplied.clone(),
            &now(),
        )
        .await;
        assert!(
            direct["error"]["message"]
                .as_str()
                .unwrap()
                .contains("disabled")
        );
        let dynamic = tools::execute_mcp_capability_tool_adapter(
            id,
            "policy-test",
            "dynamic",
            "shared".into(),
            "ping".into(),
            supplied,
            &now(),
        )
        .await;
        assert!(
            dynamic["error"]["message"]
                .as_str()
                .unwrap()
                .contains("disabled")
        );
    });
    assert_eq!(
        mcp_catalog::registry_snapshot()
            .servers
            .iter()
            .find(|server| server.id == "shared")
            .unwrap()
            .state,
        "connected",
        "project disable must not disconnect a shared peer"
    );
    assert!(
        mcp_catalog::effective_registry(Some(b))
            .unwrap()
            .servers
            .iter()
            .find(|s| s.id == "shared")
            .unwrap()
            .enabled
    );
    assert!(
        !mcp_catalog::effective_registry(None)
            .unwrap()
            .servers
            .iter()
            .find(|s| s.id == "shared")
            .unwrap()
            .enabled
    );
    set_override(b, "mcp", "shared", None).unwrap();
    assert!(
        !mcp_catalog::effective_registry(Some(b))
            .unwrap()
            .servers
            .iter()
            .find(|s| s.id == "shared")
            .unwrap()
            .enabled
    );

    let source = temp.path().join("review");
    fs::create_dir(&source).unwrap();
    fs::write(
        source.join("SKILL.md"),
        "---\nname: review\ndescription: Review\n---\nProject-only instructions",
    )
    .unwrap();
    let installed = skill_catalog::install_package_from_root(
        &skill_catalog::skill_storage_root(),
        &source,
        skill_catalog::SkillSource::Local {
            path: source.to_string_lossy().into_owned(),
        },
    )
    .unwrap();
    let skill_id = &installed.id;
    set_override(a, "skill", skill_id, Some(true)).unwrap();
    assert!(
        skill_catalog::active_skill_prompt_for_project(Some(a))
            .contains("Project-only instructions")
    );
    assert!(skill_catalog::active_skill_prompt_for_project(Some(b)).is_empty());
    set_override(a, "skill", skill_id, Some(false)).unwrap();
    assert!(
        skill_catalog::execute_for_project("skill_inspect", &json!({"skillId":skill_id}), Some(a))
            .is_err()
    );
    assert!(
        skill_catalog::execute_for_project("skill_activate", &json!({"skillId":skill_id}), Some(a))
            .is_ok()
    );
    assert!(
        skill_catalog::active_skill_prompt_for_project(Some(a))
            .contains("Project-only instructions")
    );
    set_override(a, "skill", skill_id, Some(false)).unwrap();
    assert!(skill_catalog::active_skill_prompt_for_project(Some(a)).is_empty());

    initialize_import(b, "skill", skill_id, true).unwrap();
    set_override(b, "skill", skill_id, None).unwrap();
    initialize_import(b, "skill", skill_id, true).unwrap();
    assert!(
        !for_root(Some(b))
            .unwrap()
            .unwrap()
            .skills
            .contains_key(skill_id),
        "repeat import must preserve follow-global after reset"
    );

    // Global Skill defaults commit synchronously, even without saving chat state.
    skill_catalog::set_skill_active(json!({"skillId": skill_id}), true).unwrap();
    let defaults_path = skill_catalog::skill_storage_root().join("enabled.v1.json");
    let defaults: HashSet<String> =
        serde_json::from_slice(&fs::read(&defaults_path).unwrap()).unwrap();
    assert!(defaults.contains(skill_id));
    assert!(
        skill_catalog::active_skill_prompt_for_project(None).contains("Project-only instructions")
    );
    assert!(skill_catalog::active_skill_prompt_for_project(Some(a)).is_empty());
    // Block only the write lock: disk and runtime still expose the last saved value.
    let blocked_lock = defaults_path.with_file_name("enabled.v1.json.lock");
    fs::remove_file(&blocked_lock).unwrap();
    fs::create_dir(&blocked_lock).unwrap();
    assert!(skill_catalog::set_skill_active(json!({"skillId": skill_id}), false).is_err());
    assert!(
        skill_catalog::global_active_skills()
            .unwrap()
            .contains(skill_id)
    );
    fs::remove_dir(&blocked_lock).unwrap();
    skill_catalog::set_skill_active(json!({"skillId": skill_id}), false).unwrap();
    assert!(
        !skill_catalog::global_active_skills()
            .unwrap()
            .contains(skill_id)
    );

    fs::remove_dir_all(&draft).unwrap();
    assert_eq!(
        list().unwrap()["projects"]
            .as_array()
            .unwrap()
            .iter()
            .find(|p| p["id"] == draft_project.id)
            .unwrap()["available"],
        false
    );
}
