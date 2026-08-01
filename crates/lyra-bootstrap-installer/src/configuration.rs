use std::env;
use std::path::{Path, PathBuf};

use clap::ValueEnum;

#[derive(Clone, Copy, Debug, Eq, PartialEq, ValueEnum)]
pub enum InstallScope {
    CurrentUser,
    System,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, ValueEnum)]
pub enum InstallerLanguage {
    Auto,
    En,
    ZhCn,
}

impl InstallerLanguage {
    pub fn resolved(self) -> Self {
        match self {
            Self::Auto if detected_locale_is_chinese() => Self::ZhCn,
            Self::Auto => Self::En,
            value => value,
        }
    }

    pub fn is_chinese(self) -> bool {
        self.resolved() == Self::ZhCn
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct InstallPaths {
    /// Root containing `components/` and bootstrap state for this scope.
    pub component_root: PathBuf,
    /// Program projection updated by the bootstrap helper after Core exits.
    pub program_root: PathBuf,
    /// Per-user module data. This never changes for a system installation.
    pub user_data_root: PathBuf,
}

pub fn resolve_install_paths(
    scope: InstallScope,
    install_root_override: Option<&Path>,
    state_root_override: Option<&Path>,
) -> Result<(PathBuf, PathBuf, InstallPaths), String> {
    let home = user_home().ok_or_else(|| {
        "Unable to determine the current user's home directory; pass --install-root and --state-root"
            .to_string()
    })?;
    let defaults = match scope {
        InstallScope::CurrentUser => current_user_paths(&home)?,
        InstallScope::System => system_paths(&home)?,
    };
    let install_root = install_root_override
        .map(Path::to_path_buf)
        .unwrap_or_else(|| defaults.component_root.clone());
    let state_root = state_root_override
        .map(Path::to_path_buf)
        .unwrap_or_else(|| defaults.component_root.join("system"));
    Ok((install_root, state_root, defaults))
}

fn detected_locale_is_chinese() -> bool {
    ["LC_ALL", "LC_MESSAGES", "LANG", "LANGUAGE"]
        .into_iter()
        .filter_map(env::var_os)
        .filter_map(|value| value.into_string().ok())
        .any(|value| {
            let normalized = value.to_ascii_lowercase().replace('_', "-");
            normalized == "zh" || normalized.starts_with("zh-")
        })
}

fn user_home() -> Option<PathBuf> {
    #[cfg(windows)]
    let candidate = env::var_os("USERPROFILE").or_else(|| env::var_os("HOME"));
    #[cfg(not(windows))]
    let candidate = env::var_os("HOME");
    candidate
        .map(PathBuf::from)
        .filter(|path| path.is_absolute())
}

fn current_user_paths(home: &Path) -> Result<InstallPaths, String> {
    let component_root = home.join(".lyra");
    let user_data_root = component_root.join("data");
    #[cfg(target_os = "macos")]
    let program_root = home.join("Applications").join("Lyra.app");
    #[cfg(target_os = "windows")]
    let program_root = env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|| home.join("AppData").join("Local"))
        .join("Programs")
        .join("Lyra");
    #[cfg(target_os = "linux")]
    let program_root = home.join(".local").join("opt").join("lyra");
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    return Err("Lyra installer supports macOS, Windows, and Linux only".to_string());

    Ok(InstallPaths {
        component_root,
        program_root,
        user_data_root,
    })
}

fn system_paths(home: &Path) -> Result<InstallPaths, String> {
    let user_data_root = home.join(".lyra").join("data");
    #[cfg(target_os = "macos")]
    let (component_root, program_root) = (
        PathBuf::from("/Library/Application Support/Lyra"),
        PathBuf::from("/Applications/Lyra.app"),
    );
    #[cfg(target_os = "windows")]
    let (component_root, program_root) = {
        let program_data = env::var_os("ProgramData")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from(r"C:\ProgramData"));
        let program_files = env::var_os("ProgramFiles")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from(r"C:\Program Files"));
        (program_data.join("Lyra"), program_files.join("Lyra"))
    };
    #[cfg(target_os = "linux")]
    let (component_root, program_root) =
        (PathBuf::from("/var/lib/lyra"), PathBuf::from("/opt/lyra"));
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    return Err("Lyra installer supports macOS, Windows, and Linux only".to_string());

    Ok(InstallPaths {
        component_root,
        program_root,
        user_data_root,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn current_user_components_and_data_share_the_normalized_lyra_root() {
        let home = Path::new("/Users/tester");
        let paths = current_user_paths(home).expect("supported build target");
        assert_eq!(paths.component_root, home.join(".lyra"));
        assert_eq!(paths.user_data_root, home.join(".lyra/data"));
    }

    #[test]
    fn default_state_is_separate_from_immutable_components() {
        let (install, state, paths) =
            resolve_install_paths(InstallScope::CurrentUser, None, None).expect("paths resolve");
        assert_eq!(install, paths.component_root);
        assert_eq!(state, paths.component_root.join("system"));
        assert_ne!(state, install);
    }

    #[test]
    fn system_install_keeps_data_in_the_user_home() {
        let home = Path::new("/Users/tester");
        let paths = system_paths(home).expect("supported build target");
        assert_eq!(paths.user_data_root, home.join(".lyra/data"));
        assert_ne!(paths.component_root, paths.user_data_root);
    }

    #[test]
    fn explicit_roots_do_not_change_the_program_or_data_locations() {
        let (install, state, paths) = resolve_install_paths(
            InstallScope::CurrentUser,
            Some(Path::new("/tmp/lyra-components")),
            Some(Path::new("/tmp/lyra-state")),
        )
        .expect("paths resolve");
        assert_eq!(install, Path::new("/tmp/lyra-components"));
        assert_eq!(state, Path::new("/tmp/lyra-state"));
        assert!(paths.user_data_root.ends_with(".lyra/data"));
    }
}
