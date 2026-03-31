use napi::Result;
use rusqlite::{params, OptionalExtension};

use crate::error::{normalize_required_text, now_ms, parse_json, to_error, to_json};
use crate::paths::{ensure_ai_dirs, resolve_ai_paths};
use crate::profile::types::{
    AiModelDiscoveryResult, AiProviderModelEntry, AiProviderProfile, StoredAiProviderProfile,
};
use crate::session::types::AiChatSessionSummary;
use crate::storage::schema::{ensure_registry_schema, open_sqlite};

fn open_registry(storage_root: &str) -> Result<rusqlite::Connection> {
    let paths = resolve_ai_paths(storage_root)?;
    ensure_ai_dirs(&paths)?;
    let connection = open_sqlite(&paths.registry_db_path)?;
    ensure_registry_schema(&connection)?;
    Ok(connection)
}

fn map_json<T: serde::de::DeserializeOwned>(value: String, label: &str) -> rusqlite::Result<T> {
    parse_json::<T>(&value).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(
            0,
            rusqlite::types::Type::Text,
            Box::new(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                format!("invalid {label}: {error}"),
            )),
        )
    })
}

fn map_stored_profile(row: &rusqlite::Row<'_>) -> rusqlite::Result<StoredAiProviderProfile> {
    Ok(StoredAiProviderProfile {
        id: row.get(0)?,
        name: row.get(1)?,
        provider_id: row.get(2)?,
        protocol_id: row.get(3)?,
        preset_id: row.get(4)?,
        connection_config: map_json(row.get(5)?, "connection config")?,
        auth_config: map_json(row.get(6)?, "auth config")?,
        secret_refs: map_json(row.get(7)?, "secret refs")?,
        headers: map_json(row.get(8)?, "headers")?,
        model: row.get(9)?,
        custom_models: map_json(row.get(10)?, "custom models")?,
        discovery_state: map_json(row.get(11)?, "discovery state")?,
        is_default: row.get::<_, i64>(12)? != 0,
        created_at: row.get(13)?,
        updated_at: row.get(14)?,
    })
}

fn map_session_summary(row: &rusqlite::Row<'_>) -> rusqlite::Result<AiChatSessionSummary> {
    Ok(AiChatSessionSummary {
        id: row.get(0)?,
        title: row.get(1)?,
        updated_at: row.get(2)?,
        summary: row.get(3)?,
        mode: row.get(4)?,
    })
}

pub fn list_profiles(storage_root: &str) -> Result<Vec<AiProviderProfile>> {
    let connection = open_registry(storage_root)?;
    let mut statement = connection
        .prepare(
            "select id, name, provider_id, protocol_id, preset_id,
                    connection_config_json, auth_config_json, secret_refs_json,
                    headers_json, model, custom_models_json, discovery_state_json,
                    is_default, created_at, updated_at
             from profiles
             order by is_default desc, updated_at desc",
        )
        .map_err(|error| to_error(format!("failed to prepare profile query: {error}")))?;
    let rows = statement
        .query_map([], map_stored_profile)
        .map_err(|error| to_error(format!("failed to query ai profiles: {error}")))?;
    rows.collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|error| to_error(format!("failed to collect ai profiles: {error}")))
        .map(|profiles| {
            profiles
                .into_iter()
                .map(|profile| profile.to_public())
                .collect()
        })
}

pub fn read_profile_record(
    storage_root: &str,
    id: &str,
) -> Result<Option<StoredAiProviderProfile>> {
    let normalized_id = normalize_required_text(id, "profile id")?;
    let connection = open_registry(storage_root)?;
    connection
        .query_row(
            "select id, name, provider_id, protocol_id, preset_id,
                    connection_config_json, auth_config_json, secret_refs_json,
                    headers_json, model, custom_models_json, discovery_state_json,
                    is_default, created_at, updated_at
             from profiles where id = ?1",
            params![normalized_id],
            map_stored_profile,
        )
        .optional()
        .map_err(|error| to_error(format!("failed to read ai profile: {error}")))
}

pub fn read_profile(storage_root: &str, id: &str) -> Result<Option<AiProviderProfile>> {
    read_profile_record(storage_root, id).map(|profile| profile.map(|entry| entry.to_public()))
}

