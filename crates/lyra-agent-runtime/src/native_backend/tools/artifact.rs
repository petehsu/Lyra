use super::*;

const ARTIFACT_REF_PREVIEW_CHARS: usize = 600;
const LOW_VALUE_ARTIFACT_RETENTION: Duration = Duration::from_secs(7 * 24 * 60 * 60);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ToolArtifactKind {
    ToolOutput,
    RawData,
    Projection,
    Stdout,
    Stderr,
    Log,
    Diff,
    Snapshot,
    WebPage,
    BrowserScreenshot,
}

impl ToolArtifactKind {
    fn as_str(self) -> &'static str {
        match self {
            Self::ToolOutput => "tool_output",
            Self::RawData => "raw_data",
            Self::Projection => "projection",
            Self::Stdout => "stdout",
            Self::Stderr => "stderr",
            Self::Log => "log",
            Self::Diff => "diff",
            Self::Snapshot => "snapshot",
            Self::WebPage => "web_page",
            Self::BrowserScreenshot => "browser_screenshot",
        }
    }

    fn file_extension(self) -> &'static str {
        match self {
            Self::RawData => "txt",
            Self::Stdout | Self::Stderr | Self::Log | Self::Diff => "log",
            Self::Projection | Self::Snapshot | Self::ToolOutput | Self::WebPage => "txt",
            Self::BrowserScreenshot => "png",
        }
    }
}

#[derive(Clone, Debug)]
pub(crate) struct ToolArtifactStore {
    root: PathBuf,
}

impl ToolArtifactStore {
    pub(crate) fn from_root(root: PathBuf) -> Self {
        Self { root }
    }

    pub(crate) fn from_runtime_state() -> Option<Self> {
        state().lock().ok().map(|state| Self {
            root: state.root.clone(),
        })
    }

    pub(crate) fn write_text(
        &self,
        session_id: &str,
        turn_id: &str,
        tool_call_id: &str,
        kind: ToolArtifactKind,
        content: &str,
    ) -> Option<Value> {
        let artifact_id = format!(
            "artifact-{}-{}-{}",
            sanitize_component(tool_call_id),
            kind.as_str(),
            Uuid::new_v4()
        );
        let dir = self
            .root
            .join("artifacts")
            .join(sanitize_component(session_id))
            .join(sanitize_component(turn_id));
        fs::create_dir_all(&dir).ok()?;
        let path = dir.join(format!("{artifact_id}.{}", kind.file_extension()));
        fs::write(&path, content).ok()?;
        let (preview, preview_truncated) = text_preview(content);
        Some(artifact_ref(
            session_id,
            turn_id,
            &artifact_id,
            kind,
            &path,
            mime_type_for_kind(kind),
            content.len(),
            Some(preview),
            preview_truncated,
        ))
    }

    pub(crate) fn write_bytes(
        &self,
        session_id: &str,
        turn_id: &str,
        tool_call_id: &str,
        kind: ToolArtifactKind,
        extension: &str,
        mime_type: &str,
        bytes: &[u8],
    ) -> Option<Value> {
        let artifact_id = format!(
            "artifact-{}-{}-{}",
            sanitize_component(tool_call_id),
            kind.as_str(),
            Uuid::new_v4()
        );
        let dir = self
            .root
            .join("artifacts")
            .join(sanitize_component(session_id))
            .join(sanitize_component(turn_id));
        fs::create_dir_all(&dir).ok()?;
        let path = dir.join(format!(
            "{artifact_id}.{}",
            sanitize_component(extension.trim_start_matches('.'))
        ));
        fs::write(&path, bytes).ok()?;
        Some(artifact_ref(
            session_id,
            turn_id,
            &artifact_id,
            kind,
            &path,
            mime_type,
            bytes.len(),
            None,
            false,
        ))
    }
}

fn artifact_ref(
    session_id: &str,
    turn_id: &str,
    artifact_id: &str,
    kind: ToolArtifactKind,
    path: &Path,
    mime_type: &str,
    bytes: usize,
    preview: Option<String>,
    preview_truncated: bool,
) -> Value {
    let mut value = json!({
        "id": artifact_id,
        "kind": kind.as_str(),
        "mimeType": mime_type,
        "path": path.display().to_string(),
        "openTarget": {
            "kind": "file",
            "path": path.display().to_string(),
            "label": artifact_open_label(kind),
        },
        "uri": format!(
            "lyra-agent://artifact/{}/{}/{}",
            sanitize_component(session_id),
            sanitize_component(turn_id),
            artifact_id
        ),
        "bytes": bytes,
    });
    if let Some(preview) = preview {
        if let Some(object) = value.as_object_mut() {
            object.insert("preview".to_string(), Value::String(preview));
            object.insert(
                "previewTruncated".to_string(),
                Value::Bool(preview_truncated),
            );
        }
    }
    value
}

fn text_preview(content: &str) -> (String, bool) {
    let mut preview = String::new();
    let mut truncated = false;
    for (index, character) in content.chars().enumerate() {
        if index >= ARTIFACT_REF_PREVIEW_CHARS {
            truncated = true;
            break;
        }
        preview.push(character);
    }
    if truncated {
        preview = preview.trim_end().to_string();
    }
    (preview, truncated)
}

fn artifact_open_label(kind: ToolArtifactKind) -> &'static str {
    match kind {
        ToolArtifactKind::RawData => "Open raw data",
        ToolArtifactKind::Projection => "Open projection",
        ToolArtifactKind::Stdout => "Open stdout",
        ToolArtifactKind::Stderr => "Open stderr",
        ToolArtifactKind::Log => "Open log",
        ToolArtifactKind::Diff => "Open diff",
        ToolArtifactKind::Snapshot => "Open snapshot",
        ToolArtifactKind::WebPage => "Open page artifact",
        ToolArtifactKind::BrowserScreenshot => "Open screenshot",
        ToolArtifactKind::ToolOutput => "Open tool output",
    }
}

