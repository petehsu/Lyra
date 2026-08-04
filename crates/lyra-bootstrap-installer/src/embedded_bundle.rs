use std::collections::HashSet;
use std::fs::{self, OpenOptions};
use std::io::{Cursor, Read, Write};
use std::path::{Component, Path, PathBuf};

use sha2::{Digest, Sha256};
#[cfg(unix)]
use std::fs::File;
use uuid::Uuid;
use zip::ZipArchive;

const MAX_OFFLINE_ENTRIES: usize = 4_096;
const MAX_OFFLINE_EXPANDED_BYTES: u64 = 16 * 1024 * 1024 * 1024;
const MAX_CATALOG_BYTES: u64 = 2 * 1024 * 1024;
const MAX_BOM_BYTES: u64 = 4 * 1024 * 1024;
const MAX_COMPONENT_ARCHIVE_BYTES: u64 = 4 * 1024 * 1024 * 1024;
const DIGEST_MARKER: &str = ".lyra-offline-bundle.sha256";

#[cfg(lyra_embedded_offline_bundle)]
const EMBEDDED_BUNDLE: &[u8] = include_bytes!(env!("LYRA_INSTALLER_OFFLINE_BUNDLE_PATH"));

#[cfg(not(lyra_embedded_offline_bundle))]
const EMBEDDED_BUNDLE: &[u8] = &[];

pub fn materialize_embedded_offline_bundle(state_root: &Path) -> Result<Option<PathBuf>, String> {
    if EMBEDDED_BUNDLE.is_empty() {
        return Ok(None);
    }
    let digest = format!("{:x}", Sha256::digest(EMBEDDED_BUNDLE));
    let cache_root = state_root.join("offline-bundles-v1");
    let final_root = cache_root.join(&digest);
    if cached_bundle_matches(&final_root, &digest) {
        return Ok(Some(final_root));
    }
    fs::create_dir_all(&cache_root)
        .map_err(|error| format!("Cannot create offline bundle cache: {error}"))?;
    let stage = cache_root.join(format!(".{digest}.stage-{}", Uuid::new_v4()));
    fs::create_dir(&stage).map_err(|error| format!("Cannot stage the offline bundle: {error}"))?;
    let extraction = extract_bundle(EMBEDDED_BUNDLE, &stage, &digest);
    if let Err(error) = extraction {
        let _ = fs::remove_dir_all(&stage);
        return Err(error);
    }
    if final_root.exists() {
        fs::remove_dir_all(&final_root)
            .map_err(|error| format!("Cannot replace the offline bundle cache: {error}"))?;
    }
    fs::rename(&stage, &final_root)
        .map_err(|error| format!("Cannot activate the offline bundle cache: {error}"))?;
    sync_directory(&cache_root)?;
    Ok(Some(final_root))
}

fn cached_bundle_matches(root: &Path, digest: &str) -> bool {
    root.is_dir()
        && root.join("catalog.json").is_file()
        && fs::read_to_string(root.join(DIGEST_MARKER)).is_ok_and(|value| value.trim() == digest)
}

fn extract_bundle(bytes: &[u8], destination: &Path, digest: &str) -> Result<(), String> {
    let mut archive = ZipArchive::new(Cursor::new(bytes))
        .map_err(|error| format!("Embedded offline bundle is not a ZIP archive: {error}"))?;
    if archive.len() == 0 || archive.len() > MAX_OFFLINE_ENTRIES {
        return Err("Embedded offline bundle has an invalid entry count.".to_string());
    }
    let mut names = HashSet::new();
    let mut expanded_bytes = 0_u64;
    let mut catalog_seen = false;
    let mut bom_seen = false;
    let mut component_seen = false;
    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|error| format!("Cannot read embedded offline bundle entry: {error}"))?;
        let relative = validate_entry(&entry)?;
        if !names.insert(relative.clone()) {
            return Err(format!(
                "Embedded offline bundle repeats {}.",
                relative.display()
            ));
        }
        if entry.is_dir() {
            fs::create_dir_all(destination.join(&relative))
                .map_err(|error| format!("Cannot create offline bundle directory: {error}"))?;
            continue;
        }
        let entry_size = entry.size();
        expanded_bytes = expanded_bytes
            .checked_add(entry_size)
            .ok_or_else(|| "Embedded offline bundle size overflow.".to_string())?;
        if expanded_bytes > MAX_OFFLINE_EXPANDED_BYTES {
            return Err("Embedded offline bundle expands beyond the safety limit.".to_string());
        }
        match classify_entry(&relative, entry_size)? {
            OfflineEntry::Catalog => catalog_seen = true,
            OfflineEntry::Bom => bom_seen = true,
            OfflineEntry::Component => component_seen = true,
        }
        let output = destination.join(&relative);
        if let Some(parent) = output.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("Cannot create offline bundle directory: {error}"))?;
        }
        let mut file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&output)
            .map_err(|error| format!("Cannot create offline bundle file: {error}"))?;
        copy_bounded(&mut entry, &mut file, entry_size)?;
        file.sync_all()
            .map_err(|error| format!("Cannot persist offline bundle file: {error}"))?;
    }
    if !catalog_seen || !bom_seen || !component_seen {
        return Err(
            "Embedded offline bundle must contain catalog.json, a BOM, and component archives."
                .to_string(),
        );
    }
    let marker_path = destination.join(DIGEST_MARKER);
    let mut marker = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&marker_path)
        .map_err(|error| format!("Cannot create offline bundle marker: {error}"))?;
    writeln!(marker, "{digest}")
        .map_err(|error| format!("Cannot write offline bundle marker: {error}"))?;
    marker
        .sync_all()
        .map_err(|error| format!("Cannot persist offline bundle marker: {error}"))?;
    sync_directory(destination)
}

