use std::{
    env,
    path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize};

use crate::HardwareToolchainState;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ToolchainStatus {
    Available,
    Missing,
}

pub trait ToolchainDetector: Send + Sync {
    fn detect(&self) -> Vec<HardwareToolchainState>;
}

#[derive(Default)]
pub struct ToolchainProbe {
    path_override: Option<String>,
}

impl ToolchainProbe {
    #[cfg(test)]
    pub fn with_path(path: String) -> Self {
        Self {
            path_override: Some(path),
        }
    }
}

impl ToolchainDetector for ToolchainProbe {
    fn detect(&self) -> Vec<HardwareToolchainState> {
        [
            (
                "python",
                "Install Python 3 to enable esptool and REPL helpers.",
            ),
            (
                "esptool",
                "Approve installing esptool with Python/pip for ESP flashing.",
            ),
            (
                "arduino-cli",
                "Approve installing arduino-cli for Arduino board workflows.",
            ),
            (
                "platformio",
                "Approve installing PlatformIO for board build/upload workflows.",
            ),
        ]
        .into_iter()
        .map(|(name, hint)| {
            let path = find_on_path(name, self.path_override.as_deref());
            HardwareToolchainState {
                name: name.to_string(),
                status: if path.is_some() {
                    ToolchainStatus::Available
                } else {
                    ToolchainStatus::Missing
                },
                path: path.map(|value| value.display().to_string()),
                install_hint: Some(hint.to_string()),
            }
        })
        .collect()
    }
}

fn find_on_path(name: &str, path_override: Option<&str>) -> Option<PathBuf> {
    let path = path_override
        .map(str::to_string)
        .or_else(|| env::var("PATH").ok())?;
    env::split_paths(&path).find_map(|dir| {
        let candidate = executable_candidate(&dir, name);
        candidate.exists().then_some(candidate)
    })
}

fn executable_candidate(dir: &Path, name: &str) -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        let exe = dir.join(format!("{name}.exe"));
        if exe.exists() {
            return exe;
        }
    }
    dir.join(name)
}

#[cfg(test)]
mod tests {
    use std::{fs, path::Path};

    use tempfile::tempdir;

    use super::*;

    #[test]
    fn detects_present_and_missing_toolchains() {
        let temp = tempdir().expect("tempdir");
        fs::write(temp.path().join("python"), "").expect("python");
        let probe = ToolchainProbe::with_path(temp.path().display().to_string());
        let tools = probe.detect();
        assert_eq!(status(&tools, "python"), ToolchainStatus::Available);
        assert_eq!(status(&tools, "esptool"), ToolchainStatus::Missing);
    }

    fn status(tools: &[HardwareToolchainState], name: &str) -> ToolchainStatus {
        tools
            .iter()
            .find(|tool| tool.name == name)
            .map(|tool| tool.status.clone())
            .expect("tool")
    }

    #[test]
    fn executable_candidate_uses_plain_name_on_unix() {
        assert!(executable_candidate(Path::new("/tmp"), "python").ends_with("python"));
    }
}
