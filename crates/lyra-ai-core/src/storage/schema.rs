use std::collections::BTreeSet;
use std::path::Path;

use napi::Result;
use rusqlite::{params, Connection};

use crate::error::{to_error, to_json};
use crate::profile::types::{AiModelDiscoveryState, AiProviderModelEntry, StoredAiProviderProfile};

fn configure_connection(connection: &Connection) -> Result<()> {
    connection
        .pragma_update(None, "journal_mode", "WAL")
        .map_err(|error| to_error(format!("failed to configure sqlite journal mode: {error}")))?;
    Ok(())
}

pub fn open_sqlite(path: &Path) -> Result<Connection> {
    let connection = Connection::open(path).map_err(|error| {
        to_error(format!(
            "failed to open sqlite database {}: {error}",
            path.display()
        ))
    })?;
    configure_connection(&connection)?;
    Ok(connection)
}

fn table_exists(connection: &Connection, table_name: &str) -> Result<bool> {
    connection
        .query_row(
            "select exists(select 1 from sqlite_master where type = 'table' and name = ?1)",
            params![table_name],
            |row| row.get::<_, i64>(0),
        )
        .map(|value| value != 0)
        .map_err(|error| to_error(format!("failed to inspect sqlite tables: {error}")))
}

fn table_columns(connection: &Connection, table_name: &str) -> Result<BTreeSet<String>> {
    let mut statement = connection
        .prepare(&format!("pragma table_info({table_name})"))
        .map_err(|error| to_error(format!("failed to inspect sqlite columns: {error}")))?;
    let rows = statement
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|error| to_error(format!("failed to query sqlite columns: {error}")))?;
    rows.collect::<rusqlite::Result<BTreeSet<_>>>()
        .map_err(|error| to_error(format!("failed to collect sqlite columns: {error}")))
}

