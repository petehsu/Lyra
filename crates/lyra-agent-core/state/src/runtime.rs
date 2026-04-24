use crate::AgentJob;
use crate::AgentJobCreateParams;
use crate::AgentJobItem;
use crate::AgentJobItemCreateParams;
use crate::AgentJobItemStatus;
use crate::AgentJobProgress;
use crate::AgentJobStatus;
use crate::LOGS_DB_FILENAME;
use crate::LOGS_DB_VERSION;
use crate::LogEntry;
use crate::LogQuery;
use crate::LogRow;
use crate::STATE_DB_FILENAME;
use crate::STATE_DB_VERSION;
use crate::SortKey;
use crate::ThreadMetadata;
use crate::ThreadMetadataBuilder;
use crate::ThreadsPage;
use crate::apply_rollout_item;
use crate::migrations::runtime_logs_migrator;
use crate::migrations::runtime_state_migrator;
use crate::model::AgentJobRow;
use crate::model::ThreadRow;
use crate::model::anchor_from_item;
use crate::model::datetime_to_epoch_millis;
use crate::model::datetime_to_epoch_seconds;
use crate::model::epoch_millis_to_datetime;
use crate::paths::file_modified_time_utc;
use chrono::DateTime;
use chrono::Utc;
use log::LevelFilter;
use lyra_protocol::ThreadId;
use lyra_protocol::dynamic_tools::DynamicToolSpec;
use lyra_protocol::protocol::RolloutItem;
use serde_json::Value;
use sqlx::ConnectOptions;
use sqlx::QueryBuilder;
use sqlx::Row;
use sqlx::Sqlite;
use sqlx::SqliteConnection;
use sqlx::SqlitePool;
use sqlx::migrate::Migrator;
use sqlx::sqlite::SqliteAutoVacuum;
use sqlx::sqlite::SqliteConnectOptions;
use sqlx::sqlite::SqliteJournalMode;
use sqlx::sqlite::SqlitePoolOptions;
use sqlx::sqlite::SqliteSynchronous;
use std::collections::BTreeSet;
use std::path::Path;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::AtomicI64;
use std::time::Duration;
use tracing::warn;

mod agent_jobs;
mod backfill;
mod logs;
mod memories;
#[cfg(test)]
mod test_support;
mod threads;

pub use threads::ThreadFilterOptions;

// "Partition" is the retained-log-content bucket we cap at 10 MiB:
// - one bucket per non-null thread_id
// - one bucket per threadless (thread_id IS NULL) non-null process_uuid
// - one bucket for threadless rows with process_uuid IS NULL
// This budget tracks each row's persisted rendered log body plus non-body
// metadata, rather than the exact sum of all persisted SQLite column bytes.
const LOG_PARTITION_SIZE_LIMIT_BYTES: i64 = 10 * 1024 * 1024;
const LOG_PARTITION_ROW_LIMIT: i64 = 1_000;

#[derive(Clone)]
pub struct StateRuntime {
    lyra_home: PathBuf,
    default_provider: String,
    pool: Arc<sqlx::SqlitePool>,
    logs_pool: Arc<sqlx::SqlitePool>,
    thread_updated_at_millis: Arc<AtomicI64>,
}

impl StateRuntime {
    /// Initialize the state runtime using the provided Lyra home and default provider.
    ///
    /// This opens (and migrates) the SQLite databases under `lyra_home`,
    /// keeping logs in a dedicated file to reduce lock contention with the
    /// rest of the state store.
    pub async fn init(lyra_home: PathBuf, default_provider: String) -> anyhow::Result<Arc<Self>> {
        tokio::fs::create_dir_all(&lyra_home).await?;
        let state_migrator = runtime_state_migrator();
        let logs_migrator = runtime_logs_migrator();
        let state_path = state_db_path(lyra_home.as_path());
        let logs_path = logs_db_path(lyra_home.as_path());
        let pool = match open_state_sqlite(&state_path, &state_migrator).await {
            Ok(db) => Arc::new(db),
            Err(err) => {
                warn!("failed to open state db at {}: {err}", state_path.display());
                return Err(err);
            }
        };
        let logs_pool = match open_logs_sqlite(&logs_path, &logs_migrator).await {
            Ok(db) => Arc::new(db),
            Err(err) => {
                warn!("failed to open logs db at {}: {err}", logs_path.display());
                return Err(err);
            }
        };
        let thread_updated_at_millis: Option<i64> =
            sqlx::query_scalar("SELECT MAX(threads.updated_at_ms) FROM threads")
                .fetch_one(pool.as_ref())
                .await?;
        let thread_updated_at_millis = thread_updated_at_millis.unwrap_or(0);
        let runtime = Arc::new(Self {
            pool,
            logs_pool,
            lyra_home,
            default_provider,
            thread_updated_at_millis: Arc::new(AtomicI64::new(thread_updated_at_millis)),
        });
        if let Err(err) = runtime.run_logs_startup_maintenance().await {
            warn!(
                "failed to run startup maintenance for logs db at {}: {err}",
                logs_path.display(),
            );
        }
        Ok(runtime)
    }

