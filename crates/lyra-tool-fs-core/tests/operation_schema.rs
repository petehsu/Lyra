mod common;

use common::*;
use lyra_tool_fs_core::*;
use serde_json::{Value, json};

#[test]
fn operation_envelope_validator_checks_runtime_and_args() {
    let registry = ToolFsRegistry::default();
    assert!(
        registry
            .inspect_path("/tools/filesystem/read_file")
            .is_err()
    );
    let manifest = registry
        .inspect_path("/tools/web/search")
        .expect("manifest");
    let mut envelope = new_operation_envelope(
        &manifest,
        json!({ "query": "Lyra docs" }),
        None,
        ToolOperationContext {
            session_id: "session-1".to_string(),
            turn_id: "turn-1".to_string(),
            ..ToolOperationContext::default()
        },
    );
    envelope.created_at = "2026-06-05T00:00:00.000Z".to_string();
    assert_eq!(
        envelope
            .validate(&registry)
            .expect("validated")
            .unwrap()
            .path,
        "/tools/web/search"
    );

    let mut missing_turn = envelope.clone();
    missing_turn.runtime_turn_id.clear();
    assert_eq!(
        missing_turn.validate(&registry).unwrap_err().code,
        "missing_runtime_turn"
    );

    let mut missing_policy = envelope.clone();
    missing_policy.policy_snapshot_id = None;
    assert_eq!(
        missing_policy.validate(&registry).unwrap_err().code,
        "missing_policy_snapshot"
    );

    let mut invalid_permission_mode = envelope.clone();
    invalid_permission_mode.permission_mode = "free_for_all".to_string();
    assert_eq!(
        invalid_permission_mode
            .validate(&registry)
            .unwrap_err()
            .code,
        "invalid_permission_mode"
    );

    let mut invalid_timeout = envelope.clone();
    invalid_timeout.timeout_ms = Some(MAX_TOOL_TIMEOUT_MS + 1);
    assert_eq!(
        invalid_timeout.validate(&registry).unwrap_err().code,
        "invalid_timeout"
    );

    let mut missing_args = envelope.clone();
    missing_args.args = json!({});
    assert_eq!(
        missing_args.validate(&registry).unwrap_err().code,
        "invalid_tool_args"
    );

    let mut wrong_type = envelope.clone();
    wrong_type.args = json!({ "query": 42 });
    let wrong_type_error = wrong_type.validate(&registry).unwrap_err();
    assert_eq!(wrong_type_error.code, "invalid_tool_args");
    assert_eq!(
        wrong_type_error
            .detail
            .as_ref()
            .and_then(|detail| detail.pointer("/schemaError/field"))
            .and_then(Value::as_str),
        Some("query")
    );

    let mut mismatched_handle = envelope.clone();
    mismatched_handle.tool_handle = Some("web_fetch".to_string());
    assert_eq!(
        mismatched_handle.validate(&registry).unwrap_err().code,
        "ambiguous_tool_target"
    );

    let mut cancelled = envelope;
    cancelled.risk_context = json!({ "cancellationRequested": true });
    assert_eq!(
        cancelled.validate(&registry).unwrap_err().code,
        "operation_cancelled"
    );
}

