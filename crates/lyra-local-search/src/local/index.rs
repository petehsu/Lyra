use super::model::*;
use super::storage::{system_time_to_unix_seconds, unix_seconds_now};
use crate::native;
use glob::Pattern;
use ignore::{DirEntry, WalkBuilder};
use std::collections::HashSet;
use std::fs;
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

pub(super) fn collect_root_entries(
    root: &Path,
    options: &LocalSearchIndexRootOptions,
    cancel_flag: &AtomicBool,
) -> anyhow::Result<CollectedRoot> {
    collect_path_entries(root, root, options, cancel_flag)
}

pub(super) fn collect_path_entries(
    root: &Path,
    path: &Path,
    options: &LocalSearchIndexRootOptions,
    cancel_flag: &AtomicBool,
) -> anyhow::Result<CollectedRoot> {
    let root = normalize_existing_root(root)?;
    let path = if path.exists() {
        normalize_existing_root(path)?
    } else {
        path.to_path_buf()
    };
    let mut collected = CollectedRoot {
        root: root.clone(),
        entries: Vec::new(),
        file_count: 0,
        dir_count: 0,
        content_file_count: 0,
        content_bytes_indexed: 0,
        skipped: LocalSearchSkippedStats::default(),
        truncated: false,
    };
    let mut content_budget_remaining = options.content_budget_bytes;

    if path.is_file() {
        let exclude_globs = compiled_glob_patterns(&options.exclude_globs);
        collect_single_entry(
            &path,
            &root,
            options,
            &exclude_globs,
            &mut content_budget_remaining,
            &mut collected,
        )?;
        return Ok(collected);
    }

    if !path.is_dir() {
        return Ok(collected);
    }

    let mut builder = WalkBuilder::new(&path);
    builder
        .hidden(!options.include_hidden)
        .follow_links(options.follow_symlinks)
        .require_git(true);
    if !options.respect_gitignore {
        builder
            .git_ignore(false)
            .git_global(false)
            .git_exclude(false)
            .ignore(false)
            .parents(false);
    }
    let exclude_globs = compiled_glob_patterns(&options.exclude_globs);
    let filter_root = root.clone();
    let filter_options = options.clone();
    let filter_exclude_globs = compiled_glob_patterns(&filter_options.exclude_globs);
    builder.filter_entry(move |entry| {
        walk_entry_allowed(entry, &filter_root, &filter_options, &filter_exclude_globs)
    });
    for entry in builder.build() {
        if cancel_flag.load(Ordering::Relaxed) {
            break;
        }
        let entry = match entry {
            Ok(entry) => entry,
            Err(_) => {
                collected.skipped.unreadable = collected.skipped.unreadable.saturating_add(1);
                continue;
            }
        };
        let entry_path = entry.path();
        if entry_path == root {
            continue;
        }
        let relative = relative_display_path(entry_path, &root);
        if !options.include_hidden && path_has_hidden_component(&relative) {
            collected.skipped.hidden = collected.skipped.hidden.saturating_add(1);
            continue;
        }
        if !options.include_vendor
            && path_has_excluded_dir_component(&relative, &options.exclude_dirs)
        {
            collected.skipped.vendor = collected.skipped.vendor.saturating_add(1);
            continue;
        }
        if path_matches_any_glob(&exclude_globs, &relative) {
            collected.skipped.vendor = collected.skipped.vendor.saturating_add(1);
            continue;
        }
        collect_single_entry(
            entry_path,
            &root,
            options,
            &exclude_globs,
            &mut content_budget_remaining,
            &mut collected,
        )?;
    }
    Ok(collected)
}

pub(super) fn collect_single_entry(
    path: &Path,
    root: &Path,
    options: &LocalSearchIndexRootOptions,
    exclude_globs: &[Pattern],
    content_budget_remaining: &mut u64,
    collected: &mut CollectedRoot,
) -> anyhow::Result<()> {
    match indexed_entry_for_path(
        path,
        root,
        options,
        exclude_globs,
        content_budget_remaining,
        &mut collected.skipped,
    ) {
        Ok(Some(entry)) => {
            match entry.kind {
                LocalSearchKind::File => collected.file_count += 1,
                LocalSearchKind::Directory => collected.dir_count += 1,
            }
            if entry.content_indexed {
                collected.content_file_count += 1;
                collected.content_bytes_indexed = collected.content_bytes_indexed.saturating_add(
                    entry
                        .content_text
                        .as_ref()
                        .map(|text| text.len() as u64)
                        .unwrap_or(0),
                );
            }
            collected.entries.push(entry);
        }
        Ok(None) => {}
        Err(_) => {
            collected.skipped.unreadable = collected.skipped.unreadable.saturating_add(1);
        }
    }
    Ok(())
}

