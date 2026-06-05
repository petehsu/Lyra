use anyhow::{Context, Result, bail};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::process::{Command, Output};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatusRequest {
    pub working_dir: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitDiffRequest {
    pub working_dir: String,
    pub path: String,
    #[serde(default)]
    pub scope: GitDiffScope,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitFileRequest {
    pub working_dir: String,
    pub path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitLogRequest {
    pub working_dir: String,
    pub limit: Option<usize>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitShowRequest {
    pub working_dir: String,
    pub ref_name: Option<String>,
    #[serde(default)]
    pub ref_: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitBranchRequest {
    pub working_dir: String,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum GitDiffScope {
    Auto,
    Unstaged,
    Staged,
}

impl Default for GitDiffScope {
    fn default() -> Self {
        Self::Auto
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatusSnapshot {
    pub working_dir: String,
    pub is_repository: bool,
    pub repository_root: Option<String>,
    pub branch: Option<String>,
    pub upstream: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    pub entries: Vec<GitChangedFile>,
    pub summary: GitStatusSummary,
    pub updated_at: DateTime<Utc>,
    pub message: Option<String>,
}

#[derive(Debug, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct GitStatusSummary {
    pub changed: usize,
    pub staged: usize,
    pub unstaged: usize,
    pub untracked: usize,
    pub conflicts: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitChangedFile {
    pub path: String,
    pub absolute_path: String,
    pub original_path: Option<String>,
    pub status: GitChangedFileStatus,
    pub index_status: String,
    pub working_tree_status: String,
    pub staged: bool,
    pub unstaged: bool,
    pub untracked: bool,
    pub conflicted: bool,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum GitChangedFileStatus {
    Added,
    Copied,
    Deleted,
    Modified,
    Renamed,
    TypeChanged,
    Untracked,
    Conflicted,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitDiffResponse {
    pub working_dir: String,
    pub repository_root: String,
    pub path: String,
    pub scope: GitDiffScope,
    pub diff: String,
    pub is_binary: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitMutationResponse {
    pub snapshot: GitStatusSnapshot,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitLogResponse {
    pub working_dir: String,
    pub repository_root: String,
    pub commits: Vec<GitCommitSummary>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitSummary {
    pub hash: String,
    pub short_hash: String,
    pub author_name: String,
    pub author_email: String,
    pub authored_at: String,
    pub subject: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitShowResponse {
    pub working_dir: String,
    pub repository_root: String,
    pub ref_name: String,
    pub output: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitBranchResponse {
    pub working_dir: String,
    pub repository_root: String,
    pub current: Option<String>,
    pub upstream: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    pub branches: Vec<String>,
}

pub fn git_status_json(payload: String) -> Result<String> {
    let request: GitStatusRequest = serde_json::from_str(&payload)?;
    serde_json::to_string(&git_status(&request.working_dir)?).context("encode git status")
}

pub fn git_diff_json(payload: String) -> Result<String> {
    let request: GitDiffRequest = serde_json::from_str(&payload)?;
    serde_json::to_string(&git_diff(request)?).context("encode git diff")
}

pub fn git_stage_json(payload: String) -> Result<String> {
    let request: GitFileRequest = serde_json::from_str(&payload)?;
    let repo = resolve_repository(&request.working_dir)?;
    let rel_path = validate_relative_path(&request.path)?;
    run_git_checked(&repo.root, ["add", "--", rel_path])?;
    mutation_response(repo.working_dir)
}

pub fn git_unstage_json(payload: String) -> Result<String> {
    let request: GitFileRequest = serde_json::from_str(&payload)?;
    let repo = resolve_repository(&request.working_dir)?;
    let rel_path = validate_relative_path(&request.path)?;
    run_git_checked(&repo.root, ["restore", "--staged", "--", rel_path])
        .or_else(|_| run_git_checked(&repo.root, ["reset", "-q", "HEAD", "--", rel_path]))?;
    mutation_response(repo.working_dir)
}

pub fn git_discard_json(payload: String) -> Result<String> {
    let request: GitFileRequest = serde_json::from_str(&payload)?;
    let repo = resolve_repository(&request.working_dir)?;
    let rel_path = validate_relative_path(&request.path)?;
    let entries = read_changed_files(&repo.root)?;
    let entry = entries.iter().find(|entry| entry.path == rel_path);
    if entry.is_some_and(|entry| entry.untracked && !entry.staged) {
        remove_untracked_path(&repo.root, rel_path)?;
    } else {
        run_git_checked(
            &repo.root,
            ["restore", "--staged", "--worktree", "--", rel_path],
        )?;
    }
    mutation_response(repo.working_dir)
}

pub fn git_log_json(payload: String) -> Result<String> {
    let request: GitLogRequest = serde_json::from_str(&payload)?;
    let repo = resolve_repository(&request.working_dir)?;
    let limit = request.limit.unwrap_or(20).clamp(1, 100);
    let output = run_git_checked(
        &repo.root,
        [
            "log",
            &format!("-n{limit}"),
            "--pretty=format:%H%x1f%h%x1f%an%x1f%ae%x1f%aI%x1f%s%x1e",
        ],
    )?;
    let text = String::from_utf8_lossy(&output.stdout);
    let commits = text
        .split('\x1e')
        .filter_map(parse_commit_summary)
        .collect::<Vec<_>>();
    serde_json::to_string(&GitLogResponse {
        working_dir: repo.working_dir,
        repository_root: path_to_string(&repo.root),
        commits,
    })
    .context("encode git log response")
}

pub fn git_show_json(payload: String) -> Result<String> {
    let request: GitShowRequest = serde_json::from_str(&payload)?;
    let repo = resolve_repository(&request.working_dir)?;
    let ref_name = request
        .ref_name
        .or(request.ref_)
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "HEAD".to_string());
    let output = run_git_checked(
        &repo.root,
        [
            "show",
            "--stat",
            "--patch",
            "--find-renames",
            "--find-copies",
            "--max-count=1",
            "--",
            &ref_name,
        ],
    )
    .or_else(|_| {
        run_git_checked(
            &repo.root,
            [
                "show",
                "--stat",
                "--patch",
                "--find-renames",
                "--find-copies",
                "--max-count=1",
                &ref_name,
            ],
        )
    })?;
    serde_json::to_string(&GitShowResponse {
        working_dir: repo.working_dir,
        repository_root: path_to_string(&repo.root),
        ref_name,
        output: truncate_git_text(String::from_utf8_lossy(&output.stdout).to_string()),
    })
    .context("encode git show response")
}

pub fn git_branch_json(payload: String) -> Result<String> {
    let request: GitBranchRequest = serde_json::from_str(&payload)?;
    let repo = resolve_repository(&request.working_dir)?;
    let upstream = run_git_optional_text(
        &repo.root,
        ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
    );
    let (ahead, behind) = upstream
        .as_ref()
        .and_then(|_| ahead_behind(&repo.root).ok())
        .unwrap_or((0, 0));
    let branches = run_git_optional_text(&repo.root, ["branch", "--format=%(refname:short)"])
        .map(|text| {
            text.lines()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    serde_json::to_string(&GitBranchResponse {
        working_dir: repo.working_dir,
        repository_root: path_to_string(&repo.root),
        current: current_branch(&repo.root),
        upstream,
        ahead,
        behind,
        branches,
    })
    .context("encode git branch response")
}

fn mutation_response(working_dir: String) -> Result<String> {
    serde_json::to_string(&GitMutationResponse {
        snapshot: git_status(&working_dir)?,
    })
    .context("encode git mutation response")
}

fn git_status(working_dir: &str) -> Result<GitStatusSnapshot> {
    let normalized_working_dir = normalize_working_dir(working_dir)?;
    let repo = match resolve_repository(&normalized_working_dir) {
        Ok(repo) => repo,
        Err(error) => {
            return Ok(GitStatusSnapshot {
                working_dir: normalized_working_dir,
                is_repository: false,
                repository_root: None,
                branch: None,
                upstream: None,
                ahead: 0,
                behind: 0,
                entries: Vec::new(),
                summary: GitStatusSummary::default(),
                updated_at: Utc::now(),
                message: Some(error.to_string()),
            });
        }
    };
    let entries = read_changed_files(&repo.root)?;
    let summary = summarize_entries(&entries);
    let upstream = run_git_optional_text(
        &repo.root,
        ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
    );
    let (ahead, behind) = upstream
        .as_ref()
        .and_then(|_| ahead_behind(&repo.root).ok())
        .unwrap_or((0, 0));

    Ok(GitStatusSnapshot {
        working_dir: repo.working_dir,
        is_repository: true,
        repository_root: Some(path_to_string(&repo.root)),
        branch: current_branch(&repo.root),
        upstream,
        ahead,
        behind,
        entries,
        summary,
        updated_at: Utc::now(),
        message: None,
    })
}

fn git_diff(request: GitDiffRequest) -> Result<GitDiffResponse> {
    let repo = resolve_repository(&request.working_dir)?;
    let rel_path = validate_relative_path(&request.path)?;
    let entries = read_changed_files(&repo.root)?;
    let entry = entries.iter().find(|entry| entry.path == rel_path);
    let scope = match request.scope {
        GitDiffScope::Auto => {
            if entry.is_some_and(|entry| entry.unstaged || entry.untracked) {
                GitDiffScope::Unstaged
            } else {
                GitDiffScope::Staged
            }
        }
        explicit => explicit,
    };
    let (diff, is_binary) =
        if scope == GitDiffScope::Unstaged && entry.is_some_and(|entry| entry.untracked) {
            synthesize_untracked_diff(&repo.root, rel_path)?
        } else {
            let args = match scope {
                GitDiffScope::Staged => vec!["diff", "--cached", "--", rel_path],
                GitDiffScope::Unstaged | GitDiffScope::Auto => vec!["diff", "--", rel_path],
            };
            let output = run_git_allow_status(&repo.root, args)?;
            let text = String::from_utf8_lossy(&output.stdout).to_string();
            let is_binary = text.contains("Binary files ") || text.contains(" differ\n");
            (text, is_binary)
        };

    Ok(GitDiffResponse {
        working_dir: repo.working_dir,
        repository_root: path_to_string(&repo.root),
        path: rel_path.to_string(),
        scope,
        diff,
        is_binary,
    })
}

fn parse_commit_summary(record: &str) -> Option<GitCommitSummary> {
    let trimmed = record.trim_matches(|ch| ch == '\n' || ch == '\r');
    if trimmed.is_empty() {
        return None;
    }
    let parts = trimmed.split('\x1f').collect::<Vec<_>>();
    if parts.len() < 6 {
        return None;
    }
    Some(GitCommitSummary {
        hash: parts[0].to_string(),
        short_hash: parts[1].to_string(),
        author_name: parts[2].to_string(),
        author_email: parts[3].to_string(),
        authored_at: parts[4].to_string(),
        subject: parts[5].to_string(),
    })
}

fn truncate_git_text(mut text: String) -> String {
    const MAX_GIT_TEXT_BYTES: usize = 96_000;
    if text.len() <= MAX_GIT_TEXT_BYTES {
        return text;
    }
    text.truncate(MAX_GIT_TEXT_BYTES);
    text.push_str("\n[truncated]\n");
    text
}

#[derive(Debug)]
struct ResolvedRepository {
    working_dir: String,
    root: PathBuf,
}

fn normalize_working_dir(working_dir: &str) -> Result<String> {
    let trimmed = working_dir.trim();
    if trimmed.is_empty() {
        bail!("workingDir is required");
    }
    let path = PathBuf::from(trimmed);
    if !path.exists() {
        bail!("workingDir does not exist: {trimmed}");
    }
    if !path.is_dir() {
        bail!("workingDir is not a directory: {trimmed}");
    }
    Ok(path_to_string(&path))
}

fn resolve_repository(working_dir: &str) -> Result<ResolvedRepository> {
    let normalized = normalize_working_dir(working_dir)?;
    let output = run_git_checked(Path::new(&normalized), ["rev-parse", "--show-toplevel"])
        .context("workingDir is not inside a Git repository")?;
    let root = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if root.is_empty() {
        bail!("Git repository root was empty");
    }
    Ok(ResolvedRepository {
        working_dir: normalized,
        root: PathBuf::from(root),
    })
}

fn read_changed_files(repo_root: &Path) -> Result<Vec<GitChangedFile>> {
    let output = run_git_checked(
        repo_root,
        ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
    )?;
    parse_status_v1_z(repo_root, &output.stdout)
}

fn parse_status_v1_z(repo_root: &Path, bytes: &[u8]) -> Result<Vec<GitChangedFile>> {
    let mut entries = Vec::new();
    let mut index = 0;
    while index < bytes.len() {
        let Some(end) = bytes[index..]
            .iter()
            .position(|byte| *byte == 0)
            .map(|offset| index + offset)
        else {
            break;
        };
        if end == index {
            index = end + 1;
            continue;
        }
        let record = &bytes[index..end];
        index = end + 1;
        if record.len() < 4 {
            continue;
        }
        let x = record[0] as char;
        let y = record[1] as char;
        let path_start = if record.get(2) == Some(&b' ') { 3 } else { 2 };
        let path = String::from_utf8_lossy(&record[path_start..]).to_string();
        let original_path = if matches!(x, 'R' | 'C') {
            bytes[index..]
                .iter()
                .position(|byte| *byte == 0)
                .map(|offset| index + offset)
                .map(|end| {
                    let value = String::from_utf8_lossy(&bytes[index..end]).to_string();
                    index = end + 1;
                    value
                })
        } else {
            None
        };
        let staged = !matches!(x, ' ' | '?');
        let untracked = x == '?' && y == '?';
        let unstaged = untracked || !matches!(y, ' ');
        let conflicted = is_conflicted_status(x, y);
        entries.push(GitChangedFile {
            absolute_path: path_to_string(&repo_root.join(&path)),
            status: classify_status(x, y),
            index_status: x.to_string(),
            working_tree_status: y.to_string(),
            staged,
            unstaged,
            untracked,
            conflicted,
            original_path,
            path,
        });
    }
    entries.sort_by(|left, right| left.path.cmp(&right.path));
    Ok(entries)
}

fn classify_status(x: char, y: char) -> GitChangedFileStatus {
    if x == '?' && y == '?' {
        return GitChangedFileStatus::Untracked;
    }
    if is_conflicted_status(x, y) {
        return GitChangedFileStatus::Conflicted;
    }
    if x == 'R' || y == 'R' {
        return GitChangedFileStatus::Renamed;
    }
    if x == 'C' || y == 'C' {
        return GitChangedFileStatus::Copied;
    }
    if x == 'A' || y == 'A' {
        return GitChangedFileStatus::Added;
    }
    if x == 'D' || y == 'D' {
        return GitChangedFileStatus::Deleted;
    }
    if x == 'T' || y == 'T' {
        return GitChangedFileStatus::TypeChanged;
    }
    GitChangedFileStatus::Modified
}

fn is_conflicted_status(x: char, y: char) -> bool {
    matches!(
        (x, y),
        ('D', 'D') | ('A', 'U') | ('U', 'D') | ('U', 'A') | ('D', 'U') | ('A', 'A') | ('U', 'U')
    )
}

fn summarize_entries(entries: &[GitChangedFile]) -> GitStatusSummary {
    GitStatusSummary {
        changed: entries.len(),
        staged: entries.iter().filter(|entry| entry.staged).count(),
        unstaged: entries
            .iter()
            .filter(|entry| entry.unstaged && !entry.untracked)
            .count(),
        untracked: entries.iter().filter(|entry| entry.untracked).count(),
        conflicts: entries.iter().filter(|entry| entry.conflicted).count(),
    }
}

fn current_branch(repo_root: &Path) -> Option<String> {
    let branch = run_git_optional_text(repo_root, ["branch", "--show-current"]);
    if branch.as_deref().is_some_and(|value| !value.is_empty()) {
        return branch;
    }
    run_git_optional_text(repo_root, ["rev-parse", "--short", "HEAD"])
}

fn ahead_behind(repo_root: &Path) -> Result<(u32, u32)> {
    let output = run_git_checked(
        repo_root,
        ["rev-list", "--left-right", "--count", "HEAD...@{u}"],
    )?;
    let text = String::from_utf8_lossy(&output.stdout);
    let mut parts = text.split_whitespace();
    let ahead = parts.next().unwrap_or("0").parse::<u32>().unwrap_or(0);
    let behind = parts.next().unwrap_or("0").parse::<u32>().unwrap_or(0);
    Ok((ahead, behind))
}

fn synthesize_untracked_diff(repo_root: &Path, rel_path: &str) -> Result<(String, bool)> {
    let path = repo_root.join(rel_path);
    let bytes = fs::read(&path).with_context(|| format!("read untracked file: {rel_path}"))?;
    if bytes.contains(&0) {
        return Ok((format!("Binary file {} is untracked\n", rel_path), true));
    }
    let text = String::from_utf8_lossy(&bytes);
    let line_count = text.lines().count().max(1);
    let mut diff = String::new();
    diff.push_str(&format!("diff --git a/{0} b/{0}\n", rel_path));
    diff.push_str("new file mode 100644\n");
    diff.push_str("--- /dev/null\n");
    diff.push_str(&format!("+++ b/{}\n", rel_path));
    diff.push_str(&format!("@@ -0,0 +1,{} @@\n", line_count));
    for line in text.lines() {
        diff.push('+');
        diff.push_str(line);
        diff.push('\n');
    }
    if text.ends_with('\n') {
        return Ok((diff, false));
    }
    diff.push_str("\\ No newline at end of file\n");
    Ok((diff, false))
}

fn remove_untracked_path(repo_root: &Path, rel_path: &str) -> Result<()> {
    let absolute = repo_root.join(rel_path);
    let metadata = fs::symlink_metadata(&absolute)
        .with_context(|| format!("untracked path does not exist: {rel_path}"))?;
    if metadata.is_dir() {
        fs::remove_dir_all(&absolute)
            .with_context(|| format!("remove untracked directory: {rel_path}"))?;
    } else {
        fs::remove_file(&absolute).with_context(|| format!("remove untracked file: {rel_path}"))?;
    }
    Ok(())
}

fn validate_relative_path(path: &str) -> Result<&str> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        bail!("path is required");
    }
    let path = Path::new(trimmed);
    if path.is_absolute() {
        bail!("path must be relative to the Git repository");
    }
    if path
        .components()
        .any(|component| matches!(component, Component::ParentDir))
    {
        bail!("path cannot contain parent traversal");
    }
    Ok(trimmed)
}

fn run_git_optional_text<const N: usize>(repo_root: &Path, args: [&str; N]) -> Option<String> {
    run_git_checked(repo_root, args)
        .ok()
        .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_string())
        .filter(|value| !value.is_empty())
}

fn run_git_checked<I, S>(cwd: &Path, args: I) -> Result<Output>
where
    I: IntoIterator<Item = S>,
    S: AsRef<std::ffi::OsStr>,
{
    let output = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .context("failed to spawn git")?;
    if output.status.success() {
        return Ok(output);
    }
    bail!("{}", git_error_message(&output));
}

fn run_git_allow_status<I, S>(cwd: &Path, args: I) -> Result<Output>
where
    I: IntoIterator<Item = S>,
    S: AsRef<std::ffi::OsStr>,
{
    Command::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .context("failed to spawn git")
}

fn git_error_message(output: &Output) -> String {
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if !stderr.is_empty() {
        return stderr;
    }
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if !stdout.is_empty() {
        return stdout;
    }
    format!("git exited with status {}", output.status)
}

fn path_to_string(path: &Path) -> String {
    path.to_string_lossy().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn git(cwd: &Path, args: &[&str]) {
        let output = Command::new("git")
            .args(args)
            .current_dir(cwd)
            .output()
            .expect("spawn git");
        assert!(
            output.status.success(),
            "git {:?} failed: {}",
            args,
            String::from_utf8_lossy(&output.stderr)
        );
    }

    #[test]
    fn status_reads_changed_files() {
        let temp = tempdir().expect("tempdir");
        let root = temp.path();
        git(root, &["init"]);
        git(root, &["config", "user.email", "lyra@example.test"]);
        git(root, &["config", "user.name", "Lyra Test"]);
        fs::write(root.join("tracked.txt"), "one\n").expect("write");
        git(root, &["add", "tracked.txt"]);
        git(root, &["commit", "-m", "initial"]);
        fs::write(root.join("tracked.txt"), "two\n").expect("write");
        fs::write(root.join("new.txt"), "hello\n").expect("write");

        let snapshot = git_status(root.to_str().expect("path")).expect("status");
        assert!(snapshot.is_repository);
        assert_eq!(snapshot.summary.changed, 2);
        assert!(
            snapshot
                .entries
                .iter()
                .any(|entry| entry.path == "tracked.txt" && entry.unstaged)
        );
        assert!(
            snapshot
                .entries
                .iter()
                .any(|entry| entry.path == "new.txt" && entry.untracked)
        );
    }

    #[test]
    fn stage_unstage_and_discard_are_real_git_mutations() {
        let temp = tempdir().expect("tempdir");
        let root = temp.path();
        git(root, &["init"]);
        git(root, &["config", "user.email", "lyra@example.test"]);
        git(root, &["config", "user.name", "Lyra Test"]);
        fs::write(root.join("tracked.txt"), "one\n").expect("write");
        git(root, &["add", "tracked.txt"]);
        git(root, &["commit", "-m", "initial"]);
        fs::write(root.join("tracked.txt"), "two\n").expect("write");

        git_stage_json(
            serde_json::json!({
                "workingDir": root,
                "path": "tracked.txt"
            })
            .to_string(),
        )
        .expect("stage");
        let staged = git_status(root.to_str().expect("path")).expect("status");
        assert!(
            staged
                .entries
                .iter()
                .any(|entry| entry.path == "tracked.txt" && entry.staged)
        );

        git_unstage_json(
            serde_json::json!({
                "workingDir": root,
                "path": "tracked.txt"
            })
            .to_string(),
        )
        .expect("unstage");
        let unstaged = git_status(root.to_str().expect("path")).expect("status");
        assert!(
            unstaged
                .entries
                .iter()
                .any(|entry| entry.path == "tracked.txt" && entry.unstaged)
        );

        git_discard_json(
            serde_json::json!({
                "workingDir": root,
                "path": "tracked.txt"
            })
            .to_string(),
        )
        .expect("discard");
        let clean = git_status(root.to_str().expect("path")).expect("status");
        assert!(clean.entries.is_empty());
        assert_eq!(
            fs::read_to_string(root.join("tracked.txt")).expect("read"),
            "one\n"
        );
    }

    #[test]
    fn untracked_diff_is_synthesized_without_staging() {
        let temp = tempdir().expect("tempdir");
        let root = temp.path();
        git(root, &["init"]);
        fs::write(root.join("new.txt"), "hello\n").expect("write");
        let response = git_diff(GitDiffRequest {
            working_dir: root.to_string_lossy().to_string(),
            path: "new.txt".to_string(),
            scope: GitDiffScope::Auto,
        })
        .expect("diff");
        assert_eq!(response.scope, GitDiffScope::Unstaged);
        assert!(response.diff.contains("+++ b/new.txt"));
        assert!(response.diff.contains("+hello"));
    }
}
