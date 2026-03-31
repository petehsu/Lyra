use std::cmp::Ordering;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use napi::{Error, Result, Status};
use napi_derive::napi;
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use walkdir::WalkDir;

const REGISTRY_VERSION: u8 = 1;
const CURRENT_API_VERSION: &str = "1.0.0";

const RUNTIME_SANDBOX: &str = "sandbox";
const RUNTIME_INPROCESS: &str = "inprocess";

const SHELL_CONTENT_ONLY: &str = "content-only";
const SHELL_FULL: &str = "full-shell";

const CONTEXT_OFF: &str = "off";
const CONTEXT_BOOTING: &str = "booting";
const CONTEXT_ON: &str = "on";
const CONTEXT_ERROR: &str = "error";

const POWER_OFF: &str = "off";
const POWER_BOOTING: &str = "booting";
const POWER_ON: &str = "on";
const POWER_SHUTTING_DOWN: &str = "shutting_down";

const SOURCE_DIRECTORY: &str = "directory";
const SOURCE_PACKAGE: &str = "package";
const SOURCE_BUILTIN_SEED: &str = "builtin-seed";

const PLATFORM_ANY: &str = "any";
const ARCH_ANY: &str = "any";

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SystemCompatibility {
    min: String,
    #[serde(default)]
    max: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PlatformArtifact {
    platform: String,
    arch: String,
    kind: String,
    path: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SystemImageManifest {
    id: String,
    title: String,
    version: String,
    api_version: SystemCompatibility,
    shell_mode: String,
    default_runtime_mode: String,
    entry_path: String,
    #[serde(default)]
    capabilities: Vec<String>,
    #[serde(default)]
    platform_artifacts: Vec<PlatformArtifact>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SystemImageDescriptor {
    image_id: String,
    title: String,
    version: String,
    source: String,
    install_path: String,
    installed_at: String,
    updated_at: String,
    manifest: SystemImageManifest,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionAssignment {
    session_id: String,
    image_id: String,
    updated_at: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionRuntimeModeOverride {
    session_id: String,
    runtime_mode: String,
    updated_at: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SystemRegistryDocument {
    version: u8,
    #[serde(default)]
    default_image_id: Option<String>,
    #[serde(default)]
    runtime_mode_override: Option<String>,
    #[serde(default)]
    installed_images: Vec<SystemImageDescriptor>,
    #[serde(default)]
    session_assignments: Vec<SessionAssignment>,
    #[serde(default)]
    session_runtime_mode_overrides: Vec<SessionRuntimeModeOverride>,
    updated_at: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SystemRegistryState {
    default_image_id: Option<String>,
    runtime_mode_override: Option<String>,
    installed_images: Vec<SystemImageDescriptor>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ResolvedSessionSystem {
    session_id: String,
    resolved_system_image_id: Option<String>,
    effective_runtime_mode: Option<String>,
    effective_shell_mode: Option<String>,
    system_context_state: String,
    updated_at: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StorageRequest {
    storage_root: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct InstallFromDirectoryRequest {
    storage_root: String,
    directory_path: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PackagePayload {
    manifest: SystemImageManifest,
    #[serde(default)]
    payload_directory: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct InstallFromPackageRequest {
    storage_root: String,
    package_path: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct InstallSeedRequest {
    storage_root: String,
    manifest: SystemImageManifest,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UninstallRequest {
    storage_root: String,
    image_id: String,
    #[serde(default)]
    wipe_data: Option<bool>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SetDefaultRequest {
    storage_root: String,
    #[serde(default)]
    image_id: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AssignSessionImageRequest {
    storage_root: String,
    session_id: String,
    #[serde(default)]
    image_id: Option<String>,
    #[serde(default)]
    computer_power_state: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClearSessionImageOverrideRequest {
    storage_root: String,
    session_id: String,
    #[serde(default)]
    computer_power_state: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SetRuntimeModeOverrideRequest {
    storage_root: String,
    #[serde(default)]
    runtime_mode: Option<String>,
    #[serde(default)]
    session_id: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReadResolvedSessionRequest {
    storage_root: String,
    session_id: String,
    #[serde(default)]
    computer_power_state: Option<String>,
}

fn to_error(message: impl Into<String>) -> Error {
    Error::new(Status::InvalidArg, message.into())
}

fn now_string() -> String {
    match SystemTime::now().duration_since(UNIX_EPOCH) {
        Ok(duration) => duration.as_millis().to_string(),
        Err(_) => "0".to_string(),
    }
}

fn parse_json<T: DeserializeOwned>(value: &str) -> Result<T> {
    serde_json::from_str(value)
        .map_err(|error| to_error(format!("failed to parse request JSON: {error}")))
}

fn to_json<T: Serialize>(value: &T) -> Result<String> {
    serde_json::to_string(value)
        .map_err(|error| to_error(format!("failed to serialize response JSON: {error}")))
}

fn normalize_required(value: &str, field_name: &str) -> Result<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(to_error(format!("{field_name} is required")));
    }
    Ok(trimmed.to_string())
}

fn sanitize_file_name(value: &str) -> String {
    let mut output = String::with_capacity(value.len());
    for ch in value.chars() {
        if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' || ch == '.' {
            output.push(ch);
        } else {
            output.push('_');
        }
    }
    if output.is_empty() {
        "value".to_string()
    } else {
        output
    }
}

fn normalize_absolute_path(value: &str, field_name: &str) -> Result<PathBuf> {
    let trimmed = normalize_required(value, field_name)?;
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

fn registry_path(storage_root: &Path) -> PathBuf {
    storage_root.join("registry.json")
}

fn images_root(storage_root: &Path) -> PathBuf {
    storage_root.join("images")
}

fn data_root(storage_root: &Path) -> PathBuf {
    storage_root.join("data")
}

fn build_default_registry() -> SystemRegistryDocument {
    SystemRegistryDocument {
        version: REGISTRY_VERSION,
        default_image_id: None,
        runtime_mode_override: None,
        installed_images: Vec::new(),
        session_assignments: Vec::new(),
        session_runtime_mode_overrides: Vec::new(),
        updated_at: now_string(),
    }
}

fn read_registry(storage_root: &Path) -> Result<SystemRegistryDocument> {
    let file_path = registry_path(storage_root);
    if !file_path.exists() {
        return Ok(build_default_registry());
    }
    let raw = fs::read_to_string(&file_path)
        .map_err(|error| to_error(format!("failed to read registry: {error}")))?;
    let mut doc: SystemRegistryDocument = serde_json::from_str(&raw)
        .map_err(|error| to_error(format!("failed to decode registry: {error}")))?;

    if doc.version != REGISTRY_VERSION {
        doc.version = REGISTRY_VERSION;
    }
    sanitize_registry(&mut doc);
    Ok(doc)
}

fn save_registry(storage_root: &Path, registry: &SystemRegistryDocument) -> Result<()> {
    fs::create_dir_all(storage_root)
        .map_err(|error| to_error(format!("failed to create storage root: {error}")))?;
    let raw = serde_json::to_string_pretty(registry)
        .map_err(|error| to_error(format!("failed to encode registry: {error}")))?;
    fs::write(registry_path(storage_root), raw)
        .map_err(|error| to_error(format!("failed to write registry: {error}")))?;
    Ok(())
}

fn sanitize_registry(registry: &mut SystemRegistryDocument) {
    registry.installed_images.sort_by(|left, right| {
        left.image_id
            .cmp(&right.image_id)
            .then_with(|| right.updated_at.cmp(&left.updated_at))
    });

    let mut dedup = Vec::new();
    for descriptor in registry.installed_images.clone().into_iter() {
        if dedup
            .iter()
            .any(|entry: &SystemImageDescriptor| entry.image_id == descriptor.image_id)
        {
            continue;
        }
        dedup.push(descriptor);
    }
    registry.installed_images = dedup;

    registry.session_assignments.retain(|entry| {
        registry
            .installed_images
            .iter()
            .any(|image| image.image_id == entry.image_id)
    });
    registry
        .session_assignments
        .sort_by(|left, right| left.session_id.cmp(&right.session_id));

    registry
        .session_runtime_mode_overrides
        .retain(|entry| is_valid_runtime_mode(&entry.runtime_mode));
    registry
        .session_runtime_mode_overrides
        .sort_by(|left, right| left.session_id.cmp(&right.session_id));

    if let Some(default_image_id) = registry.default_image_id.clone() {
        if registry
            .installed_images
            .iter()
            .any(|image| image.image_id == default_image_id)
            == false
        {
            registry.default_image_id = None;
        }
    }

    if registry.default_image_id.is_none() {
        registry.default_image_id = registry
            .installed_images
            .first()
            .map(|descriptor| descriptor.image_id.clone());
    }

    if let Some(mode) = registry.runtime_mode_override.clone() {
        if !is_valid_runtime_mode(&mode) {
            registry.runtime_mode_override = None;
        }
    }
}

fn remove_path_if_exists(path: &Path) -> Result<()> {
    if !path.exists() {
        return Ok(());
    }
    if path.is_dir() {
        fs::remove_dir_all(path)
            .map_err(|error| to_error(format!("failed to remove directory {}: {error}", path.display())))?;
    } else {
        fs::remove_file(path)
            .map_err(|error| to_error(format!("failed to remove file {}: {error}", path.display())))?;
    }
    Ok(())
}

fn copy_path_recursive(source_path: &Path, target_directory: &Path) -> Result<()> {
    remove_path_if_exists(target_directory)?;
    fs::create_dir_all(target_directory)
        .map_err(|error| to_error(format!("failed to create directory {}: {error}", target_directory.display())))?;

    if source_path.is_file() {
        let file_name = source_path
            .file_name()
            .ok_or_else(|| to_error("source file is missing file name"))?;
        fs::copy(source_path, target_directory.join(file_name))
            .map_err(|error| to_error(format!("failed to copy file {}: {error}", source_path.display())))?;
        return Ok(());
    }

    for entry in WalkDir::new(source_path).sort_by_file_name() {
        let entry = entry.map_err(|error| to_error(format!("failed to walk source path: {error}")))?;
        let relative = entry
            .path()
            .strip_prefix(source_path)
            .map_err(|error| to_error(format!("failed to compute relative path: {error}")))?;
        if relative.as_os_str().is_empty() {
            continue;
        }

        let destination = target_directory.join(relative);
        if entry.file_type().is_dir() {
            fs::create_dir_all(&destination)
                .map_err(|error| to_error(format!("failed to create directory {}: {error}", destination.display())))?;
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

fn parse_semver(value: &str) -> (u64, u64, u64) {
    let mut numbers = value
        .split('.')
        .map(|segment| segment.trim().parse::<u64>().unwrap_or(0))
        .collect::<Vec<_>>();
    while numbers.len() < 3 {
        numbers.push(0);
    }
    (numbers[0], numbers[1], numbers[2])
}

fn compare_semver(left: &str, right: &str) -> Ordering {
    parse_semver(left).cmp(&parse_semver(right))
}

fn is_valid_runtime_mode(value: &str) -> bool {
    value == RUNTIME_SANDBOX || value == RUNTIME_INPROCESS
}

fn is_valid_shell_mode(value: &str) -> bool {
    value == SHELL_CONTENT_ONLY || value == SHELL_FULL
}

fn normalize_platform(value: &str) -> Option<String> {
    let normalized = value.trim().to_lowercase();
    match normalized.as_str() {
        "linux" | "macos" | "windows" | PLATFORM_ANY => Some(normalized),
        _ => None,
    }
}

fn normalize_arch(value: &str) -> Option<String> {
    let normalized = value.trim().to_lowercase();
    match normalized.as_str() {
        "x64" | "arm64" | ARCH_ANY => Some(normalized),
        _ => None,
    }
}

fn host_platform() -> &'static str {
    if cfg!(target_os = "macos") {
        "macos"
    } else if cfg!(target_os = "windows") {
        "windows"
    } else {
        "linux"
    }
}

fn host_arch() -> &'static str {
    if cfg!(target_arch = "aarch64") {
        "arm64"
    } else {
        "x64"
    }
}

fn validate_manifest(manifest: &SystemImageManifest) -> Result<()> {
    normalize_required(&manifest.id, "manifest.id")?;
    normalize_required(&manifest.title, "manifest.title")?;
    normalize_required(&manifest.version, "manifest.version")?;
    normalize_required(&manifest.api_version.min, "manifest.apiVersion.min")?;
    normalize_required(&manifest.entry_path, "manifest.entryPath")?;

    if !is_valid_runtime_mode(&manifest.default_runtime_mode) {
        return Err(to_error("manifest.defaultRuntimeMode must be sandbox or inprocess"));
    }
    if !is_valid_shell_mode(&manifest.shell_mode) {
        return Err(to_error("manifest.shellMode must be content-only or full-shell"));
    }

    if compare_semver(&manifest.api_version.min, CURRENT_API_VERSION) == Ordering::Greater {
        return Err(to_error(format!(
            "system image requires apiVersion.min={} but current Lyra apiVersion={} is lower",
            manifest.api_version.min, CURRENT_API_VERSION
        )));
    }

    if let Some(maximum) = manifest.api_version.max.as_ref() {
        if compare_semver(maximum, CURRENT_API_VERSION) == Ordering::Less {
            return Err(to_error(format!(
                "system image supports apiVersion.max={} but current Lyra apiVersion={} is higher",
                maximum, CURRENT_API_VERSION
            )));
        }
    }

    let host_platform = host_platform().to_string();
    let host_arch = host_arch().to_string();

    if !manifest.platform_artifacts.is_empty() {
        let mut has_match = false;
        for artifact in &manifest.platform_artifacts {
            let platform = normalize_platform(&artifact.platform)
                .ok_or_else(|| to_error("manifest.platformArtifacts[].platform is invalid"))?;
            let arch = normalize_arch(&artifact.arch)
                .ok_or_else(|| to_error("manifest.platformArtifacts[].arch is invalid"))?;
            normalize_required(&artifact.kind, "manifest.platformArtifacts[].kind")?;
            normalize_required(&artifact.path, "manifest.platformArtifacts[].path")?;

            if (platform == PLATFORM_ANY || platform == host_platform)
                && (arch == ARCH_ANY || arch == host_arch)
            {
                has_match = true;
            }
        }

        if !has_match {
            return Err(to_error(format!(
                "no compatible platform artifact for host platform={} arch={}",
                host_platform, host_arch
            )));
        }
    }

    Ok(())
}

fn create_registry_state(registry: &SystemRegistryDocument) -> SystemRegistryState {
    SystemRegistryState {
        default_image_id: registry.default_image_id.clone(),
        runtime_mode_override: registry.runtime_mode_override.clone(),
        installed_images: registry.installed_images.clone(),
    }
}

fn install_path_for_manifest(storage_root: &Path, manifest: &SystemImageManifest) -> PathBuf {
    images_root(storage_root)
        .join(sanitize_file_name(&manifest.id))
        .join(sanitize_file_name(&manifest.version))
}

fn upsert_installed_image(
    registry: &mut SystemRegistryDocument,
    next: SystemImageDescriptor,
) -> Option<SystemImageDescriptor> {
    if let Some(index) = registry
        .installed_images
        .iter()
        .position(|entry| entry.image_id == next.image_id)
    {
        let previous = registry.installed_images[index].clone();
        registry.installed_images[index] = next;
        Some(previous)
    } else {
        registry.installed_images.push(next);
        None
    }
}

fn install_from_manifest(
    storage_root: &Path,
    mut registry: SystemRegistryDocument,
    manifest: SystemImageManifest,
    source: &str,
    payload_source: Option<&Path>,
) -> Result<(SystemRegistryDocument, SystemImageDescriptor)> {
    validate_manifest(&manifest)?;

    let install_path = install_path_for_manifest(storage_root, &manifest);
    fs::create_dir_all(install_path.parent().unwrap_or(storage_root))
        .map_err(|error| to_error(format!("failed to prepare install directory: {error}")))?;

    match payload_source {
        Some(source_path) => {
            copy_path_recursive(source_path, &install_path)?;
        }
        None => {
            remove_path_if_exists(&install_path)?;
            fs::create_dir_all(&install_path)
                .map_err(|error| to_error(format!("failed to create install path: {error}")))?;
            let manifest_path = install_path.join("lyra.system.json");
            let raw = serde_json::to_string_pretty(&manifest)
                .map_err(|error| to_error(format!("failed to encode manifest: {error}")))?;
            fs::write(&manifest_path, raw)
                .map_err(|error| to_error(format!("failed to write manifest: {error}")))?;
        }
    }

    let timestamp = now_string();
    let descriptor = SystemImageDescriptor {
        image_id: manifest.id.clone(),
        title: manifest.title.clone(),
        version: manifest.version.clone(),
        source: source.to_string(),
        install_path: path_to_string(&install_path),
        installed_at: timestamp.clone(),
        updated_at: timestamp.clone(),
        manifest,
    };

    let previous = upsert_installed_image(&mut registry, descriptor.clone());
    if let Some(previous_descriptor) = previous {
        if previous_descriptor.install_path != descriptor.install_path {
            let previous_path = PathBuf::from(&previous_descriptor.install_path);
            let _ = remove_path_if_exists(&previous_path);
        }
    }

    if registry.default_image_id.is_none() {
        registry.default_image_id = Some(descriptor.image_id.clone());
    }
    registry.updated_at = timestamp;
    sanitize_registry(&mut registry);
    Ok((registry, descriptor))
}

fn read_manifest_from_directory(directory_path: &Path) -> Result<SystemImageManifest> {
    let manifest_candidates = [
        directory_path.join("lyra.system.json"),
        directory_path.join("system-image.json"),
    ];

    for candidate in manifest_candidates {
        if !candidate.exists() {
            continue;
        }
        let raw = fs::read_to_string(&candidate)
            .map_err(|error| to_error(format!("failed to read manifest {}: {error}", candidate.display())))?;
        let manifest: SystemImageManifest = serde_json::from_str(&raw)
            .map_err(|error| to_error(format!("failed to decode manifest {}: {error}", candidate.display())))?;
        return Ok(manifest);
    }

    Err(to_error(
        "directory install requires lyra.system.json or system-image.json",
    ))
}

fn read_manifest_from_package(package_path: &Path) -> Result<(SystemImageManifest, Option<PathBuf>)> {
    let raw = fs::read_to_string(package_path)
        .map_err(|error| to_error(format!("failed to read package {}: {error}", package_path.display())))?;

    if let Ok(payload) = serde_json::from_str::<PackagePayload>(&raw) {
        let payload_path = payload
            .payload_directory
            .as_deref()
            .map(|value| normalize_absolute_path(value, "payloadDirectory"))
            .transpose()?;
        return Ok((payload.manifest, payload_path));
    }

    let manifest = serde_json::from_str::<SystemImageManifest>(&raw)
        .map_err(|error| to_error(format!("failed to decode package manifest: {error}")))?;
    Ok((manifest, None))
}

fn resolve_runtime_mode(
    registry: &SystemRegistryDocument,
    session_id: &str,
    manifest: Option<&SystemImageManifest>,
) -> Option<String> {
    if let Some(entry) = registry
        .session_runtime_mode_overrides
        .iter()
        .find(|entry| entry.session_id == session_id)
    {
        return Some(entry.runtime_mode.clone());
    }

    if let Some(mode) = registry.runtime_mode_override.as_ref() {
        return Some(mode.clone());
    }

    manifest.map(|entry| entry.default_runtime_mode.clone())
}

fn resolve_context_state(
    has_image: bool,
    power_state: Option<&str>,
) -> String {
    let normalized_power = power_state.unwrap_or(POWER_ON);
    if has_image {
        match normalized_power {
            POWER_OFF | POWER_SHUTTING_DOWN => CONTEXT_OFF.to_string(),
            POWER_BOOTING => CONTEXT_BOOTING.to_string(),
            _ => CONTEXT_ON.to_string(),
        }
    } else {
        match normalized_power {
            POWER_OFF | POWER_SHUTTING_DOWN => CONTEXT_OFF.to_string(),
            POWER_BOOTING => CONTEXT_BOOTING.to_string(),
            _ => CONTEXT_ERROR.to_string(),
        }
    }
}

fn resolve_session_system(
    registry: &SystemRegistryDocument,
    session_id: &str,
    computer_power_state: Option<&str>,
) -> ResolvedSessionSystem {
    let assigned_image_id = registry
        .session_assignments
        .iter()
        .find(|entry| entry.session_id == session_id)
        .map(|entry| entry.image_id.clone());

    let resolved_image_id = assigned_image_id.or_else(|| registry.default_image_id.clone());

    let descriptor = resolved_image_id.as_ref().and_then(|image_id| {
        registry
            .installed_images
            .iter()
            .find(|entry| entry.image_id == *image_id)
    });

    let effective_runtime_mode = resolve_runtime_mode(registry, session_id, descriptor.map(|entry| &entry.manifest));
    let effective_shell_mode = descriptor.map(|entry| entry.manifest.shell_mode.clone());

    ResolvedSessionSystem {
        session_id: session_id.to_string(),
        resolved_system_image_id: descriptor.map(|entry| entry.image_id.clone()),
        effective_runtime_mode,
        effective_shell_mode,
        system_context_state: resolve_context_state(descriptor.is_some(), computer_power_state),
        updated_at: now_string(),
    }
}

fn read_registry_state(storage_root: &Path) -> Result<SystemRegistryState> {
    let mut registry = read_registry(storage_root)?;
    sanitize_registry(&mut registry);
    Ok(create_registry_state(&registry))
}

fn install_from_directory(
    storage_root: &Path,
    directory_path: &Path,
) -> Result<SystemImageDescriptor> {
    let mut registry = read_registry(storage_root)?;
    let manifest = read_manifest_from_directory(directory_path)?;
    let (next_registry, descriptor) = install_from_manifest(
        storage_root,
        registry,
        manifest,
        SOURCE_DIRECTORY,
        Some(directory_path),
    )?;
    registry = next_registry;
    save_registry(storage_root, &registry)?;
    Ok(descriptor)
}

fn install_from_package(storage_root: &Path, package_path: &Path) -> Result<SystemImageDescriptor> {
    let mut registry = read_registry(storage_root)?;
    let (manifest, payload_path) = read_manifest_from_package(package_path)?;
    let (next_registry, descriptor) = install_from_manifest(
        storage_root,
        registry,
        manifest,
        SOURCE_PACKAGE,
        payload_path.as_deref(),
    )?;

    if payload_path.is_none() {
        let install_dir = PathBuf::from(&descriptor.install_path);
        let package_target = install_dir.join("package.lyraos");
        let _ = fs::copy(package_path, package_target);
    }

    registry = next_registry;
    save_registry(storage_root, &registry)?;
    Ok(descriptor)
}

fn install_seed(
    storage_root: &Path,
    manifest: SystemImageManifest,
) -> Result<SystemImageDescriptor> {
    let mut registry = read_registry(storage_root)?;
    let (next_registry, descriptor) = install_from_manifest(
        storage_root,
        registry,
        manifest,
        SOURCE_BUILTIN_SEED,
        None,
    )?;
    registry = next_registry;
    save_registry(storage_root, &registry)?;
    Ok(descriptor)
}

fn uninstall_image(storage_root: &Path, image_id: &str, wipe_data: bool) -> Result<SystemRegistryState> {
    let image_id = normalize_required(image_id, "imageId")?;
    let mut registry = read_registry(storage_root)?;

    if let Some(index) = registry
        .installed_images
        .iter()
        .position(|entry| entry.image_id == image_id)
    {
        let removed = registry.installed_images.remove(index);
        let install_path = PathBuf::from(removed.install_path);
        remove_path_if_exists(&install_path)?;
    }

    if registry.default_image_id.as_deref() == Some(image_id.as_str()) {
        registry.default_image_id = None;
    }

    registry
        .session_assignments
        .retain(|entry| entry.image_id != image_id);

    if wipe_data {
        let image_data_path = data_root(storage_root).join(sanitize_file_name(&image_id));
        remove_path_if_exists(&image_data_path)?;
    }

    registry.updated_at = now_string();
    sanitize_registry(&mut registry);
    save_registry(storage_root, &registry)?;
    Ok(create_registry_state(&registry))
}

fn set_default_image(storage_root: &Path, image_id: Option<String>) -> Result<SystemRegistryState> {
    let mut registry = read_registry(storage_root)?;
    registry.default_image_id = image_id
        .map(|value| normalize_required(&value, "imageId"))
        .transpose()?;

    if let Some(default_image_id) = registry.default_image_id.as_ref() {
        if registry
            .installed_images
            .iter()
            .any(|entry| &entry.image_id == default_image_id)
            == false
        {
            return Err(to_error("default image is not installed"));
        }
    }

    registry.updated_at = now_string();
    sanitize_registry(&mut registry);
    save_registry(storage_root, &registry)?;
    Ok(create_registry_state(&registry))
}

fn assign_session_image(
    storage_root: &Path,
    session_id: &str,
    image_id: Option<String>,
    computer_power_state: Option<&str>,
) -> Result<ResolvedSessionSystem> {
    let session_id = normalize_required(session_id, "sessionId")?;
    let mut registry = read_registry(storage_root)?;

    registry
        .session_assignments
        .retain(|entry| entry.session_id != session_id);

    if let Some(image_id) = image_id {
        let normalized_image_id = normalize_required(&image_id, "imageId")?;
        if registry
            .installed_images
            .iter()
            .any(|entry| entry.image_id == normalized_image_id)
            == false
        {
            return Err(to_error("session image is not installed"));
        }

        registry.session_assignments.push(SessionAssignment {
            session_id: session_id.clone(),
            image_id: normalized_image_id,
            updated_at: now_string(),
        });
    }

    registry.updated_at = now_string();
    sanitize_registry(&mut registry);
    save_registry(storage_root, &registry)?;
    Ok(resolve_session_system(
        &registry,
        &session_id,
        computer_power_state,
    ))
}

fn clear_session_override(
    storage_root: &Path,
    session_id: &str,
    computer_power_state: Option<&str>,
) -> Result<ResolvedSessionSystem> {
    let session_id = normalize_required(session_id, "sessionId")?;
    let mut registry = read_registry(storage_root)?;
    registry
        .session_assignments
        .retain(|entry| entry.session_id != session_id);
    registry.updated_at = now_string();
    sanitize_registry(&mut registry);
    save_registry(storage_root, &registry)?;
    Ok(resolve_session_system(
        &registry,
        &session_id,
        computer_power_state,
    ))
}

fn set_runtime_mode_override(
    storage_root: &Path,
    runtime_mode: Option<String>,
    session_id: Option<String>,
) -> Result<SystemRegistryState> {
    let mut registry = read_registry(storage_root)?;

    let normalized_mode = runtime_mode
        .map(|value| normalize_required(&value, "runtimeMode"))
        .transpose()?;

    if let Some(mode) = normalized_mode.as_ref() {
        if !is_valid_runtime_mode(mode) {
            return Err(to_error("runtimeMode must be sandbox or inprocess"));
        }
    }

    if let Some(session_id) = session_id {
        let session_id = normalize_required(&session_id, "sessionId")?;
        registry
            .session_runtime_mode_overrides
            .retain(|entry| entry.session_id != session_id);
        if let Some(mode) = normalized_mode {
            registry.session_runtime_mode_overrides.push(SessionRuntimeModeOverride {
                session_id,
                runtime_mode: mode,
                updated_at: now_string(),
            });
        }
    } else {
        registry.runtime_mode_override = normalized_mode;
    }

    registry.updated_at = now_string();
    sanitize_registry(&mut registry);
    save_registry(storage_root, &registry)?;
    Ok(create_registry_state(&registry))
}

fn read_resolved_session(
    storage_root: &Path,
    session_id: &str,
    computer_power_state: Option<&str>,
) -> Result<ResolvedSessionSystem> {
    let session_id = normalize_required(session_id, "sessionId")?;
    let mut registry = read_registry(storage_root)?;
    sanitize_registry(&mut registry);
    Ok(resolve_session_system(
        &registry,
        &session_id,
        computer_power_state,
    ))
}

#[napi(js_name = "readSystemImageRegistryJson")]
pub fn read_system_image_registry_json(request_json: String) -> Result<String> {
    let request: StorageRequest = parse_json(&request_json)?;
    let storage_root = normalize_absolute_path(&request.storage_root, "storageRoot")?;
    let state = read_registry_state(&storage_root)?;
    to_json(&state)
}

#[napi(js_name = "listInstalledSystemImagesJson")]
pub fn list_installed_system_images_json(request_json: String) -> Result<String> {
    let request: StorageRequest = parse_json(&request_json)?;
    let storage_root = normalize_absolute_path(&request.storage_root, "storageRoot")?;
    let state = read_registry_state(&storage_root)?;
    to_json(&state.installed_images)
}

#[napi(js_name = "installSystemImageFromDirectoryJson")]
pub fn install_system_image_from_directory_json(request_json: String) -> Result<String> {
    let request: InstallFromDirectoryRequest = parse_json(&request_json)?;
    let storage_root = normalize_absolute_path(&request.storage_root, "storageRoot")?;
    let directory_path = normalize_absolute_path(&request.directory_path, "directoryPath")?;
    let descriptor = install_from_directory(&storage_root, &directory_path)?;
    to_json(&descriptor)
}

#[napi(js_name = "installSystemImageFromPackageJson")]
pub fn install_system_image_from_package_json(request_json: String) -> Result<String> {
    let request: InstallFromPackageRequest = parse_json(&request_json)?;
    let storage_root = normalize_absolute_path(&request.storage_root, "storageRoot")?;
    let package_path = normalize_absolute_path(&request.package_path, "packagePath")?;
    let descriptor = install_from_package(&storage_root, &package_path)?;
    to_json(&descriptor)
}

#[napi(js_name = "installSystemImageSeedJson")]
pub fn install_system_image_seed_json(request_json: String) -> Result<String> {
    let request: InstallSeedRequest = parse_json(&request_json)?;
    let storage_root = normalize_absolute_path(&request.storage_root, "storageRoot")?;
    let descriptor = install_seed(&storage_root, request.manifest)?;
    to_json(&descriptor)
}

#[napi(js_name = "uninstallSystemImageJson")]
pub fn uninstall_system_image_json(request_json: String) -> Result<String> {
    let request: UninstallRequest = parse_json(&request_json)?;
    let storage_root = normalize_absolute_path(&request.storage_root, "storageRoot")?;
    let state = uninstall_image(
        &storage_root,
        &request.image_id,
        request.wipe_data.unwrap_or(false),
    )?;
    to_json(&state)
}

#[napi(js_name = "setDefaultSystemImageJson")]
pub fn set_default_system_image_json(request_json: String) -> Result<String> {
    let request: SetDefaultRequest = parse_json(&request_json)?;
    let storage_root = normalize_absolute_path(&request.storage_root, "storageRoot")?;
    let state = set_default_image(&storage_root, request.image_id)?;
    to_json(&state)
}

#[napi(js_name = "assignSessionSystemImageJson")]
pub fn assign_session_system_image_json(request_json: String) -> Result<String> {
    let request: AssignSessionImageRequest = parse_json(&request_json)?;
    let storage_root = normalize_absolute_path(&request.storage_root, "storageRoot")?;
    let resolved = assign_session_image(
        &storage_root,
        &request.session_id,
        request.image_id,
        request.computer_power_state.as_deref(),
    )?;
    to_json(&resolved)
}

#[napi(js_name = "clearSessionSystemImageOverrideJson")]
pub fn clear_session_system_image_override_json(request_json: String) -> Result<String> {
    let request: ClearSessionImageOverrideRequest = parse_json(&request_json)?;
    let storage_root = normalize_absolute_path(&request.storage_root, "storageRoot")?;
    let resolved = clear_session_override(
        &storage_root,
        &request.session_id,
        request.computer_power_state.as_deref(),
    )?;
    to_json(&resolved)
}

#[napi(js_name = "setSystemRuntimeModeOverrideJson")]
pub fn set_system_runtime_mode_override_json(request_json: String) -> Result<String> {
    let request: SetRuntimeModeOverrideRequest = parse_json(&request_json)?;
    let storage_root = normalize_absolute_path(&request.storage_root, "storageRoot")?;
    let state = set_runtime_mode_override(
        &storage_root,
        request.runtime_mode,
        request.session_id,
    )?;
    to_json(&state)
}

#[napi(js_name = "readResolvedSessionSystemJson")]
pub fn read_resolved_session_system_json(request_json: String) -> Result<String> {
    let request: ReadResolvedSessionRequest = parse_json(&request_json)?;
    let storage_root = normalize_absolute_path(&request.storage_root, "storageRoot")?;
    let resolved = read_resolved_session(
        &storage_root,
        &request.session_id,
        request.computer_power_state.as_deref(),
    )?;
    to_json(&resolved)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_storage_root(label: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "lyra-system-image-test-{}-{}",
            label,
            now_string()
        ));
        if path.exists() {
            let _ = fs::remove_dir_all(&path);
        }
        path
    }

    fn test_manifest(id: &str) -> SystemImageManifest {
        SystemImageManifest {
            id: id.to_string(),
            title: format!("{id} title"),
            version: "1.0.0".to_string(),
            api_version: SystemCompatibility {
                min: "1.0.0".to_string(),
                max: Some("1.0.0".to_string()),
            },
            shell_mode: SHELL_FULL.to_string(),
            default_runtime_mode: RUNTIME_SANDBOX.to_string(),
            entry_path: "renderer/index.js".to_string(),
            capabilities: vec!["*".to_string()],
            platform_artifacts: vec![PlatformArtifact {
                platform: PLATFORM_ANY.to_string(),
                arch: ARCH_ANY.to_string(),
                kind: "js-module".to_string(),
                path: "renderer/index.js".to_string(),
            }],
        }
    }

    #[test]
    fn installs_seed_and_resolves_default() {
        let storage_root = temp_storage_root("seed");
        let descriptor = install_seed(&storage_root, test_manifest("official")).expect("install");
        assert_eq!(descriptor.image_id, "official");

        let resolved = read_resolved_session(&storage_root, "session-1", Some(POWER_ON))
            .expect("resolve");
        assert_eq!(resolved.resolved_system_image_id.as_deref(), Some("official"));
        assert_eq!(resolved.system_context_state, CONTEXT_ON);
    }

    #[test]
    fn supports_session_override() {
        let storage_root = temp_storage_root("override");
        install_seed(&storage_root, test_manifest("official")).expect("install official");
        install_seed(&storage_root, test_manifest("community")).expect("install community");

        let resolved = assign_session_image(
            &storage_root,
            "session-2",
            Some("community".to_string()),
            Some(POWER_ON),
        )
        .expect("assign");

        assert_eq!(resolved.resolved_system_image_id.as_deref(), Some("community"));
    }

    #[test]
    fn rejects_incompatible_api_version() {
        let storage_root = temp_storage_root("compat");
        let mut manifest = test_manifest("future");
        manifest.api_version.min = "2.0.0".to_string();
        let result = install_seed(&storage_root, manifest);
        assert!(result.is_err());
    }

    #[test]
    fn uninstall_can_wipe_data() {
        let storage_root = temp_storage_root("wipe");
        install_seed(&storage_root, test_manifest("official")).expect("install");
        let data_dir = data_root(&storage_root).join("official");
        fs::create_dir_all(&data_dir).expect("create data dir");
        fs::write(data_dir.join("state.json"), "{}".as_bytes()).expect("write data file");

        let _ = uninstall_image(&storage_root, "official", true).expect("uninstall");
        assert!(!data_dir.exists());
    }
}
