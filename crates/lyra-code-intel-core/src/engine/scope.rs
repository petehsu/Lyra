use std::collections::{HashSet, VecDeque};
use std::path::{Path, PathBuf};
use std::process::Command;

use codegraph_server::indexer::IndexConfig;
use codegraph_server::parser_registry::ParserRegistry;
use serde_json::Value;

use crate::context::ProjectScopeSummary;

use super::normalize_project_root;

#[derive(Debug, Clone)]
pub(crate) struct ProjectScope {
    pub(super) files: Vec<PathBuf>,
    file_set: HashSet<String>,
    source: ScopeSource,
    excluded_path_count: usize,
    excluded_path_samples: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ScopeSource {
    Git,
    WorkspaceManifest,
    Recursive,
}

impl ScopeSource {
    fn as_str(self) -> &'static str {
        match self {
            Self::Git => "git",
            Self::WorkspaceManifest => "workspaceManifest",
            Self::Recursive => "recursive",
        }
    }

    fn strategy(self) -> &'static str {
        match self {
            Self::Git => "tracked files plus structurally project-local untracked files",
            Self::WorkspaceManifest => "workspace manifest roots plus root-level project files",
            Self::Recursive => "recursive fallback under the bound project root",
        }
    }

    fn excluded_reason(self) -> Option<&'static str> {
        match self {
            Self::Git => Some(
                "Excluded indexable paths are Git-untracked paths outside the bound project/workspace structure. This is not directory-name filtering.",
            ),
            Self::WorkspaceManifest => Some(
                "Excluded paths are outside workspace manifest roots. This is not directory-name filtering.",
            ),
            Self::Recursive => None,
        }
    }
}

impl ProjectScope {
    pub(crate) fn discover(root: &Path, parsers: &ParserRegistry, config: &IndexConfig) -> Self {
        if let Some(scope) = git_scope(root, parsers, config) {
            return scope;
        }
        let manifest_roots = workspace_member_roots(root);
        if !manifest_roots.is_empty() {
            let mut files = root_level_indexable_files(root, parsers, config);
            for dir in &manifest_roots {
                files.extend(recursive_indexable_files(dir, parsers, config));
            }
            if !files.is_empty() {
                let (excluded_path_count, excluded_path_samples) =
                    workspace_excluded_paths(root, &manifest_roots);
                return Self::new(
                    files,
                    ScopeSource::WorkspaceManifest,
                    excluded_path_count,
                    excluded_path_samples,
                );
            }
        }
        Self::new(
            recursive_indexable_files(root, parsers, config),
            ScopeSource::Recursive,
            0,
            Vec::new(),
        )
    }

    fn new(
        files: Vec<PathBuf>,
        source: ScopeSource,
        excluded_path_count: usize,
        excluded_path_samples: Vec<String>,
    ) -> Self {
        let mut seen = HashSet::new();
        let mut files = files
            .into_iter()
            .filter(|path| seen.insert(normalize_index_path(path)))
            .collect::<Vec<_>>();
        files.sort();
        let file_set = files
            .iter()
            .map(|path| normalize_index_path(path))
            .collect();
        Self {
            files,
            file_set,
            source,
            excluded_path_count,
            excluded_path_samples,
        }
    }

    pub(crate) fn contains_path_str(&self, path: &str) -> bool {
        self.file_set
            .contains(&normalize_index_path(Path::new(path)))
    }

    pub(super) fn len(&self) -> usize {
        self.files.len()
    }

    pub(super) fn summary(&self, root: &Path) -> ProjectScopeSummary {
        ProjectScopeSummary {
            source: self.source.as_str().to_string(),
            strategy: self.source.strategy().to_string(),
            included_file_count: self.files.len() as u64,
            included_samples: self
                .files
                .iter()
                .take(12)
                .map(|path| relative_display(root, path))
                .collect(),
            excluded_path_count: self.excluded_path_count as u64,
            excluded_path_samples: self.excluded_path_samples.clone(),
            excluded_reason: self.source.excluded_reason().map(str::to_string),
        }
    }
}

fn normalize_index_path(path: &Path) -> String {
    path.canonicalize()
        .unwrap_or_else(|_| path.to_path_buf())
        .to_string_lossy()
        .replace('\\', "/")
}

