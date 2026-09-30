use super::*;

// Kept separate from the deferred conversation-state writer: a switch must be
// durable before reporting success, without flushing unrelated chat bodies.
pub(crate) fn global_active_skills() -> AgentRuntimeResult<HashSet<String>> {
    let path = skill_storage_root().join("enabled.v1.json");
    match fs::read(&path) {
        Ok(bytes) => serde_json::from_slice(&bytes)
            .map_err(|error| AgentRuntimeError::Serialization(error.to_string())),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(HashSet::new()),
        Err(error) => Err(AgentRuntimeError::Core(error.to_string())),
    }
}

pub(super) fn set_global_default(id: &str, enabled: bool) -> AgentRuntimeResult<HashSet<String>> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    let _guard = LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .map_err(|_| AgentRuntimeError::Core("skill defaults lock failed".into()))?;
    let mut active = global_active_skills()?;
    if enabled {
        active.insert(id.to_string());
    } else {
        active.remove(id);
    }
    write_json(&skill_storage_root().join("enabled.v1.json"), &active)?;
    projects::notify_changed();
    Ok(active)
}

pub(crate) fn effective_skills(root: Option<&str>) -> AgentRuntimeResult<Vec<InstalledSkill>> {
    let active = global_active_skills()?;
    let project = projects::for_root(root)?;
    Ok(read_registry()
        .installed
        .into_iter()
        .filter(|skill| {
            projects::enabled(
                project.as_ref(),
                "skill",
                &skill.id,
                active.contains(&skill.id),
            )
        })
        .collect())
}

fn installed_skill(id: &str) -> Option<InstalledSkill> {
    read_registry()
        .installed
        .into_iter()
        .find(|skill| skill.id == id)
}

fn enable_skill_for_session(id: &str, root: Option<&str>) -> AgentRuntimeResult<()> {
    set_global_default(id, true)?;
    if let Some(root) = root
        && projects::for_root(Some(root))?.is_some()
    {
        projects::set_override(root, "skill", id, Some(true))?;
    }
    Ok(())
}

pub(crate) fn execute_for_project(
    name: &str,
    input: &Value,
    root: Option<&str>,
) -> AgentRuntimeResult<Value> {
    if name == "skill_list" {
        let skills = effective_skills(root)?;
        return Ok(
            json!({"skills": skills.iter().map(|skill| skill_value(skill, true, false)).collect::<Vec<_>>()}),
        );
    }
    if matches!(
        name,
        "skill_inspect" | "skill_activate" | "skill_deactivate"
    ) {
        let id = string_opt(input, "skillId")
            .ok_or_else(|| AgentRuntimeError::Core("skillId is required".into()))?;
        let Some(installed) = installed_skill(&id) else {
            return Err(AgentRuntimeError::Core(format!(
                "Lyra skill is not installed: {id}"
            )));
        };
        if name == "skill_activate" {
            enable_skill_for_session(&id, root)?;
            let skills = effective_skills(root)?;
            let skill = skills
                .iter()
                .find(|skill| skill.id == id)
                .unwrap_or(&installed);
            return Ok(json!({"skill": skill_value(skill, true, true)}));
        }
        if name == "skill_deactivate" {
            if let Some(root) = root
                && projects::for_root(Some(root))?.is_some()
            {
                projects::set_override(root, "skill", &id, Some(false))?;
            } else {
                set_global_default(&id, false)?;
            }
            return Ok(json!({"skill": skill_value(&installed, false, true)}));
        }
        let skills = effective_skills(root)?;
        let Some(skill) = skills.iter().find(|skill| skill.id == id) else {
            return Err(AgentRuntimeError::Core(format!(
                "Lyra skill is not in this session: {id}"
            )));
        };
        return Ok(json!({"skill": skill_value(skill, true, true)}));
    }
    if matches!(
        name,
        "skill_install_local" | "skill_install_git" | "skill_install_store"
    ) {
        let value = execute_skill_state_change(name, input).map_err(AgentRuntimeError::Core)?;
        if let Some(id) = value.pointer("/skill/id").and_then(Value::as_str) {
            enable_skill_for_session(id, root)?;
        }
        return Ok(value);
    }
    execute_skill_state_change(name, input).map_err(AgentRuntimeError::Core)
}
