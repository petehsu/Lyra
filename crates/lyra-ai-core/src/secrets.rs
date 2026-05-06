use anyhow::{anyhow, Context, Result};
use std::fs::{self, OpenOptions};
use std::io::Write;
#[cfg(unix)]
use std::os::unix::fs::OpenOptionsExt;
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use std::path::Path;
use uuid::Uuid;

pub fn create_secret_ref() -> String {
    format!("ai-secret-{}", Uuid::new_v4())
}

fn validate_secret_ref(secret_ref_id: &str) -> Result<&str> {
    let normalized = secret_ref_id.trim();
    if normalized.is_empty()
        || normalized.contains('/')
        || normalized.contains('\\')
        || normalized.contains("..")
    {
        return Err(anyhow!("invalid AI secret ref"));
    }
    Ok(normalized)
}

pub fn write_secret(root: &Path, secret_ref_id: &str, value: &str) -> Result<()> {
    let secret_ref_id = validate_secret_ref(secret_ref_id)?;
    let directory = root.join("secrets");
    fs::create_dir_all(&directory).with_context(|| {
        format!(
            "failed to create AI secret directory {}",
            directory.display()
        )
    })?;
    #[cfg(unix)]
    fs::set_permissions(&directory, fs::Permissions::from_mode(0o700)).with_context(|| {
        format!(
            "failed to restrict AI secret directory {}",
            directory.display()
        )
    })?;

    let path = directory.join(secret_ref_id);
    let temp_path = directory.join(format!("{secret_ref_id}.tmp"));
    let mut options = OpenOptions::new();
    options.create(true).truncate(true).write(true);
    #[cfg(unix)]
    options.mode(0o600);
    {
        let mut file = options
            .open(&temp_path)
            .with_context(|| format!("failed to write AI secret {}", temp_path.display()))?;
        file.write_all(value.as_bytes())
            .context("failed to write AI secret")?;
        file.sync_all().context("failed to sync AI secret")?;
    }
    #[cfg(unix)]
    fs::set_permissions(&temp_path, fs::Permissions::from_mode(0o600))
        .with_context(|| format!("failed to restrict AI secret file {}", temp_path.display()))?;
    fs::rename(&temp_path, &path).with_context(|| {
        format!(
            "failed to install AI secret {} -> {}",
            temp_path.display(),
            path.display()
        )
    })?;
    let saved = read_secret(root, secret_ref_id)?;
    if saved != value {
        return Err(anyhow!("AI secret storage verification failed"));
    }
    Ok(())
}

pub fn read_secret(root: &Path, secret_ref_id: &str) -> Result<String> {
    let secret_ref_id = validate_secret_ref(secret_ref_id)?;
    let path = root.join("secrets").join(secret_ref_id);
    fs::read_to_string(&path).with_context(|| {
        format!(
            "AI secret is missing from secure storage: {}",
            path.display()
        )
    })
}

pub fn delete_secret(root: &Path, secret_ref_id: &str) -> Result<()> {
    let secret_ref_id = validate_secret_ref(secret_ref_id)?;
    let path = root.join("secrets").join(secret_ref_id);
    match fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => {
            Err(error).with_context(|| format!("failed to delete AI secret {}", path.display()))
        }
    }
}
