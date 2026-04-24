use super::*;
use crate::exec_output::StreamOutput;
use crate::protocol::RateLimitWindow;
use chrono::DateTime;
use chrono::Duration as ChronoDuration;
use chrono::TimeZone;
use chrono::Utc;
use http::Response as HttpResponse;
use pretty_assertions::assert_eq;
use reqwest::Response;
use reqwest::ResponseBuilderExt;
use reqwest::StatusCode;
use reqwest::Url;

fn rate_limit_snapshot() -> RateLimitSnapshot {
    let primary_reset_at = Utc
        .with_ymd_and_hms(2024, 1, 1, 1, 0, 0)
        .unwrap()
        .timestamp();
    let secondary_reset_at = Utc
        .with_ymd_and_hms(2024, 1, 1, 2, 0, 0)
        .unwrap()
        .timestamp();
    RateLimitSnapshot {
        limit_id: None,
        limit_name: None,
        primary: Some(RateLimitWindow {
            used_percent: 50.0,
            window_minutes: Some(60),
            resets_at: Some(primary_reset_at),
        }),
        secondary: Some(RateLimitWindow {
            used_percent: 30.0,
            window_minutes: Some(120),
            resets_at: Some(secondary_reset_at),
        }),
        credits: None,
        rate_limit_reached_type: None,
    }
}

fn rate_limit_snapshot_with_name(limit_name: &str) -> RateLimitSnapshot {
    let mut snapshot = rate_limit_snapshot();
    snapshot.limit_name = Some(limit_name.to_string());
    snapshot
}

fn with_now_override<T>(now: DateTime<Utc>, f: impl FnOnce() -> T) -> T {
    NOW_OVERRIDE.with(|cell| {
        *cell.borrow_mut() = Some(now);
        let result = f();
        *cell.borrow_mut() = None;
        result
    })
}

#[test]
fn server_overloaded_maps_to_protocol() {
    let err = LyraErr::ServerOverloaded;
    assert_eq!(
        err.to_lyra_protocol_error(),
        LyraErrorInfo::ServerOverloaded
    );
}

#[test]
fn sandbox_denied_uses_aggregated_output_when_streams_are_empty() {
    let output = ExecToolCallOutput {
        exit_code: 77,
        stdout: StreamOutput::new(String::new()),
        stderr: StreamOutput::new(String::new()),
        aggregated_output: StreamOutput::new("aggregate detail".to_string()),
        duration: Duration::from_millis(10),
        timed_out: false,
    };
    let err = LyraErr::Sandbox(SandboxErr::Denied {
        output: Box::new(output),
        network_policy_decision: None,
    });
    assert_eq!(get_error_message_ui(&err), "aggregate detail");
}

#[test]
fn sandbox_denied_reports_both_streams_when_available() {
    let output = ExecToolCallOutput {
        exit_code: 9,
        stdout: StreamOutput::new("stdout detail".to_string()),
        stderr: StreamOutput::new("stderr detail".to_string()),
        aggregated_output: StreamOutput::new(String::new()),
        duration: Duration::from_millis(10),
        timed_out: false,
    };
    let err = LyraErr::Sandbox(SandboxErr::Denied {
        output: Box::new(output),
        network_policy_decision: None,
    });
    assert_eq!(get_error_message_ui(&err), "stderr detail\nstdout detail");
}

#[test]
fn sandbox_denied_reports_stdout_when_stderr_is_empty() {
    let output = ExecToolCallOutput {
        exit_code: 11,
        stdout: StreamOutput::new("stdout only".to_string()),
        stderr: StreamOutput::new(String::new()),
        aggregated_output: StreamOutput::new(String::new()),
        duration: Duration::from_millis(8),
        timed_out: false,
    };
    let err = LyraErr::Sandbox(SandboxErr::Denied {
        output: Box::new(output),
        network_policy_decision: None,
    });
    assert_eq!(get_error_message_ui(&err), "stdout only");
}

#[test]
fn sandbox_denied_reports_exit_code_when_no_output_is_available() {
    let output = ExecToolCallOutput {
        exit_code: 13,
        stdout: StreamOutput::new(String::new()),
        stderr: StreamOutput::new(String::new()),
        aggregated_output: StreamOutput::new(String::new()),
        duration: Duration::from_millis(5),
        timed_out: false,
    };
    let err = LyraErr::Sandbox(SandboxErr::Denied {
        output: Box::new(output),
        network_policy_decision: None,
    });
    assert_eq!(
        get_error_message_ui(&err),
        "command failed inside sandbox with exit code 13"
    );
}

