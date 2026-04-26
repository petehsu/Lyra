use super::*;
use crate::memories::lyra_truth::ensure_lyra_truth_layout;
use crate::memories::lyra_truth::lyra_truth_root_path;
use lyra_utils_absolute_path::AbsolutePathBuf;
use pretty_assertions::assert_eq;
use rusqlite::Connection;
use rusqlite::params;
use tempfile::tempdir;
use tokio::fs as tokio_fs;

#[tokio::test]
async fn build_memory_tool_developer_instructions_renders_embedded_template() {
    let temp = tempdir().unwrap();
    let lyra_home = AbsolutePathBuf::from_absolute_path(temp.path())
        .expect("absolute temp path")
        .join("lyra");
    let truth_root = lyra_truth_root_path(lyra_home.as_ref());
    ensure_lyra_truth_layout(&truth_root).unwrap();

    let shared_dir = truth_root.join("shared");
    tokio_fs::write(
        shared_dir.join("dynamic_prompt_cache.md"),
        "Derived snapshot for tests.",
    )
    .await
    .unwrap();

    let session_id = "thread-123";
    let session_root = truth_root.join("sessions").join(session_id);
    tokio_fs::create_dir_all(&session_root).await.unwrap();
    let connection = Connection::open(session_root.join("session.sqlite")).unwrap();
    connection
        .execute_batch(
            r#"
create table if not exists session_dialog (
    msg_id text primary key,
    turn_index integer not null,
    role text not null,
    content_raw text not null,
    token_count integer,
    char_count integer not null,
    created_at_ms integer not null,
    created_at_iso text not null,
    updated_at_ms integer not null,
    metadata_json text not null,
    stream_id text
);
create table if not exists session_turn_index (
    turn_id text primary key,
    turn_index integer not null
);
            "#,
        )
        .unwrap();
    connection
        .execute(
            r#"
insert into session_dialog (
    msg_id,
    turn_index,
    role,
    content_raw,
    token_count,
    char_count,
    created_at_ms,
    created_at_iso,
    updated_at_ms,
    metadata_json,
    stream_id
) values (?1, ?2, ?3, ?4, null, ?5, ?6, ?7, ?8, ?9, ?10)
            "#,
            params![
                "msg-1",
                0_i64,
                "user",
                "Recent session context for tests.",
                31_i64,
                1_i64,
                "2026-04-21T00:00:00+00:00",
                1_i64,
                r#"{"item_type":"userMessage"}"#,
                "stream-1",
            ],
        )
        .unwrap();

    let shared_truth = Connection::open(shared_dir.join("shared_truth.sqlite")).unwrap();
    shared_truth
        .execute(
            r#"
insert into memory_entries (
    memory_id,
    namespace,
    kind,
    value,
    evidence_refs,
    confidence,
    stability,
    status,
    revision,
    supersedes,
    created_at_ms,
    created_at_iso,
    updated_at_ms,
    updated_at_iso
) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, null, ?10, ?11, ?12, ?13)
            "#,
            params![
                "shared-1",
                "project",
                "convention",
                "Shared project convention for tests.",
                "[]",
                0.9_f64,
                0.8_f64,
                "active",
                1_i64,
                1_i64,
                "2026-04-21T00:00:00+00:00",
                1_i64,
                "2026-04-21T00:00:00+00:00",
            ],
        )
        .unwrap();

    let frozen_truth = Connection::open(shared_dir.join("frozen_truth.sqlite")).unwrap();
    frozen_truth
        .execute(
            r#"
insert into memory_entries (
    memory_id,
    namespace,
    kind,
    value,
    evidence_refs,
    confidence,
    stability,
    status,
    revision,
    supersedes,
    created_at_ms,
    created_at_iso,
    updated_at_ms,
    updated_at_iso
) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, null, ?10, ?11, ?12, ?13)
            "#,
            params![
                "frozen-1",
                "user",
                "preference",
                "Stable user preference for tests.",
                "[]",
                0.95_f64,
                0.9_f64,
                "active",
                1_i64,
                1_i64,
                "2026-04-21T00:00:00+00:00",
                1_i64,
                "2026-04-21T00:00:00+00:00",
            ],
        )
        .unwrap();

    let instructions = build_memory_tool_developer_instructions(&lyra_home, session_id)
        .await
        .unwrap();

    assert!(instructions.contains(&format!(
        "- `{}/shared/shared_truth.sqlite`",
        truth_root.display()
    )));
    assert!(instructions.contains(&format!(
        "- `{}/shared/shared_memory.md`",
        truth_root.display()
    )));
    assert!(instructions.contains("not primary truth"));
    assert!(instructions.contains("Shared project convention for tests."));
    assert!(instructions.contains("Stable user preference for tests."));
    assert!(instructions.contains("Recent session context for tests."));
    assert_eq!(
        instructions
            .matches("========= CURRENT SESSION EXCERPT BEGINS =========")
            .count(),
        1
    );
}
