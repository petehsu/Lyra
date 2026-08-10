#[cfg(target_os = "windows")]
use std::fs;
use std::path::PathBuf;

use crate::configuration::InstallScope;

#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
const APP_KEY: &str = "Lyra";
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
const VERSION: &str = env!("CARGO_PKG_VERSION");

/// Configuration for writing or removing Windows ARP (Add/Remove Programs)
/// registry entries. On non-Windows platforms these are no-ops.
#[derive(Clone, Debug)]
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
pub struct ArpConfig {
    pub program_root: PathBuf,
    pub scope: InstallScope,
}

/// Write the Windows ARP uninstall registry entry and persist the
/// uninstaller binary.  Best-effort: errors are returned but the caller
/// may ignore them without affecting installation correctness.
#[cfg(target_os = "windows")]
pub fn write_arp_entries(config: &ArpConfig) -> Result<(), String> {
    let uninstaller_path = config.program_root.join("lyra-uninstaller.exe");

    // 1. Persist the installer binary so ARP uninstall still works
    //    after the original installer is deleted.
    let current_exe = std::env::current_exe()
        .map_err(|e| format!("Unable to locate the installer binary: {e}"))?;
    fs::copy(&current_exe, &uninstaller_path)
        .map_err(|e| format!("Unable to persist the uninstaller binary: {e}"))?;

    // 2. Build the UninstallString with all needed flags.
    let scope_flag = match config.scope {
        InstallScope::CurrentUser => "current-user",
        InstallScope::System => "system",
    };
    let uninstall_string = format!(
        "\"{}\" --uninstall --scope {} --program-root \"{}\"",
        ps_escape(&uninstaller_path.display().to_string()),
        scope_flag,
        ps_escape(&config.program_root.display().to_string()),
    );

    let exe_path = config.program_root.join("Lyra.exe");
    let install_loc = ps_escape(&config.program_root.display().to_string());
    let display_icon = format!("{},0", ps_escape(&exe_path.display().to_string()));

    // 3. Write registry entries via PowerShell.
    let hive = registry_hive(config.scope);
    let key_path = format!(
        r"{}\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\{}",
        hive, APP_KEY
    );

    let script = format!(
        "$ErrorActionPreference = 'Stop'; \
         $key = '{key}'; \
         New-Item -Path $key -Force | Out-Null; \
         Set-ItemProperty -Path $key -Name 'DisplayName' -Value 'Lyra'; \
         Set-ItemProperty -Path $key -Name 'DisplayVersion' -Value '{ver}'; \
         Set-ItemProperty -Path $key -Name 'Publisher' -Value 'Lyra'; \
         Set-ItemProperty -Path $key -Name 'InstallLocation' -Value '{loc}'; \
         Set-ItemProperty -Path $key -Name 'UninstallString' -Value '{uninst}'; \
         Set-ItemProperty -Path $key -Name 'DisplayIcon' -Value '{icon}'; \
         Set-ItemProperty -Path $key -Name 'NoModify' -Value 1 -Type DWord; \
         Set-ItemProperty -Path $key -Name 'NoRepair' -Value 1 -Type DWord",
        key = key_path,
        ver = VERSION,
        loc = install_loc,
        uninst = uninstall_string,
        icon = display_icon,
    );

    let output = std::process::Command::new("powershell.exe")
        .args(["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", &script])
        .output()
        .map_err(|e| format!("Unable to launch PowerShell for ARP registration: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("PowerShell ARP registration failed: {}", stderr.trim()));
    }

    Ok(())
}

/// Remove the Windows ARP uninstall registry entry.
#[cfg(target_os = "windows")]
pub fn remove_arp_entries(config: &ArpConfig) -> Result<(), String> {
    let hive = registry_hive(config.scope);
    let key_path = format!(
        r"{}\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\{}",
        hive, APP_KEY
    );

    let script = format!(
        "$ErrorActionPreference = 'Stop'; \
         Remove-Item -Path '{}' -Recurse -Force -ErrorAction SilentlyContinue",
        key_path
    );

    let output = std::process::Command::new("powershell.exe")
        .args(["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", &script])
        .output()
        .map_err(|e| format!("Unable to launch PowerShell for ARP removal: {e}"))?;

    // Removal is best-effort — don't fail if the key doesn't exist.
    Ok(())
}

/// Also remove the persisted uninstaller binary.
#[cfg(target_os = "windows")]
pub fn remove_uninstaller_binary(config: &ArpConfig) {
    let uninstaller = config.program_root.join("lyra-uninstaller.exe");
    let _ = fs::remove_file(&uninstaller);
}

// ── Non-Windows no-ops ────────────────────────────────────────────────

#[cfg(not(target_os = "windows"))]
pub fn write_arp_entries(_config: &ArpConfig) -> Result<(), String> {
    Ok(())
}

#[cfg(not(target_os = "windows"))]
pub fn remove_arp_entries(_config: &ArpConfig) -> Result<(), String> {
    Ok(())
}

#[cfg(not(target_os = "windows"))]
pub fn remove_uninstaller_binary(_config: &ArpConfig) {}

// ── Helpers ───────────────────────────────────────────────────────────

/// Escape single quotes for PowerShell single-quoted strings.
#[cfg(target_os = "windows")]
fn ps_escape(value: &str) -> String {
    value.replace('\'', "''")
}

/// Return the PowerShell registry hive prefix for the given scope.
#[cfg(target_os = "windows")]
fn registry_hive(scope: InstallScope) -> &'static str {
    match scope {
        InstallScope::CurrentUser => "HKCU:",
        InstallScope::System => "HKLM:",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(target_os = "windows")]
    #[test]
    fn registry_hive_matches_scope() {
        assert_eq!(registry_hive(InstallScope::CurrentUser), "HKCU:");
        assert_eq!(registry_hive(InstallScope::System), "HKLM:");
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn ps_escape_doubles_single_quotes() {
        assert_eq!(ps_escape("it's"), "it''s");
        assert_eq!(ps_escape(r"C:\Users\O'Brien"), r"C:\Users\O''Brien");
    }

    #[test]
    fn version_is_nonempty() {
        assert!(!VERSION.is_empty());
    }
}