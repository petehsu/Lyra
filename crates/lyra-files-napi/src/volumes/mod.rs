use std::fs;
use std::path::{Path, PathBuf};

use sysinfo::{DiskKind, Disks};

use crate::dto::FileManagerDisk;
use lyra_files_core::paths::{path_to_string, os_to_string};

#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "windows")]
mod windows;

#[cfg(target_os = "linux")]
pub use linux::read_unmounted_devices;
#[cfg(target_os = "macos")]
pub use macos::read_unmounted_devices;
#[cfg(target_os = "windows")]
pub use windows::read_unmounted_devices;

#[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
pub fn read_unmounted_devices() -> Vec<crate::dto::FileManagerDevice> {
    Vec::new()
}


fn unquote_os_release_value(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.len() >= 2
        && ((trimmed.starts_with('"') && trimmed.ends_with('"'))
            || (trimmed.starts_with('\'') && trimmed.ends_with('\'')))
    {
        trimmed[1..trimmed.len() - 1].to_string()
    } else {
        trimmed.to_string()
    }
}

fn map_os_flavor(id: &str, id_like: &[String]) -> String {
    let values = std::iter::once(id.to_string())
        .chain(id_like.iter().cloned())
        .map(|value| value.to_lowercase())
        .collect::<Vec<_>>();

    if values.iter().any(|value| value == "alpine") {
        return "alpine".to_string();
    }

    if values.iter().any(|value| value == "bodhi") {
        return "bodhi".to_string();
    }

    if values.iter().any(|value| value == "openbsd") {
        return "openbsd".to_string();
    }

    if values.iter().any(|value| {
        matches!(
            value.as_str(),
            "arch" | "endeavouros" | "manjaro" | "garuda"
        )
    }) {
        return "arch".to_string();
    }

    if values
        .iter()
        .any(|value| matches!(value.as_str(), "linuxmint" | "mint"))
    {
        return "mint".to_string();
    }

    if values
        .iter()
        .any(|value| matches!(value.as_str(), "pop" | "pop_os" | "pop!_os"))
    {
        return "popos".to_string();
    }

    if values.iter().any(|value| value == "zorin") {
        return "zorin".to_string();
    }

    if values
        .iter()
        .any(|value| matches!(value.as_str(), "ubuntu" | "elementary" | "neon"))
    {
        return "ubuntu".to_string();
    }

    if values.iter().any(|value| value == "kali") {
        return "kali".to_string();
    }

    if values.iter().any(|value| value == "debian") {
        return "debian".to_string();
    }

    if values
        .iter()
        .any(|value| matches!(value.as_str(), "fedora" | "nobara"))
    {
        return "fedora".to_string();
    }

    if values.iter().any(|value| value == "centos") {
        return "centos".to_string();
    }

    if values.iter().any(|value| {
        matches!(
            value.as_str(),
            "rhel" | "redhat" | "red hat enterprise linux"
        )
    }) {
        return "redhat".to_string();
    }

    if values.iter().any(|value| value == "rocky") {
        return "rocky".to_string();
    }

    if values
        .iter()
        .any(|value| matches!(value.as_str(), "opensuse" | "suse"))
    {
        return "opensuse".to_string();
    }

    if values.iter().any(|value| value == "void") {
        return "void".to_string();
    }

    if values.iter().any(|value| value == "windows") {
        return "windows".to_string();
    }

    if values
        .iter()
        .any(|value| matches!(value.as_str(), "macos" | "darwin" | "osx"))
    {
        return "macos".to_string();
    }

    if values.iter().any(|value| {
        matches!(
            value.as_str(),
            "linux" | "debian" | "rhel" | "centos" | "rocky" | "almalinux" | "opensuse" | "suse"
        )
    }) {
        return "linux".to_string();
    }

    "unknown".to_string()
}

fn read_os_release_flavor(path: &Path) -> Option<String> {
    let content = fs::read_to_string(path).ok()?;
    let mut id = None;
    let mut id_like = Vec::new();

    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }

        let Some((key, raw_value)) = trimmed.split_once('=') else {
            continue;
        };
        let value = unquote_os_release_value(raw_value);
        match key {
            "ID" => id = Some(value),
            "ID_LIKE" => {
                id_like = value
                    .split_whitespace()
                    .map(str::trim)
                    .filter(|segment| !segment.is_empty())
                    .map(ToString::to_string)
                    .collect();
            }
            _ => {}
        }
    }

    Some(map_os_flavor(id.as_deref().unwrap_or_default(), &id_like))
}

fn current_host_os_flavor() -> String {
    #[cfg(target_os = "windows")]
    {
        return "windows".to_string();
    }

    #[cfg(target_os = "macos")]
    {
        return "macos".to_string();
    }

    #[cfg(target_os = "linux")]
    {
        return read_os_release_flavor(Path::new("/etc/os-release"))
            .or_else(|| read_os_release_flavor(Path::new("/usr/lib/os-release")))
            .unwrap_or_else(|| "linux".to_string());
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        "unknown".to_string()
    }
}

fn mount_has_windows_marker(mount_path: &Path) -> bool {
    mount_path.join("Windows").join("System32").exists()
}

fn mount_has_macos_marker(mount_path: &Path) -> bool {
    mount_path
        .join("System")
        .join("Library")
        .join("CoreServices")
        .join("SystemVersion.plist")
        .exists()
}