pub fn write_profile(storage_root: &str, profile: &StoredAiProviderProfile) -> Result<()> {
    let connection = open_registry(storage_root)?;
    connection
        .execute(
            "insert into profiles(
               id, name, provider_id, protocol_id, preset_id,
               connection_config_json, auth_config_json, secret_refs_json,
               headers_json, model, custom_models_json, discovery_state_json,
               is_default, created_at, updated_at
             ) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)
             on conflict(id) do update set
               name = excluded.name,
               provider_id = excluded.provider_id,
               protocol_id = excluded.protocol_id,
               preset_id = excluded.preset_id,
               connection_config_json = excluded.connection_config_json,
               auth_config_json = excluded.auth_config_json,
               secret_refs_json = excluded.secret_refs_json,
               headers_json = excluded.headers_json,
               model = excluded.model,
               custom_models_json = excluded.custom_models_json,
               discovery_state_json = excluded.discovery_state_json,
               is_default = excluded.is_default,
               updated_at = excluded.updated_at",
            params![
                profile.id,
                profile.name,
                profile.provider_id,
                profile.protocol_id,
                profile.preset_id,
                to_json(&profile.connection_config)?,
                to_json(&profile.auth_config)?,
                to_json(&profile.secret_refs)?,
                to_json(&profile.headers)?,
                profile.model,
                to_json(&profile.custom_models)?,
                to_json(&profile.discovery_state)?,
                if profile.is_default { 1 } else { 0 },
                profile.created_at,
                profile.updated_at,
            ],
        )
        .map_err(|error| to_error(format!("failed to write ai profile: {error}")))?;
    upsert_model_discovery_cache(
        storage_root,
        &profile.id,
        &AiModelDiscoveryResult {
            provider_id: profile.provider_id.clone(),
            protocol_id: profile.protocol_id.clone(),
            status: profile.discovery_state.status.clone(),
            message: profile
                .discovery_state
                .error_message
                .clone()
                .unwrap_or_else(|| "profile discovery state".to_string()),
            checked_at: profile
                .discovery_state
                .last_checked_at
                .unwrap_or(profile.updated_at),
            models: profile.discovery_state.models.clone(),
        },
    )?;
    Ok(())
}

pub fn delete_profile(storage_root: &str, id: &str) -> Result<()> {
    let connection = open_registry(storage_root)?;
    connection
        .execute(
            "delete from model_discovery_cache where profile_id = ?1",
            params![id],
        )
        .map_err(|error| to_error(format!("failed to delete ai discovery cache: {error}")))?;
    connection
        .execute("delete from profiles where id = ?1", params![id])
        .map_err(|error| to_error(format!("failed to delete ai profile: {error}")))?;
    Ok(())
}

pub fn set_default_profile(storage_root: &str, id: &str) -> Result<AiProviderProfile> {
    let connection = open_registry(storage_root)?;
    let transaction = connection
        .unchecked_transaction()
        .map_err(|error| to_error(format!("failed to open ai profile transaction: {error}")))?;
    transaction
        .execute("update profiles set is_default = 0", [])
        .map_err(|error| to_error(format!("failed to clear default ai profile: {error}")))?;
    let updated = transaction
        .execute(
            "update profiles set is_default = 1, updated_at = ?2 where id = ?1",
            params![id, now_ms()],
        )
        .map_err(|error| to_error(format!("failed to set default ai profile: {error}")))?;
    if updated == 0 {
        return Err(to_error("ai profile not found"));
    }
    transaction.commit().map_err(|error| {
        to_error(format!(
            "failed to commit ai profile default update: {error}"
        ))
    })?;
    read_profile(storage_root, id)?.ok_or_else(|| to_error("ai profile not found"))
}

pub fn read_default_profile_record(storage_root: &str) -> Result<Option<StoredAiProviderProfile>> {
    let connection = open_registry(storage_root)?;
    connection
        .query_row(
            "select id, name, provider_id, protocol_id, preset_id,
                    connection_config_json, auth_config_json, secret_refs_json,
                    headers_json, model, custom_models_json, discovery_state_json,
                    is_default, created_at, updated_at
             from profiles
             order by is_default desc, updated_at desc
             limit 1",
            [],
            map_stored_profile,
        )
        .optional()
        .map_err(|error| to_error(format!("failed to read default ai profile: {error}")))
}

