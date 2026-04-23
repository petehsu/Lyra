use std::path::PathBuf;

use lyra_utils_absolute_path::AbsolutePathBuf;

/// Runtime paths needed by exec-server child processes.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ExecServerRuntimePaths {
    /// Stable path to the Lyra executable used to launch hidden helper modes.
    pub lyra_self_exe: AbsolutePathBuf,
    /// Path to the Linux sandbox helper alias used when the platform sandbox
    /// needs to re-enter Lyra by argv0.
    pub lyra_linux_sandbox_exe: Option<AbsolutePathBuf>,
}

impl ExecServerRuntimePaths {
    pub fn from_optional_paths(
        lyra_self_exe: Option<PathBuf>,
        lyra_linux_sandbox_exe: Option<PathBuf>,
    ) -> std::io::Result<Self> {
        let lyra_self_exe = lyra_self_exe.ok_or_else(|| {
            std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "Lyra executable path is not configured",
            )
        })?;
        Self::new(lyra_self_exe, lyra_linux_sandbox_exe)
    }

    pub fn new(
        lyra_self_exe: PathBuf,
        lyra_linux_sandbox_exe: Option<PathBuf>,
    ) -> std::io::Result<Self> {
        Ok(Self {
            lyra_self_exe: absolute_path(lyra_self_exe)?,
            lyra_linux_sandbox_exe: lyra_linux_sandbox_exe.map(absolute_path).transpose()?,
        })
    }
}

fn absolute_path(path: PathBuf) -> std::io::Result<AbsolutePathBuf> {
    AbsolutePathBuf::from_absolute_path(path.as_path())
        .map_err(|err| std::io::Error::new(std::io::ErrorKind::InvalidInput, err))
}
