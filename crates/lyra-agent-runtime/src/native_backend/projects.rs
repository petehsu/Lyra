use super::*;
use std::collections::BTreeMap;

#[cfg(test)]
mod tests;

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Project {
    pub(crate) id: String,
    pub(crate) path: String,
    pub(crate) name: String,
    pub(crate) last_used_at: String,
    #[serde(default)]
    aliases: std::collections::BTreeSet<String>,
    #[serde(default)]
    pub(crate) skills: BTreeMap<String, bool>,
    #[serde(default)]
    pub(crate) mcp: BTreeMap<String, bool>,
    #[serde(default)]
    initialized_imports: std::collections::BTreeSet<String>,
}

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Registry {
    #[serde(default)]
    revision: u64,
    #[serde(default)]
    projects: Vec<Project>,
}

fn registry_path() -> PathBuf {
    runtime_root().join("projects/registry.v1.json")
}

// Serialize complete read/modify/write operations, not just the final rename.
fn registry_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

pub(crate) fn normalized_path(path: &str) -> AgentRuntimeResult<String> {
    let path = Path::new(path.trim());
    if !path.is_absolute() {
        return Err(AgentRuntimeError::Core(
            "project directory must be absolute".into(),
        ));
    }
    Ok(fs::canonicalize(path)
        .unwrap_or_else(|_| normalize_path(path))
        .to_string_lossy()
        .into_owned())
}

fn add_project(registry: &mut Registry, path: &str, used_at: &str) -> AgentRuntimeResult<Project> {
    let alias = normalize_path(Path::new(path.trim()))
        .to_string_lossy()
        .into_owned();
    let path = normalized_path(path)?;
    if let Some(project) = registry
        .projects
        .iter_mut()
        .find(|project| project.path == path || project.aliases.contains(&alias))
    {
        project.aliases.insert(alias);
        if used_at > project.last_used_at.as_str() {
            project.last_used_at = used_at.to_string();
        }
        return Ok(project.clone());
    }
    let project = Project {
        id: format!("project-{}", Uuid::new_v4()),
        name: Path::new(&path)
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_else(|| path.clone()),
        path,
        last_used_at: used_at.to_string(),
        aliases: [alias].into_iter().collect(),
        ..Project::default()
    };
    registry.projects.push(project.clone());
    Ok(project)
}

fn read_registry() -> AgentRuntimeResult<Registry> {
    let path = registry_path();
    match fs::read(&path) {
        Ok(bytes) => serde_json::from_slice(&bytes)
            .map_err(|error| AgentRuntimeError::Core(format!("project registry: {error}"))),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            let registry = backfill_registry(&runtime_root())?;
            write_json(&path, &registry)?;
            Ok(registry)
        }
        Err(error) => Err(AgentRuntimeError::Core(error.to_string())),
    }
}

