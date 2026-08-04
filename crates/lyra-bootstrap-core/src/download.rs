use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::Duration;

use reqwest::StatusCode;
use reqwest::blocking::{Client, Response};
use reqwest::header::{CONTENT_LENGTH, CONTENT_RANGE, ETAG, IF_RANGE, LAST_MODIFIED, RANGE};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::archive::hex_digest;
use crate::model::ResumeMetadataV1;
use crate::trust::{validate_https_url, validate_sha256};
use crate::{BootstrapError, Result};

const CHECKPOINT_BYTES: u64 = 4 * 1024 * 1024;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DownloadOutcome {
    Cached,
    Downloaded,
    Resumed,
}

#[derive(Clone, Debug)]
pub struct HttpDownloader {
    client: Client,
}

impl HttpDownloader {
    pub fn new(proxy: Option<&str>) -> Result<Self> {
        let redirect = reqwest::redirect::Policy::custom(|attempt| {
            if attempt.url().scheme() != "https" {
                return attempt.error("refusing an HTTPS downgrade redirect");
            }
            if attempt.previous().len() >= 8 {
                return attempt.error("too many redirects");
            }
            attempt.follow()
        });
        let mut builder = Client::builder()
            .connect_timeout(Duration::from_secs(30))
            .timeout(Duration::from_secs(6 * 60 * 60))
            .redirect(redirect)
            .user_agent("Lyra-Bootstrap/0.1");
        if let Some(proxy) = proxy.filter(|value| !value.trim().is_empty()) {
            builder =
                builder.proxy(reqwest::Proxy::all(proxy).map_err(|error| {
                    BootstrapError::Validation(format!("invalid proxy: {error}"))
                })?);
        }
        let client = builder
            .build()
            .map_err(|error| BootstrapError::Network(error.to_string()))?;
        Ok(Self { client })
    }

    pub fn read_signed_document(&self, source: &str, max_bytes: u64) -> Result<Vec<u8>> {
        if source.starts_with("https://") {
            return self.fetch_small_https(source, max_bytes);
        }
        if source.contains("://") {
            return Err(BootstrapError::Validation(
                "catalog source must be an HTTPS URL or a local file path".to_string(),
            ));
        }
        let path = Path::new(source);
        let metadata = fs::metadata(path).map_err(|error| BootstrapError::io(path, error))?;
        if metadata.len() > max_bytes {
            return Err(BootstrapError::Validation(format!(
                "signed document exceeds the {max_bytes}-byte limit"
            )));
        }
        fs::read(path).map_err(|error| BootstrapError::io(path, error))
    }

    pub fn fetch_small_https(&self, url: &str, max_bytes: u64) -> Result<Vec<u8>> {
        let url = validate_https_url(url)?;
        let response = self
            .client
            .get(url)
            .send()
            .map_err(|error| BootstrapError::Network(error.to_string()))?;
        validate_response_url(&response)?;
        let mut response = response
            .error_for_status()
            .map_err(|error| BootstrapError::Network(error.to_string()))?;
        if response
            .content_length()
            .is_some_and(|length| length > max_bytes)
        {
            return Err(BootstrapError::Validation(format!(
                "signed document exceeds the {max_bytes}-byte limit"
            )));
        }
        let mut bytes = Vec::new();
        response
            .by_ref()
            .take(max_bytes.saturating_add(1))
            .read_to_end(&mut bytes)
            .map_err(|error| BootstrapError::Network(error.to_string()))?;
        if bytes.len() as u64 > max_bytes {
            return Err(BootstrapError::Validation(format!(
                "signed document exceeds the {max_bytes}-byte limit"
            )));
        }
        Ok(bytes)
    }

