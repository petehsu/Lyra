use std::collections::HashMap;
use std::fs;
use std::path::{Component, Path, PathBuf};

use napi::{Error, Result, Status};
use napi_derive::napi;
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use sha2::{Digest, Sha256};
use walkdir::WalkDir;

const FRONTMATTER_DELIMITER: &str = "---";
const SKILLS_STORAGE_VERSION: u8 = 1;
const SKILL_SCOPE_GLOBAL: &str = "global";
const SKILL_SCOPE_PROJECT: &str = "project";

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SkillFileSummary {
    path: String,
    kind: String,
    size: Option<u64>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SkillCompatibility {
    source_kind: String,
    detected_from: Vec<String>,
    notes: Vec<String>,
    parse_errors: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    strict: Option<bool>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LyraSkillManifest {
    id: String,
    name: String,
    version: String,
    description: String,
    category: String,
    icon_key: String,
    source_kind: String,
    skill_type: String,
    entry_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    author: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    trigger_summary: Option<String>,
    assets: Vec<SkillFileSummary>,
    scripts: Vec<String>,
    permissions: Vec<String>,
    compatibility: SkillCompatibility,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SkillImportPreviewItem {
    preview_id: String,
    manifest: LyraSkillManifest,
    source_path: String,
    has_scripts: bool,
    has_resources: bool,
    parse_errors: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SkillImportDiscovery {
    source_path: String,
    detected_kind: String,
    source_kind: String,
    summary: String,
    preview_items: Vec<SkillImportPreviewItem>,
    parse_errors: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SkillCatalogItem {
    #[serde(flatten)]
    manifest: LyraSkillManifest,
    featured: bool,
    official: bool,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CollectSkillFileSummariesRequest {
    root_path: String,
    base_path: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DiscoverSkillImportSourceRequest {
    source_path: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BuiltinSkillDefinition {
    id: String,
    name: String,
    description: String,
    category: String,
    icon_key: String,
    files: HashMap<String, String>,
    skill_type: String,
    trigger_summary: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BuildBuiltinSkillsCatalogRequest {
    items: Vec<BuiltinSkillDefinition>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CopySkillPackageRequest {
    source_path: String,
    target_directory: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WriteBuiltinSkillPackageRequest {
    target_directory: String,
    files: HashMap<String, String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateLyraSkillPackageRequest {
    package_path: String,
    name: String,
    description: String,
    category: String,
    icon_key: Option<String>,
    skill_type: String,
    content: Option<String>,
    version: Option<String>,
    author: Option<String>,
    trigger_summary: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CreateLyraSkillPackageResult {
    skill_id: String,
    manifest: LyraSkillManifest,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReadSkillContentPreviewRequest {
    package_path: String,
    entry_path: String,
    max_chars: Option<usize>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ReadSkillContentPreviewResult {
    content_preview: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct InstalledSkillConfig {
    skill_id: String,
    scope: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    project_root: Option<String>,
    manifest: LyraSkillManifest,
    package_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    source_path: Option<String>,
    trust_state: String,
    enable_state: String,
    installed_at: String,
    updated_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    last_error: Option<String>,
    source_summary: Vec<SkillFileSummary>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PersistedSkillsDocument {
    version: u8,
    scope: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    project_root: Option<String>,
    skills: Vec<InstalledSkillConfig>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EffectiveSkillConfig {
    #[serde(flatten)]
    skill: InstalledSkillConfig,
    effective_scope: String,
    inherited_from_global: bool,
    overridden_fields: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct EffectiveSkillsResult {
    #[serde(skip_serializing_if = "Option::is_none")]
    resolved_project_root: Option<String>,
    skills: Vec<EffectiveSkillConfig>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReadSkillsScopeDocumentRequest {
    storage_root: String,
    scope: String,
    project_root: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WriteSkillsScopeDocumentRequest {
    storage_root: String,
    document: PersistedSkillsDocument,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MergeEffectiveSkillsRequest {
    resolved_project_root: Option<String>,
    global_document: PersistedSkillsDocument,
    project_document: PersistedSkillsDocument,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateInstalledSkillStateRequest {
    document: PersistedSkillsDocument,
    skill_id: String,
    trust_state: Option<String>,
    enable_state: Option<String>,
    updated_at: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateInstalledSkillStateResult {
    document: PersistedSkillsDocument,
    skill: InstalledSkillConfig,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RemoveInstalledSkillRequest {
    document: PersistedSkillsDocument,
    skill_id: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RemoveInstalledSkillResult {
    document: PersistedSkillsDocument,
    removed_skill: InstalledSkillConfig,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BuiltinSkillPackagePayload {
    catalog: SkillCatalogItem,
    files: HashMap<String, String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
enum InstallSkillsSource {
    Catalog {
        item_ids: Vec<String>,
        packages: Vec<BuiltinSkillPackagePayload>,
    },
    Discovery {
        item_ids: Vec<String>,
        discovery: SkillImportDiscovery,
    },
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct InstallSkillsRequest {
    storage_root: String,
    scope: String,
    project_root: Option<String>,
    now_iso: String,
    source: InstallSkillsSource,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct InstallSkillsResult {
    document: PersistedSkillsDocument,
    installed: Vec<InstalledSkillConfig>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateAndInstallLyraSkillRequest {
    storage_root: String,
    scope: String,
    project_root: Option<String>,
    name: String,
    description: String,
    category: String,
    icon_key: Option<String>,
    skill_type: String,
    content: Option<String>,
    version: Option<String>,
    author: Option<String>,
    trigger_summary: Option<String>,
    now_iso: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CreateAndInstallLyraSkillResult {
    document: PersistedSkillsDocument,
    skill: InstalledSkillConfig,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateInstalledSkillStateInStorageRequest {
    storage_root: String,
    scope: String,
    project_root: Option<String>,
    skill_id: String,
    trust_state: Option<String>,
    enable_state: Option<String>,
    updated_at: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RemoveInstalledSkillInStorageRequest {
    storage_root: String,
    scope: String,
    project_root: Option<String>,
    skill_id: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RemoveInstalledSkillInStorageResult {
    document: PersistedSkillsDocument,
    removed_skill: InstalledSkillConfig,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReadInstalledSkillDetailsRequest {
    storage_root: String,
    scope: String,
    project_root: Option<String>,
    skill_id: String,
    max_chars: Option<usize>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ReadInstalledSkillDetailsResult {
    skill: InstalledSkillConfig,
    content_preview: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
struct ClaudePluginBundle {
    plugins: Option<Vec<ClaudePluginEntry>>,
}

#[derive(Clone, Debug, Deserialize)]
struct ClaudePluginEntry {
    name: Option<String>,
    strict: Option<bool>,
    skills: Option<Vec<String>>,
}

fn to_error(message: impl Into<String>) -> Error {
    Error::new(Status::InvalidArg, message.into())
}

fn parse_json<T: DeserializeOwned>(input: &str) -> Result<T> {
    serde_json::from_str(input).map_err(|error| to_error(format!("invalid JSON payload: {error}")))
}

fn to_json<T: Serialize>(value: &T) -> Result<String> {
    serde_json::to_string(value)
        .map_err(|error| to_error(format!("failed to serialize payload: {error}")))
}

fn trim_or_none(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn strip_quotes(value: &str) -> String {
    value
        .trim()
        .trim_start_matches(['"', '\''])
        .trim_end_matches(['"', '\''])
        .to_string()
}

fn frontmatter_string(attributes: &HashMap<String, String>, key: &str) -> Option<String> {
    attributes
        .get(key)
        .map(|value| strip_quotes(value))
        .and_then(|value| trim_or_none(&value))
}

fn frontmatter_bool(attributes: &HashMap<String, String>, key: &str) -> bool {
    attributes
        .get(key)
        .map(|value| strip_quotes(value).to_lowercase() == "true")
        .unwrap_or(false)
}

fn slugify(value: &str) -> String {
    let mut output = String::new();
    let mut previous_dash = false;

    for character in value.trim().chars().flat_map(char::to_lowercase) {
        if character.is_ascii_alphanumeric() {
            output.push(character);
            previous_dash = false;
            continue;
        }

        if previous_dash {
            continue;
        }
        output.push('-');
        previous_dash = true;
    }

    let trimmed = output
        .trim_matches('-')
        .chars()
        .take(64)
        .collect::<String>();
    if trimmed.is_empty() {
        "skill".to_string()
    } else {
        trimmed
    }
}

fn normalize_absolute_path(value: &str) -> Result<PathBuf> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(to_error("path is required"));
    }

    let path = PathBuf::from(trimmed);
    if path.is_absolute() {
        return Ok(path);
    }

    std::env::current_dir()
        .map(|base| base.join(path))
        .map_err(|error| to_error(format!("failed to resolve path: {error}")))
}

fn path_to_string(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn hash_project_root(project_root: &str) -> String {
    let digest = Sha256::digest(project_root.as_bytes());
    let mut output = String::new();
    for byte in &digest[..8] {
        output.push_str(&format!("{byte:02x}"));
    }
    output
}

fn build_storage_root_path(storage_root: &str) -> PathBuf {
    PathBuf::from(storage_root)
}

fn build_global_document_path(storage_root: &Path) -> PathBuf {
    storage_root.join("global.skills.json")
}

fn build_project_document_path(storage_root: &Path, project_root: &str) -> PathBuf {
    storage_root
        .join("projects")
        .join(hash_project_root(project_root))
        .join("skills.json")
}

fn build_packages_root_path(storage_root: &Path) -> PathBuf {
    storage_root.join("packages")
}

fn build_scope_package_directory(
    storage_root: &Path,
    scope: &str,
    skill_id: &str,
    project_root: Option<&str>,
) -> Result<PathBuf> {
    match scope {
        SKILL_SCOPE_GLOBAL => Ok(build_packages_root_path(storage_root)
            .join(SKILL_SCOPE_GLOBAL)
            .join(skill_id)),
        SKILL_SCOPE_PROJECT => Ok(build_packages_root_path(storage_root)
            .join("projects")
            .join(hash_project_root(project_root.ok_or_else(|| {
                to_error("project scope requires a project root")
            })?))
            .join(skill_id)),
        other => Err(to_error(format!("invalid skills scope: {other}"))),
    }
}

fn build_default_skills_document(
    scope: &str,
    project_root: Option<String>,
) -> PersistedSkillsDocument {
    PersistedSkillsDocument {
        version: SKILLS_STORAGE_VERSION,
        scope: scope.to_string(),
        project_root,
        skills: Vec::new(),
    }
}

fn ensure_directory(directory_path: &Path) -> Result<()> {
    fs::create_dir_all(directory_path).map_err(|error| {
        to_error(format!(
            "failed to create directory {}: {error}",
            directory_path.display()
        ))
    })
}

fn read_json_file<T: DeserializeOwned>(file_path: &Path, fallback: T) -> T {
    match fs::read_to_string(file_path) {
        Ok(contents) => serde_json::from_str(&contents).unwrap_or(fallback),
        Err(_) => fallback,
    }
}

fn write_json_file<T: Serialize>(file_path: &Path, payload: &T) -> Result<()> {
    if let Some(parent_directory) = file_path.parent() {
        ensure_directory(parent_directory)?;
    }
    let json = serde_json::to_string_pretty(payload)
        .map_err(|error| to_error(format!("failed to serialize JSON payload: {error}")))?;
    fs::write(file_path, json).map_err(|error| {
        to_error(format!(
            "failed to write JSON file {}: {error}",
            file_path.display()
        ))
    })
}

fn resolve_skills_document_path(
    storage_root: &Path,
    scope: &str,
    project_root: Option<&str>,
) -> Result<PathBuf> {
    match scope {
        SKILL_SCOPE_GLOBAL => Ok(build_global_document_path(storage_root)),
        SKILL_SCOPE_PROJECT => Ok(build_project_document_path(
            storage_root,
            project_root.ok_or_else(|| to_error("project scope requires a project root"))?,
        )),
        other => Err(to_error(format!("invalid skills scope: {other}"))),
    }
}

fn normalize_relative_entry_path(value: &str) -> Result<PathBuf> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(to_error("entry path is required"));
    }

    let path = PathBuf::from(trimmed);
    if path.is_absolute() {
        return Err(to_error("entry path must be relative"));
    }

    for component in path.components() {
        match component {
            Component::CurDir | Component::Normal(_) => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err(to_error("entry path must stay within the skill package"));
            }
        }
    }

    Ok(path)
}

fn resolve_existing_path(value: &str) -> Result<Option<PathBuf>> {
    let normalized = normalize_absolute_path(value)?;
    if normalized.exists() {
        Ok(Some(normalized))
    } else {
        Ok(None)
    }
}

fn infer_file_kind(relative_path: &str) -> String {
    let normalized = relative_path.replace('\\', "/").to_lowercase();

    if normalized.ends_with("skill.md")
        || normalized.ends_with(".md")
        || normalized.ends_with(".txt")
    {
        return "document".to_string();
    }

    if normalized.ends_with(".js")
        || normalized.ends_with(".ts")
        || normalized.ends_with(".py")
        || normalized.ends_with(".sh")
        || normalized.ends_with(".rb")
        || normalized.ends_with(".ps1")
        || normalized.ends_with(".zsh")
    {
        return "script".to_string();
    }

    if normalized.ends_with(".json")
        || normalized.ends_with(".yaml")
        || normalized.ends_with(".yml")
        || normalized.ends_with(".toml")
        || normalized.ends_with(".html")
        || normalized.ends_with(".css")
    {
        return "template".to_string();
    }

    "resource".to_string()
}

fn remove_path_if_exists(path: &Path) -> Result<()> {
    if !path.exists() {
        return Ok(());
    }

    if path.is_dir() {
        fs::remove_dir_all(path).map_err(|error| {
            to_error(format!(
                "failed to remove directory {}: {error}",
                path.display()
            ))
        })?;
    } else {
        fs::remove_file(path).map_err(|error| {
            to_error(format!("failed to remove file {}: {error}", path.display()))
        })?;
    }

    Ok(())
}

fn copy_path_recursive(source_path: &Path, target_directory: &Path) -> Result<()> {
    remove_path_if_exists(target_directory)?;
    fs::create_dir_all(target_directory).map_err(|error| {
        to_error(format!(
            "failed to create directory {}: {error}",
            target_directory.display()
        ))
    })?;

    if source_path.is_file() {
        let file_name = source_path
            .file_name()
            .ok_or_else(|| to_error("source file is missing a file name"))?;
        fs::copy(source_path, target_directory.join(file_name)).map_err(|error| {
            to_error(format!(
                "failed to copy file {}: {error}",
                source_path.display()
            ))
        })?;
        return Ok(());
    }

    for entry in WalkDir::new(source_path).sort_by_file_name() {
        let entry =
            entry.map_err(|error| to_error(format!("failed to walk source path: {error}")))?;
        let relative = entry
            .path()
            .strip_prefix(source_path)
            .map_err(|error| to_error(format!("failed to compute relative path: {error}")))?;
        if relative.as_os_str().is_empty() {
            continue;
        }

        let destination = target_directory.join(relative);
        if entry.file_type().is_dir() {
            fs::create_dir_all(&destination).map_err(|error| {
                to_error(format!(
                    "failed to create directory {}: {error}",
                    destination.display()
                ))
            })?;
            continue;
        }

        if let Some(parent_directory) = destination.parent() {
            fs::create_dir_all(parent_directory).map_err(|error| {
                to_error(format!(
                    "failed to create directory {}: {error}",
                    parent_directory.display()
                ))
            })?;
        }
        fs::copy(entry.path(), &destination).map_err(|error| {
            to_error(format!(
                "failed to copy file {} -> {}: {error}",
                entry.path().display(),
                destination.display()
            ))
        })?;
    }

    Ok(())
}

fn write_builtin_package_files(
    target_directory: &Path,
    files: &HashMap<String, String>,
) -> Result<()> {
    remove_path_if_exists(target_directory)?;
    fs::create_dir_all(target_directory).map_err(|error| {
        to_error(format!(
            "failed to create directory {}: {error}",
            target_directory.display()
        ))
    })?;

    let mut file_entries = files.iter().collect::<Vec<_>>();
    file_entries.sort_by(|left, right| left.0.cmp(right.0));
    for (relative_path, contents) in file_entries {
        let destination = target_directory.join(relative_path);
        if let Some(parent_directory) = destination.parent() {
            fs::create_dir_all(parent_directory).map_err(|error| {
                to_error(format!(
                    "failed to create directory {}: {error}",
                    parent_directory.display()
                ))
            })?;
        }
        fs::write(&destination, contents).map_err(|error| {
            to_error(format!(
                "failed to write file {}: {error}",
                destination.display()
            ))
        })?;
    }

    Ok(())
}

fn default_lyra_skill_content(name: &str, description: &str) -> String {
    format!("# {name}\n\n{description}\n")
}

fn build_lyra_skill_frontmatter(name: &str, description: &str, content: &str) -> String {
    format!(
        "{FRONTMATTER_DELIMITER}\nname: {name}\ndescription: {description}\n{FRONTMATTER_DELIMITER}\n\n{content}"
    )
}

fn create_lyra_skill_package(
    request: CreateLyraSkillPackageRequest,
) -> Result<CreateLyraSkillPackageResult> {
    let package_path = normalize_absolute_path(&request.package_path)?;
    let name = trim_or_none(&request.name).ok_or_else(|| to_error("skill name is required"))?;
    let description = trim_or_none(&request.description)
        .ok_or_else(|| to_error("skill description is required"))?;
    let category =
        trim_or_none(&request.category).ok_or_else(|| to_error("skill category is required"))?;
    let icon_key = trim_or_none(request.icon_key.as_deref().unwrap_or(""))
        .unwrap_or_else(|| "sparkles".to_string());
    let version = trim_or_none(request.version.as_deref().unwrap_or(""));
    let author = trim_or_none(request.author.as_deref().unwrap_or(""));
    let trigger_summary = trim_or_none(request.trigger_summary.as_deref().unwrap_or(""));
    let content = match request.content {
        Some(value) if !value.trim().is_empty() => value,
        _ => default_lyra_skill_content(&name, &description),
    };
    let skill_id = slugify(&name);

    remove_path_if_exists(&package_path)?;
    fs::create_dir_all(&package_path).map_err(|error| {
        to_error(format!(
            "failed to create directory {}: {error}",
            package_path.display()
        ))
    })?;

    let skill_path = package_path.join("SKILL.md");
    let skill_contents = build_lyra_skill_frontmatter(&name, &description, &content);
    fs::write(&skill_path, skill_contents).map_err(|error| {
        to_error(format!(
            "failed to write file {}: {error}",
            skill_path.display()
        ))
    })?;

    let files = collect_file_summaries_internal(&package_path, &package_path)?;
    let manifest = build_manifest(BuildManifestOptions {
        id: skill_id.clone(),
        name,
        version,
        description,
        category,
        icon_key,
        source_kind: "lyra".to_string(),
        skill_type: request.skill_type,
        entry_path: "SKILL.md".to_string(),
        author,
        trigger_summary,
        files,
        permissions: None,
        compatibility: create_compatibility(
            "lyra",
            vec!["Lyra native skill manifest".to_string()],
            vec!["Created directly inside Lyra.".to_string()],
            Vec::new(),
            None,
        ),
    });

    Ok(CreateLyraSkillPackageResult { skill_id, manifest })
}

fn read_skill_content_preview(
    request: ReadSkillContentPreviewRequest,
) -> Result<ReadSkillContentPreviewResult> {
    let package_path = normalize_absolute_path(&request.package_path)?;
    let entry_path = normalize_relative_entry_path(&request.entry_path)?;
    let preview_path = package_path.join(entry_path);
    let max_chars = request.max_chars.unwrap_or(1600);

    let content_preview = match fs::read_to_string(&preview_path) {
        Ok(contents) => Some(contents.chars().take(max_chars).collect::<String>()),
        Err(_) => None,
    };

    Ok(ReadSkillContentPreviewResult { content_preview })
}

fn collect_file_summaries_internal(
    root_path: &Path,
    base_path: &Path,
) -> Result<Vec<SkillFileSummary>> {
    let mut summaries = Vec::new();

    if root_path.is_file() {
        let metadata = fs::metadata(root_path)
            .map_err(|error| to_error(format!("failed to read file metadata: {error}")))?;
        let relative = root_path.strip_prefix(base_path).unwrap_or(root_path);
        let relative_path = path_to_string(relative);
        summaries.push(SkillFileSummary {
            path: relative_path.clone(),
            kind: infer_file_kind(&relative_path),
            size: Some(metadata.len()),
        });
        return Ok(summaries);
    }

    for entry in WalkDir::new(root_path).sort_by_file_name() {
        let entry =
            entry.map_err(|error| to_error(format!("failed to walk directory: {error}")))?;
        if entry.file_type().is_dir() {
            continue;
        }

        let relative = entry.path().strip_prefix(base_path).unwrap_or(entry.path());
        let relative_path = path_to_string(relative);
        let metadata = entry
            .metadata()
            .map_err(|error| to_error(format!("failed to read file metadata: {error}")))?;

        summaries.push(SkillFileSummary {
            path: relative_path.clone(),
            kind: infer_file_kind(&relative_path),
            size: Some(metadata.len()),
        });
    }

    summaries.sort_by(|left, right| left.path.cmp(&right.path));
    Ok(summaries)
}

fn summarize_scripts(files: &[SkillFileSummary]) -> Vec<String> {
    files
        .iter()
        .filter(|file| file.kind == "script")
        .map(|file| file.path.clone())
        .collect()
}

fn summarize_assets(files: &[SkillFileSummary]) -> Vec<SkillFileSummary> {
    files
        .iter()
        .filter(|file| file.path != "SKILL.md")
        .cloned()
        .collect()
}

fn derive_skill_type(files: &[SkillFileSummary], fallback: &str) -> String {
    if files.iter().any(|file| file.kind == "script") {
        return "workflow".to_string();
    }
    if files.iter().any(|file| file.kind == "resource") {
        if fallback == "tool-guidance" {
            return fallback.to_string();
        }
        return "resource".to_string();
    }
    fallback.to_string()
}

fn create_compatibility(
    source_kind: &str,
    detected_from: Vec<String>,
    notes: Vec<String>,
    parse_errors: Vec<String>,
    strict: Option<bool>,
) -> SkillCompatibility {
    SkillCompatibility {
        source_kind: source_kind.to_string(),
        detected_from,
        notes,
        parse_errors,
        strict,
    }
}

struct BuildManifestOptions {
    id: String,
    name: String,
    version: Option<String>,
    description: String,
    category: String,
    icon_key: String,
    source_kind: String,
    skill_type: String,
    entry_path: String,
    author: Option<String>,
    trigger_summary: Option<String>,
    files: Vec<SkillFileSummary>,
    permissions: Option<Vec<String>>,
    compatibility: SkillCompatibility,
}

fn build_manifest(options: BuildManifestOptions) -> LyraSkillManifest {
    let permissions = options.permissions.unwrap_or_else(|| {
        if options.files.iter().any(|file| file.kind == "script") {
            vec!["skill:contains-scripts".to_string()]
        } else {
            Vec::new()
        }
    });

    LyraSkillManifest {
        id: options.id,
        name: options.name,
        version: options.version.unwrap_or_else(|| "1.0.0".to_string()),
        description: options.description,
        category: options.category,
        icon_key: options.icon_key,
        source_kind: options.source_kind,
        skill_type: options.skill_type,
        entry_path: options.entry_path,
        author: options.author,
        trigger_summary: options.trigger_summary,
        assets: summarize_assets(&options.files),
        scripts: summarize_scripts(&options.files),
        permissions,
        compatibility: options.compatibility,
    }
}

fn preview_id_for(manifest_id: &str, source_path: &str) -> String {
    let hash = Sha256::digest(source_path.as_bytes());
    format!(
        "{manifest_id}:{:02x}{:02x}{:02x}{:02x}",
        hash[0], hash[1], hash[2], hash[3]
    )
}

fn build_preview_item(
    manifest: LyraSkillManifest,
    source_path: &Path,
    parse_errors: Vec<String>,
) -> SkillImportPreviewItem {
    SkillImportPreviewItem {
        preview_id: preview_id_for(&manifest.id, &path_to_string(source_path)),
        has_scripts: !manifest.scripts.is_empty(),
        has_resources: manifest.assets.iter().any(|asset| asset.kind != "document"),
        manifest,
        source_path: path_to_string(source_path),
        parse_errors,
    }
}

fn build_builtin_catalog_item(definition: BuiltinSkillDefinition) -> SkillCatalogItem {
    let mut file_entries = definition.files.iter().collect::<Vec<_>>();
    file_entries.sort_by(|left, right| left.0.cmp(right.0));
    let summaries = file_entries
        .into_iter()
        .map(|(file_path, content)| SkillFileSummary {
            path: file_path.clone(),
            kind: infer_file_kind(file_path),
            size: Some(content.len() as u64),
        })
        .collect::<Vec<_>>();

    SkillCatalogItem {
        manifest: build_manifest(BuildManifestOptions {
            id: definition.id,
            name: definition.name,
            version: None,
            description: definition.description,
            category: definition.category,
            icon_key: definition.icon_key,
            source_kind: "builtin".to_string(),
            skill_type: definition.skill_type,
            entry_path: "SKILL.md".to_string(),
            author: None,
            trigger_summary: Some(definition.trigger_summary),
            files: summaries,
            permissions: None,
            compatibility: create_compatibility(
                "builtin",
                vec!["Lyra curated package".to_string()],
                vec!["This skill ships as a Lyra built-in featured package.".to_string()],
                Vec::new(),
                None,
            ),
        }),
        featured: true,
        official: true,
    }
}

fn parse_frontmatter(content: &str) -> (HashMap<String, String>, String) {
    if !content.starts_with(&format!("{FRONTMATTER_DELIMITER}\n")) {
        return (HashMap::new(), content.to_string());
    }

    let Some(relative_closing_index) = content[FRONTMATTER_DELIMITER.len() + 1..].find("\n---")
    else {
        return (HashMap::new(), content.to_string());
    };

    let closing_index = FRONTMATTER_DELIMITER.len() + 1 + relative_closing_index;
    let raw_frontmatter = &content[FRONTMATTER_DELIMITER.len() + 1..closing_index];
    let mut body = content[closing_index + 4..].to_string();
    if let Some(stripped) = body.strip_prefix('\n') {
        body = stripped.to_string();
    }

    let attributes = raw_frontmatter
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && line.contains(':'))
        .filter_map(|line| line.split_once(':'))
        .map(|(key, value)| (key.trim().to_string(), value.trim().to_string()))
        .collect::<HashMap<_, _>>();

    (attributes, body)
}

fn parse_claude_skill_directory(
    directory_path: &Path,
    notes: &[String],
) -> Result<SkillImportPreviewItem> {
    let skill_path = directory_path.join("SKILL.md");
    let skill_contents = fs::read_to_string(&skill_path)
        .map_err(|error| to_error(format!("failed to read SKILL.md: {error}")))?;
    let (attributes, _) = parse_frontmatter(&skill_contents);
    let mut parse_errors = Vec::new();

    let fallback_name = slugify(
        directory_path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("skill"),
    );
    let name = frontmatter_string(&attributes, "name").unwrap_or_else(|| {
        parse_errors.push("Missing required frontmatter field: name".to_string());
        fallback_name.clone()
    });
    let description = frontmatter_string(&attributes, "description").unwrap_or_else(|| {
        parse_errors.push("Missing required frontmatter field: description".to_string());
        "Claude-compatible skill imported into Lyra.".to_string()
    });

    let files = collect_file_summaries_internal(directory_path, directory_path)?;
    let manifest = build_manifest(BuildManifestOptions {
        id: slugify(&name),
        name,
        version: None,
        description: description.clone(),
        category: "Claude Skill".to_string(),
        icon_key: if files.iter().any(|file| file.kind == "script") {
            "sparkles".to_string()
        } else {
            "brain-circuit".to_string()
        },
        source_kind: "claude".to_string(),
        skill_type: derive_skill_type(&files, "prompt"),
        entry_path: "SKILL.md".to_string(),
        author: None,
        trigger_summary: Some(description),
        files,
        permissions: None,
        compatibility: create_compatibility(
            "claude",
            vec!["SKILL.md".to_string()],
            {
                let mut merged = notes.to_vec();
                merged.push("Imported from a Claude-compatible skill directory.".to_string());
                merged
            },
            parse_errors.clone(),
            None,
        ),
    });

    Ok(build_preview_item(manifest, directory_path, parse_errors))
}

fn parse_claude_plugin_bundle(root_path: &Path) -> Result<SkillImportDiscovery> {
    let marketplace_path = root_path.join(".claude-plugin").join("marketplace.json");
    let marketplace_contents = fs::read_to_string(&marketplace_path)
        .map_err(|error| to_error(format!("failed to read Claude marketplace.json: {error}")))?;
    let marketplace: ClaudePluginBundle = serde_json::from_str(&marketplace_contents)
        .map_err(|error| to_error(format!("failed to parse Claude marketplace.json: {error}")))?;

    let mut preview_items = Vec::new();
    let mut parse_errors = Vec::new();

    for plugin in marketplace.plugins.unwrap_or_default() {
        for skill_relative_path in plugin.skills.unwrap_or_default() {
            let resolved_path = root_path.join(&skill_relative_path);
            if !resolved_path.join("SKILL.md").exists() {
                parse_errors.push(format!("Skill entry not found: {skill_relative_path}"));
                continue;
            }

            let mut preview = parse_claude_skill_directory(
                &resolved_path,
                &[format!(
                    "Discovered via Claude plugin bundle{}.",
                    plugin
                        .name
                        .as_deref()
                        .and_then(trim_or_none)
                        .map(|name| format!(": {name}"))
                        .unwrap_or_default()
                )],
            )?;

            preview.manifest.compatibility.strict = plugin.strict;
            preview_items.push(preview);
        }
    }

    Ok(SkillImportDiscovery {
        source_path: path_to_string(root_path),
        detected_kind: "claude-plugin".to_string(),
        source_kind: "claude".to_string(),
        summary: format!(
            "{} Claude skill{} detected from plugin bundle",
            preview_items.len(),
            if preview_items.len() == 1 { "" } else { "s" }
        ),
        preview_items,
        parse_errors,
    })
}

fn parse_continue_markdown_file(file_path: &Path) -> Result<SkillImportPreviewItem> {
    let contents = fs::read_to_string(file_path)
        .map_err(|error| to_error(format!("failed to read Continue Markdown file: {error}")))?;
    let (attributes, _) = parse_frontmatter(&contents);
    let parse_errors = Vec::new();

    let fallback_name = file_path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("skill")
        .to_string();
    let name = frontmatter_string(&attributes, "name").unwrap_or(fallback_name);
    let description = frontmatter_string(&attributes, "description")
        .unwrap_or_else(|| "Continue-compatible prompt or rule imported into Lyra.".to_string());
    let always_apply = frontmatter_bool(&attributes, "alwaysApply");
    let invokable = frontmatter_bool(&attributes, "invokable");

    let parent_directory = file_path
        .parent()
        .ok_or_else(|| to_error("Continue file is missing a parent directory"))?;
    let files = collect_file_summaries_internal(parent_directory, parent_directory)?;
    let relative_path = file_path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("SKILL.md")
        .to_string();
    let target_files = files
        .into_iter()
        .filter(|file| file.path == relative_path)
        .collect::<Vec<_>>();

    let manifest = build_manifest(BuildManifestOptions {
        id: slugify(&name),
        name,
        version: None,
        description: description.clone(),
        category: if always_apply {
            "Continue Rule".to_string()
        } else {
            "Continue Prompt".to_string()
        },
        icon_key: if always_apply {
            "shield-check".to_string()
        } else {
            "message-square-text".to_string()
        },
        source_kind: "continue".to_string(),
        skill_type: if always_apply {
            "workflow".to_string()
        } else if invokable {
            "prompt".to_string()
        } else {
            "prompt".to_string()
        },
        entry_path: relative_path,
        author: None,
        trigger_summary: Some(description),
        files: target_files,
        permissions: None,
        compatibility: create_compatibility(
            "continue",
            vec![file_path
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or("SKILL.md")
                .to_string()],
            vec!["Imported from a Continue local prompt or rule file.".to_string()],
            parse_errors.clone(),
            None,
        ),
    });

    Ok(build_preview_item(manifest, file_path, parse_errors))
}

fn discover_continue_directory(directory_path: &Path) -> Result<SkillImportDiscovery> {
    let mut preview_items = Vec::new();

    for entry in WalkDir::new(directory_path).sort_by_file_name() {
        let entry = entry
            .map_err(|error| to_error(format!("failed to walk Continue directory: {error}")))?;
        if !entry.file_type().is_file() {
            continue;
        }

        let is_markdown = entry
            .path()
            .extension()
            .and_then(|value| value.to_str())
            .map(|value| value.eq_ignore_ascii_case("md"))
            .unwrap_or(false);
        if !is_markdown {
            continue;
        }

        let contents = fs::read_to_string(entry.path())
            .map_err(|error| to_error(format!("failed to read Continue file: {error}")))?;
        if !contents.starts_with(&format!("{FRONTMATTER_DELIMITER}\n")) {
            continue;
        }

        preview_items.push(parse_continue_markdown_file(entry.path())?);
    }

    let detected = !preview_items.is_empty();
    Ok(SkillImportDiscovery {
        source_path: path_to_string(directory_path),
        detected_kind: if detected {
            "continue".to_string()
        } else {
            "unknown".to_string()
        },
        source_kind: if detected {
            "continue".to_string()
        } else {
            "unknown".to_string()
        },
        summary: if detected {
            format!(
                "{} Continue prompt{} detected",
                preview_items.len(),
                if preview_items.len() == 1 { "" } else { "s" }
            )
        } else {
            "No Continue-compatible Markdown assets detected".to_string()
        },
        preview_items,
        parse_errors: Vec::new(),
    })
}

fn compute_skill_overridden_fields(
    global_skill: &InstalledSkillConfig,
    project_skill: &InstalledSkillConfig,
) -> Vec<String> {
    let mut fields = Vec::new();
    if global_skill.trust_state != project_skill.trust_state {
        fields.push("trustState".to_string());
    }
    if global_skill.enable_state != project_skill.enable_state {
        fields.push("enableState".to_string());
    }
    fields
}

fn merge_effective_skills(request: MergeEffectiveSkillsRequest) -> EffectiveSkillsResult {
    let global_skills = request.global_document.skills;
    let project_skills = request.project_document.skills;
    let mut effective_skills = Vec::new();
    let mut skill_to_index = HashMap::new();

    for skill in &global_skills {
        skill_to_index.insert(skill.skill_id.clone(), effective_skills.len());
        effective_skills.push(EffectiveSkillConfig {
            skill: skill.clone(),
            effective_scope: SKILL_SCOPE_GLOBAL.to_string(),
            inherited_from_global: false,
            overridden_fields: Vec::new(),
        });
    }

    for skill in &project_skills {
        let inherited = global_skills
            .iter()
            .find(|global_skill| global_skill.skill_id == skill.skill_id);
        let effective_skill = EffectiveSkillConfig {
            inherited_from_global: inherited.is_some(),
            overridden_fields: inherited
                .map(|global_skill| compute_skill_overridden_fields(global_skill, &skill))
                .unwrap_or_default(),
            effective_scope: SKILL_SCOPE_PROJECT.to_string(),
            skill: skill.clone(),
        };

        if let Some(index) = skill_to_index.get(&effective_skill.skill.skill_id).copied() {
            effective_skills[index] = effective_skill;
        } else {
            skill_to_index.insert(
                effective_skill.skill.skill_id.clone(),
                effective_skills.len(),
            );
            effective_skills.push(effective_skill);
        }
    }

    EffectiveSkillsResult {
        resolved_project_root: request.resolved_project_root,
        skills: effective_skills,
    }
}

fn update_installed_skill_state(
    request: UpdateInstalledSkillStateRequest,
) -> Result<UpdateInstalledSkillStateResult> {
    let current_skill = request
        .document
        .skills
        .iter()
        .find(|skill| skill.skill_id == request.skill_id)
        .cloned()
        .ok_or_else(|| to_error("skill not found"))?;

    let next_trust_state = request
        .trust_state
        .unwrap_or_else(|| current_skill.trust_state.clone());
    let requested_enable_state = request
        .enable_state
        .unwrap_or_else(|| current_skill.enable_state.clone());

    if requested_enable_state == "enabled" && next_trust_state != "trusted" {
        return Err(to_error(
            "Skills must be trusted before they can be enabled.",
        ));
    }

    let next_enable_state = if next_trust_state == "untrusted" {
        "disabled".to_string()
    } else {
        requested_enable_state
    };

    let next_skill = InstalledSkillConfig {
        updated_at: request.updated_at,
        trust_state: next_trust_state,
        enable_state: next_enable_state,
        ..current_skill
    };

    let next_skills = request
        .document
        .skills
        .into_iter()
        .map(|skill| {
            if skill.skill_id == next_skill.skill_id {
                next_skill.clone()
            } else {
                skill
            }
        })
        .collect::<Vec<_>>();

    Ok(UpdateInstalledSkillStateResult {
        document: PersistedSkillsDocument {
            skills: next_skills,
            ..request.document
        },
        skill: next_skill,
    })
}

fn remove_installed_skill(
    request: RemoveInstalledSkillRequest,
) -> Result<RemoveInstalledSkillResult> {
    let removed_skill = request
        .document
        .skills
        .iter()
        .find(|skill| skill.skill_id == request.skill_id)
        .cloned()
        .ok_or_else(|| to_error("skill not found"))?;

    let next_skills = request
        .document
        .skills
        .into_iter()
        .filter(|skill| skill.skill_id != request.skill_id)
        .collect::<Vec<_>>();

    Ok(RemoveInstalledSkillResult {
        document: PersistedSkillsDocument {
            skills: next_skills,
            ..request.document
        },
        removed_skill,
    })
}

fn upsert_installed_skill(
    skills: &mut Vec<InstalledSkillConfig>,
    next_skill: InstalledSkillConfig,
) {
    if let Some(index) = skills
        .iter()
        .position(|skill| skill.skill_id == next_skill.skill_id)
    {
        skills[index] = next_skill;
    } else {
        skills.push(next_skill);
    }
}

fn read_skills_document_from_storage(
    storage_root: &Path,
    scope: &str,
    project_root: Option<&str>,
) -> Result<PersistedSkillsDocument> {
    if scope == SKILL_SCOPE_PROJECT && project_root.is_none() {
        return Ok(build_default_skills_document(scope, None));
    }

    let document_path = resolve_skills_document_path(storage_root, scope, project_root)?;
    Ok(read_json_file(
        &document_path,
        build_default_skills_document(scope, project_root.map(str::to_string)),
    ))
}

fn write_skills_document_to_storage(
    storage_root: &Path,
    document: &PersistedSkillsDocument,
) -> Result<()> {
    let document_path = resolve_skills_document_path(
        storage_root,
        &document.scope,
        document.project_root.as_deref(),
    )?;
    write_json_file(&document_path, document)
}

fn install_skills(request: InstallSkillsRequest) -> Result<InstallSkillsResult> {
    let storage_root = build_storage_root_path(&request.storage_root);
    let mut document = read_skills_document_from_storage(
        &storage_root,
        &request.scope,
        request.project_root.as_deref(),
    )?;
    let mut installed = Vec::new();

    match request.source {
        InstallSkillsSource::Catalog { item_ids, packages } => {
            let selected = packages
                .into_iter()
                .filter(|package| item_ids.contains(&package.catalog.manifest.id))
                .collect::<Vec<_>>();

            for package in selected {
                let package_path = build_scope_package_directory(
                    &storage_root,
                    &request.scope,
                    &package.catalog.manifest.id,
                    request.project_root.as_deref(),
                )?;
                write_builtin_package_files(&package_path, &package.files)?;
                let next_skill = InstalledSkillConfig {
                    skill_id: package.catalog.manifest.id.clone(),
                    scope: request.scope.clone(),
                    project_root: request.project_root.clone(),
                    manifest: package.catalog.manifest.clone(),
                    package_path: path_to_string(&package_path),
                    source_path: None,
                    trust_state: "untrusted".to_string(),
                    enable_state: "disabled".to_string(),
                    installed_at: request.now_iso.clone(),
                    updated_at: request.now_iso.clone(),
                    last_error: None,
                    source_summary: package.catalog.manifest.assets.clone(),
                };
                upsert_installed_skill(&mut document.skills, next_skill.clone());
                installed.push(next_skill);
            }
        }
        InstallSkillsSource::Discovery {
            item_ids,
            discovery,
        } => {
            let selected = discovery
                .preview_items
                .into_iter()
                .filter(|preview| item_ids.contains(&preview.preview_id))
                .collect::<Vec<_>>();

            for preview in selected {
                let package_path = build_scope_package_directory(
                    &storage_root,
                    &request.scope,
                    &preview.manifest.id,
                    request.project_root.as_deref(),
                )?;
                copy_path_recursive(
                    &normalize_absolute_path(&preview.source_path)?,
                    &package_path,
                )?;
                let next_skill = InstalledSkillConfig {
                    skill_id: preview.manifest.id.clone(),
                    scope: request.scope.clone(),
                    project_root: request.project_root.clone(),
                    manifest: preview.manifest.clone(),
                    package_path: path_to_string(&package_path),
                    source_path: Some(preview.source_path.clone()),
                    trust_state: "untrusted".to_string(),
                    enable_state: "disabled".to_string(),
                    installed_at: request.now_iso.clone(),
                    updated_at: request.now_iso.clone(),
                    last_error: if preview.parse_errors.is_empty() {
                        None
                    } else {
                        Some(preview.parse_errors.join("; "))
                    },
                    source_summary: preview.manifest.assets.clone(),
                };
                upsert_installed_skill(&mut document.skills, next_skill.clone());
                installed.push(next_skill);
            }
        }
    }

    write_skills_document_to_storage(&storage_root, &document)?;
    Ok(InstallSkillsResult {
        document,
        installed,
    })
}

fn create_and_install_lyra_skill(
    request: CreateAndInstallLyraSkillRequest,
) -> Result<CreateAndInstallLyraSkillResult> {
    let storage_root = build_storage_root_path(&request.storage_root);
    let skill_id = slugify(&request.name);
    let package_path = build_scope_package_directory(
        &storage_root,
        &request.scope,
        &skill_id,
        request.project_root.as_deref(),
    )?;
    let package_result = create_lyra_skill_package(CreateLyraSkillPackageRequest {
        package_path: path_to_string(&package_path),
        name: request.name,
        description: request.description,
        category: request.category,
        icon_key: request.icon_key,
        skill_type: request.skill_type,
        content: request.content,
        version: request.version,
        author: request.author,
        trigger_summary: request.trigger_summary,
    })?;

    let mut document = read_skills_document_from_storage(
        &storage_root,
        &request.scope,
        request.project_root.as_deref(),
    )?;
    let next_skill = InstalledSkillConfig {
        skill_id: package_result.skill_id,
        scope: request.scope,
        project_root: request.project_root,
        manifest: package_result.manifest.clone(),
        package_path: path_to_string(&package_path),
        source_path: None,
        trust_state: "trusted".to_string(),
        enable_state: "disabled".to_string(),
        installed_at: request.now_iso.clone(),
        updated_at: request.now_iso,
        last_error: None,
        source_summary: package_result.manifest.assets.clone(),
    };
    upsert_installed_skill(&mut document.skills, next_skill.clone());
    write_skills_document_to_storage(&storage_root, &document)?;

    Ok(CreateAndInstallLyraSkillResult {
        document,
        skill: next_skill,
    })
}

fn update_installed_skill_state_in_storage(
    request: UpdateInstalledSkillStateInStorageRequest,
) -> Result<UpdateInstalledSkillStateResult> {
    let storage_root = build_storage_root_path(&request.storage_root);
    let document = read_skills_document_from_storage(
        &storage_root,
        &request.scope,
        request.project_root.as_deref(),
    )?;
    let result = update_installed_skill_state(UpdateInstalledSkillStateRequest {
        document,
        skill_id: request.skill_id,
        trust_state: request.trust_state,
        enable_state: request.enable_state,
        updated_at: request.updated_at,
    })?;
    write_skills_document_to_storage(&storage_root, &result.document)?;
    Ok(result)
}

fn remove_installed_skill_in_storage(
    request: RemoveInstalledSkillInStorageRequest,
) -> Result<RemoveInstalledSkillInStorageResult> {
    let storage_root = build_storage_root_path(&request.storage_root);
    let document = read_skills_document_from_storage(
        &storage_root,
        &request.scope,
        request.project_root.as_deref(),
    )?;
    let result = remove_installed_skill(RemoveInstalledSkillRequest {
        document,
        skill_id: request.skill_id,
    })?;
    write_skills_document_to_storage(&storage_root, &result.document)?;
    remove_path_if_exists(Path::new(&result.removed_skill.package_path))?;
    Ok(RemoveInstalledSkillInStorageResult {
        document: result.document,
        removed_skill: result.removed_skill,
    })
}

fn read_installed_skill_details(
    request: ReadInstalledSkillDetailsRequest,
) -> Result<Option<ReadInstalledSkillDetailsResult>> {
    let storage_root = build_storage_root_path(&request.storage_root);
    let document = read_skills_document_from_storage(
        &storage_root,
        &request.scope,
        request.project_root.as_deref(),
    )?;
    let Some(skill) = document
        .skills
        .into_iter()
        .find(|skill| skill.skill_id == request.skill_id)
    else {
        return Ok(None);
    };

    let preview = read_skill_content_preview(ReadSkillContentPreviewRequest {
        package_path: skill.package_path.clone(),
        entry_path: skill.manifest.entry_path.clone(),
        max_chars: request.max_chars,
    })?;

    Ok(Some(ReadInstalledSkillDetailsResult {
        skill,
        content_preview: preview.content_preview,
    }))
}

#[napi(js_name = "collectSkillFileSummariesJson")]
pub fn collect_skill_file_summaries_json(request_json: String) -> Result<String> {
    let request: CollectSkillFileSummariesRequest = parse_json(&request_json)?;
    let root_path = normalize_absolute_path(&request.root_path)?;
    let base_path = match request.base_path.as_deref() {
        Some(value) if !value.trim().is_empty() => normalize_absolute_path(value)?,
        _ => root_path.clone(),
    };

    let summaries = collect_file_summaries_internal(&root_path, &base_path)?;
    to_json(&summaries)
}

#[napi(js_name = "discoverSkillsImportSourceJson")]
pub fn discover_skills_import_source_json(request_json: String) -> Result<String> {
    let request: DiscoverSkillImportSourceRequest = parse_json(&request_json)?;
    let Some(source_path) = resolve_existing_path(&request.source_path)? else {
        return to_json(&SkillImportDiscovery {
            source_path: request.source_path,
            detected_kind: "unknown".to_string(),
            source_kind: "unknown".to_string(),
            summary: "Import source not found".to_string(),
            preview_items: Vec::new(),
            parse_errors: vec!["The provided path does not exist.".to_string()],
        });
    };

    let discovery = if source_path.is_dir() {
        if source_path
            .join(".claude-plugin")
            .join("marketplace.json")
            .exists()
        {
            parse_claude_plugin_bundle(&source_path)?
        } else if source_path.join("SKILL.md").exists() {
            let preview = parse_claude_skill_directory(&source_path, &[])?;
            SkillImportDiscovery {
                source_path: path_to_string(&source_path),
                detected_kind: "claude-skill".to_string(),
                source_kind: "claude".to_string(),
                summary: "1 Claude skill detected".to_string(),
                preview_items: vec![preview],
                parse_errors: Vec::new(),
            }
        } else {
            discover_continue_directory(&source_path)?
        }
    } else if source_path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.eq_ignore_ascii_case("md"))
        .unwrap_or(false)
    {
        SkillImportDiscovery {
            source_path: path_to_string(&source_path),
            detected_kind: "continue".to_string(),
            source_kind: "continue".to_string(),
            summary: "1 Continue prompt detected".to_string(),
            preview_items: vec![parse_continue_markdown_file(&source_path)?],
            parse_errors: Vec::new(),
        }
    } else {
        SkillImportDiscovery {
            source_path: path_to_string(&source_path),
            detected_kind: "unknown".to_string(),
            source_kind: "unknown".to_string(),
            summary: "Unsupported import source".to_string(),
            preview_items: Vec::new(),
            parse_errors: vec![
                "Lyra could not detect a supported Claude or Continue skill structure.".to_string(),
            ],
        }
    };

    to_json(&discovery)
}

#[napi(js_name = "buildBuiltinSkillsCatalogJson")]
pub fn build_builtin_skills_catalog_json(request_json: String) -> Result<String> {
    let request: BuildBuiltinSkillsCatalogRequest = parse_json(&request_json)?;
    let catalog = request
        .items
        .into_iter()
        .map(build_builtin_catalog_item)
        .collect::<Vec<_>>();
    to_json(&catalog)
}

#[napi(js_name = "copySkillPackageJson")]
pub fn copy_skill_package_json(request_json: String) -> Result<()> {
    let request: CopySkillPackageRequest = parse_json(&request_json)?;
    let source_path = normalize_absolute_path(&request.source_path)?;
    let target_directory = normalize_absolute_path(&request.target_directory)?;
    copy_path_recursive(&source_path, &target_directory)
}

#[napi(js_name = "writeBuiltinSkillPackageJson")]
pub fn write_builtin_skill_package_json(request_json: String) -> Result<()> {
    let request: WriteBuiltinSkillPackageRequest = parse_json(&request_json)?;
    let target_directory = normalize_absolute_path(&request.target_directory)?;
    write_builtin_package_files(&target_directory, &request.files)
}

#[napi(js_name = "createLyraSkillPackageJson")]
pub fn create_lyra_skill_package_json(request_json: String) -> Result<String> {
    let request: CreateLyraSkillPackageRequest = parse_json(&request_json)?;
    let result = create_lyra_skill_package(request)?;
    to_json(&result)
}

#[napi(js_name = "readSkillContentPreviewJson")]
pub fn read_skill_content_preview_json(request_json: String) -> Result<String> {
    let request: ReadSkillContentPreviewRequest = parse_json(&request_json)?;
    let result = read_skill_content_preview(request)?;
    to_json(&result)
}

#[napi(js_name = "readSkillsScopeDocumentJson")]
pub fn read_skills_scope_document_json(request_json: String) -> Result<String> {
    let request: ReadSkillsScopeDocumentRequest = parse_json(&request_json)?;
    if request.scope == SKILL_SCOPE_PROJECT && request.project_root.is_none() {
        return to_json(&build_default_skills_document(&request.scope, None));
    }

    let storage_root = build_storage_root_path(&request.storage_root);
    let document_path = resolve_skills_document_path(
        &storage_root,
        &request.scope,
        request.project_root.as_deref(),
    )?;
    let document = read_json_file(
        &document_path,
        build_default_skills_document(&request.scope, request.project_root),
    );
    to_json(&document)
}

#[napi(js_name = "writeSkillsScopeDocumentJson")]
pub fn write_skills_scope_document_json(request_json: String) -> Result<()> {
    let request: WriteSkillsScopeDocumentRequest = parse_json(&request_json)?;
    let storage_root = build_storage_root_path(&request.storage_root);
    let document_path = resolve_skills_document_path(
        &storage_root,
        &request.document.scope,
        request.document.project_root.as_deref(),
    )?;
    write_json_file(&document_path, &request.document)
}

#[napi(js_name = "mergeEffectiveSkillsJson")]
pub fn merge_effective_skills_json(request_json: String) -> Result<String> {
    let request: MergeEffectiveSkillsRequest = parse_json(&request_json)?;
    let result = merge_effective_skills(request);
    to_json(&result)
}

#[napi(js_name = "updateInstalledSkillStateJson")]
pub fn update_installed_skill_state_json(request_json: String) -> Result<String> {
    let request: UpdateInstalledSkillStateRequest = parse_json(&request_json)?;
    let result = update_installed_skill_state(request)?;
    to_json(&result)
}

#[napi(js_name = "removeInstalledSkillJson")]
pub fn remove_installed_skill_json(request_json: String) -> Result<String> {
    let request: RemoveInstalledSkillRequest = parse_json(&request_json)?;
    let result = remove_installed_skill(request)?;
    to_json(&result)
}

#[napi(js_name = "installSkillsJson")]
pub fn install_skills_json(request_json: String) -> Result<String> {
    let request: InstallSkillsRequest = parse_json(&request_json)?;
    let result = install_skills(request)?;
    to_json(&result)
}

#[napi(js_name = "createAndInstallLyraSkillJson")]
pub fn create_and_install_lyra_skill_json(request_json: String) -> Result<String> {
    let request: CreateAndInstallLyraSkillRequest = parse_json(&request_json)?;
    let result = create_and_install_lyra_skill(request)?;
    to_json(&result)
}

#[napi(js_name = "updateInstalledSkillStateInStorageJson")]
pub fn update_installed_skill_state_in_storage_json(request_json: String) -> Result<String> {
    let request: UpdateInstalledSkillStateInStorageRequest = parse_json(&request_json)?;
    let result = update_installed_skill_state_in_storage(request)?;
    to_json(&result)
}

#[napi(js_name = "removeInstalledSkillInStorageJson")]
pub fn remove_installed_skill_in_storage_json(request_json: String) -> Result<String> {
    let request: RemoveInstalledSkillInStorageRequest = parse_json(&request_json)?;
    let result = remove_installed_skill_in_storage(request)?;
    to_json(&result)
}

#[napi(js_name = "readInstalledSkillDetailsJson")]
pub fn read_installed_skill_details_json(request_json: String) -> Result<String> {
    let request: ReadInstalledSkillDetailsRequest = parse_json(&request_json)?;
    let result = read_installed_skill_details(request)?;
    to_json(&result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn now_iso_test() -> String {
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        format!("{timestamp}")
    }

    fn create_temp_storage_root() -> PathBuf {
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis();
        let root = std::env::temp_dir().join(format!(
            "lyra-skills-napi-test-{}-{}",
            std::process::id(),
            timestamp
        ));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).expect("failed to create temp storage root");
        root
    }

    #[test]
    fn slugify_and_frontmatter_parse_work() {
        assert_eq!(slugify("  Hello  Lyra Skill!  "), "hello-lyra-skill");
        assert_eq!(slugify(""), "skill");

        let content = "---\nname: Demo Skill\ndescription: Test description\nstrict: true\n---\n\nbody";
        let (attributes, body) = parse_frontmatter(content);
        assert_eq!(
            frontmatter_string(&attributes, "name"),
            Some("Demo Skill".to_string())
        );
        assert_eq!(
            frontmatter_string(&attributes, "description"),
            Some("Test description".to_string())
        );
        assert_eq!(frontmatter_bool(&attributes, "strict"), true);
        assert_eq!(body.trim(), "body");
    }

    #[test]
    fn relative_entry_path_rejects_parent_escape() {
        assert!(normalize_relative_entry_path("SKILL.md").is_ok());
        assert!(normalize_relative_entry_path("docs/guide.md").is_ok());
        assert!(normalize_relative_entry_path("../outside.md").is_err());
        assert!(normalize_relative_entry_path("/abs/path.md").is_err());
    }

    #[test]
    fn install_update_remove_in_storage_smoke() {
        let storage_root = create_temp_storage_root();
        let storage_root_string = path_to_string(&storage_root);

        let mut files = HashMap::new();
        files.insert(
            "SKILL.md".to_string(),
            "---\nname: Runtime Smoke\ndescription: Runtime storage smoke test\n---\n\ncontent"
                .to_string(),
        );
        files.insert("docs/readme.md".to_string(), "# docs".to_string());

        let definition = BuiltinSkillDefinition {
            id: "runtime-smoke".to_string(),
            name: "Runtime Smoke".to_string(),
            description: "Runtime storage smoke test".to_string(),
            category: "utility".to_string(),
            icon_key: "sparkles".to_string(),
            files: files.clone(),
            skill_type: "prompt".to_string(),
            trigger_summary: "Smoke trigger".to_string(),
        };
        let catalog_item = build_builtin_catalog_item(definition);
        let skill_id = catalog_item.manifest.id.clone();

        let install_result = install_skills(InstallSkillsRequest {
            storage_root: storage_root_string.clone(),
            scope: SKILL_SCOPE_GLOBAL.to_string(),
            project_root: None,
            now_iso: now_iso_test(),
            source: InstallSkillsSource::Catalog {
                item_ids: vec![skill_id.clone()],
                packages: vec![BuiltinSkillPackagePayload {
                    catalog: catalog_item,
                    files,
                }],
            },
        })
        .expect("install should succeed");

        assert_eq!(install_result.installed.len(), 1);
        assert!(
            install_result
                .document
                .skills
                .iter()
                .any(|skill| skill.skill_id == skill_id)
        );

        let update_result =
            update_installed_skill_state_in_storage(UpdateInstalledSkillStateInStorageRequest {
                storage_root: storage_root_string.clone(),
                scope: SKILL_SCOPE_GLOBAL.to_string(),
                project_root: None,
                skill_id: skill_id.clone(),
                trust_state: Some("trusted".to_string()),
                enable_state: Some("enabled".to_string()),
                updated_at: now_iso_test(),
            })
            .expect("update should succeed");
        assert_eq!(update_result.skill.trust_state, "trusted");
        assert_eq!(update_result.skill.enable_state, "enabled");

        let package_path = PathBuf::from(update_result.skill.package_path.clone());
        assert!(package_path.exists());

        let remove_result =
            remove_installed_skill_in_storage(RemoveInstalledSkillInStorageRequest {
                storage_root: storage_root_string.clone(),
                scope: SKILL_SCOPE_GLOBAL.to_string(),
                project_root: None,
                skill_id: skill_id.clone(),
            })
            .expect("remove should succeed");

        assert!(
            remove_result
                .document
                .skills
                .iter()
                .all(|skill| skill.skill_id != skill_id)
        );
        assert!(!package_path.exists());

        let _ = fs::remove_dir_all(storage_root);
    }
}
