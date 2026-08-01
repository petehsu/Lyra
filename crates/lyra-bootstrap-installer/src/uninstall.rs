use std::fs::{self, OpenOptions};
use std::path::{Component, Path, PathBuf};

use fs2::FileExt;
use lyra_bootstrap_core::{CoreProjectionConfig, CoreProjector, Target};
use serde::Serialize;

const REMOVE_USER_DATA_CONFIRMATION: &str = "DELETE-LYRA-DATA";

#[derive(Clone, Debug)]
pub struct UninstallConfig {
    pub component_root: PathBuf,
    pub state_root: PathBuf,
    pub program_root: PathBuf,
    pub user_data_root: PathBuf,
    pub target: Target,
    pub remove_user_data: bool,
    pub remove_user_data_confirmation: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UninstallReport {
    pub removed_paths: Vec<PathBuf>,
    pub user_data_path: PathBuf,
    pub user_data_removed: bool,
}

pub fn uninstall(config: UninstallConfig) -> Result<UninstallReport, String> {
    validate_config(&config)?;
    let mut removed_paths = Vec::new();
    let state_exists = inspect_optional_real_directory(&config.state_root, "state root")?;
    inspect_optional_real_directory(&config.component_root, "component root")?;
    let installation_evidence = installation_evidence(&config)?;

    let lock_path = config.state_root.join("bootstrap.lock");
    let lock = if state_exists {
        inspect_optional_regular_file(&lock_path, "bootstrap lock")?;
        let lock = OpenOptions::new()
            .create(true)
            .read(true)
            .write(true)
            .open(&lock_path)
            .map_err(|error| format!("Unable to open the bootstrap lock: {error}"))?;
        lock.lock_exclusive()
            .map_err(|error| format!("Unable to lock the Lyra installation: {error}"))?;
        Some(lock)
    } else {
        None
    };

    let projector = CoreProjector::new(CoreProjectionConfig::new(
        config.component_root.clone(),
        config.state_root.clone(),
        config.program_root.clone(),
        config.target.clone(),
    ))
    .map_err(|error| error.to_string())?;
    if installation_evidence {
        if let Err(error) = projector
            .verify_installation_for_removal()
            .and_then(|()| projector.wait_until_exit())
        {
            if let Some(lock) = lock.as_ref() {
                let _ = FileExt::unlock(lock);
            }
            return Err(error.to_string());
        }
    }

    let outcome = remove_owned_paths(&config, &mut removed_paths);

    let unlock = lock.as_ref().map_or(Ok(()), |lock| {
        FileExt::unlock(lock)
            .map_err(|error| format!("Unable to unlock the Lyra installation: {error}"))
    });
    let user_data_removed = outcome?;
    unlock?;
    removed_paths.sort();
    Ok(UninstallReport {
        removed_paths,
        user_data_path: config.user_data_root,
        user_data_removed,
    })
}

fn remove_owned_paths(
    config: &UninstallConfig,
    removed_paths: &mut Vec<PathBuf>,
) -> Result<bool, String> {
    remove_real_directory_if_exists(
        &config.program_root,
        "projected Core program",
        removed_paths,
    )?;
    remove_real_directory_if_exists(
        &config.component_root.join("components"),
        "component store",
        removed_paths,
    )?;
    for directory in [
        "cache-v1",
        "core-projection-v1",
        "offline-bundles-v1",
        "registry-v1",
        "trust-v1",
    ] {
        remove_real_directory_if_exists(
            &config.state_root.join(directory),
            directory,
            removed_paths,
        )?;
    }
    if config.remove_user_data {
        remove_real_directory_if_exists(&config.user_data_root, "user data", removed_paths)
    } else {
        Ok(false)
    }
}

fn validate_config(config: &UninstallConfig) -> Result<(), String> {
    for (label, path) in [
        ("component root", &config.component_root),
        ("state root", &config.state_root),
        ("program root", &config.program_root),
        ("user data root", &config.user_data_root),
    ] {
        if !path.is_absolute()
            || path.parent().is_none()
            || path
                .components()
                .any(|component| matches!(component, Component::CurDir | Component::ParentDir))
        {
            return Err(format!(
                "The Lyra {label} must be an absolute, normalized, non-root path."
            ));
        }
    }
    if paths_overlap(&config.program_root, &config.component_root)
        || paths_overlap(&config.program_root, &config.state_root)
    {
        return Err(
            "The projected Core program must be outside the component and bootstrap state roots."
                .to_string(),
        );
    }
    for (label, owned_path) in owned_directories(config) {
        if paths_overlap(&owned_path, &config.user_data_root) {
            return Err(format!(
                "Lyra {label} overlaps the user data root; refusing an unsafe uninstall."
            ));
        }
    }
    if config.remove_user_data
        && config.remove_user_data_confirmation.as_deref() != Some(REMOVE_USER_DATA_CONFIRMATION)
    {
        return Err(format!(
            "Removing user data requires --confirm-remove-user-data {REMOVE_USER_DATA_CONFIRMATION}."
        ));
    }
    if !config.remove_user_data && config.remove_user_data_confirmation.is_some() {
        return Err(
            "--confirm-remove-user-data is valid only with --remove-user-data.".to_string(),
        );
    }
    Ok(())
}

fn installation_evidence(config: &UninstallConfig) -> Result<bool, String> {
    let mut found = false;
    for (label, path) in owned_directories(config) {
        if inspect_optional_real_directory(&path, label)? {
            found = true;
        }
    }
    if config.remove_user_data {
        inspect_optional_real_directory(&config.user_data_root, "user data")?;
    }
    Ok(found)
}

fn owned_directories(config: &UninstallConfig) -> Vec<(&'static str, PathBuf)> {
    let mut directories = vec![
        ("projected Core program", config.program_root.clone()),
        ("component store", config.component_root.join("components")),
    ];
    directories.extend(
        [
            "cache-v1",
            "core-projection-v1",
            "offline-bundles-v1",
            "registry-v1",
            "trust-v1",
        ]
        .into_iter()
        .map(|name| (name, config.state_root.join(name))),
    );
    directories
}

fn paths_overlap(left: &Path, right: &Path) -> bool {
    same_or_descendant(left, right) || same_or_descendant(right, left)
}

#[cfg(not(windows))]
fn same_or_descendant(path: &Path, parent: &Path) -> bool {
    path.starts_with(parent)
}

#[cfg(windows)]
fn same_or_descendant(path: &Path, parent: &Path) -> bool {
    fn normalized(value: &Path) -> String {
        value
            .to_string_lossy()
            .replace('/', "\\")
            .trim_end_matches('\\')
            .to_ascii_lowercase()
    }
    let path = normalized(path);
    let parent = normalized(parent);
    path == parent
        || path
            .strip_prefix(&parent)
            .is_some_and(|suffix| suffix.starts_with('\\'))
}

fn inspect_optional_real_directory(path: &Path, label: &str) -> Result<bool, String> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if is_link_like(&metadata) || !metadata.is_dir() => Err(format!(
            "The Lyra {label} is not a real directory: {}",
            path.display()
        )),
        Ok(_) => Ok(true),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(format!("Unable to inspect the Lyra {label}: {error}")),
    }
}

