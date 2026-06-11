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
    ReaderEngine, ReaderInput, ReaderRequest, ReaderResult, ReaderTiming, ReaderWarning,
    WarningCode,
};

use browser_source::{
    resolve_browser_source, should_auto_browser_fallback, should_auto_browser_fallback_error,
};
use render_dispatch::render_source;
use source::{input_url, resolve_source};

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
        let source = resolve_browser_source(request, browser)?;
        let mut result = render_source(request, &source)?;
        result
            .timing
            .get_or_insert_with(ReaderTiming::default)
            .total_ms = elapsed_ms(total_start);
        return Ok(result);
    }

    if matches!(request.options.engine, ReaderEngine::Browser) && browser.is_none() {
        return Err(ReaderError::Fetch {
            message: "browser snapshot provider is required for engine=browser".to_string(),
            final_url: input_url(request),
            status: None,
        });
    }

    let source = match resolve_source(request, fetch) {
        Ok(source) => source,
        Err(error) if should_auto_browser_fallback_error(request, &error) => {
            if browser.is_some() {
                let mut result = resolve_browser_source(request, browser)
                    .and_then(|browser_source| render_source(request, &browser_source))?;
                result
                    .timing
                    .get_or_insert_with(ReaderTiming::default)
                    .total_ms = elapsed_ms(total_start);
                return Ok(result);
            }
            return Err(error);
        }
        Err(error) => return Err(error),
    };
    let mut result = render_source(request, &source)?;
    if should_auto_browser_fallback(request, &result) {
        if let Some(browser) = browser {
            match resolve_browser_source(request, Some(browser))
                .and_then(|browser_source| render_source(request, &browser_source))
            {
                Ok(mut browser_result) => {
                    browser_result
                        .timing
                        .get_or_insert_with(ReaderTiming::default)
                        .total_ms = elapsed_ms(total_start);
                    return Ok(browser_result);
                }
                Err(error) => {
                    result.warnings.push(ReaderWarning {
                        code: WarningCode::BrowserRecommended,
                        message: format!("browser fallback failed: {error}"),
                    });
                    if result.recommended_next_action.is_none() {
                        result.recommended_next_action = Some(
                            "Use a browser-rendered snapshot or browser path for this page."
                                .to_string(),
                        );
                    }
                }
            }
        } else if result.recommended_next_action.is_none() {
            result.recommended_next_action =
                Some("Use a browser-rendered snapshot or browser path for this page.".to_string());
        }
    }
    let timing = result.timing.get_or_insert_with(ReaderTiming::default);
    timing.fetch_ms = source.fetch_ms;
    timing.total_ms = elapsed_ms(total_start);
    Ok(result)
}

pub(super) fn elapsed_ms(start: Instant) -> u64 {
    start.elapsed().as_millis().min(u128::from(u64::MAX)) as u64
}

#[cfg(test)]
mod test_support;