pub(super) fn indexed_entry_for_path(
    path: &Path,
    root: &Path,
    options: &LocalSearchIndexRootOptions,
    exclude_globs: &[Pattern],
    content_budget_remaining: &mut u64,
    skipped: &mut LocalSearchSkippedStats,
) -> anyhow::Result<Option<IndexedEntry>> {
    let metadata = match fs::metadata(path) {
        Ok(metadata) => metadata,
        Err(_) => {
            skipped.unreadable = skipped.unreadable.saturating_add(1);
            return Ok(None);
        }
    };
    let kind = if metadata.is_dir() {
        LocalSearchKind::Directory
    } else if metadata.is_file() {
        LocalSearchKind::File
    } else {
        return Ok(None);
    };
    let relative_path = relative_display_path(path, root);
    let display_path = normalize_path_for_display(&relative_path);
    if display_path.is_empty() {
        return Ok(None);
    }
    let hidden = path_has_hidden_component(&relative_path);
    if hidden && !options.include_hidden {
        skipped.hidden = skipped.hidden.saturating_add(1);
        return Ok(None);
    }
    let vendor = path_has_excluded_dir_component(&relative_path, &options.exclude_dirs);
    if vendor && !options.include_vendor {
        skipped.vendor = skipped.vendor.saturating_add(1);
        return Ok(None);
    }
    if path_matches_any_glob(exclude_globs, &relative_path) {
        skipped.vendor = skipped.vendor.saturating_add(1);
        return Ok(None);
    }
    let extension = normalized_extension(path);
    let (content_indexed, content_text) = extract_indexable_text(
        path,
        kind,
        extension.as_deref(),
        &options.text_extensions,
        metadata.len(),
        options.content_mode,
        options.max_file_size_bytes,
        content_budget_remaining,
        skipped,
    )?;
    let lower_path = display_path.to_lowercase();
    let lower_file_name = path
        .file_name()
        .map(|name| name.to_string_lossy().to_lowercase())
        .unwrap_or_else(|| lower_path.clone());
    Ok(Some(IndexedEntry {
        root: root.to_path_buf(),
        relative_path,
        full_path: path.to_path_buf(),
        display_path,
        kind,
        extension,
        lower_file_name,
        lower_path,
        size_bytes: metadata.len(),
        modified_at: metadata
            .modified()
            .ok()
            .and_then(system_time_to_unix_seconds),
        created_at: metadata
            .created()
            .ok()
            .and_then(system_time_to_unix_seconds),
        hidden,
        vendor,
        content_indexed,
        content_text,
    }))
}

pub(super) fn extract_indexable_text(
    path: &Path,
    kind: LocalSearchKind,
    extension: Option<&str>,
    text_extensions: &[String],
    size_bytes: u64,
    mode: LocalSearchContentMode,
    max_file_size_bytes: u64,
    content_budget_remaining: &mut u64,
    skipped: &mut LocalSearchSkippedStats,
) -> anyhow::Result<(bool, Option<String>)> {
    if kind != LocalSearchKind::File || mode == LocalSearchContentMode::Disabled {
        return Ok((false, None));
    }
    if !extension
        .map(|extension| {
            text_extensions
                .iter()
                .any(|item| extension.eq_ignore_ascii_case(item))
        })
        .unwrap_or(false)
    {
        return Ok((false, None));
    }
    if size_bytes > max_file_size_bytes {
        skipped.binary_or_too_large = skipped.binary_or_too_large.saturating_add(1);
        return Ok((false, None));
    }
    if size_bytes > *content_budget_remaining {
        skipped.content_budget = skipped.content_budget.saturating_add(1);
        return Ok((false, None));
    }
    let mut bytes = Vec::new();
    fs::File::open(path)?
        .take(max_file_size_bytes.saturating_add(1))
        .read_to_end(&mut bytes)?;
    if !native::is_probably_text(&bytes) {
        skipped.binary_or_too_large = skipped.binary_or_too_large.saturating_add(1);
        return Ok((false, None));
    }
    if bytes.len() as u64 > max_file_size_bytes {
        skipped.binary_or_too_large = skipped.binary_or_too_large.saturating_add(1);
        return Ok((false, None));
    }
    *content_budget_remaining = (*content_budget_remaining).saturating_sub(bytes.len() as u64);
    Ok((true, Some(String::from_utf8_lossy(&bytes).to_string())))
}

