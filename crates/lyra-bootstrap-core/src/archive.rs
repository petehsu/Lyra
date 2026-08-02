use std::collections::HashSet;
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Component, Path, PathBuf};

use sha2::{Digest, Sha256};
use zip::ZipArchive;

use crate::model::InstalledFileV1;
use crate::{BootstrapError, Result};

pub(crate) const INSTALLED_MARKER: &str = ".lyra-component.v1.json";

#[derive(Clone, Copy, Debug)]
pub struct ExtractionLimits {
    pub max_entries: usize,
    pub max_uncompressed_bytes: u64,
    pub max_compression_ratio: u64,
}

impl Default for ExtractionLimits {
    fn default() -> Self {
        Self {
            max_entries: 100_000,
            max_uncompressed_bytes: 16 * 1024 * 1024 * 1024,
            max_compression_ratio: 500,
        }
    }
}

pub(crate) fn verified_inventory(
    archive_path: &Path,
    expected_sha256: &str,
    limits: ExtractionLimits,
) -> Result<Vec<InstalledFileV1>> {
    with_verified_archive(archive_path, expected_sha256, |archive| {
        process_archive(archive, None, limits)
    })
}

pub(crate) fn extract_verified(
    archive_path: &Path,
    expected_sha256: &str,
    destination: &Path,
    limits: ExtractionLimits,
) -> Result<Vec<InstalledFileV1>> {
    fs::create_dir_all(destination).map_err(|error| BootstrapError::io(destination, error))?;
    with_verified_archive(archive_path, expected_sha256, |archive| {
        process_archive(archive, Some(destination), limits)
    })
}

pub(crate) fn read_verified_entry(
    archive_path: &Path,
    expected_sha256: &str,
    entry_path: &str,
    max_bytes: u64,
) -> Result<Vec<u8>> {
    validate_relative_path(entry_path)?;
    with_verified_archive(archive_path, expected_sha256, |archive| {
        let mut entry = archive
            .by_name(entry_path)
            .map_err(|error| BootstrapError::Archive(error.to_string()))?;
        let relative = validate_archive_entry(&entry)?;
        if relative_to_slashes(&relative)? != entry_path
            || entry.is_dir()
            || entry.size() > max_bytes
        {
            return Err(BootstrapError::Archive(format!(
                "archive entry `{entry_path}` is missing, not a file, or too large"
            )));
        }
        let mut bytes = Vec::with_capacity(entry.size() as usize);
        entry
            .by_ref()
            .take(max_bytes.saturating_add(1))
            .read_to_end(&mut bytes)
            .map_err(|error| BootstrapError::Archive(error.to_string()))?;
        if bytes.len() as u64 > max_bytes || bytes.len() as u64 != entry.size() {
            return Err(BootstrapError::Archive(format!(
                "archive entry `{entry_path}` changed size while reading"
            )));
        }
        Ok(bytes)
    })
}

fn with_verified_archive<T>(
    archive_path: &Path,
    expected_sha256: &str,
    operation: impl FnOnce(&mut ZipArchive<File>) -> Result<T>,
) -> Result<T> {
    let mut file =
        File::open(archive_path).map_err(|error| BootstrapError::io(archive_path, error))?;
    let actual = hash_reader(&mut file)?;
    if actual != expected_sha256 {
        return Err(BootstrapError::HashMismatch {
            expected: expected_sha256.to_string(),
            actual,
        });
    }
    file.seek(SeekFrom::Start(0))
        .map_err(|error| BootstrapError::io(archive_path, error))?;
    let mut archive =
        ZipArchive::new(file).map_err(|error| BootstrapError::Archive(error.to_string()))?;
    operation(&mut archive)
}