fn create_v2_tables(connection: &Connection) -> Result<()> {
    connection
        .execute_batch(
            r#"
        create table if not exists metadata (
          key text primary key,
          value text not null
        );
        create table if not exists profiles (
          id text primary key,
          name text not null,
          provider_id text not null,
          protocol_id text not null,
          preset_id text,
          connection_config_json text not null,
          auth_config_json text not null,
          secret_refs_json text not null,
          headers_json text not null,
          model text not null,
          custom_models_json text not null,
          discovery_state_json text not null,
          is_default integer not null default 0,
          created_at integer not null,
          updated_at integer not null
        );
        create table if not exists model_discovery_cache (
          profile_id text primary key,
          provider_id text not null,
          protocol_id text not null,
          status text not null,
          message text not null,
          checked_at integer not null,
          models_json text not null,
          foreign key(profile_id) references profiles(id) on delete cascade
        );
        create table if not exists sessions (
          id text primary key,
          title text not null,
          updated_at integer not null,
          updated_at_iso text,
          summary text not null,
          mode text not null,
          created_at integer not null,
          created_at_iso text
        );
        create table if not exists turns (
          id text primary key,
          session_id text not null,
          mode text not null,
          status text not null,
          error_message text,
          created_at integer not null,
          created_at_iso text,
          updated_at integer not null,
          updated_at_iso text
        );
        create table if not exists agent_sessions (
          id text primary key,
          title text not null,
          profile_id text,
          project_root text,
          project_name text,
          collaboration_mode text not null default 'default',
          created_at integer not null,
          updated_at integer not null
        );
        create table if not exists agent_plans (
          session_id text primary key,
          status text not null,
          draft_markdown text not null,
          proposed_markdown text,
          approved_markdown text,
          version integer not null,
          last_submitted_version integer,
          updated_at integer not null,
          foreign key(session_id) references agent_sessions(id) on delete cascade
        );
        create table if not exists agent_turns (
          id text primary key,
          session_id text not null,
          profile_id text not null,
          status text not null,
          error_code text,
          error_message text,
          usage_json text,
          created_at integer not null,
          updated_at integer not null,
          foreign key(session_id) references agent_sessions(id) on delete cascade
        );
        create table if not exists agent_messages (
          id text primary key,
          session_id text not null,
          turn_id text,
          role text not null,
          content text not null,
          created_at integer not null,
          foreign key(session_id) references agent_sessions(id) on delete cascade,
          foreign key(turn_id) references agent_turns(id) on delete set null
        );
        create table if not exists agent_tool_calls (
          id text primary key,
          session_id text not null,
          turn_id text not null,
          tool_name text not null,
          input_json text not null,
          output_json text,
          status text not null,
          error_code text,
          error_message text,
          started_at integer not null,
          finished_at integer,
          foreign key(session_id) references agent_sessions(id) on delete cascade,
          foreign key(turn_id) references agent_turns(id) on delete cascade
        );
        create table if not exists agent_runtime_events (
          id text primary key,
          session_id text not null,
          turn_id text not null,
          phase text not null,
          payload_json text not null,
          timestamp integer not null,
          foreign key(session_id) references agent_sessions(id) on delete cascade,
          foreign key(turn_id) references agent_turns(id) on delete cascade
        );
        create table if not exists agent_pending_interactions (
          id text primary key,
          session_id text not null,
          turn_id text not null,
          kind text not null,
          status text not null,
          payload_json text not null,
          created_at integer not null,
          updated_at integer not null,
          foreign key(session_id) references agent_sessions(id) on delete cascade,
          foreign key(turn_id) references agent_turns(id) on delete cascade
        );
        create index if not exists idx_agent_sessions_updated_at on agent_sessions(updated_at desc);
        create index if not exists idx_agent_plans_updated_at on agent_plans(updated_at desc);
        create index if not exists idx_agent_turns_session_created_at on agent_turns(session_id, created_at asc);
        create index if not exists idx_agent_messages_session_created_at on agent_messages(session_id, created_at asc);
        create index if not exists idx_agent_tool_calls_turn_started_at on agent_tool_calls(turn_id, started_at asc);
        create index if not exists idx_agent_runtime_events_session_timestamp on agent_runtime_events(session_id, timestamp asc);
        create index if not exists idx_agent_pending_interactions_session_updated_at on agent_pending_interactions(session_id, updated_at asc);
        create index if not exists idx_agent_pending_interactions_session_status on agent_pending_interactions(session_id, status, created_at asc);
        "#,
        )
        .map_err(|error| to_error(format!("failed to initialize ai registry schema: {error}")))?;
    Ok(())
}

fn ensure_column(
    connection: &Connection,
    table_name: &str,
    column_name: &str,
    column_sql: &str,
) -> Result<()> {
    let columns = table_columns(connection, table_name)?;
    if columns.contains(column_name) {
        return Ok(());
    }
    connection
        .execute(
            &format!("alter table {table_name} add column {column_name} {column_sql}"),
            [],
        )
        .map_err(|error| {
            to_error(format!(
                "failed to add column {column_name} to {table_name}: {error}"
            ))
        })?;
    Ok(())
}

