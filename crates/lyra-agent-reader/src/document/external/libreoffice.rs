//! LibreOffice-backed Office conversion adapter.

use std::process::Command;
use std::time::{Duration, Instant};

use crate::types::{Format, ReaderWarning, WarningCode};

const LIBREOFFICE_TIMEOUT: Duration = Duration::from_secs(20);

pub(in crate::document) struct LibreOfficeAttempt {
    pub(in crate::document) html: Option<String>,
    pub(in crate::document) warnings: Vec<ReaderWarning>,
}

pub(in crate::document) fn try_libreoffice_html(
    bytes: &[u8],
    format: Format,
) -> LibreOfficeAttempt {
    try_libreoffice_html_with_candidates(bytes, format, libreoffice_candidates())
}

fn libreoffice_candidates() -> Vec<String> {
    let mut candidates = Vec::new();
    if let Ok(path) = std::env::var("LYRA_AGENT_READER_LIBREOFFICE") {
        if !path.trim().is_empty() {
            candidates.push(path);
        }
    }
    candidates.push("soffice".to_string());
    candidates.push("libreoffice".to_string());
    candidates
}

pub(super) fn try_libreoffice_html_with_candidates(
    bytes: &[u8],
    format: Format,
    candidates: Vec<String>,
) -> LibreOfficeAttempt {
    let mut warnings = Vec::new();
    let extension = match format {
        Format::Docx => "docx",
        Format::Xlsx => "xlsx",
        Format::Pptx => "pptx",
        _ => {
            return LibreOfficeAttempt {
                html: None,
                warnings,
            };
        }
    };
    let temp_dir = match tempfile::tempdir() {
        Ok(value) => value,
        Err(error) => {
            warnings.push(ReaderWarning {
                code: WarningCode::ExternalAdapterFailed,
                message: format!("LibreOffice temp directory creation failed: {error}"),
            });
            return LibreOfficeAttempt {
                html: None,
                warnings,
            };
        }
    };
    let input_path = temp_dir.path().join(format!("input.{extension}"));
    if let Err(error) = std::fs::write(&input_path, bytes) {
        warnings.push(ReaderWarning {
            code: WarningCode::ExternalAdapterFailed,
            message: format!("LibreOffice input write failed: {error}"),
        });
        return LibreOfficeAttempt {
            html: None,
            warnings,
        };
    }

    let mut attempted = false;
    for binary in candidates {
        let spawn = Command::new(&binary)
            .arg("--headless")
            .arg("--convert-to")
            .arg("html")
            .arg("--outdir")
            .arg(temp_dir.path())
            .arg(&input_path)
            .spawn();
        let Ok(mut child) = spawn else {
            continue;
        };
        attempted = true;
        let status = wait_for_child_with_timeout(&mut child, LIBREOFFICE_TIMEOUT, &mut warnings);
        let Some(status) = status else {
            let _ = child.kill();
            let _ = child.wait();
            warnings.push(ReaderWarning {
                code: WarningCode::ExternalAdapterFailed,
                message: format!(
                    "LibreOffice conversion timed out after {} seconds; Rust fallback was used",
                    LIBREOFFICE_TIMEOUT.as_secs()
                ),
            });
            continue;
        };
        if !status.success() {
            warnings.push(ReaderWarning {
                code: WarningCode::ExternalAdapterFailed,
                message: format!("LibreOffice conversion exited with status {status}"),
            });
            continue;
        }
        let html_path = temp_dir.path().join("input.html");
        if let Ok(html) = std::fs::read_to_string(&html_path) {
            if !html.trim().is_empty() {
                return LibreOfficeAttempt {
                    html: Some(html),
                    warnings,
                };
            }
        }
    }
    if !attempted {
        warnings.push(ReaderWarning {
            code: WarningCode::ExternalAdapterMissing,
            message: "LibreOffice/soffice was not available; Rust Office fallback was used"
                .to_string(),
        });
    }
    LibreOfficeAttempt {
        html: None,
        warnings,
    }
}

fn wait_for_child_with_timeout(
    child: &mut std::process::Child,
    timeout: Duration,
    warnings: &mut Vec<ReaderWarning>,
) -> Option<std::process::ExitStatus> {
    let wait_start = Instant::now();
    while wait_start.elapsed() < timeout {
        match child.try_wait() {
            Ok(Some(value)) => return Some(value),
            Ok(None) => std::thread::sleep(Duration::from_millis(50).min(timeout)),
            Err(error) => {
                warnings.push(ReaderWarning {
                    code: WarningCode::ExternalAdapterFailed,
                    message: format!("LibreOffice wait failed: {error}"),
                });
                return None;
            }
        }
    }
    None
}

#[cfg(test)]
#[allow(clippy::expect_used, clippy::unwrap_used, unused_imports)]
mod tests {
    use super::*;
    use crate::document::assembler::recommended_next_action;
    use std::process::Command;
    use std::time::Duration;

    #[test]
    fn libreoffice_missing_returns_warning_and_recommendation() {
        let attempt = try_libreoffice_html_with_candidates(
            b"not a real docx",
            Format::Docx,
            vec!["/definitely/not/lyra-soffice".to_string()],
        );
        assert!(attempt.html.is_none());
        assert!(
            attempt
                .warnings
                .iter()
                .any(|warning| warning.code == WarningCode::ExternalAdapterMissing)
        );
        assert!(
            recommended_next_action(false, &attempt.warnings)
                .unwrap_or_default()
                .contains("LibreOffice")
        );
    }

    #[test]
    fn external_adapter_timeout_kills_process() {
        let mut child = Command::new("sh")
            .arg("-c")
            .arg("sleep 1")
            .spawn()
            .expect("spawn sleep");
        let mut warnings = Vec::new();
        let status =
            wait_for_child_with_timeout(&mut child, Duration::from_millis(10), &mut warnings);
        assert!(status.is_none());
        let _ = child.kill();
        let _ = child.wait();
    }
}
