use std::fs;
use std::path::{Path, PathBuf};

use crate::configuration::InstallScope;

/// Information needed to create or remove platform shortcuts.
#[derive(Clone, Debug)]
#[cfg_attr(target_os = "macos", allow(dead_code))]
pub struct ShortcutConfig {
    pub program_root: PathBuf,
    pub scope: InstallScope,
}

/// The platform-specific executable that shortcuts should point to.
#[cfg_attr(not(any(target_os = "windows", target_os = "linux")), allow(dead_code))]
fn executable_path(program_root: &Path) -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        program_root.join("Lyra.exe")
    }
    #[cfg(not(target_os = "windows"))]
    {
        program_root.join("Lyra")
    }
}

/// Create desktop and menu shortcuts for the installed Lyra application.
///
/// Returns the list of shortcut paths that were created. Errors are
/// collected rather than aborting — shortcuts are a convenience, not
/// a correctness requirement.
pub fn create_shortcuts(config: &ShortcutConfig) -> Vec<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        create_windows_shortcuts(config)
    }
    #[cfg(target_os = "linux")]
    {
        create_linux_shortcuts(config)
    }
    #[cfg(target_os = "macos")]
    {
        // macOS: the .app bundle in Applications is already the launcher.
        // Spotlight and Launchpad index it automatically — no shortcut needed.
        let _ = config;
        Vec::new()
    }
    #[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "macos")))]
    {
        let _ = config;
        Vec::new()
    }
}

/// Remove shortcuts created during installation.
pub fn remove_shortcuts(config: &ShortcutConfig) -> Vec<PathBuf> {
    let mut removed = Vec::new();
    for path in expected_shortcut_paths(config) {
        if path.exists() {
            if fs::remove_file(&path).is_ok() {
                removed.push(path);
            }
        }
    }
    removed
}

/// Fallback for platforms without shortcut support (macOS, etc.).
#[cfg(not(any(target_os = "windows", target_os = "linux")))]
fn expected_shortcut_paths(_config: &ShortcutConfig) -> Vec<PathBuf> {
    Vec::new()
}

// ── Windows ──────────────────────────────────────────────────────────

#[cfg(target_os = "windows")]
fn expected_shortcut_paths(config: &ShortcutConfig) -> Vec<PathBuf> {
    let (desktop, start_menu) = windows_shortcut_dirs(config.scope);
    vec![
        desktop.join("Lyra.lnk"),
        start_menu.join("Lyra.lnk"),
    ]
}

#[cfg(target_os = "windows")]
fn windows_shortcut_dirs(scope: InstallScope) -> (PathBuf, PathBuf) {
    use std::env;

    if scope == InstallScope::System {
        let public_desktop = env::var_os("PUBLIC")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from(r"C:\Users\Public"))
            .join("Desktop");
        let start_menu = env::var_os("ProgramData")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from(r"C:\ProgramData"))
            .join(r"Microsoft\Windows\Start Menu\Programs");
        (public_desktop, start_menu)
    } else {
        let profile = env::var_os("USERPROFILE")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("."));
        let desktop = profile.join("Desktop");
        let start_menu = env::var_os("APPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|| profile.join(r"AppData\Roaming"))
            .join(r"Microsoft\Windows\Start Menu\Programs");
        (desktop, start_menu)
    }
}

#[cfg(target_os = "windows")]
fn create_windows_shortcuts(config: &ShortcutConfig) -> Vec<PathBuf> {
    let (desktop_dir, start_menu_dir) = windows_shortcut_dirs(config.scope);
    let exe = executable_path(&config.program_root);
    let exe_str = exe.to_string_lossy().replace('\'', "''");
    let working_dir = config.program_root.to_string_lossy().replace('\'', "''");

    let mut created = Vec::new();
    for shortcut_dir in [&desktop_dir, &start_menu_dir] {
        let lnk_path = shortcut_dir.join("Lyra.lnk");
        let lnk_str = lnk_path.to_string_lossy().replace('\'', "''");

        // Ensure the target directory exists.
        if fs::create_dir_all(shortcut_dir).is_err() {
            continue;
        }

        let script = format!(
            "$ws = New-Object -ComObject WScript.Shell; \
             $lnk = $ws.CreateShortcut('{lnk}'); \
             $lnk.TargetPath = '{exe}'; \
             $lnk.WorkingDirectory = '{wd}'; \
             $lnk.Description = 'Lyra'; \
             $lnk.IconLocation = '{exe},0'; \
             $lnk.Save()",
            lnk = lnk_str,
            exe = exe_str,
            wd = working_dir,
        );

        let result = std::process::Command::new("powershell.exe")
            .args(["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", &script])
            .output();

        if let Ok(output) = result {
            if output.status.success() && lnk_path.exists() {
                created.push(lnk_path);
            }
        }
    }
    created
}

// ── Linux ────────────────────────────────────────────────────────────

#[cfg(target_os = "linux")]
fn expected_shortcut_paths(config: &ShortcutConfig) -> Vec<PathBuf> {
    let apps_dir = linux_applications_dir(config.scope);
    vec![apps_dir.join("lyra.desktop")]
}

#[cfg(target_os = "linux")]
fn linux_applications_dir(scope: InstallScope) -> PathBuf {
    if scope == InstallScope::System {
        PathBuf::from("/usr/share/applications")
    } else {
        let home = std::env::var_os("HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("."));
        home.join(".local/share/applications")
    }
}

#[cfg(target_os = "linux")]
fn create_linux_shortcuts(config: &ShortcutConfig) -> Vec<PathBuf> {
    let apps_dir = linux_applications_dir(config.scope);
    let desktop_path = apps_dir.join("lyra.desktop");
    let exe = executable_path(&config.program_root);

    if fs::create_dir_all(&apps_dir).is_err() {
        return Vec::new();
    }

    let content = format!(
        "[Desktop Entry]\n\
         Type=Application\n\
         Name=Lyra\n\
         Comment=Local-first AI agent desktop app\n\
         Exec={exe}\n\
         Icon=lyra\n\
         Terminal=false\n\
         Categories=Utility;Development;\n",
        exe = exe.display(),
    );

    if fs::write(&desktop_path, content).is_ok() {
        // Best-effort: mark as executable so desktop environments trust it.
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = fs::set_permissions(&desktop_path, fs::Permissions::from_mode(0o755));
        }
        vec![desktop_path]
    } else {
        Vec::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn executable_path_appends_platform_suffix() {
        let root = Path::new("/opt/lyra");
        let exe = executable_path(root);
        #[cfg(target_os = "windows")]
        assert!(exe.ends_with("Lyra.exe"));
        #[cfg(not(target_os = "windows"))]
        assert!(exe.ends_with("Lyra"));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn windows_shortcut_dirs_differ_by_scope() {
        let (desktop_user, menu_user) = windows_shortcut_dirs(InstallScope::CurrentUser);
        let (desktop_sys, menu_sys) = windows_shortcut_dirs(InstallScope::System);
        assert_ne!(desktop_user, desktop_sys);
        assert_ne!(menu_user, menu_sys);
        assert!(menu_user.to_string_lossy().contains("Start Menu"));
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn linux_applications_dir_differ_by_scope() {
        let user_dir = linux_applications_dir(InstallScope::CurrentUser);
        let sys_dir = linux_applications_dir(InstallScope::System);
        assert!(user_dir.ends_with(".local/share/applications"));
        assert_eq!(sys_dir, PathBuf::from("/usr/share/applications"));
    }
}