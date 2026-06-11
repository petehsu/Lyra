use std::process::Command;

use serde::Deserialize;

use crate::dto::FileManagerDevice;
use crate::error::{failure, NapiResult as Result};

#[cfg(target_os = "macos")]
#[derive(Clone, Debug, Deserialize)]
struct MacDiskutilListResponse {
    #[serde(rename = "AllDisksAndPartitions", default)]
    all_disks_and_partitions: Vec<MacDiskutilListEntry>,
}

#[cfg(target_os = "macos")]
#[derive(Clone, Debug, Deserialize)]
struct MacDiskutilListEntry {
    #[serde(rename = "DeviceIdentifier")]
    device_identifier: String,
    #[serde(rename = "Content")]
    content: Option<String>,
    #[serde(rename = "Size")]
    size: Option<u64>,
    #[serde(rename = "VolumeName")]
    volume_name: Option<String>,
    #[serde(rename = "MountPoint")]
    mount_point: Option<String>,
    #[serde(rename = "Partitions", default)]
    partitions: Vec<MacDiskutilListEntry>,
}

#[cfg(target_os = "macos")]
#[derive(Clone, Debug, Deserialize)]
struct MacDiskutilInfo {
    #[serde(rename = "DeviceNode")]
    device_node: Option<String>,
    #[serde(rename = "VolumeName")]
    volume_name: Option<String>,
    #[serde(rename = "MediaName")]
    media_name: Option<String>,
    #[serde(rename = "FilesystemType")]
    filesystem_type: Option<String>,
    #[serde(rename = "FilesystemName")]
    filesystem_name: Option<String>,
    #[serde(rename = "RemovableMedia")]
    removable_media: Option<bool>,
    #[serde(rename = "Internal")]
    internal: Option<bool>,
    #[serde(rename = "TotalSize")]
    total_size: Option<u64>,
    #[serde(rename = "MountPoint")]
    mount_point: Option<String>,
}

#[cfg(target_os = "macos")]
fn macos_shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\"'\"'"))
}

#[cfg(target_os = "macos")]
fn macos_run_json_shell(script: &str) -> Result<String> {
    let output = Command::new("sh")
        .args(["-c", script])
        .output()
        .map_err(|error| failure(format!("failed to run macOS shell command: {}", error)))?;

    if output.status.success() {
        return Ok(String::from_utf8_lossy(&output.stdout).trim().to_string());
    }

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    Err(failure(format!("macOS shell command failed: {}", stderr)))
}

#[cfg(target_os = "macos")]
fn macos_device_path(device_identifier: &str) -> String {
    if device_identifier.starts_with("/dev/") {
        device_identifier.to_string()
    } else {
        format!("/dev/{}", device_identifier)
    }
}

#[cfg(target_os = "macos")]
fn macos_read_diskutil_info(device_identifier: &str) -> Option<MacDiskutilInfo> {
    let script = format!(
        "diskutil info -plist {} | plutil -convert json -o - -",
        macos_shell_quote(&macos_device_path(device_identifier))
    );
    let output = macos_run_json_shell(&script).ok()?;
    serde_json::from_str(&output).ok()
}

#[cfg(target_os = "macos")]
fn macos_device_kind(info: &MacDiskutilInfo) -> String {
    if info.removable_media.unwrap_or(false) {
        return "removable".to_string();
    }

    if info.internal.unwrap_or(false) {
        return "local".to_string();
    }

    "external".to_string()
}

#[cfg(target_os = "macos")]
fn macos_is_auxiliary_partition(
    entry: &MacDiskutilListEntry,
    info: &MacDiskutilInfo,
    sibling_has_mounted_content: bool,
) -> bool {
    let content = entry
        .content
        .as_deref()
        .map(str::trim)
        .unwrap_or_default()
        .to_lowercase();
    if matches!(
        content.as_str(),
        "efi" | "apple_apfs_isc" | "apple_apfs_recovery" | "apple_apfs_preboot"
    ) {
        return true;
    }

    if sibling_has_mounted_content == false {
        return false;
    }

    let size = entry.size.or(info.total_size).unwrap_or(0);
    if size == 0 || size > 134_217_728 {
        return false;
    }

    let file_system = info
        .filesystem_type
        .as_deref()
        .or(info.filesystem_name.as_deref())
        .map(str::trim)
        .unwrap_or_default()
        .to_lowercase();
    matches!(
        file_system.as_str(),
        "ms-dos fat32" | "ms-dos" | "fat32" | "exfat"
    )
}

