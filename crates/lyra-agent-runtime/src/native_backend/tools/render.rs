use super::*;

const RENDER_SURFACE_MAX_CONTENT_CHARS: usize = 120_000;
const RENDER_SURFACE_DEFAULT_HEIGHT: u64 = 320;
const RENDER_SURFACE_MIN_HEIGHT: u64 = 140;
const RENDER_SURFACE_MAX_HEIGHT: u64 = 720;

pub(crate) fn tool_render_surface(
    turn_id: &str,
    tool_call_id: &str,
    input: &Value,
) -> NativeToolResult {
    let kind = value_string(input, "kind")
        .or_else(|| value_string(input, "format"))
        .unwrap_or_else(|| "html".to_string())
        .to_lowercase();
    if !matches!(
        kind.as_str(),
        "html" | "markdown" | "md" | "svg" | "json" | "table" | "text"
    ) {
        return Err(NativeToolFailure::new(
            "unsupported_render_surface_kind",
            format!("render_surface does not support kind: {kind}"),
            "Retry with kind html, markdown, svg, json, table, or text.",
        ));
    }
    let kind = if kind == "md" {
        "markdown".to_string()
    } else {
        kind
    };
    let title = value_string(input, "title").unwrap_or_else(|| "Render Surface".to_string());
    let surface_id = value_string(input, "surfaceId")
        .or_else(|| value_string(input, "id"))
        .unwrap_or_else(|| format!("surface-{turn_id}-{tool_call_id}"));
    let operation = value_string(input, "operation")
        .unwrap_or_else(|| "create".to_string())
        .to_lowercase();
    let operation = if matches!(
        operation.as_str(),
        "create" | "update" | "replace" | "append"
    ) {
        operation
    } else {
        "create".to_string()
    };
    let height = input
        .get("height")
        .and_then(Value::as_u64)
        .unwrap_or(RENDER_SURFACE_DEFAULT_HEIGHT)
        .clamp(RENDER_SURFACE_MIN_HEIGHT, RENDER_SURFACE_MAX_HEIGHT);
    let summary = value_string(input, "summary")
        .or_else(|| value_string(input, "description"))
        .unwrap_or_else(|| render_surface_summary(&kind, &title));

    let content = render_surface_content(&kind, input)?;
    let content_chars = content.chars().count();
    if content_chars > RENDER_SURFACE_MAX_CONTENT_CHARS {
        return Err(NativeToolFailure::new(
            "render_surface_too_large",
            format!(
                "render_surface content has {content_chars} characters, above the {RENDER_SURFACE_MAX_CONTENT_CHARS} character limit"
            ),
            "Render a concise interactive surface, split the work into multiple surfaces, or write a file artifact for large static assets.",
        ));
    }

    let data = input
        .get("data")
        .cloned()
        .or_else(|| input.get("json").cloned())
        .unwrap_or(Value::Null);
    let columns = input.get("columns").cloned().unwrap_or(Value::Null);
    let rows = input.get("rows").cloned().unwrap_or(Value::Null);
    let theme = value_string(input, "theme").unwrap_or_else(|| "auto".to_string());
    let interactive = value_bool(
        input,
        "interactive",
        matches!(kind.as_str(), "html" | "svg"),
    );

    Ok(NativeToolSuccess {
        content: format!(
            "Rendered {kind} surface \"{title}\" ({surface_id}).\n{summary}"
        ),
        raw: json!({
            "kind": "render_surface",
            "surfaceId": surface_id,
            "operation": operation,
            "title": title,
            "format": kind,
            "summary": summary,
            "content": content,
            "data": data,
            "columns": columns,
            "rows": rows,
            "height": height,
            "theme": theme,
            "interactive": interactive,
            "security": {
                "runtime": "sandboxed_iframe_for_html_svg",
                "node": false,
                "sameOriginWithParent": false,
                "parentDomAccess": false,
                "network": "blocked_for_scripts_by_csp",
                "eventBridge": "postMessage_only"
            }
        }),
        recommended_next_action: Some(
            "If the user changes controls inside the surface, react to their visible choice or render an updated surface with the same surfaceId."
                .to_string(),
        ),
    })
}

fn render_surface_content(kind: &str, input: &Value) -> Result<String, NativeToolFailure> {
    if kind == "json" {
        if let Some(data) = input.get("data").or_else(|| input.get("json")) {
            return serde_json::to_string_pretty(data).map_err(|error| {
                NativeToolFailure::new(
                    "bad_render_json",
                    format!("failed to format render_surface JSON data: {error}"),
                    "Retry with JSON-serializable data.",
                )
            });
        }
    }
    if kind == "table" {
        if input.get("rows").is_some() {
            return Ok(String::new());
        }
    }
    value_string(input, "content")
        .or_else(|| value_string(input, kind))
        .or_else(|| value_string(input, "html"))
        .or_else(|| value_string(input, "markdown"))
        .or_else(|| value_string(input, "svg"))
        .or_else(|| value_string(input, "text"))
        .ok_or_else(|| {
            NativeToolFailure::new(
                "render_surface_content_required",
                "render_surface requires content, data/json, or rows depending on kind",
                "Retry with content for html/markdown/svg/text, data for json, or rows for table.",
            )
        })
}

fn render_surface_summary(kind: &str, title: &str) -> String {
    format!("Inline {kind} surface for {title}.")
}
