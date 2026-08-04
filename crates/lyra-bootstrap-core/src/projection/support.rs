use std::collections::{HashMap, HashSet};
use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::{Component, Path};

use base64::{Engine as _, engine::general_purpose::STANDARD};
use semver::Version;
use serde::Serialize;
use sha2::{Digest, Sha256};

use super::{CORE_COMPONENT_ID, CORE_PAYLOAD_ENTRY, CORE_PROJECTION_ENTRY, ProjectedCoreMarkerV1};
use crate::archive::INSTALLED_MARKER;
use crate::download::sha256_file;
use crate::model::{ActivationRegistryV1, ComponentManifestV1, InstalledFileV1};
use crate::{BootstrapError, Result, Target};

#[cfg(not(windows))]
pub(super) fn executable_is_under(executable: &Path, root: &Path) -> bool {
    executable.starts_with(root)
}

#[cfg(windows)]
pub(super) fn executable_is_under(executable: &Path, root: &Path) -> bool {
    fn normalized(value: &Path) -> String {
        let value = value.to_string_lossy().replace('/', "\\");
        let value = value
            .strip_prefix(r"\\?\UNC\")
            .map(|suffix| format!(r"\\{suffix}"))
            .unwrap_or_else(|| {
                value
                    .strip_prefix(r"\\?\")
                    .unwrap_or(value.as_str())
                    .to_string()
            });
        value.trim_end_matches('\\').to_ascii_lowercase()
    }
    let executable = normalized(executable);
    let root = normalized(root);
    executable == root
        || executable
            .strip_prefix(&root)
            .is_some_and(|suffix| suffix.starts_with('\\'))
}

pub(super) fn validate_projection_marker(
    marker: &ProjectedCoreMarkerV1,
    target: &Target,
) -> Result<()> {
    if marker.schema_version != 1
        || marker.component_id != CORE_COMPONENT_ID
        || marker.target != target.as_str()
        || !is_sha256(&marker.component_archive_sha256)
        || !is_sha256(&marker.payload_sha256)
        || !is_sha256(&marker.inventory_sha256)
        || marker.file_count == 0
        || Version::parse(&marker.version).is_err()
        || marker
            .previous_version
            .as_deref()
            .is_some_and(|version| Version::parse(version).is_err())
    {
        return Err(BootstrapError::Trust(
            "projected Core marker has an invalid identity".to_string(),
        ));
    }
    Ok(())
}

pub(super) fn selected_core_version(registry: &ActivationRegistryV1) -> Result<(String, bool)> {
    let state = registry.components.get(CORE_COMPONENT_ID).ok_or_else(|| {
        BootstrapError::Validation("Core is missing from the activation registry".to_string())
    })?;
    if let Some(version) = state.pending.as_ref() {
        return Ok((version.clone(), true));
    }
    state
        .active
        .as_ref()
        .cloned()
        .map(|version| (version, false))
        .ok_or_else(|| {
            BootstrapError::Validation("Core has no active or pending version".to_string())
        })
}

pub(super) fn reconcile_release_pointer(registry: &mut ActivationRegistryV1) {
    if registry
        .components
        .values()
        .any(|state| state.pending.is_some())
    {
        return;
    }
    if let Some(pending) = registry.pending_release_version.take() {
        registry.active_release_version = Some(pending);
    }
}

pub(super) fn validate_core_manifest(
    manifest: &ComponentManifestV1,
    version: &str,
    target: &Target,
    installed_files: &[InstalledFileV1],
) -> Result<()> {
    let signature = STANDARD.decode(&manifest.signature).map_err(|error| {
        BootstrapError::Trust(format!("invalid Core manifest signature base64: {error}"))
    })?;
    if manifest.schema_version != 1
        || manifest.component_id != CORE_COMPONENT_ID
        || manifest.kind != "core"
        || manifest.version != version
        || manifest.target != target.as_str()
        || manifest.entry.as_deref() != Some(CORE_PROJECTION_ENTRY)
        || manifest.execution_class.is_some()
        || manifest.activation != "core-restart"
        || manifest.publisher.trim().is_empty()
        || manifest.key_id.trim().is_empty()
        || signature.len() != 64
        || manifest.files.is_empty()
    {
        return Err(BootstrapError::Trust(format!(
            "installed Core manifest identity is invalid for {CORE_COMPONENT_ID}@{version}"
        )));
    }
    let installed = installed_files
        .iter()
        .map(|file| (file.path.as_str(), file))
        .collect::<HashMap<_, _>>();
    if installed.len() != installed_files.len()
        || !installed.contains_key("component.json")
        || installed_files.len() != manifest.files.len().saturating_add(1)
    {
        return Err(BootstrapError::Trust(
            "installed Core inventory is incomplete".to_string(),
        ));
    }
    let mut declared = HashSet::new();
    for file in &manifest.files {
        validate_relative_path(&file.path)?;
        if file.path == "component.json"
            || !declared.insert(file.path.as_str())
            || !is_sha256(&file.sha256)
        {
            return Err(BootstrapError::Trust(format!(
                "invalid signed Core file `{}`",
                file.path
            )));
        }
        let installed = installed.get(file.path.as_str()).ok_or_else(|| {
            BootstrapError::Trust(format!("signed Core file is missing: {}", file.path))
        })?;
        if installed.size != file.size || installed.sha256 != file.sha256 {
            return Err(BootstrapError::Trust(format!(
                "signed Core file digest mismatch: {}",
                file.path
            )));
        }
    }
    if !declared.contains(CORE_PROJECTION_ENTRY) || !declared.contains(CORE_PAYLOAD_ENTRY) {
        return Err(BootstrapError::Trust(
            "Core manifest does not declare projection.json and payload.zip".to_string(),
        ));
    }
    Ok(())
}

pub(super) fn verify_installed_inventory(root: &Path, expected: &[InstalledFileV1]) -> Result<()> {
    if expected.is_empty() {
        return Err(BootstrapError::Trust(
            "installed component marker has an empty inventory".to_string(),
        ));
    }
    let actual = collect_regular_inventory(root, Some(INSTALLED_MARKER))?;
    if actual.len() != expected.len() {
        return Err(BootstrapError::Trust(
            "installed Core contains undeclared or missing files".to_string(),
        ));
    }
    let actual = actual
        .iter()
        .map(|file| (file.path.as_str(), file))
        .collect::<HashMap<_, _>>();
    let mut paths = HashSet::new();
    for file in expected {
        validate_relative_path(&file.path)?;
        if !paths.insert(file.path.as_str()) || !is_sha256(&file.sha256) {
            return Err(BootstrapError::Trust(
                "installed Core marker has a duplicate or invalid file".to_string(),
            ));
        }
        let actual = actual.get(file.path.as_str()).ok_or_else(|| {
            BootstrapError::Trust(format!("installed Core file is missing: {}", file.path))
        })?;
        if actual.size != file.size
            || actual.sha256 != file.sha256
            || file
                .unix_mode
                .is_some_and(|mode| actual.unix_mode != Some(mode))
        {
            return Err(BootstrapError::Trust(format!(
                "installed Core file failed verification: {}",
                file.path
            )));
        }
    }
    Ok(())
}

pub(super) fn collect_regular_inventory(
    root: &Path,
    excluded: Option<&str>,
) -> Result<Vec<InstalledFileV1>> {
    let mut pending = vec![root.to_path_buf()];
    let mut inventory = Vec::new();
    let mut folded = HashSet::new();
    while let Some(directory) = pending.pop() {
        let entries =
            fs::read_dir(&directory).map_err(|error| BootstrapError::io(&directory, error))?;
        for entry in entries {
            let entry = entry.map_err(|error| BootstrapError::io(&directory, error))?;
            let path = entry.path();
            let metadata =
                fs::symlink_metadata(&path).map_err(|error| BootstrapError::io(&path, error))?;
            if metadata.file_type().is_symlink() || (!metadata.is_dir() && !metadata.is_file()) {
                return Err(BootstrapError::Trust(format!(
                    "Core projection contains a link or special file: {}",
                    path.display()
                )));
            }
            if metadata.is_dir() {
                pending.push(path);
                continue;
            }
            let relative = path.strip_prefix(root).map_err(|_| {
                BootstrapError::Validation("Core file escaped its projection root".to_string())
            })?;
            let relative = path_to_slashes(relative)?;
            if excluded == Some(relative.as_str()) {
                continue;
            }
            if !folded.insert(relative.to_lowercase()) {
                return Err(BootstrapError::Trust(format!(
                    "Core projection contains a case-colliding path: {relative}"
                )));
            }
            inventory.push(InstalledFileV1 {
                path: relative,
                size: metadata.len(),
                sha256: sha256_file(&path)?,
                unix_mode: unix_mode(&metadata),
            });
        }
    }
    inventory.sort_by(|left, right| left.path.cmp(&right.path));
    if inventory.is_empty() {
        return Err(BootstrapError::Trust(
            "Core projection contains no regular files".to_string(),
        ));
    }
    Ok(inventory)
}

pub(super) fn inventory_digest(inventory: &[InstalledFileV1]) -> Result<String> {
    let bytes = serde_json::to_vec(inventory)
        .map_err(|error| BootstrapError::Json("Core projection inventory", error))?;
    Ok(format!("{:x}", Sha256::digest(bytes)))
}

#[cfg(unix)]
pub(super) fn unix_mode(metadata: &fs::Metadata) -> Option<u32> {
    use std::os::unix::fs::PermissionsExt;

    Some(metadata.permissions().mode() & 0o777)
}

#[cfg(not(unix))]
pub(super) fn unix_mode(_metadata: &fs::Metadata) -> Option<u32> {
    None
}

pub(super) fn read_bounded_regular_file(
    path: &Path,
    maximum: u64,
    label: &'static str,
) -> Result<Vec<u8>> {
    let metadata = fs::symlink_metadata(path).map_err(|error| BootstrapError::io(path, error))?;
    if metadata.file_type().is_symlink() || !metadata.is_file() || metadata.len() > maximum {
        return Err(BootstrapError::Validation(format!(
            "{label} must be a bounded regular file"
        )));
    }
    fs::read(path).map_err(|error| BootstrapError::io(path, error))
}

pub(super) fn write_new_json(
    path: &Path,
    value: &impl Serialize,
    label: &'static str,
) -> Result<()> {
    let bytes =
        serde_json::to_vec_pretty(value).map_err(|error| BootstrapError::Json(label, error))?;
    let mut file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(path)
        .map_err(|error| BootstrapError::io(path, error))?;
    file.write_all(&bytes)
        .map_err(|error| BootstrapError::io(path, error))?;
    file.sync_all()
        .map_err(|error| BootstrapError::io(path, error))
}

pub(super) fn open_lock(path: &Path) -> Result<File> {
    OpenOptions::new()
        .create(true)
        .read(true)
        .write(true)
        .open(path)
        .map_err(|error| BootstrapError::io(path, error))
}

pub(super) fn validate_absolute_non_root(label: &str, path: &Path) -> Result<()> {
    if !path.is_absolute() || path.parent().is_none() || path.parent() == Some(path) {
        return Err(BootstrapError::Validation(format!(
            "{label} must be an absolute non-root path"
        )));
    }
    Ok(())
}

pub(super) fn require_real_directory(path: &Path, label: &str) -> Result<()> {
    let metadata = fs::symlink_metadata(path).map_err(|error| BootstrapError::io(path, error))?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(BootstrapError::Validation(format!(
            "{label} must be a real directory: {}",
            path.display()
        )));
    }
    Ok(())
}

pub(super) fn path_exists(path: &Path) -> Result<bool> {
    match fs::symlink_metadata(path) {
        Ok(_) => Ok(true),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(BootstrapError::io(path, error)),
    }
}

pub(super) fn remove_real_directory_if_exists(path: &Path) -> Result<()> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(BootstrapError::io(path, error)),
    };
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(BootstrapError::Validation(format!(
            "refusing to remove non-directory Core transaction path: {}",
            path.display()
        )));
    }
    fs::remove_dir_all(path).map_err(|error| BootstrapError::io(path, error))
}