    pub fn download_to(
        &self,
        url: &str,
        expected_size: u64,
        expected_sha256: &str,
        destination: &Path,
        mut should_continue: impl FnMut(u64, u64) -> bool,
    ) -> Result<DownloadOutcome> {
        let url = validate_https_url(url)?;
        validate_sha256(expected_sha256)?;
        if expected_size == 0 {
            return Err(BootstrapError::Validation(
                "download size must be greater than zero".to_string(),
            ));
        }
        if destination.exists() {
            let size = fs::metadata(destination)
                .map_err(|error| BootstrapError::io(destination, error))?
                .len();
            if size == expected_size && sha256_file(destination)? == expected_sha256 {
                return Ok(DownloadOutcome::Cached);
            }
            fs::remove_file(destination).map_err(|error| BootstrapError::io(destination, error))?;
        }
        let parent = destination.parent().ok_or_else(|| {
            BootstrapError::Validation("download destination has no parent".to_string())
        })?;
        fs::create_dir_all(parent).map_err(|error| BootstrapError::io(parent, error))?;
        let part_path = part_path(destination);
        let metadata_path = metadata_path(destination);

        for attempt in 0..2 {
            let resume = prepare_resume(
                &part_path,
                &metadata_path,
                url.as_str(),
                expected_size,
                expected_sha256,
            )?;
            let start = resume.as_ref().map_or(0, |state| state.downloaded_bytes);
            let required = expected_size.saturating_sub(start);
            let available =
                fs2::available_space(parent).map_err(|error| BootstrapError::io(parent, error))?;
            if available < required {
                return Err(BootstrapError::InsufficientSpace {
                    available,
                    required,
                });
            }

            let mut request = self.client.get(url.clone());
            if start > 0 {
                request = request.header(RANGE, format!("bytes={start}-"));
                if let Some(if_range) = resume
                    .as_ref()
                    .and_then(|state| state.etag.as_ref().or(state.last_modified.as_ref()))
                {
                    request = request.header(IF_RANGE, if_range);
                }
            }
            let response = request
                .send()
                .map_err(|error| BootstrapError::Network(error.to_string()))?;
            validate_response_url(&response)?;
            if response.status() == StatusCode::RANGE_NOT_SATISFIABLE && attempt == 0 {
                reset_resume(&part_path, &metadata_path)?;
                continue;
            }
            if !response.status().is_success() {
                return Err(BootstrapError::Network(format!(
                    "server returned {}",
                    response.status()
                )));
            }

            let is_resume = start > 0 && response.status() == StatusCode::PARTIAL_CONTENT;
            if is_resume {
                validate_content_range(&response, start, expected_size)?;
            }
            let write_start = if is_resume { start } else { 0 };
            validate_content_length(&response, expected_size.saturating_sub(write_start))?;
            let mut metadata = ResumeMetadataV1 {
                schema_version: 1,
                url: url.as_str().to_string(),
                sha256: expected_sha256.to_string(),
                expected_size,
                downloaded_bytes: write_start,
                etag: header_text(&response, ETAG),
                last_modified: header_text(&response, LAST_MODIFIED),
            };
            let mut file = if is_resume {
                OpenOptions::new()
                    .append(true)
                    .open(&part_path)
                    .map_err(|error| BootstrapError::io(&part_path, error))?
            } else {
                File::create(&part_path).map_err(|error| BootstrapError::io(&part_path, error))?
            };
            checkpoint(&mut file, &metadata_path, &metadata)?;
            stream_response(
                response,
                &mut file,
                &metadata_path,
                &mut metadata,
                &mut should_continue,
            )?;
            if metadata.downloaded_bytes != expected_size {
                return Err(BootstrapError::Network(format!(
                    "download ended at {} bytes, expected {expected_size}",
                    metadata.downloaded_bytes
                )));
            }
            file.sync_all()
                .map_err(|error| BootstrapError::io(&part_path, error))?;
            let actual = sha256_file(&part_path)?;
            if actual != expected_sha256 {
                reset_resume(&part_path, &metadata_path)?;
                return Err(BootstrapError::HashMismatch {
                    expected: expected_sha256.to_string(),
                    actual,
                });
            }
            fs::rename(&part_path, destination)
                .map_err(|error| BootstrapError::io(destination, error))?;
            remove_if_exists(&metadata_path)?;
            return Ok(if is_resume {
                DownloadOutcome::Resumed
            } else {
                DownloadOutcome::Downloaded
            });
        }
        Err(BootstrapError::Network(
            "server rejected a clean download request".to_string(),
        ))
    }
}

