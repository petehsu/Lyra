use std::process::Command;

use napi::Result;
use serde::Deserialize;

use crate::failure;

pub struct MountDeviceOutcome {
    pub strategy: &'static str,
    pub mount_path: Option<String>,
}

pub fn mount_device(device_path: &str, disk_kind: &str) -> Result<MountDeviceOutcome> {
    if !matches!(disk_kind, "system" | "local" | "removable" | "external") {
        return Err(failure(format!(
            "disk kind {} is not eligible for mount",
            disk_kind
        )));
    }

    #[cfg(target_os = "linux")]
    {
        return mount_device_linux(device_path);
    }

    #[cfg(target_os = "macos")]
    {
        return mount_device_macos(device_path);
    }

    #[cfg(target_os = "windows")]
    {
        return mount_device_windows(device_path);
    }

    #[allow(unreachable_code)]
    Err(failure(format!(
        "device mount is not supported on {}",
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

#[cfg(target_os = "linux")]
#[derive(Debug, Deserialize)]
struct LinuxMountResponse {
    blockdevices: Vec<LinuxMountBlockDevice>,
}

#[cfg(target_os = "linux")]
#[derive(Debug, Deserialize)]
struct LinuxMountBlockDevice {
    path: Option<String>,
    mountpoints: Option<Vec<Option<String>>>,
    #[serde(default)]
    children: Vec<LinuxMountBlockDevice>,
}

#[cfg(target_os = "linux")]
fn linux_find_mount_path(device: &LinuxMountBlockDevice, target: &str) -> Option<String> {
    if device.path.as_deref() == Some(target) {
        return device
            .mountpoints
            .clone()
            .unwrap_or_default()
            .into_iter()
            .flatten()
            .find(|value| !value.is_empty() && !value.starts_with('['));
    }

    device
        .children
        .iter()
        .find_map(|child| linux_find_mount_path(child, target))
}

#[cfg(target_os = "linux")]
fn read_linux_mount_path(device_path: &str) -> Result<Option<String>> {
    let output = run_command("lsblk", &["-J", "-o", "PATH,MOUNTPOINTS"])?;
    let parsed: LinuxMountResponse = serde_json::from_str(&output)
        .map_err(|error| failure(format!("failed to parse lsblk output: {}", error)))?;

    Ok(parsed
        .blockdevices
        .iter()
        .find_map(|device| linux_find_mount_path(device, device_path)))
}

#[cfg(target_os = "linux")]
fn mount_device_linux(device_path: &str) -> Result<MountDeviceOutcome> {
    run_command("udisksctl", &["mount", "-b", device_path])?;
    let mount_path = read_linux_mount_path(device_path)?;

    Ok(MountDeviceOutcome {
        strategy: "linux-udisks-mount",
        mount_path,
    })
}

#[cfg(target_os = "macos")]
#[derive(Debug, Deserialize)]
struct MacDiskutilInfo {
    #[serde(rename = "MountPoint")]
    mount_point: Option<String>,
}

#[cfg(target_os = "macos")]
fn macos_shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\"'\"'"))
}

#[cfg(target_os = "macos")]
fn read_macos_mount_path(device_path: &str) -> Result<Option<String>> {
    let script = format!(
        "diskutil info -plist {} | plutil -convert json -o - -",
        macos_shell_quote(device_path)
    );
    let output = run_command("sh", &["-c", &script])?;
    let info: MacDiskutilInfo = serde_json::from_str(&output)
        .map_err(|error| failure(format!("failed to parse diskutil info: {}", error)))?;
    Ok(info.mount_point.filter(|value| !value.trim().is_empty()))
}

#[cfg(target_os = "macos")]
fn mount_device_macos(device_path: &str) -> Result<MountDeviceOutcome> {
    run_command("diskutil", &["mount", device_path])?;
    let mount_path = read_macos_mount_path(device_path)?;

    Ok(MountDeviceOutcome {
        strategy: "macos-diskutil-mount",
        mount_path,
    })
}

#[cfg(target_os = "windows")]
fn windows_powershell_escape(value: &str) -> String {
    value.replace('\'', "''")
}

#[cfg(target_os = "windows")]
fn mount_device_windows(device_path: &str) -> Result<MountDeviceOutcome> {
    let escaped_device_path = windows_powershell_escape(device_path);
    let script = format!(
        "$device='{escaped_device_path}'; \
         $volume=Get-CimInstance Win32_Volume | Where-Object {{ $_.DeviceID -eq $device }}; \
         if ($null -eq $volume) {{ throw 'unable to resolve volume for mount' }}; \
         $result=Invoke-CimMethod -InputObject $volume -MethodName Mount; \
         if ($result.ReturnValue -ne 0) {{ throw ('Win32_Volume.Mount failed with code ' + $result.ReturnValue) }}; \
         $mounted=Get-CimInstance Win32_Volume | Where-Object {{ $_.DeviceID -eq $device }}; \
         if ($null -ne $mounted.DriveLetter -and $mounted.DriveLetter -ne '') {{ Write-Output ($mounted.DriveLetter + ':\\\\') }} \
         elseif ($null -ne $mounted.Name -and $mounted.Name -ne '') {{ Write-Output $mounted.Name }}"
    );
    let mount_path = run_command(
        "powershell",
        &["-NoProfile", "-NonInteractive", "-Command", &script],
    )?;

    Ok(MountDeviceOutcome {
        strategy: "windows-wmi-mount",
        mount_path: if mount_path.trim().is_empty() {
            None
        } else {
            Some(mount_path)
        },
    })
}