pub fn upsert_model_discovery_cache(
    storage_root: &str,
    profile_id: &str,
    discovery: &AiModelDiscoveryResult,
) -> Result<()> {
    let connection = open_registry(storage_root)?;
    connection
        .execute(
            "insert into model_discovery_cache(
               profile_id, provider_id, protocol_id, status, message, checked_at, models_json
             ) values (?1, ?2, ?3, ?4, ?5, ?6, ?7)
             on conflict(profile_id) do update set
               provider_id = excluded.provider_id,
               protocol_id = excluded.protocol_id,
               status = excluded.status,
               message = excluded.message,
               checked_at = excluded.checked_at,
               models_json = excluded.models_json",
            params![
                profile_id,
                discovery.provider_id,
                discovery.protocol_id,
                discovery.status,
                discovery.message,
                discovery.checked_at,
                to_json(&discovery.models)?,
            ],
        )
        .map_err(|error| to_error(format!("failed to write ai discovery cache: {error}")))?;
    Ok(())
}

pub fn read_model_discovery_cache(
    storage_root: &str,
    profile_id: &str,
) -> Result<Option<AiModelDiscoveryResult>> {
    let connection = open_registry(storage_root)?;
    connection
        .query_row(
            "select provider_id, protocol_id, status, message, checked_at, models_json
             from model_discovery_cache where profile_id = ?1",
            params![profile_id],
            |row| {
                Ok(AiModelDiscoveryResult {
                    provider_id: row.get(0)?,
                    protocol_id: row.get(1)?,
                    status: row.get(2)?,
                    message: row.get(3)?,
                    checked_at: row.get(4)?,
                    models: map_json::<Vec<AiProviderModelEntry>>(row.get(5)?, "cached models")?,
                })
            },
        )
        .optional()
        .map_err(|error| to_error(format!("failed to read ai discovery cache: {error}")))
}

pub fn write_session_summary(
    storage_root: &str,
    summary: &AiChatSessionSummary,
    created_at: i64,
) -> Result<()> {
    let connection = open_registry(storage_root)?;
    connection
        .execute(
            "insert into sessions(id, title, updated_at, summary, mode, created_at)
             values (?1, ?2, ?3, ?4, ?5, ?6)
             on conflict(id) do update set
               title = excluded.title,
               updated_at = excluded.updated_at,
               summary = excluded.summary,
               mode = excluded.mode",
            params![
                summary.id,
                summary.title,
                summary.updated_at,
                summary.summary,
                summary.mode,
                created_at,
            ],
        )
        .map_err(|error| to_error(format!("failed to write ai session summary: {error}")))?;
    Ok(())
}

pub fn read_session_summary(
    storage_root: &str,
    session_id: &str,
) -> Result<Option<AiChatSessionSummary>> {
    let connection = open_registry(storage_root)?;
    connection
        .query_row(
            "select id, title, updated_at, summary, mode from sessions where id = ?1",
            params![session_id],
            map_session_summary,
        )
        .optional()
        .map_err(|error| to_error(format!("failed to read ai session summary: {error}")))
}

pub fn list_session_summaries(
    storage_root: &str,
    limit: usize,
) -> Result<Vec<AiChatSessionSummary>> {
    let connection = open_registry(storage_root)?;
    let mut statement = connection
        .prepare(
            "select id, title, updated_at, summary, mode
             from sessions
             order by updated_at desc
             limit ?1",
        )
        .map_err(|error| to_error(format!("failed to prepare ai history query: {error}")))?;
    let rows = statement
        .query_map(params![limit as i64], map_session_summary)
        .map_err(|error| to_error(format!("failed to query ai session history: {error}")))?;
    rows.collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|error| to_error(format!("failed to collect ai session history: {error}")))
}

pub fn upsert_turn_state(
    storage_root: &str,
    turn_id: &str,
    session_id: &str,
    mode: &str,
    status: &str,
    error_message: Option<&str>,
) -> Result<()> {
    let connection = open_registry(storage_root)?;
    let now = now_ms();
    connection
        .execute(
            "insert into turns(id, session_id, mode, status, error_message, created_at, updated_at)
             values (?1, ?2, ?3, ?4, ?5, ?6, ?7)
             on conflict(id) do update set
               status = excluded.status,
               error_message = excluded.error_message,
               updated_at = excluded.updated_at",
            params![turn_id, session_id, mode, status, error_message, now, now],
        )
        .map_err(|error| to_error(format!("failed to write ai turn state: {error}")))?;
    Ok(())
}

pub fn read_active_turn_id(storage_root: &str, session_id: &str) -> Result<Option<String>> {
    let connection = open_registry(storage_root)?;
    connection
        .query_row(
            "select id from turns
             where session_id = ?1 and status in ('pending', 'streaming')
             order by updated_at desc
             limit 1",
            params![session_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| to_error(format!("failed to read active ai turn: {error}")))
}
