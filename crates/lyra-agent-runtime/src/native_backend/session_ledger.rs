use super::*;
use sha2::{Digest, Sha256};
use std::{
    ffi::OsStr,
    fs::OpenOptions,
    io::{BufReader, Write as _},
};

const PREVIEW_CHARS: usize = 160;
const RECENT_COMMIT_LIMIT: usize = 5;
const DIAGNOSTIC_LIMIT: usize = 12;

pub(crate) fn ledger_dir(root: &Path, session_id: &str) -> PathBuf {
    session_dir(root, session_id).join(".ledger")
}

pub(crate) fn session_ledger_summary(root: &Path, session_id: &str) -> Value {
    let dir = ledger_dir(root, session_id);
    let mut diagnostics = read_recent_jsonl(&dir.join("diagnostics.jsonl"), DIAGNOSTIC_LIMIT);
    let enabled = dir.join(".git").is_dir();
    let head = if enabled {
        match run_git(&dir, &git_binary(), ["rev-parse", "--short=12", "HEAD"]) {
            Ok(value) => string_value(value.trim()),
            Err(error) => {
                diagnostics.push(git_diagnostic("git_head_failed", error));
                Value::Null
            }
        }
    } else {
        Value::Null
    };
    let commit_count = if enabled {
        match run_git(&dir, &git_binary(), ["rev-list", "--count", "HEAD"]) {
            Ok(value) => value
                .trim()
                .parse::<u64>()
                .ok()
                .map(Value::from)
                .unwrap_or(Value::Null),
            Err(error) => {
                diagnostics.push(git_diagnostic("git_count_failed", error));
                Value::Null
            }
        }
    } else {
        Value::Null
    };
    let last_event_at = read_last_event_at(&dir.join("events.jsonl")).unwrap_or(Value::Null);
    let recent_commits = if enabled {
        recent_commits(&dir, &mut diagnostics)
    } else {
        Vec::new()
    };

    json!({
        "enabled": enabled,
        "path": dir.display().to_string(),
        "head": head,
        "commitCount": commit_count,
        "lastEventAt": last_event_at,
        "recentCommits": recent_commits,
        "diagnostics": diagnostics,
    })
}

pub(crate) fn record_session_created(root: &Path, session: &NativeSession) -> Value {
    record_event(root, session, "session_created", Value::Null)
}

pub(crate) fn record_turn_finished(
    root: &Path,
    session: &NativeSession,
    turn_id: &str,
    status: &str,
    failure: Option<&str>,
) -> Value {
    record_event(
        root,
        session,
        "turn_finished",
        json!({
            "turnId": turn_id,
            "status": status,
            "failure": failure.map(redacted_text_value).unwrap_or(Value::Null),
        }),
    )
}

pub(crate) fn record_session_trimmed(root: &Path, session: &NativeSession, detail: Value) -> Value {
    record_event(root, session, "session_trimmed", detail)
}

pub(crate) fn record_memory_candidate_event(
    root: &Path,
    session_id: &str,
    turn_id: Option<&str>,
    event_type: &str,
    candidate: &MemoryCandidate,
    detail: Value,
) -> Value {
    if !session_dir(root, session_id).is_dir() {
        return json!({
            "enabled": false,
            "path": ledger_dir(root, session_id).display().to_string(),
            "head": Value::Null,
            "commitCount": Value::Null,
            "lastEventAt": Value::Null,
            "recentCommits": [],
            "diagnostics": [{
                "code": "session_dir_missing",
                "message": "Session ledger was not initialized because the session directory does not exist.",
                "createdAt": now(),
            }],
        });
    }
    let session = session_for_memory_event(root, session_id);
    let detail = json!({
        "turnId": turn_id,
        "candidate": memory_candidate_ledger_json(candidate),
        "detail": detail,
    });
    record_event(root, &session, event_type, detail)
}

pub(crate) fn session_id_from_memory_source_ref(source_ref: Option<&str>) -> Option<String> {
    let source_ref = source_ref?.trim();
    let session_id = source_ref.split(':').next().unwrap_or(source_ref).trim();
    (!session_id.is_empty() && session_id.starts_with("session-")).then(|| session_id.to_string())
}