pub(super) fn normalize_search_roots(roots: &[PathBuf]) -> anyhow::Result<Vec<PathBuf>> {
    let mut seen = HashSet::new();
    let mut normalized = Vec::new();
    for root in roots {
        let candidate = normalize_existing_root(root)?;
        if seen.insert(normalize_path_for_display(&candidate)) {
            normalized.push(candidate);
        }
    }
    Ok(normalized)
}

pub(super) fn normalize_change_paths(
    root: &Path,
    paths: &[PathBuf],
) -> anyhow::Result<Vec<PathBuf>> {
    let mut seen = HashSet::new();
    let mut normalized = Vec::new();
    for path in paths {
        let candidate = if path.is_absolute() {
            path.clone()
        } else {
            root.join(path)
        };
        let normalized_path = normalize_existing_or_missing_path(&candidate);
        if !normalized_path.starts_with(root) {
            continue;
        }
        if seen.insert(normalize_path_for_display(&normalized_path)) {
            normalized.push(normalized_path);
        }
    }
    Ok(normalized)
}

pub(super) fn normalize_existing_root(root: &Path) -> anyhow::Result<PathBuf> {
    let path = if root.as_os_str().is_empty() {
        std::env::current_dir()?
    } else if root.is_absolute() {
        root.to_path_buf()
    } else {
        std::env::current_dir()?.join(root)
    };
    Ok(path.canonicalize()?)
}

pub(super) fn normalize_existing_or_missing_path(path: &Path) -> PathBuf {
    if let Ok(canonical) = path.canonicalize() {
        return canonical;
    }
    let mut ancestor = path;
    let mut tail = Vec::new();
    while !ancestor.as_os_str().is_empty() && !ancestor.exists() {
        let Some(name) = ancestor.file_name() else {
            break;
        };
        tail.push(name.to_os_string());
        let Some(parent) = ancestor.parent() else {
            break;
        };
        ancestor = parent;
    }
    let mut normalized = ancestor
        .canonicalize()
        .unwrap_or_else(|_| ancestor.to_path_buf());
    for component in tail.into_iter().rev() {
        normalized.push(component);
    }
    normalized
}