fn validate_entry(entry: &zip::read::ZipFile<'_>) -> Result<PathBuf, String> {
    if entry.name().contains('\\') || entry.name().as_bytes().contains(&0) {
        return Err("Embedded offline bundle contains an unsafe path.".to_string());
    }
    let path = Path::new(entry.name());
    if path.is_absolute()
        || path
            .components()
            .any(|part| !matches!(part, Component::Normal(_)))
    {
        return Err("Embedded offline bundle contains an unsafe path.".to_string());
    }
    if entry
        .unix_mode()
        .is_some_and(|mode| mode & 0o170000 == 0o120000)
    {
        return Err("Embedded offline bundle cannot contain symbolic links.".to_string());
    }
    Ok(path.to_path_buf())
}

enum OfflineEntry {
    Catalog,
    Bom,
    Component,
}

fn classify_entry(path: &Path, size: u64) -> Result<OfflineEntry, String> {
    let text = path
        .to_str()
        .ok_or_else(|| "Embedded offline bundle path is not UTF-8.".to_string())?;
    if text == "catalog.json" && size > 0 && size <= MAX_CATALOG_BYTES {
        return Ok(OfflineEntry::Catalog);
    }
    if let Some(name) = text
        .strip_prefix("boms/")
        .and_then(|value| value.strip_suffix(".json"))
        && valid_digest(name)
        && size > 0
        && size <= MAX_BOM_BYTES
    {
        return Ok(OfflineEntry::Bom);
    }
    if let Some(name) = text
        .strip_prefix("components/")
        .and_then(|value| value.strip_suffix(".zip"))
        && valid_digest(name)
        && size > 0
        && size <= MAX_COMPONENT_ARCHIVE_BYTES
    {
        return Ok(OfflineEntry::Component);
    }
    Err(format!(
        "Embedded offline bundle contains an unexpected file: {}",
        path.display()
    ))
}

fn valid_digest(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn copy_bounded(
    input: &mut impl Read,
    output: &mut impl Write,
    expected_size: u64,
) -> Result<(), String> {
    let copied = std::io::copy(&mut input.take(expected_size.saturating_add(1)), output)
        .map_err(|error| format!("Cannot extract offline bundle file: {error}"))?;
    if copied != expected_size {
        return Err("Embedded offline bundle entry size changed during extraction.".to_string());
    }
    Ok(())
}

#[cfg(unix)]
fn sync_directory(directory: &Path) -> Result<(), String> {
    File::open(directory)
        .and_then(|file| file.sync_all())
        .map_err(|error| format!("Cannot persist offline bundle directory: {error}"))
}

#[cfg(not(unix))]
fn sync_directory(_directory: &Path) -> Result<(), String> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::io::Cursor;

    use tempfile::tempdir;
    use zip::ZipWriter;
    use zip::write::SimpleFileOptions;

    use super::*;

    fn archive(entries: &[(&str, &[u8])]) -> Vec<u8> {
        let mut output = Cursor::new(Vec::new());
        {
            let mut zip = ZipWriter::new(&mut output);
            for (name, contents) in entries {
                zip.start_file(name, SimpleFileOptions::default())
                    .expect("start file");
                zip.write_all(contents).expect("write file");
            }
            zip.finish().expect("finish ZIP");
        }
        output.into_inner()
    }

    #[test]
    fn accepts_only_content_addressed_offline_files() {
        assert!(matches!(
            classify_entry(Path::new("catalog.json"), 1),
            Ok(OfflineEntry::Catalog)
        ));
        assert!(matches!(
            classify_entry(Path::new(&format!("boms/{}.json", "a".repeat(64))), 1),
            Ok(OfflineEntry::Bom)
        ));
        assert!(classify_entry(Path::new("components/latest.zip"), 1).is_err());
        assert!(classify_entry(Path::new("README.txt"), 1).is_err());
    }

    #[test]
    fn extracts_a_bounded_content_addressed_bundle() {
        let bom = format!("boms/{}.json", "a".repeat(64));
        let component = format!("components/{}.zip", "b".repeat(64));
        let bytes = archive(&[("catalog.json", b"{}"), (&bom, b"{}"), (&component, b"zip")]);
        let temp = tempdir().expect("temporary directory");
        extract_bundle(&bytes, temp.path(), &"c".repeat(64)).expect("extract bundle");
        assert_eq!(
            fs::read(temp.path().join(component)).expect("component"),
            b"zip"
        );
        assert_eq!(
            fs::read_to_string(temp.path().join(DIGEST_MARKER))
                .expect("digest marker")
                .trim(),
            "c".repeat(64)
        );
    }

    #[test]
    fn rejects_an_unexpected_or_traversing_bundle_entry() {
        let unexpected = archive(&[("README.txt", b"not signed")]);
        let temp = tempdir().expect("temporary directory");
        assert!(extract_bundle(&unexpected, temp.path(), &"d".repeat(64)).is_err());

        let traversal = archive(&[("../catalog.json", b"{}")]);
        let other = tempdir().expect("temporary directory");
        assert!(extract_bundle(&traversal, other.path(), &"e".repeat(64)).is_err());
    }
}