fn stream_response(
    mut response: Response,
    file: &mut File,
    metadata_path: &Path,
    metadata: &mut ResumeMetadataV1,
    should_continue: &mut impl FnMut(u64, u64) -> bool,
) -> Result<()> {
    let mut buffer = [0_u8; 64 * 1024];
    let mut last_checkpoint = metadata.downloaded_bytes;
    loop {
        if !should_continue(metadata.downloaded_bytes, metadata.expected_size) {
            checkpoint(file, metadata_path, metadata)?;
            return Err(BootstrapError::Interrupted {
                downloaded_bytes: metadata.downloaded_bytes,
            });
        }
        let read = response
            .read(&mut buffer)
            .map_err(|error| BootstrapError::Network(error.to_string()))?;
        if read == 0 {
            break;
        }
        let next = metadata
            .downloaded_bytes
            .checked_add(read as u64)
            .ok_or_else(|| BootstrapError::Validation("download size overflow".to_string()))?;
        if next > metadata.expected_size {
            return Err(BootstrapError::Validation(
                "server sent more bytes than the signed component size".to_string(),
            ));
        }
        file.write_all(&buffer[..read])
            .map_err(|error| BootstrapError::io(metadata_path, error))?;
        metadata.downloaded_bytes = next;
        if next.saturating_sub(last_checkpoint) >= CHECKPOINT_BYTES {
            checkpoint(file, metadata_path, metadata)?;
            last_checkpoint = next;
        }
    }
    checkpoint(file, metadata_path, metadata)
}

fn checkpoint(file: &mut File, metadata_path: &Path, metadata: &ResumeMetadataV1) -> Result<()> {
    file.flush()
        .map_err(|error| BootstrapError::io(metadata_path, error))?;
    file.sync_data()
        .map_err(|error| BootstrapError::io(metadata_path, error))?;
    write_json_replace(metadata_path, metadata)
}

fn prepare_resume(
    part_path: &Path,
    metadata_path: &Path,
    url: &str,
    expected_size: u64,
    expected_sha256: &str,
) -> Result<Option<ResumeMetadataV1>> {
    if !part_path.exists() || !metadata_path.exists() {
        reset_resume(part_path, metadata_path)?;
        return Ok(None);
    }
    let bytes =
        fs::read(metadata_path).map_err(|error| BootstrapError::io(metadata_path, error))?;
    let Ok(mut metadata) = serde_json::from_slice::<ResumeMetadataV1>(&bytes) else {
        reset_resume(part_path, metadata_path)?;
        return Ok(None);
    };
    let actual_size = fs::metadata(part_path)
        .map_err(|error| BootstrapError::io(part_path, error))?
        .len();
    if metadata.schema_version != 1
        || metadata.url != url
        || metadata.sha256 != expected_sha256
        || metadata.expected_size != expected_size
        || actual_size == 0
        || actual_size > expected_size
    {
        reset_resume(part_path, metadata_path)?;
        return Ok(None);
    }
    metadata.downloaded_bytes = actual_size;
    Ok(Some(metadata))
}

fn validate_content_range(
    response: &Response,
    expected_start: u64,
    expected_size: u64,
) -> Result<()> {
    let value = response
        .headers()
        .get(CONTENT_RANGE)
        .and_then(|value| value.to_str().ok())
        .ok_or_else(|| {
            BootstrapError::Network("partial response omitted Content-Range".to_string())
        })?;
    let Some(value) = value.strip_prefix("bytes ") else {
        return Err(BootstrapError::Network(
            "invalid Content-Range unit".to_string(),
        ));
    };
    let Some((range, total)) = value.split_once('/') else {
        return Err(BootstrapError::Network(
            "invalid Content-Range value".to_string(),
        ));
    };
    let Some((start, _end)) = range.split_once('-') else {
        return Err(BootstrapError::Network(
            "invalid Content-Range bounds".to_string(),
        ));
    };
    if start.parse::<u64>().ok() != Some(expected_start)
        || total.parse::<u64>().ok() != Some(expected_size)
    {
        return Err(BootstrapError::Network(format!(
            "unexpected Content-Range `{value}`"
        )));
    }
    Ok(())
}