fn backfill_registry(root: &Path) -> AgentRuntimeResult<Registry> {
    let mut registry = Registry::default();
    // Metadata only, including archived sessions. No transcript loading or
    // listSessions limit, and no schema writes to historical databases.
    for id in session_store::list_session_ids(root)? {
        let db = session_store::session_db_path(root, &id);
        let Ok(conn) =
            rusqlite::Connection::open_with_flags(db, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
        else {
            continue;
        };
        let row = conn.query_row(
                    "SELECT working_dir, updated_at_iso FROM session_meta WHERE project_bound = 1 AND working_dir_is_home = 0 LIMIT 1",
                    [], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
                );
        if let Ok((path, used_at)) = row {
            let _ = add_project(&mut registry, &path, &used_at);
        }
    }
    Ok(registry)
}

fn read_projects() -> AgentRuntimeResult<Vec<Project>> {
    let _guard = registry_lock()
        .lock()
        .map_err(|_| AgentRuntimeError::Core("project registry lock failed".into()))?;
    Ok(read_registry()?.projects)
}

fn mutate<T>(
    operation: impl FnOnce(&mut Registry) -> AgentRuntimeResult<T>,
) -> AgentRuntimeResult<T> {
    let result = {
        let _guard = registry_lock()
            .lock()
            .map_err(|_| AgentRuntimeError::Core("project registry lock failed".into()))?;
        let mut registry = read_registry()?;
        let result = operation(&mut registry)?;
        registry.revision += 1;
        write_json(&registry_path(), &registry)?;
        result
    };
    emit_with_callback(
        &event_callback(),
        json!({ "kind": "projectCapabilitiesChanged", "scope": "projects" }),
    );
    Ok(result)
}

pub(crate) fn notify_changed() {
    emit_with_callback(
        &event_callback(),
        json!({ "kind": "projectCapabilitiesChanged", "scope": "catalog" }),
    );
}

pub(crate) fn register_path(path: &str) -> AgentRuntimeResult<Project> {
    // A restored draft may point at an offline volume. Retain its identity;
    // availability is reported separately and the UI never changes its path.
    if Path::new(path).exists() && !Path::new(path).is_dir() {
        return Err(AgentRuntimeError::Core(
            "project path is not a directory".into(),
        ));
    }
    mutate(|registry| add_project(registry, path, &now()))
}

pub(crate) fn register_snapshot(snapshot: &Value) -> AgentRuntimeResult<()> {
    if snapshot.get("workingDirIsHome").and_then(Value::as_bool) != Some(false) {
        return Ok(());
    }
    if let Some(path) = snapshot.get("workingDir").and_then(Value::as_str) {
        mutate(|registry| add_project(registry, path, &now()))?;
    }
    Ok(())
}

pub(crate) fn list() -> AgentRuntimeResult<Value> {
    let mut projects = read_projects()?;
    projects.sort_by(|a, b| {
        b.last_used_at
            .cmp(&a.last_used_at)
            .then_with(|| a.path.cmp(&b.path))
    });
    Ok(json!({ "projects": projects.iter().map(project_value).collect::<Vec<_>>() }))
}

fn project_value(project: &Project) -> Value {
    json!({ "id": project.id, "path": project.path, "name": project.name, "lastUsedAt": project.last_used_at,
        "available": Path::new(&project.path).is_dir() })
}

pub(crate) fn register(payload: Value) -> AgentRuntimeResult<Value> {
    let path = string_opt(&payload, "workingDir")
        .ok_or_else(|| AgentRuntimeError::Core("workingDir is required".into()))?;
    let project = register_path(&path)?;
    Ok(json!({ "project": project_value(&project) }))
}

pub(crate) fn known_roots() -> AgentRuntimeResult<Vec<String>> {
    Ok(read_projects()?
        .into_iter()
        .map(|project| project.path)
        .collect())
}

pub(crate) fn for_root(root: Option<&str>) -> AgentRuntimeResult<Option<Project>> {
    let Some(root) = root else { return Ok(None) };
    let canonical = normalized_path(root)?;
    let projects = read_projects()?;
    if let Some(project) = projects.iter().find(|project| project.path == canonical) {
        return Ok(Some(project.clone()));
    }
    let alias = normalize_path(Path::new(root.trim()))
        .to_string_lossy()
        .into_owned();
    Ok(projects
        .into_iter()
        .find(|project| project.aliases.contains(&alias)))
}

pub(crate) fn snapshot_root(snapshot: &Value) -> Option<&str> {
    if snapshot.get("workingDirIsHome").and_then(Value::as_bool) == Some(true) {
        None
    } else {
        snapshot.get("workingDir").and_then(Value::as_str)
    }
}

pub(crate) fn session_root(session_id: &str) -> AgentRuntimeResult<Option<String>> {
    let runtime = state()
        .lock()
        .map_err(|_| AgentRuntimeError::Core("agent runtime lock failed".into()))?;
    let session = runtime
        .sessions
        .get(session_id)
        .ok_or_else(|| AgentRuntimeError::Core(format!("session not found: {session_id}")))?;
    Ok((session
        .snapshot
        .get("workingDirIsHome")
        .and_then(Value::as_bool)
        != Some(true))
    .then(|| {
        session
            .snapshot
            .get("workingDir")
            .and_then(Value::as_str)
            .map(str::to_string)
    })
    .flatten())
}

pub(crate) fn enabled(project: Option<&Project>, kind: &str, id: &str, global: bool) -> bool {
    project
        .and_then(|project| {
            if kind == "skill" {
                project.skills.get(id)
            } else {
                project.mcp.get(id)
            }
        })
        .copied()
        .unwrap_or(global)
}

pub(crate) fn set_override(
    root: &str,
    kind: &str,
    id: &str,
    value: Option<bool>,
) -> AgentRuntimeResult<()> {
    let root = normalized_path(root)?;
    mutate(|registry| {
        let project = registry
            .projects
            .iter_mut()
            .find(|project| project.path == root)
            .ok_or_else(|| AgentRuntimeError::Core("project not found".into()))?;
        let overrides = if kind == "skill" {
            &mut project.skills
        } else {
            &mut project.mcp
        };
        if let Some(value) = value {
            overrides.insert(id.into(), value);
        } else {
            overrides.remove(id);
        }
        Ok(())
    })
}

pub(crate) fn initialize_import(
    root: &str,
    kind: &str,
    id: &str,
    enabled: bool,
) -> AgentRuntimeResult<()> {
    let root = normalized_path(root)?;
    let key = format!("import:{kind}:{id}");
    if for_root(Some(&root))?.is_some_and(|project| project.initialized_imports.contains(&key)) {
        return Ok(());
    }
    mutate(|registry| {
        let project = registry
            .projects
            .iter_mut()
            .find(|project| project.path == root)
            .ok_or_else(|| AgentRuntimeError::Core("project not found".into()))?;
        if !project.initialized_imports.contains(&key) {
            let overrides = if kind == "skill" {
                &mut project.skills
            } else {
                &mut project.mcp
            };
            overrides.entry(id.into()).or_insert(enabled);
            project.initialized_imports.insert(key);
        }
        Ok(())
    })
}

pub(crate) fn settings(payload: Value) -> AgentRuntimeResult<Value> {
    let id = string_opt(&payload, "projectId")
        .ok_or_else(|| AgentRuntimeError::Core("projectId is required".into()))?;
    let project = read_projects()?
        .into_iter()
        .find(|project| project.id == id)
        .ok_or_else(|| AgentRuntimeError::Core("project not found".into()))?;
    let active = skill_catalog::global_active_skills()?;
    let installed = skill_catalog::registry_snapshot().installed;
    let effective_skill_ids = skill_catalog::effective_skills(Some(&project.path))?
        .into_iter()
        .map(|skill| skill.id)
        .collect::<HashSet<_>>();
    let skills = installed.into_iter().map(|skill| {
        let global = active.contains(&skill.id);
        json!({ "id": skill.id, "name": skill.manifest.name, "description": skill.manifest.description,
            "source": skill.source, "sourceLabel": match &skill.source { skill_catalog::SkillSource::Local { path } => path, skill_catalog::SkillSource::Git { url, .. } | skill_catalog::SkillSource::Archive { url } => url, skill_catalog::SkillSource::Store { skill_id, .. } => skill_id }, "globalEnabled": global, "override": project.skills.get(&skill.id),
            "enabled": effective_skill_ids.contains(&skill.id) })
    }).collect::<Vec<_>>();
    let global_mcp = mcp_catalog::registry_snapshot();
    let mcp = mcp_catalog::effective_registry(Some(&project.path))?.servers.into_iter().map(|server| {
        let global = global_mcp.servers.iter().find(|item| item.id == server.id).map(|item| item.enabled).unwrap_or(false);
        json!({ "id": server.id, "name": server.name, "description": format!("{}{}", mcp_catalog::transport_label(&server.transport), server.source_label.as_ref().map(|source| format!(" · {source}")).unwrap_or_default()),
            "globalEnabled": global, "override": project.mcp.get(&server.id),
            "enabled": server.enabled, "state": server.state })
    }).collect::<Vec<_>>();
    Ok(json!({ "project": project_value(&project), "skills": skills, "mcp": mcp }))
}

pub(crate) fn update_override(payload: Value) -> AgentRuntimeResult<Value> {
    let project_id = string_opt(&payload, "projectId")
        .ok_or_else(|| AgentRuntimeError::Core("projectId is required".into()))?;
    let kind = string_opt(&payload, "kind")
        .filter(|kind| matches!(kind.as_str(), "skill" | "mcp"))
        .ok_or_else(|| AgentRuntimeError::Core("kind must be skill or mcp".into()))?;
    let item_id = string_opt(&payload, "itemId")
        .ok_or_else(|| AgentRuntimeError::Core("itemId is required".into()))?;
    let value = match payload.get("enabled") {
        Some(Value::Null) => None,
        Some(Value::Bool(value)) => Some(*value),
        _ => {
            return Err(AgentRuntimeError::Core(
                "enabled must be boolean or null".into(),
            ));
        }
    };
    let project = read_projects()?
        .into_iter()
        .find(|project| project.id == project_id)
        .ok_or_else(|| AgentRuntimeError::Core("project not found".into()))?;
    let actual = settings(json!({"projectId": project_id}))?;
    let list = if kind == "skill" { "skills" } else { "mcp" };
    if !actual[list]
        .as_array()
        .is_some_and(|items| items.iter().any(|item| item["id"] == item_id))
    {
        return Err(AgentRuntimeError::Core(
            "capability is not installed".into(),
        ));
    }
    set_override(&project.path, &kind, &item_id, value)?;
    settings(json!({ "projectId": project_id }))
}