fn migrate_v1_profiles(connection: &Connection) -> Result<()> {
    #[derive(Clone, Debug)]
    struct LegacyProfile {
        id: String,
        name: String,
        provider_kind: String,
        base_url: String,
        model: String,
        api_key_secret_ref: Option<String>,
        is_default: bool,
        created_at: i64,
        updated_at: i64,
    }

    let profiles = {
        let mut statement = connection
            .prepare(
                "select id, name, provider_kind, base_url, model, api_key_secret_ref, is_default, created_at, updated_at from profiles",
            )
            .map_err(|error| to_error(format!("failed to prepare legacy ai profile query: {error}")))?;
        let rows = statement
            .query_map([], |row| {
                Ok(LegacyProfile {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    provider_kind: row.get(2)?,
                    base_url: row.get(3)?,
                    model: row.get(4)?,
                    api_key_secret_ref: row.get(5)?,
                    is_default: row.get::<_, i64>(6)? != 0,
                    created_at: row.get(7)?,
                    updated_at: row.get(8)?,
                })
            })
            .map_err(|error| to_error(format!("failed to query legacy ai profiles: {error}")))?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|error| to_error(format!("failed to collect legacy ai profiles: {error}")))?
    };

    connection
        .execute_batch("drop table if exists profiles;")
        .map_err(|error| to_error(format!("failed to remove legacy ai profile table: {error}")))?;
    create_v2_tables(connection)?;

    for profile in profiles {
        let stored = StoredAiProviderProfile {
            id: profile.id,
            name: profile.name,
            provider_id: "custom_openai_compatible".to_string(),
            protocol_id: profile.provider_kind,
            preset_id: Some("custom_openai_compatible".to_string()),
            connection_config: [("baseUrl".to_string(), profile.base_url)]
                .into_iter()
                .collect(),
            auth_config: Default::default(),
            secret_refs: profile
                .api_key_secret_ref
                .map(|secret_ref| [("apiKey".to_string(), secret_ref)].into_iter().collect())
                .unwrap_or_default(),
            headers: Default::default(),
            model: profile.model,
            custom_models: Vec::<AiProviderModelEntry>::new(),
            discovery_state: AiModelDiscoveryState {
                status: "idle".to_string(),
                last_checked_at: None,
                error_message: None,
                models: Vec::new(),
            },
            is_default: profile.is_default,
            created_at: profile.created_at,
            updated_at: profile.updated_at,
        };
        connection
            .execute(
                "insert into profiles(
                   id, name, provider_id, protocol_id, preset_id,
                   connection_config_json, auth_config_json, secret_refs_json,
                   headers_json, model, custom_models_json, discovery_state_json,
                   is_default, created_at, updated_at
                 ) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
                params![
                    stored.id,
                    stored.name,
                    stored.provider_id,
                    stored.protocol_id,
                    stored.preset_id,
                    to_json(&stored.connection_config)?,
                    to_json(&stored.auth_config)?,
                    to_json(&stored.secret_refs)?,
                    to_json(&stored.headers)?,
                    stored.model,
                    to_json(&stored.custom_models)?,
                    to_json(&stored.discovery_state)?,
                    if stored.is_default { 1 } else { 0 },
                    stored.created_at,
                    stored.updated_at,
                ],
            )
            .map_err(|error| to_error(format!("failed to migrate ai profile: {error}")))?;
    }

    Ok(())
}

pub fn ensure_registry_schema(connection: &Connection) -> Result<()> {
    connection
        .execute_batch(
            "create table if not exists metadata (key text primary key, value text not null);",
        )
        .map_err(|error| to_error(format!("failed to create ai metadata table: {error}")))?;

    let needs_v1_migration = if table_exists(connection, "profiles")? {
        let columns = table_columns(connection, "profiles")?;
        columns.contains("provider_kind")
    } else {
        false
    };

    if needs_v1_migration {
        migrate_v1_profiles(connection)?;
    }

    create_v2_tables(connection)?;
    ensure_column(connection, "sessions", "updated_at_iso", "text")?;
    ensure_column(connection, "sessions", "created_at_iso", "text")?;
    ensure_column(connection, "sessions", "project_root", "text")?;
    ensure_column(connection, "sessions", "project_name", "text")?;
    ensure_column(connection, "agent_sessions", "project_root", "text")?;
    ensure_column(connection, "agent_sessions", "project_name", "text")?;
    ensure_column(
        connection,
        "agent_sessions",
        "collaboration_mode",
        "text not null default 'default'",
    )?;
    ensure_column(connection, "turns", "created_at_iso", "text")?;
    ensure_column(connection, "turns", "updated_at_iso", "text")?;
    connection
        .execute(
            "insert into metadata(key, value)
             values ('schema_version', '2')
             on conflict(key) do update set value = excluded.value",
            [],
        )
        .map_err(|error| to_error(format!("failed to store ai schema version: {error}")))?;
    Ok(())
}
