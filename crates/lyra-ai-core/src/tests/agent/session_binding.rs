use std::fs::create_dir_all;
use std::path::PathBuf;

use crate::agent::service::{bind_session_project, create_session, get_session};
use crate::agent::types::{
    AgentBindSessionProjectRequest, AgentCreateSessionRequest, AgentGetSessionRequest,
};
use crate::tests::support::TempStorageRoot;

#[test]
fn binds_project_root_to_session_and_persists_it() {
    let temp = TempStorageRoot::new();
    let storage_root = temp.as_string();
    let workspace = PathBuf::from(&storage_root)
        .join("workspace")
        .join("demo-project");
    create_dir_all(&workspace).expect("create workspace");
    let workspace_canonical = workspace.canonicalize().expect("canonical workspace");

    let session = create_session(AgentCreateSessionRequest {
        storage_root: storage_root.clone(),
        title: Some("Agent".to_string()),
        profile_id: None,
    })
    .expect("create session");

    let bound = bind_session_project(AgentBindSessionProjectRequest {
        storage_root: storage_root.clone(),
        session_id: session.id.clone(),
        project_root: workspace.to_string_lossy().to_string(),
    })
    .expect("bind project");
    assert_eq!(
        bound.project_root.as_deref(),
        Some(workspace_canonical.to_string_lossy().as_ref())
    );
    assert_eq!(bound.project_name.as_deref(), Some("demo-project"));

    let detail = get_session(AgentGetSessionRequest {
        storage_root,
        session_id: session.id,
    })
    .expect("get session detail");
    assert_eq!(detail.session.project_name.as_deref(), Some("demo-project"));
    assert_eq!(
        detail.session.project_root.as_deref(),
        Some(workspace_canonical.to_string_lossy().as_ref())
    );
}
