use std::collections::BTreeMap;

use crate::auth::memory::MemorySecretStore;
use crate::auth::service::{apply_secret_updates, resolve_secret_values};
use crate::auth::store::SecretStore;

#[test]
fn applies_and_clears_secret_updates_in_memory_store() {
    let store = MemorySecretStore::default();
    let secret_values = BTreeMap::from([
        ("apiKey".to_string(), Some("sk-live".to_string())),
        ("secondaryKey".to_string(), Some("secondary".to_string())),
    ]);

    let initial_refs =
        apply_secret_updates(&Default::default(), Some(&secret_values), None, &store)
            .expect("write secrets");
    assert_eq!(initial_refs.len(), 2);

    let api_key_ref = initial_refs.get("apiKey").expect("api key ref");
    assert_eq!(store.read(api_key_ref).expect("read api key"), "sk-live");

    let cleared = apply_secret_updates(&initial_refs, None, Some(&["apiKey".to_string()]), &store)
        .expect("clear api key");

    assert!(!cleared.contains_key("apiKey"));
    assert!(!store.exists(api_key_ref));
    assert_eq!(cleared.len(), 1);
}

#[test]
fn resolves_secret_values_with_inline_overrides() {
    let store = MemorySecretStore::default();
    store
        .write("secret-ref-1", "stored-value")
        .expect("seed store");

    let current_refs = BTreeMap::from([("apiKey".to_string(), "secret-ref-1".to_string())]);
    let overrides = BTreeMap::from([("apiKey".to_string(), Some("inline-value".to_string()))]);

    let resolved =
        resolve_secret_values(&current_refs, Some(&overrides), &store).expect("resolve secrets");

    assert_eq!(
        resolved.get("apiKey").map(String::as_str),
        Some("inline-value")
    );
}