#[test]
fn to_error_event_handles_response_stream_failed() {
    let response = HttpResponse::builder()
        .status(StatusCode::TOO_MANY_REQUESTS)
        .url(Url::parse("http://example.com").unwrap())
        .body("")
        .unwrap();
    let source = Response::from(response).error_for_status_ref().unwrap_err();
    let err = LyraErr::ResponseStreamFailed(ResponseStreamFailed {
        source,
        request_id: Some("req-123".to_string()),
    });

    let event = err.to_error_event(Some("prefix".to_string()));

    assert_eq!(
        event.message,
        "prefix: Error while reading the server response: HTTP status client error (429 Too Many Requests) for url (http://example.com/), request id: req-123"
    );
    assert_eq!(
        event.lyra_error_info,
        Some(LyraErrorInfo::ResponseStreamConnectionFailed {
            http_status_code: Some(429)
        })
    );
}

#[test]
fn usage_limit_reached_defaults_to_retry_later() {
    let err = UsageLimitReachedError {
        resets_at: None,
        rate_limits: Some(Box::new(rate_limit_snapshot())),
        promo_message: None,
    };
    assert_eq!(
        err.to_string(),
        "You've hit your usage limit. Try again later."
    );
}

#[test]
fn usage_limit_reached_prefers_non_lyra_limit_name() {
    let base = Utc.with_ymd_and_hms(2024, 1, 1, 0, 0, 0).unwrap();
    let resets_at = base + ChronoDuration::hours(1);
    with_now_override(base, move || {
        let expected_time = format_retry_timestamp(&resets_at);
        let err = UsageLimitReachedError {
            resets_at: Some(resets_at),
            rate_limits: Some(Box::new(rate_limit_snapshot_with_name("gpt-4.1"))),
            promo_message: Some("Purchase additional credits".to_string()),
        };
        assert_eq!(
            err.to_string(),
            format!(
                "You've hit your usage limit for gpt-4.1. Switch to another model now, or try again at {expected_time}."
            )
        );
    });
}

#[test]
fn usage_limit_reached_uses_promo_message_for_lyra_limit_name() {
    let err = UsageLimitReachedError {
        resets_at: None,
        rate_limits: Some(Box::new(rate_limit_snapshot_with_name("lyra"))),
        promo_message: Some("Purchase additional credits".to_string()),
    };
    assert_eq!(
        err.to_string(),
        "You've hit your usage limit. Purchase additional credits, or try again later."
    );
}

#[test]
fn usage_limit_reached_includes_same_day_retry_time() {
    let base = Utc.with_ymd_and_hms(2024, 1, 1, 0, 0, 0).unwrap();
    let resets_at = base + ChronoDuration::minutes(5);
    with_now_override(base, move || {
        let expected_time = format_retry_timestamp(&resets_at);
        let err = UsageLimitReachedError {
            resets_at: Some(resets_at),
            rate_limits: Some(Box::new(rate_limit_snapshot())),
            promo_message: None,
        };
        assert_eq!(
            err.to_string(),
            format!("You've hit your usage limit. Try again at {expected_time}.")
        );
    });
}

#[test]
fn usage_limit_reached_includes_future_day_retry_time() {
    let base = Utc.with_ymd_and_hms(2024, 1, 1, 0, 0, 0).unwrap();
    let resets_at =
        base + ChronoDuration::days(2) + ChronoDuration::hours(3) + ChronoDuration::minutes(5);
    with_now_override(base, move || {
        let expected_time = format_retry_timestamp(&resets_at);
        let err = UsageLimitReachedError {
            resets_at: Some(resets_at),
            rate_limits: Some(Box::new(rate_limit_snapshot())),
            promo_message: None,
        };
        assert_eq!(
            err.to_string(),
            format!("You've hit your usage limit. Try again at {expected_time}.")
        );
    });
}

#[test]
fn usage_limit_reached_uses_promo_message_when_present() {
    let base = Utc.with_ymd_and_hms(2024, 1, 1, 0, 0, 0).unwrap();
    let resets_at = base + ChronoDuration::seconds(30);
    with_now_override(base, move || {
        let expected_time = format_retry_timestamp(&resets_at);
        let err = UsageLimitReachedError {
            resets_at: Some(resets_at),
            rate_limits: Some(Box::new(rate_limit_snapshot())),
            promo_message: Some("Contact your workspace admin for more capacity".to_string()),
        };
        assert_eq!(
            err.to_string(),
            format!(
                "You've hit your usage limit. Contact your workspace admin for more capacity, or try again at {expected_time}."
            )
        );
    });
}