fn process_archive(
    archive: &mut ZipArchive<File>,
    destination: Option<&Path>,
    limits: ExtractionLimits,
) -> Result<Vec<InstalledFileV1>> {
    if archive.is_empty() || archive.len() > limits.max_entries {
        return Err(BootstrapError::Archive(format!(
            "archive entry count {} is outside the allowed range 1..={}",
            archive.len(),
            limits.max_entries
        )));
    }
    let mut total_size = 0_u64;
    let mut paths = HashSet::new();
    let mut case_folded_paths = HashSet::new();
    let mut inventory = Vec::new();

    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|error| BootstrapError::Archive(error.to_string()))?;
        let relative = validate_archive_entry(&entry)?;
        let relative_text = relative_to_slashes(&relative)?;
        if relative_text == INSTALLED_MARKER {
            return Err(BootstrapError::Archive(format!(
                "archive uses reserved path `{INSTALLED_MARKER}`"
            )));
        }
        if !paths.insert(relative_text.clone())
            || !case_folded_paths.insert(relative_text.to_lowercase())
        {
            return Err(BootstrapError::Archive(format!(
                "archive contains duplicate path `{relative_text}`"
            )));
        }

        let size = entry.size();
        total_size = total_size
            .checked_add(size)
            .ok_or_else(|| BootstrapError::Archive("archive size overflow".to_string()))?;
        if total_size > limits.max_uncompressed_bytes {
            return Err(BootstrapError::Archive(format!(
                "archive expands beyond {} bytes",
                limits.max_uncompressed_bytes
            )));
        }
        if !entry.is_dir()
            && size > 1024 * 1024
            && (entry.compressed_size() == 0
                || size / entry.compressed_size().max(1) > limits.max_compression_ratio)
        {
            return Err(BootstrapError::Archive(format!(
                "entry `{relative_text}` exceeds the allowed compression ratio"
            )));
        }

        let Some(root) = destination else {
            if entry.is_dir() {
                continue;
            }
            let (sha256, copied) = hash_entry(&mut entry)?;
            if copied != size {
                return Err(BootstrapError::Archive(format!(
                    "entry `{relative_text}` size changed while reading"
                )));
            }
            inventory.push(InstalledFileV1 {
                path: relative_text,
                size,
                sha256,
                unix_mode: safe_unix_mode(&entry),
            });
            continue;
        };

        let output_path = root.join(&relative);
        if entry.is_dir() {
            fs::create_dir_all(&output_path)
                .map_err(|error| BootstrapError::io(&output_path, error))?;
            continue;
        }
        if let Some(parent) = output_path.parent() {
            fs::create_dir_all(parent).map_err(|error| BootstrapError::io(parent, error))?;
        }
        let mut output = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&output_path)
            .map_err(|error| BootstrapError::io(&output_path, error))?;
        let mut hasher = Sha256::new();
        let copied = copy_hashed(&mut entry, &mut output, &mut hasher)?;
        if copied != size {
            return Err(BootstrapError::Archive(format!(
                "entry `{relative_text}` size changed while extracting"
            )));
        }
        output
            .sync_all()
            .map_err(|error| BootstrapError::io(&output_path, error))?;
        let unix_mode = safe_unix_mode(&entry);
        apply_unix_mode(&output_path, unix_mode)?;
        inventory.push(InstalledFileV1 {
            path: relative_text,
            size,
            sha256: hex_digest(hasher.finalize().as_slice()),
            unix_mode,
        });
    }
    inventory.sort_by(|left, right| left.path.cmp(&right.path));
    if inventory.is_empty() {
        return Err(BootstrapError::Archive(
            "archive contains no regular files".to_string(),
        ));
    }
    Ok(inventory)
}

fn validate_archive_entry(entry: &zip::read::ZipFile<'_>) -> Result<PathBuf> {
    let name = entry.name();
    if name.contains('\\') || name.starts_with('/') {
        return Err(BootstrapError::Archive(format!(
            "unsafe archive path `{name}`"
        )));
    }
    let trimmed = name.trim_end_matches('/');
    if trimmed.is_empty()
        || trimmed.split('/').any(str::is_empty)
        || entry.enclosed_name().is_none()
    {
        return Err(BootstrapError::Archive(format!(
            "unsafe archive path `{name}`"
        )));
    }
    validate_relative_path(trimmed)?;
    if entry.is_symlink() || has_unsafe_unix_type(entry.unix_mode(), entry.is_dir()) {
        return Err(BootstrapError::Archive(format!(
            "links and special files are forbidden: `{name}`"
        )));
    }
    Ok(PathBuf::from(trimmed))
}

pub(crate) fn validate_relative_path(value: &str) -> Result<()> {
    let path = Path::new(value);
    if value.is_empty() || value.contains('\\') || path.is_absolute() {
        return Err(BootstrapError::Validation(format!(
            "unsafe relative path `{value}`"
        )));
    }
    for component in path.components() {
        let Component::Normal(segment) = component else {
            return Err(BootstrapError::Validation(format!(
                "unsafe relative path `{value}`"
            )));
        };
        let segment = segment.to_str().ok_or_else(|| {
            BootstrapError::Validation("component path is not valid UTF-8".to_string())
        })?;
        validate_path_segment(segment)?;
    }
    Ok(())
}