    /// Return the configured Lyra home directory for this runtime.
    pub fn lyra_home(&self) -> &Path {
        self.lyra_home.as_path()
    }
}

fn base_sqlite_options(path: &Path) -> SqliteConnectOptions {
    SqliteConnectOptions::new()
        .filename(path)
        .create_if_missing(true)
        .journal_mode(SqliteJournalMode::Wal)
        .synchronous(SqliteSynchronous::Normal)
        .busy_timeout(Duration::from_secs(5))
        .log_statements(LevelFilter::Off)
}

async fn open_state_sqlite(path: &Path, migrator: &Migrator) -> anyhow::Result<SqlitePool> {
    let options = base_sqlite_options(path).auto_vacuum(SqliteAutoVacuum::Incremental);
    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .connect_with(options)
        .await?;
    migrator.run(&pool).await?;
    let auto_vacuum = sqlx::query_scalar::<_, i64>("PRAGMA auto_vacuum")
        .fetch_one(&pool)
        .await?;
    if auto_vacuum != SqliteAutoVacuum::Incremental as i64 {
        // Existing state DBs need one non-transactional `VACUUM` before
        // SQLite persists `auto_vacuum = INCREMENTAL` in the database header.
        sqlx::query("PRAGMA auto_vacuum = INCREMENTAL")
            .execute(&pool)
            .await?;
        // We do it on best effort. If the lock can't be acquired, it will be done at next run.
        let _ = sqlx::query("VACUUM").execute(&pool).await;
    }
    // We do it on best effort. If the lock can't be acquired, it will be done at next run.
    let _ = sqlx::query("PRAGMA incremental_vacuum")
        .execute(&pool)
        .await;
    Ok(pool)
}

async fn open_logs_sqlite(path: &Path, migrator: &Migrator) -> anyhow::Result<SqlitePool> {
    let options = base_sqlite_options(path).auto_vacuum(SqliteAutoVacuum::Incremental);
    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .connect_with(options)
        .await?;
    migrator.run(&pool).await?;
    Ok(pool)
}

fn db_filename(base_name: &str, version: u32) -> String {
    format!("{base_name}_{version}.sqlite")
}

pub fn state_db_filename() -> String {
    db_filename(STATE_DB_FILENAME, STATE_DB_VERSION)
}

pub fn state_db_path(lyra_home: &Path) -> PathBuf {
    lyra_home.join(state_db_filename())
}

pub fn logs_db_filename() -> String {
    db_filename(LOGS_DB_FILENAME, LOGS_DB_VERSION)
}

pub fn logs_db_path(lyra_home: &Path) -> PathBuf {
    lyra_home.join(logs_db_filename())
}

#[cfg(test)]
mod tests {
    use super::open_state_sqlite;
    use super::runtime_state_migrator;
    use super::state_db_path;
    use super::test_support::unique_temp_dir;
    use crate::migrations::STATE_MIGRATOR;
    use sqlx::SqlitePool;
    use sqlx::migrate::MigrateError;
    use sqlx::sqlite::SqliteConnectOptions;
    use std::path::Path;

    async fn open_db_pool(path: &Path) -> SqlitePool {
        SqlitePool::connect_with(
            SqliteConnectOptions::new()
                .filename(path)
                .create_if_missing(false),
        )
        .await
        .expect("open sqlite pool")
    }

    #[tokio::test]
    async fn open_state_sqlite_rejects_newer_applied_migrations() {
        let lyra_home = unique_temp_dir();
        tokio::fs::create_dir_all(&lyra_home)
            .await
            .expect("create Lyra home");
        let state_path = state_db_path(lyra_home.as_path());
        let pool = SqlitePool::connect_with(
            SqliteConnectOptions::new()
                .filename(&state_path)
                .create_if_missing(true),
        )
        .await
        .expect("open state db");
        STATE_MIGRATOR
            .run(&pool)
            .await
            .expect("apply current state schema");
        sqlx::query(
            "INSERT INTO _sqlx_migrations (version, description, success, checksum, execution_time) VALUES (?, ?, ?, ?, ?)",
        )
        .bind(9_999_i64)
        .bind("future migration")
        .bind(true)
        .bind(vec![1_u8, 2, 3, 4])
        .bind(1_i64)
        .execute(&pool)
        .await
        .expect("insert future migration record");
        pool.close().await;

        let strict_pool = open_db_pool(state_path.as_path()).await;
        let strict_err = STATE_MIGRATOR
            .run(&strict_pool)
            .await
            .expect_err("strict migrator should reject newer applied migrations");
        assert!(matches!(strict_err, MigrateError::VersionMissing(9_999)));
        strict_pool.close().await;

        let runtime_migrator = runtime_state_migrator();
        let runtime_err = open_state_sqlite(state_path.as_path(), &runtime_migrator)
            .await
            .expect_err("runtime migrator should reject newer applied migrations");
        let migrate_err = runtime_err
            .downcast_ref::<MigrateError>()
            .expect("runtime error should contain MigrateError");
        assert!(matches!(migrate_err, MigrateError::VersionMissing(9_999)));

        let _ = tokio::fs::remove_dir_all(lyra_home).await;
    }
}
