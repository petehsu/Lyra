use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::paths::{normalize_path, path_to_string, seconds_since_epoch};
use crate::{FilesCoreError, Result};

const MAX_EDITABLE_TEXT_FILE_BYTES: u64 = 2 * 1024 * 1024;
const MAX_READONLY_TEXT_FILE_BYTES: u64 = 8 * 1024 * 1024;
const UTF8_BOM: &[u8] = b"\xEF\xBB\xBF";

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileReadResult {
    pub kind: String,
    pub path: String,
    pub reason: Option<String>,
    pub revision: Option<String>,
    pub encoding: Option<String>,
    pub read_only: bool,
    pub size_bytes: f64,
    pub content: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileWriteTextRequest {
    pub path: String,
    pub content: String,
    pub expected_revision: Option<String>,
    pub encoding: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileWriteResult {
    pub ok: bool,
    pub kind: Option<String>,
    pub path: String,
    pub message: Option<String>,
    pub expected_revision: Option<String>,
    pub current_revision: Option<String>,
    pub revision: Option<String>,
    pub encoding: Option<String>,
    pub saved_at: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileStatResult {
    pub path: String,
    pub exists: bool,
    pub is_directory: bool,
    pub read_only: bool,
    pub size_bytes: f64,
    pub modified_at: Option<String>,
    pub revision: Option<String>,
}

fn invalid_arg(message: impl Into<String>) -> FilesCoreError {
    FilesCoreError::InvalidArgument(message.into())
}

fn io_error(context: impl Into<String>, source: std::io::Error) -> FilesCoreError {
    FilesCoreError::Io {
        context: context.into(),
        source,
    }
}

fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    let digest = hasher.finalize();
    digest
        .iter()
        .map(|value| format!("{:02x}", value))
        .collect::<String>()
}

fn encode_text_content(content: &str, encoding: &str) -> Vec<u8> {
    let utf8_bytes = content.as_bytes();
    if encoding == "utf8-bom" {
        let mut bytes = Vec::with_capacity(UTF8_BOM.len() + utf8_bytes.len());
        bytes.extend_from_slice(UTF8_BOM);
        bytes.extend_from_slice(utf8_bytes);
        return bytes;
    }
    utf8_bytes.to_vec()
}

fn decode_text_content(bytes: &[u8]) -> std::result::Result<(String, String), String> {
    if bytes.starts_with(UTF8_BOM) {
        let payload = &bytes[UTF8_BOM.len()..];
        return std::str::from_utf8(payload)
            .map(|content| (content.to_string(), "utf8-bom".to_string()))
            .map_err(|_| "encoding-not-supported".to_string());
    }

    std::str::from_utf8(bytes)
        .map(|content| (content.to_string(), "utf8".to_string()))
        .map_err(|_| "encoding-not-supported".to_string())
}

fn normalize_text_encoding(value: Option<&str>) -> Result<String> {
    match value.map(str::trim).filter(|entry| !entry.is_empty()) {
        None => Ok("utf8".to_string()),
        Some("utf8") => Ok("utf8".to_string()),
        Some("utf8-bom") => Ok("utf8-bom".to_string()),
        Some(_) => Err(invalid_arg("encoding is unsupported")),
    }
}

fn create_temp_file_path(target_path: &Path) -> PathBuf {
    let parent = target_path
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from("."));
    let file_name = target_path
        .file_name()
        .map(crate::paths::os_to_string)
        .unwrap_or_else(|| "lyra-file".to_string());
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    let process_id = std::process::id();
    parent.join(format!(
        ".{}.lyra.tmp.{}.{}",
        file_name, process_id, timestamp
    ))
}

#[cfg(unix)]
fn sync_parent_directory(path: &Path) -> std::io::Result<()> {
    let parent = path.parent().ok_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::Other, "missing parent directory")
    })?;
    let file = File::open(parent)?;
    file.sync_all()
}

#[cfg(not(unix))]
fn sync_parent_directory(_path: &Path) -> std::io::Result<()> {
    Ok(())
}