impl ToolArtifactStore {
    #[allow(dead_code)]
    pub(crate) fn prune_low_value(
        &self,
        max_age: Duration,
        now: std::time::SystemTime,
    ) -> std::io::Result<usize> {
        let root = self.root.join("artifacts");
        if !root.exists() {
            return Ok(0);
        }
        let mut deleted = 0_usize;
        let mut stack = vec![root];
        while let Some(dir) = stack.pop() {
            for entry in fs::read_dir(&dir)? {
                let entry = entry?;
                let path = entry.path();
                let metadata = entry.metadata()?;
                if metadata.is_dir() {
                    stack.push(path);
                    continue;
                }
                let old_enough = metadata
                    .modified()
                    .ok()
                    .and_then(|modified| now.duration_since(modified).ok())
                    .is_some_and(|age| age >= max_age);
                if old_enough && low_value_artifact_path(&path) {
                    fs::remove_file(&path)?;
                    deleted = deleted.saturating_add(1);
                }
            }
        }
        Ok(deleted)
    }
}

pub(crate) fn write_tool_artifact(
    session_id: &str,
    turn_id: &str,
    tool_call_id: &str,
    content: &str,
) -> Option<Value> {
    write_tool_artifact_with_kind(
        session_id,
        turn_id,
        tool_call_id,
        ToolArtifactKind::ToolOutput,
        content,
    )
}

pub(crate) fn write_tool_artifact_with_kind(
    session_id: &str,
    turn_id: &str,
    tool_call_id: &str,
    kind: ToolArtifactKind,
    content: &str,
) -> Option<Value> {
    ToolArtifactStore::from_runtime_state()?.write_text(
        session_id,
        turn_id,
        tool_call_id,
        kind,
        content,
    )
}

pub(crate) fn write_tool_artifact_bytes_with_kind(
    session_id: &str,
    turn_id: &str,
    tool_call_id: &str,
    kind: ToolArtifactKind,
    extension: &str,
    mime_type: &str,
    bytes: &[u8],
) -> Option<Value> {
    ToolArtifactStore::from_runtime_state()?.write_bytes(
        session_id,
        turn_id,
        tool_call_id,
        kind,
        extension,
        mime_type,
        bytes,
    )
}

pub(crate) fn prune_low_value_tool_artifacts(root: &Path) -> std::io::Result<usize> {
    ToolArtifactStore::from_root(root.to_path_buf())
        .prune_low_value(LOW_VALUE_ARTIFACT_RETENTION, std::time::SystemTime::now())
}

pub(crate) fn sanitize_component(value: &str) -> String {
    value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '-' | '_') {
                character
            } else {
                '_'
            }
        })
        .collect()
}

fn mime_type_for_kind(kind: ToolArtifactKind) -> &'static str {
    match kind {
        ToolArtifactKind::RawData
        | ToolArtifactKind::ToolOutput
        | ToolArtifactKind::Projection
        | ToolArtifactKind::Stdout
        | ToolArtifactKind::Stderr
        | ToolArtifactKind::Log
        | ToolArtifactKind::Diff
        | ToolArtifactKind::Snapshot
        | ToolArtifactKind::WebPage => "text/plain; charset=utf-8",
        ToolArtifactKind::BrowserScreenshot => "image/png",
    }
}

#[allow(dead_code)]
fn low_value_artifact_path(path: &Path) -> bool {
    let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
        return false;
    };
    name.contains("-raw_data-") || name.contains("-projection-")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn artifact_store_writes_typed_refs_and_prunes_low_value_payloads() {
        let temp = tempfile::tempdir().expect("tempdir");
        let store = ToolArtifactStore {
            root: temp.path().to_path_buf(),
        };
        let raw = store
            .write_text(
                "session/1",
                "turn/1",
                "tool raw",
                ToolArtifactKind::RawData,
                "{\"big\":true}",
            )
            .expect("raw ref");
        let diff = store
            .write_text(
                "session/1",
                "turn/1",
                "tool-diff",
                ToolArtifactKind::Diff,
                "diff --git",
            )
            .expect("diff ref");
        let log = store
            .write_text(
                "session/1",
                "turn/1",
                "tool-log",
                ToolArtifactKind::Log,
                "terminal log",
            )
            .expect("log ref");

        assert_eq!(raw["kind"], "raw_data");
        assert_eq!(raw["mimeType"], "text/plain; charset=utf-8");
        assert_eq!(raw["openTarget"]["kind"], "file");
        assert_eq!(raw["openTarget"]["label"], "Open raw data");
        assert_eq!(raw["preview"], "{\"big\":true}");
        assert_eq!(raw["previewTruncated"], false);
        assert_eq!(diff["kind"], "diff");
        assert_eq!(diff["openTarget"]["label"], "Open diff");
        assert_eq!(log["kind"], "log");
        assert!(PathBuf::from(raw["path"].as_str().unwrap()).exists());
        assert!(PathBuf::from(diff["path"].as_str().unwrap()).exists());
        assert!(PathBuf::from(log["path"].as_str().unwrap()).exists());

        let pruned = store
            .prune_low_value(Duration::from_secs(0), std::time::SystemTime::now())
            .expect("prune");
        assert_eq!(pruned, 1);
        assert!(!PathBuf::from(raw["path"].as_str().unwrap()).exists());
        assert!(PathBuf::from(diff["path"].as_str().unwrap()).exists());
        assert!(PathBuf::from(log["path"].as_str().unwrap()).exists());
    }
}
