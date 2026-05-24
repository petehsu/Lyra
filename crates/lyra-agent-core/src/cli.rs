pub mod login {
    use anyhow::Result;

    pub fn read_secret_line() -> Result<String> {
        Ok(String::new())
    }
}

pub mod selfdev {
    pub const CLIENT_SELFDEV_ENV: &str = "JCODE_CLIENT_SELFDEV";

    pub fn client_selfdev_requested() -> bool {
        std::env::var(CLIENT_SELFDEV_ENV)
            .map(|value| !value.trim().is_empty() && value != "0")
            .unwrap_or(false)
    }
}

pub mod tui_launch {
    use anyhow::Result;
    use std::path::Path;

    pub fn spawn_selfdev_in_new_terminal(
        _exe: &Path,
        _session_id: &str,
        _cwd: &Path,
    ) -> Result<bool> {
        Ok(false)
    }

    pub fn spawn_resume_in_new_terminal(
        _exe: &Path,
        _session_id: &str,
        _cwd: &Path,
    ) -> Result<bool> {
        Ok(false)
    }

    pub fn spawn_selfdev_in_new_terminal_with_provider(
        _exe: &Path,
        _session_id: &str,
        _cwd: &Path,
        _provider_key: Option<&str>,
    ) -> Result<bool> {
        Ok(false)
    }

    pub fn spawn_resume_in_new_terminal_with_provider(
        _exe: &Path,
        _session_id: &str,
        _cwd: &Path,
        _provider_key: Option<&str>,
    ) -> Result<bool> {
        Ok(false)
    }
}
