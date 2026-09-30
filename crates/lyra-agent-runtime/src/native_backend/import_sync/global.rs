use super::*;

fn same_origin(
    entry: &ProvenanceEntry,
    source: ImportSourceId,
    candidate: &ImportCandidate,
) -> bool {
    entry.source_id == source.id()
        && entry.kind == candidate.kind
        && entry.scope == candidate.scope
        && entry.source_item_id == candidate.source_item_id
        && entry.source_path == candidate.source_path.to_string_lossy()
        && entry.project_root == candidate.project_root
}

pub(super) fn has_project_source(source: ImportSourceId) -> bool {
    let paths: &[&str] = match source {
        ImportSourceId::Claude => &[".claude", ".mcp.json", ".claude.json"],
        ImportSourceId::Cursor => &[".cursor"],
        ImportSourceId::Codex => &[".codex", ".agents/skills"],
        ImportSourceId::Opencode => &[
            ".opencode",
            "opencode.json",
            "opencode.jsonc",
            ".agents/skills",
            ".claude/skills",
        ],
        ImportSourceId::Zed => &[".zed", ".agents/skills"],
    };
    projects::known_roots()
        .unwrap_or_default()
        .iter()
        .any(|root| paths.iter().any(|path| Path::new(root).join(path).exists()))
}

pub(super) fn scan_all(
    source: ImportSourceId,
    preference: SourcePreference,
) -> AgentRuntimeResult<DetectionSnapshot> {
    let mut snapshot = scan_source(source, None, preference.clone())?;
    for root in projects::known_roots()? {
        if !Path::new(&root).is_dir() {
            snapshot
                .diagnostics
                .push(json!({"path": root, "message": "Project directory is unavailable"}));
            continue;
        }
        match scan_source(source, Some(PathBuf::from(&root)), preference.clone()) {
            Ok(project) => {
                snapshot.candidates.extend(project.candidates);
                snapshot.diagnostics.extend(project.diagnostics);
            }
            Err(error) => snapshot
                .diagnostics
                .push(json!({"path": root, "message": error.to_string()})),
        }
    }
    snapshot.candidates.sort_by(|a, b| {
        (&a.scope, &a.source_path, &a.kind, &a.source_item_id).cmp(&(
            &b.scope,
            &b.source_path,
            &b.kind,
            &b.source_item_id,
        ))
    });
    apply_statuses(source, &mut snapshot.candidates);
    snapshot.source_fingerprint = hash_value(&json!(
        snapshot
            .candidates
            .iter()
            .map(|item| json!([
                item.scope,
                item.project_root,
                item.source_path,
                item.kind,
                item.source_item_id,
                item.fingerprint
            ]))
            .collect::<Vec<_>>()
    ));
    Ok(snapshot)
}

pub(super) fn assign_targets_and_statuses(
    source: ImportSourceId,
    candidates: &mut [ImportCandidate],
) {
    let provenance = read_provenance();
    let mut reserved = BTreeMap::<(String, String), String>::new();
    for candidate in candidates {
        let record = provenance
            .entries
            .iter()
            .find(|entry| same_origin(entry, source, candidate));
        if let Some(record) = record {
            candidate.target_id = record.target_id.clone();
        } else {
            let identical = provenance.entries.iter().find(|entry| {
                entry.kind == candidate.kind
                    && entry.source_fingerprint == candidate.fingerprint
                    && {
                        let mut target = candidate.clone();
                        target.target_id = entry.target_id.clone();
                        current_target_fingerprint(&target).as_ref()
                            == Some(&entry.target_fingerprint)
                    }
            });
            if let Some(identical) = identical {
                candidate.target_id = identical.target_id.clone();
            } else {
                let current = current_target_fingerprint(candidate);
                let occupied = reserved.get(&(candidate.kind.clone(), candidate.target_id.clone()));
                if (current.is_some() && current.as_ref() != Some(&candidate.fingerprint))
                    || (occupied.is_some() && occupied != Some(&candidate.fingerprint))
                    || (current.is_none() && candidate.scope == "project")
                {
                    candidate.target_id = scoped_id(
                        &candidate.target_id,
                        &format!(
                            "{}:{}:{}:{}:{}",
                            source.id(),
                            candidate.kind,
                            candidate.source_path.display(),
                            candidate.project_root.as_deref().unwrap_or_default(),
                            candidate.source_item_id
                        ),
                    );
                }
            }
        }
        let target = current_target_fingerprint(candidate);
        candidate.status = match (record, target) {
            (None, _) => "pending", // also records provenance and original-project policy for reused entries
            (Some(_), None) => "pending",
            (Some(record), Some(target)) if target != record.target_fingerprint => "conflict",
            (Some(record), Some(_)) if record.source_fingerprint == candidate.fingerprint => {
                "synced"
            }
            (Some(_), Some(_)) => "update",
        }
        .into();
        reserved.insert(
            (candidate.kind.clone(), candidate.target_id.clone()),
            candidate.fingerprint.clone(),
        );
    }
}

