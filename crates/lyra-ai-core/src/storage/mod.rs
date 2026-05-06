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

mod models;
pub use models::*;
mod long_work_models;
pub use long_work_models::*;
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
mod long_work_schema;
use long_work_schema::migrate_long_work_session;
mod approval;
mod artifact_store;
mod completion;
mod connection;
mod execution;
mod long_work;
mod patch_backup;
mod planning;
mod profile;
mod session;
mod verification;
#[derive(Clone)]
pub struct AiStore {
    pub root: PathBuf,
}
