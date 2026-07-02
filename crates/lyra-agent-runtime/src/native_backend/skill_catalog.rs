use super::*;
use sha2::{Digest, Sha256};
use std::io::{Cursor, copy};
use zip::ZipArchive;

const REGISTRY_FILE_NAME: &str = "registry.v1.json";
const SKILL_MD_FILE_NAME: &str = "SKILL.md";
const DEFAULT_SKILL_STORE_INDEX_URL: &str = "lyra://skills/dynamic";
const CLAUDE_PLUGINS_SKILLS_API: &str = "https://claude-plugins.dev/api/skills";
const SKILLS_SH_SEARCH_API: &str = "https://skills.sh/api/search";
const CLAWHUB_SEARCH_API: &str = "https://clawhub.ai/api/v1/search";
const CLAWHUB_DOWNLOAD_API: &str = "https://api.clawhub.ai/api/v1/skills";
const SKILL_STORE_LIMIT: usize = 24;
const SKILL_SEARCH_MAX_RESULTS: usize = 80;
const SKILL_PACKAGE_SEARCH_DEPTH: usize = 6;
const MAX_SKILL_ARCHIVE_BYTES: u64 = 50 * 1024 * 1024;
const MAX_SKILL_ARCHIVE_FILES: usize = 1_000;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SkillManifest {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) version: String,
    pub(crate) description: String,
    pub(crate) prompt: String,
    #[serde(default)]
    pub(crate) permissions: Vec<String>,
    #[serde(default)]
    pub(crate) tool_paths: Vec<String>,
    #[serde(default)]
    pub(crate) tool_capabilities: Vec<Value>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub(crate) enum SkillSource {
    Local {
        path: String,
    },
    Git {
        url: String,
        #[serde(rename = "ref", default, skip_serializing_if = "Option::is_none")]
        ref_name: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        subdir: Option<String>,
    },
    Archive {
        url: String,
    },
    Store {
        skill_id: String,
        index_url: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        source: Option<Box<SkillSource>>,
    },
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct InstalledSkill {
    pub(crate) id: String,
    pub(crate) manifest: SkillManifest,
    pub(crate) source: SkillSource,
    pub(crate) package_path: String,
    pub(crate) prompt_path: String,
    pub(crate) resource_root: String,
    pub(crate) source_fingerprint: String,
    pub(crate) installed_at: String,
    pub(crate) updated_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) last_error: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SkillStoreIndex {
    pub(crate) version: u32,
    pub(crate) updated_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) query: Option<String>,
    #[serde(default)]
    pub(crate) has_more: bool,
    #[serde(default)]
    pub(crate) skills: Vec<SkillStoreEntry>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SkillStoreEntry {
    pub(crate) id: String,
    pub(crate) name: String,
    #[serde(default)]
    pub(crate) version: String,
    #[serde(default)]
    pub(crate) description: String,
    pub(crate) source: SkillSource,
    #[serde(default)]
    pub(crate) permissions: Vec<String>,
    #[serde(default)]
    pub(crate) tool_paths: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) source_registry: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) source_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) installs: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) stars: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) score: Option<f64>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SkillRegistryDocument {
    pub(crate) version: u32,
    #[serde(default)]
    pub(crate) installed: Vec<InstalledSkill>,
    #[serde(default = "default_store_index_url")]
    pub(crate) store_index_url: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) store_index: Option<SkillStoreIndex>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) store_last_error: Option<String>,
}

impl Default for SkillRegistryDocument {
    fn default() -> Self {
        Self {
            version: 1,
            installed: Vec::new(),
            store_index_url: default_store_index_url(),
            store_index: None,
            store_last_error: None,
        }
    }
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SkillFrontmatter {
    id: Option<String>,
    name: Option<String>,
    version: Option<String>,
    description: Option<String>,
    #[serde(default)]
    permissions: Vec<String>,
    #[serde(default, alias = "tool_paths")]
    tool_paths: Vec<String>,
    #[serde(default, alias = "tool_capabilities")]
    tool_capabilities: Vec<Value>,
}

fn default_store_index_url() -> String {
    DEFAULT_SKILL_STORE_INDEX_URL.to_string()
}

pub(crate) fn skill_storage_root() -> PathBuf {
    if let Some(path) = env::var_os("LYRA_SKILLS_HOME") {
        return PathBuf::from(path);
    }
    if let Some(path) = env::var_os("LYRA_AGENT_HOME") {
        let agent_home = PathBuf::from(path);
        if let Some(modules_root) = agent_home.parent() {
            return modules_root.join("skills");
        }
    }
    let root = runtime_root();
    if cfg!(test) {
        return root.join("skills");
    }
    root.parent()
        .map(|parent| parent.join("skills"))
        .unwrap_or_else(|| root.join("skills"))
}

fn registry_path(storage_root: &Path) -> PathBuf {
    storage_root.join(REGISTRY_FILE_NAME)
}

fn read_registry_from(storage_root: &Path) -> SkillRegistryDocument {
    read_json::<SkillRegistryDocument>(&registry_path(storage_root)).unwrap_or_default()
}

fn write_registry_to(
    storage_root: &Path,
    registry: &SkillRegistryDocument,
) -> AgentRuntimeResult<()> {
    fs::create_dir_all(storage_root).map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
    write_json(&registry_path(storage_root), registry)
}

fn read_registry() -> SkillRegistryDocument {
    read_registry_from(&skill_storage_root())
}

fn package_markdown_path(root: &Path) -> PathBuf {
    root.join(SKILL_MD_FILE_NAME)
}

fn split_frontmatter(markdown: &str) -> AgentRuntimeResult<(SkillFrontmatter, String)> {
    let mut lines = markdown.lines();
    if lines.next() != Some("---") {
        return Ok((SkillFrontmatter::default(), markdown.trim().to_string()));
    }
    let mut yaml = String::new();
    let mut body = String::new();
    let mut in_frontmatter = true;
    for line in lines {
        if in_frontmatter && line == "---" {
            in_frontmatter = false;
            continue;
        }
        if in_frontmatter {
            yaml.push_str(line);
            yaml.push('\n');
        } else {
            body.push_str(line);
            body.push('\n');
        }
    }
    if in_frontmatter {
        return Err(AgentRuntimeError::Core(
            "SKILL.md frontmatter is not closed".to_string(),
        ));
    }
    let frontmatter = if yaml.trim().is_empty() {
        SkillFrontmatter::default()
    } else {
        serde_yaml::from_str::<SkillFrontmatter>(&yaml)
            .map_err(|error| AgentRuntimeError::Core(error.to_string()))?
    };
    Ok((frontmatter, body.trim().to_string()))
}

fn fallback_skill_id(root: &Path) -> String {
    root.file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("skill")
        .trim()
        .to_ascii_lowercase()
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-' | ':') {
                ch
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim_matches('-')
        .to_string()
}

fn validate_skill_id(skill_id: &str) -> AgentRuntimeResult<()> {
    let valid = skill_id.len() <= 128
        && skill_id
            .chars()
            .next()
            .is_some_and(|ch| ch.is_ascii_alphanumeric())
        && skill_id
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-' | ':'));
    if valid {
        Ok(())
    } else {
        Err(AgentRuntimeError::Core(format!(
            "invalid Lyra skill id: {skill_id}"
        )))
    }
}

fn parse_skill_package(root: &Path) -> AgentRuntimeResult<SkillManifest> {
    let markdown_path = package_markdown_path(root);
    let markdown = fs::read_to_string(&markdown_path).map_err(|error| {
        AgentRuntimeError::Core(format!(
            "failed to read {}: {error}",
            markdown_path.display()
        ))
    })?;
    let (frontmatter, prompt) = split_frontmatter(&markdown)?;
    if prompt.trim().is_empty() {
        return Err(AgentRuntimeError::Core(
            "SKILL.md body must contain skill instructions".to_string(),
        ));
    }
    let id = frontmatter
        .id
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| fallback_skill_id(root));
    validate_skill_id(&id)?;
    Ok(SkillManifest {
        name: frontmatter.name.unwrap_or_else(|| id.clone()),
        version: frontmatter.version.unwrap_or_else(|| "0.1.0".to_string()),
        description: frontmatter.description.unwrap_or_default(),
        prompt,
        permissions: frontmatter.permissions,
        tool_paths: frontmatter.tool_paths,
        tool_capabilities: frontmatter.tool_capabilities,
        id,
    })
}

