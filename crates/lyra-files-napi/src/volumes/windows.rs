use std::process::Command;

use serde::Deserialize;

use crate::dto::FileManagerDevice;

#[cfg(target_os = "windows")]
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WindowsUnmountedDevice {
    device_path: String,
    display_path: Option<String>,
    title: String,
    file_system: Option<String>,
    kind: String,
    total_bytes: Option<f64>,
    is_removable: bool,
    can_mount: bool,
    can_eject: bool,
}

#[cfg(target_os = "windows")]
fn windows_powershell_escape(value: &str) -> String {
    value.replace('\'', "''")
}

#[cfg(target_os = "windows")]
pub fn read_unmounted_devices() -> Vec<FileManagerDevice> {
    let script = "$items = Get-Partition | ForEach-Object { \
        $partition = $_; \
        $accessPaths = @($partition.AccessPaths | Where-Object { $_ -and $_ -ne '' }); \
        if ($accessPaths.Count -gt 0) { return }; \
        if ($partition.GptType -in @('{C12A7328-F81F-11D2-BA4B-00A0C93EC93B}','{DE94BBA4-06D1-4D40-A16A-BFD50179D6AC}','{E3C9E316-0B5C-4DB8-817D-F92DF00215AE}')) { return }; \
        $volume = Get-Volume -Partition $partition -ErrorAction SilentlyContinue; \
        if ($null -eq $volume) { return }; \
        if ($null -ne $volume.DriveLetter -and $volume.DriveLetter -ne '') { return }; \
        if ($volume.Size -lt 134217728 -and $volume.FileSystem -match 'FAT') { return }; \
        if ($null -eq $volume.UniqueId -or $volume.UniqueId -eq '') { return }; \
        $disk = Get-Disk -Number $partition.DiskNumber -ErrorAction SilentlyContinue; \
        $busType = if ($null -ne $disk) { [string]$disk.BusType } else { '' }; \
        $kind = if ($null -ne $disk -and ($disk.IsBoot -or $disk.IsSystem)) { 'system' } elseif ($volume.DriveType -eq 2) { 'removable' } elseif ($busType -in @('USB','FireWire','Thunderbolt','SD')) { 'external' } else { 'local' }; \
        [pscustomobject]@{ \
          devicePath = $volume.UniqueId; \
          displayPath = ('Disk ' + $partition.DiskNumber + ' Partition ' + $partition.PartitionNumber); \
          title = if ($volume.FileSystemLabel) { $volume.FileSystemLabel } elseif ($null -ne $disk -and $disk.FriendlyName) { $disk.FriendlyName } else { 'Unmounted Volume' }; \
          fileSystem = $volume.FileSystem; \
          kind = $kind; \
          totalBytes = if ($volume.Size -gt 0) { [double]$volume.Size } else { $null }; \
          isRemovable = ($volume.DriveType -eq 2); \
          canMount = $true; \
          canEject = $false \
        } \
      }; \
      if ($null -eq $items) { '[]' } else { @($items) | ConvertTo-Json -Depth 4 -Compress }";

    let output = match Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", script])
        .output()
    {
        Ok(value) if value.status.success() => {
            String::from_utf8_lossy(&value.stdout).trim().to_string()
        }
        _ => return Vec::new(),
    };

    let parsed: Vec<WindowsUnmountedDevice> = match serde_json::from_str(&output) {
        Ok(value) => value,
        Err(_) => return Vec::new(),
    };

    parsed
        .into_iter()
        .map(|device| FileManagerDevice {
            id: device.device_path.clone(),
            title: device.title,
            device_path: device.device_path.clone(),
            display_path: device.display_path,
            file_system: device.file_system,
            kind: device.kind,
            os_flavor: None,
            total_bytes: device.total_bytes,
            is_removable: device.is_removable,
            can_mount: device.can_mount,
            can_eject: device.can_eject,
        })
        .collect()
}
