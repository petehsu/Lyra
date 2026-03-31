use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};

use napi::Result;

use crate::auth::store::SecretStore;
use crate::error::to_error;

#[cfg_attr(not(test), allow(dead_code))]
#[derive(Clone, Debug, Default)]
pub struct MemorySecretStore {
    values: Arc<Mutex<BTreeMap<String, String>>>,
}

impl SecretStore for MemorySecretStore {
    fn write(&self, secret_ref: &str, secret_value: &str) -> Result<()> {
        self.values
            .lock()
            .map_err(|_| to_error("failed to lock memory secret store"))?
            .insert(secret_ref.to_string(), secret_value.to_string());
        Ok(())
    }

    fn read(&self, secret_ref: &str) -> Result<String> {
        self.values
            .lock()
            .map_err(|_| to_error("failed to lock memory secret store"))?
            .get(secret_ref)
            .cloned()
            .ok_or_else(|| to_error("secret not found"))
    }

    fn delete(&self, secret_ref: &str) -> Result<()> {
        self.values
            .lock()
            .map_err(|_| to_error("failed to lock memory secret store"))?
            .remove(secret_ref);
        Ok(())
    }

    fn exists(&self, secret_ref: &str) -> bool {
        self.values
            .lock()
            .map(|values| values.contains_key(secret_ref))
            .unwrap_or(false)
    }
}
