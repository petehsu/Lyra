//! Logging infrastructure for jcode
//!
//! Logs to ~/.jcode/logs/ with automatic rotation
//!
//! Supports thread-local context for server, session, provider, and model info.

use chrono::Local;
use std::cell::RefCell;
use std::collections::HashMap;
use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

static LOGGER: Mutex<Option<Logger>> = Mutex::new(None);
static TASK_LOG_CONTEXTS: OnceLock<Mutex<HashMap<String, LogContext>>> = OnceLock::new();

/// Thread-local logging context
#[derive(Default, Clone)]
pub struct LogContext {
    pub server: Option<String>,
    pub session: Option<String>,
    pub provider: Option<String>,
    pub model: Option<String>,
}

thread_local! {
    static LOG_CONTEXT: RefCell<LogContext> = RefCell::new(LogContext::default());
}

/// Update just the session in the current context
pub fn set_session(session: &str) {
    if with_task_context_mut(|ctx| {
        ctx.session = Some(session.to_string());
    }) {
        return;
    }

    LOG_CONTEXT.with(|c| {
        c.borrow_mut().session = Some(session.to_string());
    });
}

/// Update just the server in the current context
pub fn set_server(server: &str) {
    if with_task_context_mut(|ctx| {
        ctx.server = Some(server.to_string());
    }) {
        return;
    }

    LOG_CONTEXT.with(|c| {
        c.borrow_mut().server = Some(server.to_string());
    });
}

/// Update provider and model in the current context
pub fn set_provider_info(provider: &str, model: &str) {
    if with_task_context_mut(|ctx| {
        ctx.provider = Some(provider.to_string());
        ctx.model = Some(model.to_string());
    }) {
        return;
    }

    LOG_CONTEXT.with(|c| {
        let mut ctx = c.borrow_mut();
        ctx.provider = Some(provider.to_string());
        ctx.model = Some(model.to_string());
    });
}

/// Get the current context as a prefix string
fn context_prefix() -> String {
    if let Some(task_ctx) = task_context_snapshot() {
        return context_prefix_for(&task_ctx);
    }

    LOG_CONTEXT.with(|c| context_prefix_for(&c.borrow()))
}

fn current_task_id() -> Option<String> {
    tokio::task::try_id().map(|id| id.to_string())
}

fn with_task_context_mut(update: impl FnOnce(&mut LogContext)) -> bool {
    let Some(task_id) = current_task_id() else {
        return false;
    };

    let store = TASK_LOG_CONTEXTS.get_or_init(|| Mutex::new(HashMap::new()));
    if let Ok(mut contexts) = store.lock() {
        let ctx = contexts.entry(task_id).or_default();
        update(ctx);
        true
    } else {
        false
    }
}

fn task_context_snapshot() -> Option<LogContext> {
    let task_id = current_task_id()?;
    let store = TASK_LOG_CONTEXTS.get()?;
    let contexts = store.lock().ok()?;
    contexts.get(&task_id).cloned()
}

/// Snapshot the current logging context for diagnostics that need stable,
/// session-scoped in-memory keys in addition to the rendered log prefix.
pub fn current_context_snapshot() -> LogContext {
    task_context_snapshot().unwrap_or_else(|| LOG_CONTEXT.with(|c| c.borrow().clone()))
}

fn context_prefix_for(ctx: &LogContext) -> String {
    let mut parts = Vec::new();

    if let Some(ref server) = ctx.server {
        parts.push(format!("srv:{}", server));
    }
    if let Some(ref session) = ctx.session {
        // Truncate session name if too long
        let short = if session.len() > 20 {
            &session[..20]
        } else {
            session
        };
        parts.push(format!("ses:{}", short));
    }
    if let Some(ref provider) = ctx.provider {
        parts.push(format!("prv:{}", provider));
    }
    if let Some(ref model) = ctx.model {
        // Just use first part of model name
        let short = model.split('-').next().unwrap_or(model);
        parts.push(format!("mod:{}", short));
    }

    if parts.is_empty() {
        String::new()
    } else {
        format!("[{}] ", parts.join("|"))
    }
}

pub struct Logger {
    file: File,
}

fn log_dir() -> Option<PathBuf> {
    crate::storage::logs_dir().ok()
}

impl Logger {
    fn new() -> Option<Self> {
        let log_dir = log_dir()?;
        crate::storage::ensure_dir(&log_dir).ok()?;

        // Use date-based log file
        let date = Local::now().format("%Y-%m-%d");
        let path = log_dir.join(format!("jcode-{}.log", date));

        let file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
            .ok()?;

        Some(Self { file })
    }

    fn write(&mut self, level: &str, message: &str) {
        let timestamp = Local::now().format("%Y-%m-%d %H:%M:%S%.3f");
        let ctx = context_prefix();
        let line = format!("[{}] [{}] {}{}\n", timestamp, level, ctx, message);
        if let Err(err) = self.file.write_all(line.as_bytes()) {
            eprintln!("jcode logger write failed: {err}");
            return;
        }
        if let Err(err) = self.file.flush() {
            eprintln!("jcode logger flush failed: {err}");
        }
    }
}

/// Initialize the logger (call once at startup)
pub fn init() {
    let mut guard = match LOGGER.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };
    if guard.is_none() {
        *guard = Logger::new();
    }
}

/// Log an info message
#[expect(
    clippy::collapsible_if,
    reason = "Logger lock + optional logger branching is intentionally straightforward"
)]
pub fn info(message: &str) {
    if let Ok(mut guard) = LOGGER.lock() {
        if let Some(logger) = guard.as_mut() {
            logger.write("INFO", message);
        }
    }
}