#[cfg(target_os = "macos")]
pub fn read_unmounted_devices() -> Vec<FileManagerDevice> {
    let output = match macos_run_json_shell("diskutil list -plist | plutil -convert json -o - -") {
        Ok(value) => value,
        Err(_) => return Vec::new(),
    };

    let parsed: MacDiskutilListResponse = match serde_json::from_str(&output) {
        Ok(value) => value,
        Err(_) => return Vec::new(),
    };

    let mut devices = Vec::new();
    for root in &parsed.all_disks_and_partitions {
        let Some(root_info) = macos_read_diskutil_info(&root.device_identifier) else {
            continue;
        };
        let root_kind = macos_device_kind(&root_info);
        let sibling_has_mounted_content = root.partitions.iter().any(|partition| {
            partition
                .mount_point
                .as_deref()
                .is_some_and(|value| !value.trim().is_empty())
        });

        if !root.partitions.is_empty() {
            for partition in &root.partitions {
                if partition
                    .mount_point
                    .as_deref()
                    .is_some_and(|value| !value.trim().is_empty())
                {
                    continue;
                }
                let Some(partition_info) = macos_read_diskutil_info(&partition.device_identifier)
                else {
                    continue;
                };
                if partition_info
                    .mount_point
                    .as_deref()
                    .is_some_and(|value| !value.trim().is_empty())
                {
                    continue;
                }
                if macos_is_auxiliary_partition(
                    partition,
                    &partition_info,
                    sibling_has_mounted_content,
                ) {
                    continue;
                }

                let device_path = partition_info
                    .device_node
                    .clone()
                    .unwrap_or_else(|| macos_device_path(&partition.device_identifier));
                let file_system = partition_info
                    .filesystem_type
                    .as_deref()
                    .or(partition_info.filesystem_name.as_deref())
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(ToString::to_string);
                devices.push(FileManagerDevice {
                    id: device_path.clone(),
                    title: partition_info
                        .volume_name
                        .clone()
                        .or(partition.volume_name.clone())
                        .or(partition_info.media_name.clone())
                        .unwrap_or_else(|| device_path.clone()),
                    device_path: device_path.clone(),
                    display_path: Some(device_path),
                    file_system: file_system.clone(),
                    kind: root_kind.clone(),
                    os_flavor: None,
                    total_bytes: partition
                        .size
                        .or(partition_info.total_size)
                        .map(|value| value as f64),
                    is_removable: root_info.removable_media.unwrap_or(false),
                    can_mount: file_system.is_some(),
                    can_eject: matches!(root_kind.as_str(), "removable" | "external"),
                });
            }
            continue;
        }

        if root_info
            .mount_point
            .as_deref()
            .is_some_and(|value| !value.trim().is_empty())
        {
            continue;
        }

        let device_path = root_info
            .device_node
            .clone()
            .unwrap_or_else(|| macos_device_path(&root.device_identifier));
        let file_system = root_info
            .filesystem_type
            .as_deref()
            .or(root_info.filesystem_name.as_deref())
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToString::to_string);
        devices.push(FileManagerDevice {
            id: device_path.clone(),
            title: root_info
                .volume_name
                .clone()
                .or(root.volume_name.clone())
                .or(root_info.media_name.clone())
                .unwrap_or_else(|| device_path.clone()),
            device_path: device_path.clone(),
            display_path: Some(device_path),
            file_system: file_system.clone(),
            kind: root_kind.clone(),
            os_flavor: None,
            total_bytes: root.size.or(root_info.total_size).map(|value| value as f64),
            is_removable: root_info.removable_media.unwrap_or(false),
            can_mount: file_system.is_some(),
            can_eject: matches!(root_kind.as_str(), "removable" | "external"),
        });
    }

    devices.sort_by(|left, right| {
        left.device_path
            .to_lowercase()
            .cmp(&right.device_path.to_lowercase())
    });
    devices
}
