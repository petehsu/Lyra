use regex::Regex;
use serde_json::{Value, json};
use std::collections::BTreeMap;

use crate::error::ToolFsError;
use crate::model::ToolManifest;
use crate::registry::normalize_tool_path;

pub(crate) fn validate_args_against_schema(
    manifest: &ToolManifest,
    args: &Value,
) -> Result<(), ToolFsError> {
    if !args.is_object() {
        return Err(ToolFsError::new(
            "invalid_tool_args",
            "Tool-FS args must be a JSON object.",
            "Retry with args as an object matching the inspected inputSchema.",
        ));
    };
    validate_value_against_schema(manifest, "args", args, &manifest.input_schema)
}

fn validate_value_against_schema(
    manifest: &ToolManifest,
    field: &str,
    value: &Value,
    schema: &Value,
) -> Result<(), ToolFsError> {
    if value.is_null() {
        return Ok(());
    }
    validate_schema_combinators(manifest, field, value, schema)?;
    if let Some(expected_const) = schema.get("const")
        && expected_const != value
    {
        return Err(schema_validation_error(
            manifest,
            field,
            "field value does not match const",
            json!({ "field": field, "expected": expected_const, "actual": value }),
        ));
    }
    if let Some(enum_values) = schema.get("enum").and_then(Value::as_array)
        && !enum_values.iter().any(|allowed| allowed == value)
    {
        return Err(schema_validation_error(
            manifest,
            field,
            "field value is not in the allowed enum",
            json!({ "field": field, "allowed": enum_values, "actual": value }),
        ));
    }
    if let Some(expected) = schema.get("type")
        && !schema_type_allows(expected, value)
    {
        return Err(schema_validation_error(
            manifest,
            field,
            "field value does not match the declared type",
            json!({
                "field": field,
                "expectedType": expected,
                "actualType": json_type_name(value),
            }),
        ));
    }
    match value {
        Value::Number(_) => validate_number_constraints(manifest, field, value, schema)?,
        Value::String(actual) => validate_string_constraints(manifest, field, actual, schema)?,
        Value::Array(values) => validate_array_constraints(manifest, field, values, schema)?,
        Value::Object(values) => validate_object_constraints(manifest, field, values, schema)?,
        Value::Bool(_) | Value::Null => {}
    }
    Ok(())
}

fn validate_schema_combinators(
    manifest: &ToolManifest,
    field: &str,
    value: &Value,
    schema: &Value,
) -> Result<(), ToolFsError> {
    if let Some(schemas) = schema.get("allOf").and_then(Value::as_array) {
        for subschema in schemas {
            validate_value_against_schema(manifest, field, value, subschema)?;
        }
    }
    if let Some(schemas) = schema.get("anyOf").and_then(Value::as_array) {
        let matched = schemas
            .iter()
            .filter(|subschema| {
                validate_value_against_schema(manifest, field, value, subschema).is_ok()
            })
            .count();
        if matched == 0 {
            return Err(schema_validation_error(
                manifest,
                field,
                "field value does not match any allowed schema",
                json!({ "field": field, "schemaKeyword": "anyOf" }),
            ));
        }
    }
    if let Some(schemas) = schema.get("oneOf").and_then(Value::as_array) {
        let matched = schemas
            .iter()
            .filter(|subschema| {
                validate_value_against_schema(manifest, field, value, subschema).is_ok()
            })
            .count();
        if matched != 1 {
            return Err(schema_validation_error(
                manifest,
                field,
                "field value must match exactly one allowed schema",
                json!({ "field": field, "schemaKeyword": "oneOf", "matched": matched }),
            ));
        }
    }
    Ok(())
}

fn validate_number_constraints(
    manifest: &ToolManifest,
    field: &str,
    value: &Value,
    schema: &Value,
) -> Result<(), ToolFsError> {
    if let Some(minimum) = schema.get("minimum").and_then(Value::as_f64)
        && value.as_f64().is_some_and(|actual| actual < minimum)
    {
        return Err(schema_validation_error(
            manifest,
            field,
            "field value is below minimum",
            json!({ "field": field, "minimum": minimum, "actual": value }),
        ));
    }
    if let Some(maximum) = schema.get("maximum").and_then(Value::as_f64)
        && value.as_f64().is_some_and(|actual| actual > maximum)
    {
        return Err(schema_validation_error(
            manifest,
            field,
            "field value is above maximum",
            json!({ "field": field, "maximum": maximum, "actual": value }),
        ));
    }
    Ok(())
}

fn validate_string_constraints(
    manifest: &ToolManifest,
    field: &str,
    value: &str,
    schema: &Value,
) -> Result<(), ToolFsError> {
    let length = value.chars().count();
    if let Some(min_length) = schema.get("minLength").and_then(Value::as_u64)
        && length < min_length as usize
    {
        return Err(schema_validation_error(
            manifest,
            field,
            "field value is shorter than minLength",
            json!({ "field": field, "minLength": min_length, "actualLength": length }),
        ));
    }
    if let Some(max_length) = schema.get("maxLength").and_then(Value::as_u64)
        && length > max_length as usize
    {
        return Err(schema_validation_error(
            manifest,
            field,
            "field value is longer than maxLength",
            json!({ "field": field, "maxLength": max_length, "actualLength": length }),
        ));
    }
    if let Some(pattern) = schema.get("pattern").and_then(Value::as_str) {
        let regex = Regex::new(pattern).map_err(|error| {
            schema_validation_error(
                manifest,
                field,
                "schema pattern is invalid",
                json!({ "field": field, "pattern": pattern, "error": error.to_string() }),
            )
        })?;
        if !regex.is_match(value) {
            return Err(schema_validation_error(
                manifest,
                field,
                "field value does not match pattern",
                json!({ "field": field, "pattern": pattern, "actual": value }),
            ));
        }
    }
    Ok(())
}

