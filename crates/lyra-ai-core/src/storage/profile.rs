use super::*;

impl AiStore {
    pub fn secret_ref(&self, profile_id: &str, field_id: &str) -> Result<Option<String>> {
        self.with_index_conn(|conn| {
            conn.query_row(
                "SELECT secret_ref_id FROM profile_secret WHERE profile_id = ?1 AND field_id = ?2",
                params![profile_id, field_id],
                |row| row.get(0),
            )
            .optional()
            .context("failed to read AI profile secret ref")
        })
    }

    pub fn upsert_secret_ref(
        &self,
        profile_id: &str,
        field_id: &str,
        secret_ref_id: &str,
    ) -> Result<()> {
        let updated_at = now_ms();
        self.with_index_conn(|conn| {
            conn.execute(
                "INSERT INTO profile_secret (profile_id, field_id, secret_ref_id, updated_at)
                 VALUES (?1, ?2, ?3, ?4)
                 ON CONFLICT(profile_id, field_id) DO UPDATE SET
                   secret_ref_id = excluded.secret_ref_id,
                   updated_at = excluded.updated_at",
                params![profile_id, field_id, secret_ref_id, updated_at],
            )?;
            Ok(())
        })
    }

    pub fn delete_secret_ref(&self, profile_id: &str, field_id: &str) -> Result<Option<String>> {
        self.with_index_conn(|conn| {
            let existing = conn
                .query_row(
                    "SELECT secret_ref_id FROM profile_secret WHERE profile_id = ?1 AND field_id = ?2",
                    params![profile_id, field_id],
                    |row| row.get::<_, String>(0),
                )
                .optional()?;
            conn.execute(
                "DELETE FROM profile_secret WHERE profile_id = ?1 AND field_id = ?2",
                params![profile_id, field_id],
            )?;
            Ok(existing)
        })
    }

    pub fn read_profile(&self, profile_id: &str) -> Result<Option<AiProviderProfile>> {
        self.with_index_conn(|conn| read_profile_row(conn, profile_id))
    }

    pub fn read_profiles(&self) -> Result<Vec<AiProviderProfile>> {
        self.with_index_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT id FROM ai_profile ORDER BY is_default DESC, updated_at DESC, created_at DESC",
            )?;
            let ids = stmt.query_map([], |row| row.get::<_, String>(0))?;
            let mut profiles = Vec::new();
            for id in ids {
                if let Some(profile) = read_profile_row(conn, &id?)? {
                    profiles.push(profile);
                }
            }
            Ok(profiles)
        })
    }

    pub fn default_profile(&self) -> Result<Option<AiProviderProfile>> {
        Ok(self.read_profiles()?.into_iter().next())
    }

    pub fn upsert_profile(&self, profile: &AiProviderProfile) -> Result<()> {
        self.with_index_conn(|conn| {
            if profile.is_default {
                conn.execute("UPDATE ai_profile SET is_default = 0", [])?;
            }
            conn.execute(
                "INSERT INTO ai_profile (
                    id, name, provider_id, protocol_id, runtime_provider_id, runtime_supported,
                    preset_id, connection_config_json, auth_config_json, headers_json, model,
                    model_runtime_metadata_json, custom_models_json, discovery_state_json,
                    is_default, created_at, updated_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)
                 ON CONFLICT(id) DO UPDATE SET
                    name = excluded.name,
                    provider_id = excluded.provider_id,
                    protocol_id = excluded.protocol_id,
                    runtime_provider_id = excluded.runtime_provider_id,
                    runtime_supported = excluded.runtime_supported,
                    preset_id = excluded.preset_id,
                    connection_config_json = excluded.connection_config_json,
                    auth_config_json = excluded.auth_config_json,
                    headers_json = excluded.headers_json,
                    model = excluded.model,
                    model_runtime_metadata_json = excluded.model_runtime_metadata_json,
                    custom_models_json = excluded.custom_models_json,
                    discovery_state_json = excluded.discovery_state_json,
                    is_default = excluded.is_default,
                    updated_at = excluded.updated_at",
                params![
                    profile.id,
                    profile.name,
                    profile.provider_id,
                    profile.protocol_id,
                    profile.runtime_provider_id,
                    if profile.runtime_supported { 1_i64 } else { 0_i64 },
                    profile.preset_id,
                    json_string(&profile.connection_config)?,
                    json_string(&profile.auth_config)?,
                    json_string(&profile.headers)?,
                    profile.model,
                    profile.model_runtime_metadata.as_ref().map(Value::to_string),
                    json_string(&profile.custom_models)?,
                    json_string(&profile.discovery_state)?,
                    if profile.is_default { 1_i64 } else { 0_i64 },
                    profile.created_at,
                    profile.updated_at
                ],
            )?;
            if profile.is_default == false {
                let default_count: i64 = conn.query_row(
                    "SELECT COUNT(*) FROM ai_profile WHERE is_default = 1",
                    [],
                    |row| row.get(0),
                )?;
                if default_count == 0 {
                    conn.execute(
                        "UPDATE ai_profile SET is_default = 1 WHERE id = ?1",
                        params![profile.id],
                    )?;
                }
            }
            Ok(())
        })
    }

    pub fn delete_profile(&self, profile_id: &str) -> Result<Vec<String>> {
        self.with_index_conn(|conn| {
            let mut stmt =
                conn.prepare("SELECT secret_ref_id FROM profile_secret WHERE profile_id = ?1")?;
            let rows = stmt.query_map(params![profile_id], |row| row.get::<_, String>(0))?;
            let mut secret_refs = Vec::new();
            for row in rows {
                secret_refs.push(row?);
            }
            conn.execute(
                "DELETE FROM profile_secret WHERE profile_id = ?1",
                params![profile_id],
            )?;
            conn.execute("DELETE FROM ai_profile WHERE id = ?1", params![profile_id])?;
            conn.execute(
                "UPDATE ai_profile SET is_default = 1
                 WHERE id = (SELECT id FROM ai_profile ORDER BY updated_at DESC LIMIT 1)
                   AND (SELECT COUNT(*) FROM ai_profile WHERE is_default = 1) = 0",
                [],
            )?;
            Ok(secret_refs)
        })
    }
}
