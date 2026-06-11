use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::paths::{
    find_git_root, normalize_absolute_path, path_to_string, relative_workbench_path,
};
use crate::{FilesCoreError, Result};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkbenchPathProbeResult {
    pub normalized_path: String,
    pub existing_path: Option<String>,
    pub directory_path: Option<String>,
    pub project_root: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkbenchCollectedFilePath {
    pub path: String,
}

fn io_error(context: impl Into<String>, source: std::io::Error) -> FilesCoreError {
    FilesCoreError::Io {
        context: context.into(),
        source,
    }
}

fn collect_workbench_file_paths_recursive(
    root_path: &Path,
    base_path: &Path,
    collected: &mut Vec<WorkbenchCollectedFilePath>,
) -> Result<()> {
    let directory = fs::read_dir(root_path)
        .map_err(|error| io_error(format!("failed to read {}", root_path.display()), error))?;

    for entry in directory {
        let entry =
            entry.map_err(|error| io_error("failed to iterate directory entries", error))?;
        let entry_path = entry.path();
        let file_type = entry.file_type().map_err(|error| {
            io_error(
                format!("failed to read metadata for {}", entry_path.display()),
                error,
            )
        })?;

        if file_type.is_dir() {
            collect_workbench_file_paths_recursive(&entry_path, base_path, collected)?;
            continue;
        }

        if file_type.is_file() {
            let relative_path = relative_workbench_path(&entry_path, base_path);
            collected.push(WorkbenchCollectedFilePath {
                path: path_to_string(&relative_path).replace('\\', "/"),
            });
        }
    }

    Ok(())
}

pub fn probe_workbench_path(path: &str) -> Result<WorkbenchPathProbeResult> {
    let normalized_path = normalize_absolute_path(path)?;
    let existing_path = normalized_path.canonicalize().ok();

    let directory_path = match existing_path.as_ref() {
        Some(existing) => {
            let metadata = fs::metadata(existing)
                .map_err(|error| io_error(format!("failed to read {}", existing.display()), error))?;
            if metadata.is_dir() {
                Some(existing.clone())
            } else {
                existing.parent().map(Path::to_path_buf)
            }
        }
        None => None,
    };

    let project_root = directory_path
        .as_ref()
        .map(|directory| find_git_root(directory).unwrap_or_else(|| directory.clone()));

    Ok(WorkbenchPathProbeResult {
        normalized_path: path_to_string(&normalized_path),
        existing_path: existing_path.as_ref().map(|value| path_to_string(value)),
        directory_path: directory_path.as_ref().map(|value| path_to_string(value)),
        project_root: project_root.as_ref().map(|value| path_to_string(value)),
    })
}

pub fn collect_workbench_file_paths(
    root_path: &str,
    base_path: Option<&str>,
) -> Result<Vec<WorkbenchCollectedFilePath>> {
    let normalized_root_path = normalize_absolute_path(root_path)?;
    let canonical_root_path = normalized_root_path.canonicalize().map_err(|error| {
        io_error(
            format!("failed to access {}", normalized_root_path.display()),
            error,
        )
    })?;
    let root_metadata = fs::metadata(&canonical_root_path).map_err(|error| {
        io_error(
            format!("failed to read {}", canonical_root_path.display()),
            error,
        )
    })?;

    if root_metadata.is_dir() == false {
        return Err(FilesCoreError::InvalidArgument(format!(
            "{} is not a directory",
            canonical_root_path.display()
        )));
    }

    let normalized_base_path = match base_path
        .map(str::trim)
        .filter(|value| value.is_empty() == false)
    {
        Some(value) => normalize_absolute_path(value)?,
        None => canonical_root_path.clone(),
    };
    let base_path = normalized_base_path
        .canonicalize()
        .unwrap_or(normalized_base_path);

    let mut collected = Vec::new();
    collect_workbench_file_paths_recursive(&canonical_root_path, &base_path, &mut collected)?;
    collected.sort_by(|left, right| left.path.cmp(&right.path));
    Ok(collected)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir() -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "lyra-files-core-workbench-paths-test-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&root).unwrap();
        root
    }

    #[test]
    fn collects_paths_relative_to_base_path() {
        let root = temp_dir();
        let src = root.join("src");
        fs::create_dir_all(&src).unwrap();
        fs::write(src.join("main.rs"), b"fn main() {}").unwrap();
        fs::write(root.join("README.md"), b"hello").unwrap();

        let collected = collect_workbench_file_paths(
            &path_to_string(&root),
            Some(&path_to_string(&root)),
        )
        .unwrap();
        let paths = collected
            .into_iter()
            .map(|entry| entry.path)
            .collect::<Vec<_>>();

        assert_eq!(paths, vec!["README.md", "src/main.rs"]);

        fs::remove_dir_all(root).unwrap();
    }
}