fn record_event(root: &Path, session: &NativeSession, event_type: &str, detail: Value) -> Value {
    record_event_with_git(root, session, event_type, detail, &git_binary())
}

fn record_event_with_git(
    root: &Path,
    session: &NativeSession,
    event_type: &str,
    detail: Value,
    git: &str,
) -> Value {
    let dir = ledger_dir(root, &session.id);
    let mut diagnostics = Vec::new();
    if let Err(error) = fs::create_dir_all(&dir) {
        diagnostics.push(io_diagnostic(
            "ledger_dir_create_failed",
            "Failed to create the session ledger directory.",
            error,
        ));
        return summary_with_diagnostics(root, &session.id, diagnostics);
    }

    write_gitignore(&dir, &mut diagnostics);
    ensure_git_repo(&dir, git, &mut diagnostics);

    let events_path = dir.join("events.jsonl");
    let needs_created_event = !events_path.is_file() && event_type != "session_created";
    if needs_created_event {
        append_event(
            &events_path,
            build_event(session, "session_created", Value::Null),
            &mut diagnostics,
        );
    }
    append_event(
        &events_path,
        build_event(session, event_type, detail),
        &mut diagnostics,
    );

    if event_type == "session_trimmed" {
        copy_cut_manifest(root, &session.id, &dir, &mut diagnostics);
    }
    write_session_index(root, session, &dir, git, &mut diagnostics);
    append_diagnostics(&dir, &diagnostics);

    if dir.join(".git").is_dir() {
        commit_ledger(&dir, git, event_type, &mut diagnostics);
        append_diagnostics(&dir, &diagnostics);
    }

    summary_with_diagnostics(root, &session.id, diagnostics)
}

fn write_gitignore(dir: &Path, diagnostics: &mut Vec<Value>) {
    let path = dir.join(".gitignore");
    let content = [
        "*.sqlite",
        "*.sqlite-*",
        "*.db",
        "*.db-*",
        "*.raw",
        "*.log",
        "tool-output/",
        "cut-packs/",
        "",
    ]
    .join("\n");
    if let Err(error) = fs::write(&path, content) {
        diagnostics.push(io_diagnostic(
            "ledger_gitignore_write_failed",
            "Failed to write the session ledger .gitignore.",
            error,
        ));
    }
}

fn ensure_git_repo(dir: &Path, git: &str, diagnostics: &mut Vec<Value>) {
    if !dir.join(".git").is_dir()
        && let Err(error) = run_git(dir, git, ["init", "-q"])
    {
        diagnostics.push(git_diagnostic("git_init_failed", error));
        return;
    }
    if let Err(error) = run_git(dir, git, ["config", "user.name", "Lyra"]) {
        diagnostics.push(git_diagnostic("git_config_name_failed", error));
    }
    if let Err(error) = run_git(dir, git, ["config", "user.email", "lyra@local"]) {
        diagnostics.push(git_diagnostic("git_config_email_failed", error));
    }
}

fn append_event(path: &Path, event: Value, diagnostics: &mut Vec<Value>) {
    let Some(parent) = path.parent() else {
        return;
    };
    if let Err(error) = fs::create_dir_all(parent) {
        diagnostics.push(io_diagnostic(
            "ledger_event_dir_create_failed",
            "Failed to create the session ledger event directory.",
            error,
        ));
        return;
    }
    let line = match serde_json::to_string(&event) {
        Ok(line) => line,
        Err(error) => {
            diagnostics.push(json!({
                "code": "ledger_event_serialize_failed",
                "message": "Failed to serialize a session ledger event.",
                "error": error.to_string(),
                "createdAt": now(),
            }));
            return;
        }
    };
    match OpenOptions::new().create(true).append(true).open(path) {
        Ok(mut file) => {
            if let Err(error) = writeln!(file, "{line}") {
                diagnostics.push(io_diagnostic(
                    "ledger_event_write_failed",
                    "Failed to append a session ledger event.",
                    error,
                ));
            }
        }
        Err(error) => diagnostics.push(io_diagnostic(
            "ledger_event_open_failed",
            "Failed to open the session ledger event log.",
            error,
        )),
    }
}