fn hash_json(value: &impl Serialize) -> String {
    let payload = serde_json::to_vec(value).unwrap_or_default();
    format!("{:x}", Sha256::digest(payload))
}

fn storage_name(skill_id: &str) -> String {
    let slug = skill_id
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-') {
                ch
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim_matches('-')
        .to_string();
    let digest = &hash_json(&skill_id)[..12];
    format!("{}-{digest}", if slug.is_empty() { "skill" } else { &slug })
}

fn copy_dir_all(source: &Path, destination: &Path) -> AgentRuntimeResult<()> {
    fs::create_dir_all(destination).map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
    for entry in fs::read_dir(source).map_err(|error| AgentRuntimeError::Core(error.to_string()))? {
        let entry = entry.map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
        let file_name = entry.file_name();
        if file_name == ".git" || file_name == "node_modules" {
            continue;
        }
        let source_path = entry.path();
        let destination_path = destination.join(file_name);
        let file_type = entry
            .file_type()
            .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
        if file_type.is_dir() {
            copy_dir_all(&source_path, &destination_path)?;
        } else if file_type.is_file() {
            fs::copy(&source_path, &destination_path)
                .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
        }
    }
    Ok(())
}

fn install_package_from_root(
    storage_root: &Path,
    source_root: &Path,
    source: SkillSource,
) -> AgentRuntimeResult<InstalledSkill> {
    let source_manifest = parse_skill_package(source_root)?;
    let installed_root = storage_root
        .join("installed")
        .join(storage_name(&source_manifest.id));
    let _ = fs::remove_dir_all(&installed_root);
    if let Some(parent) = installed_root.parent() {
        fs::create_dir_all(parent).map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
    }
    copy_dir_all(source_root, &installed_root)?;
    let manifest = parse_skill_package(&installed_root)?;
    let timestamp = now();
    let mut registry = read_registry_from(storage_root);
    let existing = registry
        .installed
        .iter()
        .find(|skill| skill.id == manifest.id);
    let source_fingerprint = hash_json(&json!({
        "source": source,
        "manifest": manifest,
    }));
    let installed = InstalledSkill {
        id: manifest.id.clone(),
        source,
        prompt_path: package_markdown_path(&installed_root)
            .to_string_lossy()
            .to_string(),
        resource_root: installed_root.to_string_lossy().to_string(),
        package_path: installed_root.to_string_lossy().to_string(),
        source_fingerprint,
        installed_at: existing
            .map(|skill| skill.installed_at.clone())
            .unwrap_or_else(|| timestamp.clone()),
        updated_at: timestamp,
        last_error: None,
        manifest,
    };
    registry.installed.retain(|skill| skill.id != installed.id);
    registry.installed.push(installed.clone());
    registry
        .installed
        .sort_by(|left, right| left.id.cmp(&right.id));
    write_registry_to(storage_root, &registry)?;
    Ok(installed)
}

fn git_source_root(storage_root: &Path, source: &SkillSource) -> PathBuf {
    storage_root
        .join("sources")
        .join("git")
        .join(&hash_json(source)[..16])
}

fn clone_git_source(storage_root: &Path, source: &SkillSource) -> AgentRuntimeResult<PathBuf> {
    let SkillSource::Git {
        url,
        ref_name,
        subdir: _,
    } = source
    else {
        return Err(AgentRuntimeError::Core(
            "git source is required".to_string(),
        ));
    };
    let source_root = git_source_root(storage_root, source);
    let _ = fs::remove_dir_all(&source_root);
    if let Some(parent) = source_root.parent() {
        fs::create_dir_all(parent).map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
    }
    let mut args = vec!["clone".to_string(), "--depth".to_string(), "1".to_string()];
    if let Some(ref_name) = ref_name.as_deref().filter(|value| !value.trim().is_empty()) {
        args.push("--branch".to_string());
        args.push(ref_name.to_string());
    }
    args.push(url.clone());
    args.push(source_root.to_string_lossy().to_string());
    let output = Command::new("git")
        .args(&args)
        .output()
        .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
    if !output.status.success() {
        return Err(AgentRuntimeError::Core(
            String::from_utf8_lossy(&output.stderr).trim().to_string(),
        ));
    }
    Ok(source_root)
}