fn write_bytes_atomically(path: &Path, bytes: &[u8]) -> Result<()> {
    let parent = path
        .parent()
        .ok_or_else(|| invalid_arg("path has no parent directory"))?;
    fs::create_dir_all(parent)
        .map_err(|error| io_error(format!("failed to create {}", parent.display()), error))?;

    let temp_path = create_temp_file_path(path);
    let write_result = (|| -> std::io::Result<()> {
        let mut temp_file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temp_path)?;
        temp_file.write_all(bytes)?;
        temp_file.sync_all()?;
        drop(temp_file);

        #[cfg(windows)]
        {
            if path.exists() {
                fs::remove_file(path)?;
            }
        }

        fs::rename(&temp_path, path)?;
        sync_parent_directory(path)?;
        Ok(())
    })();

    if let Err(error) = write_result {
        let _ = fs::remove_file(&temp_path);
        return Err(io_error(
            format!("failed to write {}", path.display()),
            error,
        ));
    }

    Ok(())
}

pub fn read_text_file(path: &str) -> Result<FileReadResult> {
    let file_path = normalize_path(path)?;
    let canonical_path = file_path
        .canonicalize()
        .map_err(|error| io_error(format!("failed to access {}", file_path.display()), error))?;
    let metadata = fs::metadata(&canonical_path).map_err(|error| {
        io_error(
            format!("failed to read {}", canonical_path.display()),
            error,
        )
    })?;
    if metadata.is_file() == false {
        return Err(invalid_arg(format!(
            "{} is not a file",
            canonical_path.display()
        )));
    }

    let forced_read_only = metadata.len() > MAX_EDITABLE_TEXT_FILE_BYTES;
    let read_only = metadata.permissions().readonly() || forced_read_only;
    let size_bytes = metadata.len() as f64;
    let path_string = path_to_string(&canonical_path);

    if metadata.len() > MAX_READONLY_TEXT_FILE_BYTES {
        return Ok(FileReadResult {
            kind: "unsupported".to_string(),
            path: path_string,
            reason: Some("file-too-large".to_string()),
            revision: None,
            encoding: None,
            read_only,
            size_bytes,
            content: None,
        });
    }

    let bytes = fs::read(&canonical_path).map_err(|error| {
        io_error(
            format!("failed to read {}", canonical_path.display()),
            error,
        )
    })?;
    let revision = sha256_hex(&bytes);

    let (content, encoding) = match decode_text_content(&bytes) {
        Ok(value) => value,
        Err(reason) => {
            return Ok(FileReadResult {
                kind: "unsupported".to_string(),
                path: path_string,
                reason: Some(reason),
                revision: Some(revision),
                encoding: None,
                read_only,
                size_bytes,
                content: None,
            })
        }
    };

    Ok(FileReadResult {
        kind: "text".to_string(),
        path: path_string,
        reason: None,
        revision: Some(revision),
        encoding: Some(encoding),
        read_only,
        size_bytes,
        content: Some(content),
    })
}

pub fn write_text_file(request: FileWriteTextRequest) -> Result<FileWriteResult> {
    let file_path = normalize_path(&request.path)?;
    let canonical_path = file_path
        .canonicalize()
        .map_err(|error| io_error(format!("failed to access {}", file_path.display()), error))?;
    let metadata = fs::metadata(&canonical_path).map_err(|error| {
        io_error(
            format!("failed to read {}", canonical_path.display()),
            error,
        )
    })?;
    if metadata.is_file() == false {
        return Err(invalid_arg(format!(
            "{} is not a file",
            canonical_path.display()
        )));
    }
    if metadata.permissions().readonly() {
        return Err(invalid_arg("file is read-only"));
    }
    if metadata.len() > MAX_EDITABLE_TEXT_FILE_BYTES {
        return Err(invalid_arg("file is too large for editing"));
    }

    let current_bytes = fs::read(&canonical_path).map_err(|error| {
        io_error(
            format!("failed to read {}", canonical_path.display()),
            error,
        )
    })?;
    let current_revision = sha256_hex(&current_bytes);
    let expected_revision = request
        .expected_revision
        .as_ref()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    if let Some(expected) = expected_revision.as_ref() {
        if expected != &current_revision {
            return Ok(FileWriteResult {
                ok: false,
                kind: Some("revision-conflict".to_string()),
                path: path_to_string(&canonical_path),
                message: Some("file changed outside Lyra".to_string()),
                expected_revision,
                current_revision: Some(current_revision),
                revision: None,
                encoding: None,
                saved_at: None,
            });
        }
    }

    let resolved_encoding = match request
        .encoding
        .as_ref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
    {
        Some(value) => normalize_text_encoding(Some(value))?,
        None => decode_text_content(&current_bytes)
            .map(|(_, encoding)| encoding)
            .unwrap_or_else(|_| "utf8".to_string()),
    };

    let next_bytes = encode_text_content(&request.content, &resolved_encoding);
    write_bytes_atomically(&canonical_path, &next_bytes)?;

    let revision = sha256_hex(&next_bytes);
    let saved_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs().to_string())
        .unwrap_or_else(|_| "0".to_string());

    Ok(FileWriteResult {
        ok: true,
        kind: None,
        path: path_to_string(&canonical_path),
        message: None,
        expected_revision: None,
        current_revision: None,
        revision: Some(revision),
        encoding: Some(resolved_encoding),
        saved_at: Some(saved_at),
    })
}