fn inspect_optional_regular_file(path: &Path, label: &str) -> Result<bool, String> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if is_link_like(&metadata) || !metadata.is_file() => Err(format!(
            "The Lyra {label} is not a regular file: {}",
            path.display()
        )),
        Ok(_) => Ok(true),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(format!("Unable to inspect the Lyra {label}: {error}")),
    }
}

fn is_link_like(metadata: &fs::Metadata) -> bool {
    if metadata.file_type().is_symlink() {
        return true;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;

        const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
        if metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
            return true;
        }
    }
    false
}

fn remove_real_directory_if_exists(
    path: &Path,
    label: &str,
    removed_paths: &mut Vec<PathBuf>,
) -> Result<bool, String> {
    if !inspect_optional_real_directory(path, label)? {
        return Ok(false);
    }
    fs::remove_dir_all(path)
        .map_err(|error| format!("Unable to remove Lyra {label} {}: {error}", path.display()))?;
    removed_paths.push(path.to_path_buf());
    Ok(true)
}

#[cfg(test)]
mod tests {
    use tempfile::tempdir;

    use super::*;

    fn fixture(remove_user_data: bool) -> (tempfile::TempDir, UninstallConfig) {
        let root = tempdir().expect("temporary root");
        let component_root = root.path().join("scope");
        let state_root = component_root.clone();
        let program_root = root.path().join("program/Lyra");
        let user_data_root = component_root.join("data");
        for directory in [
            component_root.join("components/lyra.core/1.0.0/darwin-x64"),
            component_root.join("registry-v1"),
            component_root.join("trust-v1"),
            component_root.join("cache-v1"),
            component_root.join("core-projection-v1"),
            component_root.join("offline-bundles-v1"),
            user_data_root.clone(),
            program_root.clone(),
        ] {
            fs::create_dir_all(directory).expect("fixture directory");
        }
        fs::write(user_data_root.join("workspace.json"), b"keep").expect("fixture data");
        fs::write(program_root.join("Lyra"), b"binary").expect("fixture program");
        let config = UninstallConfig {
            component_root,
            state_root,
            program_root,
            user_data_root,
            target: Target::parse("darwin-x64").expect("target"),
            remove_user_data,
            remove_user_data_confirmation: remove_user_data
                .then(|| REMOVE_USER_DATA_CONFIRMATION.to_string()),
        };
        (root, config)
    }

