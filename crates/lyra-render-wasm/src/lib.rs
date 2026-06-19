use lyra_render_core::{
    highlight_request, invalidate_cache, render_document, HighlightRequest, RenderDocumentOptions,
};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use wasm_bindgen::prelude::*;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct JsonRenderDocumentRequest {
    content: String,
    #[serde(default)]
    mode: Option<String>,
    #[serde(default)]
    theme: Option<String>,
    #[serde(default)]
    enable_math: Option<bool>,
    #[serde(default)]
    enable_mermaid: Option<bool>,
    #[serde(default)]
    highlight_code: Option<bool>,
    #[serde(default)]
    locale: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct JsonHighlightRequest {
    language: String,
    source: String,
    #[serde(default)]
    theme: Option<String>,
}

fn parse_json<T: DeserializeOwned>(input: &str) -> Result<T, String> {
    serde_json::from_str(input).map_err(|error| format!("invalid JSON payload: {error}"))
}

fn stringify_json<T: Serialize>(value: &T) -> Result<String, String> {
    serde_json::to_string(value).map_err(|error| format!("failed to serialize JSON payload: {error}"))
}

fn build_render_options(request: &JsonRenderDocumentRequest) -> RenderDocumentOptions {
    let mut options = RenderDocumentOptions::default();
    if let Some(theme) = request.theme.as_deref() {
        options.theme = match theme {
            "light" => lyra_render_core::RenderTheme::Light,
            "auto" => lyra_render_core::RenderTheme::Auto,
            _ => lyra_render_core::RenderTheme::Dark,
        };
    }
    if let Some(enable_math) = request.enable_math {
        options.enable_math = enable_math;
    }
    if let Some(enable_mermaid) = request.enable_mermaid {
        options.enable_mermaid = enable_mermaid;
    }
    if let Some(highlight_code) = request.highlight_code {
        options.highlight_code = highlight_code;
    }
    options.locale = request.locale.clone();
    let _ = request.mode.as_deref();
    options
}

#[wasm_bindgen]
pub fn render_document_json(input: &str) -> Result<String, JsValue> {
    let request: JsonRenderDocumentRequest =
        parse_json(input).map_err(|error| JsValue::from_str(&error))?;
    let options = build_render_options(&request);
    let document = render_document(&request.content, &options);
    stringify_json(&document).map_err(|error| JsValue::from_str(&error))
}

#[wasm_bindgen]
pub fn highlight_spans_json(input: &str) -> Result<String, JsValue> {
    let request: JsonHighlightRequest =
        parse_json(input).map_err(|error| JsValue::from_str(&error))?;
    let highlight = HighlightRequest {
        language: request.language,
        source: request.source,
        theme: match request.theme.as_deref() {
            Some("light") => lyra_render_core::RenderTheme::Light,
            Some("auto") => lyra_render_core::RenderTheme::Auto,
            _ => lyra_render_core::RenderTheme::Dark,
        },
    };
    let spans = highlight_request(&highlight).map_err(|error| {
        JsValue::from_str(&format!("RENDER_ERROR::HIGHLIGHT::{}", error))
    })?;
    stringify_json(&spans).map_err(|error| JsValue::from_str(&error))
}

#[wasm_bindgen]
pub fn invalidate_render_cache() {
    invalidate_cache();
}