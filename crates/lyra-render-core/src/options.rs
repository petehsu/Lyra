use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash, Default)]
#[serde(rename_all = "camelCase")]
pub enum RenderDocumentMode {
    #[default]
    Document,
    Fragment,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub struct RenderDocumentOptions {
    pub mode: RenderDocumentMode,
    pub theme: RenderTheme,
    pub enable_math: bool,
    pub enable_mermaid: bool,
    pub highlight_code: bool,
    pub locale: Option<String>,
}

pub fn parse_render_document_mode(mode: Option<&str>) -> RenderDocumentMode {
    match mode {
        Some("fragment") => RenderDocumentMode::Fragment,
        _ => RenderDocumentMode::Document,
    }
}

pub fn apply_render_document_overrides(
    options: &mut RenderDocumentOptions,
    mode: Option<&str>,
    theme: Option<&str>,
    enable_math: Option<bool>,
    enable_mermaid: Option<bool>,
    highlight_code: Option<bool>,
    locale: Option<String>,
) {
    options.mode = parse_render_document_mode(mode);
    if let Some(theme) = theme {
        options.theme = match theme {
            "light" => RenderTheme::Light,
            "auto" => RenderTheme::Auto,
            _ => RenderTheme::Dark,
        };
    }
    if let Some(enable_math) = enable_math {
        options.enable_math = enable_math;
    }
    if let Some(enable_mermaid) = enable_mermaid {
        options.enable_mermaid = enable_mermaid;
    }
    if let Some(highlight_code) = highlight_code {
        options.highlight_code = highlight_code;
    }
    options.locale = locale;
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
            mode: RenderDocumentMode::Document,
            theme: RenderTheme::Dark,
            enable_math: true,
            enable_mermaid: true,
            highlight_code: true,
            locale: None,
        }
    }
}