fn build_event(session: &NativeSession, event_type: &str, detail: Value) -> Value {
    json!({
        "eventId": format!("ledger-event-{}", Uuid::new_v4()),
        "eventType": event_type,
        "sessionId": session.id,
        "createdAt": now(),
        "summary": event_summary(session, event_type, &detail),
        "messages": message_previews(session),
        "detail": detail,
    })
}

fn event_summary(session: &NativeSession, event_type: &str, detail: &Value) -> Value {
    json!({
        "eventType": event_type,
        "title": session.snapshot.get("title").cloned().unwrap_or(Value::Null),
        "turnId": detail.get("turnId").cloned().unwrap_or(Value::Null),
        "status": detail.get("status").cloned().unwrap_or(Value::Null),
        "messageCount": session.snapshot.get("messages").and_then(Value::as_array).map(Vec::len).unwrap_or(0),
        "toolCount": session.snapshot.get("tools").and_then(Value::as_array).map(Vec::len).unwrap_or(0),
    })
}

fn message_previews(session: &NativeSession) -> Vec<Value> {
    let messages = session
        .snapshot
        .get("messages")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    messages
        .iter()
        .rev()
        .take(6)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .map(|message| {
            let text = message_text(message);
            let secret_like = secret_guard::contains_secret_material(&text);
            json!({
                "messageId": message.get("id").and_then(Value::as_str).unwrap_or(""),
                "role": message.get("role").and_then(Value::as_str).unwrap_or("runtime"),
                "charCount": text.chars().count(),
                "textHash": if secret_like { Value::Null } else { string_value(format!("sha256:{}", sha256_hex(&text))) },
                "preview": if secret_like {
                    Value::String("[redacted: secret-like content]".to_string())
                } else {
                    Value::String(truncate_preview(&text))
                },
            })
        })
        .collect()
}

fn message_text(message: &Value) -> String {
    // Prefer reconstructing from blocks: a tool-only assistant message carries an
    // empty top-level `text` but real `tool` blocks, so an early return on `text`
    // would record it as a fully empty ledger entry (charCount 0, empty hash).
    // Tool blocks have no text field, so they get a placeholder — mirrors
    // transcript_citations::extract_message_text.
    if let Some(blocks) = message.get("blocks").and_then(Value::as_array) {
        let mut parts = Vec::new();
        for block in blocks {
            match block.get("type").and_then(Value::as_str) {
                Some("tool") => parts.push("[tool activity]".to_string()),
                _ => {
                    if let Some(text) = block.get("text").and_then(Value::as_str)
                        && !text.is_empty()
                    {
                        parts.push(text.to_string());
                    }
                }
            }
        }
        if !parts.is_empty() {
            return parts.join("\n");
        }
    }
    message
        .get("text")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string()
}

fn redacted_text_value(text: &str) -> Value {
    if secret_guard::contains_secret_material(text) {
        json!({
            "charCount": text.chars().count(),
            "textHash": Value::Null,
            "preview": "[redacted: secret-like content]",
        })
    } else {
        json!({
            "charCount": text.chars().count(),
            "textHash": format!("sha256:{}", sha256_hex(text)),
            "preview": truncate_preview(text),
        })
    }
}

fn truncate_preview(text: &str) -> String {
    let normalized = text.split_whitespace().collect::<Vec<_>>().join(" ");
    let mut preview = normalized.chars().take(PREVIEW_CHARS).collect::<String>();
    if normalized.chars().count() > PREVIEW_CHARS {
        preview.push_str("...");
    }
    preview
}

fn copy_cut_manifest(root: &Path, session_id: &str, dir: &Path, diagnostics: &mut Vec<Value>) {
    match cut_store::load_manifest(root, session_id) {
        Ok(manifest) => {
            if let Err(error) = write_json(&dir.join("cuts").join("manifest.json"), &manifest) {
                diagnostics.push(json!({
                    "code": "ledger_cut_manifest_write_failed",
                    "message": "Failed to write the session ledger cut manifest projection.",
                    "error": error.to_string(),
                    "createdAt": now(),
                }));
            }
        }
        Err(error) => diagnostics.push(json!({
            "code": "ledger_cut_manifest_load_failed",
            "message": "Failed to load the session cut manifest for the ledger.",
            "error": error.to_string(),
            "createdAt": now(),
        })),
    }
}

