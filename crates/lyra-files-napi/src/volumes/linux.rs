use std::process::Command;

use serde::Deserialize;

use crate::dto::FileManagerDevice;
use crate::error::{failure, NapiResult as Result};

#[cfg(target_os = "linux")]
#[derive(Clone, Debug, Deserialize)]
struct LinuxUnmountedDevicesResponse {
    blockdevices: Vec<LinuxUnmountedDevice>,
}

#[cfg(target_os = "linux")]
#[derive(Clone, Debug, Deserialize)]
struct LinuxUnmountedDevice {
    path: Option<String>,
    pkname: Option<String>,
    #[serde(rename = "type")]
    device_type: Option<String>,
    rm: Option<bool>,
    hotplug: Option<bool>,
    tran: Option<String>,
    mountpoints: Option<Vec<Option<String>>>,
    size: Option<u64>,
    model: Option<String>,
    vendor: Option<String>,
    fstype: Option<String>,
    label: Option<String>,
}

#[cfg(target_os = "linux")]
fn linux_run_command(program: &str, args: &[&str]) -> Result<String> {
    let output = Command::new(program)
        .args(args)
        .output()
        .map_err(|error| failure(format!("failed to run {}: {}", program, error)))?;

    if output.status.success() {
        return Ok(String::from_utf8_lossy(&output.stdout).trim().to_string());
    }

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let message = if !stderr.is_empty() {
        stderr
    } else if !stdout.is_empty() {
        stdout
    } else {
        format!("{} exited with status {}", program, output.status)
    };

    Err(failure(format!("{} failed: {}", program, message)))
}

#[cfg(target_os = "linux")]
fn linux_valid_mountpoints(mountpoints: &Option<Vec<Option<String>>>) -> Vec<String> {
    mountpoints
        .clone()
        .unwrap_or_default()
        .into_iter()
        .flatten()
        .filter(|value| !value.is_empty() && !value.starts_with('['))
        .collect()
}

#[cfg(target_os = "linux")]
fn linux_unmounted_device_kind(removable: bool, hotplug: bool, transport: Option<&str>) -> String {
    if removable {
        return "removable".to_string();
    }

    let normalized_transport = transport.map(str::trim).unwrap_or_default().to_lowercase();
    if hotplug
        || matches!(
            normalized_transport.as_str(),
            "usb" | "firewire" | "thunderbolt"
        )
    {
        return "external".to_string();
    }

    "local".to_string()
}

#[cfg(target_os = "linux")]
fn linux_unmounted_root_title(device: &LinuxUnmountedDevice, fallback: &str) -> String {
    let vendor = device.vendor.as_deref().map(str::trim).unwrap_or_default();
    let model = device.model.as_deref().map(str::trim).unwrap_or_default();
    match (vendor.is_empty(), model.is_empty()) {
        (false, false) => format!("{} {}", vendor, model),
        (false, true) => vendor.to_string(),
        (true, false) => model.to_string(),
        (true, true) => fallback.to_string(),
    }
}

#[cfg(target_os = "linux")]
fn linux_is_mountable_filesystem(file_system: Option<&str>) -> bool {
    let normalized = file_system.unwrap_or_default().trim().to_lowercase();
    !normalized.is_empty() && normalized != "swap"
}

#[cfg(target_os = "linux")]
fn linux_parent_path(device: &LinuxUnmountedDevice) -> Option<String> {
    let pkname = device.pkname.as_deref()?.trim();
    if pkname.is_empty() {
        return None;
    }

    Some(format!("/dev/{}", pkname))
}

#[cfg(target_os = "linux")]
fn linux_is_supported_unmounted_path(path: &str) -> bool {
    !path.starts_with("/dev/loop")
        && !path.starts_with("/dev/zram")
        && !path.starts_with("/dev/ram")
}

#[cfg(target_os = "linux")]
fn linux_has_children(devices: &[LinuxUnmountedDevice], path: &str) -> bool {
    devices
        .iter()
        .any(|candidate| linux_parent_path(candidate).as_deref() == Some(path))
}