fn detect_volume_os_flavor(
    mount_path: &Path,
    mount_path_string: &str,
    system_mounts: &std::collections::HashSet<String>,
    host_flavor: &str,
) -> String {
    if system_mounts.contains(mount_path_string) {
        return host_flavor.to_string();
    }

    if mount_has_windows_marker(mount_path) {
        return "windows".to_string();
    }

    if mount_has_macos_marker(mount_path) {
        return "macos".to_string();
    }

    for candidate in [
        mount_path.join("etc").join("os-release"),
        mount_path.join("usr").join("lib").join("os-release"),
    ] {
        if let Some(flavor) = read_os_release_flavor(&candidate) {
            return flavor;
        }
    }

    "unknown".to_string()
}

fn system_reference_paths() -> Vec<PathBuf> {
    #[cfg(target_os = "linux")]
    let mut paths = vec![
        std::env::current_exe().ok(),
        dirs::home_dir(),
        dirs::data_dir(),
        dirs::config_dir(),
    ]
    .into_iter()
    .flatten()
    .collect::<Vec<_>>();

    #[cfg(not(target_os = "linux"))]
    let paths = vec![
        std::env::current_exe().ok(),
        dirs::home_dir(),
        dirs::data_dir(),
        dirs::config_dir(),
    ]
    .into_iter()
    .flatten()
    .collect::<Vec<_>>();

    #[cfg(target_os = "linux")]
    {
        for extra in ["/boot", "/boot/efi"] {
            let candidate = PathBuf::from(extra);
            if candidate.exists() {
                paths.push(candidate);
            }
        }
    }

    paths
}

fn is_external_mount_path(mount_path: &str) -> bool {
    #[cfg(target_os = "linux")]
    {
        return mount_path.starts_with("/run/media/") || mount_path.starts_with("/media/");
    }
    #[cfg(target_os = "macos")]
    {
        return mount_path.starts_with("/Volumes/");
    }
    #[cfg(target_os = "windows")]
    {
        false
    }
    #[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
    {
        false
    }
}

fn can_eject_disk(kind: &str, mount_path: &str, device_path: Option<&str>) -> bool {
    if !matches!(kind, "removable" | "external") {
        return false;
    }

    #[cfg(target_os = "macos")]
    {
        return device_path.is_some() && !mount_path.is_empty();
    }

    #[cfg(target_os = "windows")]
    {
        let bytes = mount_path.as_bytes();
        return bytes.len() >= 2 && bytes[1] == b':' && bytes[0].is_ascii_alphabetic();
    }

    #[cfg(target_os = "linux")]
    {
        return !mount_path.is_empty()
            && (device_path.is_some()
                || mount_path.starts_with("/run/media/")
                || mount_path.starts_with("/media/"));
    }

    #[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
    {
        false
    }
}


pub fn read_disks() -> Vec<FileManagerDisk> {
    let disks = Disks::new_with_refreshed_list();
    let reference_paths = system_reference_paths();
    let host_flavor = current_host_os_flavor();

    let system_mounts = disks
        .list()
        .iter()
        .filter_map(|disk| {
            let mount = disk.mount_point();
            let matches_system = reference_paths
                .iter()
                .any(|reference_path| reference_path.starts_with(mount));
            if matches_system {
                Some(path_to_string(mount))
            } else {
                None
            }
        })
        .collect::<std::collections::HashSet<_>>();

    let mut items = disks
        .list()
        .iter()
        .filter_map(|disk| {
            let total_bytes = disk.total_space() as f64;
            if total_bytes <= 0.0 {
                return None;
            }

            let available_bytes = disk.available_space() as f64;
            let used_bytes = (total_bytes - available_bytes).max(0.0);
            let mount_path = path_to_string(disk.mount_point());
            let device_path = {
                let value = os_to_string(disk.name());
                if value.trim().is_empty() {
                    None
                } else {
                    Some(value)
                }
            };
            let title = {
                let name = device_path.clone().unwrap_or_default();
                if name.is_empty() || name == mount_path {
                    mount_path.clone()
                } else {
                    name
                }
            };

            let kind = if disk.is_removable() {
                "removable".to_string()
            } else if system_mounts.contains(&mount_path) {
                "system".to_string()
            } else if is_external_mount_path(&mount_path) {
                "external".to_string()
            } else {
                match disk.kind() {
                    DiskKind::SSD | DiskKind::HDD | DiskKind::Unknown(_) => "local".to_string(),
                }
            };
            let os_flavor = detect_volume_os_flavor(
                disk.mount_point(),
                &mount_path,
                &system_mounts,
                &host_flavor,
            );
            let can_eject = can_eject_disk(kind.as_str(), &mount_path, device_path.as_deref());

            Some(FileManagerDisk {
                id: mount_path.clone(),
                title,
                mount_path,
                device_path,
                file_system: disk.file_system().to_string_lossy().into_owned(),
                kind,
                os_flavor: Some(os_flavor),
                total_bytes,
                available_bytes,
                used_bytes,
                usage_ratio: if total_bytes > 0.0 {
                    used_bytes / total_bytes
                } else {
                    0.0
                },
                is_removable: disk.is_removable(),
                can_eject,
            })
        })
        .collect::<Vec<_>>();

    items.sort_by(|left, right| {
        left.mount_path
            .to_lowercase()
            .cmp(&right.mount_path.to_lowercase())
    });
    items
}

