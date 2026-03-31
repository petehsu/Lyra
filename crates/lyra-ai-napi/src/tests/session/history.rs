use crate::session::history::{resolve_preview, resolve_session_summary};
use crate::session::service::{read_session_history, refresh_session_projection};
use crate::storage::session_db;
use crate::tests::support::{sample_message, TempStorageRoot};

#[test]
fn refresh_session_projection_derives_title_and_summary_from_messages() {
    let temp = TempStorageRoot::new();
    let storage_root = temp.as_string();
    let session_id = "session-1";

    session_db::write_message(
        &storage_root,
        session_id,
        &sample_message("m1", "user", "Plan provider presets", 10),
    )
    .expect("write user message");
    session_db::write_message(
        &storage_root,
        session_id,
        &sample_message(
            "m2",
            "assistant",
            "Use preset templates and dynamic discovery.",
            20,
        ),
    )
    .expect("write assistant message");

    let session =
        refresh_session_projection(&storage_root, session_id, Some("New Chat"), Some("chat"))
            .expect("refresh session projection");

    assert_eq!(session.title, "Plan provider presets");
    assert_eq!(
        session.summary,
        "Use preset templates and dynamic discovery."
    );

    let history = read_session_history(&storage_root, 10).expect("read history");
    assert_eq!(history.len(), 1);
    assert_eq!(history[0].title, session.title);
}

#[test]
fn resolves_preview_and_summary_from_latest_message() {
    let summary = resolve_session_summary(&[
        sample_message("m1", "user", "first", 1),
        sample_message("m2", "assistant", "second message", 2),
    ]);

    assert_eq!(summary, "second message");
    assert_eq!(resolve_preview("a  b   c", 10), "a b c");
}
