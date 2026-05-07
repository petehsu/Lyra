use crate::events::RuntimeStreamEvent;
use anyhow::{anyhow, Context, Result};
use chrono::{SecondsFormat, Utc};
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use uuid::Uuid;

mod long_work_models;
pub use long_work_models::*;
mod follow_models;
pub use follow_models::*;
mod recovery_models;
pub use recovery_models::*;
mod intent_models;
pub use intent_models::*;
mod reference_models;
pub use reference_models::*;
mod clarification_models;
pub use clarification_models::*;
mod models;
pub use models::*;
mod common;
pub use common::{
    json_string, new_id, now_iso, now_ms, parse_json_or, policy_snapshot_ref,
    project_name_from_root, resolve_storage_root, sha256_hex, trim_to_string,
};
use common::{
    merge_string_refs, merge_todo_blocker_json, normalize_risk_level, normalize_todo_kind,
    normalize_todo_status, parse_json_vec_string, parse_json_vec_value, preview_text,
    todo_status_priority, value_string_array,
};
mod rows;
use rows::*;
mod execution_helpers;
use execution_helpers::*;
mod verification_helpers;
use verification_helpers::*;
mod completion_helpers;
use completion_helpers::*;
mod schema;
use schema::{configure_conn, migrate_index, migrate_session};
mod intent_schema;
use intent_schema::migrate_intent_session;
mod reference_schema;
use reference_schema::migrate_reference_session;
mod clarification_schema;
use clarification_schema::migrate_clarification_session;
mod follow_schema;
use follow_schema::migrate_follow_session;
mod recovery_schema;
use recovery_schema::migrate_recovery_session;
mod long_work_schema;
use long_work_schema::migrate_long_work_session;
mod approval;
mod artifact_store;
mod clarification_ledger;
mod completion;
mod connection;
mod execution;
mod follow_ledger;
mod follow_live_edit;
mod follow_projection;
mod intent_ledger;
mod long_work_continuation;
mod long_work_continuation_packet;
mod long_work_continuation_records;
mod long_work_continuation_resume;
mod long_work_continuation_state;
mod long_work_ledger;
mod long_work_status;
mod patch_backup;
mod planning;
mod profile;
mod recovery_checkpoint;
mod recovery_execution;
mod recovery_preview;
mod recovery_projection;
mod recovery_supersede;
mod recovery_workspace;
mod reference_ledger;
mod session;
mod verification;
#[derive(Clone)]
pub struct AiStore {
    pub root: PathBuf,
}