fn write_session_index(
    root: &Path,
    session: &NativeSession,
    dir: &Path,
    git: &str,
    diagnostics: &mut Vec<Value>,
) {
    let cut_count = cut_store::load_manifest(root, &session.id)
        .map(|manifest| manifest.packs.len())
        .unwrap_or(0);
    let memory_events = count_events_with_prefix(&dir.join("events.jsonl"), "memory_");
    let head = if dir.join(".git").is_dir() {
        run_git(dir, git, ["rev-parse", "--short=12", "HEAD"])
            .ok()
            .map(|value| value.trim().to_string())
    } else {
        None
    };
    let value = json!({
        "sessionId": session.id,
        "title": session.snapshot.get("title").cloned().unwrap_or(Value::Null),
        "workingDir": session.snapshot.get("workingDir").cloned().unwrap_or(Value::Null),
        "createdAt": session.created_at,
        "updatedAt": session.snapshot.get("updatedAt").cloned().unwrap_or(Value::Null),
        "counts": {
            "messages": session.snapshot.get("messages").and_then(Value::as_array).map(Vec::len).unwrap_or(0),
            "tools": session.snapshot.get("tools").and_then(Value::as_array).map(Vec::len).unwrap_or(0),
            "cuts": cut_count,
            "memoryEvents": memory_events,
        },
        "head": head,
    });
    if let Err(error) = write_json(&dir.join("session.json"), &value) {
        diagnostics.push(json!({
            "code": "ledger_session_index_write_failed",
            "message": "Failed to write the session ledger index.",
            "error": error.to_string(),
            "createdAt": now(),
        }));
    }
}

fn commit_ledger(dir: &Path, git: &str, event_type: &str, diagnostics: &mut Vec<Value>) {
    let paths = tracked_paths(dir);
    if paths.is_empty() {
        return;
    }
    let add_args = std::iter::once("add".to_string())
        .chain(std::iter::once("--".to_string()))
        .chain(paths.iter().cloned())
        .collect::<Vec<_>>();
    if let Err(error) = run_git_owned(dir, git, &add_args) {
        diagnostics.push(git_diagnostic("git_add_failed", error));
        return;
    }
    let status = match run_git(dir, git, ["status", "--porcelain"]) {
        Ok(status) => status,
        Err(error) => {
            diagnostics.push(git_diagnostic("git_status_failed", error));
            return;
        }
    };
    if status.trim().is_empty() {
        return;
    }
    let message = format!("ledger: {event_type}");
    let args = vec![
        "commit".to_string(),
        "-q".to_string(),
        "-m".to_string(),
        message,
    ];
    if let Err(error) = run_git_owned(dir, git, &args) {
        if !error.contains("nothing to commit") {
            diagnostics.push(git_diagnostic("git_commit_failed", error));
        }
    }
}

fn tracked_paths(dir: &Path) -> Vec<String> {
    [
        ".gitignore",
        "session.json",
        "events.jsonl",
        "cuts/manifest.json",
        "diagnostics.jsonl",
    ]
    .into_iter()
    .filter(|path| dir.join(path).exists())
    .map(str::to_string)
    .collect()
}

fn summary_with_diagnostics(root: &Path, session_id: &str, mut diagnostics: Vec<Value>) -> Value {
    let mut summary = session_ledger_summary(root, session_id);
    if !diagnostics.is_empty() {
        let existing = summary
            .get("diagnostics")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        diagnostics.extend(existing);
        diagnostics.truncate(DIAGNOSTIC_LIMIT);
        summary["diagnostics"] = Value::Array(diagnostics);
    }
    summary
}

fn append_diagnostics(dir: &Path, diagnostics: &[Value]) {
    if diagnostics.is_empty() {
        return;
    }
    let path = dir.join("diagnostics.jsonl");
    let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) else {
        return;
    };
    for diagnostic in diagnostics {
        if let Ok(line) = serde_json::to_string(diagnostic) {
            let _ = writeln!(file, "{line}");
        }
    }
}

