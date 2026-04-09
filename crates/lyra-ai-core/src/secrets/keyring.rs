use napi::Result;

use crate::error::to_error;

const AI_SECRET_SERVICE: &str = "lyra.ai";

#[cfg(target_os = "macos")]
fn security_command(args: &[&str]) -> std::io::Result<std::process::Output> {
    std::process::Command::new("security").args(args).output()
}

#[cfg(target_os = "macos")]
fn stderr_text(output: &std::process::Output) -> String {
    String::from_utf8_lossy(&output.stderr).trim().to_string()
}

#[cfg(target_os = "macos")]
fn stdout_text(output: &std::process::Output) -> String {
    String::from_utf8_lossy(&output.stdout).trim().to_string()
}

#[cfg(target_os = "macos")]
fn is_not_found_message(message: &str) -> bool {
    message.contains("could not be found")
}

#[cfg(target_os = "macos")]
pub fn write_secret_value(secret_ref: &str, secret_value: &str) -> Result<()> {
    let output = security_command(&[
        "add-generic-password",
        "-U",
        "-s",
        AI_SECRET_SERVICE,
        "-a",
        secret_ref,
        "-w",
        secret_value,
    ])
    .map_err(|error| to_error(format!("failed to access macOS keychain: {error}")))?;
    if output.status.success() {
        #[cfg(debug_assertions)]
        eprintln!(
            "[lyra-ai][keychain] write ok service={} account={} status={}",
            AI_SECRET_SERVICE, secret_ref, output.status
        );
        return Ok(());
    }
    #[cfg(debug_assertions)]
    eprintln!(
        "[lyra-ai][keychain] write fail service={} account={} status={} stderr={}",
        AI_SECRET_SERVICE,
        secret_ref,
        output.status,
        stderr_text(&output)
    );
    Err(to_error(format!(
        "failed to store ai api key securely: {}",
        stderr_text(&output)
    )))
}

#[cfg(target_os = "macos")]
pub fn read_secret_value(secret_ref: &str) -> Result<String> {
    let output = security_command(&[
        "find-generic-password",
        "-s",
        AI_SECRET_SERVICE,
        "-a",
        secret_ref,
        "-w",
    ])
    .map_err(|error| to_error(format!("failed to access macOS keychain: {error}")))?;
    if output.status.success() {
        #[cfg(debug_assertions)]
        eprintln!(
            "[lyra-ai][keychain] read ok service={} account={} status={}",
            AI_SECRET_SERVICE, secret_ref, output.status
        );
        return Ok(stdout_text(&output));
    }
    #[cfg(debug_assertions)]
    eprintln!(
        "[lyra-ai][keychain] read fail service={} account={} status={} stderr={}",
        AI_SECRET_SERVICE,
        secret_ref,
        output.status,
        stderr_text(&output)
    );
    Err(to_error(format!(
        "failed to read ai api key securely: {}",
        stderr_text(&output)
    )))
}

#[cfg(target_os = "macos")]
pub fn delete_secret_value(secret_ref: &str) -> Result<()> {
    let output = security_command(&[
        "delete-generic-password",
        "-s",
        AI_SECRET_SERVICE,
        "-a",
        secret_ref,
    ])
    .map_err(|error| to_error(format!("failed to access macOS keychain: {error}")))?;
    if output.status.success() || is_not_found_message(&stderr_text(&output)) {
        return Ok(());
    }
    Err(to_error(format!(
        "failed to delete ai api key securely: {}",
        stderr_text(&output)
    )))
}

#[cfg(target_os = "macos")]
pub fn secret_value_exists(secret_ref: &str) -> bool {
    let output = match security_command(&[
        "find-generic-password",
        "-s",
        AI_SECRET_SERVICE,
        "-a",
        secret_ref,
    ]) {
        Ok(value) => value,
        Err(_) => return true,
    };
    if output.status.success() {
        #[cfg(debug_assertions)]
        eprintln!(
            "[lyra-ai][keychain] exists yes service={} account={} status={}",
            AI_SECRET_SERVICE, secret_ref, output.status
        );
        return true;
    }
    let message = stderr_text(&output);
    #[cfg(debug_assertions)]
    eprintln!(
        "[lyra-ai][keychain] exists no service={} account={} status={} stderr={}",
        AI_SECRET_SERVICE, secret_ref, output.status, message
    );
    !is_not_found_message(&message)
}

#[cfg(not(target_os = "macos"))]
mod other_platform {
    use keyring::Entry;
    use napi::Result;

    use crate::error::to_error;

    const AI_SECRET_SERVICE: &str = "lyra.ai";

    fn create_secret_entry(secret_ref: &str) -> Result<Entry> {
        Entry::new(AI_SECRET_SERVICE, secret_ref)
            .map_err(|error| to_error(format!("failed to access ai secure storage: {error}")))
    }

    pub fn write_secret_value(secret_ref: &str, secret_value: &str) -> Result<()> {
        create_secret_entry(secret_ref)?
            .set_password(secret_value)
            .map_err(|error| to_error(format!("failed to store ai api key securely: {error}")))
    }

    pub fn read_secret_value(secret_ref: &str) -> Result<String> {
        create_secret_entry(secret_ref)?
            .get_password()
            .map_err(|error| to_error(format!("failed to read ai api key securely: {error}")))
    }

    pub fn delete_secret_value(secret_ref: &str) -> Result<()> {
        match create_secret_entry(secret_ref)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) => Err(to_error(format!(
                "failed to delete ai api key securely: {error}"
            ))),
        }
    }

    pub fn secret_value_exists(secret_ref: &str) -> bool {
        let entry = match Entry::new(AI_SECRET_SERVICE, secret_ref) {
            Ok(value) => value,
            Err(_) => return true,
        };
        match entry.get_password() {
            Ok(_) => true,
            Err(keyring::Error::NoEntry) => false,
            Err(_) => true,
        }
    }
}

#[cfg(not(target_os = "macos"))]
pub use other_platform::{
    delete_secret_value, read_secret_value, secret_value_exists, write_secret_value,
};
