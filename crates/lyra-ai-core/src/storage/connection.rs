use super::*;

impl AiStore {
    pub fn open(storage_root: Option<&str>) -> Result<Self> {
        let root = resolve_storage_root(storage_root)?;
        fs::create_dir_all(root.join("sessions"))
            .with_context(|| format!("failed to create AI storage root {}", root.display()))?;
        let store = Self { root };
        store.with_index_conn(|conn| migrate_index(conn))?;
        Ok(store)
    }

    pub fn index_path(&self) -> PathBuf {
        self.root.join("index.sqlite")
    }

    pub fn session_dir(&self, session_id: &str) -> PathBuf {
        self.root.join("sessions").join(session_id)
    }

    pub fn session_path(&self, session_id: &str) -> PathBuf {
        self.session_dir(session_id).join("session.sqlite")
    }

    pub fn with_index_conn<T>(&self, f: impl FnOnce(&Connection) -> Result<T>) -> Result<T> {
        fs::create_dir_all(&self.root)?;
        let conn = Connection::open(self.index_path()).with_context(|| {
            format!(
                "failed to open AI index database {}",
                self.index_path().display()
            )
        })?;
        configure_conn(&conn)?;
        migrate_index(&conn)?;
        f(&conn)
    }

    pub fn with_session_conn<T>(
        &self,
        session_id: &str,
        f: impl FnOnce(&Connection) -> Result<T>,
    ) -> Result<T> {
        fs::create_dir_all(self.session_dir(session_id))?;
        let path = self.session_path(session_id);
        let conn = Connection::open(&path)
            .with_context(|| format!("failed to open AI session database {}", path.display()))?;
        configure_conn(&conn)?;
        migrate_session(&conn)?;
        f(&conn)
    }

    #[cfg(test)]
    pub fn count_rows_for_test(&self, session_id: &str, table: &str) -> Result<i64> {
        if matches!(
            table,
            "artifact_record"
                | "evidence_record"
                | "timeline_checkpoint"
                | "approval_ticket"
                | "file_backup_record"
                | "planning_session"
                | "plan_version"
                | "plan_review_panel"
                | "plan_review_annotation"
                | "plan_coverage_report"
                | "execution_todo_list"
                | "todo_item"
                | "execution_run"
                | "execution_step"
                | "verification_plan"
                | "verification_run"
                | "completion_audit"
                | "delivery_proof"
        ) == false
        {
            return Err(anyhow!("unsupported table for test count"));
        }
        self.with_session_conn(session_id, |conn| {
            conn.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                row.get(0)
            })
            .context("failed to count AI session rows")
        })
    }
}
