use std::time::Duration;

/// Classifies an error as either recoverable or non-recoverable.
///
/// Recoverable errors are transient issues (network timeouts, rate limits,
/// temporary server errors) that may succeed on retry.
/// Non-recoverable errors are structural (auth failure, invalid model, quota
/// exceeded) that will not resolve without intervention.
#[derive(Debug, Clone, PartialEq)]
pub enum ErrorSeverity {
    /// Transient error — safe to retry with backoff.
    Recoverable {
        /// Suggested minimum wait time before retry.
        retry_after_ms: u64,
        /// Human-readable reason (for logging, not shown to user).
        reason: String,
    },
    /// Permanent error — retrying will not help.
    NonRecoverable {
        /// Error code for categorization.
        code: String,
        /// Human-readable description.
        reason: String,
    },
}

impl ErrorSeverity {
    pub fn is_recoverable(&self) -> bool {
        matches!(self, ErrorSeverity::Recoverable { .. })
    }

    pub fn retry_after_ms(&self) -> u64 {
        match self {
            ErrorSeverity::Recoverable { retry_after_ms, .. } => *retry_after_ms,
            ErrorSeverity::NonRecoverable { .. } => 0,
        }
    }
}

/// Classify an HTTP status code + error body into recoverable/non-recoverable.
pub fn classify_http_error(status: u16, body: &str) -> ErrorSeverity {
    match status {
        // 4xx — mostly non-recoverable
        400 => ErrorSeverity::NonRecoverable {
            code: "bad_request".into(),
            reason: format!("bad request: {body}"),
        },
        401 => ErrorSeverity::NonRecoverable {
            code: "auth_failed".into(),
            reason: "authentication failed — check API key".into(),
        },
        403 => ErrorSeverity::NonRecoverable {
            code: "forbidden".into(),
            reason: "access forbidden — check permissions".into(),
        },
        404 => ErrorSeverity::NonRecoverable {
            code: "not_found".into(),
            reason: format!("resource not found: {body}"),
        },
        429 => {
            // Rate limit — recoverable, extract Retry-After if present
            let retry_after = parse_retry_after(body).unwrap_or(60_000);
            ErrorSeverity::Recoverable {
                retry_after_ms: retry_after,
                reason: "rate limited — backing off".into(),
            }
        }
        // 5xx — server errors are usually transient
        500 => ErrorSeverity::Recoverable {
            retry_after_ms: 5_000,
            reason: format!("internal server error: {body}"),
        },
        502 => ErrorSeverity::Recoverable {
            retry_after_ms: 10_000,
            reason: "bad gateway — upstream issue".into(),
        },
        503 => ErrorSeverity::Recoverable {
            retry_after_ms: 15_000,
            reason: "service unavailable — backing off".into(),
        },
        504 => ErrorSeverity::Recoverable {
            retry_after_ms: 10_000,
            reason: "gateway timeout — backing off".into(),
        },
        other => ErrorSeverity::NonRecoverable {
            code: format!("http_{other}"),
            reason: format!("unexpected HTTP status {other}: {body}"),
        },
    }
}

/// Classify a network-level error (connection refused, timeout, etc.).
pub fn classify_network_error(message: &str) -> ErrorSeverity {
    let lower = message.to_lowercase();

    if lower.contains("timeout") || lower.contains("timed out") {
        return ErrorSeverity::Recoverable {
            retry_after_ms: 5_000,
            reason: "request timed out — retrying".into(),
        };
    }
    if lower.contains("connection refused") {
        return ErrorSeverity::Recoverable {
            retry_after_ms: 3_000,
            reason: "connection refused — server may be restarting".into(),
        };
    }
    if lower.contains("connection reset") {
        return ErrorSeverity::Recoverable {
            retry_after_ms: 3_000,
            reason: "connection reset — transient network issue".into(),
        };
    }
    if lower.contains("dns") {
        return ErrorSeverity::NonRecoverable {
            code: "dns_error".into(),
            reason: format!("DNS resolution failed: {message}"),
        };
    }
    if lower.contains("certificate") || lower.contains("ssl") {
        return ErrorSeverity::NonRecoverable {
            code: "tls_error".into(),
            reason: format!("TLS/certificate error: {message}"),
        };
    }

    // Default: treat unknown network errors as recoverable (conservative)
    ErrorSeverity::Recoverable {
        retry_after_ms: 5_000,
        reason: format!("network error: {message}"),
    }
}

