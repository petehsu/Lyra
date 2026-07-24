//! Top-level pipeline: resolve source → render → assemble [`ReaderResult`].

mod assembler;
mod browser_source;
mod cache;
mod caption;
mod external;
mod image;
mod network_policy;
mod ocr;
mod office;
mod pdf;
mod render_dispatch;
mod security;
mod source;

use std::time::Instant;

use crate::errors::ReaderError;
use crate::fetch::{BrowserSnapshotProvider, FetchProvider};
use crate::types::{
    ReaderEngine, ReaderEngineAttempt, ReaderInput, ReaderRequest, ReaderResult, ReaderTiming,
    ReaderWarning, WarningCode,
};

use browser_source::{
    auto_browser_fallback_reason, resolve_browser_source, should_auto_browser_fallback,
    should_auto_browser_fallback_error,
};
use render_dispatch::render_source;
use source::{Source, input_url, resolve_source};

/// Run the full pipeline for `request`, fetching via `fetch` when needed.
pub fn run(
    request: &ReaderRequest,
    fetch: Option<&dyn FetchProvider>,
) -> Result<ReaderResult, ReaderError> {
    run_with_optional_browser(request, fetch, None)
}

/// Run the pipeline with an optional browser snapshot provider.
pub fn run_with_browser(
    request: &ReaderRequest,
    fetch: Option<&dyn FetchProvider>,
    browser: Option<&dyn BrowserSnapshotProvider>,
) -> Result<ReaderResult, ReaderError> {
    run_with_optional_browser(request, fetch, browser)
}

fn run_with_optional_browser(
    request: &ReaderRequest,
    fetch: Option<&dyn FetchProvider>,
    browser: Option<&dyn BrowserSnapshotProvider>,
) -> Result<ReaderResult, ReaderError> {
    let normalized_request;
    let request = if matches!(request.options.preset, crate::types::ReaderPreset::Agent) {
        request
    } else {
        normalized_request = {
            let mut request = request.clone();
            request.options.apply_preset_defaults();
            request
        };
        &normalized_request
    };
    let total_start = Instant::now();

    if matches!(request.options.engine, ReaderEngine::Browser)
        && matches!(request.input, ReaderInput::Url(_))
    {
        let mut attempts = vec![engine_attempt("browser", false, None, None)];
        match resolve_browser_source(request, browser)
            .and_then(|browser_source| render_source(request, &browser_source))
        {
            Ok(mut result) => {
                let status = result.status;
                attempts[0] = engine_attempt("browser", true, None, status);
                attach_engine_metadata(&mut result, "browser", attempts, total_start);
                return Ok(result);
            }
            Err(error) => {
                attempts[0] = engine_attempt(
                    "browser",
                    false,
                    Some(error.to_string()),
                    error_status(&error),
                );
                return Err(engines_exhausted_or_original(
                    error,
                    attempts,
                    input_url(request),
                ));
            }
        }
    }

    if matches!(request.options.engine, ReaderEngine::Browser) && browser.is_none() {
        let attempts = vec![engine_attempt(
            "browser",
            false,
            Some("browser snapshot provider is required for engine=browser".to_string()),
            None,
        )];
        return Err(engines_exhausted_or_original(
            ReaderError::Fetch {
                message: "browser snapshot provider is required for engine=browser".to_string(),
                final_url: input_url(request),
                status: None,
            },
            attempts,
            input_url(request),
        ));
    }

    if !matches!(request.input, ReaderInput::Url(_)) {
        let source = resolve_source(request, fetch)?;
        let mut result = render_source(request, &source)?;
        result
            .timing
            .get_or_insert_with(ReaderTiming::default)
            .fetch_ms = source.fetch_ms;
        attach_engine_metadata(
            &mut result,
            engine_label_for_source(&source),
            Vec::new(),
            total_start,
        );
        return Ok(result);
    }

    let mut attempts = Vec::new();
    match resolve_source(request, fetch) {
        Ok(source) => {
            let status = source.status;
            let fetch_ms = source.fetch_ms;
            let mut result = render_source(request, &source)?;
            result
                .timing
                .get_or_insert_with(ReaderTiming::default)
                .fetch_ms = fetch_ms;
            if matches!(request.options.engine, ReaderEngine::Http) {
                attempts.push(engine_attempt("http", true, None, status));
                attach_engine_metadata(&mut result, "http", attempts, total_start);
                return Ok(result);
            }

            if should_auto_browser_fallback(request, &source, &result) {
                let reason = auto_browser_fallback_reason(request, &result);
                attempts.push(engine_attempt("http", false, Some(reason), status));
                if let Some(browser) = browser {
                    return try_browser_after_http(request, browser, &mut attempts, total_start);
                }
                result.warnings.push(ReaderWarning {
                    code: WarningCode::BrowserRecommended,
                    message: attempts
                        .last()
                        .and_then(|attempt| attempt.reason.clone())
                        .unwrap_or_else(|| "browser rendering recommended".to_string()),
                });
                if result.recommended_next_action.is_none() {
                    result.recommended_next_action = Some(
                        "Use a browser-rendered snapshot or browser path for this page."
                            .to_string(),
                    );
                }
                attach_engine_metadata(&mut result, "http", attempts, total_start);
                return Ok(result);
            }

            attempts.push(engine_attempt("http", true, None, status));
            attach_engine_metadata(&mut result, "http", attempts, total_start);
            Ok(result)
        }
        Err(error) if should_auto_browser_fallback_error(request, &error) => {
            attempts.push(engine_attempt(
                "http",
                false,
                Some(error.to_string()),
                error_status(&error),
            ));
            if browser.is_some() {
                return try_browser_after_http(
                    request,
                    browser.unwrap(),
                    &mut attempts,
                    total_start,
                );
            }
            Err(attach_attempts_to_error(error, attempts))
        }
        Err(error) => {
            if matches!(request.options.engine, ReaderEngine::Http) {
                attempts.push(engine_attempt(
                    "http",
                    false,
                    Some(error.to_string()),
                    error_status(&error),
                ));
            }
            Err(attach_attempts_to_error(error, attempts))
        }
    }
}

