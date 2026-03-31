use napi::Result;
use rusqlite::params;

use crate::error::{to_error, to_json};
use crate::paths::{ensure_ai_dirs, ensure_session_dir, resolve_ai_paths, resolve_session_db_path};
use crate::session::types::{AiChatMessage, AiChatToken};
use crate::storage::schema::{ensure_session_schema, open_sqlite};

fn open_session_db(storage_root: &str, session_id: &str) -> Result<rusqlite::Connection> {
    let paths = resolve_ai_paths(storage_root)?;
    ensure_ai_dirs(&paths)?;
    ensure_session_dir(&paths, session_id)?;
    let path = resolve_session_db_path(&paths, session_id);
    let connection = open_sqlite(&path)?;
    ensure_session_schema(&connection)?;
    Ok(connection)
}

fn parse_tokens_json(value: Option<String>) -> Result<Option<Vec<AiChatToken>>> {
    match value {
        None => Ok(None),
        Some(payload) if payload.trim().is_empty() => Ok(None),
        Some(payload) => serde_json::from_str(&payload)
            .map(Some)
            .map_err(|error| to_error(format!("failed to parse ai message tokens: {error}"))),
    }
}

pub fn read_messages(storage_root: &str, session_id: &str) -> Result<Vec<AiChatMessage>> {
    let connection = open_session_db(storage_root, session_id)?;
    let mut statement = connection
        .prepare(
            "select id, turn_id, role, mode, content, status, tokens_json, created_at, updated_at
             from messages
             order by created_at asc, id asc",
        )
        .map_err(|error| to_error(format!("failed to prepare ai message query: {error}")))?;
    let mut rows = statement
        .query([])
        .map_err(|error| to_error(format!("failed to query ai messages: {error}")))?;
    let mut messages = Vec::new();

    while let Some(row) = rows
        .next()
        .map_err(|error| to_error(format!("failed to read ai message row: {error}")))?
    {
        messages.push(AiChatMessage {
            id: row
                .get(0)
                .map_err(|error| to_error(format!("failed to read ai message id: {error}")))?,
            session_id: session_id.to_string(),
            turn_id: row
                .get(1)
                .map_err(|error| to_error(format!("failed to read ai message turn id: {error}")))?,
            role: row
                .get(2)
                .map_err(|error| to_error(format!("failed to read ai message role: {error}")))?,
            mode: row
                .get(3)
                .map_err(|error| to_error(format!("failed to read ai message mode: {error}")))?,
            content: row
                .get(4)
                .map_err(|error| to_error(format!("failed to read ai message content: {error}")))?,
            status: row
                .get(5)
                .map_err(|error| to_error(format!("failed to read ai message status: {error}")))?,
            tokens: parse_tokens_json(row.get(6).map_err(|error| {
                to_error(format!("failed to read ai message tokens: {error}"))
            })?)?,
            created_at: row.get(7).map_err(|error| {
                to_error(format!("failed to read ai message createdAt: {error}"))
            })?,
            updated_at: row.get(8).map_err(|error| {
                to_error(format!("failed to read ai message updatedAt: {error}"))
            })?,
        });
    }

    Ok(messages)
}

pub fn read_message(
    storage_root: &str,
    session_id: &str,
    message_id: &str,
) -> Result<Option<AiChatMessage>> {
    let messages = read_messages(storage_root, session_id)?;
    Ok(messages
        .into_iter()
        .find(|message| message.id == message_id))
}

pub fn write_message(storage_root: &str, session_id: &str, message: &AiChatMessage) -> Result<()> {
    let connection = open_session_db(storage_root, session_id)?;
    let tokens_json = match message.tokens.as_ref() {
        None => None,
        Some(tokens) if tokens.is_empty() => None,
        Some(tokens) => Some(to_json(tokens)?),
    };
    connection
        .execute(
            "insert into messages(id, turn_id, role, mode, content, status, tokens_json, created_at, updated_at)
             values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
             on conflict(id) do update set
               turn_id = excluded.turn_id,
               role = excluded.role,
               mode = excluded.mode,
               content = excluded.content,
               status = excluded.status,
               tokens_json = excluded.tokens_json,
               updated_at = excluded.updated_at",
            params![
                message.id,
                message.turn_id,
                message.role,
                message.mode,
                message.content,
                message.status,
                tokens_json,
                message.created_at,
                message.updated_at,
            ],
        )
        .map_err(|error| to_error(format!("failed to write ai message: {error}")))?;
    Ok(())
}