fn validate_array_constraints(
    manifest: &ToolManifest,
    field: &str,
    values: &[Value],
    schema: &Value,
) -> Result<(), ToolFsError> {
    if let Some(min_items) = schema.get("minItems").and_then(Value::as_u64)
        && values.len() < min_items as usize
    {
        return Err(schema_validation_error(
            manifest,
            field,
            "array has fewer items than minItems",
            json!({ "field": field, "minItems": min_items, "actualItems": values.len() }),
        ));
    }
    if let Some(max_items) = schema.get("maxItems").and_then(Value::as_u64)
        && values.len() > max_items as usize
    {
        return Err(schema_validation_error(
            manifest,
            field,
            "array has more items than maxItems",
            json!({ "field": field, "maxItems": max_items, "actualItems": values.len() }),
        ));
    }
    if let Some(items) = schema.get("items") {
        for (index, item) in values.iter().enumerate() {
            validate_value_against_schema(manifest, &format!("{field}[{index}]"), item, items)?;
        }
    }
    Ok(())
}

fn validate_object_constraints(
    manifest: &ToolManifest,
    field: &str,
    values: &serde_json::Map<String, Value>,
    schema: &Value,
) -> Result<(), ToolFsError> {
    if let Some(required) = schema.get("required").and_then(Value::as_array) {
        let missing = required
            .iter()
            .filter_map(Value::as_str)
            .filter(|required_field| values.get(*required_field).is_none_or(Value::is_null))
            .map(|required_field| child_schema_field(field, required_field))
            .collect::<Vec<_>>();
        if !missing.is_empty() {
            return Err(ToolFsError::new(
                "invalid_tool_args",
                format!(
                    "Tool-FS args are missing required field(s): {}.",
                    missing.join(", ")
                ),
                "Inspect the target tool and retry with all required args.",
            )
            .with_detail(json!({
                "toolPath": manifest.path,
                "missing": missing,
            })));
        }
    }

    let properties = schema.get("properties").and_then(Value::as_object);
    let additional_properties = schema.get("additionalProperties");
    for (key, value) in values {
        if let Some(property_schema) = properties.and_then(|properties| properties.get(key)) {
            validate_value_against_schema(
                manifest,
                &child_schema_field(field, key),
                value,
                property_schema,
            )?;
            continue;
        }
        match additional_properties {
            Some(Value::Bool(false)) => {
                return Err(schema_validation_error(
                    manifest,
                    &child_schema_field(field, key),
                    "field is not declared in the target input schema",
                    json!({ "field": child_schema_field(field, key) }),
                ));
            }
            Some(additional_schema @ Value::Object(_)) => validate_value_against_schema(
                manifest,
                &child_schema_field(field, key),
                value,
                additional_schema,
            )?,
            _ => {}
        }
    }
    Ok(())
}

fn child_schema_field(parent: &str, child: &str) -> String {
    if parent.is_empty() || parent == "args" {
        child.to_string()
    } else {
        format!("{parent}.{child}")
    }
}

fn schema_type_allows(expected: &Value, value: &Value) -> bool {
    match expected {
        Value::String(expected) => single_schema_type_allows(expected, value),
        Value::Array(expected) => expected
            .iter()
            .filter_map(Value::as_str)
            .any(|expected| single_schema_type_allows(expected, value)),
        _ => true,
    }
}

fn single_schema_type_allows(expected: &str, value: &Value) -> bool {
    match expected {
        "array" => value.is_array(),
        "boolean" => value.is_boolean(),
        "integer" => value.as_i64().is_some() || value.as_u64().is_some(),
        "number" => value.is_number(),
        "null" => value.is_null(),
        "object" => value.is_object(),
        "string" => value.is_string(),
        _ => true,
    }
}

fn json_type_name(value: &Value) -> &'static str {
    match value {
        Value::Array(_) => "array",
        Value::Bool(_) => "boolean",
        Value::Null => "null",
        Value::Number(_) => "number",
        Value::Object(_) => "object",
        Value::String(_) => "string",
    }
}

fn schema_validation_error(
    manifest: &ToolManifest,
    field: &str,
    message: &str,
    detail: Value,
) -> ToolFsError {
    ToolFsError::new(
        "invalid_tool_args",
        format!("Tool-FS args field `{field}` is invalid: {message}."),
        "Inspect the target tool and retry with args matching inputSchema.",
    )
    .with_detail(json!({
        "toolPath": manifest.path,
        "schemaError": detail,
    }))
}

pub fn schema_id_for_path(path: &str) -> String {
    let normalized = normalize_tool_path(path);
    format!("lyra-tool-fs://schema{normalized}/input")
}

pub fn attach_schema_id(path: &str, mut schema: Value) -> Value {
    if let Some(object) = schema.as_object_mut() {
        object
            .entry("$id".to_string())
            .or_insert_with(|| Value::String(schema_id_for_path(path)));
    }
    schema
}

pub(crate) fn object_schema<const N: usize>(
    properties: [(&str, Value); N],
    required: &[&str],
) -> Value {
    let mut map = BTreeMap::new();
    for (key, value) in properties {
        map.insert(key.to_string(), value);
    }
    let mut schema = json!({
        "type": "object",
        "properties": map,
    });
    if !required.is_empty() {
        schema["required"] = Value::Array(
            required
                .iter()
                .map(|key| Value::String((*key).to_string()))
                .collect(),
        );
    }
    schema
}