pub fn stat_file(path: &str) -> Result<FileStatResult> {
    let file_path = normalize_path(path)?;
    let canonical_path = match file_path.canonicalize() {
        Ok(path) => path,
        Err(_) => {
            return Ok(FileStatResult {
                path: path_to_string(&file_path),
                exists: false,
                is_directory: false,
                read_only: false,
                size_bytes: 0.0,
                modified_at: None,
                revision: None,
            })
        }
    };

    let metadata = fs::metadata(&canonical_path).map_err(|error| {
        io_error(
            format!("failed to read {}", canonical_path.display()),
            error,
        )
    })?;
    let is_directory = metadata.is_dir();
    let revision = if is_directory {
        None
    } else {
        let bytes = fs::read(&canonical_path).map_err(|error| {
            io_error(
                format!("failed to read {}", canonical_path.display()),
                error,
            )
        })?;
        Some(sha256_hex(&bytes))
    };

    Ok(FileStatResult {
        path: path_to_string(&canonical_path),
        exists: true,
        is_directory,
        read_only: metadata.permissions().readonly(),
        size_bytes: metadata.len() as f64,
        modified_at: metadata.modified().ok().and_then(seconds_since_epoch),
        revision,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_file(name: &str, bytes: &[u8]) -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "lyra-files-core-text-test-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&root).unwrap();
        let file_path = root.join(name);
        fs::write(&file_path, bytes).unwrap();
        file_path
    }

    #[test]
    fn reads_and_preserves_utf8_bom_encoding() {
        let path = temp_file("bom.txt", b"\xEF\xBB\xBFhello");

        let read = read_text_file(&path_to_string(&path)).unwrap();
        assert_eq!(read.kind, "text");
        assert_eq!(read.encoding.as_deref(), Some("utf8-bom"));
        assert_eq!(read.content.as_deref(), Some("hello"));

        let written = write_text_file(FileWriteTextRequest {
            path: path_to_string(&path),
            content: "updated".to_string(),
            expected_revision: read.revision,
            encoding: None,
        })
        .unwrap();
        assert!(written.ok);
        assert!(fs::read(&path).unwrap().starts_with(UTF8_BOM));

        fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }

    #[test]
    fn reports_revision_conflict_without_writing() {
        let path = temp_file("conflict.txt", b"first");

        let result = write_text_file(FileWriteTextRequest {
            path: path_to_string(&path),
            content: "second".to_string(),
            expected_revision: Some("not-the-current-revision".to_string()),
            encoding: None,
        })
        .unwrap();

        assert_eq!(result.ok, false);
        assert_eq!(result.kind.as_deref(), Some("revision-conflict"));
        assert_eq!(fs::read_to_string(&path).unwrap(), "first");

        fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }

    #[test]
    fn stats_missing_files_as_not_found() {
        let path = std::env::temp_dir().join("lyra-files-core-text-missing-file.txt");
        let _ = fs::remove_file(&path);

        let result = stat_file(&path_to_string(&path)).unwrap();

        assert_eq!(result.exists, false);
        assert_eq!(result.is_directory, false);
        assert!(result.revision.is_none());
    }
}
