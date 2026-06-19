use lyra_render_core::{
    highlight_request, invalidate_cache, render_document, HighlightRequest, RenderDocumentOptions,
};
use napi::{Error, Result, Status};
use napi_derive::napi;
use serde::{de::DeserializeOwned, Deserialize, Serialize};

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

fn parse_json<T: DeserializeOwned>(input: &str) -> Result<T> {
    serde_json::from_str(input)
        .map_err(|error| Error::new(Status::InvalidArg, format!("invalid JSON payload: {error}")))
}

fn stringify_json<T: Serialize>(value: &T) -> Result<String> {
    serde_json::to_string(value).map_err(|error| {
        Error::new(
            Status::GenericFailure,
            format!("failed to serialize JSON payload: {error}"),
        )
    })
}

fn render_error(code: &str, message: impl Into<String>) -> Error {
    Error::new(
        Status::GenericFailure,
        format!("RENDER_ERROR::{code}::{}", message.into()),
    )
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

#[napi]
pub fn render_document_json(input: String) -> Result<String> {
    let request: JsonRenderDocumentRequest = parse_json(&input)?;
    let options = build_render_options(&request);
    let document = render_document(&request.content, &options);
    stringify_json(&document)
}

#[napi]
pub fn highlight_spans_json(input: String) -> Result<String> {
    let request: JsonHighlightRequest = parse_json(&input)?;
    let highlight = HighlightRequest {
        language: request.language,
        source: request.source,
        theme: match request.theme.as_deref() {
            Some("light") => lyra_render_core::RenderTheme::Light,
            Some("auto") => lyra_render_core::RenderTheme::Auto,
            _ => lyra_render_core::RenderTheme::Dark,
        },
    };
    let spans = highlight_request(&highlight)
        .map_err(|error| render_error("HIGHLIGHT", error.to_string()))?;
    stringify_json(&spans)
}

#[napi]
pub fn invalidate_render_cache() -> Result<()> {
    invalidate_cache();
    Ok(())
}