fn git_scope(root: &Path, parsers: &ParserRegistry, config: &IndexConfig) -> Option<ProjectScope> {
    let repo_root = git_repo_root(root)?;
    let tracked = git_files(root, false)?;
    if tracked.is_empty() {
        return None;
    }
    let mut tracked_paths = Vec::new();
    let mut tracked_dirs = HashSet::new();
    for rel in tracked {
        let path = repo_root.join(rel);
        if path.starts_with(root) && is_indexable_file(&path, parsers, config) {
            remember_project_ancestors(root, &path, &mut tracked_dirs);
            tracked_paths.push(path);
        }
    }
    let workspace_roots = workspace_member_roots(root)
        .into_iter()
        .filter(|path| path != root)
        .collect::<Vec<_>>();
    let mut files = tracked_paths;
    let mut excluded_path_count = 0;
    let mut excluded_path_samples = Vec::new();
    for rel in git_files(root, true).unwrap_or_default() {
        let path = repo_root.join(rel);
        if !path.starts_with(root) || !is_indexable_file(&path, parsers, config) {
            continue;
        }
        if path.parent() == Some(root)
            || is_under_any(&path, &workspace_roots)
            || is_under_any_set(&path, &tracked_dirs)
        {
            files.push(path);
        } else {
            excluded_path_count += 1;
            if excluded_path_samples.len() < 12 {
                excluded_path_samples.push(relative_display(root, &path));
            }
        }
    }
    (!files.is_empty()).then(|| {
        ProjectScope::new(
            files,
            ScopeSource::Git,
            excluded_path_count,
            excluded_path_samples,
        )
    })
}

fn git_repo_root(root: &Path) -> Option<PathBuf> {
    let output = Command::new("git")
        .arg("-C")
        .arg(root)
        .arg("rev-parse")
        .arg("--show-toplevel")
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
    (!path.is_empty()).then(|| normalize_project_root(Path::new(&path)))
}

fn git_files(root: &Path, untracked: bool) -> Option<Vec<PathBuf>> {
    let mut command = Command::new("git");
    command
        .arg("-C")
        .arg(root)
        .arg("ls-files")
        .arg("--full-name");
    if untracked {
        command.arg("-o").arg("--exclude-standard");
    }
    let output = command.arg("-z").output().ok()?;
    output.status.success().then(|| {
        output
            .stdout
            .split(|byte| *byte == 0)
            .filter(|bytes| !bytes.is_empty())
            .map(|bytes| PathBuf::from(String::from_utf8_lossy(bytes).to_string()))
            .collect()
    })
}

fn remember_project_ancestors(root: &Path, file: &Path, dirs: &mut HashSet<PathBuf>) {
    let mut current = file.parent();
    while let Some(dir) = current {
        if dir == root {
            break;
        }
        dirs.insert(dir.to_path_buf());
        current = dir.parent();
    }
}

fn is_under_any(path: &Path, roots: &[PathBuf]) -> bool {
    roots.iter().any(|root| path.starts_with(root))
}

fn is_under_any_set(path: &Path, roots: &HashSet<PathBuf>) -> bool {
    roots.iter().any(|root| path.starts_with(root))
}

fn workspace_member_roots(root: &Path) -> Vec<PathBuf> {
    let mut roots = cargo_workspace_roots(root);
    roots.extend(pnpm_workspace_roots(root));
    roots.extend(package_workspace_roots(root));
    dedupe_existing_dirs(root, roots)
}

fn cargo_workspace_roots(root: &Path) -> Vec<PathBuf> {
    let Ok(content) = std::fs::read_to_string(root.join("Cargo.toml")) else {
        return Vec::new();
    };
    let mut in_members = false;
    let mut roots = Vec::new();
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("members") && trimmed.contains('[') {
            in_members = true;
        }
        if in_members {
            roots.extend(
                quoted_values(trimmed)
                    .into_iter()
                    .flat_map(|value| expand_workspace_pattern(root, &value)),
            );
            if trimmed.contains(']') {
                in_members = false;
            }
        }
    }
    roots
}

fn pnpm_workspace_roots(root: &Path) -> Vec<PathBuf> {
    let Ok(content) = std::fs::read_to_string(root.join("pnpm-workspace.yaml")) else {
        return Vec::new();
    };
    content
        .lines()
        .filter_map(|line| line.trim().strip_prefix("- "))
        .map(|value| value.trim().trim_matches('"').trim_matches('\''))
        .filter(|value| !value.starts_with('!'))
        .flat_map(|value| expand_workspace_pattern(root, value))
        .collect()
}

