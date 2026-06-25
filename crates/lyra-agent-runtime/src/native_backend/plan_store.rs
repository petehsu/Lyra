use super::*;
use rusqlite::{Connection, OptionalExtension, params};
use sha2::{Digest, Sha256};

const PLAN_DB_SCHEMA_VERSION: i64 = 1;

pub(crate) const PLAN_PHASE_NONE: &str = "none";
pub(crate) const PLAN_PHASE_PLANNING: &str = "planning";
pub(crate) const PLAN_PHASE_REVIEWING: &str = "reviewing";
pub(crate) const PLAN_PHASE_TODO_REQUIRED: &str = "todo_required";
pub(crate) const PLAN_PHASE_EXECUTING_TODO: &str = "executing_todo";
pub(crate) const PLAN_PHASE_COMPLETED: &str = "completed";
pub(crate) const PLAN_PHASE_SET_ASIDE: &str = "set_aside";

#[derive(Clone, Debug)]
pub(crate) struct PlanSessionScope {
    pub(crate) project_key: Option<String>,
    pub(crate) working_dir: String,
}

pub(crate) fn plan_scope_from_session(session: &NativeSession) -> PlanSessionScope {
    let working_dir = session
        .snapshot
        .get("workingDir")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let project_bound = session
        .snapshot
        .get("projectBound")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let working_dir_is_home = session
        .snapshot
        .get("workingDirIsHome")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let project_key = (project_bound && !working_dir_is_home)
        .then(|| project_key_for_working_dir(&working_dir))
        .transpose()
        .ok()
        .flatten();
    PlanSessionScope {
        project_key,
        working_dir,
    }
}

pub(crate) fn project_key_for_working_dir(working_dir: &str) -> AgentRuntimeResult<String> {
    let path = PathBuf::from(working_dir);
    let canonical = path
        .canonicalize()
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
        .trim_end_matches('/')
        .to_string();
    if canonical.trim().is_empty() {
        return Err(AgentRuntimeError::Core(
            "workingDir is required for project plan key".to_string(),
        ));
    }
    let mut hasher = Sha256::new();
    hasher.update(canonical.as_bytes());
    let digest = hasher.finalize();
    Ok(format!("{digest:x}").chars().take(32).collect())
}

pub(crate) fn project_plan_db_path(root: &Path, project_key: &str) -> PathBuf {
    root.join("projects").join(project_key).join("plans.db")
}

pub(crate) fn open_project_plan_store(
    root: &Path,
    project_key: &str,
) -> AgentRuntimeResult<Connection> {
    let path = project_plan_db_path(root, project_key);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
    }
    let conn =
        Connection::open(path).map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
    init_project_plan_schema(&conn)?;
    Ok(conn)
}

