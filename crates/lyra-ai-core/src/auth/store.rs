use napi::Result;

use crate::secrets::keyring::{
    delete_secret_value, read_secret_value, secret_value_exists, write_secret_value,
};

pub trait SecretStore {
    fn write(&self, secret_ref: &str, secret_value: &str) -> Result<()>;
    fn read(&self, secret_ref: &str) -> Result<String>;
    fn delete(&self, secret_ref: &str) -> Result<()>;
    fn exists(&self, secret_ref: &str) -> bool;
}

#[derive(Clone, Copy, Debug, Default)]
pub struct KeyringSecretStore;

impl SecretStore for KeyringSecretStore {
    fn write(&self, secret_ref: &str, secret_value: &str) -> Result<()> {
        write_secret_value(secret_ref, secret_value)
    }

    fn read(&self, secret_ref: &str) -> Result<String> {
        read_secret_value(secret_ref)
    }

    fn delete(&self, secret_ref: &str) -> Result<()> {
        delete_secret_value(secret_ref)
    }

    fn exists(&self, secret_ref: &str) -> bool {
        secret_value_exists(secret_ref)
    }
}