#[cfg(target_os = "linux")]
fn linux_root_device<'a>(
    devices: &'a [LinuxUnmountedDevice],
    device: &'a LinuxUnmountedDevice,
) -> &'a LinuxUnmountedDevice {
    let mut current = device;

    for _ in 0..8 {
        let Some(parent_path) = linux_parent_path(current) else {
            break;
        };
        let Some(parent) = devices
            .iter()
            .find(|candidate| candidate.path.as_deref() == Some(parent_path.as_str()))
        else {
            break;
        };
        current = parent;
    }

    current
}

#[cfg(target_os = "linux")]
fn linux_unmounted_device_title(
    device: &LinuxUnmountedDevice,
    root: &LinuxUnmountedDevice,
) -> String {
    let label = device.label.as_deref().map(str::trim).unwrap_or_default();
    if !label.is_empty() {
        return label.to_string();
    }

    let device_path = device.path.as_deref().unwrap_or_default();
    if device.device_type.as_deref() == Some("disk") {
        return linux_unmounted_root_title(device, device_path);
    }

    let root_title = root
        .path
        .as_deref()
        .map(|path| linux_unmounted_root_title(root, path))
        .unwrap_or_default();
    if root_title.is_empty() {
        device_path.to_string()
    } else {
        root_title
    }
}

#[cfg(target_os = "linux")]
fn linux_is_auxiliary_unmounted_volume(
    device: &LinuxUnmountedDevice,
    sibling_has_mounted_content: bool,
) -> bool {
    if sibling_has_mounted_content == false {
        return false;
    }

    let size = device.size.unwrap_or(0);
    if size == 0 || size > 134_217_728 {
        return false;
    }

    let file_system = device
        .fstype
        .as_deref()
        .map(str::trim)
        .unwrap_or_default()
        .to_lowercase();
    matches!(
        file_system.as_str(),
        "vfat" | "fat" | "fat16" | "fat32" | "efi"
    )
}

#[cfg(target_os = "linux")]
fn push_linux_unmounted_device(
    devices: &mut Vec<FileManagerDevice>,
    title: String,
    device_path: String,
    file_system: Option<String>,
    kind: String,
    is_removable: bool,
    total_bytes: Option<u64>,
) {
    devices.push(FileManagerDevice {
        id: device_path.clone(),
        title,
        device_path: device_path.clone(),
        display_path: Some(device_path),
        file_system: file_system.clone(),
        kind: kind.clone(),
        os_flavor: None,
        total_bytes: total_bytes
            .filter(|value| *value > 0)
            .map(|value| value as f64),
        is_removable,
        can_mount: linux_is_mountable_filesystem(file_system.as_deref()),
        can_eject: matches!(kind.as_str(), "removable" | "external"),
    });
}

#[cfg(target_os = "linux")]
fn linux_collect_unmounted_devices(
    parsed: &LinuxUnmountedDevicesResponse,
) -> Vec<FileManagerDevice> {
    let mut devices = Vec::new();
    for device in &parsed.blockdevices {
        let Some(device_path) = device.path.clone() else {
            continue;
        };
        if linux_is_supported_unmounted_path(&device_path) == false {
            continue;
        }
        if !linux_valid_mountpoints(&device.mountpoints).is_empty() {
            continue;
        }
        if linux_has_children(&parsed.blockdevices, &device_path) {
            continue;
        }

        let file_system = device
            .fstype
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToString::to_string);
        if linux_is_mountable_filesystem(file_system.as_deref()) == false {
            continue;
        }

        let root = linux_root_device(&parsed.blockdevices, device);
        let root_path = root.path.as_deref().unwrap_or(device_path.as_str());
        let sibling_has_mounted_content = parsed.blockdevices.iter().any(|candidate| {
            linux_parent_path(candidate).as_deref() == Some(root_path)
                && !linux_valid_mountpoints(&candidate.mountpoints).is_empty()
        });
        if linux_is_auxiliary_unmounted_volume(device, sibling_has_mounted_content) {
            continue;
        }

        let root_kind = linux_unmounted_device_kind(
            root.rm.unwrap_or(false),
            root.hotplug.unwrap_or(false),
            root.tran.as_deref(),
        );
        push_linux_unmounted_device(
            &mut devices,
            linux_unmounted_device_title(device, root),
            device_path,
            file_system,
            root_kind,
            root.rm.unwrap_or(false),
            device.size,
        );
    }

    devices.sort_by(|left, right| {
        left.device_path
            .to_lowercase()
            .cmp(&right.device_path.to_lowercase())
    });
    devices
}

