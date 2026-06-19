use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub struct RenderDocumentOptions {
    pub theme: RenderTheme,
    pub enable_math: bool,
    pub enable_mermaid: bool,
    pub highlight_code: bool,
    pub locale: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash, Default)]
#[serde(rename_all = "lowercase")]
pub enum RenderTheme {
    #[default]
    Dark,
    Light,
    Auto,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub struct HighlightRequest {
    pub language: String,
    pub source: String,
    pub theme: RenderTheme,
}

impl Default for RenderDocumentOptions {
    fn default() -> Self {
        Self {
            theme: RenderTheme::Dark,
            enable_math: true,
            enable_mermaid: true,
            highlight_code: true,
            locale: None,
        }
    }
}