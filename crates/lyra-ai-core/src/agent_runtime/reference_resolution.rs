use super::*;
use crate::storage::{
    sha256_hex, CreateInlineReferenceInput, CreateReferenceResolutionInput, InlineReference,
    ReferenceAnchor, ReferenceResolution,
};
use anyhow::Context;
use rusqlite::{params, OptionalExtension};
use std::fs;
use std::path::{Path, PathBuf};

pub(crate) struct ReferenceResolutionOutcome {
    pub references: Vec<InlineReference>,
    pub resolutions: Vec<ReferenceResolution>,
}

pub(crate) fn resolve_turn_references(
    store: &AiStore,
    session: &AgentSession,
    turn_id: &str,
    user_message_id: &str,
    input: &RuntimeTurnInput,
) -> Result<ReferenceResolutionOutcome> {
    let workspace_root = session.project_root.as_deref();
    let mut references = Vec::new();
    let mut resolutions = Vec::new();
    for seed in inline_reference_seeds(&session.id, turn_id, user_message_id, input) {
        let reference = store.create_inline_reference(seed)?;
        let resolution = resolve_reference(store, workspace_root, &reference)?;
        references.push(reference);
        resolutions.push(resolution);
    }
    Ok(ReferenceResolutionOutcome {
        references,
        resolutions,
    })
}

fn inline_reference_seeds(
    session_id: &str,
    turn_id: &str,
    user_message_id: &str,
    input: &RuntimeTurnInput,
) -> Vec<CreateInlineReferenceInput> {
    if input.parts.is_empty() {
        let base = input.text.chars().count() as i64;
        return input
            .attachments
            .iter()
            .enumerate()
            .map(|(index, attachment)| CreateInlineReferenceInput {
                session_id: session_id.to_string(),
                runtime_turn_id: turn_id.to_string(),
                user_message_id: user_message_id.to_string(),
                kind: reference_kind(&attachment.kind, &attachment.path),
                target_ref: attachment.path.clone(),
                label: Some(attachment.name.clone()),
                anchor: ReferenceAnchor {
                    insertion_index: index as i64,
                    char_start: base + index as i64,
                    char_end: base + index as i64,
                    source_part_index: index as i64,
                },
            })
            .collect();
    }

    let mut seeds = Vec::new();
    let mut char_offset = 0_i64;
    for (part_index, part) in input.parts.iter().enumerate() {
        match part {
            RuntimeTurnInputPart::Text { text } => {
                char_offset += text.chars().count() as i64;
            }
            RuntimeTurnInputPart::Attachment { attachment } => {
                let index = seeds.len() as i64;
                seeds.push(CreateInlineReferenceInput {
                    session_id: session_id.to_string(),
                    runtime_turn_id: turn_id.to_string(),
                    user_message_id: user_message_id.to_string(),
                    kind: reference_kind(&attachment.kind, &attachment.path),
                    target_ref: attachment.path.clone(),
                    label: Some(attachment.name.clone()),
                    anchor: ReferenceAnchor {
                        insertion_index: index,
                        char_start: char_offset,
                        char_end: char_offset,
                        source_part_index: part_index as i64,
                    },
                });
            }
        }
    }
    seeds
}

fn reference_kind(kind: &str, target_ref: &str) -> String {
    let normalized = kind.trim();
    if matches!(normalized, "message" | "ai_thread") || target_ref.starts_with("message:") {
        return "message".to_string();
    }
    if normalized == "artifact" || target_ref.starts_with("artifact:") {
        return "artifact".to_string();
    }
    if normalized == "tool_result" || target_ref.starts_with("tool_result:") {
        return "tool_result".to_string();
    }
    "file".to_string()
}

fn resolve_reference(
    store: &AiStore,
    workspace_root: Option<&str>,
    reference: &InlineReference,
) -> Result<ReferenceResolution> {
    let result = match reference.kind.as_str() {
        "file" | "file_range" => resolve_file_reference(workspace_root, &reference.target_ref),
        "message" => resolve_message_reference(store, &reference.session_id, &reference.target_ref),
        "artifact" => {
            resolve_artifact_reference(store, &reference.session_id, &reference.target_ref)
        }
        "tool_result" => {
            resolve_tool_result_reference(store, &reference.session_id, &reference.target_ref)
        }
        other => ReferenceResolveDraft::unresolved(
            None,
            "unsupported_reference_kind",
            json!({ "kind": other }),
        ),
    };
    store.create_reference_resolution(CreateReferenceResolutionInput {
        inline_reference_id: reference.inline_reference_id.clone(),
        session_id: reference.session_id.clone(),
        runtime_turn_id: reference.runtime_turn_id.clone(),
        kind: reference.kind.clone(),
        target_ref: reference.target_ref.clone(),
        status: result.status,
        resolved_ref: result.resolved_ref,
        content_hash: result.content_hash,
        content_bytes: result.content_bytes,
        reason: result.reason,
        metadata: result.metadata,
    })
}

