use serde_json::{Value, json};

use crate::AgentRuntimeError;

use super::{model_capabilities, routes::mimo};

pub(crate) const MIMO_TRANSIENT_RETRY_LIMIT: u8 = 4;

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum MimoFaultCategory {
    Format,
    Auth,
    Balance,
    Access,
    Vision,
    ContentModeration,
    RateLimit,
    Server,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum MimoFaultAction {
    RetryBackoff,
    RetryImageDowngrade,
    RetryContextCompact,
    NotifyAndFail,
    FailWithGuidance,
}

#[derive(Clone, Debug)]
pub(crate) struct MimoProviderFault {
    pub(crate) http_status: u16,
    pub(crate) code: String,
    pub(crate) category: MimoFaultCategory,
    pub(crate) action: MimoFaultAction,
    pub(crate) notify: bool,
    pub(crate) title_key: String,
    pub(crate) body_key: String,
    pub(crate) user_message: String,
}

pub(crate) fn provider_http_error(
    route_id: &str,
    status: u16,
    body: &Value,
) -> AgentRuntimeError {
    if mimo::is_mimo_route(route_id) {
        let fault = parse_provider_http_failure(status, body);
        return AgentRuntimeError::Core(format_mimo_fault_message(&fault));
    }
    AgentRuntimeError::Core(format!(
        "provider request failed with status {status}: {body}"
    ))
}

pub(crate) fn provider_http_error_from_text(
    route_id: &str,
    status: u16,
    body_text: &str,
) -> AgentRuntimeError {
    let body = serde_json::from_str::<Value>(body_text)
        .unwrap_or_else(|_| json!({ "error": { "message": body_text } }));
    provider_http_error(route_id, status, &body)
}

pub(crate) fn parse_mimo_fault_from_error(error: &AgentRuntimeError) -> Option<MimoProviderFault> {
    let message = error.to_string();
    if let Some(start) = message.find("[mimo_fault:")
        && let Some(fault) = parse_mimo_fault_message(&message[start..])
    {
        return Some(fault);
    }
    let (status, body) = parse_provider_failure_message(&message)?;
    Some(parse_provider_http_failure(status, &body))
}

pub(crate) fn mimo_fault_dedupe_key(fault: &MimoProviderFault, provider_id: &str) -> String {
    format!("mimo-fault-{}-{}", fault.http_status, provider_id)
}

pub(crate) fn should_notify_for_mimo_fault(
    fault: &MimoProviderFault,
    transient_retries_exhausted: bool,
) -> bool {
    match fault.action {
        MimoFaultAction::NotifyAndFail => true,
        MimoFaultAction::RetryBackoff if transient_retries_exhausted && fault.notify => true,
        _ => false,
    }
}

pub(crate) fn mimo_fault_user_message(fault: &MimoProviderFault) -> String {
    fault.user_message.clone()
}

pub(crate) fn is_mimo_backoff_fault(fault: &MimoProviderFault) -> bool {
    fault.action == MimoFaultAction::RetryBackoff
}

pub(crate) fn is_mimo_notify_and_fail_fault(fault: &MimoProviderFault) -> bool {
    fault.action == MimoFaultAction::NotifyAndFail
}

pub(crate) fn format_mimo_fault_message(fault: &MimoProviderFault) -> String {
    format!(
        "[mimo_fault:{}:{}] {}",
        fault.http_status, fault.code, fault.user_message
    )
}

pub(crate) fn parse_provider_http_failure(status: u16, body: &Value) -> MimoProviderFault {
    let provider_message = provider_error_message(body);
    let provider_code = provider_error_code(body, status);
    let normalized = provider_message.to_ascii_lowercase();

    match status {
        400 if is_context_length_message(&normalized) => MimoProviderFault {
            http_status: status,
            code: "context_length".to_string(),
            category: MimoFaultCategory::Format,
            action: MimoFaultAction::RetryContextCompact,
            notify: false,
            title_key: "notification.mimoFault400Title".to_string(),
            body_key: "notification.mimoFault400Body".to_string(),
            user_message: "MiMo rejected the request because the context is too long. Lyra will compact context and retry.".to_string(),
        },
        400 if is_reasoning_replay_message(&normalized) => format_fault(status, &provider_code),
        400 if is_multimodal_format_message(&normalized) => format_fault(status, &provider_code),
        400 => format_fault(status, &provider_code),
        401 => MimoProviderFault {
            http_status: status,
            code: "authentication_failed".to_string(),
            category: MimoFaultCategory::Auth,
            action: MimoFaultAction::NotifyAndFail,
            notify: true,
            title_key: "notification.mimoFault401Title".to_string(),
            body_key: "notification.mimoFault401Body".to_string(),
            user_message: "MiMo authentication failed. Check the API key, Authorization header, and whether Token Plan credentials are used with the Token Plan base URL.".to_string(),
        },
        402 => MimoProviderFault {
            http_status: status,
            code: "insufficient_balance".to_string(),
            category: MimoFaultCategory::Balance,
            action: MimoFaultAction::NotifyAndFail,
            notify: true,
            title_key: "notification.mimoFault402Title".to_string(),
            body_key: "notification.mimoFault402Body".to_string(),
            user_message: "MiMo account balance is insufficient. Recharge the account or switch to another provider before retrying.".to_string(),
        },
        403 => MimoProviderFault {
            http_status: status,
            code: "access_denied".to_string(),
            category: MimoFaultCategory::Access,
            action: MimoFaultAction::NotifyAndFail,
            notify: true,
            title_key: "notification.mimoFault403Title".to_string(),
            body_key: "notification.mimoFault403Body".to_string(),
            user_message: "MiMo rejected access for this request. The service may be unavailable in the current region or the API key may be risk-controlled.".to_string(),
        },
        404 if is_image_input_message(&normalized) => MimoProviderFault {
            http_status: status,
            code: "image_input_unsupported".to_string(),
            category: MimoFaultCategory::Vision,
            action: MimoFaultAction::RetryImageDowngrade,
            notify: false,
            title_key: "notification.mimoFault404VisionTitle".to_string(),
            body_key: "notification.mimoFault404VisionBody".to_string(),
            user_message: "MiMo endpoint does not support image input for the selected model.".to_string(),
        },
        404 => MimoProviderFault {
            http_status: status,
            code: provider_code,
            category: MimoFaultCategory::Format,
            action: MimoFaultAction::FailWithGuidance,
            notify: false,
            title_key: "notification.mimoFault404Title".to_string(),
            body_key: "notification.mimoFault404Body".to_string(),
            user_message: "MiMo could not find the requested model or endpoint.".to_string(),
        },
        421 => MimoProviderFault {
            http_status: status,
            code: "content_blocked".to_string(),
            category: MimoFaultCategory::ContentModeration,
            action: MimoFaultAction::NotifyAndFail,
            notify: true,
            title_key: "notification.mimoFault421Title".to_string(),
            body_key: "notification.mimoFault421Body".to_string(),
            user_message: "MiMo blocked this request during content review. Avoid unsafe or sensitive input and retry with a safer prompt.".to_string(),
        },
        429 => MimoProviderFault {
            http_status: status,
            code: "rate_limited".to_string(),
            category: MimoFaultCategory::RateLimit,
            action: MimoFaultAction::RetryBackoff,
            notify: true,
            title_key: "notification.mimoFault429Title".to_string(),
            body_key: "notification.mimoFault429Body".to_string(),
            user_message: "MiMo rate-limited this request. Lyra will retry with exponential backoff.".to_string(),
        },
        500 | 502 | 503 | 504 => MimoProviderFault {
            http_status: status,
            code: "server_error".to_string(),
            category: MimoFaultCategory::Server,
            action: MimoFaultAction::RetryBackoff,
            notify: false,
            title_key: "notification.mimoFault500Title".to_string(),
            body_key: "notification.mimoFault500Body".to_string(),
            user_message: "MiMo returned a server-side error. Lyra will retry automatically.".to_string(),
        },
        _ => MimoProviderFault {
            http_status: status,
            code: provider_code,
            category: MimoFaultCategory::Format,
            action: MimoFaultAction::FailWithGuidance,
            notify: false,
            title_key: "notification.mimoFaultGenericTitle".to_string(),
            body_key: "notification.mimoFaultGenericBody".to_string(),
            user_message: provider_message,
        },
    }
}

fn format_fault(status: u16, provider_code: &str) -> MimoProviderFault {
    MimoProviderFault {
        http_status: status,
        code: provider_code.to_string(),
        category: MimoFaultCategory::Format,
        action: MimoFaultAction::FailWithGuidance,
        notify: false,
        title_key: "notification.mimoFault400Title".to_string(),
        body_key: "notification.mimoFault400Body".to_string(),
        user_message: "MiMo rejected the request format. Check JSON fields, required parameters, multimodal file limits, and reasoning_content replay in thinking mode.".to_string(),
    }
}

fn parse_mimo_fault_message(message: &str) -> Option<MimoProviderFault> {
    let rest = message.strip_prefix("[mimo_fault:")?;
    let (status_code, rest) = rest.split_once(':')?;
    let (code, user_message) = rest.split_once("] ")?;
    let http_status = status_code.parse().ok()?;
    let fault = parse_provider_http_failure(http_status, &json!({ "error": { "code": code } }));
    Some(MimoProviderFault {
        user_message: user_message.to_string(),
        ..fault
    })
}

fn parse_provider_failure_message(message: &str) -> Option<(u16, Value)> {
    let marker = "provider request failed with status ";
    let rest = message.strip_prefix(marker)?;
    let (status_text, body_text) = rest.split_once(':')?;
    let status = status_text.trim().split_whitespace().next()?.parse().ok()?;
    let body_trimmed = body_text.trim();
    let body = serde_json::from_str::<Value>(body_trimmed)
        .unwrap_or_else(|_| json!({ "error": { "message": body_trimmed } }));
    Some((status, body))
}

fn provider_error_message(body: &Value) -> String {
    body.pointer("/error/message")
        .or_else(|| body.get("message"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| body.to_string())
}

fn provider_error_code(body: &Value, status: u16) -> String {
    body.pointer("/error/code")
        .or_else(|| body.get("code"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| status.to_string())
}

fn is_context_length_message(message: &str) -> bool {
    message.contains("context")
        && (message.contains("length")
            || message.contains("window")
            || message.contains("maximum")
            || message.contains("exceed")
            || message.contains("too long"))
}

fn is_reasoning_replay_message(message: &str) -> bool {
    message.contains("reasoning_content") || message.contains("reasoning content")
}

fn is_multimodal_format_message(message: &str) -> bool {
    message.contains("multimodal")
        || message.contains("image")
            && (message.contains("format") || message.contains("size") || message.contains("limit"))
}

fn is_image_input_message(message: &str) -> bool {
    model_capabilities::is_image_input_unsupported_error(&AgentRuntimeError::Core(message.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_balance_fault() {
        let fault = parse_provider_http_failure(
            402,
            &json!({ "error": { "code": "402", "message": "insufficient balance" } }),
        );
        assert_eq!(fault.category, MimoFaultCategory::Balance);
        assert_eq!(fault.action, MimoFaultAction::NotifyAndFail);
        assert!(fault.notify);
    }

    #[test]
    fn classifies_image_404_as_downgrade() {
        let fault = parse_provider_http_failure(
            404,
            &json!({ "error": { "message": "No endpoints found that support image input" } }),
        );
        assert_eq!(fault.action, MimoFaultAction::RetryImageDowngrade);
    }

    #[test]
    fn classifies_rate_limit_as_backoff() {
        let fault = parse_provider_http_failure(
            429,
            &json!({ "error": { "message": "rate limit exceeded" } }),
        );
        assert_eq!(fault.action, MimoFaultAction::RetryBackoff);
    }

    #[test]
    fn parses_prefixed_fault_message() {
        let error = AgentRuntimeError::Core(format_mimo_fault_message(
            &parse_provider_http_failure(
                402,
                &json!({ "error": { "code": "402", "message": "insufficient balance" } }),
            ),
        ));
        let fault = parse_mimo_fault_from_error(&error).expect("fault");
        assert_eq!(fault.http_status, 402);
        assert_eq!(fault.code, "insufficient_balance");
    }
}