fn validate_content_length(response: &Response, expected: u64) -> Result<()> {
    if let Some(value) = response.headers().get(CONTENT_LENGTH) {
        let actual = value
            .to_str()
            .ok()
            .and_then(|value| value.parse::<u64>().ok())
            .ok_or_else(|| BootstrapError::Network("invalid Content-Length".to_string()))?;
        if actual != expected {
            return Err(BootstrapError::Network(format!(
                "response length {actual} does not match signed size {expected}"
            )));
        }
    }
    Ok(())
}

fn validate_response_url(response: &Response) -> Result<()> {
    if response.url().scheme() != "https" {
        return Err(BootstrapError::Network(
            "request was redirected away from HTTPS".to_string(),
        ));
    }
    Ok(())
}

fn header_text(response: &Response, name: reqwest::header::HeaderName) -> Option<String> {
    response
        .headers()
        .get(name)
        .and_then(|value| value.to_str().ok())
        .map(str::to_string)
}

fn write_json_replace(path: &Path, value: &impl serde::Serialize) -> Result<()> {
    let parent = path
        .parent()
        .ok_or_else(|| BootstrapError::Validation("metadata path has no parent".to_string()))?;
    fs::create_dir_all(parent).map_err(|error| BootstrapError::io(parent, error))?;
    let temp = parent.join(format!(".resume-{}.tmp", Uuid::new_v4()));
    let bytes = serde_json::to_vec(value)
        .map_err(|error| BootstrapError::Json("resume metadata", error))?;
    let mut file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&temp)
        .map_err(|error| BootstrapError::io(&temp, error))?;
    file.write_all(&bytes)
        .map_err(|error| BootstrapError::io(&temp, error))?;
    file.sync_all()
        .map_err(|error| BootstrapError::io(&temp, error))?;
    remove_if_exists(path)?;
    fs::rename(&temp, path).map_err(|error| BootstrapError::io(path, error))
}

fn reset_resume(part_path: &Path, metadata_path: &Path) -> Result<()> {
    remove_if_exists(part_path)?;
    remove_if_exists(metadata_path)
}

fn remove_if_exists(path: &Path) -> Result<()> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(BootstrapError::io(path, error)),
    }
}

fn part_path(destination: &Path) -> PathBuf {
    destination.with_extension("part")
}

fn metadata_path(destination: &Path) -> PathBuf {
    destination.with_extension("resume.json")
}

pub(crate) fn sha256_file(path: &Path) -> Result<String> {
    let mut file = File::open(path).map_err(|error| BootstrapError::io(path, error))?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|error| BootstrapError::io(path, error))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(hex_digest(hasher.finalize().as_slice()))
}

pub(crate) fn verify_sha256_bytes(bytes: &[u8], expected: &str) -> Result<()> {
    validate_sha256(expected)?;
    let actual = hex_digest(Sha256::digest(bytes).as_slice());
    if actual != expected {
        return Err(BootstrapError::HashMismatch {
            expected: expected.to_string(),
            actual,
        });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn resumes_from_interrupted_file_length_and_matching_metadata() {
        let temp = tempdir().expect("tempdir");
        let destination = temp.path().join("component.zip");
        let part = part_path(&destination);
        let metadata = metadata_path(&destination);
        fs::write(&part, b"partial").expect("partial file");
        write_json_replace(
            &metadata,
            &ResumeMetadataV1 {
                schema_version: 1,
                url: "https://example.com/component.zip".to_string(),
                sha256: "a".repeat(64),
                expected_size: 100,
                downloaded_bytes: 3,
                etag: Some("etag".to_string()),
                last_modified: None,
            },
        )
        .expect("metadata");

        let state = prepare_resume(
            &part,
            &metadata,
            "https://example.com/component.zip",
            100,
            &"a".repeat(64),
        )
        .expect("resume state")
        .expect("resumable");
        assert_eq!(state.downloaded_bytes, 7);
        assert_eq!(state.etag.as_deref(), Some("etag"));
    }

    #[test]
    fn reports_hash_mismatch() {
        let result = verify_sha256_bytes(b"wrong", &"0".repeat(64));
        assert!(matches!(result, Err(BootstrapError::HashMismatch { .. })));
    }
}
