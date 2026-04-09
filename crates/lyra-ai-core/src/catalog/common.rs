use std::collections::BTreeMap;

use crate::profile::types::{
    AiConfigMap, AiProviderFieldOption, AiProviderFieldSchema, AiProviderModelEntry,
};

pub fn map(entries: &[(&str, &str)]) -> AiConfigMap {
    entries
        .iter()
        .map(|(key, value)| ((*key).to_string(), (*value).to_string()))
        .collect::<BTreeMap<_, _>>()
}

pub fn model(id: &str, name: &str, description: &str) -> AiProviderModelEntry {
    AiProviderModelEntry {
        id: id.to_string(),
        name: name.to_string(),
        description: Some(description.to_string()),
        context_window: None,
        supports_images: None,
        supports_tools: None,
        source: "preset".to_string(),
    }
}

pub fn text_field(
    id: &str,
    label: &str,
    scope: &str,
    placeholder: &str,
    required: bool,
) -> AiProviderFieldSchema {
    AiProviderFieldSchema {
        id: id.to_string(),
        label: label.to_string(),
        kind: "text".to_string(),
        scope: scope.to_string(),
        placeholder: Some(placeholder.to_string()),
        description: None,
        required: Some(required),
        secret: None,
        options: vec![],
    }
}

pub fn url_field(
    id: &str,
    label: &str,
    scope: &str,
    placeholder: &str,
    required: bool,
) -> AiProviderFieldSchema {
    AiProviderFieldSchema {
        id: id.to_string(),
        label: label.to_string(),
        kind: "url".to_string(),
        scope: scope.to_string(),
        placeholder: Some(placeholder.to_string()),
        description: None,
        required: Some(required),
        secret: None,
        options: vec![],
    }
}

pub fn password_field(
    id: &str,
    label: &str,
    scope: &str,
    placeholder: &str,
    required: bool,
) -> AiProviderFieldSchema {
    AiProviderFieldSchema {
        id: id.to_string(),
        label: label.to_string(),
        kind: "password".to_string(),
        scope: scope.to_string(),
        placeholder: Some(placeholder.to_string()),
        description: None,
        required: Some(required),
        secret: Some(true),
        options: vec![],
    }
}

pub fn textarea_field(
    id: &str,
    label: &str,
    scope: &str,
    placeholder: &str,
    required: bool,
) -> AiProviderFieldSchema {
    AiProviderFieldSchema {
        id: id.to_string(),
        label: label.to_string(),
        kind: "textarea".to_string(),
        scope: scope.to_string(),
        placeholder: Some(placeholder.to_string()),
        description: None,
        required: Some(required),
        secret: None,
        options: vec![],
    }
}

pub fn file_field(id: &str, label: &str, scope: &str, placeholder: &str) -> AiProviderFieldSchema {
    AiProviderFieldSchema {
        id: id.to_string(),
        label: label.to_string(),
        kind: "file".to_string(),
        scope: scope.to_string(),
        placeholder: Some(placeholder.to_string()),
        description: None,
        required: Some(false),
        secret: None,
        options: vec![],
    }
}

pub fn select_field(
    id: &str,
    label: &str,
    scope: &str,
    options: &[(&str, &str)],
) -> AiProviderFieldSchema {
    AiProviderFieldSchema {
        id: id.to_string(),
        label: label.to_string(),
        kind: "select".to_string(),
        scope: scope.to_string(),
        placeholder: None,
        description: None,
        required: Some(true),
        secret: None,
        options: options
            .iter()
            .map(|(value, field_label)| AiProviderFieldOption {
                value: (*value).to_string(),
                label: (*field_label).to_string(),
            })
            .collect(),
    }
}