/// Log an error message
#[expect(
    clippy::collapsible_if,
    reason = "Logger lock + optional logger branching is intentionally straightforward"
)]
pub fn error(message: &str) {
    if let Ok(mut guard) = LOGGER.lock() {
        if let Some(logger) = guard.as_mut() {
            logger.write("ERROR", message);
        }
    }
}

/// Log a warning message
#[expect(
    clippy::collapsible_if,
    reason = "Logger lock + optional logger branching is intentionally straightforward"
)]
pub fn warn(message: &str) {
    if let Ok(mut guard) = LOGGER.lock() {
        if let Some(logger) = guard.as_mut() {
            logger.write("WARN", message);
        }
    }
}

/// Log a debug message (only if JCODE_TRACE is set)
#[expect(
    clippy::collapsible_if,
    reason = "Debug logging keeps env gating and logger access explicit"
)]
pub fn debug(message: &str) {
    if std::env::var("JCODE_TRACE").is_ok() {
        if let Ok(mut guard) = LOGGER.lock() {
            if let Some(logger) = guard.as_mut() {
                logger.write("DEBUG", message);
            }
        }
    }
}

/// Log a structured auth event with conservative redaction.
///
/// Callers should pass only non-secret metadata. This function still redacts any
/// field whose key looks credential-like so accidental tokens/keys do not land in
/// logs.
pub fn auth_event(event: &str, provider: &str, fields: &[(&str, &str)]) {
    let mut parts = vec![
        format!("event={}", sanitize_log_value(event)),
        format!("provider={}", sanitize_log_value(provider)),
    ];
    for (key, value) in fields {
        parts.push(format!(
            "{}={}",
            sanitize_log_value(key),
            redact_auth_field(key, value)
        ));
    }
    let msg = format!("AUTH {}", parts.join(" "));
    if let Ok(mut guard) = LOGGER.lock()
        && let Some(logger) = guard.as_mut()
    {
        logger.write("AUTH", &msg);
    }
}

/// Log a tool call
#[expect(
    clippy::collapsible_if,
    reason = "Logger lock + optional logger branching is intentionally straightforward"
)]
pub fn tool_call(name: &str, input: &str, output: &str) {
    let msg = format!(
        "TOOL[{}] input={} output={}",
        name,
        truncate(input, 200),
        truncate(output, 500)
    );
    if let Ok(mut guard) = LOGGER.lock() {
        if let Some(logger) = guard.as_mut() {
            logger.write("TOOL", &msg);
        }
    }
}

/// Log a crash/panic for auto-debug
#[expect(
    clippy::collapsible_if,
    reason = "Logger lock + optional logger branching is intentionally straightforward"
)]
pub fn crash(error: &str, context: &str) {
    let msg = format!("CRASH: {} | Context: {}", error, context);
    if let Ok(mut guard) = LOGGER.lock() {
        if let Some(logger) = guard.as_mut() {
            logger.write("CRASH", &msg);
        }
    }
}

/// Get the session ID from the current logging context (thread-local or task-local).
pub fn current_session() -> Option<String> {
    if let Some(ctx) = task_context_snapshot() {
        return ctx.session;
    }
    LOG_CONTEXT.with(|c| c.borrow().session.clone())
}

/// Get path to today's log file
pub fn log_path() -> Option<PathBuf> {
    let log_dir = log_dir()?;
    let date = Local::now().format("%Y-%m-%d");
    Some(log_dir.join(format!("jcode-{}.log", date)))
}

/// Clean up old logs (keep last 7 days)
pub fn cleanup_old_logs() {
    if let Some(log_dir) = log_dir()
        && let Ok(entries) = fs::read_dir(&log_dir)
    {
        let cutoff = Local::now() - chrono::Duration::days(7);
        for entry in entries.flatten() {
            if let Ok(metadata) = entry.metadata()
                && let Ok(modified) = metadata.modified()
            {
                let modified: chrono::DateTime<Local> = modified.into();
                if modified < cutoff
                    && let Err(err) = fs::remove_file(entry.path())
                {
                    eprintln!("jcode logger cleanup failed: {err}");
                }
            }
        }
    }
}

fn truncate(s: &str, max_len: usize) -> String {
    if s.len() > max_len {
        format!("{}...", crate::util::truncate_str(s, max_len))
    } else {
        s.to_string()
    }
}

fn redact_auth_field(key: &str, value: &str) -> String {
    let key = key.to_ascii_lowercase();
    if key.contains("token")
        || key.contains("secret")
        || key.contains("key")
        || key.contains("credential")
        || key.contains("callback")
        || key.contains("code")
        || key.contains("authorization")
    {
        return "<redacted>".to_string();
    }
    sanitize_log_value(value)
}

fn sanitize_log_value(value: &str) -> String {
    let value = value.replace(['\n', '\r', '\t'], " ");
    let value = redact_url_queries(&value);
    truncate(&value, 160)
}

fn redact_url_queries(value: &str) -> String {
    value
        .split(' ')
        .map(|word| {
            if (word.starts_with("http://") || word.starts_with("https://")) && word.contains('?') {
                let (base, _) = word.split_once('?').unwrap_or((word, ""));
                format!("{}?<redacted>", base)
            } else {
                word.to_string()
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn auth_log_redacts_secret_like_fields() {
        assert_eq!(redact_auth_field("api_key", "sk-secret"), "<redacted>");
        assert_eq!(
            redact_auth_field("callback_url", "https://example.com/?code=secret"),
            "<redacted>"
        );
    }

    #[test]
    fn auth_log_sanitizes_urls_and_control_characters() {
        assert_eq!(
            sanitize_log_value("failed\nhttps://login.example.com/cb?code=secret&state=abc"),
            "failed https://login.example.com/cb?<redacted>"
        );
    }
}