fn try_browser_after_http(
    request: &ReaderRequest,
    browser: &dyn BrowserSnapshotProvider,
    attempts: &mut Vec<ReaderEngineAttempt>,
    total_start: Instant,
) -> Result<ReaderResult, ReaderError> {
    match resolve_browser_source(request, Some(browser))
        .and_then(|browser_source| render_source(request, &browser_source))
    {
        Ok(mut browser_result) => {
            attempts.push(engine_attempt(
                "browser",
                true,
                Some("recovered after http failure or thin static render".to_string()),
                browser_result.status,
            ));
            attach_engine_metadata(
                &mut browser_result,
                "browser",
                attempts.clone(),
                total_start,
            );
            Ok(browser_result)
        }
        Err(error) => {
            attempts.push(engine_attempt(
                "browser",
                false,
                Some(error.to_string()),
                error_status(&error),
            ));
            Err(engines_exhausted_or_original(
                error,
                attempts.clone(),
                input_url(request),
            ))
        }
    }
}

fn attach_engine_metadata(
    result: &mut ReaderResult,
    engine_used: &str,
    attempts: Vec<ReaderEngineAttempt>,
    total_start: Instant,
) {
    result.engine_used = Some(engine_used.to_string());
    result.engine_attempts = attempts;
    result
        .timing
        .get_or_insert_with(ReaderTiming::default)
        .total_ms = elapsed_ms(total_start);
}

fn engine_label_for_source(source: &Source) -> &'static str {
    use source::SourceKind;
    match source.source_kind {
        SourceKind::Browser => "browser",
        SourceKind::Http => "http",
        _ => "local",
    }
}

fn engine_attempt(
    engine: &str,
    success: bool,
    reason: Option<String>,
    status: Option<u16>,
) -> ReaderEngineAttempt {
    ReaderEngineAttempt {
        engine: engine.to_string(),
        success,
        reason,
        status,
    }
}

fn error_status(error: &ReaderError) -> Option<u16> {
    match error {
        ReaderError::AccessDenied { status, .. } => Some(*status),
        ReaderError::Fetch { status, .. } => *status,
        _ => None,
    }
}

fn attach_attempts_to_error(error: ReaderError, attempts: Vec<ReaderEngineAttempt>) -> ReaderError {
    if attempts.is_empty() {
        return error;
    }
    ReaderError::EnginesExhausted {
        message: error.to_string(),
        attempts,
        final_url: match &error {
            ReaderError::Fetch { final_url, .. }
            | ReaderError::UnsupportedFormat { final_url, .. } => final_url.clone(),
            ReaderError::AccessDenied { final_url, .. } => Some(final_url.clone()),
            ReaderError::EnginesExhausted { final_url, .. } => final_url.clone(),
            _ => None,
        },
    }
}

fn engines_exhausted_or_original(
    error: ReaderError,
    attempts: Vec<ReaderEngineAttempt>,
    final_url: Option<String>,
) -> ReaderError {
    if attempts.is_empty() {
        return error;
    }
    ReaderError::EnginesExhausted {
        message: error.to_string(),
        attempts,
        final_url,
    }
}

pub(super) fn elapsed_ms(start: Instant) -> u64 {
    start.elapsed().as_millis().min(u128::from(u64::MAX)) as u64
}

#[cfg(test)]
mod test_support;
