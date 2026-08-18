#![cfg_attr(test, allow(clippy::expect_used, clippy::unwrap_used))]

mod archive;
mod download;
mod install;
mod model;
mod projection;
mod registry;
mod trust;

#[cfg(test)]
mod offline_install_tests;

use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use thiserror::Error;

pub use archive::ExtractionLimits;
pub use download::{DownloadOutcome, HttpDownloader};
pub use install::{BootstrapInstaller, InstallerConfig};
pub use model::*;
pub use projection::{
    CoreProjectionConfig, CoreProjectionMode, CoreProjectionReport, CoreProjector,
    system_signed_core_replacement_enabled,
};
pub use registry::{
    ActivationRegistryMutationV1, mutate_activation_registry, read_activation_registry,
    read_activation_registry_revision,
};
pub use trust::{
    TrustedKeys, parse_and_verify_bom, parse_and_verify_catalog, select_component_latest,
    select_release, verify_component_signature,
};

pub type Result<T> = std::result::Result<T, BootstrapError>;

#[derive(Debug, Error)]
pub enum BootstrapError {
    #[error("invalid {0} JSON: {1}")]
    Json(&'static str, #[source] serde_json::Error),
    #[error("validation failed: {0}")]
    Validation(String),
    #[error("trust check failed: {0}")]
    Trust(String),
    #[error("target mismatch: expected `{expected}`, received `{actual}`")]
    TargetMismatch { expected: String, actual: String },
    #[error("network request failed: {0}")]
    Network(String),
    #[error("download was interrupted after {downloaded_bytes} bytes")]
    Interrupted { downloaded_bytes: u64 },
    #[error("installation was cancelled")]
    Cancelled,
    #[error("SHA-256 mismatch: expected {expected}, received {actual}")]
    HashMismatch { expected: String, actual: String },
    #[error("not enough disk space: {available} bytes available, {required} bytes required")]
    InsufficientSpace { available: u64, required: u64 },
    #[error("unsafe or invalid ZIP archive: {0}")]
    Archive(String),
    #[error("I/O error at {}: {source}", path.display())]
    Io {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },
}

impl BootstrapError {
    pub(crate) fn io(path: impl Into<PathBuf>, source: std::io::Error) -> Self {
        Self::Io {
            path: path.into(),
            source,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Deserialize, Serialize)]
#[serde(transparent)]
pub struct Target(String);

impl Target {
    pub fn parse(value: impl Into<String>) -> Result<Self> {
        let value = value.into();
        if matches!(
            value.as_str(),
            "darwin-x64"
                | "darwin-arm64"
                | "windows-x64"
                | "windows-arm64"
                | "linux-x64"
                | "linux-arm64"
        ) {
            Ok(Self(value))
        } else {
            Err(BootstrapError::Validation(format!(
                "unsupported target `{value}`"
            )))
        }
    }

    pub fn current() -> Result<Self> {
        let os = match std::env::consts::OS {
            "macos" => "darwin",
            "windows" => "windows",
            "linux" => "linux",
            other => {
                return Err(BootstrapError::Validation(format!(
                    "unsupported operating system `{other}`"
                )));
            }
        };
        let arch = match std::env::consts::ARCH {
            "x86_64" => "x64",
            "aarch64" => "arm64",
            other => {
                return Err(BootstrapError::Validation(format!(
                    "unsupported architecture `{other}`"
                )));
            }
        };
        Self::parse(format!("{os}-{arch}"))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}
