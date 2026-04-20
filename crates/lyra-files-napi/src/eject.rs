use std::process::Command;

use napi::Result;
#[cfg(target_os = "linux")]
use serde::Deserialize;

use crate::failure;

pub struct SafeEjectOutcome {
    pub strategy: &'static str,
    pub powered_off: bool,
}

pub fn safely_eject_device(
    mount_path: &str,
    device_path: Option<&str>,
    disk_kind: &str,
) -> Result<SafeEjectOutcome> {
    if !matches!(disk_kind, "removable" | "external") {
        return Err(failure(format!(
            "disk kind {} is not eligible for safe eject",
            disk_kind
        )));
    }

    #[cfg(target_os = "linux")]
    {
        return safely_eject_linux(mount_path, device_path);
    }

    #[cfg(target_os = "macos")]
    {
        return safely_eject_macos(mount_path, device_path);
    }

    #[cfg(target_os = "windows")]
    {
        return safely_eject_windows(mount_path, disk_kind);
    }

    #[allow(unreachable_code)]
    Err(failure(format!(
        "device eject is not supported on {}",
        std::env::consts::OS
    )))
}

fn run_command(program: &str, args: &[&str]) -> Result<String> {
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

fn sync_filesystem() -> Result<()> {
    #[cfg(any(target_os = "linux", target_os = "macos"))]
    {
        run_command("sync", &[])?;
    }

    Ok(())
}

#[cfg(target_os = "linux")]
#[derive(Debug, Deserialize)]
struct LsblkResponse {
    blockdevices: Vec<LsblkBlockDevice>,
}

#[cfg(target_os = "linux")]
#[derive(Debug, Deserialize)]
struct LsblkBlockDevice {
    path: Option<String>,
    #[serde(rename = "type")]
    device_type: Option<String>,
    mountpoints: Option<Vec<Option<String>>>,
    #[serde(default)]
    children: Vec<LsblkBlockDevice>,
}

#[cfg(target_os = "linux")]
#[derive(Clone, Debug)]
struct LinuxDeviceRecord {
    path: String,
    root_path: String,
    device_type: String,
    mountpoints: Vec<String>,
}

#[cfg(target_os = "linux")]
fn collect_linux_device_records(
    devices: &[LsblkBlockDevice],
    root_path: Option<&str>,
    records: &mut Vec<LinuxDeviceRecord>,
) {
    for device in devices {
        let Some(path) = device.path.clone() else {
            continue;
        };

        let device_type = device
            .device_type
            .clone()
            .unwrap_or_else(|| "unknown".to_string());
        let next_root_path = if device_type == "disk" {
            path.clone()
        } else {
            root_path.unwrap_or(&path).to_string()
        };
        let mountpoints = device
            .mountpoints
            .clone()
            .unwrap_or_default()
            .into_iter()
            .flatten()
            .filter(|value| !value.is_empty() && !value.starts_with('['))
            .collect::<Vec<_>>();

        records.push(LinuxDeviceRecord {
            path: path.clone(),
            root_path: next_root_path.clone(),
            device_type,
            mountpoints,
        });

        collect_linux_device_records(&device.children, Some(&next_root_path), records);
    }
}

#[cfg(target_os = "linux")]
fn read_linux_device_records() -> Result<Vec<LinuxDeviceRecord>> {
    let output = run_command("lsblk", &["-J", "-o", "PATH,TYPE,MOUNTPOINTS"])?;
    let parsed: LsblkResponse = serde_json::from_str(&output)
        .map_err(|error| failure(format!("failed to parse lsblk output: {}", error)))?;
    let mut records = Vec::new();
    collect_linux_device_records(&parsed.blockdevices, None, &mut records);
    Ok(records)
}

#[cfg(target_os = "linux")]
fn safely_eject_linux(mount_path: &str, device_path: Option<&str>) -> Result<SafeEjectOutcome> {
    sync_filesystem()?;

    let records = read_linux_device_records()?;
    let target_root_path = device_path
        .and_then(|candidate| {
            records
                .iter()
                .find(|record| record.path == candidate)
                .map(|record| record.root_path.clone())
        })
        .or_else(|| {
            records
                .iter()
                .find(|record| record.mountpoints.iter().any(|entry| entry == mount_path))
                .map(|record| record.root_path.clone())
        })
        .ok_or_else(|| {
            failure(format!(
                "unable to resolve block device for mount path {}",
                mount_path
            ))
        })?;

    let mut partitions_to_unmount = records
        .iter()
        .filter(|record| {
            record.root_path == target_root_path
                && record.device_type != "disk"
                && !record.mountpoints.is_empty()
        })
        .cloned()
        .collect::<Vec<_>>();

    partitions_to_unmount.sort_by(|left, right| {
        let left_rank = left
            .mountpoints
            .iter()
            .map(|value| value.len())
            .max()
            .unwrap_or(0);
        let right_rank = right
            .mountpoints
            .iter()
            .map(|value| value.len())
            .max()
            .unwrap_or(0);
        right_rank.cmp(&left_rank)
    });

    for partition in partitions_to_unmount {
        run_command("udisksctl", &["unmount", "-b", &partition.path])?;
    }

    match run_command("udisksctl", &["power-off", "-b", &target_root_path]) {
        Ok(_) => Ok(SafeEjectOutcome {
            strategy: "linux-udisks-power-off",
            powered_off: true,
        }),
        Err(power_off_error) => match run_command("eject", &[&target_root_path]) {
            Ok(_) => Ok(SafeEjectOutcome {
                strategy: "linux-udisks-unmount-eject",
                powered_off: false,
            }),
            Err(eject_error) => Err(failure(format!(
                "{}; fallback eject failed: {}",
                power_off_error, eject_error
            ))),
        },
    }
}

#[cfg(target_os = "macos")]
fn mac_parent_disk_path(device_path: &str) -> Option<String> {
    let value = device_path.strip_prefix("/dev/disk")?;
    let index = value
        .chars()
        .position(|character| !character.is_ascii_digit())
        .unwrap_or(value.len());
    if index == 0 {
        return None;
    }
    Some(format!("/dev/disk{}", &value[..index]))
}

#[cfg(target_os = "macos")]
fn safely_eject_macos(mount_path: &str, device_path: Option<&str>) -> Result<SafeEjectOutcome> {
    sync_filesystem()?;

    let disk_path = device_path
        .and_then(mac_parent_disk_path)
        .ok_or_else(|| failure(format!("unable to resolve macOS disk for {}", mount_path)))?;

    if run_command("diskutil", &["unmountDisk", &disk_path]).is_err() {
        run_command("diskutil", &["unmount", mount_path])?;
    }

    run_command("diskutil", &["eject", &disk_path])?;

    Ok(SafeEjectOutcome {
        strategy: "macos-diskutil-eject",
        powered_off: false,
    })
}

#[cfg(target_os = "windows")]
fn windows_drive_prefix(mount_path: &str) -> Option<String> {
    let normalized = mount_path.trim().replace('/', "\\");
    let bytes = normalized.as_bytes();
    if bytes.len() < 2 || bytes[1] != b':' || !bytes[0].is_ascii_alphabetic() {
        return None;
    }
    Some(normalized[..2].to_ascii_uppercase())
}

#[cfg(target_os = "windows")]
fn safely_eject_windows(mount_path: &str, disk_kind: &str) -> Result<SafeEjectOutcome> {
    let drive = windows_drive_prefix(mount_path).ok_or_else(|| {
        failure(format!(
            "unable to resolve Windows drive letter for {}",
            mount_path
        ))
    })?;

    if disk_kind == "removable" {
        let power_shell_script = format!(
            "$item=(New-Object -ComObject Shell.Application).Namespace(17).ParseName('{drive}'); if ($null -eq $item) {{ exit 1 }}; $item.InvokeVerb('Eject')"
        );
        if run_command(
            "powershell",
            &[
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                &power_shell_script,
            ],
        )
        .is_ok()
        {
            return Ok(SafeEjectOutcome {
                strategy: "windows-shell-eject",
                powered_off: false,
            });
        }
    }

    run_command("mountvol", &[&drive, "/p"])?;

    Ok(SafeEjectOutcome {
        strategy: "windows-mountvol-dismount",
        powered_off: false,
    })
}

#[cfg(test)]
mod tests {
    #[cfg(target_os = "macos")]
    use super::mac_parent_disk_path;
    #[cfg(target_os = "windows")]
    use super::windows_drive_prefix;

    #[cfg(target_os = "macos")]
    #[test]
    fn resolves_parent_macos_disk_path() {
        assert_eq!(
            mac_parent_disk_path("/dev/disk4s1"),
            Some("/dev/disk4".to_string())
        );
        assert_eq!(
            mac_parent_disk_path("/dev/disk12s3"),
            Some("/dev/disk12".to_string())
        );
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn extracts_windows_drive_prefix() {
        assert_eq!(windows_drive_prefix("E:\\"), Some("E:".to_string()));
        assert_eq!(windows_drive_prefix("f:/"), Some("F:".to_string()));
        assert_eq!(windows_drive_prefix("/not/a/drive"), None);
    }
}
