use serde_json::{json, Map, Value};

use crate::agent::error_recovery::{classify_tool_error, ErrorSeverity};

fn as_object(value: &Value) -> Option<&Map<String, Value>> {
    value.as_object()
}

fn value_at_path<'a>(value: &'a Value, path: &[&str]) -> Option<&'a Value> {
    let mut current = value;
    for segment in path {
        current = as_object(current)?.get(*segment)?;
    }
    Some(current)
}

fn string_at_path<'a>(value: &'a Value, path: &[&str]) -> Option<&'a str> {
    value_at_path(value, path).and_then(Value::as_str)
}

fn usize_at_path(value: &Value, path: &[&str]) -> Option<usize> {
    value_at_path(value, path)
        .and_then(Value::as_u64)
        .map(|raw| raw as usize)
}

fn recoverability_hint(severity: &ErrorSeverity) -> &'static str {
    match severity {
        ErrorSeverity::Recoverable { .. } => {
            "Retry after re-reading the latest state or adjusting the tool parameters."
        }
        ErrorSeverity::NonRecoverable { .. } => {
            "Do not retry unchanged. Inspect the inputs, permissions, credentials, or tool scope before trying again."
        }
    }
}

fn generic_failure_diagnosis(tool_name: &str, error_code: &str, error_message: &str) -> Value {
    let severity = classify_tool_error(tool_name, Some(error_code), error_message);
    let mut diagnosis = Map::new();
    diagnosis.insert("source".into(), Value::String("code_analysis".to_string()));
    diagnosis.insert(
        "rootCauseCode".into(),
        Value::String(error_code.to_string()),
    );
    diagnosis.insert(
        "rootCauseSummary".into(),
        Value::String(error_message.to_string()),
    );
    diagnosis.insert("recoverable".into(), Value::Bool(severity.is_recoverable()));
    diagnosis.insert(
        "recommendedNextAction".into(),
        Value::String(recoverability_hint(&severity).to_string()),
    );
    Value::Object(diagnosis)
}

fn diagnose_workbench_document_failure(
    error_code: &str,
    error_message: &str,
    details: &Value,
) -> Option<Value> {
    if string_at_path(details, &["domain"]) != Some("workbench.document") {
        return None;
    }

    let stage = string_at_path(details, &["stage"]).unwrap_or("unknown");
    let source_kind = string_at_path(details, &["candidate", "sourceKind"]);
    let format_hint = string_at_path(details, &["candidate", "formatHint"]);
    let document_url = string_at_path(details, &["candidate", "documentUrl"])
        .or_else(|| string_at_path(details, &["fetch", "finalUrl"]));
    let fetch_signature = string_at_path(details, &["fetch", "contentSignature"]);
    let fetch_likely_cause = string_at_path(details, &["fetch", "likelyCause"]);
    let mime_type = string_at_path(details, &["fetch", "mimeType"]);
    let byte_length = usize_at_path(details, &["fetch", "byteLength"]);

    let (root_cause_code, root_cause_summary, recommended_next_action, suggested_fallback_tool) =
        match (error_code, fetch_likely_cause, fetch_signature, stage) {
            (
                "document_unsupported_format",
                Some("resolved_document_url_returned_html_wrapper_instead_of_pdf_bytes"),
                _,
                _,
            ) => (
                "document_html_wrapper_returned_instead_of_pdf_bytes",
                "The resolved document URL returned an HTML viewer wrapper instead of raw PDF bytes.",
                "Probe the current viewer for the underlying file URL and retry the document read against the actual PDF source.",
                Some("workbench.tab.extract_text"),
            ),
            ("document_not_found", _, _, _) => (
                "no_active_document_candidate_detected",
                "The current browser tab does not expose an active document candidate that can be parsed.",
                "Inspect the current tab state first, then retry the document read once a real document source is visible.",
                Some("workbench.tab.read"),
            ),
            ("document_unsupported_scheme", _, _, _) => (
                "document_source_uses_non_fetchable_scheme",
                "The active document source uses a scheme that cannot be fetched through the browser session.",
                "Use DOM-based extraction for the visible viewer content or obtain a direct fetchable document URL before retrying.",
                Some("workbench.tab.extract_text"),
            ),
            ("document_fetch_failed", _, _, "fetch") => (
                "document_fetch_failed_in_browser_session",
                "The browser session could not fetch the resolved document source.",
                "Retry with the current browser session, and verify that the document URL is still accessible and authenticated.",
                Some("workbench.tab.read"),
            ),
            ("document_parse_failed", _, Some("pdf_header"), _) => (
                "pdf_bytes_fetched_but_parser_failed",
                "The fetched bytes look like a PDF, but the parser could not extract usable text from it.",
                "Retry with a narrower document scope, then fall back to viewer text extraction or visual inspection if the PDF appears image-based.",
                Some("workbench.tab.extract_text"),
            ),
            ("document_text_unavailable", _, _, _) => (
                "document_text_unavailable_after_parse_and_fallback",
                "No usable text was available from the document parser or the viewer fallback path.",
                "Use visual inspection or a document-specific fallback path instead of retrying the same text read unchanged.",
                Some("workbench.tab.capture_visual"),
            ),
            _ => (
                error_code,
                error_message,
                "Inspect the document diagnostics details, then retry with adjusted scope or a safer fallback path.",
                None,
            ),
        };

    let mut evidence = Map::new();
    evidence.insert("stage".into(), Value::String(stage.to_string()));
    if let Some(source_kind) = source_kind {
        evidence.insert("sourceKind".into(), Value::String(source_kind.to_string()));
    }
    if let Some(format_hint) = format_hint {
        evidence.insert("formatHint".into(), Value::String(format_hint.to_string()));
    }
    if let Some(document_url) = document_url {
        evidence.insert(
            "documentUrl".into(),
            Value::String(document_url.to_string()),
        );
    }
    if let Some(fetch_signature) = fetch_signature {
        evidence.insert(
            "fetchContentSignature".into(),
            Value::String(fetch_signature.to_string()),
        );
    }
    if let Some(mime_type) = mime_type {
        evidence.insert("mimeType".into(), Value::String(mime_type.to_string()));
    }
    if let Some(byte_length) = byte_length {
        evidence.insert("byteLength".into(), json!(byte_length));
    }

    let mut diagnosis = Map::new();
    diagnosis.insert("source".into(), Value::String("code_analysis".to_string()));
    diagnosis.insert(
        "domain".into(),
        Value::String("workbench.document".to_string()),
    );
    diagnosis.insert(
        "rootCauseCode".into(),
        Value::String(root_cause_code.to_string()),
    );
    diagnosis.insert(
        "rootCauseSummary".into(),
        Value::String(root_cause_summary.to_string()),
    );
    diagnosis.insert("recoverable".into(), Value::Bool(true));
    diagnosis.insert(
        "recommendedNextAction".into(),
        Value::String(recommended_next_action.to_string()),
    );
    if let Some(tool_name) = suggested_fallback_tool {
        diagnosis.insert(
            "suggestedFallbackTool".into(),
            Value::String(tool_name.to_string()),
        );
    }
    diagnosis.insert("evidence".into(), Value::Object(evidence));
    Some(Value::Object(diagnosis))
}