#[test]
fn unexpected_status_cloudflare_html_is_simplified() {
    let err = UnexpectedResponseError {
        status: StatusCode::FORBIDDEN,
        body: "<html><body>Cloudflare error: Sorry, you have been blocked</body></html>"
            .to_string(),
        url: Some("http://example.com/blocked".to_string()),
        cf_ray: Some("ray-id".to_string()),
        request_id: None,
        identity_authorization_error: None,
        identity_error_code: None,
    };
    let status = StatusCode::FORBIDDEN.to_string();
    let url = "http://example.com/blocked";
    assert_eq!(
        err.to_string(),
        format!("{CLOUDFLARE_BLOCKED_MESSAGE} (status {status}), url: {url}, cf-ray: ray-id")
    );
}

#[test]
fn unexpected_status_non_html_is_unchanged() {
    let err = UnexpectedResponseError {
        status: StatusCode::FORBIDDEN,
        body: "plain text error".to_string(),
        url: Some("http://example.com/plain".to_string()),
        cf_ray: None,
        request_id: None,
        identity_authorization_error: None,
        identity_error_code: None,
    };
    let status = StatusCode::FORBIDDEN.to_string();
    let url = "http://example.com/plain";
    assert_eq!(
        err.to_string(),
        format!("unexpected status {status}: plain text error, url: {url}")
    );
}

#[test]
fn unexpected_status_prefers_json_error_message_when_present() {
    let err = UnexpectedResponseError {
        status: StatusCode::UNAUTHORIZED,
        body: r#"{"error":{"message":"Workspace is not authorized in this region."},"status":401}"#
            .to_string(),
        url: Some("https://example.invalid/api/responses".to_string()),
        cf_ray: None,
        request_id: Some("req-123".to_string()),
        identity_authorization_error: None,
        identity_error_code: None,
    };
    let status = StatusCode::UNAUTHORIZED.to_string();
    assert_eq!(
        err.to_string(),
        format!(
            "unexpected status {status}: Workspace is not authorized in this region., url: https://example.invalid/api/responses, request id: req-123"
        )
    );
}

#[test]
fn unexpected_status_truncates_long_body_with_ellipsis() {
    let long_body = "x".repeat(UNEXPECTED_RESPONSE_BODY_MAX_BYTES + 10);
    let err = UnexpectedResponseError {
        status: StatusCode::BAD_GATEWAY,
        body: long_body,
        url: Some("http://example.com/long".to_string()),
        cf_ray: None,
        request_id: Some("req-long".to_string()),
        identity_authorization_error: None,
        identity_error_code: None,
    };
    let status = StatusCode::BAD_GATEWAY.to_string();
    let expected_body = format!("{}...", "x".repeat(UNEXPECTED_RESPONSE_BODY_MAX_BYTES));
    assert_eq!(
        err.to_string(),
        format!(
            "unexpected status {status}: {expected_body}, url: http://example.com/long, request id: req-long"
        )
    );
}

#[test]
fn unexpected_status_includes_cf_ray_and_request_id() {
    let err = UnexpectedResponseError {
        status: StatusCode::UNAUTHORIZED,
        body: "plain text error".to_string(),
        url: Some("https://example.invalid/api/responses".to_string()),
        cf_ray: Some("9c81f9f18f2fa49d-LHR".to_string()),
        request_id: Some("req-xyz".to_string()),
        identity_authorization_error: None,
        identity_error_code: None,
    };
    let status = StatusCode::UNAUTHORIZED.to_string();
    assert_eq!(
        err.to_string(),
        format!(
            "unexpected status {status}: plain text error, url: https://example.invalid/api/responses, cf-ray: 9c81f9f18f2fa49d-LHR, request id: req-xyz"
        )
    );
}

#[test]
fn unexpected_status_includes_identity_auth_details() {
    let err = UnexpectedResponseError {
        status: StatusCode::UNAUTHORIZED,
        body: "plain text error".to_string(),
        url: Some("https://example.invalid/api/models".to_string()),
        cf_ray: Some("cf-ray-auth-401-test".to_string()),
        request_id: Some("req-auth".to_string()),
        identity_authorization_error: Some("missing_authorization_header".to_string()),
        identity_error_code: Some("token_expired".to_string()),
    };
    let status = StatusCode::UNAUTHORIZED.to_string();
    assert_eq!(
        err.to_string(),
        format!(
            "unexpected status {status}: plain text error, url: https://example.invalid/api/models, cf-ray: cf-ray-auth-401-test, request id: req-auth, auth error: missing_authorization_header, auth error code: token_expired"
        )
    );
}
