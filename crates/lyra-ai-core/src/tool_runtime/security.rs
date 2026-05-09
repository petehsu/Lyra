use crate::tool_runtime::operation::{
    tool_error, TOOL_EXECUTION_FAILED, TOOL_PATH_NOT_FOUND, TOOL_PATH_OUTSIDE_WORKSPACE,
    TOOL_WORKSPACE_REQUIRED,
};
use anyhow::Result;
use std::io::ErrorKind;
use std::path::{Component, Path, PathBuf};

#[derive(Clone, Debug)]
pub struct WorkspaceSecurity {
    root: PathBuf,
}

impl WorkspaceSecurity {
    pub fn new(workspace_root: Option<&str>) -> Result<Self> {
        let raw_root = workspace_root
            .map(str::trim)
            .filter(|value| value.is_empty() == false)
            .ok_or_else(|| tool_error(TOOL_WORKSPACE_REQUIRED, "No workspace root is bound"))?;
        let root = Path::new(raw_root).canonicalize().map_err(|error| {
            if error.kind() == ErrorKind::NotFound {
                tool_error(
                    TOOL_WORKSPACE_REQUIRED,
                    format!("workspace root is unavailable: {raw_root}"),
                )
            } else {
                tool_error(
                    TOOL_EXECUTION_FAILED,
                    format!("failed to resolve workspace root: {error}"),
                )
            }
        })?;
        if root.is_dir() == false {
            return Err(tool_error(
                TOOL_WORKSPACE_REQUIRED,
                "workspace root is not a directory",
            ));
        }
        Ok(Self { root })
    }

    pub fn resolve_existing_path(&self, raw_path: Option<&str>) -> Result<PathBuf> {
        let raw_path = raw_path
            .map(str::trim)
            .filter(|value| value.is_empty() == false)
            .unwrap_or(".");
        let requested = Path::new(raw_path);
        if requested
            .components()
            .any(|component| component == Component::ParentDir)
        {
            return Err(tool_error(
                TOOL_PATH_OUTSIDE_WORKSPACE,
                "parent path segments are not allowed",
            ));
        }
        let candidate = if requested.is_absolute() {
            requested.to_path_buf()
        } else {
            self.root.join(requested)
        };
        let canonical = candidate.canonicalize().map_err(|error| {
            if error.kind() == ErrorKind::NotFound {
                tool_error(
                    TOOL_PATH_NOT_FOUND,
                    format!("path is unavailable: {raw_path}"),
                )
            } else {
                tool_error(
                    TOOL_EXECUTION_FAILED,
                    format!("failed to resolve path: {error}"),
                )
            }
        })?;
        if canonical.starts_with(&self.root) == false {
            return Err(tool_error(
                TOOL_PATH_OUTSIDE_WORKSPACE,
                "path is outside the workspace",
            ));
        }
        Ok(canonical)
    }

    pub fn validate_relative_path_for_write_preview(&self, raw_path: &str) -> Result<String> {
        self.validate_relative_path_for_write(raw_path, false)
    }

    pub fn validate_relative_path_for_write_create(&self, raw_path: &str) -> Result<String> {
        self.validate_relative_path_for_write(raw_path, true)
    }

    fn validate_relative_path_for_write(
        &self,
        raw_path: &str,
        allow_missing_parent: bool,
    ) -> Result<String> {
        let raw_path = raw_path.trim();
        if raw_path.is_empty() {
            return Err(tool_error(
                TOOL_PATH_OUTSIDE_WORKSPACE,
                "path must not be empty",
            ));
        }
        let requested = Path::new(raw_path);
        if requested.is_absolute()
            || requested
                .components()
                .any(|component| matches!(component, Component::ParentDir | Component::Prefix(_)))
        {
            return Err(tool_error(
                TOOL_PATH_OUTSIDE_WORKSPACE,
                "path must be relative to the workspace",
            ));
        }
        let candidate = self.root.join(requested);
        if candidate.exists() {
            let canonical = candidate.canonicalize().map_err(|error| {
                tool_error(
                    TOOL_EXECUTION_FAILED,
                    format!("failed to resolve path: {error}"),
                )
            })?;
            if canonical.starts_with(&self.root) == false {
                return Err(tool_error(
                    TOOL_PATH_OUTSIDE_WORKSPACE,
                    "path is outside the workspace",
                ));
            }
        } else {
            let mut parent = candidate
                .parent()
                .filter(|path| path.as_os_str().is_empty() == false)
                .unwrap_or(&self.root);
            if allow_missing_parent {
                while parent.exists() == false {
                    parent = parent.parent().unwrap_or(&self.root);
                }
            }
            let parent = parent.canonicalize().map_err(|error| {
                if error.kind() == ErrorKind::NotFound {
                    tool_error(
                        TOOL_PATH_NOT_FOUND,
                        format!("parent path is unavailable: {raw_path}"),
                    )
                } else {
                    tool_error(
                        TOOL_EXECUTION_FAILED,
                        format!("failed to resolve parent path: {error}"),
                    )
                }
            })?;
            if parent.starts_with(&self.root) == false {
                return Err(tool_error(
                    TOOL_PATH_OUTSIDE_WORKSPACE,
                    "path parent is outside the workspace",
                ));
            }
        }
        Ok(requested.to_string_lossy().replace('\\', "/"))
    }

    pub fn relative_display(&self, path: &Path) -> String {
        path.strip_prefix(&self.root)
            .ok()
            .and_then(|value| value.to_str())
            .filter(|value| value.is_empty() == false)
            .unwrap_or(".")
            .to_string()
    }

    pub fn root(&self) -> &Path {
        &self.root
    }
}

pub fn redact_secrets(input: &str) -> String {
    crate::security_gate::redaction::redact_secrets(input)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn workspace_security_blocks_parent_absolute_escape_and_symlink_escape() {
        let temp = tempfile::tempdir().expect("tempdir");
        let workspace = temp.path().join("workspace");
        let outside = temp.path().join("outside");
        fs::create_dir_all(&workspace).expect("workspace");
        fs::create_dir_all(&outside).expect("outside");
        fs::write(workspace.join("file.txt"), "ok").expect("file");
        fs::write(outside.join("secret.txt"), "secret").expect("secret");
        #[cfg(unix)]
        std::os::unix::fs::symlink(outside.join("secret.txt"), workspace.join("secret-link"))
            .expect("symlink");

        let security =
            WorkspaceSecurity::new(Some(workspace.to_string_lossy().as_ref())).expect("security");

        assert!(security.resolve_existing_path(Some("file.txt")).is_ok());
        assert!(security
            .resolve_existing_path(Some("../outside/secret.txt"))
            .is_err());
        assert!(security
            .resolve_existing_path(Some(outside.join("secret.txt").to_string_lossy().as_ref()))
            .is_err());
        #[cfg(unix)]
        assert!(security.resolve_existing_path(Some("secret-link")).is_err());
        assert!(WorkspaceSecurity::new(None).is_err());
    }

    #[test]
    fn redaction_removes_obvious_secret_values() {
        let redacted = redact_secrets(
            "api_key = sk-testsecret123456\nAuthorization: Bearer token-value\nplain tp-secret",
        );

        assert!(redacted.contains("sk-testsecret") == false);
        assert!(redacted.contains("token-value") == false);
        assert!(redacted.contains("tp-secret") == false);
        assert!(redacted.contains("[REDACTED]"));
    }
}