#[cfg(target_os = "linux")]
pub fn read_unmounted_devices() -> Vec<FileManagerDevice> {
    let output = match linux_run_command(
        "lsblk",
        &[
            "-J",
            "-b",
            "-o",
            "PATH,PKNAME,TYPE,RM,HOTPLUG,TRAN,MOUNTPOINTS,SIZE,MODEL,VENDOR,FSTYPE,LABEL",
        ],
    ) {
        Ok(value) => value,
        Err(_) => return Vec::new(),
    };

    let parsed: LinuxUnmountedDevicesResponse = match serde_json::from_str(&output) {
        Ok(value) => value,
        Err(_) => return Vec::new(),
    };

    linux_collect_unmounted_devices(&parsed)
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use super::{
        linux_collect_unmounted_devices, FileManagerDevice, LinuxUnmountedDevice,
        LinuxUnmountedDevicesResponse,
    };

    fn linux_device(
        path: &str,
        pkname: Option<&str>,
        device_type: &str,
        mountpoints: &[&str],
        size: u64,
        file_system: Option<&str>,
        label: Option<&str>,
    ) -> LinuxUnmountedDevice {
        LinuxUnmountedDevice {
            path: Some(path.to_string()),
            pkname: pkname.map(ToString::to_string),
            device_type: Some(device_type.to_string()),
            rm: Some(path.starts_with("/dev/sd")),
            hotplug: Some(path.starts_with("/dev/sd")),
            tran: if path.starts_with("/dev/sd") {
                Some("usb".to_string())
            } else {
                Some("nvme".to_string())
            },
            mountpoints: Some(
                mountpoints
                    .iter()
                    .map(|value| Some((*value).to_string()))
                    .collect(),
            ),
            size: Some(size),
            model: Some("Test Device".to_string()),
            vendor: Some("Test Vendor".to_string()),
            fstype: file_system.map(ToString::to_string),
            label: label.map(ToString::to_string),
        }
    }

    fn device_paths(items: &[FileManagerDevice]) -> Vec<String> {
        items.iter().map(|item| item.device_path.clone()).collect()
    }

    #[test]
    fn linux_unmounted_devices_exclude_parent_disks_with_mounted_children() {
        let parsed = LinuxUnmountedDevicesResponse {
            blockdevices: vec![
                linux_device(
                    "/dev/nvme0n1",
                    None,
                    "disk",
                    &[],
                    512_000_000_000,
                    None,
                    None,
                ),
                linux_device(
                    "/dev/nvme0n1p1",
                    Some("nvme0n1"),
                    "part",
                    &["/boot"],
                    1_073_741_824,
                    Some("vfat"),
                    None,
                ),
                linux_device(
                    "/dev/nvme0n1p2",
                    Some("nvme0n1"),
                    "part",
                    &["/"],
                    50_000_000_000,
                    Some("ext4"),
                    None,
                ),
                linux_device("/dev/sda", None, "disk", &[], 123_000_000_000, None, None),
                linux_device(
                    "/dev/sda1",
                    Some("sda"),
                    "part",
                    &["/run/media/lyra/Ventoy"],
                    123_000_000_000,
                    Some("exfat"),
                    Some("Ventoy"),
                ),
                linux_device(
                    "/dev/sda2",
                    Some("sda"),
                    "part",
                    &[],
                    33_554_432,
                    Some("vfat"),
                    Some("VTOYEFI"),
                ),
            ],
        };

        let devices = linux_collect_unmounted_devices(&parsed);
        let paths = device_paths(&devices);

        assert_eq!(paths, Vec::<String>::new());
    }

    #[test]
    fn linux_unmounted_devices_include_mountable_leaf_volumes() {
        let parsed = LinuxUnmountedDevicesResponse {
            blockdevices: vec![linux_device(
                "/dev/sdb",
                None,
                "disk",
                &[],
                64_000_000_000,
                Some("exfat"),
                Some("SanDisk"),
            )],
        };

        let devices = linux_collect_unmounted_devices(&parsed);

        assert_eq!(devices.len(), 1);
        assert_eq!(devices[0].device_path, "/dev/sdb");
        assert_eq!(devices[0].title, "SanDisk");
        assert!(devices[0].can_mount);
    }
}
