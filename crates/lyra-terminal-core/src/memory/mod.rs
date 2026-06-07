use crate::screen::TerminalScreenState;
use crate::shell_integration::{ShellIntegrationEvent, ShellIntegrationEventKind};
use chrono::{SecondsFormat, Utc};
use once_cell::sync::Lazy;
use regex::Regex;
use serde::Serialize;
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs::{self, File, OpenOptions};
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use uuid::Uuid;

const INLINE_TOKEN_LIMIT: u64 = 6_000;
const OUTPUT_PREVIEW_CHARS: usize = 240;
const DEFAULT_TIMELINE_LIMIT: usize = 100;
const MAX_TIMELINE_LIMIT: usize = 500;
const DEFAULT_EVENTS_LIMIT: usize = 100;
const MAX_EVENTS_LIMIT: usize = 500;
const DEFAULT_COMMANDS_LIMIT: usize = 100;
const MAX_COMMANDS_LIMIT: usize = 500;
const MAX_OUTPUT_RANGE_BYTES: u64 = 1024 * 1024;

static ANSI_CSI_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"\x1b\[[0-?]*[ -/]*[@-~]").expect("valid CSI regex"));
static ANSI_OSC_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"\x1b\][^\x07]*(?:\x07|\x1b\\)").expect("valid OSC regex"));
static MEMORY_STATES: Lazy<Mutex<HashMap<String, Arc<Mutex<SessionState>>>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

type MemoryResult<T> = std::result::Result<T, String>;


mod artifacts;
mod query;
mod record;
mod store;
mod timeline;
mod types;

pub use artifacts::*;
pub use query::*;
pub use record::*;
use store::*;
use timeline::*;
pub use types::*;

#[cfg(test)]
mod tests;