fn find_skill_markdown_paths(
    root: &Path,
    depth: usize,
    output: &mut Vec<PathBuf>,
) -> AgentRuntimeResult<()> {
    if depth == 0 || output.len() >= 64 {
        return Ok(());
    }
    for entry in fs::read_dir(root).map_err(|error| AgentRuntimeError::Core(error.to_string()))? {
        let entry = entry.map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
        let file_name = entry.file_name();
        if file_name == ".git" || file_name == "node_modules" || file_name == "target" {
            continue;
        }
        let path = entry.path();
        let file_type = entry
            .file_type()
            .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
        if file_type.is_file() && file_name == SKILL_MD_FILE_NAME {
            output.push(path);
        } else if file_type.is_dir() {
            find_skill_markdown_paths(&path, depth - 1, output)?;
        }
    }
    Ok(())
}

fn skill_hint_matches(skill_root: &Path, hint: &str) -> bool {
    let hint = hint.trim().trim_matches('/').to_ascii_lowercase();
    if hint.is_empty() {
        return false;
    }
    let folder = skill_root
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    folder == hint || hint.ends_with(&format!("/{folder}"))
}

fn locate_skill_package_root(root: &Path, hint: Option<&str>) -> AgentRuntimeResult<PathBuf> {
    if package_markdown_path(root).exists() {
        return Ok(root.to_path_buf());
    }
    let mut skill_files = Vec::new();
    find_skill_markdown_paths(root, SKILL_PACKAGE_SEARCH_DEPTH, &mut skill_files)?;
    if skill_files.is_empty() {
        return Err(AgentRuntimeError::Core(format!(
            "no SKILL.md found under {}",
            root.display()
        )));
    }
    if let Some(hint) = hint {
        if let Some(skill_file) = skill_files.iter().find(|path| {
            path.parent()
                .is_some_and(|parent| skill_hint_matches(parent, hint))
        }) {
            return Ok(skill_file.parent().unwrap_or(root).to_path_buf());
        }
    }
    if skill_files.len() == 1 {
        return Ok(skill_files[0].parent().unwrap_or(root).to_path_buf());
    }
    Err(AgentRuntimeError::Core(format!(
        "multiple SKILL.md files found under {}; paste a GitHub tree URL or local skill folder",
        root.display()
    )))
}

fn archive_source_root(storage_root: &Path, source: &SkillSource) -> PathBuf {
    storage_root
        .join("sources")
        .join("archive")
        .join(&hash_json(source)[..16])
}

fn extract_zip_bytes(bytes: Vec<u8>, source_root: &Path) -> AgentRuntimeResult<()> {
    let _ = fs::remove_dir_all(&source_root);
    fs::create_dir_all(&source_root).map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
    if bytes.len() as u64 > MAX_SKILL_ARCHIVE_BYTES {
        return Err(AgentRuntimeError::Core(
            "skill archive is too large".to_string(),
        ));
    }
    let mut archive = ZipArchive::new(Cursor::new(bytes))
        .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
    if archive.len() > MAX_SKILL_ARCHIVE_FILES {
        return Err(AgentRuntimeError::Core(
            "skill archive contains too many files".to_string(),
        ));
    }
    for index in 0..archive.len() {
        let mut file = archive
            .by_index(index)
            .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
        let Some(path) = file.enclosed_name().map(PathBuf::from) else {
            continue;
        };
        let destination = source_root.join(path);
        if file.is_dir() {
            fs::create_dir_all(&destination)
                .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
        } else {
            if let Some(parent) = destination.parent() {
                fs::create_dir_all(parent)
                    .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
            }
            let mut output = fs::File::create(&destination)
                .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
            copy(&mut file, &mut output)
                .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
        }
    }
    Ok(())
}

fn download_archive_source(
    storage_root: &Path,
    source: &SkillSource,
) -> AgentRuntimeResult<PathBuf> {
    let SkillSource::Archive { url } = source else {
        return Err(AgentRuntimeError::Core(
            "archive source is required".to_string(),
        ));
    };
    let source_root = archive_source_root(storage_root, source);
    let mut response = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|error| AgentRuntimeError::Core(error.to_string()))?
        .get(url)
        .send()
        .map_err(|error| AgentRuntimeError::Core(error.to_string()))?
        .error_for_status()
        .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
    let mut bytes = Vec::new();
    response
        .by_ref()
        .take(MAX_SKILL_ARCHIVE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
    extract_zip_bytes(bytes, &source_root)?;
    Ok(source_root)
}

fn install_local_archive(
    storage_root: &Path,
    archive_path: &Path,
    recorded_source: SkillSource,
) -> AgentRuntimeResult<InstalledSkill> {
    let bytes = fs::read(archive_path).map_err(|error| {
        AgentRuntimeError::Core(format!(
            "failed to read {}: {error}",
            archive_path.display()
        ))
    })?;
    let source_root = storage_root
        .join("sources")
        .join("local-archive")
        .join(&hash_json(&archive_path.to_string_lossy().to_string())[..16]);
    extract_zip_bytes(bytes, &source_root)?;
    let skill_root = locate_skill_package_root(&source_root, None)?;
    install_package_from_root(storage_root, &skill_root, recorded_source)
}

