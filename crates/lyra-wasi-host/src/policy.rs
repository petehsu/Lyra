use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};

use crate::{HostError, Result};

pub const APP_DATA_READ_PERMISSION: &str = "wasi:app-data.read";
pub const APP_DATA_WRITE_PERMISSION: &str = "wasi:app-data.write";
pub const TEMP_READ_PERMISSION: &str = "wasi:temp.read";
pub const TEMP_WRITE_PERMISSION: &str = "wasi:temp.write";

const APP_DATA_GUEST_PATH: &str = "/app-data";
const TEMP_GUEST_PATH: &str = "/tmp";

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub enum WasiDirectoryPermission {
    AppDataRead,
    AppDataWrite,
    TempRead,
    TempWrite,
}

impl WasiDirectoryPermission {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::AppDataRead => APP_DATA_READ_PERMISSION,
            Self::AppDataWrite => APP_DATA_WRITE_PERMISSION,
            Self::TempRead => TEMP_READ_PERMISSION,
            Self::TempWrite => TEMP_WRITE_PERMISSION,
        }
    }

    fn parse(value: &str) -> Option<Self> {
        match value {
            APP_DATA_READ_PERMISSION => Some(Self::AppDataRead),
            APP_DATA_WRITE_PERMISSION => Some(Self::AppDataWrite),
            TEMP_READ_PERMISSION => Some(Self::TempRead),
            TEMP_WRITE_PERMISSION => Some(Self::TempWrite),
            _ => None,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DirectoryAccess {
    ReadOnly,
    ReadWrite,
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct WasiDirectoryRoots {
    pub app_data: Option<PathBuf>,
    pub temporary: Option<PathBuf>,
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct WasiComponentPolicy {
    permissions: BTreeSet<WasiDirectoryPermission>,
    roots: WasiDirectoryRoots,
}

impl WasiComponentPolicy {
    pub fn from_manifest_permissions<'a>(
        permissions: impl IntoIterator<Item = &'a str>,
        roots: WasiDirectoryRoots,
    ) -> Result<Self> {
        let mut parsed = BTreeSet::new();
        for permission in permissions {
            if let Some(permission) = WasiDirectoryPermission::parse(permission) {
                parsed.insert(permission);
            } else if permission.starts_with("wasi:") {
                return Err(HostError::UnknownWasiPermission(permission.to_owned()));
            }
        }
        Ok(Self {
            permissions: parsed,
            roots,
        })
    }

    pub fn permissions(&self) -> impl Iterator<Item = WasiDirectoryPermission> + '_ {
        self.permissions.iter().copied()
    }

    pub fn prepare(&self) -> Result<ResolvedWasiPolicy> {
        let mut preopens = Vec::new();
        if let Some(access) = self.app_data_access() {
            preopens.push(ResolvedPreopen {
                host_path: prepare_root("application data", self.roots.app_data.as_deref())?,
                guest_path: APP_DATA_GUEST_PATH,
                access,
            });
        }
        if let Some(access) = self.temp_access() {
            preopens.push(ResolvedPreopen {
                host_path: prepare_root("temporary data", self.roots.temporary.as_deref())?,
                guest_path: TEMP_GUEST_PATH,
                access,
            });
        }
        if preopens.len() == 2
            && (preopens[0].host_path.starts_with(&preopens[1].host_path)
                || preopens[1].host_path.starts_with(&preopens[0].host_path))
        {
            return Err(HostError::OverlappingDirectoryRoots(
                preopens[0].host_path.clone(),
            ));
        }
        Ok(ResolvedWasiPolicy { preopens })
    }

    fn app_data_access(&self) -> Option<DirectoryAccess> {
        directory_access(
            &self.permissions,
            WasiDirectoryPermission::AppDataRead,
            WasiDirectoryPermission::AppDataWrite,
        )
    }

    fn temp_access(&self) -> Option<DirectoryAccess> {
        directory_access(
            &self.permissions,
            WasiDirectoryPermission::TempRead,
            WasiDirectoryPermission::TempWrite,
        )
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ResolvedPreopen {
    pub host_path: PathBuf,
    pub guest_path: &'static str,
    pub access: DirectoryAccess,
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct ResolvedWasiPolicy {
    pub preopens: Vec<ResolvedPreopen>,
}

impl ResolvedWasiPolicy {
    pub const fn inherits_environment(&self) -> bool {
        false
    }

    pub const fn allows_network(&self) -> bool {
        false
    }
}

fn directory_access(
    permissions: &BTreeSet<WasiDirectoryPermission>,
    read: WasiDirectoryPermission,
    write: WasiDirectoryPermission,
) -> Option<DirectoryAccess> {
    if permissions.contains(&write) {
        Some(DirectoryAccess::ReadWrite)
    } else if permissions.contains(&read) {
        Some(DirectoryAccess::ReadOnly)
    } else {
        None
    }
}

fn prepare_root(label: &'static str, root: Option<&Path>) -> Result<PathBuf> {
    let root = root.ok_or(HostError::MissingDirectoryRoot(label))?;
    if root.as_os_str().is_empty() {
        return Err(HostError::InvalidDirectoryRoot {
            path: root.to_path_buf(),
            reason: "path is empty".to_owned(),
        });
    }
    fs::create_dir_all(root).map_err(|source| HostError::Io {
        path: root.to_path_buf(),
        source,
    })?;
    let metadata = fs::symlink_metadata(root).map_err(|source| HostError::Io {
        path: root.to_path_buf(),
        source,
    })?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(HostError::InvalidDirectoryRoot {
            path: root.to_path_buf(),
            reason: "root must be a real directory, not a file or symbolic link".to_owned(),
        });
    }
    fs::canonicalize(root).map_err(|source| HostError::Io {
        path: root.to_path_buf(),
        source,
    })
}