fn read_recent_jsonl(path: &Path, limit: usize) -> Vec<Value> {
    let Ok(file) = fs::File::open(path) else {
        return Vec::new();
    };
    let mut values = BufReader::new(file)
        .lines()
        .map_while(Result::ok)
        .filter_map(|line| serde_json::from_str::<Value>(&line).ok())
        .collect::<Vec<_>>();
    if values.len() > limit {
        values = values.split_off(values.len() - limit);
    }
    values
}

fn read_last_event_at(path: &Path) -> Option<Value> {
    read_recent_jsonl(path, 1)
        .pop()
        .and_then(|event| event.get("createdAt").cloned())
}

fn count_events_with_prefix(path: &Path, prefix: &str) -> usize {
    let Ok(file) = fs::File::open(path) else {
        return 0;
    };
    BufReader::new(file)
        .lines()
        .map_while(Result::ok)
        .filter_map(|line| serde_json::from_str::<Value>(&line).ok())
        .filter(|event| {
            event
                .get("eventType")
                .and_then(Value::as_str)
                .is_some_and(|event_type| event_type.starts_with(prefix))
        })
        .count()
}

fn recent_commits(dir: &Path, diagnostics: &mut Vec<Value>) -> Vec<Value> {
    let output = match run_git(
        dir,
        &git_binary(),
        ["log", "-5", "--pretty=format:%H%x1f%h%x1f%s%x1f%cI"],
    ) {
        Ok(output) => output,
        Err(error) => {
            diagnostics.push(git_diagnostic("git_recent_commits_failed", error));
            return Vec::new();
        }
    };
    output
        .lines()
        .take(RECENT_COMMIT_LIMIT)
        .filter_map(|line| {
            let parts = line.split('\x1f').collect::<Vec<_>>();
            (parts.len() == 4).then(|| {
                json!({
                    "hash": parts[0],
                    "shortHash": parts[1],
                    "subject": parts[2],
                    "committedAt": parts[3],
                })
            })
        })
        .collect()
}

fn session_for_memory_event(root: &Path, session_id: &str) -> NativeSession {
    load_session(root, session_id)
        .ok()
        .flatten()
        .unwrap_or_else(|| {
            let timestamp = now();
            NativeSession {
                id: session_id.to_string(),
                snapshot: json!({
                    "id": session_id,
                    "title": DEFAULT_SESSION_TITLE,
                    "sessionKind": "normal",
                    "workingDir": Value::Null,
                    "messages": [],
                    "tools": [],
                    "updatedAt": timestamp,
                }),
                created_at: timestamp,
                saved: false,
                save_label: None,
                archived: false,
                custom_title: None,
                short_name: None,
                runtime_turns: Vec::new(),
                rollback_checkpoints: Vec::new(),
                file_read_state: HashMap::new(),
                dirty: false,
            }
        })
}

fn memory_candidate_ledger_json(candidate: &MemoryCandidate) -> Value {
    json!({
        "candidateId": candidate.id,
        "scope": candidate.scope,
        "category": candidate.category,
        "layer": candidate.layer,
        "valueClass": candidate.value_class,
        "confidence": candidate.confidence,
        "sourceType": candidate.source_type,
        "sourceRef": candidate.source_ref,
        "proposedAction": candidate.proposed_action,
        "conflictWith": candidate.conflict_with,
        "targetId": candidate.target_id,
        "status": candidate.status,
        "createdAt": candidate.created_at,
        "fact": redacted_text_value(&candidate.fact),
    })
}

fn git_binary() -> String {
    env::var("LYRA_SESSION_LEDGER_GIT").unwrap_or_else(|_| "git".to_string())
}

fn run_git<I, S>(dir: &Path, git: &str, args: I) -> Result<String, String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    let args = args.into_iter().collect::<Vec<_>>();
    let output = Command::new(git)
        .args(args.iter().map(AsRef::as_ref))
        .current_dir(dir)
        .output()
        .map_err(|error| format!("failed to start git: {error}"))?;
    if output.status.success() {
        return Ok(String::from_utf8_lossy(&output.stdout).trim().to_string());
    }
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    Err(if stderr.is_empty() { stdout } else { stderr })
}

fn run_git_owned(dir: &Path, git: &str, args: &[String]) -> Result<String, String> {
    run_git(dir, git, args.iter().map(String::as_str))
}