fn install_skill_source(
    storage_root: &Path,
    source: SkillSource,
    recorded_source: SkillSource,
) -> AgentRuntimeResult<InstalledSkill> {
    match source {
        SkillSource::Local { path } => {
            install_package_from_root(storage_root, &PathBuf::from(path), recorded_source)
        }
        SkillSource::Git { .. } => {
            let source_root = clone_git_source(storage_root, &source)?;
            let SkillSource::Git { subdir, .. } = &source else {
                unreachable!();
            };
            let candidate_root = subdir
                .as_deref()
                .filter(|value| !value.trim().is_empty())
                .map(|value| source_root.join(value.trim()))
                .unwrap_or_else(|| source_root.clone());
            let skill_root = locate_skill_package_root(&candidate_root, subdir.as_deref())
                .or_else(|_| locate_skill_package_root(&source_root, subdir.as_deref()))?;
            install_package_from_root(storage_root, &skill_root, recorded_source)
        }
        SkillSource::Archive { .. } => {
            let source_root = download_archive_source(storage_root, &source)?;
            let skill_root = locate_skill_package_root(&source_root, None)?;
            install_package_from_root(storage_root, &skill_root, recorded_source)
        }
        SkillSource::Store { .. } => Err(AgentRuntimeError::Core(
            "nested store skill source is not supported".to_string(),
        )),
    }
}

fn skill_value(skill: &InstalledSkill, active: bool, include_prompt: bool) -> Value {
    let prompt_hash = hash_json(&skill.manifest.prompt);
    let prompt_excerpt = skill.manifest.prompt.chars().take(500).collect::<String>();
    let mut manifest = serde_json::to_value(&skill.manifest).unwrap_or_else(|_| json!({}));
    if !include_prompt {
        if let Some(object) = manifest.as_object_mut() {
            object.remove("prompt");
        }
    }
    json!({
        "id": skill.id,
        "name": skill.manifest.name,
        "version": skill.manifest.version,
        "description": skill.manifest.description,
        "prompt": if include_prompt { Value::String(skill.manifest.prompt.clone()) } else { Value::Null },
        "promptExcerpt": prompt_excerpt,
        "promptHash": prompt_hash,
        "permissions": skill.manifest.permissions,
        "toolPaths": skill.manifest.tool_paths,
        "toolCapabilities": skill.manifest.tool_capabilities,
        "active": active,
        "source": skill.source,
        "packagePath": skill.package_path,
        "promptPath": skill.prompt_path,
        "resourceRoot": skill.resource_root,
        "sourceFingerprint": skill.source_fingerprint,
        "installedAt": skill.installed_at,
        "updatedAt": skill.updated_at,
        "lastError": skill.last_error,
        "manifest": manifest,
    })
}

fn installed_skill_values(active_skills: &HashSet<String>, include_prompt: bool) -> Vec<Value> {
    read_registry()
        .installed
        .iter()
        .map(|skill| skill_value(skill, active_skills.contains(&skill.id), include_prompt))
        .collect()
}

fn installed_skill_value(
    skill_id: &str,
    active_skills: &HashSet<String>,
    include_prompt: bool,
) -> Option<Value> {
    read_registry()
        .installed
        .iter()
        .find(|skill| skill.id == skill_id)
        .map(|skill| skill_value(skill, active_skills.contains(&skill.id), include_prompt))
}

pub(crate) fn native_skill_states(active_skills: &HashSet<String>) -> Vec<Value> {
    installed_skill_values(active_skills, false)
}

pub(crate) fn native_skill_state(skill_id: &str, active_skills: &HashSet<String>) -> Option<Value> {
    installed_skill_value(skill_id, active_skills, true)
}

pub(crate) fn active_skill_prompt_for(active_skills: &HashSet<String>) -> String {
    read_registry()
        .installed
        .iter()
        .filter(|skill| active_skills.contains(&skill.id))
        .map(|skill| {
            format!(
                "Skill {} ({}):\n{}",
                skill.id,
                skill.manifest.name,
                skill.manifest.prompt.trim()
            )
        })
        .collect::<Vec<_>>()
        .join("\n\n")
}

pub(crate) fn active_skill_context(active_skills: &HashSet<String>) -> Value {
    Value::Array(
        read_registry()
            .installed
            .iter()
            .filter(|skill| active_skills.contains(&skill.id))
            .map(|skill| {
                json!({
                    "id": skill.id,
                    "name": skill.manifest.name,
                    "version": skill.manifest.version,
                    "active": true,
                    "source": skill.source,
                    "permissions": skill.manifest.permissions,
                    "toolPaths": skill.manifest.tool_paths,
                    "promptHash": hash_json(&skill.manifest.prompt),
                    "resourceRoot": skill.resource_root,
                })
            })
            .collect(),
    )
}

fn store_value(registry: &SkillRegistryDocument) -> Value {
    json!({
        "indexUrl": registry.store_index_url,
        "index": registry.store_index,
        "lastError": registry.store_last_error,
    })
}

pub(crate) fn skill_list() -> AgentRuntimeResult<Value> {
    let active_skills = state()
        .lock()
        .map_err(|_| AgentRuntimeError::Core("agent runtime state lock failed".to_string()))?
        .active_skills
        .clone();
    let storage_root = skill_storage_root();
    let mut registry = read_registry_from(&storage_root);
    registry.store_index_url = default_store_index_url();
    if registry.store_index.is_none() {
        if let Ok((index, warning)) = fetch_store_index("", 0) {
            registry.store_index = Some(index);
            registry.store_last_error = warning;
            let _ = write_registry_to(&storage_root, &registry);
        }
    }
    Ok(json!({
        "skills": registry
            .installed
            .iter()
            .map(|skill| skill_value(skill, active_skills.contains(&skill.id), false))
            .collect::<Vec<_>>(),
        "store": store_value(&registry),
    }))
}

pub(crate) fn skill_inspect(payload: Value) -> AgentRuntimeResult<Value> {
    let skill_id = string_opt(&payload, "skillId")
        .ok_or_else(|| AgentRuntimeError::Core("skillId is required".to_string()))?;
    let active_skills = state()
        .lock()
        .map_err(|_| AgentRuntimeError::Core("agent runtime state lock failed".to_string()))?
        .active_skills
        .clone();
    let skill = native_skill_state(&skill_id, &active_skills).ok_or_else(|| {
        AgentRuntimeError::Core(format!("Lyra skill is not installed: {skill_id}"))
    })?;
    Ok(json!({ "skill": skill }))
}

