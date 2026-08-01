use std::time::Duration;

use crate::{HostError, Result};

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WasiExecutionLimits {
    pub max_component_bytes: usize,
    pub max_memory_bytes: usize,
    pub max_table_elements: usize,
    pub max_instances: usize,
    pub max_tables: usize,
    pub max_memories: usize,
    pub max_random_bytes: u64,
    pub fuel: u64,
    pub timeout: Duration,
}

impl Default for WasiExecutionLimits {
    fn default() -> Self {
        Self {
            max_component_bytes: 64 * 1024 * 1024,
            max_memory_bytes: 256 * 1024 * 1024,
            max_table_elements: 100_000,
            max_instances: 100,
            max_tables: 100,
            max_memories: 16,
            max_random_bytes: 1024 * 1024,
            fuel: 100_000_000,
            timeout: Duration::from_secs(30),
        }
    }
}

impl WasiExecutionLimits {
    pub fn validate(&self) -> Result<()> {
        let positive_usize = [
            ("max_component_bytes", self.max_component_bytes),
            ("max_memory_bytes", self.max_memory_bytes),
            ("max_table_elements", self.max_table_elements),
            ("max_instances", self.max_instances),
            ("max_tables", self.max_tables),
            ("max_memories", self.max_memories),
        ];
        for (name, value) in positive_usize {
            if value == 0 {
                return Err(HostError::InvalidLimit(name));
            }
        }
        if self.max_random_bytes == 0 {
            return Err(HostError::InvalidLimit("max_random_bytes"));
        }
        if self.fuel == 0 {
            return Err(HostError::InvalidLimit("fuel"));
        }
        if self.timeout.is_zero() {
            return Err(HostError::InvalidLimit("timeout"));
        }
        Ok(())
    }
}