/// Classify a tool execution error as recoverable or non-recoverable.
pub fn classify_tool_error(
    tool_name: &str,
    error_code: Option<&str>,
    error_message: &str,
) -> ErrorSeverity {
    let code = error_code.unwrap_or("");
    let msg_lower = error_message.to_lowercase();

    match (tool_name, code) {
        // File-not-found is recoverable — the agent can retry with a different path
        (_, "ENOENT") | (_, "NOT_FOUND") => ErrorSeverity::Recoverable {
            retry_after_ms: 0,
            reason: format!("file not found — agent should verify path: {error_message}"),
        },
        // Permission denied is non-recoverable — agent can't fix filesystem permissions
        (_, "EACCES") | (_, "PERMISSION_DENIED") => ErrorSeverity::NonRecoverable {
            code: "permission_denied".into(),
            reason: format!("permission denied: {error_message}"),
        },
        // Edit no-match is recoverable — agent should re-read and retry
        ("filesystem.edit" | "filesystem.multi_edit", "NO_MATCH") => ErrorSeverity::Recoverable {
            retry_after_ms: 0,
            reason: "edit pattern did not match — re-read file and retry".into(),
        },
        // File unchanged is recoverable — agent attempted a no-op write
        ("filesystem.write", "UNCHANGED") => ErrorSeverity::Recoverable {
            retry_after_ms: 0,
            reason: "file write produced no changes".into(),
        },
        // Timeout during tool execution — recoverable
        (_, "TIMEOUT") => ErrorSeverity::Recoverable {
            retry_after_ms: 5_000,
            reason: "tool execution timed out".into(),
        },
        // Out of disk space — non-recoverable
        (_, "ENOSPC") => ErrorSeverity::NonRecoverable {
            code: "no_space".into(),
            reason: "no space left on device".into(),
        },
        // Generic tool failures — recoverable (agent can adapt)
        _ => {
            if msg_lower.contains("not found") || msg_lower.contains("does not exist") {
                ErrorSeverity::Recoverable {
                    retry_after_ms: 0,
                    reason: format!("resource not found: {error_message}"),
                }
            } else if msg_lower.contains("permission") || msg_lower.contains("denied") {
                ErrorSeverity::NonRecoverable {
                    code: "permission_denied".into(),
                    reason: format!("permission denied: {error_message}"),
                }
            } else {
                // Default: recoverable — let the agent decide
                ErrorSeverity::Recoverable {
                    retry_after_ms: 0,
                    reason: format!("tool error: {error_message}"),
                }
            }
        }
    }
}

/// Exponential backoff calculator.
///
/// Computes the delay for a given retry attempt:
/// `delay = base_ms * (multiplier ^ attempt)`, capped at max_ms.
pub struct ExponentialBackoff {
    pub base_ms: u64,
    pub multiplier: f64,
    pub max_ms: u64,
    pub jitter: bool,
}

impl Default for ExponentialBackoff {
    fn default() -> Self {
        Self {
            base_ms: 1_000,
            multiplier: 2.0,
            max_ms: 60_000,
            jitter: true,
        }
    }
}

impl ExponentialBackoff {
    pub fn delay_ms(&self, attempt: u32) -> u64 {
        let delay = (self.base_ms as f64 * self.multiplier.powi(attempt as i32)) as u64;
        let capped = delay.min(self.max_ms);
        if self.jitter {
            // Add ±25% jitter to prevent thundering herd
            let jitter_range = (capped as f64 * 0.25) as u64;
            let jitter = (std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as u64)
                % (jitter_range.max(1) * 2).saturating_sub(jitter_range);
            capped.saturating_sub(jitter_range).saturating_add(jitter)
        } else {
            capped
        }
    }
}

/// Retry executor with backoff and attempt tracking.
pub struct RetryExecutor {
    pub max_attempts: u32,
    pub backoff: ExponentialBackoff,
}

