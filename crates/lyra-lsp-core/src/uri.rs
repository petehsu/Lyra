use std::path::{Path, PathBuf};

use url::Url;

use super::{Error, Result, Status};

pub fn to_error(message: impl Into<String>) -> Error {
    Error::new(Status::InvalidArg, message.into())
}

pub fn normalize_file_path(file_path: &str) -> Result<PathBuf> {
    let trimmed = file_path.trim();
    if trimmed.is_empty() {
        return Err(to_error("file_path is required"));
    }
    let path = PathBuf::from(trimmed);
    if path.is_absolute() {
        Ok(path)
    } else {
        std::env::current_dir()
            .map(|base| base.join(path))
            .map_err(|error| to_error(format!("failed to resolve file path: {error}")))
    }
}

pub fn normalize_project_root(project_root: Option<&str>, file_path: &Path) -> PathBuf {
    if let Some(explicit) = project_root {
        let trimmed = explicit.trim();
        if !trimmed.is_empty() {
            let explicit_path = PathBuf::from(trimmed);
            if explicit_path.is_absolute() {
                return explicit_path;
            }
            if let Ok(cwd) = std::env::current_dir() {
                return cwd.join(explicit_path);
            }
            return explicit_path;
        }
    }
    let mut cursor = if file_path.is_dir() {
        file_path.to_path_buf()
    } else {
        file_path
            .parent()
            .map(Path::to_path_buf)
            .unwrap_or_else(|| file_path.to_path_buf())
    };
    loop {
        if cursor.join(".git").exists() {
            return cursor;
        }
        if !cursor.pop() {
            break;
        }
    }
    file_path
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| file_path.to_path_buf())
}

pub fn path_to_file_uri(path: &Path) -> Result<String> {
    Url::from_file_path(path)
        .map(|value| value.to_string())
        .map_err(|_| to_error("failed to convert file path to uri"))
}

pub fn file_uri_to_path(value: &str) -> Option<String> {
    Url::parse(value)
        .ok()?
        .to_file_path()
        .ok()
        .map(|path| path.to_string_lossy().into_owned())
}