pub(crate) fn set_skill_active(payload: Value, active: bool) -> AgentRuntimeResult<Value> {
    let skill_id = string_opt(&payload, "skillId")
        .ok_or_else(|| AgentRuntimeError::Core("skillId is required".to_string()))?;
    if !read_registry()
        .installed
        .iter()
        .any(|skill| skill.id == skill_id)
    {
        return Err(AgentRuntimeError::Core(format!(
            "Lyra skill is not installed: {skill_id}"
        )));
    }
    let mut state = state()
        .lock()
        .map_err(|_| AgentRuntimeError::Core("agent runtime state lock failed".to_string()))?;
    if active {
        state.active_skills.insert(skill_id.clone());
    } else {
        state.active_skills.remove(&skill_id);
    }
    state.save_state()?;
    let skill = native_skill_state(&skill_id, &state.active_skills).ok_or_else(|| {
        AgentRuntimeError::Core(format!("Lyra skill is not installed: {skill_id}"))
    })?;
    Ok(
        json!({ "skill": skill, "activeSkills": state.active_skills.iter().cloned().collect::<Vec<_>>() }),
    )
}

pub(crate) fn skill_install_from_local(payload: Value) -> AgentRuntimeResult<Value> {
    let source_path = string_opt(&payload, "sourcePath")
        .ok_or_else(|| AgentRuntimeError::Core("sourcePath is required".to_string()))?;
    let source_path = fs::canonicalize(source_path)
        .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
    let install_root = if source_path.is_file()
        && source_path
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.eq_ignore_ascii_case(SKILL_MD_FILE_NAME))
    {
        source_path.parent().unwrap_or(&source_path).to_path_buf()
    } else {
        source_path.clone()
    };
    let source = SkillSource::Local {
        path: install_root.to_string_lossy().to_string(),
    };
    let skill = if source_path.is_file()
        && source_path
            .extension()
            .and_then(|extension| extension.to_str())
            .is_some_and(|extension| extension.eq_ignore_ascii_case("zip"))
    {
        install_local_archive(&skill_storage_root(), &source_path, source)?
    } else {
        install_skill_source(&skill_storage_root(), source.clone(), source)?
    };
    Ok(json!({ "skill": skill_value(&skill, false, true) }))
}

pub(crate) fn skill_install_from_git(payload: Value) -> AgentRuntimeResult<Value> {
    let url = string_opt(&payload, "url")
        .ok_or_else(|| AgentRuntimeError::Core("url is required".to_string()))?;
    let source = SkillSource::Git {
        url,
        ref_name: string_opt(&payload, "ref"),
        subdir: string_opt(&payload, "subdir"),
    };
    let skill = install_skill_source(&skill_storage_root(), source.clone(), source)?;
    Ok(json!({ "skill": skill_value(&skill, false, true) }))
}

fn string_at<'a>(value: &'a Value, pointer: &str) -> Option<&'a str> {
    value.pointer(pointer).and_then(Value::as_str)
}

fn u64_at(value: &Value, pointer: &str) -> Option<u64> {
    value.pointer(pointer).and_then(Value::as_u64)
}

fn f64_at(value: &Value, pointer: &str) -> Option<f64> {
    value.pointer(pointer).and_then(Value::as_f64)
}

fn normalized_store_key(value: &str) -> String {
    value
        .to_ascii_lowercase()
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric())
        .collect()
}

fn store_entry_dedupe_key(entry: &SkillStoreEntry) -> String {
    match &entry.source {
        SkillSource::Git { url, subdir, .. } => format!(
            "git:{}:{}",
            url.to_ascii_lowercase().trim_end_matches(".git"),
            subdir.as_deref().unwrap_or_default().to_ascii_lowercase()
        ),
        SkillSource::Archive { url } => format!("archive:{}", url.to_ascii_lowercase()),
        _ => format!("name:{}", normalized_store_key(&entry.name)),
    }
}

fn merge_store_entries(entries: Vec<SkillStoreEntry>) -> Vec<SkillStoreEntry> {
    let mut by_key = HashMap::<String, SkillStoreEntry>::new();
    for entry in entries {
        let key = store_entry_dedupe_key(&entry);
        let replace = by_key
            .get(&key)
            .map(|existing| entry.installs.unwrap_or(0) > existing.installs.unwrap_or(0))
            .unwrap_or(true);
        if replace {
            by_key.insert(key, entry);
        }
    }
    let mut entries = by_key.into_values().collect::<Vec<_>>();
    entries.sort_by(|left, right| {
        right
            .installs
            .unwrap_or(0)
            .cmp(&left.installs.unwrap_or(0))
            .then_with(|| {
                left.name
                    .to_ascii_lowercase()
                    .cmp(&right.name.to_ascii_lowercase())
            })
    });
    entries.truncate(SKILL_SEARCH_MAX_RESULTS);
    entries
}

fn github_tree_source(source_url: &str) -> Option<SkillSource> {
    let url = Url::parse(source_url).ok()?;
    if url.host_str()? != "github.com" {
        return None;
    }
    let parts = url
        .path_segments()?
        .map(|part| {
            urlencoding::decode(part)
                .ok()
                .map(|value| value.to_string())
        })
        .collect::<Option<Vec<_>>>()?;
    let owner = parts.first()?;
    let repo = parts.get(1)?.trim_end_matches(".git");
    if owner.is_empty() || repo.is_empty() {
        return None;
    }
    let tree_index = parts.iter().position(|part| part == "tree");
    Some(SkillSource::Git {
        url: format!("https://github.com/{owner}/{repo}.git"),
        ref_name: tree_index.and_then(|index| parts.get(index + 1).cloned()),
        subdir: tree_index
            .map(|index| {
                parts
                    .iter()
                    .skip(index + 2)
                    .cloned()
                    .collect::<Vec<_>>()
                    .join("/")
            })
            .filter(|value| !value.is_empty()),
    })
}