struct ReferenceResolveDraft {
    status: String,
    resolved_ref: Option<String>,
    content_hash: Option<String>,
    content_bytes: Option<i64>,
    reason: Option<String>,
    metadata: Value,
}

impl ReferenceResolveDraft {
    fn resolved(
        resolved_ref: impl Into<String>,
        content_hash: Option<String>,
        content_bytes: Option<i64>,
        metadata: Value,
    ) -> Self {
        Self {
            status: "resolved".to_string(),
            resolved_ref: Some(resolved_ref.into()),
            content_hash,
            content_bytes,
            reason: None,
            metadata,
        }
    }

    fn unresolved(resolved_ref: Option<String>, reason: &str, metadata: Value) -> Self {
        Self {
            status: "unresolved".to_string(),
            resolved_ref,
            content_hash: None,
            content_bytes: None,
            reason: Some(reason.to_string()),
            metadata,
        }
    }

    fn blocked(reason: &str, metadata: Value) -> Self {
        Self {
            status: "permission_blocked".to_string(),
            resolved_ref: None,
            content_hash: None,
            content_bytes: None,
            reason: Some(reason.to_string()),
            metadata,
        }
    }
}

fn resolve_file_reference(workspace_root: Option<&str>, target_ref: &str) -> ReferenceResolveDraft {
    let Some(root) = workspace_root.and_then(trim_to_string) else {
        return ReferenceResolveDraft::unresolved(None, "workspace_root_missing", json!({}));
    };
    let root_path = PathBuf::from(&root);
    let Ok(canonical_root) = root_path.canonicalize() else {
        return ReferenceResolveDraft::unresolved(None, "workspace_root_unavailable", json!({}));
    };
    if target_ref_escapes_workspace(&canonical_root, target_ref) {
        return ReferenceResolveDraft::blocked(
            "outside_workspace_or_symlink_escape",
            json!({ "workspaceRoot": canonical_root.display().to_string() }),
        );
    }
    let candidate = file_target_path(&canonical_root, target_ref);
    let Ok(canonical_target) = candidate.canonicalize() else {
        return ReferenceResolveDraft::unresolved(
            Some(candidate.display().to_string()),
            "reference_deleted_or_unavailable",
            json!({ "workspaceRoot": canonical_root.display().to_string() }),
        );
    };
    if canonical_target.starts_with(&canonical_root) == false {
        return ReferenceResolveDraft::blocked(
            "outside_workspace_or_symlink_escape",
            json!({
                "workspaceRoot": canonical_root.display().to_string(),
                "canonicalTarget": canonical_target.display().to_string()
            }),
        );
    }
    let Ok(metadata) = fs::metadata(&canonical_target) else {
        return ReferenceResolveDraft::unresolved(
            Some(canonical_target.display().to_string()),
            "reference_metadata_unavailable",
            json!({}),
        );
    };
    if metadata.is_file() == false {
        return ReferenceResolveDraft::unresolved(
            Some(canonical_target.display().to_string()),
            "reference_is_not_file",
            json!({ "isDirectory": metadata.is_dir() }),
        );
    }
    let content_bytes = i64::try_from(metadata.len()).ok();
    let content_hash = if metadata.len() <= 1024 * 1024 {
        fs::read(&canonical_target)
            .ok()
            .map(|bytes| sha256_hex(&bytes))
    } else {
        None
    };
    ReferenceResolveDraft::resolved(
        canonical_target.display().to_string(),
        content_hash,
        content_bytes,
        json!({ "workspaceRoot": canonical_root.display().to_string() }),
    )
}

fn target_ref_escapes_workspace(root: &Path, target_ref: &str) -> bool {
    let stripped = target_ref.strip_prefix("file://").unwrap_or(target_ref);
    let path = PathBuf::from(stripped);
    if path.components().any(|component| {
        matches!(
            component,
            std::path::Component::ParentDir | std::path::Component::Prefix(_)
        )
    }) {
        return true;
    }
    if path.is_absolute() == false {
        return false;
    }
    canonical_existing_ancestor(&path)
        .map(|ancestor| ancestor.starts_with(root) == false)
        .unwrap_or(true)
}