impl Default for RetryExecutor {
    fn default() -> Self {
        Self {
            max_attempts: 3,
            backoff: ExponentialBackoff::default(),
        }
    }
}

impl RetryExecutor {
    /// Execute a fallible operation with retry and exponential backoff.
    /// Returns the first successful result or the last error.
    pub fn execute<F, T, E>(&self, mut operation: F) -> std::result::Result<T, E>
    where
        F: FnMut() -> std::result::Result<T, E>,
        E: std::fmt::Display,
    {
        let mut last_error = None;

        for attempt in 0..self.max_attempts {
            match operation() {
                Ok(result) => return Ok(result),
                Err(e) => {
                    last_error = Some(e);
                    if attempt < self.max_attempts - 1 {
                        let delay = self.backoff.delay_ms(attempt);
                        std::thread::sleep(Duration::from_millis(delay));
                    }
                }
            }
        }

        Err(last_error.unwrap())
    }

    /// Execute with classification — only retries if the error is recoverable.
    pub fn execute_with_classification<F, T, E>(
        &self,
        mut operation: F,
        classifier: impl Fn(&E) -> ErrorSeverity,
    ) -> std::result::Result<T, E>
    where
        F: FnMut() -> std::result::Result<T, E>,
        E: std::fmt::Display,
    {
        let mut last_error = None;

        for attempt in 0..self.max_attempts {
            match operation() {
                Ok(result) => return Ok(result),
                Err(e) => {
                    let severity = classifier(&e);
                    if !severity.is_recoverable() {
                        return Err(e);
                    }
                    last_error = Some(e);
                    if attempt < self.max_attempts - 1 {
                        let delay = self
                            .backoff
                            .delay_ms(attempt)
                            .max(severity.retry_after_ms());
                        std::thread::sleep(Duration::from_millis(delay));
                    }
                }
            }
        }

        Err(last_error.unwrap())
    }
}

/// Parse Retry-After from error body or response header string.
fn parse_retry_after(body: &str) -> Option<u64> {
    // Try parsing as seconds (integer)
    if let Ok(seconds) = body.parse::<u64>() {
        return Some(seconds * 1000);
    }
    None
}

/// Determine if an error should be withheld from the user (Error Withholding).
///
/// Transient errors that are automatically retried should not be surfaced
/// to the user. Only persistent, non-recoverable errors should be shown.
pub fn should_withhold_error(severity: &ErrorSeverity, attempt: u32) -> bool {
    match severity {
        // Always withhold recoverable errors during early retry attempts
        ErrorSeverity::Recoverable { .. } => attempt < 2,
        // Show non-recoverable errors immediately
        ErrorSeverity::NonRecoverable { .. } => false,
    }
}

/// Build a user-friendly error message from a classified error.
/// Non-recoverable errors get full detail; recoverable errors get a generic message.
pub fn format_user_message(severity: &ErrorSeverity) -> String {
    match severity {
        ErrorSeverity::Recoverable { .. } => {
            "A temporary issue occurred. Retrying automatically...".into()
        }
        ErrorSeverity::NonRecoverable { code, reason } => {
            format!("Operation failed ({code}): {reason}")
        }
    }
}

/// Track error history for error-withholding decisions.
#[derive(Default)]
pub struct ErrorWithholdingBuffer {
    /// Errors that have been suppressed (not shown to user).
    suppressed_count: u32,
    /// Last suppressed error severity (for logging).
    last_suppressed: Option<ErrorSeverity>,
}

impl ErrorWithholdingBuffer {
    pub fn new() -> Self {
        Self::default()
    }

    /// Process an error — returns whether it should be shown to the user.
    pub fn process(&mut self, severity: ErrorSeverity, attempt: u32) -> Option<String> {
        if should_withhold_error(&severity, attempt) {
            self.suppressed_count += 1;
            self.last_suppressed = Some(severity);
            None
        } else {
            Some(format_user_message(&severity))
        }
    }

    /// Get the count of suppressed errors (for diagnostics).
    pub fn suppressed_count(&self) -> u32 {
        self.suppressed_count
    }

    /// Reset the buffer (called after successful recovery or turn completion).
    pub fn reset(&mut self) {
        self.suppressed_count = 0;
        self.last_suppressed = None;
    }
}