fn package_workspace_roots(root: &Path) -> Vec<PathBuf> {
    let Ok(content) = std::fs::read_to_string(root.join("package.json")) else {
        return Vec::new();
    };
    let Ok(json) = serde_json::from_str::<Value>(&content) else {
        return Vec::new();
    };
    let patterns = match json.get("workspaces") {
        Some(Value::Array(values)) => values
            .iter()
            .filter_map(Value::as_str)
            .map(str::to_string)
            .collect(),
        Some(Value::Object(map)) => map
            .get("packages")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .map(str::to_string)
            .collect(),
        _ => Vec::new(),
    };
    patterns
        .into_iter()
        .filter(|value| !value.starts_with('!'))
        .flat_map(|value| expand_workspace_pattern(root, &value))
        .collect()
}

fn quoted_values(line: &str) -> Vec<String> {
    let mut values = Vec::new();
    let mut chars = line.chars();
    while let Some(ch) = chars.next() {
        if ch != '"' && ch != '\'' {
            continue;
        }
        let mut value = String::new();
        for next in chars.by_ref() {
            if next == ch {
                break;
            }
            value.push(next);
        }
        if !value.is_empty() {
            values.push(value);
        }
    }
    values
}

fn expand_workspace_pattern(root: &Path, pattern: &str) -> Vec<PathBuf> {
    if pattern.contains('*') {
        return glob::glob(&root.join(pattern).to_string_lossy())
            .ok()
            .into_iter()
            .flat_map(|paths| paths.flatten())
            .collect();
    }
    vec![root.join(pattern)]
}

fn dedupe_existing_dirs(root: &Path, roots: Vec<PathBuf>) -> Vec<PathBuf> {
    let mut seen = HashSet::new();
    roots
        .into_iter()
        .map(|path| normalize_project_root(&path))
        .filter(|path| {
            path.is_dir() && path.starts_with(root) && seen.insert(normalize_index_path(path))
        })
        .collect()
}

fn workspace_excluded_paths(root: &Path, workspace_roots: &[PathBuf]) -> (usize, Vec<String>) {
    let mut count = 0;
    let mut samples = Vec::new();
    let Ok(entries) = std::fs::read_dir(root) else {
        return (0, samples);
    };
    for path in entries.flatten().map(|entry| entry.path()) {
        let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };
        if name.starts_with('.') || workspace_roots.iter().any(|dir| dir == &path) {
            continue;
        }
        if path.is_dir() {
            count += 1;
            if samples.len() < 12 {
                samples.push(format!("{}/", relative_display(root, &path)));
            }
        }
    }
    (count, samples)
}

fn relative_display(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

fn root_level_indexable_files(
    root: &Path,
    parsers: &ParserRegistry,
    config: &IndexConfig,
) -> Vec<PathBuf> {
    std::fs::read_dir(root)
        .ok()
        .into_iter()
        .flat_map(|entries| entries.flatten())
        .map(|entry| entry.path())
        .filter(|path| path.is_file() && is_indexable_file(path, parsers, config))
        .collect()
}

fn recursive_indexable_files(
    root: &Path,
    parsers: &ParserRegistry,
    config: &IndexConfig,
) -> Vec<PathBuf> {
    let exclude_dirs = config.exclude_dirs.iter().cloned().collect::<HashSet<_>>();
    let mut queue = VecDeque::from([(root.to_path_buf(), 0_u32)]);
    let mut files = Vec::new();
    while let Some((dir, depth)) = queue.pop_front() {
        if depth > config.max_depth || files.len() >= config.max_files {
            continue;
        }
        let Ok(entries) = std::fs::read_dir(dir) else {
            continue;
        };
        for path in entries.flatten().map(|entry| entry.path()) {
            if files.len() >= config.max_files {
                break;
            }
            let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
                continue;
            };
            if name.starts_with('.') {
                continue;
            }
            if path.is_dir() {
                if !exclude_dirs.contains(name) && !is_generated_parser_dir(name) {
                    queue.push_back((path, depth + 1));
                }
            } else if is_indexable_file(&path, parsers, config) {
                files.push(path);
            }
        }
    }
    files
}

fn is_indexable_file(path: &Path, parsers: &ParserRegistry, config: &IndexConfig) -> bool {
    path.is_file()
        && parsers.can_parse(path)
        && std::fs::metadata(path)
            .map(|metadata| metadata.len() <= config.max_file_size_bytes)
            .unwrap_or(false)
}

fn is_generated_parser_dir(name: &str) -> bool {
    name.starts_with("tree-sitter-") && name.ends_with("-src")
}