#[test]
fn operation_envelope_validator_recursively_checks_json_schema_constraints() {
    let path = "/tools/test/validate_args";
    let mut manifest = test_manifest(path, None);
    manifest.operation = "validate_args".to_string();
    manifest.input_schema = attach_schema_id(
        path,
        json!({
            "type": "object",
            "properties": {
                "name": {
                    "type": "string",
                    "minLength": 2,
                    "maxLength": 5,
                    "pattern": "^[a-z]+$"
                },
                "items": {
                    "type": "array",
                    "minItems": 1,
                    "maxItems": 2,
                    "items": { "type": "integer", "minimum": 1 }
                },
                "options": {
                    "type": "object",
                    "properties": {
                        "mode": { "enum": ["fast", "safe"] }
                    },
                    "required": ["mode"],
                    "additionalProperties": false
                },
                "choice": {
                    "oneOf": [
                        { "const": "a" },
                        { "const": "b" }
                    ]
                },
                "maybe": {
                    "anyOf": [
                        { "type": "string" },
                        { "type": "integer" }
                    ]
                }
            },
            "required": ["name", "items", "options"],
            "additionalProperties": false
        }),
    );
    let provider = TestManifestProvider {
        manifests: vec![manifest.clone()],
    };
    let registry = ToolFsRegistry::try_with_providers(&[&provider]).expect("registry");
    let context = ToolOperationContext {
        session_id: "session-1".to_string(),
        turn_id: "turn-1".to_string(),
        ..ToolOperationContext::default()
    };
    let valid_args = json!({
        "name": "alpha",
        "items": [1, 2],
        "options": { "mode": "fast" },
        "choice": "a",
        "maybe": 7
    });
    let mut valid = new_operation_envelope(&manifest, valid_args, None, context.clone());
    valid.created_at = "2026-06-05T00:00:00.000Z".to_string();
    assert!(valid.validate(&registry).is_ok());

    let invalid_cases = [
        (
            json!({
                "name": "Alpha",
                "items": [1],
                "options": { "mode": "fast" }
            }),
            "name",
        ),
        (
            json!({
                "name": "ok",
                "items": [],
                "options": { "mode": "fast" }
            }),
            "items",
        ),
        (
            json!({
                "name": "ok",
                "items": [0],
                "options": { "mode": "fast" }
            }),
            "items[0]",
        ),
        (
            json!({
                "name": "ok",
                "items": [1],
                "options": { "mode": "fast", "extra": true }
            }),
            "options.extra",
        ),
        (
            json!({
                "name": "ok",
                "items": [1],
                "options": { "mode": "fast" },
                "choice": "c"
            }),
            "choice",
        ),
        (
            json!({
                "name": "ok",
                "items": [1],
                "options": { "mode": "fast" },
                "maybe": true
            }),
            "maybe",
        ),
    ];
    for (args, field) in invalid_cases {
        let mut envelope = new_operation_envelope(&manifest, args, None, context.clone());
        envelope.created_at = "2026-06-05T00:00:00.000Z".to_string();
        let error = envelope.validate(&registry).expect_err("invalid args");
        assert_eq!(error.code, "invalid_tool_args");
        assert_eq!(
            error
                .detail
                .as_ref()
                .and_then(|detail| detail.pointer("/schemaError/field"))
                .and_then(Value::as_str),
            Some(field)
        );
    }

    let mut missing_nested = new_operation_envelope(
        &manifest,
        json!({
            "name": "ok",
            "items": [1],
            "options": {}
        }),
        None,
        context,
    );
    missing_nested.created_at = "2026-06-05T00:00:00.000Z".to_string();
    let error = missing_nested
        .validate(&registry)
        .expect_err("missing nested");
    assert_eq!(error.code, "invalid_tool_args");
    assert!(
        error
            .detail
            .as_ref()
            .and_then(|detail| detail.get("missing"))
            .and_then(Value::as_array)
            .is_some_and(|missing| missing
                .iter()
                .any(|field| field.as_str() == Some("options.mode")))
    );
}

#[test]
fn result_trace_and_change_records_expose_document_fields() {
    let change = ToolChangeRecord {
        schema_version: TOOL_FS_SCHEMA_VERSION,
        change_id: "change-1".to_string(),
        kind: "file".to_string(),
        operation: "write".to_string(),
        path: Some("README.md".to_string()),
        summary: "Updated README.md.".to_string(),
        detail: json!({ "path": "README.md" }),
        reversible: true,
        before_ref: None,
        after_ref: None,
        diff_ref: Some(json!({ "id": "artifact-diff" })),
    };
    let trace = ToolTraceRecord::new(
        "trace-1",
        "op-1",
        "turn-1",
        Some("/tools/web/search".to_string()),
        "completed",
        "completed",
        None,
        json!({}),
        "2026-06-05T00:00:00.000Z",
    );
    let result = ToolResultEnvelope {
        schema_version: TOOL_FS_SCHEMA_VERSION,
        status: "completed".to_string(),
        runtime_turn_id: "turn-1".to_string(),
        duration_ms: 3,
        trace_id: "trace-1".to_string(),
        ok: true,
        content: "ok".to_string(),
        raw: json!({ "ok": true }),
        tool_path: "/tools/web/search".to_string(),
        domain: "web".to_string(),
        operation: "search".to_string(),
        artifacts: vec![json!({ "id": "artifact-diff" })],
        artifact_refs: vec![json!({ "id": "artifact-diff" })],
        projection_ref: None,
        data_ref: None,
        stdout_ref: None,
        stderr_ref: None,
        changes: vec![change],
        error: None,
        not_run_reason: None,
    };
    let result_json = serde_json::to_value(result).expect("result json");
    let trace_json = serde_json::to_value(trace).expect("trace json");
    assert_eq!(result_json["schemaVersion"], TOOL_FS_SCHEMA_VERSION);
    assert_eq!(result_json["runtimeTurnId"], "turn-1");
    assert_eq!(result_json["artifactRefs"][0]["id"], "artifact-diff");
    assert_eq!(result_json["changes"][0]["diffRef"]["id"], "artifact-diff");
    assert_eq!(trace_json["traceId"], "trace-1");
}