pub(super) fn initialize_project_policy(candidate: &ImportCandidate) -> AgentRuntimeResult<()> {
    if let Some(root) = &candidate.project_root {
        projects::initialize_import(
            root,
            &candidate.kind,
            &candidate.target_id,
            candidate.enabled,
        )?;
    }
    Ok(())
}

pub(super) fn install(candidate: &ImportCandidate) -> AgentRuntimeResult<(Value, Option<String>)> {
    let storage = target_storage_root(&candidate.kind);
    let existed = current_target_fingerprint(candidate).is_some();
    let same = current_target_fingerprint(candidate).as_ref() == Some(&candidate.fingerprint)
        || read_provenance().entries.iter().any(|entry| {
            entry.kind == candidate.kind
                && entry.target_id == candidate.target_id
                && entry.source_fingerprint == candidate.fingerprint
                && current_target_fingerprint(candidate).as_ref() == Some(&entry.target_fingerprint)
        });
    if same {
        return Ok((json!({}), None));
    }
    match &candidate.payload {
        CandidatePayload::Skill { root } => {
            let skill = skill_catalog::install_package_from_root_as(
                &storage,
                root,
                skill_catalog::SkillSource::Local {
                    path: root.to_string_lossy().into_owned(),
                },
                Some(&candidate.target_id),
            )?;
            if !existed && candidate.scope == "user" {
                skill_catalog::set_skill_active(json!({"skillId": skill.id}), true)?;
            }
            Ok((json!({"skillId": skill.id}), None))
        }
        CandidatePayload::Mcp { config } => {
            let mut secured = secure_imported_mcp_config(config, candidate)?;
            secured["id"] = json!(candidate.target_id);
            secured["sourceLabel"] = json!(candidate.source_path);
            let old = mcp_catalog::registry_snapshot()
                .servers
                .into_iter()
                .find(|server| server.id == candidate.target_id);
            secured["enabled"] = json!(
                old.as_ref()
                    .map(|server| server.enabled)
                    .unwrap_or(candidate.scope == "user" && candidate.enabled)
            );
            // Relative cwd belongs to the source project/config, never Lyra's runtime directory.
            if let Some(cwd) = secured
                .get("cwd")
                .and_then(Value::as_str)
                .filter(|cwd| Path::new(cwd).is_relative())
            {
                let base = candidate
                    .project_root
                    .as_deref()
                    .map(Path::new)
                    .unwrap_or_else(|| {
                        candidate
                            .source_path
                            .parent()
                            .unwrap_or(&candidate.source_path)
                    });
                secured["cwd"] = json!(normalize_path(&base.join(cwd)));
            }
            let value = mcp_catalog::upsert_mcp_servers_at(&storage, secured)?;
            Ok((value, None))
        }
    }
}

fn scoped_id(id: &str, source: &str) -> String {
    let hash = hash_value(&json!(source));
    format!(
        "{}-{}",
        id.chars().take(64).collect::<String>(),
        &hash[..12]
    )
}