fn file_target_path(root: &Path, target_ref: &str) -> PathBuf {
    let stripped = target_ref.strip_prefix("file://").unwrap_or(target_ref);
    let path = PathBuf::from(stripped);
    if path.is_absolute() {
        path
    } else {
        root.join(path)
    }
}

fn canonical_existing_ancestor(path: &Path) -> Option<PathBuf> {
    let mut current = Some(path);
    while let Some(candidate) = current {
        if let Ok(canonical) = candidate.canonicalize() {
            return Some(canonical);
        }
        current = candidate.parent();
    }
    None
}

fn resolve_message_reference(
    store: &AiStore,
    session_id: &str,
    target_ref: &str,
) -> ReferenceResolveDraft {
    let message_id = normalize_prefixed_ref(target_ref, &["message:", "app://ai/message/"]);
    let row = store
        .with_session_conn(session_id, |conn| {
            conn.query_row(
                "SELECT content_raw, created_at_ms FROM session_dialog WHERE msg_id = ?1",
                params![message_id],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)),
            )
            .optional()
            .context("failed to resolve message reference")
        })
        .ok()
        .flatten();
    let Some((content, created_at)) = row else {
        return ReferenceResolveDraft::unresolved(
            None,
            "message_not_found_in_session_dialog",
            json!({}),
        );
    };
    ReferenceResolveDraft::resolved(
        message_id,
        Some(sha256_hex(content.as_bytes())),
        Some(content.len() as i64),
        json!({ "messageCreatedAt": created_at }),
    )
}

fn resolve_artifact_reference(
    store: &AiStore,
    session_id: &str,
    target_ref: &str,
) -> ReferenceResolveDraft {
    let artifact_id = normalize_prefixed_ref(target_ref, &["artifact:", "app://ai/artifact/"]);
    let row = store
        .with_session_conn(session_id, |conn| {
            conn.query_row(
                "SELECT kind, status, content_ref, created_at_ms
                 FROM artifact_record
                 WHERE session_id = ?1 AND artifact_id = ?2",
                params![session_id, artifact_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, i64>(3)?,
                    ))
                },
            )
            .optional()
            .context("failed to resolve artifact reference")
        })
        .ok()
        .flatten();
    let Some((kind, status, content_ref, created_at)) = row else {
        return ReferenceResolveDraft::unresolved(
            None,
            "artifact_not_found_or_cross_session",
            json!({}),
        );
    };
    if status == "superseded_by_rollback" {
        return ReferenceResolveDraft::unresolved(
            Some(artifact_id.to_string()),
            "artifact_superseded",
            json!({ "kind": kind }),
        );
    }
    ReferenceResolveDraft::resolved(
        artifact_id,
        None,
        None,
        json!({ "kind": kind, "status": status, "contentRef": content_ref, "createdAt": created_at }),
    )
}

fn resolve_tool_result_reference(
    store: &AiStore,
    session_id: &str,
    target_ref: &str,
) -> ReferenceResolveDraft {
    let result_ref = normalize_prefixed_ref(target_ref, &["tool_result:", "app://ai/tool-result/"]);
    let row = store
        .with_session_conn(session_id, |conn| {
            conn.query_row(
                "SELECT tool_path, status, content_sha256, content_bytes, created_at_ms
                 FROM tool_result_blob
                 WHERE result_ref = ?1",
                params![result_ref],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, i64>(3)?,
                        row.get::<_, i64>(4)?,
                    ))
                },
            )
            .optional()
            .context("failed to resolve tool result reference")
        })
        .ok()
        .flatten();
    let Some((tool_path, status, hash, bytes, created_at)) = row else {
        return ReferenceResolveDraft::unresolved(
            None,
            "tool_result_not_found_or_cross_session",
            json!({}),
        );
    };
    ReferenceResolveDraft::resolved(
        result_ref,
        Some(hash),
        Some(bytes),
        json!({ "toolPath": tool_path, "status": status, "createdAt": created_at }),
    )
}

fn normalize_prefixed_ref<'a>(value: &'a str, prefixes: &[&str]) -> &'a str {
    for prefix in prefixes {
        if let Some(stripped) = value.strip_prefix(prefix) {
            return stripped;
        }
    }
    value
}
