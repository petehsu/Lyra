use rusqlite::params;

use crate::paths::{ensure_ai_dirs, resolve_ai_paths};
use crate::storage::registry_db;
use crate::storage::schema::{ensure_registry_schema, open_sqlite};
use crate::tests::support::TempStorageRoot;

#[test]
fn migrates_v1_profile_rows_into_v2_schema() {
    let temp = TempStorageRoot::new();
    let storage_root = temp.as_string();
    let paths = resolve_ai_paths(&storage_root).expect("resolve paths");
    ensure_ai_dirs(&paths).expect("ensure dirs");
    let connection = open_sqlite(&paths.registry_db_path).expect("open registry");
    connection
        .execute_batch(
            r#"
            drop table if exists profiles;
            create table profiles (
              id text primary key,
              name text not null,
              provider_kind text not null,
              base_url text not null,
              model text not null,
              api_key_secret_ref text,
              is_default integer not null default 0,
              created_at integer not null,
              updated_at integer not null
            );
            "#,
        )
        .expect("create legacy profile table");
    connection
        .execute(
            "insert into profiles(
               id, name, provider_kind, base_url, model, api_key_secret_ref, is_default, created_at, updated_at
             ) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                "legacy-openai",
                "Legacy OpenAI",
                "openai_compatible",
                "https://api.openai.com/v1",
                "gpt-4.1",
                "secret-ref-1",
                1,
                10,
                20
            ],
        )
        .expect("insert legacy profile");

    ensure_registry_schema(&connection).expect("migrate schema");
    drop(connection);

    let migrated = registry_db::read_profile(&storage_root, "legacy-openai")
        .expect("read migrated profile")
        .expect("migrated profile");

    assert_eq!(migrated.provider_id, "custom_openai_compatible");
    assert_eq!(migrated.protocol_id, "openai_compatible");
    assert_eq!(
        migrated
            .connection_config
            .get("baseUrl")
            .map(String::as_str),
        Some("https://api.openai.com/v1")
    );
    assert_eq!(
        migrated.configured_secret_fields,
        vec!["apiKey".to_string()]
    );
}
