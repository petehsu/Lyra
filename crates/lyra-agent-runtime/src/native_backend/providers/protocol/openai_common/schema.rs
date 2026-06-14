use serde_json::{Map, Value};

pub(crate) fn strict_tool_schema(mut schema: Value) -> Value {
    strict_tool_schema_inner(&mut schema, false);
    schema
}

fn strict_tool_schema_inner(schema: &mut Value, optional: bool) {
    let Some(object) = schema.as_object_mut() else {
        return;
    };
    if optional {
        allow_null_type(object);
    }
    if object.get("type").and_then(Value::as_str) == Some("object")
        || object.get("properties").is_some()
    {
        let originally_required = object
            .get("required")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .filter_map(|value| value.as_str().map(str::to_string))
            .collect::<std::collections::HashSet<_>>();
        let property_names = object
            .get("properties")
            .and_then(Value::as_object)
            .map(|properties| properties.keys().cloned().collect::<Vec<_>>())
            .unwrap_or_default();
        if let Some(properties) = object.get_mut("properties").and_then(Value::as_object_mut) {
            for name in &property_names {
                if let Some(property) = properties.get_mut(name) {
                    strict_tool_schema_inner(property, !originally_required.contains(name));
                }
            }
        }
        object.insert("additionalProperties".to_string(), Value::Bool(false));
        object.insert(
            "required".to_string(),
            Value::Array(property_names.into_iter().map(Value::String).collect()),
        );
    }
    if let Some(items) = object.get_mut("items") {
        strict_tool_schema_inner(items, false);
    }
}

fn allow_null_type(object: &mut Map<String, Value>) {
    match object.get_mut("type") {
        Some(Value::String(kind)) if kind != "null" => {
            let original = kind.clone();
            object.insert(
                "type".to_string(),
                Value::Array(vec![
                    Value::String(original),
                    Value::String("null".to_string()),
                ]),
            );
        }
        Some(Value::Array(items)) => {
            if !items.iter().any(|item| item.as_str() == Some("null")) {
                items.push(Value::String("null".to_string()));
            }
        }
        None => {
            object.insert(
                "type".to_string(),
                Value::Array(vec![
                    Value::String("string".to_string()),
                    Value::String("null".to_string()),
                ]),
            );
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn strict_schema_requires_optional_properties_as_nullable() {
        let schema = strict_tool_schema(json!({
            "type": "object",
            "properties": {
                "path": { "type": "string" },
                "limit": { "type": "integer" }
            },
            "required": ["path"]
        }));

        assert_eq!(schema["additionalProperties"], false);
        let required = schema["required"].as_array().expect("required");
        assert!(required.iter().any(|value| value == "path"));
        assert!(required.iter().any(|value| value == "limit"));
        assert_eq!(
            schema["properties"]["limit"]["type"],
            json!(["integer", "null"])
        );
    }
}
