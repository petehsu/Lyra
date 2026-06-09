use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HardwareAuditRecord {
    pub action: String,
    #[serde(default)]
    pub target: Option<String>,
    #[serde(default)]
    pub detail: Value,
}

impl HardwareAuditRecord {
    pub fn new(action: &str, target: Option<String>, detail: Value) -> Self {
        Self {
            action: action.to_string(),
            target,
            detail,
        }
    }
}

pub trait HardwareAuditSink: Send + Sync {
    fn record(&self, record: HardwareAuditRecord);
}

#[derive(Default)]
pub struct MemoryAuditSink {
    records: Arc<Mutex<Vec<HardwareAuditRecord>>>,
}

impl MemoryAuditSink {
    pub fn records(&self) -> Vec<HardwareAuditRecord> {
        self.records
            .lock()
            .map(|records| records.clone())
            .unwrap_or_default()
    }
}

impl HardwareAuditSink for MemoryAuditSink {
    fn record(&self, record: HardwareAuditRecord) {
        if let Ok(mut records) = self.records.lock() {
            records.push(record);
        }
    }
}
