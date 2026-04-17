use ignore::WalkBuilder;
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

const SKIPPED_DIRECTORIES: [&str; 8] = [
    ".git",
    "node_modules",
    "dist",
    "build",
    "target",
    ".cache",
    "coverage",
    ".turbo",
];

#[derive(Debug, Clone)]
pub struct ScannedFile {
    pub path: PathBuf,
    pub relative_path: String,
    pub file_name: String,
    pub extension: Option<String>,
    pub modified_at: u64,
    pub size_bytes: u64,
}

#[derive(Debug, Clone, Default)]
pub struct ScanSummary {
    pub files: Vec<ScannedFile>,
    pub scanned_files: u64,
    pub scanned_dirs: u64,
    pub skipped_unreadable: u64,
    pub truncated: bool,
}

pub fn scan_workspace(
    roots: &[PathBuf],
    include_hidden: bool,
    max_files: usize,
) -> Result<ScanSummary, String> {
    let Some(primary_root) = roots.first() else {
        return Err("roots are required".to_string());
    };

    let mut builder = WalkBuilder::new(primary_root);
    for root in roots.iter().skip(1) {
        builder.add(root);
    }

    builder
        .hidden(!include_hidden)
        .follow_links(false)
        .ignore(true)
        .git_ignore(true)
        .git_exclude(true)
        .git_global(true)
        .parents(true)
        .require_git(true);

    let walker = builder.build();
    let skipped_dirs: HashSet<&str> = HashSet::from(SKIPPED_DIRECTORIES);
    let mut summary = ScanSummary::default();

    for entry_result in walker {
        let entry = match entry_result {
            Ok(value) => value,
            Err(_) => {
                summary.skipped_unreadable = summary.skipped_unreadable.saturating_add(1);
                continue;
            }
        };

        let file_type = match entry.file_type() {
            Some(value) => value,
            None => {
                summary.skipped_unreadable = summary.skipped_unreadable.saturating_add(1);
                continue;
            }
        };

        let path = entry.path();
        if contains_skipped_directory(path, &skipped_dirs) {
            continue;
        }

        if file_type.is_dir() {
            summary.scanned_dirs = summary.scanned_dirs.saturating_add(1);
            continue;
        }
        if file_type.is_file() == false {
            continue;
        }

        summary.scanned_files = summary.scanned_files.saturating_add(1);
        if summary.files.len() >= max_files {
            summary.truncated = true;
            continue;
        }

        let metadata = match fs::metadata(path) {
            Ok(value) => value,
            Err(_) => {
                summary.skipped_unreadable = summary.skipped_unreadable.saturating_add(1);
                continue;
            }
        };

        let relative = relative_to_roots(path, roots).unwrap_or_else(|| normalize_path(path));
        let file_name = path
            .file_name()
            .map(|value| value.to_string_lossy().to_string())
            .unwrap_or_else(|| relative.clone());
        let extension = path
            .extension()
            .and_then(|value| value.to_str())
            .map(|value| value.to_lowercase());
        let modified_at = metadata
            .modified()
            .ok()
            .and_then(|value| value.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|value| value.as_secs())
            .unwrap_or(0);

        summary.files.push(ScannedFile {
            path: path.to_path_buf(),
            relative_path: relative,
            file_name,
            extension,
            modified_at,
            size_bytes: metadata.len(),
        });
    }

    Ok(summary)
}

pub fn read_text_file(path: &Path, max_bytes: u64) -> Option<String> {
    let metadata = fs::metadata(path).ok()?;
    if metadata.len() > max_bytes {
        return None;
    }

    let bytes = fs::read(path).ok()?;
    if bytes.contains(&0) {
        return None;
    }

    String::from_utf8(bytes).ok()
}

pub fn normalize_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn relative_to_roots(path: &Path, roots: &[PathBuf]) -> Option<String> {
    let mut best: Option<&Path> = None;
    for root in roots {
        let Ok(relative) = path.strip_prefix(root) else {
            continue;
        };
        match best {
            Some(current) if current.components().count() <= relative.components().count() => {}
            _ => best = Some(relative),
        }
    }
    best.map(|relative| normalize_path(relative))
}

fn contains_skipped_directory(path: &Path, skipped: &HashSet<&str>) -> bool {
    path.components().any(|component| {
        let value = component.as_os_str().to_string_lossy();
        skipped.contains(value.as_ref())
    })
}