    #[test]
    fn owned_path_removal_retains_user_data_by_default() {
        let (_root, config) = fixture(false);
        validate_config(&config).expect("safe config");
        let mut removed = Vec::new();
        assert!(!remove_owned_paths(&config, &mut removed).expect("remove owned paths"));
        assert!(!config.program_root.exists());
        assert!(!config.component_root.join("components").exists());
        assert!(!config.state_root.join("registry-v1").exists());
        assert!(config.user_data_root.join("workspace.json").is_file());
    }

    #[test]
    fn removes_user_data_only_with_the_explicit_confirmation_phrase() {
        let (_root, mut config) = fixture(true);
        config.remove_user_data_confirmation = Some("yes".to_string());
        assert!(validate_config(&config).is_err());
        assert!(config.user_data_root.exists());
        config.remove_user_data_confirmation = Some(REMOVE_USER_DATA_CONFIRMATION.to_string());
        validate_config(&config).expect("confirmed config");
        let mut removed = Vec::new();
        assert!(remove_owned_paths(&config, &mut removed).expect("remove owned paths"));
        assert!(!config.user_data_root.exists());
    }

    #[test]
    fn refuses_to_remove_directories_without_a_committed_installation() {
        let (_root, config) = fixture(false);
        let error = uninstall(config).expect_err("unowned directories must be rejected");
        assert!(error.contains("committed Lyra installation"));
    }

    #[test]
    #[cfg(unix)]
    fn rejects_symlinked_owned_directories_without_following_them() {
        use std::os::unix::fs::symlink;

        let (root, config) = fixture(false);
        let outside = root.path().join("outside");
        fs::create_dir_all(&outside).expect("outside");
        fs::write(outside.join("sentinel"), b"keep").expect("sentinel");
        fs::remove_dir_all(&config.program_root).expect("remove projected program");
        fs::remove_dir_all(config.component_root.join("components")).expect("replace store");
        symlink(&outside, config.component_root.join("components")).expect("store symlink");
        let error = uninstall(config).expect_err("symlink must be rejected");
        assert!(error.contains("not a real directory"));
        assert!(outside.join("sentinel").is_file());
    }

    #[test]
    fn rejects_program_or_state_paths_that_overlap_user_data() {
        let (_root, mut config) = fixture(false);
        config.program_root = config.user_data_root.join("program");
        assert!(validate_config(&config).is_err());

        let (_root, mut config) = fixture(false);
        config.user_data_root = config.state_root.join("registry-v1");
        assert!(validate_config(&config).is_err());
    }
}
