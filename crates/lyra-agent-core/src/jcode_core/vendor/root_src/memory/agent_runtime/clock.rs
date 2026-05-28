use chrono::{SecondsFormat, Utc};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MemoryTimestamp {
    pub ms: i64,
    pub iso: String,
}

pub fn now_timestamp() -> MemoryTimestamp {
    let now = Utc::now();
    MemoryTimestamp {
        ms: now.timestamp_millis(),
        iso: now.to_rfc3339_opts(SecondsFormat::Millis, true),
    }
}