pub fn diagnose_tool_failure(
    tool_name: &str,
    error_code: &str,
    error_message: &str,
    error_details: Option<&Value>,
) -> Value {
    if let Some(details) = error_details {
        if let Some(diagnosis) =
            diagnose_workbench_document_failure(error_code, error_message, details)
        {
            return diagnosis;
        }
    }
    generic_failure_diagnosis(tool_name, error_code, error_message)
}

pub fn build_tool_error_payload(
    tool_name: &str,
    error_code: &str,
    error_message: &str,
    error_details: Option<Value>,
) -> Value {
    let diagnosis =
        diagnose_tool_failure(tool_name, error_code, error_message, error_details.as_ref());
    let mut payload = Map::new();
    payload.insert("code".into(), Value::String(error_code.to_string()));
    payload.insert("message".into(), Value::String(error_message.to_string()));
    payload.insert("details".into(), error_details.unwrap_or(Value::Null));
    payload.insert("diagnosis".into(), diagnosis);
    Value::Object(payload)
}

#[cfg(test)]
mod tests {
    use super::{build_tool_error_payload, diagnose_tool_failure};
    use serde_json::json;

    #[test]
    fn diagnoses_html_wrapper_pdf_failures_from_structured_details() {
        let diagnosis = diagnose_tool_failure(
            "workbench.document.read",
            "document_unsupported_format",
            "document format is unsupported",
            Some(&json!({
                "domain": "workbench.document",
                "stage": "parse",
                "candidate": {
                    "sourceKind": "iframe",
                    "formatHint": "pdf",
                    "documentUrl": "https://example.com/preview.pdf"
                },
                "fetch": {
                    "finalUrl": "https://example.com/preview.pdf",
                    "mimeType": "text/html",
                    "contentSignature": "html_doctype",
                    "likelyCause": "resolved_document_url_returned_html_wrapper_instead_of_pdf_bytes"
                }
            })),
        );
        assert_eq!(
            diagnosis
                .get("rootCauseCode")
                .and_then(serde_json::Value::as_str),
            Some("document_html_wrapper_returned_instead_of_pdf_bytes")
        );
        assert_eq!(
            diagnosis
                .get("suggestedFallbackTool")
                .and_then(serde_json::Value::as_str),
            Some("workbench.tab.extract_text")
        );
    }

    #[test]
    fn builds_error_payload_with_diagnosis() {
        let payload = build_tool_error_payload(
            "workbench.document.read",
            "document_text_unavailable",
            "Document text is unavailable.",
            Some(json!({
                "domain": "workbench.document",
                "stage": "fallback"
            })),
        );
        assert_eq!(
            payload
                .get("diagnosis")
                .and_then(serde_json::Value::as_object)
                .and_then(|value| value.get("rootCauseCode"))
                .and_then(serde_json::Value::as_str),
            Some("document_text_unavailable_after_parse_and_fallback")
        );
    }
}