pub(super) fn normalize_path_for_display(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

pub(super) fn normalized_extension(path: &Path) -> Option<String> {
    path.extension()
        .and_then(|extension| extension.to_str())
        .map(normalize_extension_filter)
        .filter(|extension| !extension.is_empty())
}

pub(super) fn normalize_extension_filter(value: &str) -> String {
    value.trim().trim_start_matches('.').to_lowercase()
}

pub(super) fn relative_display_path(path: &Path, root: &Path) -> PathBuf {
    match path.strip_prefix(root) {
        Ok(relative) if !relative.as_os_str().is_empty() => relative.to_path_buf(),
        _ => path
            .file_name()
            .map(PathBuf::from)
            .unwrap_or_else(|| path.to_path_buf()),
    }
}

pub(super) fn path_has_hidden_component(path: &Path) -> bool {
    path.components().any(|component| match component {
        Component::Normal(value) => value.to_str().is_some_and(|value| value.starts_with('.')),
        _ => false,
    })
}

pub(super) fn path_has_excluded_dir_component(path: &Path, exclude_dirs: &[String]) -> bool {
    path.components().any(|component| match component {
        Component::Normal(value) => value
            .to_str()
            .is_some_and(|value| is_excluded_directory_name(value, exclude_dirs)),
        _ => false,
    })
}

pub(super) fn is_excluded_directory_name(name: &str, exclude_dirs: &[String]) -> bool {
    let name = name.to_ascii_lowercase();
    exclude_dirs
        .iter()
        .map(|candidate| candidate.trim().to_ascii_lowercase())
        .any(|candidate| candidate == name)
}

pub(super) fn compiled_glob_patterns(patterns: &[String]) -> Vec<Pattern> {
    patterns
        .iter()
        .filter_map(|pattern| {
            let pattern = pattern.trim();
            if pattern.is_empty() {
                None
            } else {
                Pattern::new(pattern).ok()
            }
        })
        .collect()
}

pub(super) fn path_matches_any_glob(patterns: &[Pattern], path: &Path) -> bool {
    if patterns.is_empty() {
        return false;
    }
    let relative = normalize_path_for_display(path);
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("");
    patterns
        .iter()
        .any(|pattern| pattern.matches(&relative) || pattern.matches(file_name))
}

pub(super) fn walk_entry_allowed(
    entry: &DirEntry,
    root: &Path,
    options: &LocalSearchIndexRootOptions,
    exclude_globs: &[Pattern],
) -> bool {
    let entry_path = entry.path();
    if entry_path == root {
        return true;
    }
    let relative = relative_display_path(entry_path, root);
    if !options.include_hidden && path_has_hidden_component(&relative) {
        return false;
    }
    if !options.include_vendor && path_has_excluded_dir_component(&relative, &options.exclude_dirs)
    {
        return false;
    }
    !path_matches_any_glob(exclude_globs, &relative)
}

pub(super) fn remove_path_or_descendants(entries: &mut Vec<IndexedEntry>, path: &Path) {
    entries.retain(|entry| entry.full_path != path && !entry.full_path.starts_with(path));
}

pub(super) fn rebuild_all_root_statuses(state: &mut LocalSearchState) {
    let roots = state
        .entries
        .iter()
        .map(|entry| entry.root.clone())
        .collect::<HashSet<_>>();
    for root in roots {
        rebuild_root_status_from_entries(state, &root);
    }
}

pub(super) fn rebuild_root_status_from_entries(state: &mut LocalSearchState, root: &Path) {
    let mut indexed_file_count = 0_u64;
    let mut indexed_dir_count = 0_u64;
    let mut indexed_content_file_count = 0_u64;
    let mut content_bytes_indexed = 0_u64;
    for entry in state.entries.iter().filter(|entry| entry.root == root) {
        match entry.kind {
            LocalSearchKind::File => indexed_file_count += 1,
            LocalSearchKind::Directory => indexed_dir_count += 1,
        }
        if entry.content_indexed {
            indexed_content_file_count += 1;
            content_bytes_indexed = content_bytes_indexed.saturating_add(
                entry
                    .content_text
                    .as_ref()
                    .map(|text| text.len() as u64)
                    .unwrap_or(0),
            );
        }
    }
    let mut skipped = state
        .roots
        .get(root)
        .map(|status| status.skipped.clone())
        .unwrap_or_default();
    if indexed_file_count == 0 && indexed_dir_count == 0 {
        skipped = LocalSearchSkippedStats::default();
    }
    state.roots.insert(
        root.to_path_buf(),
        LocalSearchRootStatus {
            root: root.to_path_buf(),
            state: if indexed_file_count == 0 && indexed_dir_count == 0 {
                LocalSearchIndexState::Empty
            } else {
                LocalSearchIndexState::Ready
            },
            indexed_file_count,
            indexed_dir_count,
            indexed_content_file_count,
            content_bytes_indexed,
            skipped,
            last_indexed_at: Some(unix_seconds_now()),
            error: None,
        },
    );
}

pub(super) fn indexing_root_status(root: &Path) -> LocalSearchRootStatus {
    LocalSearchRootStatus {
        root: root.to_path_buf(),
        state: LocalSearchIndexState::Indexing,
        indexed_file_count: 0,
        indexed_dir_count: 0,
        indexed_content_file_count: 0,
        content_bytes_indexed: 0,
        skipped: LocalSearchSkippedStats::default(),
        last_indexed_at: None,
        error: None,
    }
}

pub(super) fn aggregate_root_state<'a>(
    roots: impl Iterator<Item = &'a LocalSearchRootStatus>,
) -> LocalSearchIndexState {
    let mut saw_partial = false;
    let mut saw_ready = false;
    let mut saw_indexing = false;
    let mut saw_failed = false;
    for root in roots {
        match root.state {
            LocalSearchIndexState::Indexing => saw_indexing = true,
            LocalSearchIndexState::Partial => saw_partial = true,
            LocalSearchIndexState::Ready => saw_ready = true,
            LocalSearchIndexState::Failed => saw_failed = true,
            LocalSearchIndexState::Empty | LocalSearchIndexState::Walker => {}
        }
    }
    if saw_indexing {
        LocalSearchIndexState::Indexing
    } else if saw_failed && !saw_ready && !saw_partial {
        LocalSearchIndexState::Failed
    } else if saw_partial || (saw_failed && saw_ready) {
        LocalSearchIndexState::Partial
    } else if saw_ready {
        LocalSearchIndexState::Ready
    } else {
        LocalSearchIndexState::Empty
    }
}
