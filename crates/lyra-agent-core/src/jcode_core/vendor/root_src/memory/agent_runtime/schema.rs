use std::path::PathBuf;

use thiserror::Error;

pub const SCHEMA_VERSION: i64 = 1;
pub const LARGE_PAYLOAD_INLINE_BYTES: usize = 256 * 1024;

pub type AgentMemoryResult<T> = Result<T, AgentMemoryError>;

#[derive(Debug, Error)]
pub enum AgentMemoryError {
    #[error("recoverable store error: {0}")]
    RecoverableStoreError(String),
    #[error("corruption error: {0}")]
    CorruptionError(String),
    #[error("migration error: {0}")]
    MigrationError(String),
    #[error("invariant violation: {0}")]
    InvariantViolation(String),
    #[error("io error at {path}: {source}")]
    Io {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },
    #[error("sqlite error: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("serde error: {0}")]
    Serde(#[from] serde_json::Error),
}

impl AgentMemoryError {
    pub fn io(path: impl Into<PathBuf>, source: std::io::Error) -> Self {
        Self::Io {
            path: path.into(),
            source,
        }
    }

    pub fn recoverable(message: impl Into<String>) -> Self {
        Self::RecoverableStoreError(message.into())
    }

    pub fn corruption(message: impl Into<String>) -> Self {
        Self::CorruptionError(message.into())
    }

    pub fn migration(message: impl Into<String>) -> Self {
        Self::MigrationError(message.into())
    }

    pub fn invariant(message: impl Into<String>) -> Self {
        Self::InvariantViolation(message.into())
    }
}