fn fetch_json(client: &reqwest::blocking::Client, url: Url) -> AgentRuntimeResult<Value> {
    client
        .get(url)
        .send()
        .map_err(|error| AgentRuntimeError::Core(error.to_string()))?
        .error_for_status()
        .map_err(|error| AgentRuntimeError::Core(error.to_string()))?
        .json::<Value>()
        .map_err(|error| AgentRuntimeError::Core(error.to_string()))
}

fn fetch_claude_plugins_entries(
    client: &reqwest::blocking::Client,
    query: &str,
    offset: usize,
) -> AgentRuntimeResult<Vec<SkillStoreEntry>> {
    let mut url = Url::parse(CLAUDE_PLUGINS_SKILLS_API)
        .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
    if !query.is_empty() {
        url.query_pairs_mut().append_pair("q", query);
    }
    url.query_pairs_mut()
        .append_pair("limit", &SKILL_STORE_LIMIT.to_string())
        .append_pair("offset", &offset.to_string());
    let json = fetch_json(client, url)?;
    let Some(skills) = json.get("skills").and_then(Value::as_array) else {
        return Ok(Vec::new());
    };
    let entries = skills
        .iter()
        .filter_map(|skill| {
            let name = string_at(skill, "/name")?.to_string();
            let owner = string_at(skill, "/metadata/repoOwner").unwrap_or_default();
            let repo = string_at(skill, "/metadata/repoName").unwrap_or_default();
            let directory = string_at(skill, "/metadata/directoryPath").unwrap_or_default();
            let source_url = string_at(skill, "/sourceUrl").map(str::to_string);
            let source = if !owner.is_empty() && !repo.is_empty() {
                Some(SkillSource::Git {
                    url: format!("https://github.com/{owner}/{repo}.git"),
                    ref_name: None,
                    subdir: (!directory.is_empty()).then(|| directory.to_string()),
                })
            } else {
                source_url.as_deref().and_then(github_tree_source)
            }?;
            Some(SkillStoreEntry {
                id: format!(
                    "claude-plugins:{}",
                    string_at(skill, "/namespace")
                        .or_else(|| string_at(skill, "/sourceUrl"))
                        .or_else(|| string_at(skill, "/id"))
                        .unwrap_or(name.as_str())
                ),
                name,
                version: string_at(skill, "/version").unwrap_or_default().to_string(),
                description: string_at(skill, "/description")
                    .unwrap_or_default()
                    .to_string(),
                source,
                permissions: Vec::new(),
                tool_paths: Vec::new(),
                source_registry: Some("claude-plugins.dev".to_string()),
                source_url,
                installs: u64_at(skill, "/installs"),
                stars: u64_at(skill, "/stars"),
                score: None,
            })
        })
        .collect::<Vec<_>>();
    Ok(entries)
}

fn fetch_skills_sh_entries(
    client: &reqwest::blocking::Client,
    query: &str,
    offset: usize,
) -> AgentRuntimeResult<Vec<SkillStoreEntry>> {
    if query.chars().count() < 2 {
        return Ok(Vec::new());
    }
    let mut url = Url::parse(SKILLS_SH_SEARCH_API)
        .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
    url.query_pairs_mut()
        .append_pair("q", query)
        .append_pair("limit", &SKILL_STORE_LIMIT.to_string())
        .append_pair("offset", &offset.to_string());
    let json = fetch_json(client, url)?;
    let Some(skills) = json.get("skills").and_then(Value::as_array) else {
        return Ok(Vec::new());
    };
    let entries = skills
        .iter()
        .filter_map(|skill| {
            let id = string_at(skill, "/id")?;
            let source_repo = string_at(skill, "/source")?;
            let name = string_at(skill, "/name")
                .or_else(|| string_at(skill, "/skillId"))
                .unwrap_or(id)
                .to_string();
            let subdir = id
                .strip_prefix(&format!("{source_repo}/"))
                .filter(|value| !value.trim().is_empty())
                .map(str::to_string);
            Some(SkillStoreEntry {
                id: format!("skills.sh:{id}"),
                name,
                version: String::new(),
                description: String::new(),
                source: SkillSource::Git {
                    url: format!("https://github.com/{source_repo}.git"),
                    ref_name: None,
                    subdir,
                },
                permissions: Vec::new(),
                tool_paths: Vec::new(),
                source_registry: Some("skills.sh".to_string()),
                source_url: Some(format!("https://github.com/{source_repo}")),
                installs: u64_at(skill, "/installs"),
                stars: None,
                score: None,
            })
        })
        .collect::<Vec<_>>();
    Ok(entries)
}

fn fetch_clawhub_entries(
    client: &reqwest::blocking::Client,
    query: &str,
    offset: usize,
) -> AgentRuntimeResult<Vec<SkillStoreEntry>> {
    let mut url = Url::parse(CLAWHUB_SEARCH_API)
        .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
    url.query_pairs_mut()
        .append_pair("q", query)
        .append_pair("limit", &SKILL_STORE_LIMIT.to_string())
        .append_pair("offset", &offset.to_string());
    let json = fetch_json(client, url)?;
    let Some(skills) = json.get("results").and_then(Value::as_array) else {
        return Ok(Vec::new());
    };
    let entries = skills
        .iter()
        .filter_map(|skill| {
            let slug = string_at(skill, "/slug")?;
            let name = string_at(skill, "/displayName").unwrap_or(slug).to_string();
            Some(SkillStoreEntry {
                id: format!("clawhub:{slug}"),
                name,
                version: string_at(skill, "/version").unwrap_or_default().to_string(),
                description: string_at(skill, "/summary").unwrap_or_default().to_string(),
                source: SkillSource::Archive {
                    url: format!("{CLAWHUB_DOWNLOAD_API}/{slug}/download"),
                },
                permissions: Vec::new(),
                tool_paths: Vec::new(),
                source_registry: Some("clawhub.ai".to_string()),
                source_url: Some(format!("https://clawhub.ai/skills/{slug}")),
                installs: u64_at(skill, "/downloads"),
                stars: None,
                score: f64_at(skill, "/score"),
            })
        })
        .collect::<Vec<_>>();
    Ok(entries)
}

