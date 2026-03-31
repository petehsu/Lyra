use std::collections::BTreeMap;

use napi::Result;

use crate::auth::store::SecretStore;
use crate::error::normalize_optional_text;
use crate::profile::types::AiSecretRefMap;
use crate::secrets::service::create_secret_ref_id;

pub fn apply_secret_updates(
    current_secret_refs: &AiSecretRefMap,
    secret_values: Option<&BTreeMap<String, Option<String>>>,
    clear_secret_fields: Option<&[String]>,
    store: &impl SecretStore,
) -> Result<AiSecretRefMap> {
    let mut next_refs = current_secret_refs.clone();

    if let Some(clear_fields) = clear_secret_fields {
        for field_id in clear_fields {
            if let Some(secret_ref) = next_refs.remove(field_id) {
                store.delete(&secret_ref)?;
            }
        }
    }

    if let Some(secret_values) = secret_values {
        for (field_id, raw_value) in secret_values {
            match normalize_optional_text(raw_value.clone()) {
                Some(secret_value) => {
                    let secret_ref = next_refs
                        .get(field_id)
                        .cloned()
                        .unwrap_or_else(create_secret_ref_id);
                    store.write(&secret_ref, &secret_value)?;
                    next_refs.insert(field_id.clone(), secret_ref);
                }
                None if raw_value.is_some() => {
                    if let Some(secret_ref) = next_refs.remove(field_id) {
                        store.delete(&secret_ref)?;
                    }
                }
                None => {}
            }
        }
    }

    Ok(next_refs)
}

pub fn resolve_secret_values(
    current_secret_refs: &AiSecretRefMap,
    secret_values: Option<&BTreeMap<String, Option<String>>>,
    store: &impl SecretStore,
) -> Result<BTreeMap<String, String>> {
    let mut resolved = BTreeMap::new();

    for (field_id, secret_ref) in current_secret_refs {
        if store.exists(secret_ref) {
            resolved.insert(field_id.clone(), store.read(secret_ref)?);
        }
    }

    if let Some(secret_values) = secret_values {
        for (field_id, raw_value) in secret_values {
            if let Some(secret_value) = normalize_optional_text(raw_value.clone()) {
                resolved.insert(field_id.clone(), secret_value);
            }
        }
    }

    Ok(resolved)
}

pub fn delete_secret_refs(secret_refs: &AiSecretRefMap, store: &impl SecretStore) -> Result<()> {
    for secret_ref in secret_refs.values() {
        store.delete(secret_ref)?;
    }
    Ok(())
}
