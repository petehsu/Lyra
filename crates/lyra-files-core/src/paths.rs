use std::fs;
use std::path::{Component, Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::{FilesCoreError, Result};

fn io_error(context: impl Into<String>, source: std::io::Error) -> FilesCoreError {
    FilesCoreError::Io {
        context: context.into(),
        source,
    }
}

pub fn normalize_path(value: &str) -> Result<PathBuf> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(FilesCoreError::InvalidArgument(
            "path is required".to_string(),
        ));
    }
    Ok(PathBuf::from(trimmed))
}

pub fn normalize_name(value: &str) -> Result<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(FilesCoreError::InvalidArgument(
            "name is required".to_string(),
        ));
    }
    if trimmed == "." || trimmed == ".." || trimmed.contains('/') || trimmed.contains('\\') {
        return Err(FilesCoreError::InvalidArgument(
            "name contains unsupported path separators".to_string(),
        ));
    }
    Ok(trimmed.to_string())
}

pub(crate) fn canonical_directory_path(value: &str) -> Result<PathBuf> {
    let raw_path = normalize_path(value)?;
    let canonical_path = raw_path
        .canonicalize()
        .map_err(|error| io_error(format!("failed to access {}", raw_path.display()), error))?;
    let metadata = fs::metadata(&canonical_path).map_err(|error| {
        io_error(
            format!("failed to read {}", canonical_path.display()),
            error,
        )
    })?;
    if !metadata.is_dir() {
        return Err(FilesCoreError::InvalidArgument(format!(
            "{} is not a directory",
            canonical_path.display()
        )));
    }
    Ok(canonical_path)
}

pub fn lexical_normalize_path(path: &Path) -> PathBuf {
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Prefix(prefix) => normalized.push(prefix.as_os_str()),
            Component::RootDir => normalized.push(component.as_os_str()),
            Component::CurDir => {}
            Component::ParentDir => {
                if !normalized.pop() {
                    normalized.push(component.as_os_str());
                }
            }
            Component::Normal(segment) => normalized.push(segment),
        }
    }
    normalized
}

pub fn normalize_absolute_path(value: &str) -> Result<PathBuf> {
    let raw_path = normalize_path(value)?;
    let absolute_path = if raw_path.is_absolute() {
        raw_path
    } else {
        std::env::current_dir()
            .map_err(|error| io_error("failed to read current directory", error))?
            .join(raw_path)
    };

    Ok(lexical_normalize_path(&absolute_path))
}

pub fn find_git_root(start_path: &Path) -> Option<PathBuf> {
    let mut cursor = start_path.to_path_buf();

    loop {
        if cursor.join(".git").exists() {
            return Some(cursor);
        }

        let Some(parent) = cursor.parent() else {
            break;
        };
        if parent == cursor.as_path() {
            break;
        }
        cursor = parent.to_path_buf();
    }

    None
}

pub fn relative_workbench_path(path: &Path, base_path: &Path) -> PathBuf {
    match path.strip_prefix(base_path) {
        Ok(relative) => relative.to_path_buf(),
        Err(_) => path.to_path_buf(),
    }
}

pub fn path_to_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

pub fn os_to_string(value: &std::ffi::OsStr) -> String {
    value.to_string_lossy().into_owned()
}

pub fn file_name(path: &Path) -> String {
    path.file_name()
        .map(os_to_string)
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| path_to_string(path))
}

pub fn title_for_path(path: &Path) -> String {
    let title = file_name(path);
    if title.is_empty() {
        path_to_string(path)
    } else {
        title
    }
}

pub fn file_extension(path: &Path) -> Option<String> {
    path.extension()
        .map(os_to_string)
        .filter(|value| !value.is_empty())
}

pub fn is_hidden(path: &Path) -> bool {
    path.file_name()
        .map(|name| name.to_string_lossy().starts_with('.'))
        .unwrap_or(false)
}

pub fn seconds_since_epoch(value: SystemTime) -> Option<String> {
    value
        .duration_since(UNIX_EPOCH)
        .ok()
        .map(|duration| duration.as_secs().to_string())
}

pub fn location_path_key(path: &Path) -> String {
    let normalized = path_to_string(path).replace('\\', "/");
    #[cfg(any(target_os = "windows", target_os = "macos"))]
    {
        normalized.to_lowercase()
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        normalized
    }
}

pub(crate) fn directory_key(path: &Path) -> String {
    let normalized = lexical_normalize_path(path)
        .to_string_lossy()
        .replace('\\', "/");
    #[cfg(any(target_os = "windows", target_os = "macos"))]
    {
        normalized.to_lowercase()
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        normalized
    }
}

pub fn folder_state_from_path(path: &Path) -> String {
    match fs::read_dir(path) {
        Ok(mut entries) => match entries.next() {
            None => "empty".to_string(),
            Some(Ok(_)) => "non-empty".to_string(),
            Some(Err(_)) => "unknown".to_string(),
        },
        Err(_) => "unknown".to_string(),
    }
}