fn fetch_store_index(
    query: &str,
    offset: usize,
) -> AgentRuntimeResult<(SkillStoreIndex, Option<String>)> {
    let query = query.trim();
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(20))
        .user_agent("Lyra")
        .build()
        .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
    let mut entries = Vec::new();
    let mut errors = Vec::new();
    match fetch_skills_sh_entries(&client, query, offset) {
        Ok(value) => entries.extend(value),
        Err(error) => errors.push(format!("skills.sh: {error}")),
    }
    match fetch_claude_plugins_entries(&client, query, offset) {
        Ok(value) => entries.extend(value),
        Err(error) => errors.push(format!("claude-plugins.dev: {error}")),
    }
    match fetch_clawhub_entries(&client, query, offset) {
        Ok(value) => entries.extend(value),
        Err(error) => errors.push(format!("clawhub.ai: {error}")),
    }
    let has_more = entries.len() >= SKILL_STORE_LIMIT;
    let entries = merge_store_entries(entries);
    if entries.is_empty() && !errors.is_empty() {
        return Err(AgentRuntimeError::Core(errors.join("; ")));
    }
    Ok((
        SkillStoreIndex {
            version: 1,
            updated_at: now(),
            query: (!query.is_empty()).then(|| query.to_string()),
            has_more,
            skills: entries,
        },
        (!errors.is_empty()).then(|| errors.join("; ")),
    ))
}

pub(crate) fn skill_refresh_store(payload: Value) -> AgentRuntimeResult<Value> {
    let storage_root = skill_storage_root();
    let mut registry = read_registry_from(&storage_root);
    registry.store_index_url = default_store_index_url();
    let query = string_opt(&payload, "query").unwrap_or_default();
    let offset = payload.get("offset").and_then(Value::as_u64).unwrap_or(0) as usize;
    let append = payload
        .get("append")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    match fetch_store_index(&query, offset) {
        Ok((mut index, warning)) => {
            if append {
                if let Some(existing) = registry.store_index.as_ref() {
                    if existing.query.as_deref().unwrap_or_default()
                        == index.query.as_deref().unwrap_or_default()
                    {
                        let mut skills = existing.skills.clone();
                        skills.extend(index.skills);
                        index.skills = merge_store_entries(skills);
                    }
                }
            }
            registry.store_index = Some(index);
            registry.store_last_error = warning;
            write_registry_to(&storage_root, &registry)?;
            Ok(json!({ "store": store_value(&registry) }))
        }
        Err(error) => {
            registry.store_last_error = Some(error.to_string());
            let _ = write_registry_to(&storage_root, &registry);
            Err(error)
        }
    }
}

pub(crate) fn skill_update_store_config(payload: Value) -> AgentRuntimeResult<Value> {
    skill_refresh_store(payload)
}

pub(crate) fn skill_install_from_store(payload: Value) -> AgentRuntimeResult<Value> {
    let skill_id = string_opt(&payload, "skillId")
        .ok_or_else(|| AgentRuntimeError::Core("skillId is required".to_string()))?;
    let storage_root = skill_storage_root();
    let mut registry = read_registry_from(&storage_root);
    registry.store_index_url = default_store_index_url();
    if registry.store_index.is_none() {
        let (index, warning) = fetch_store_index("", 0)?;
        registry.store_index = Some(index);
        registry.store_last_error = warning;
        write_registry_to(&storage_root, &registry)?;
    }
    let entry = registry
        .store_index
        .as_ref()
        .and_then(|index| index.skills.iter().find(|skill| skill.id == skill_id))
        .cloned()
        .ok_or_else(|| {
            AgentRuntimeError::Core(format!("Lyra skill store entry not found: {skill_id}"))
        })?;
    let recorded_source = SkillSource::Store {
        skill_id: skill_id.clone(),
        index_url: registry.store_index_url.clone(),
        source: Some(Box::new(entry.source.clone())),
    };
    let skill = install_skill_source(&storage_root, entry.source, recorded_source)?;
    let mut state = state()
        .lock()
        .map_err(|_| AgentRuntimeError::Core("agent runtime state lock failed".to_string()))?;
    state.active_skills.insert(skill.id.clone());
    state.save_state()?;
    Ok(json!({ "skill": skill_value(&skill, true, true) }))
}

