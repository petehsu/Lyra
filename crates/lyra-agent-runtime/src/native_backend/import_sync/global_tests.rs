use super::*;

#[test]
fn project_imports_use_global_storage_distinct_ids_and_preserve_later_policy() {
    let temp = tempfile::tempdir().unwrap();
    let name = format!("project-import-{}", Uuid::new_v4());
    let mut candidates = Vec::new();
    let mut roots = Vec::new();
    for (folder, command) in [("a", "first-command"), ("b", "second-command")] {
        let root = temp.path().join(folder);
        fs::create_dir_all(root.join(".cursor")).unwrap();
        fs::write(
            root.join(".cursor/mcp.json"),
            serde_json::to_vec(
                &json!({"mcpServers":{ &name: {"command":command, "cwd":".", "enabled":true} }}),
            )
            .unwrap(),
        )
        .unwrap();
        projects::register_path(root.to_str().unwrap()).unwrap();
        let scan = scan_source(
            ImportSourceId::Cursor,
            Some(root.clone()),
            SourcePreference {
                skills: false,
                mcp: true,
            },
        )
        .unwrap();
        assert_eq!(scan.candidates.len(), 1);
        candidates.extend(scan.candidates);
        roots.push(root);
    }
    global::assign_targets_and_statuses(ImportSourceId::Cursor, &mut candidates);
    assert_ne!(candidates[0].target_id, candidates[1].target_id);
    for candidate in &candidates {
        global::install(candidate).unwrap();
        let mut provenance = read_provenance();
        provenance.entries.push(ProvenanceEntry {
            source_id: "cursor".into(),
            kind: candidate.kind.clone(),
            scope: candidate.scope.clone(),
            source_path: candidate.source_path.to_string_lossy().into_owned(),
            project_root: candidate.project_root.clone(),
            source_item_id: candidate.source_item_id.clone(),
            target_id: candidate.target_id.clone(),
            source_fingerprint: candidate.fingerprint.clone(),
            target_fingerprint: current_target_fingerprint(candidate).unwrap(),
            synced_at: now(),
        });
        write_provenance(&provenance).unwrap();
        global::initialize_project_policy(candidate).unwrap();
        assert!(
            !roots
                .iter()
                .any(|root| root.join(".lyra/agent/mcp").exists())
        );
        let global = mcp_catalog::registry_snapshot();
        let server = global
            .servers
            .iter()
            .find(|server| server.id == candidate.target_id)
            .unwrap();
        assert!(!server.enabled);
        if let mcp_catalog::McpTransportConfig::Stdio { cwd, .. } = &server.transport {
            assert_eq!(cwd.as_ref(), candidate.project_root.as_ref());
        }
    }
    let a = roots[0].to_str().unwrap();
    let b = roots[1].to_str().unwrap();
    let first = candidates[0].target_id.clone();
    assert!(
        mcp_catalog::effective_registry(Some(a))
            .unwrap()
            .servers
            .iter()
            .find(|server| server.id == first)
            .unwrap()
            .enabled
    );
    assert!(
        !mcp_catalog::effective_registry(Some(b))
            .unwrap()
            .servers
            .iter()
            .find(|server| server.id == first)
            .unwrap()
            .enabled
    );
    projects::set_override(a, "mcp", &first, None).unwrap();
    global::initialize_project_policy(&candidates[0]).unwrap();
    assert!(
        !projects::for_root(Some(a))
            .unwrap()
            .unwrap()
            .mcp
            .contains_key(&first)
    );
    mcp_catalog::set_enabled(json!({"serverId": first, "enabled":true})).unwrap();
    global::assign_targets_and_statuses(ImportSourceId::Cursor, &mut candidates);
    assert!(
        candidates
            .iter()
            .all(|candidate| candidate.status == "synced")
    );
    // User edits to configuration remain a conflict; toggles are not edits to its contents.
    mcp_catalog::mcp_server_upsert(json!({"id": first, "command":"user-edited", "enabled":true}))
        .unwrap();
    global::assign_targets_and_statuses(ImportSourceId::Cursor, &mut candidates);
    assert_eq!(candidates[0].status, "conflict");
    assert_eq!(candidates[1].status, "synced");
}
