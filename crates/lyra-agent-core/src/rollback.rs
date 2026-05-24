use std::collections::HashSet;
use std::ffi::OsStr;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use anyhow::{Context, Result, anyhow, bail};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::message::{ContentBlock, Role};
use crate::session::Session;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RollbackAnchor {
    pub id: String,
    pub session_id: String,
    pub message_id: String,
    #[serde(default)]
    pub pending: bool,
    pub user_text: String,
    pub checkpoint_hash: String,
    pub checkpoint_at: DateTime<Utc>,
    pub working_dir: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RollbackChangedFile {
    pub path: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RollbackPreview {
    pub session_id: String,
    pub message_id: String,
    pub available: bool,
    pub checkpoint_at: Option<DateTime<Utc>>,
    pub removed_message_count: usize,
    pub changed_files: Vec<RollbackChangedFile>,
    pub unavailable_reason: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct RollbackAnchorStore {
    anchors: Vec<RollbackAnchor>,
}

pub fn create_anchor_for_user_message(
    session_id: &str,
    message_id: &str,
    user_text: &str,
) -> Result<RollbackAnchor> {
    let session = Session::load(session_id)?;
    let working_dir = session_working_dir(&session)?;
    validate_working_dir(&working_dir)?;
    let checkpoint_hash = create_checkpoint(&working_dir)?;
    let anchor = RollbackAnchor {
        id: format!("rollback-{}", uuid::Uuid::new_v4()),
        session_id: session_id.to_string(),
        message_id: message_id.to_string(),
        pending: true,
        user_text: user_text.to_string(),
        checkpoint_hash,
        checkpoint_at: Utc::now(),
        working_dir: working_dir.to_string_lossy().to_string(),
    };
    upsert_anchor(anchor.clone())?;
    Ok(anchor)
}

pub fn bind_pending_anchors(session: &Session) -> Result<()> {
    let mut store = load_store(&session.id)?;
    if !store.anchors.iter().any(|anchor| anchor.pending) {
        return Ok(());
    }

    let mut used_message_ids = store
        .anchors
        .iter()
        .filter(|anchor| !anchor.pending)
        .map(|anchor| anchor.message_id.clone())
        .collect::<HashSet<_>>();

    for anchor in store.anchors.iter_mut().filter(|anchor| anchor.pending) {
        let Some(message_id) = find_matching_user_message_id(session, anchor, &used_message_ids)
        else {
            continue;
        };
        used_message_ids.insert(message_id.clone());
        anchor.message_id = message_id;
        anchor.pending = false;
    }

    save_store(&session.id, &store)
}

pub fn anchor_for_message(session_id: &str, message_id: &str) -> Result<Option<RollbackAnchor>> {
    Ok(load_store(session_id)?
        .anchors
        .into_iter()
        .find(|anchor| anchor.message_id == message_id && !anchor.pending))
}

pub fn preview_rollback(session_id: &str, message_id: &str) -> Result<RollbackPreview> {
    let Some(anchor) = anchor_for_message(session_id, message_id)? else {
        return Ok(RollbackPreview {
            session_id: session_id.to_string(),
            message_id: message_id.to_string(),
            available: false,
            checkpoint_at: None,
            removed_message_count: 0,
            changed_files: Vec::new(),
            unavailable_reason: Some("No rollback checkpoint exists for this message.".to_string()),
        });
    };
    let session = Session::load(session_id)?;
    let removed_message_count = visible_removed_count_from_message(&session, message_id)
        .ok_or_else(|| anyhow!("message not found in session: {message_id}"))?;
    let changed_files = changed_files_since_checkpoint(&anchor)?
        .into_iter()
        .map(|path| RollbackChangedFile { path })
        .collect();
    Ok(RollbackPreview {
        session_id: session_id.to_string(),
        message_id: message_id.to_string(),
        available: true,
        checkpoint_at: Some(anchor.checkpoint_at),
        removed_message_count,
        changed_files,
        unavailable_reason: None,
    })
}

pub fn restore_workspace(anchor: &RollbackAnchor) -> Result<usize> {
    let changed = changed_files_since_checkpoint(anchor)?.len();
    let working_dir = PathBuf::from(&anchor.working_dir);
    let repo = ShadowGitRepo::new(&working_dir)?;
    run_git(
        repo.git_dir(),
        &working_dir,
        ["reset", "--hard", &anchor.checkpoint_hash],
    )?;
    run_git(repo.git_dir(), &working_dir, ["clean", "-fd", "--", "."])?;
    Ok(changed)
}

pub fn truncate_session_before_message(
    session_id: &str,
    message_id: &str,
) -> Result<(Session, usize)> {
    let mut session = Session::load(session_id)?;
    let Some((stored_index, visible_index, visible_count)) =
        locate_visible_message(&session, message_id)
    else {
        bail!("message not found in session: {message_id}");
    };
    let removed = visible_count.saturating_sub(visible_index);
    session.truncate_messages(stored_index);
    session.provider_session_id = None;
    session.compaction = None;
    session.updated_at = Utc::now();
    session.save()?;
    prune_anchors_to_session(&session)?;
    Ok((session, removed))
}

fn changed_files_since_checkpoint(anchor: &RollbackAnchor) -> Result<Vec<String>> {
    let working_dir = PathBuf::from(&anchor.working_dir);
    validate_working_dir(&working_dir)?;
    let repo = ShadowGitRepo::new(&working_dir)?;
    run_git(
        repo.git_dir(),
        &working_dir,
        ["add", "-A", "--ignore-errors", "."],
    )?;
    let mut paths = HashSet::new();
    for args in [
        vec!["diff", "--name-only", &anchor.checkpoint_hash, "--"],
        vec![
            "diff",
            "--cached",
            "--name-only",
            &anchor.checkpoint_hash,
            "--",
        ],
        vec!["ls-files", "--others", "--exclude-standard"],
    ] {
        for path in run_git_capture(repo.git_dir(), &working_dir, args)? {
            if !path.trim().is_empty() {
                paths.insert(path);
            }
        }
    }
    let mut paths = paths.into_iter().collect::<Vec<_>>();
    paths.sort();
    Ok(paths)
}

fn create_checkpoint(working_dir: &Path) -> Result<String> {
    let repo = ShadowGitRepo::init(working_dir)?;
    run_git(
        repo.git_dir(),
        working_dir,
        ["add", "-A", "--ignore-errors", "."],
    )?;
    let commit = Command::new("git")
        .arg("--git-dir")
        .arg(repo.git_dir())
        .arg("--work-tree")
        .arg(working_dir)
        .args([
            "commit",
            "--allow-empty",
            "--no-verify",
            "-m",
            "lyra-agent-rollback",
        ])
        .output()
        .context("failed to create rollback checkpoint")?;
    if !commit.status.success() {
        bail!(
            "failed to create rollback checkpoint: {}",
            String::from_utf8_lossy(&commit.stderr).trim()
        );
    }
    let head = Command::new("git")
        .arg("--git-dir")
        .arg(repo.git_dir())
        .arg("--work-tree")
        .arg(working_dir)
        .args(["rev-parse", "HEAD"])
        .output()
        .context("failed to read rollback checkpoint hash")?;
    if !head.status.success() {
        bail!(
            "failed to read rollback checkpoint hash: {}",
            String::from_utf8_lossy(&head.stderr).trim()
        );
    }
    Ok(String::from_utf8_lossy(&head.stdout).trim().to_string())
}

struct ShadowGitRepo {
    git_dir: PathBuf,
}

impl ShadowGitRepo {
    fn new(working_dir: &Path) -> Result<Self> {
        Ok(Self {
            git_dir: checkpoint_repo_dir(working_dir)?.join(".git"),
        })
    }

    fn init(working_dir: &Path) -> Result<Self> {
        let repo_dir = checkpoint_repo_dir(working_dir)?;
        fs::create_dir_all(&repo_dir)?;
        let git_dir = repo_dir.join(".git");
        if !git_dir.exists() {
            let output = Command::new("git")
                .arg("init")
                .arg(&repo_dir)
                .output()
                .context("failed to initialize rollback shadow git")?;
            if !output.status.success() {
                bail!(
                    "failed to initialize rollback shadow git: {}",
                    String::from_utf8_lossy(&output.stderr).trim()
                );
            }
        }
        run_git(
            &git_dir,
            working_dir,
            ["config", "core.worktree", &working_dir.to_string_lossy()],
        )?;
        run_git(&git_dir, working_dir, ["config", "commit.gpgSign", "false"])?;
        run_git(
            &git_dir,
            working_dir,
            ["config", "user.name", "Lyra Agent Checkpoint"],
        )?;
        run_git(
            &git_dir,
            working_dir,
            ["config", "user.email", "checkpoint@lyra.local"],
        )?;
        write_excludes(&git_dir)?;
        Ok(Self { git_dir })
    }

    fn git_dir(&self) -> &Path {
        &self.git_dir
    }
}

fn run_git<I, S>(git_dir: &Path, working_dir: &Path, args: I) -> Result<()>
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    let output = Command::new("git")
        .arg("--git-dir")
        .arg(git_dir)
        .arg("--work-tree")
        .arg(working_dir)
        .args(args)
        .output()
        .context("failed to run git")?;
    if output.status.success() {
        Ok(())
    } else {
        bail!("{}", String::from_utf8_lossy(&output.stderr).trim())
    }
}

fn run_git_capture<I, S>(git_dir: &Path, working_dir: &Path, args: I) -> Result<Vec<String>>
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    let output = Command::new("git")
        .arg("--git-dir")
        .arg(git_dir)
        .arg("--work-tree")
        .arg(working_dir)
        .args(args)
        .output()
        .context("failed to run git")?;
    if !output.status.success() {
        bail!("{}", String::from_utf8_lossy(&output.stderr).trim());
    }
    Ok(String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(ToOwned::to_owned)
        .collect())
}

fn checkpoint_repo_dir(working_dir: &Path) -> Result<PathBuf> {
    let mut hasher = Sha256::new();
    hasher.update(working_dir.to_string_lossy().as_bytes());
    let hash = hex::encode(hasher.finalize());
    Ok(crate::storage::jcode_dir()?
        .join("rollback")
        .join("worktrees")
        .join(&hash[..24]))
}

fn anchor_store_path(session_id: &str) -> Result<PathBuf> {
    Ok(crate::storage::jcode_dir()?
        .join("rollback")
        .join("anchors")
        .join(format!("{session_id}.json")))
}

fn load_store(session_id: &str) -> Result<RollbackAnchorStore> {
    let path = anchor_store_path(session_id)?;
    if !path.exists() {
        return Ok(RollbackAnchorStore::default());
    }
    let text = fs::read_to_string(&path)?;
    Ok(serde_json::from_str(&text)?)
}

fn save_store(session_id: &str, store: &RollbackAnchorStore) -> Result<()> {
    let path = anchor_store_path(session_id)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(path, serde_json::to_vec_pretty(store)?)?;
    Ok(())
}

fn upsert_anchor(anchor: RollbackAnchor) -> Result<()> {
    let session_id = anchor.session_id.clone();
    let mut store = load_store(&session_id)?;
    store.anchors.retain(|existing| existing.id != anchor.id);
    store.anchors.push(anchor);
    save_store(&session_id, &store)
}

fn prune_anchors_to_session(session: &Session) -> Result<()> {
    let valid_ids = session
        .messages
        .iter()
        .filter(|message| is_visible_message(message))
        .map(|message| message.id.clone())
        .collect::<HashSet<_>>();
    let mut store = load_store(&session.id)?;
    store
        .anchors
        .retain(|anchor| valid_ids.contains(&anchor.message_id) && !anchor.pending);
    save_store(&session.id, &store)
}

fn find_matching_user_message_id(
    session: &Session,
    anchor: &RollbackAnchor,
    used_message_ids: &HashSet<String>,
) -> Option<String> {
    session
        .messages
        .iter()
        .filter(|message| {
            message.role == Role::User
                && is_visible_message(message)
                && !used_message_ids.contains(&message.id)
                && message_text(message).trim() == anchor.user_text.trim()
        })
        .filter(|message| {
            message
                .timestamp
                .map(|timestamp| timestamp >= anchor.checkpoint_at - chrono::Duration::minutes(5))
                .unwrap_or(true)
        })
        .last()
        .map(|message| message.id.clone())
}

fn visible_removed_count_from_message(session: &Session, message_id: &str) -> Option<usize> {
    locate_visible_message(session, message_id)
        .map(|(_, visible_index, visible_count)| visible_count.saturating_sub(visible_index))
}

fn locate_visible_message(session: &Session, message_id: &str) -> Option<(usize, usize, usize)> {
    let visible_count = session
        .messages
        .iter()
        .filter(|message| is_visible_message(message))
        .count();
    let mut visible_index = 0usize;
    for (stored_index, message) in session.messages.iter().enumerate() {
        if !is_visible_message(message) {
            continue;
        }
        if message.id == message_id {
            return Some((stored_index, visible_index, visible_count));
        }
        visible_index += 1;
    }
    None
}

fn message_text(message: &crate::session::StoredMessage) -> String {
    message
        .content
        .iter()
        .filter_map(|block| match block {
            ContentBlock::Text { text, .. } => Some(text.clone()),
            ContentBlock::Image { .. } => Some("[image]".to_string()),
            ContentBlock::Reasoning { .. }
            | ContentBlock::ToolUse { .. }
            | ContentBlock::ToolResult { .. }
            | ContentBlock::OpenAICompaction { .. } => None,
        })
        .filter(|text| !text.trim().is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

fn is_visible_message(message: &crate::session::StoredMessage) -> bool {
    message.display_role.is_none() && !message_text(message).trim().is_empty()
}

fn session_working_dir(session: &Session) -> Result<PathBuf> {
    let path = session
        .working_dir
        .as_ref()
        .map(PathBuf::from)
        .unwrap_or(std::env::current_dir()?);
    Ok(path)
}

fn validate_working_dir(path: &Path) -> Result<()> {
    let canonical = path.canonicalize()?;
    if !canonical.is_dir() {
        bail!(
            "rollback working directory is not a directory: {}",
            path.display()
        );
    }
    if canonical.parent().is_none() {
        bail!("refusing to checkpoint filesystem root");
    }
    if let Some(home) = dirs::home_dir().and_then(|home| home.canonicalize().ok())
        && canonical == home
    {
        bail!("refusing to checkpoint the home directory directly");
    }
    Ok(())
}

fn write_excludes(git_dir: &Path) -> Result<()> {
    let info_dir = git_dir.join("info");
    fs::create_dir_all(&info_dir)?;
    fs::write(info_dir.join("exclude"), DEFAULT_EXCLUDES.join("\n"))?;
    Ok(())
}

const DEFAULT_EXCLUDES: &[&str] = &[
    ".git/",
    "**/.git/",
    "**/.git/**",
    "node_modules/",
    "target/",
    "dist/",
    "build/",
    "out/",
    ".next/",
    ".nuxt/",
    ".cache/",
    ".pytest_cache/",
    "coverage/",
    "tmp/",
    "temp/",
    ".env*",
    "**/.env*",
    "*.env*",
    "*.local",
    "*.log",
    "*.tmp",
    "*.temp",
    "*.cache",
    "*.lock",
    "*.png",
    "*.jpg",
    "*.jpeg",
    "*.gif",
    "*.webp",
    "*.avif",
    "*.mp4",
    "*.mov",
    "*.mp3",
    "*.wav",
    "*.zip",
    "*.tar",
    "*.gz",
    "*.rar",
    "*.7z",
    "*.dmg",
    "*.sqlite",
    "*.db",
];

#[cfg(test)]
mod tests {
    use super::*;

    fn text_block(text: &str) -> Vec<ContentBlock> {
        vec![ContentBlock::Text {
            text: text.to_string(),
            cache_control: None,
        }]
    }

    #[test]
    fn shadow_git_restores_modified_deleted_and_created_files() {
        let _env = crate::storage::lock_test_env();
        let home = tempfile::tempdir().expect("temp jcode home");
        unsafe {
            std::env::set_var("JCODE_HOME", home.path());
        }
        let work = tempfile::tempdir().expect("work dir");
        fs::write(work.path().join("a.txt"), "before").expect("write a");
        fs::write(work.path().join("delete.txt"), "keep").expect("write delete");

        let hash = create_checkpoint(work.path()).expect("checkpoint");
        fs::write(work.path().join("a.txt"), "after").expect("modify a");
        fs::remove_file(work.path().join("delete.txt")).expect("delete file");
        fs::write(work.path().join("created.txt"), "new").expect("create file");

        let anchor = RollbackAnchor {
            id: "rollback-test".to_string(),
            session_id: "session-test".to_string(),
            message_id: "message-test".to_string(),
            pending: false,
            user_text: "test".to_string(),
            checkpoint_hash: hash,
            checkpoint_at: Utc::now(),
            working_dir: work.path().to_string_lossy().to_string(),
        };
        let changed = restore_workspace(&anchor).expect("restore");
        assert!(changed >= 3);
        assert_eq!(
            fs::read_to_string(work.path().join("a.txt")).unwrap(),
            "before"
        );
        assert_eq!(
            fs::read_to_string(work.path().join("delete.txt")).unwrap(),
            "keep"
        );
        assert!(!work.path().join("created.txt").exists());
    }

    #[test]
    fn binds_pending_anchor_and_truncates_before_user_message() {
        let _env = crate::storage::lock_test_env();
        let home = tempfile::tempdir().expect("temp jcode home");
        unsafe {
            std::env::set_var("JCODE_HOME", home.path());
        }
        let work = tempfile::tempdir().expect("work dir");
        fs::write(work.path().join("tracked.txt"), "before").expect("write tracked");

        let mut session = Session::create(None, Some("rollback test".to_string()));
        session.working_dir = Some(work.path().to_string_lossy().to_string());
        let session_id = session.id.clone();
        session.save().expect("save session");

        create_anchor_for_user_message(&session_id, "temporary-ui-message", "second")
            .expect("create anchor");

        let mut session = Session::load(&session_id).expect("load session");
        let _first = session.add_message(Role::User, text_block("first"));
        let _first_reply = session.add_message(Role::Assistant, text_block("reply one"));
        let second = session.add_message(Role::User, text_block("second"));
        let _second_reply = session.add_message(Role::Assistant, text_block("reply two"));
        session.save().expect("save messages");

        bind_pending_anchors(&session).expect("bind anchors");
        let anchor = anchor_for_message(&session_id, &second)
            .expect("read anchor")
            .expect("bound anchor");
        assert!(!anchor.pending);
        assert_eq!(anchor.message_id, second);

        let preview = preview_rollback(&session_id, &second).expect("preview");
        assert!(preview.available);
        assert_eq!(preview.removed_message_count, 2);

        let (truncated, removed) =
            truncate_session_before_message(&session_id, &second).expect("truncate");
        assert_eq!(removed, 2);
        assert_eq!(truncated.messages.len(), 2);
        assert_eq!(message_text(&truncated.messages[0]), "first");
        assert_eq!(message_text(&truncated.messages[1]), "reply one");
        assert!(anchor_for_message(&session_id, &second).unwrap().is_none());
    }
}