pub(super) fn validate_relative_path(value: &str) -> Result<()> {
    let path = Path::new(value);
    if value.is_empty() || value.contains('\\') || path.is_absolute() {
        return Err(BootstrapError::Validation(format!(
            "unsafe Core relative path `{value}`"
        )));
    }
    for component in path.components() {
        let Component::Normal(segment) = component else {
            return Err(BootstrapError::Validation(format!(
                "unsafe Core relative path `{value}`"
            )));
        };
        let segment = segment.to_str().ok_or_else(|| {
            BootstrapError::Validation("Core path is not valid UTF-8".to_string())
        })?;
        if segment.is_empty()
            || segment.ends_with('.')
            || segment.ends_with(' ')
            || segment.chars().any(|character| {
                character.is_control()
                    || matches!(character, '<' | '>' | ':' | '"' | '|' | '?' | '*')
            })
        {
            return Err(BootstrapError::Validation(format!(
                "unsafe Core path segment `{segment}`"
            )));
        }
    }
    Ok(())
}

pub(super) fn path_to_slashes(path: &Path) -> Result<String> {
    path.components()
        .map(|component| match component {
            Component::Normal(value) => value.to_str().map(str::to_string).ok_or_else(|| {
                BootstrapError::Validation("Core path is not valid UTF-8".to_string())
            }),
            _ => Err(BootstrapError::Validation(
                "Core path is not relative".to_string(),
            )),
        })
        .collect::<Result<Vec<_>>>()
        .map(|parts| parts.join("/"))
}

pub(super) fn is_sha256(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || matches!(byte, b'a'..=b'f'))
}

#[cfg(unix)]
pub(super) fn sync_directory(directory: &Path) -> Result<()> {
    File::open(directory)
        .and_then(|file| file.sync_all())
        .map_err(|error| BootstrapError::io(directory, error))
}

#[cfg(not(unix))]
pub(super) fn sync_directory(_directory: &Path) -> Result<()> {
    Ok(())
}