fn git_diagnostic(code: &str, error: String) -> Value {
    json!({
        "code": code,
        "message": "Session ledger Git operation failed.",
        "error": error,
        "createdAt": now(),
    })
}

fn io_diagnostic(code: &str, message: &str, error: std::io::Error) -> Value {
    json!({
        "code": code,
        "message": message,
        "error": error.to_string(),
        "createdAt": now(),
    })
}

fn string_value(value: impl Into<String>) -> Value {
    Value::String(value.into())
}

fn sha256_hex(text: &str) -> String {
    let digest = Sha256::digest(text.as_bytes());
    let mut output = String::with_capacity(digest.len() * 2);
    for byte in digest {
        output.push_str(&format!("{byte:02x}"));
    }
    output
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn test_session(session_id: &str) -> NativeSession {
        NativeSession {
            id: session_id.to_string(),
            snapshot: json!({
                "id": session_id,
                "title": "Ledger Test",
                "sessionKind": "normal",
                "workingDir": "/tmp",
                "messages": [
                    { "id": "msg-user", "role": "user", "text": "hello ledger" },
                    { "id": "msg-secret", "role": "assistant", "text": "password = super-secret-token" }
                ],
                "tools": [],
                "updatedAt": "2026-06-19T00:00:00.000Z"
            }),
            created_at: "2026-06-19T00:00:00.000Z".to_string(),
            saved: false,
            save_label: None,
            archived: false,
            custom_title: None,
            short_name: None,
            runtime_turns: Vec::new(),
            rollback_checkpoints: Vec::new(),
            file_read_state: HashMap::new(),
            dirty: true,
        }
    }

    fn git_available() -> bool {
        Command::new("git")
            .arg("--version")
            .output()
            .is_ok_and(|output| output.status.success())
    }

    #[test]
    fn session_created_initializes_hidden_git_ledger() {
        if !git_available() {
            return;
        }
        let temp = tempdir().expect("tempdir");
        let root = temp.path();
        let session = test_session("session-ledger-created");
        save_session(root, &session).expect("save session");

        let summary = record_session_created(root, &session);
        let dir = ledger_dir(root, &session.id);

        assert!(dir.join(".git").is_dir());
        assert_eq!(summary.get("enabled").and_then(Value::as_bool), Some(true));
        assert!(dir.join("session.json").is_file());
        let events = fs::read_to_string(dir.join("events.jsonl")).expect("events");
        assert!(events.contains("\"eventType\":\"session_created\""));
        let log = run_git(&dir, "git", ["log", "--oneline"]).expect("git log");
        assert!(log.contains("ledger: session_created"));
    }

    #[test]
    fn turn_finished_records_redacted_previews_and_no_sqlite() {
        if !git_available() {
            return;
        }
        let temp = tempdir().expect("tempdir");
        let root = temp.path();
        let session = test_session("session-ledger-turn");
        save_session(root, &session).expect("save session");
        fs::write(
            session_dir(root, &session.id).join("session.sqlite"),
            "not for ledger",
        )
        .expect("write sqlite marker");

        record_turn_finished(root, &session, "turn-ledger", "finished", None);

        let dir = ledger_dir(root, &session.id);
        let events = fs::read_to_string(dir.join("events.jsonl")).expect("events");
        assert!(events.contains("\"eventType\":\"turn_finished\""));
        assert!(events.contains("[redacted: secret-like content]"));
        let tracked = run_git(&dir, "git", ["ls-files"]).expect("git ls-files");
        assert!(!tracked.contains("sqlite"));
        assert!(tracked.contains("events.jsonl"));
    }

    #[test]
    fn git_unavailable_records_diagnostic_without_error() {
        let temp = tempdir().expect("tempdir");
        let root = temp.path();
        let session = test_session("session-ledger-no-git");
        save_session(root, &session).expect("save session");

        let summary = record_event_with_git(
            root,
            &session,
            "session_created",
            Value::Null,
            "/definitely/missing/lyra-ledger-git",
        );

        assert_eq!(summary.get("enabled").and_then(Value::as_bool), Some(false));
        assert!(
            summary
                .get("diagnostics")
                .and_then(Value::as_array)
                .is_some_and(|items| !items.is_empty())
        );
        assert!(ledger_dir(root, &session.id).join("events.jsonl").is_file());
    }
}