fn validate_path_segment(segment: &str) -> Result<()> {
    if segment.is_empty()
        || segment.ends_with('.')
        || segment.ends_with(' ')
        || segment.chars().any(|character| {
            character.is_control() || matches!(character, '<' | '>' | ':' | '"' | '|' | '?' | '*')
        })
    {
        return Err(BootstrapError::Validation(format!(
            "unsafe path segment `{segment}`"
        )));
    }
    let stem = segment
        .split('.')
        .next()
        .unwrap_or(segment)
        .to_ascii_uppercase();
    if matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || (stem.len() == 4
            && (stem.starts_with("COM") || stem.starts_with("LPT"))
            && matches!(stem.as_bytes()[3], b'1'..=b'9'))
    {
        return Err(BootstrapError::Validation(format!(
            "reserved path segment `{segment}`"
        )));
    }
    Ok(())
}

fn has_unsafe_unix_type(mode: Option<u32>, is_dir: bool) -> bool {
    let Some(mode) = mode else {
        return false;
    };
    let file_type = mode & 0o170_000;
    file_type != 0 && file_type != if is_dir { 0o040_000 } else { 0o100_000 }
}

fn safe_unix_mode(entry: &zip::read::ZipFile<'_>) -> Option<u32> {
    entry.unix_mode().map(|mode| mode & 0o777)
}

#[cfg(unix)]
fn apply_unix_mode(path: &Path, mode: Option<u32>) -> Result<()> {
    use std::os::unix::fs::PermissionsExt;

    if let Some(mode) = mode {
        fs::set_permissions(path, fs::Permissions::from_mode(mode))
            .map_err(|error| BootstrapError::io(path, error))?;
    }
    Ok(())
}

#[cfg(not(unix))]
fn apply_unix_mode(_path: &Path, _mode: Option<u32>) -> Result<()> {
    Ok(())
}

fn hash_entry(entry: &mut impl Read) -> Result<(String, u64)> {
    let mut sink = std::io::sink();
    let mut hasher = Sha256::new();
    let copied = copy_hashed(entry, &mut sink, &mut hasher)?;
    Ok((hex_digest(hasher.finalize().as_slice()), copied))
}

fn copy_hashed(
    reader: &mut impl Read,
    writer: &mut impl Write,
    hasher: &mut Sha256,
) -> Result<u64> {
    let mut buffer = [0_u8; 64 * 1024];
    let mut total = 0_u64;
    loop {
        let read = reader
            .read(&mut buffer)
            .map_err(|error| BootstrapError::Archive(error.to_string()))?;
        if read == 0 {
            break;
        }
        writer
            .write_all(&buffer[..read])
            .map_err(|error| BootstrapError::Archive(error.to_string()))?;
        hasher.update(&buffer[..read]);
        total = total
            .checked_add(read as u64)
            .ok_or_else(|| BootstrapError::Archive("entry size overflow".to_string()))?;
    }
    Ok(total)
}

fn hash_reader(reader: &mut impl Read) -> Result<String> {
    let mut sink = std::io::sink();
    let mut hasher = Sha256::new();
    copy_hashed(reader, &mut sink, &mut hasher)?;
    Ok(hex_digest(hasher.finalize().as_slice()))
}

fn relative_to_slashes(path: &Path) -> Result<String> {
    path.components()
        .map(|component| match component {
            Component::Normal(value) => value.to_str().map(str::to_string).ok_or_else(|| {
                BootstrapError::Archive("archive path is not valid UTF-8".to_string())
            }),
            _ => Err(BootstrapError::Archive(
                "archive path is not relative".to_string(),
            )),
        })
        .collect::<Result<Vec<_>>>()
        .map(|parts| parts.join("/"))
}

pub(crate) fn hex_digest(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut output = String::with_capacity(bytes.len() * 2);
    for &byte in bytes {
        output.push(HEX[(byte >> 4) as usize] as char);
        output.push(HEX[(byte & 0x0f) as usize] as char);
    }
    output
}

#[cfg(test)]
mod tests {
    use std::io::Write;

    use tempfile::tempdir;
    use zip::write::SimpleFileOptions;

    use super::*;

    #[test]
    fn rejects_parent_traversal() {
        let temp = tempdir().expect("tempdir");
        let archive_path = temp.path().join("bad.zip");
        let file = File::create(&archive_path).expect("archive file");
        let mut archive = zip::ZipWriter::new(file);
        archive
            .start_file("../outside", SimpleFileOptions::default())
            .expect("start entry");
        archive.write_all(b"bad").expect("write entry");
        archive.finish().expect("finish archive");

        let hash = crate::download::sha256_file(&archive_path).expect("archive hash");
        let result = verified_inventory(&archive_path, &hash, ExtractionLimits::default());
        assert!(matches!(result, Err(BootstrapError::Archive(_))));
        assert!(!temp.path().join("outside").exists());
    }
}