fn init_project_plan_schema(conn: &Connection) -> AgentRuntimeResult<()> {
    conn.execute_batch(
        r#"
        PRAGMA foreign_keys = ON;
        CREATE TABLE IF NOT EXISTS project_meta (
          project_key TEXT PRIMARY KEY,
          working_dir TEXT NOT NULL,
          schema_version INTEGER NOT NULL,
          created_at_ms INTEGER NOT NULL,
          created_at_iso TEXT NOT NULL,
          updated_at_ms INTEGER NOT NULL,
          updated_at_iso TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS plans (
          plan_id TEXT PRIMARY KEY,
          project_key TEXT NOT NULL,
          session_id TEXT,
          title TEXT NOT NULL,
          status TEXT NOT NULL,
          current_version_id TEXT,
          created_at_ms INTEGER NOT NULL,
          created_at_iso TEXT NOT NULL,
          updated_at_ms INTEGER NOT NULL,
          updated_at_iso TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS plan_versions (
          version_id TEXT PRIMARY KEY,
          plan_id TEXT NOT NULL,
          parent_version_id TEXT,
          source TEXT NOT NULL,
          markdown TEXT NOT NULL,
          annotations_json TEXT NOT NULL,
          created_at_ms INTEGER NOT NULL,
          created_at_iso TEXT NOT NULL,
          FOREIGN KEY(plan_id) REFERENCES plans(plan_id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS todo_lists (
          todo_list_id TEXT PRIMARY KEY,
          plan_id TEXT NOT NULL,
          version_id TEXT NOT NULL,
          status TEXT NOT NULL,
          current_index INTEGER NOT NULL DEFAULT 0,
          todos_json TEXT NOT NULL,
          summary TEXT,
          created_at_ms INTEGER NOT NULL,
          created_at_iso TEXT NOT NULL,
          updated_at_ms INTEGER NOT NULL,
          updated_at_iso TEXT NOT NULL,
          FOREIGN KEY(plan_id) REFERENCES plans(plan_id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_plans_project_updated
          ON plans(project_key, updated_at_ms DESC);
        CREATE INDEX IF NOT EXISTS idx_plan_versions_plan_created
          ON plan_versions(plan_id, created_at_ms ASC);
        CREATE INDEX IF NOT EXISTS idx_todo_lists_plan
          ON todo_lists(plan_id);
        "#,
    )
    .map_err(|error| AgentRuntimeError::Core(error.to_string()))
}

pub(crate) fn upsert_project_meta(
    conn: &Connection,
    project_key: &str,
    working_dir: &str,
    now_iso: &str,
) -> AgentRuntimeResult<()> {
    let now_ms = Utc::now().timestamp_millis();
    conn.execute(
        r#"
        INSERT INTO project_meta (
          project_key, working_dir, schema_version, created_at_ms, created_at_iso, updated_at_ms, updated_at_iso
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?4, ?5)
        ON CONFLICT(project_key) DO UPDATE SET
          working_dir = excluded.working_dir,
          schema_version = excluded.schema_version,
          updated_at_ms = excluded.updated_at_ms,
          updated_at_iso = excluded.updated_at_iso
        "#,
        params![project_key, working_dir, PLAN_DB_SCHEMA_VERSION, now_ms, now_iso],
    )
    .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
    Ok(())
}

pub(crate) fn persist_plan_snapshot(
    root: &Path,
    session_id: &str,
    scope: &PlanSessionScope,
    plan: &Value,
) -> AgentRuntimeResult<()> {
    persist_plan_snapshot_with_source(root, session_id, scope, plan, "agent", None)
}

pub(crate) fn persist_plan_snapshot_with_source(
    root: &Path,
    session_id: &str,
    scope: &PlanSessionScope,
    plan: &Value,
    source: &str,
    parent_version_id: Option<&str>,
) -> AgentRuntimeResult<()> {
    let Some(project_key) = scope.project_key.as_deref() else {
        return Ok(());
    };
    let plan_id = plan
        .get("activePlanId")
        .and_then(Value::as_str)
        .ok_or_else(|| AgentRuntimeError::Core("activePlanId is required".to_string()))?;
    let version_id = plan
        .get("activeVersionId")
        .and_then(Value::as_str)
        .unwrap_or(plan_id);
    let title = plan.get("title").and_then(Value::as_str).unwrap_or("Plan");
    let phase = plan
        .get("phase")
        .and_then(Value::as_str)
        .unwrap_or(PLAN_PHASE_NONE);
    let markdown = plan
        .get("markdown")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let annotations_json = serde_json::to_string(
        plan.get("annotations")
            .filter(|value| value.is_array())
            .unwrap_or(&Value::Array(Vec::new())),
    )
    .unwrap_or_else(|_| "[]".to_string());
    let now_iso = now();
    let now_ms = Utc::now().timestamp_millis();
    let conn = open_project_plan_store(root, project_key)?;
    upsert_project_meta(&conn, project_key, &scope.working_dir, &now_iso)?;
    conn.execute(
        r#"
        INSERT INTO plans (
          plan_id, project_key, session_id, title, status, current_version_id, created_at_ms, created_at_iso, updated_at_ms, updated_at_iso
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?7, ?8)
        ON CONFLICT(plan_id) DO UPDATE SET
          title = excluded.title,
          status = excluded.status,
          current_version_id = excluded.current_version_id,
          updated_at_ms = excluded.updated_at_ms,
          updated_at_iso = excluded.updated_at_iso
        "#,
        params![plan_id, project_key, session_id, title, phase, version_id, now_ms, now_iso],
    )
    .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
    conn.execute(
        r#"
        INSERT OR REPLACE INTO plan_versions (
          version_id, plan_id, parent_version_id, source, markdown, annotations_json, created_at_ms, created_at_iso
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
        "#,
        params![
            version_id,
            plan_id,
            parent_version_id,
            source,
            markdown,
            annotations_json,
            now_ms,
            now_iso
        ],
    )
    .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
    Ok(())
}

pub(crate) fn persist_project_todo_snapshot(
    root: &Path,
    scope: &PlanSessionScope,
    project_todo: &Value,
) -> AgentRuntimeResult<()> {
    let Some(project_key) = scope.project_key.as_deref() else {
        return Ok(());
    };
    let plan_id = project_todo
        .get("planId")
        .and_then(Value::as_str)
        .ok_or_else(|| AgentRuntimeError::Core("projectTodo.planId is required".to_string()))?;
    let version_id = project_todo
        .get("versionId")
        .and_then(Value::as_str)
        .ok_or_else(|| AgentRuntimeError::Core("projectTodo.versionId is required".to_string()))?;
    let todo_list_id = project_todo
        .get("todoListId")
        .and_then(Value::as_str)
        .unwrap_or(plan_id);
    let status = project_todo
        .get("status")
        .and_then(Value::as_str)
        .unwrap_or("pending");
    let current_index = project_todo
        .get("currentIndex")
        .and_then(Value::as_i64)
        .unwrap_or_default();
    let todos_json = serde_json::to_string(
        project_todo
            .get("todos")
            .filter(|value| value.is_array())
            .unwrap_or(&Value::Array(Vec::new())),
    )
    .unwrap_or_else(|_| "[]".to_string());
    let summary = project_todo.get("summary").and_then(Value::as_str);
    let now_iso = now();
    let now_ms = Utc::now().timestamp_millis();
    let conn = open_project_plan_store(root, project_key)?;
    upsert_project_meta(&conn, project_key, &scope.working_dir, &now_iso)?;
    conn.execute(
        r#"
        INSERT INTO todo_lists (
          todo_list_id, plan_id, version_id, status, current_index, todos_json, summary, created_at_ms, created_at_iso, updated_at_ms, updated_at_iso
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?8, ?9)
        ON CONFLICT(todo_list_id) DO UPDATE SET
          status = excluded.status,
          current_index = excluded.current_index,
          todos_json = excluded.todos_json,
          summary = excluded.summary,
          updated_at_ms = excluded.updated_at_ms,
          updated_at_iso = excluded.updated_at_iso
        "#,
        params![
            todo_list_id,
            plan_id,
            version_id,
            status,
            current_index,
            todos_json,
            summary,
            now_ms,
            now_iso
        ],
    )
    .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
    Ok(())
}

pub(crate) fn list_project_plans(root: &Path, working_dir: &str) -> AgentRuntimeResult<Value> {
    let project_key = project_key_for_working_dir(working_dir)?;
    if !project_plan_db_path(root, &project_key).exists() {
        return Ok(json!({
            "projectKey": project_key,
            "workingDir": working_dir,
            "plans": [],
        }));
    }
    let conn = open_project_plan_store(root, &project_key)?;
    let mut stmt = conn
        .prepare(
            r#"
            SELECT
              p.plan_id,
              p.title,
              p.status,
              p.current_version_id,
              p.session_id,
              p.created_at_iso,
              p.updated_at_iso,
              (
                SELECT t.status
                FROM todo_lists t
                WHERE t.plan_id = p.plan_id
                ORDER BY t.updated_at_ms DESC
                LIMIT 1
              ) AS todo_status
            FROM plans p
            WHERE p.project_key = ?1
            ORDER BY p.updated_at_ms DESC
            "#,
        )
        .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
    let rows = stmt
        .query_map(params![&project_key], |row| {
            Ok(json!({
                "planId": row.get::<_, String>(0)?,
                "title": row.get::<_, String>(1)?,
                "status": row.get::<_, String>(2)?,
                "currentVersionId": row.get::<_, Option<String>>(3)?,
                "sessionId": row.get::<_, Option<String>>(4)?,
                "createdAtIso": row.get::<_, String>(5)?,
                "updatedAtIso": row.get::<_, String>(6)?,
                "todoStatus": row.get::<_, Option<String>>(7)?,
            }))
        })
        .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
    let plans = collect_json_rows(rows)?;
    Ok(json!({
        "projectKey": project_key,
        "workingDir": working_dir,
        "plans": plans,
    }))
}

pub(crate) fn read_project_plan(
    root: &Path,
    working_dir: &str,
    plan_id: &str,
) -> AgentRuntimeResult<Value> {
    let project_key = project_key_for_working_dir(working_dir)?;
    if !project_plan_db_path(root, &project_key).exists() {
        return Err(AgentRuntimeError::Core(format!(
            "project plan store not found for workingDir: {working_dir}"
        )));
    }
    let conn = open_project_plan_store(root, &project_key)?;
    let plan = conn
        .query_row(
            r#"
            SELECT plan_id, project_key, session_id, title, status, current_version_id,
                   created_at_iso, updated_at_iso
            FROM plans
            WHERE project_key = ?1 AND plan_id = ?2
            "#,
            params![&project_key, plan_id],
            |row| {
                Ok(json!({
                    "planId": row.get::<_, String>(0)?,
                    "projectKey": row.get::<_, String>(1)?,
                    "sessionId": row.get::<_, Option<String>>(2)?,
                    "title": row.get::<_, String>(3)?,
                    "status": row.get::<_, String>(4)?,
                    "currentVersionId": row.get::<_, Option<String>>(5)?,
                    "createdAtIso": row.get::<_, String>(6)?,
                    "updatedAtIso": row.get::<_, String>(7)?,
                }))
            },
        )
        .optional()
        .map_err(|error| AgentRuntimeError::Core(error.to_string()))?
        .ok_or_else(|| AgentRuntimeError::Core(format!("plan not found: {plan_id}")))?;

    let mut versions_stmt = conn
        .prepare(
            r#"
            SELECT version_id, parent_version_id, source, markdown, annotations_json, created_at_iso
            FROM plan_versions
            WHERE plan_id = ?1
            ORDER BY created_at_ms ASC
            "#,
        )
        .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
    let version_rows = versions_stmt
        .query_map(params![plan_id], |row| {
            let annotations_json: String = row.get(4)?;
            Ok(json!({
                "versionId": row.get::<_, String>(0)?,
                "parentVersionId": row.get::<_, Option<String>>(1)?,
                "source": row.get::<_, String>(2)?,
                "markdown": row.get::<_, String>(3)?,
                "annotations": parse_json_array(&annotations_json),
                "createdAtIso": row.get::<_, String>(5)?,
            }))
        })
        .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
    let versions = collect_json_rows(version_rows)?;
    let current_version_id = plan
        .get("currentVersionId")
        .and_then(Value::as_str)
        .map(str::to_string);
    let current_version = versions
        .iter()
        .find(|version| {
            current_version_id.as_deref() == version.get("versionId").and_then(Value::as_str)
        })
        .cloned()
        .or_else(|| versions.last().cloned())
        .unwrap_or(Value::Null);
    let project_todo = read_latest_project_todo(&conn, plan_id)?;

    Ok(json!({
        "projectKey": project_key,
        "workingDir": working_dir,
        "plan": plan,
        "versions": versions,
        "currentVersion": current_version,
        "projectTodo": project_todo,
    }))
}

pub(crate) fn delete_project_plan(
    root: &Path,
    working_dir: &str,
    plan_id: &str,
) -> AgentRuntimeResult<Value> {
    let project_key = project_key_for_working_dir(working_dir)?;
    if !project_plan_db_path(root, &project_key).exists() {
        return Ok(json!({
            "projectKey": project_key,
            "workingDir": working_dir,
            "planId": plan_id,
            "deleted": false,
        }));
    }
    let conn = open_project_plan_store(root, &project_key)?;
    let deleted = conn
        .execute(
            "DELETE FROM plans WHERE project_key = ?1 AND plan_id = ?2",
            params![&project_key, plan_id],
        )
        .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
    Ok(json!({
        "projectKey": project_key,
        "workingDir": working_dir,
        "planId": plan_id,
        "deleted": deleted > 0,
    }))
}

pub(crate) fn read_project_todo(
    root: &Path,
    working_dir: &str,
    plan_id: &str,
) -> AgentRuntimeResult<Value> {
    let project_key = project_key_for_working_dir(working_dir)?;
    if !project_plan_db_path(root, &project_key).exists() {
        return Ok(json!({
            "projectKey": project_key,
            "workingDir": working_dir,
            "planId": plan_id,
            "todo": Value::Null,
        }));
    }
    let conn = open_project_plan_store(root, &project_key)?;
    let todo = read_latest_project_todo(&conn, plan_id)?;
    Ok(json!({
        "projectKey": project_key,
        "workingDir": working_dir,
        "planId": plan_id,
        "todo": todo,
    }))
}

fn read_latest_project_todo(conn: &Connection, plan_id: &str) -> AgentRuntimeResult<Value> {
    conn.query_row(
        r#"
        SELECT todo_list_id, plan_id, version_id, status, current_index, todos_json, summary,
               created_at_iso, updated_at_iso
        FROM todo_lists
        WHERE plan_id = ?1
        ORDER BY updated_at_ms DESC
        LIMIT 1
        "#,
        params![plan_id],
        |row| {
            let todos_json: String = row.get(5)?;
            Ok(json!({
                "todoListId": row.get::<_, String>(0)?,
                "planId": row.get::<_, String>(1)?,
                "versionId": row.get::<_, String>(2)?,
                "status": row.get::<_, String>(3)?,
                "currentIndex": row.get::<_, i64>(4)?,
                "todos": parse_json_array(&todos_json),
                "summary": row.get::<_, Option<String>>(6)?,
                "createdAtIso": row.get::<_, String>(7)?,
                "updatedAtIso": row.get::<_, String>(8)?,
            }))
        },
    )
    .optional()
    .map_err(|error| AgentRuntimeError::Core(error.to_string()))
    .map(|value| value.unwrap_or(Value::Null))
}

fn collect_json_rows(
    rows: rusqlite::MappedRows<'_, impl FnMut(&rusqlite::Row<'_>) -> rusqlite::Result<Value>>,
) -> AgentRuntimeResult<Vec<Value>> {
    let mut values = Vec::new();
    for row in rows {
        values.push(row.map_err(|error| AgentRuntimeError::Core(error.to_string()))?);
    }
    Ok(values)
}

fn parse_json_array(value: &str) -> Value {
    serde_json::from_str::<Value>(value)
        .ok()
        .filter(Value::is_array)
        .unwrap_or_else(|| Value::Array(Vec::new()))
}
