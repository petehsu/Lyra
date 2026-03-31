use keyring::Entry;
use napi::Result;

use crate::error::to_error;

const AI_SECRET_SERVICE: &str = "lyra.ai";

fn create_secret_entry(secret_ref: &str) -> Result<Entry> {
    Entry::new(AI_SECRET_SERVICE, secret_ref)
        .map_err(|error| to_error(format!("failed to access ai secure storage: {error}")))
}

pub fn write_secret_value(secret_ref: &str, secret_value: &str) -> Result<()> {
    create_secret_entry(secret_ref)?
        .set_password(secret_value)
        .map_err(|error| to_error(format!("failed to store ai api key securely: {error}")))
}

pub fn read_secret_value(secret_ref: &str) -> Result<String> {
    create_secret_entry(secret_ref)?
        .get_password()
        .map_err(|error| to_error(format!("failed to read ai api key securely: {error}")))
}

pub fn delete_secret_value(secret_ref: &str) -> Result<()> {
    match create_secret_entry(secret_ref)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(to_error(format!(
            "failed to delete ai api key securely: {error}"
        ))),
    }
}

pub fn secret_value_exists(secret_ref: &str) -> bool {
    read_secret_value(secret_ref).is_ok()
}