pub(crate) fn skill_uninstall(payload: Value) -> AgentRuntimeResult<Value> {
    let skill_id = string_opt(&payload, "skillId")
        .ok_or_else(|| AgentRuntimeError::Core("skillId is required".to_string()))?;
    let storage_root = skill_storage_root();
    let mut registry = read_registry_from(&storage_root);
    let removed = registry
        .installed
        .iter()
        .find(|skill| skill.id == skill_id)
        .cloned();
    registry.installed.retain(|skill| skill.id != skill_id);
    if let Some(skill) = removed.as_ref() {
        let _ = fs::remove_dir_all(&skill.package_path);
    }
    write_registry_to(&storage_root, &registry)?;
    let mut state = state()
        .lock()
        .map_err(|_| AgentRuntimeError::Core("agent runtime state lock failed".to_string()))?;
    state.active_skills.remove(&skill_id);
    state.save_state()?;
    Ok(json!({ "skillId": skill_id, "removed": removed.is_some() }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::tempdir;
    use zip::write::SimpleFileOptions;

    fn write_skill(root: &Path, body: &str) {
        fs::create_dir_all(root).expect("create skill dir");
        fs::write(root.join(SKILL_MD_FILE_NAME), body).expect("write skill");
    }

    #[test]
    fn parses_skill_md_frontmatter_and_prompt() {
        let temp = tempdir().expect("tempdir");
        write_skill(
            temp.path(),
            r#"---
id: review-skill
name: Review Skill
description: Review code
version: 1.2.3
permissions:
  - files.read
toolPaths:
  - /tools/codegraph/search
---
Use the review checklist.
"#,
        );

        let manifest = parse_skill_package(temp.path()).expect("parse skill");
        assert_eq!(manifest.id, "review-skill");
        assert_eq!(manifest.name, "Review Skill");
        assert_eq!(manifest.version, "1.2.3");
        assert_eq!(manifest.permissions, vec!["files.read"]);
        assert_eq!(manifest.tool_paths, vec!["/tools/codegraph/search"]);
        assert_eq!(manifest.prompt, "Use the review checklist.");
    }

    #[test]
    fn installs_local_skill_and_writes_registry() {
        let temp = tempdir().expect("tempdir");
        let package = temp.path().join("package");
        let storage = temp.path().join("storage");
        write_skill(
            &package,
            r#"---
id: test-skill
name: Test Skill
---
Do the test thing.
"#,
        );

        let source = SkillSource::Local {
            path: package.to_string_lossy().to_string(),
        };
        let installed = install_skill_source(&storage, source.clone(), source).expect("install");
        assert_eq!(installed.id, "test-skill");
        assert!(Path::new(&installed.prompt_path).exists());
        let registry = read_registry_from(&storage);
        assert_eq!(registry.installed.len(), 1);
        assert_eq!(registry.installed[0].id, "test-skill");
    }

    #[test]
    fn installs_local_zip_skill() {
        let temp = tempdir().expect("tempdir");
        let storage = temp.path().join("storage");
        let archive_path = temp.path().join("skill.zip");
        let archive_file = fs::File::create(&archive_path).expect("create zip");
        let mut archive = zip::ZipWriter::new(archive_file);
        archive
            .start_file("review/SKILL.md", SimpleFileOptions::default())
            .expect("start skill file");
        archive
            .write_all(
                br#"---
id: zip-skill
name: Zip Skill
---
Use zip-installed instructions.
"#,
            )
            .expect("write skill");
        archive.finish().expect("finish zip");

        let source = SkillSource::Local {
            path: archive_path.to_string_lossy().to_string(),
        };
        let installed = install_local_archive(&storage, &archive_path, source).expect("install");
        assert_eq!(installed.id, "zip-skill");
        assert!(installed.manifest.prompt.contains("zip-installed"));
    }

    #[test]
    fn parses_github_tree_source() {
        let source =
            github_tree_source("https://github.com/acme/skill-pack/tree/main/skills/review-skill")
                .expect("parse source");
        let SkillSource::Git {
            url,
            ref_name,
            subdir,
        } = source
        else {
            panic!("expected git source");
        };
        assert_eq!(url, "https://github.com/acme/skill-pack.git");
        assert_eq!(ref_name.as_deref(), Some("main"));
        assert_eq!(subdir.as_deref(), Some("skills/review-skill"));
    }

    #[test]
    fn locates_nested_skill_package_root() {
        let temp = tempdir().expect("tempdir");
        let skill_root = temp.path().join("repo").join("skills").join("review");
        write_skill(
            &skill_root,
            r#"---
id: nested-review
---
Review nested packages.
"#,
        );

        let found = locate_skill_package_root(&temp.path().join("repo"), Some("skills/review"))
            .expect("locate skill");
        assert_eq!(found, skill_root);
    }

    #[test]
    fn merge_store_entries_deduplicates_git_source() {
        let source = SkillSource::Git {
            url: "https://github.com/acme/skills.git".to_string(),
            ref_name: None,
            subdir: Some("skills/review".to_string()),
        };
        let entries = merge_store_entries(vec![
            SkillStoreEntry {
                id: "skills.sh:acme/skills/review".to_string(),
                name: "Review".to_string(),
                version: String::new(),
                description: String::new(),
                source: source.clone(),
                permissions: Vec::new(),
                tool_paths: Vec::new(),
                source_registry: Some("skills.sh".to_string()),
                source_url: None,
                installs: Some(1),
                stars: None,
                score: None,
            },
            SkillStoreEntry {
                id: "claude-plugins:review".to_string(),
                name: "Review".to_string(),
                version: String::new(),
                description: String::new(),
                source,
                permissions: Vec::new(),
                tool_paths: Vec::new(),
                source_registry: Some("claude-plugins.dev".to_string()),
                source_url: None,
                installs: Some(10),
                stars: None,
                score: None,
            },
        ]);
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].id, "claude-plugins:review");
    }

    #[test]
    fn active_skill_prompt_uses_active_ids() {
        let temp = tempdir().expect("tempdir");
        let package = temp.path().join("package");
        let storage = temp.path().join("storage");
        write_skill(
            &package,
            r#"---
id: active-skill
name: Active Skill
---
Always say active.
"#,
        );
        let source = SkillSource::Local {
            path: package.to_string_lossy().to_string(),
        };
        install_skill_source(&storage, source.clone(), source).expect("install");
        let registry = read_registry_from(&storage);
        let active = HashSet::from(["active-skill".to_string()]);
        let prompt = registry
            .installed
            .iter()
            .filter(|skill| active.contains(&skill.id))
            .map(|skill| skill.manifest.prompt.clone())
            .collect::<Vec<_>>()
            .join("\n");
        assert!(prompt.contains("Always say active."));
    }

    #[test]
    fn installs_git_skill_from_temp_repo() {
        let temp = tempdir().expect("tempdir");
        let repo = temp.path().join("repo");
        let storage = temp.path().join("storage");
        write_skill(
            &repo,
            r#"---
id: git-skill
name: Git Skill
---
Use git-installed instructions.
"#,
        );
        Command::new("git")
            .args(["init"])
            .current_dir(&repo)
            .output()
            .expect("git init");
        Command::new("git")
            .args(["config", "user.email", "test@example.com"])
            .current_dir(&repo)
            .output()
            .expect("git config email");
        Command::new("git")
            .args(["config", "user.name", "Test User"])
            .current_dir(&repo)
            .output()
            .expect("git config name");
        Command::new("git")
            .args(["add", "."])
            .current_dir(&repo)
            .output()
            .expect("git add");
        Command::new("git")
            .args(["commit", "-m", "skill"])
            .current_dir(&repo)
            .output()
            .expect("git commit");

        let source = SkillSource::Git {
            url: repo.to_string_lossy().to_string(),
            ref_name: None,
            subdir: None,
        };
        let installed = install_skill_source(&storage, source.clone(), source).expect("install");
        assert_eq!(installed.id, "git-skill");
        assert!(installed.manifest.prompt.contains("git-installed"));
    }
}
