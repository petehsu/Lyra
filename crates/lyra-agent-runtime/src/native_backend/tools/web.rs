use super::*;

pub(crate) fn execute_web_tool_adapter(
    session_id: &str,
    turn_id: &str,
    dispatcher: &Option<Arc<HostCapabilityDispatcher>>,
    cancellation: &Arc<AtomicBool>,
    tool_call_id: &str,
    tool_name: &str,
    display_name: &str,
    action: &str,
    arguments: Value,
    started_at: &str,
) -> Value {
    execute_native_tool_adapter_with_dispatcher(
        session_id,
        turn_id,
        cancellation,
        tool_call_id,
        tool_name,
        display_name,
        action,
        arguments,
        started_at,
        dispatcher.as_ref(),
    )
}

pub(crate) fn tool_web_fetch(turn_id: &str, tool_call_id: &str, input: &Value) -> NativeToolResult {
    let input = compatibility_web_fetch_input(input);
    tool_web_fetch_for_session("web-fetch-session", turn_id, tool_call_id, &input)
}

pub(crate) fn tool_web_fetch_for_session(
    session_id: &str,
    turn_id: &str,
    tool_call_id: &str,
    input: &Value,
) -> NativeToolResult {
    tool_web_fetch_with_browser_for_session(session_id, turn_id, tool_call_id, input, None)
}

pub(crate) fn tool_web_fetch_with_browser(
    turn_id: &str,
    tool_call_id: &str,
    input: &Value,
    dispatcher: Option<&Arc<HostCapabilityDispatcher>>,
) -> NativeToolResult {
    let input = compatibility_web_fetch_input(input);
    tool_web_fetch_with_browser_for_session(
        "web-fetch-session",
        turn_id,
        tool_call_id,
        &input,
        dispatcher,
    )
}

#[cfg(test)]
fn compatibility_web_fetch_input(input: &Value) -> Value {
    input.clone()
}

#[cfg(not(test))]
fn compatibility_web_fetch_input(input: &Value) -> Value {
    input.clone()
}

pub(crate) fn tool_web_fetch_with_browser_for_session(
    session_id: &str,
    turn_id: &str,
    tool_call_id: &str,
    input: &Value,
    dispatcher: Option<&Arc<HostCapabilityDispatcher>>,
) -> NativeToolResult {
    let url = required_value_string(input, "url")?;
    let max_chars = value_usize(input, "maxChars", 12_000, 100_000);
    let include_links = value_bool(input, "includeLinks", true);
    let parsed_url = Url::parse(&url).map_err(|error| {
        NativeToolFailure::new(
            "bad_url",
            format!("invalid URL: {error}"),
            "Retry with an absolute http or https URL.",
        )
    })?;
    let trusted_local = value_bool(input, "trustedLocal", false);
    if !matches!(parsed_url.scheme(), "http" | "https")
        && !(trusted_local && parsed_url.scheme() == "file")
    {
        return Err(NativeToolFailure::new(
            "unsupported_url_scheme",
            "web_fetch only supports http/https URLs unless trustedLocal=true is used with file:",
            "Retry with an http or https URL, or set trustedLocal=true for a local file URL.",
        ));
    }

    let mut options = reader_options_from_web_fetch(input, max_chars, include_links);
    if !value_bool(input, "extractText", true) {
        options.mode = lyra_agent_reader::ExtractionMode::Full;
    }

    let fetch_provider = lyra_agent_reader::ReqwestFetchProvider::new();
    let request = lyra_agent_reader::ReaderRequest {
        input: lyra_agent_reader::ReaderInput::Url(parsed_url.to_string()),
        options,
    };
    let browser_provider = dispatcher.map(|dispatcher| {
        RuntimeBrowserSnapshotProvider::new(dispatcher.clone(), turn_id, tool_call_id)
    });
    if matches!(
        request.options.engine,
        lyra_agent_reader::ReaderEngine::Browser
    ) && browser_provider.is_none()
    {
        return Err(NativeToolFailure::new(
            "browser_unavailable",
            "engine=browser requires the Workbench Browser host capability",
            "Open or enable the Workbench Browser, or retry with engine=http.",
        ));
    }
    let reader = if matches!(
        request.options.engine,
        lyra_agent_reader::ReaderEngine::Http
    ) {
        lyra_agent_reader::read(&request, &fetch_provider)
    } else {
        lyra_agent_reader::read_with_browser_provider(
            &request,
            &fetch_provider,
            browser_provider
                .as_ref()
                .map(|provider| provider as &dyn lyra_agent_reader::BrowserSnapshotProvider),
        )
    }
    .map_err(|error| reader_error_to_native_failure(&url, error))?;
    let index_result = if request.options.index_result {
        index_reader_result(session_id, turn_id, &reader)
    } else {
        json!({ "skipped": true, "reason": "indexResult=false" })
    };
    let browser_raw = browser_provider
        .as_ref()
        .and_then(RuntimeBrowserSnapshotProvider::last_raw)
        .unwrap_or(Value::Null);
    let engine_used = if reader.extraction.method == "browser" {
        "browser"
    } else {
        "http"
    };

    let artifact_ref = if reader.truncated {
        write_tool_artifact_with_kind(
            "web",
            turn_id,
            tool_call_id,
            ToolArtifactKind::WebPage,
            &reader.markdown_with_citations,
        )
    } else {
        None
    };

    let raw_links = if include_links {
        json!(reader.links)
    } else {
        Value::Array(Vec::new())
    };
    let metadata = if value_bool(input, "includeMetadata", true) {
        json!(reader.metadata)
    } else {
        Value::Null
    };
    let content_type = reader.mime_type.clone().unwrap_or_default();
    let title = reader.metadata.title.clone();
    let screenshot_artifact_ref = browser_raw
        .get("screenshotArtifactRef")
        .cloned()
        .or_else(|| {
            reader
                .artifacts
                .iter()
                .find(|artifact| artifact.kind == "browser_screenshot")
                .and_then(|artifact| artifact.id.clone())
                .map(Value::String)
        });
    let browser_warnings = browser_raw
        .get("warnings")
        .cloned()
        .unwrap_or_else(|| Value::Array(Vec::new()));
    let mut raw = json!({
        "url": url,
        "engineUsed": engine_used,
        "finalUrl": reader.final_url,
        "status": reader.status,
        "contentType": content_type,
        "mimeType": reader.mime_type,
        "format": reader.format,
        "title": title,
        "metadata": metadata,
        "markdown": reader.markdown_with_citations,
        "rawMarkdown": reader.raw_markdown,
        "markdownWithCitations": reader.markdown_with_citations,
        "fitMarkdown": reader.fit_markdown,
        "compactText": reader.compact_text,
        "text": reader.plain_text,
        "plainText": reader.plain_text,
        "chunks": reader.chunks,
        "fitChunks": reader.fit_chunks,
        "links": raw_links,
        "images": reader.images,
    });
    if let Some(object) = raw.as_object_mut() {
        object.insert(
            "filteredOutSummary".to_string(),
            json!(reader.filtered_out_summary),
        );
        object.insert(
            "fitScoringDebug".to_string(),
            json!(reader.fit_scoring_debug),
        );
        object.insert("media".to_string(), json!(reader.media));
        object.insert("warnings".to_string(), json!(reader.warnings));
        object.insert("debugTrace".to_string(), json!(reader.debug_trace));
        object.insert(
            "rawSource".to_string(),
            if value_bool(input, "includeRaw", false) {
                json!(reader.raw_source)
            } else {
                Value::Null
            },
        );
        object.insert("cacheKey".to_string(), json!(reader.cache_key));
        object.insert("browser".to_string(), browser_raw.clone());
        object.insert("browserWarnings".to_string(), browser_warnings);
        object.insert(
            "browserDebug".to_string(),
            browser_debug(input, engine_used, &browser_raw),
        );
        object.insert(
            "screenshotArtifactRef".to_string(),
            screenshot_artifact_ref.unwrap_or(Value::Null),
        );
        object.insert(
            "pageshotArtifactRef".to_string(),
            browser_raw
                .get("pageshotArtifactRef")
                .cloned()
                .unwrap_or(Value::Null),
        );
        object.insert("timing".to_string(), json!(reader.timing));
        object.insert("frontmatter".to_string(), json!(reader.frontmatter));
        object.insert("extraction".to_string(), json!(reader.extraction));
        object.insert("truncated".to_string(), json!(reader.truncated));
        object.insert("totalChars".to_string(), json!(reader.total_chars));
        object.insert("hasMore".to_string(), json!(reader.has_more));
        object.insert("nextCursor".to_string(), json!(reader.next_cursor));
        object.insert(
            "recommendedNextAction".to_string(),
            json!(reader.recommended_next_action),
        );
        object.insert("artifactRef".to_string(), json!(artifact_ref));
        object.insert("indexResult".to_string(), index_result);
    }
    let raw = web_fetch_raw_summary(session_id, turn_id, tool_call_id, &raw);

    Ok(NativeToolSuccess {
        content: reader.compact_text.clone(),
        raw,
        recommended_next_action: reader.recommended_next_action,
    })
}

fn web_fetch_raw_summary(
    session_id: &str,
    turn_id: &str,
    tool_call_id: &str,
    full_raw: &Value,
) -> Value {
    let raw_text = serde_json::to_string_pretty(full_raw)
        .or_else(|_| serde_json::to_string(full_raw))
        .unwrap_or_else(|_| "null".to_string());
    let original_raw_chars = raw_text.chars().count();
    let raw_artifact_ref = write_tool_artifact_with_kind(
        session_id,
        turn_id,
        &format!("{tool_call_id}-raw"),
        ToolArtifactKind::RawData,
        &raw_text,
    );
    json!({
        "kind": "web_fetch_summary",
        "retention": {
            "policy": "artifact_only_raw",
            "reason": "full web_fetch raw is stored as an artifact; session/model context keeps only compact summary fields",
            "originalRawChars": original_raw_chars,
        },
        "rawArtifactRef": raw_artifact_ref,
        "url": full_raw.get("url").cloned().unwrap_or(Value::Null),
        "engineUsed": full_raw.get("engineUsed").cloned().unwrap_or(Value::Null),
        "finalUrl": full_raw.get("finalUrl").cloned().unwrap_or(Value::Null),
        "status": full_raw.get("status").cloned().unwrap_or(Value::Null),
        "contentType": full_raw.get("contentType").cloned().unwrap_or(Value::Null),
        "mimeType": full_raw.get("mimeType").cloned().unwrap_or(Value::Null),
        "format": full_raw.get("format").cloned().unwrap_or(Value::Null),
        "title": full_raw.get("title").cloned().unwrap_or(Value::Null),
        "compactText": truncate_summary_string(full_raw.get("compactText").and_then(Value::as_str).unwrap_or(""), 4_000),
        "counts": {
            "links": value_array_len(full_raw.get("links")),
            "images": value_array_len(full_raw.get("images")),
            "media": value_array_len(full_raw.get("media")),
            "chunks": value_array_len(full_raw.get("chunks")),
            "fitChunks": value_array_len(full_raw.get("fitChunks")),
            "warnings": value_array_len(full_raw.get("warnings")),
        },
        "links": value_array_sample(full_raw.get("links"), 20),
        "images": value_array_sample(full_raw.get("images"), 20),
        "media": value_array_sample(full_raw.get("media"), 20),
        "warnings": full_raw.get("warnings").cloned().unwrap_or_else(|| Value::Array(Vec::new())),
        "filteredOutSummary": full_raw.get("filteredOutSummary").cloned().unwrap_or(Value::Null),
        "browser": browser_raw_summary(full_raw.get("browser").unwrap_or(&Value::Null)),
        "browserWarnings": full_raw.get("browserWarnings").cloned().unwrap_or_else(|| Value::Array(Vec::new())),
        "browserDebug": full_raw.get("browserDebug").cloned().unwrap_or(Value::Null),
        "screenshotArtifactRef": full_raw.get("screenshotArtifactRef").cloned().unwrap_or(Value::Null),
        "pageshotArtifactRef": full_raw.get("pageshotArtifactRef").cloned().unwrap_or(Value::Null),
        "timing": full_raw.get("timing").cloned().unwrap_or(Value::Null),
        "frontmatter": full_raw.get("frontmatter").cloned().unwrap_or(Value::Null),
        "extraction": full_raw.get("extraction").cloned().unwrap_or(Value::Null),
        "truncated": full_raw.get("truncated").cloned().unwrap_or(Value::Null),
        "totalChars": full_raw.get("totalChars").cloned().unwrap_or(Value::Null),
        "hasMore": full_raw.get("hasMore").cloned().unwrap_or(Value::Null),
        "nextCursor": full_raw.get("nextCursor").cloned().unwrap_or(Value::Null),
        "recommendedNextAction": full_raw.get("recommendedNextAction").cloned().unwrap_or(Value::Null),
        "artifactRef": full_raw.get("artifactRef").cloned().unwrap_or(Value::Null),
        "indexResult": full_raw.get("indexResult").cloned().unwrap_or(Value::Null),
    })
}

fn browser_raw_summary(raw: &Value) -> Value {
    let Some(object) = raw.as_object() else {
        return Value::Null;
    };
    let mut summary = Map::new();
    for key in [
        "ok",
        "kind",
        "tabId",
        "finalUrl",
        "title",
        "viewport",
        "warnings",
        "screenshotArtifactRef",
        "pageshotArtifactRef",
    ] {
        if let Some(value) = object.get(key) {
            summary.insert(key.to_string(), value.clone());
        }
    }
    if let Some(selected) = object.get("selectedElement").and_then(Value::as_object) {
        let mut selected_summary = Map::new();
        for key in ["selector", "text", "bounds"] {
            if let Some(value) = selected.get(key) {
                selected_summary.insert(
                    key.to_string(),
                    if key == "text" {
                        Value::String(truncate_summary_string(value.as_str().unwrap_or(""), 1_000))
                    } else {
                        value.clone()
                    },
                );
            }
        }
        if let Some(html) = selected.get("html").and_then(Value::as_str) {
            selected_summary.insert("htmlChars".to_string(), json!(html.chars().count()));
        }
        summary.insert(
            "selectedElement".to_string(),
            Value::Object(selected_summary),
        );
    }
    for key in ["frames", "shadowRoots", "media"] {
        if let Some(value) = object.get(key) {
            summary.insert(format!("{key}Count"), json!(value_array_len(Some(value))));
            summary.insert(key.to_string(), value_array_sample(Some(value), 10));
        }
    }
    Value::Object(summary)
}

fn value_array_len(value: Option<&Value>) -> usize {
    value.and_then(Value::as_array).map(Vec::len).unwrap_or(0)
}

fn value_array_sample(value: Option<&Value>, max_items: usize) -> Value {
    let Some(items) = value.and_then(Value::as_array) else {
        return Value::Array(Vec::new());
    };
    Value::Array(items.iter().take(max_items).cloned().collect())
}

fn truncate_summary_string(text: &str, max_chars: usize) -> String {
    if text.chars().count() <= max_chars {
        return text.to_string();
    }
    let mut output = text.chars().take(max_chars).collect::<String>();
    output.push_str("\n[truncated]");
    output
}

fn reader_options_from_web_fetch(
    input: &Value,
    max_chars: usize,
    include_links: bool,
) -> lyra_agent_reader::ReaderOptions {
    let mut options = lyra_agent_reader::ReaderOptions {
        max_chars: Some(max_chars),
        ..lyra_agent_reader::ReaderOptions::default()
    };
    apply_jina_aliases(input, &mut options);
    options.preset = match value_string(input, "preset").as_deref() {
        Some("research") => lyra_agent_reader::ReaderPreset::Research,
        Some("index") => lyra_agent_reader::ReaderPreset::Index,
        Some("reader") => lyra_agent_reader::ReaderPreset::Reader,
        Some("raw") => lyra_agent_reader::ReaderPreset::Raw,
        _ => options.preset,
    };
    options.output_format = match value_string(input, "format")
        .or_else(|| value_string(input, "respondWith"))
        .as_deref()
    {
        Some("text") => lyra_agent_reader::ReaderOutputFormat::Text,
        Some("json") => lyra_agent_reader::ReaderOutputFormat::Json,
        Some("chunks") => lyra_agent_reader::ReaderOutputFormat::Chunks,
        Some("frontmatter+markdown") | Some("frontmatterMarkdown") => {
            lyra_agent_reader::ReaderOutputFormat::FrontmatterMarkdown
        }
        _ => options.output_format,
    };
    options.engine = match value_string(input, "engine").as_deref() {
        Some("http") => lyra_agent_reader::ReaderEngine::Http,
        Some("browser") => lyra_agent_reader::ReaderEngine::Browser,
        _ => lyra_agent_reader::ReaderEngine::Auto,
    };
    if let Some(mode) = value_string(input, "mode") {
        options.mode = match mode.as_str() {
            "full" => lyra_agent_reader::ExtractionMode::Full,
            "text" | "plain" => lyra_agent_reader::ExtractionMode::Text,
            "raw" => lyra_agent_reader::ExtractionMode::Raw,
            _ => lyra_agent_reader::ExtractionMode::Main,
        };
    }
    if let Some(selector) = value_string(input, "targetSelector") {
        options.target_selector = Some(selector);
    }
    let remove_selectors = remove_selectors_from_input(input);
    if !remove_selectors.is_empty() {
        options.remove_selectors = remove_selectors;
    }
    let include_tags = string_array_from_input(input, "includeTags");
    if !include_tags.is_empty() {
        options.include_tags = include_tags;
    }
    let exclude_tags = string_array_from_input(input, "excludeTags");
    if !exclude_tags.is_empty() {
        options.exclude_tags = exclude_tags;
    }
    options.max_tokens = input
        .get("maxTokens")
        .and_then(Value::as_u64)
        .map(|value| value as usize)
        .filter(|value| *value > 0);
    if let Some(query_focus) = value_string(input, "queryFocus") {
        options.query_focus = Some(query_focus);
    }
    if let Some(user_task) = value_string(input, "userTask") {
        options.user_task = Some(user_task);
    }
    if options.query_focus.is_some() {
        options.content_filter = lyra_agent_reader::ContentFilterMode::Hybrid;
    }
    if options.query_focus.is_none() && options.user_task.is_some() {
        options.content_filter = lyra_agent_reader::ContentFilterMode::Hybrid;
    }
    if let Some(mode) = value_string(input, "contentFilter") {
        options.content_filter = match mode.as_str() {
            "bm25" => lyra_agent_reader::ContentFilterMode::Bm25,
            "prune" => lyra_agent_reader::ContentFilterMode::Prune,
            "hybrid" => lyra_agent_reader::ContentFilterMode::Hybrid,
            _ => lyra_agent_reader::ContentFilterMode::None,
        };
    }
    options.chunking = chunking_options_from_input(input);
    options.retain_links = if include_links {
        link_retention_from_input(input)
    } else {
        lyra_agent_reader::LinkRetention::Text
    };
    options.retain_images = image_retention_from_input(input);
    options.retain_media = media_retention_from_input(input, false);
    options.markdown.heading_style = heading_style_from_input(input);
    options.markdown.preserve_html_tags = preserve_html_tags_from_input(input);
    options.citation_format = citation_format_from_input(input);
    options.citations = value_bool(input, "citations", include_links);
    options.include_metadata = value_bool(input, "includeMetadata", true);
    options.include_raw = value_bool(input, "includeRaw", options.include_raw);
    options.max_bytes = input
        .get("maxBytes")
        .and_then(Value::as_u64)
        .map(|value| value as usize)
        .filter(|value| *value > 0);
    if input.get("cachePolicy").is_some() || input.get("noCache").is_some() {
        options.cache_policy = cache_policy_from_input(input);
    }
    options.trusted_local = value_bool(input, "trustedLocal", false);
    options.allow_private_network = value_bool(input, "allowPrivateNetwork", false);
    options.max_dom_bytes = input
        .get("maxDomBytes")
        .and_then(Value::as_u64)
        .map(|value| value as usize)
        .filter(|value| *value > 0);
    options.max_extracted_chars = input
        .get("maxExtractedChars")
        .and_then(Value::as_u64)
        .map(|value| value as usize)
        .filter(|value| *value > 0);
    options.index_result = value_bool(input, "indexResult", true);
    options.use_ocr = value_bool(
        input,
        "useOcr",
        value_bool(input, "withOcr", options.use_ocr),
    );
    options.use_caption = value_bool(
        input,
        "useCaption",
        value_bool(input, "withGeneratedAlt", options.use_caption),
    );
    options.wait_for_selector = value_string(input, "waitForSelector");
    options.wait_until = match value_string(input, "waitUntil").as_deref() {
        Some("html") => lyra_agent_reader::BrowserWaitUntil::Html,
        Some("textStable") | Some("text_stable") => lyra_agent_reader::BrowserWaitUntil::TextStable,
        Some("textChanged") | Some("text_changed") => {
            lyra_agent_reader::BrowserWaitUntil::TextChanged
        }
        Some("textContains") | Some("text_contains") => {
            lyra_agent_reader::BrowserWaitUntil::TextContains
        }
        _ => lyra_agent_reader::BrowserWaitUntil::LoadIdle,
    };
    options.browser_timeout_ms = input
        .get("timeoutMs")
        .or_else(|| input.get("browserTimeoutMs"))
        .and_then(Value::as_u64)
        .map(|value| value.clamp(250, 120_000));
    options.browser_mode = match value_string(input, "browserMode").as_deref() {
        Some("activeTab") | Some("active_tab") => lyra_agent_reader::BrowserMode::ActiveTab,
        Some("newTab") | Some("new_tab") => lyra_agent_reader::BrowserMode::NewTab,
        _ => lyra_agent_reader::BrowserMode::MatchingOrNewTab,
    };
    options.include_screenshot = value_bool(input, "includeScreenshot", false);
    options.viewport = viewport_from_input(input);
    options.mobile = value_bool(input, "mobile", false);
    options.include_iframes = value_bool(input, "includeIframes", false);
    options.include_shadow_dom = value_bool(input, "includeShadowDom", false);
    options.include_pageshot = value_bool(input, "includePageshot", false);
    let retain_media_requested = value_string(input, "retainMedia").is_some();
    options.include_media = value_bool(input, "includeMedia", retain_media_requested);
    options.retain_media = media_retention_from_input(input, options.include_media);
    options.include_debug_trace = value_bool(input, "includeDebugTrace", false);
    options
}

fn viewport_from_input(input: &Value) -> Option<lyra_agent_reader::BrowserViewport> {
    let value = input.get("viewport")?;
    if let Some(object) = value.as_object() {
        let width = object
            .get("width")
            .and_then(Value::as_u64)
            .map(|value| value.clamp(240, 5_000) as u32)?;
        let height = object
            .get("height")
            .and_then(Value::as_u64)
            .map(|value| value.clamp(240, 10_000) as u32)?;
        let device_scale_factor = object
            .get("deviceScaleFactor")
            .or_else(|| object.get("device_scale_factor"))
            .and_then(Value::as_f64)
            .map(|value| value.clamp(0.5, 4.0) as f32);
        return Some(lyra_agent_reader::BrowserViewport {
            width,
            height,
            device_scale_factor,
        });
    }
    None
}

fn apply_jina_aliases(input: &Value, options: &mut lyra_agent_reader::ReaderOptions) {
    for (name, value) in [
        ("X-Respond-With", "respondWith"),
        ("x-respond-with", "respondWith"),
        ("X-Target-Selector", "targetSelector"),
        ("x-target-selector", "targetSelector"),
        ("X-Remove-Selector", "removeSelector"),
        ("x-remove-selector", "removeSelector"),
        ("X-Wait-For-Selector", "waitForSelector"),
        ("x-wait-for-selector", "waitForSelector"),
        ("X-With-Generated-Alt", "withGeneratedAlt"),
        ("x-with-generated-alt", "withGeneratedAlt"),
        ("X-With-Links-Summary", "withLinksSummary"),
        ("x-with-links-summary", "withLinksSummary"),
        ("X-No-Cache", "noCache"),
        ("x-no-cache", "noCache"),
        ("X-Cache-Tolerance", "cacheTolerance"),
        ("x-cache-tolerance", "cacheTolerance"),
    ] {
        if input.get(name).is_none() {
            continue;
        }
        match value {
            "respondWith" => {
                if let Some(format) = value_string(input, name) {
                    options.output_format = match format.as_str() {
                        "text" => lyra_agent_reader::ReaderOutputFormat::Text,
                        "json" => lyra_agent_reader::ReaderOutputFormat::Json,
                        "chunks" => lyra_agent_reader::ReaderOutputFormat::Chunks,
                        "frontmatter+markdown" | "frontmatterMarkdown" => {
                            lyra_agent_reader::ReaderOutputFormat::FrontmatterMarkdown
                        }
                        _ => lyra_agent_reader::ReaderOutputFormat::Markdown,
                    };
                }
            }
            "targetSelector" => options.target_selector = value_string(input, name),
            "removeSelector" => {
                if let Some(selector) = value_string(input, name) {
                    options.remove_selectors.push(selector);
                }
            }
            "waitForSelector" => options.wait_for_selector = value_string(input, name),
            "withGeneratedAlt" => options.use_caption = value_bool(input, name, true),
            "withLinksSummary" => {
                if value_bool(input, name, true) {
                    options.retain_links = lyra_agent_reader::LinkRetention::Summary;
                }
            }
            "noCache" => {
                if value_bool(input, name, true) {
                    options.cache_policy = lyra_agent_reader::ReaderCachePolicy::NoStore;
                }
            }
            "cacheTolerance" => {
                if value_string(input, name).as_deref() != Some("0") {
                    options.cache_policy = lyra_agent_reader::ReaderCachePolicy::ReadWrite;
                }
            }
            _ => {}
        }
    }
}

fn browser_debug(input: &Value, engine_used: &str, browser_raw: &Value) -> Value {
    json!({
        "requestedEngine": value_string(input, "engine").unwrap_or_else(|| "auto".to_string()),
        "engineUsed": engine_used,
        "browserInvoked": !browser_raw.is_null(),
        "fallbackReason": browser_raw.get("debug").and_then(|debug| debug.get("fallbackReason")).cloned().unwrap_or(Value::Null),
    })
}

fn remove_selectors_from_input(input: &Value) -> Vec<String> {
    let Some(value) = input
        .get("removeSelector")
        .or_else(|| input.get("removeSelectors"))
    else {
        return Vec::new();
    };
    match value {
        Value::String(selector) if !selector.trim().is_empty() => {
            vec![selector.trim().to_string()]
        }
        Value::Array(values) => values
            .iter()
            .filter_map(Value::as_str)
            .map(str::trim)
            .filter(|selector| !selector.is_empty())
            .map(str::to_string)
            .collect(),
        _ => Vec::new(),
    }
}

fn string_array_from_input(input: &Value, key: &str) -> Vec<String> {
    match input.get(key) {
        Some(Value::String(value)) if !value.trim().is_empty() => {
            vec![value.trim().to_string()]
        }
        Some(Value::Array(values)) => values
            .iter()
            .filter_map(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .collect(),
        _ => Vec::new(),
    }
}

fn cache_policy_from_input(input: &Value) -> lyra_agent_reader::ReaderCachePolicy {
    if value_bool(input, "noCache", false) {
        return lyra_agent_reader::ReaderCachePolicy::NoStore;
    }
    match value_string(input, "cachePolicy").as_deref() {
        Some("noStore") | Some("no_store") | Some("none") => {
            lyra_agent_reader::ReaderCachePolicy::NoStore
        }
        Some("readWrite") | Some("read_write") => lyra_agent_reader::ReaderCachePolicy::ReadWrite,
        Some("cacheOnly") | Some("cache_only") => lyra_agent_reader::ReaderCachePolicy::CacheOnly,
        _ => lyra_agent_reader::ReaderCachePolicy::Auto,
    }
}

fn chunking_options_from_input(input: &Value) -> lyra_agent_reader::ChunkingOptions {
    let mut chunking = lyra_agent_reader::ChunkingOptions::default();
    let Some(value) = input.get("chunking") else {
        return chunking;
    };
    match value {
        Value::Bool(true) => chunking.mode = lyra_agent_reader::ChunkingMode::Block,
        Value::String(mode) => {
            chunking.mode = match mode.as_str() {
                "heading" | "headings" => lyra_agent_reader::ChunkingMode::Heading,
                "block" | "blocks" => lyra_agent_reader::ChunkingMode::Block,
                _ => lyra_agent_reader::ChunkingMode::Disabled,
            };
        }
        Value::Object(map) => {
            if let Some(mode) = map.get("mode").and_then(Value::as_str) {
                chunking.mode = match mode {
                    "heading" | "headings" => lyra_agent_reader::ChunkingMode::Heading,
                    "block" | "blocks" => lyra_agent_reader::ChunkingMode::Block,
                    _ => lyra_agent_reader::ChunkingMode::Disabled,
                };
            } else {
                chunking.mode = lyra_agent_reader::ChunkingMode::Block;
            }
            if let Some(max_chars) = map
                .get("maxCharsPerChunk")
                .or_else(|| map.get("maxChars"))
                .and_then(Value::as_u64)
            {
                chunking.max_chars_per_chunk = (max_chars as usize).max(1).min(100_000);
            }
            if let Some(overlap) = map.get("overlapChars").and_then(Value::as_u64) {
                chunking.overlap_chars = (overlap as usize).min(20_000);
            }
        }
        _ => {}
    }
    chunking
}

fn link_retention_from_input(input: &Value) -> lyra_agent_reader::LinkRetention {
    match value_string(input, "retainLinks").as_deref() {
        Some("text") => lyra_agent_reader::LinkRetention::Text,
        Some("citations") => lyra_agent_reader::LinkRetention::Citations,
        Some("summary") => lyra_agent_reader::LinkRetention::Summary,
        Some("none") => lyra_agent_reader::LinkRetention::None,
        _ => lyra_agent_reader::LinkRetention::All,
    }
}

fn image_retention_from_input(input: &Value) -> lyra_agent_reader::ImageRetention {
    match value_string(input, "retainImages").as_deref() {
        Some("alt") => lyra_agent_reader::ImageRetention::Alt,
        Some("summary") => lyra_agent_reader::ImageRetention::Summary,
        Some("none") => lyra_agent_reader::ImageRetention::None,
        _ => lyra_agent_reader::ImageRetention::All,
    }
}

fn media_retention_from_input(
    input: &Value,
    include_media: bool,
) -> lyra_agent_reader::MediaRetention {
    match value_string(input, "retainMedia").as_deref() {
        Some("link") | Some("links") => lyra_agent_reader::MediaRetention::Link,
        Some("text") => lyra_agent_reader::MediaRetention::Text,
        Some("summary") => lyra_agent_reader::MediaRetention::Summary,
        Some("html") => lyra_agent_reader::MediaRetention::Html,
        Some("none") => lyra_agent_reader::MediaRetention::None,
        _ if include_media => lyra_agent_reader::MediaRetention::Summary,
        _ => lyra_agent_reader::MediaRetention::None,
    }
}

fn heading_style_from_input(input: &Value) -> lyra_agent_reader::HeadingStyle {
    match value_string(input, "headingStyle").as_deref() {
        Some("setext") => lyra_agent_reader::HeadingStyle::Setext,
        _ => lyra_agent_reader::HeadingStyle::Atx,
    }
}

fn citation_format_from_input(input: &Value) -> lyra_agent_reader::CitationFormat {
    match value_string(input, "citationFormat").as_deref() {
        Some("angle") => lyra_agent_reader::CitationFormat::Angle,
        Some("source") => lyra_agent_reader::CitationFormat::Source,
        _ => lyra_agent_reader::CitationFormat::Square,
    }
}

fn preserve_html_tags_from_input(input: &Value) -> Vec<String> {
    let Some(value) = input.get("preserveHtmlTags") else {
        return Vec::new();
    };
    let raw_tags: Vec<&str> = match value {
        Value::String(tag) => vec![tag.as_str()],
        Value::Array(tags) => tags.iter().filter_map(Value::as_str).collect(),
        _ => Vec::new(),
    };
    raw_tags
        .into_iter()
        .map(str::trim)
        .filter(|tag| !tag.is_empty())
        .map(|tag| tag.to_ascii_lowercase())
        .collect()
}

struct RuntimeBrowserSnapshotProvider {
    dispatcher: Arc<HostCapabilityDispatcher>,
    turn_id: String,
    tool_call_id: String,
    last_raw: Mutex<Option<Value>>,
}

impl RuntimeBrowserSnapshotProvider {
    fn new(dispatcher: Arc<HostCapabilityDispatcher>, turn_id: &str, tool_call_id: &str) -> Self {
        Self {
            dispatcher,
            turn_id: turn_id.to_string(),
            tool_call_id: tool_call_id.to_string(),
            last_raw: Mutex::new(None),
        }
    }

    fn last_raw(&self) -> Option<Value> {
        self.last_raw.lock().ok().and_then(|value| value.clone())
    }
}

impl lyra_agent_reader::BrowserSnapshotProvider for RuntimeBrowserSnapshotProvider {
    fn snapshot(
        &self,
        request: &lyra_agent_reader::BrowserSnapshotRequest<'_>,
    ) -> Result<lyra_agent_reader::BrowserSnapshot, lyra_agent_reader::ReaderError> {
        let timeout_ms = request.timeout.as_millis().min(u128::from(u64::MAX)) as u64;
        let payload = json!({
            "url": request.url,
            "tabId": request.tab_id,
            "browserMode": browser_mode_label(request.browser_mode),
            "waitForSelector": request.wait_for_selector,
            "waitUntil": wait_until_label(request.wait_until),
            "waitText": request.wait_text,
            "timeoutMs": timeout_ms,
            "includeScreenshot": request.include_screenshot,
            "targetSelector": request.target_selector,
            "viewport": request.viewport.as_ref(),
            "mobile": request.mobile,
            "includeIframes": request.include_iframes,
            "includeShadowDom": request.include_shadow_dom,
            "includePageshot": request.include_pageshot,
            "includeMedia": request.include_media,
        });
        let mut raw = invoke_host_capability_with_timeout(
            self.dispatcher.clone(),
            "workbench.browser.readRenderedSnapshot".to_string(),
            payload,
            timeout_ms.saturating_add(5_000).clamp(1_000, 122_000),
        )
        .map_err(|message| lyra_agent_reader::ReaderError::Fetch {
            message,
            final_url: Some(request.url.to_string()),
            status: None,
        })?;
        if raw.get("ok").and_then(Value::as_bool) == Some(false) || raw.get("error").is_some() {
            return Err(lyra_agent_reader::ReaderError::Fetch {
                message: raw
                    .pointer("/error/message")
                    .and_then(Value::as_str)
                    .or_else(|| raw.get("message").and_then(Value::as_str))
                    .unwrap_or("browser snapshot failed")
                    .to_string(),
                final_url: raw
                    .get("finalUrl")
                    .and_then(Value::as_str)
                    .map(str::to_string)
                    .or_else(|| Some(request.url.to_string())),
                status: None,
            });
        }

        let screenshot_artifact = materialize_browser_snapshot_image(
            &self.turn_id,
            &self.tool_call_id,
            &mut raw,
            BrowserSnapshotImageKind::Screenshot,
        );
        let pageshot_artifact = materialize_browser_snapshot_image(
            &self.turn_id,
            &self.tool_call_id,
            &mut raw,
            BrowserSnapshotImageKind::Pageshot,
        );
        let screenshot_artifact_id = screenshot_artifact
            .as_ref()
            .and_then(|artifact| artifact.get("id"))
            .and_then(Value::as_str)
            .map(str::to_string);
        let pageshot_artifact_id = pageshot_artifact
            .as_ref()
            .and_then(|artifact| artifact.get("id"))
            .and_then(Value::as_str)
            .map(str::to_string);
        if let Some(artifact) = screenshot_artifact.as_ref() {
            if let Some(object) = raw.as_object_mut() {
                object.insert("screenshotArtifactRef".to_string(), artifact.clone());
            }
        }
        if let Some(artifact) = pageshot_artifact.as_ref() {
            if let Some(object) = raw.as_object_mut() {
                object.insert("pageshotArtifactRef".to_string(), artifact.clone());
            }
        }

        let final_url = raw
            .get("finalUrl")
            .or_else(|| raw.get("url"))
            .or_else(|| raw.get("address"))
            .and_then(Value::as_str)
            .unwrap_or(request.url)
            .to_string();
        let title = raw
            .get("title")
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .map(str::to_string);
        let body_text = raw
            .get("bodyText")
            .or_else(|| raw.get("text"))
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .map(str::to_string);
        let html = raw
            .get("html")
            .or_else(|| raw.get("outerHtml"))
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| fallback_html(title.as_deref(), body_text.as_deref()));
        let warnings = raw
            .get("warnings")
            .and_then(Value::as_array)
            .map(|warnings| warnings.iter().map(browser_warning_from_raw).collect())
            .unwrap_or_default();
        let mut artifacts = Vec::new();
        if let Some(id) = screenshot_artifact_id.as_ref() {
            artifacts.push(lyra_agent_reader::ReaderArtifact {
                id: Some(id.clone()),
                kind: "browser_screenshot".to_string(),
                mime_type: "image/png".to_string(),
            });
        }
        if let Some(id) = pageshot_artifact_id.as_ref() {
            artifacts.push(lyra_agent_reader::ReaderArtifact {
                id: Some(id.clone()),
                kind: "browser_pageshot".to_string(),
                mime_type: "image/png".to_string(),
            });
        }
        let viewport = raw_typed_field::<lyra_agent_reader::BrowserViewport>(&raw, "viewport");
        let selected_element =
            raw_typed_field::<lyra_agent_reader::BrowserSelectedElement>(&raw, "selectedElement");
        let frames = raw_typed_field::<Vec<lyra_agent_reader::BrowserFrameSummary>>(&raw, "frames")
            .unwrap_or_default();
        let shadow_roots = raw_typed_field::<Vec<lyra_agent_reader::BrowserShadowRootSummary>>(
            &raw,
            "shadowRoots",
        )
        .unwrap_or_default();
        let media = raw_typed_field::<Vec<lyra_agent_reader::ReaderMedia>>(&raw, "media")
            .unwrap_or_default();

        if let Ok(mut last_raw) = self.last_raw.lock() {
            *last_raw = Some(raw);
        }
        Ok(lyra_agent_reader::BrowserSnapshot {
            final_url,
            html,
            title,
            body_text,
            screenshot_artifact_ref: screenshot_artifact_id,
            pageshot_artifact_ref: pageshot_artifact_id,
            viewport,
            selected_element,
            frames,
            shadow_roots,
            media,
            artifacts,
            warnings,
        })
    }
}

fn raw_typed_field<T>(raw: &Value, field: &str) -> Option<T>
where
    T: serde::de::DeserializeOwned,
{
    raw.get(field)
        .cloned()
        .and_then(|value| serde_json::from_value(value).ok())
}

fn browser_mode_label(mode: lyra_agent_reader::BrowserMode) -> &'static str {
    match mode {
        lyra_agent_reader::BrowserMode::MatchingOrNewTab => "matchingOrNewTab",
        lyra_agent_reader::BrowserMode::ActiveTab => "activeTab",
        lyra_agent_reader::BrowserMode::NewTab => "newTab",
    }
}

fn wait_until_label(wait_until: lyra_agent_reader::BrowserWaitUntil) -> &'static str {
    match wait_until {
        lyra_agent_reader::BrowserWaitUntil::Html => "html",
        lyra_agent_reader::BrowserWaitUntil::LoadIdle => "loadIdle",
        lyra_agent_reader::BrowserWaitUntil::TextStable => "textStable",
        lyra_agent_reader::BrowserWaitUntil::TextChanged => "textChanged",
        lyra_agent_reader::BrowserWaitUntil::TextContains => "textContains",
    }
}

fn browser_warning_from_raw(value: &Value) -> lyra_agent_reader::ReaderWarning {
    let message = value
        .get("message")
        .and_then(Value::as_str)
        .or_else(|| value.as_str())
        .unwrap_or("browser snapshot warning")
        .to_string();
    lyra_agent_reader::ReaderWarning {
        code: lyra_agent_reader::WarningCode::BrowserRecommended,
        message,
    }
}

fn fallback_html(title: Option<&str>, body_text: Option<&str>) -> String {
    format!(
        "<html><head><title>{}</title></head><body><main>{}</main></body></html>",
        escape_html(title.unwrap_or("")),
        escape_html(body_text.unwrap_or(""))
    )
}

fn escape_html(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

#[derive(Clone, Copy)]
enum BrowserSnapshotImageKind {
    Screenshot,
    Pageshot,
}

fn materialize_browser_snapshot_image(
    turn_id: &str,
    tool_call_id: &str,
    raw: &mut Value,
    kind: BrowserSnapshotImageKind,
) -> Option<Value> {
    let (field, artifact_suffix) = match kind {
        BrowserSnapshotImageKind::Screenshot => ("screenshot", "browser-snapshot"),
        BrowserSnapshotImageKind::Pageshot => ("pageshot", "browser-pageshot"),
    };
    let image_data = raw
        .get(field)
        .and_then(|value| {
            value
                .get("imageBase64")
                .or_else(|| value.get("data"))
                .and_then(Value::as_str)
        })
        .or_else(|| {
            matches!(kind, BrowserSnapshotImageKind::Screenshot)
                .then(|| raw.get("imageBase64").and_then(Value::as_str))
                .flatten()
        })?
        .trim()
        .to_string();
    let image_data = image_data
        .strip_prefix("data:")
        .and_then(|data_url| data_url.split_once(',').map(|(_, data)| data.to_string()))
        .unwrap_or(image_data);
    let bytes = BASE64_STANDARD.decode(image_data).ok()?;
    if bytes.is_empty() {
        return None;
    }
    let media_type = raw
        .get(field)
        .and_then(|value| {
            value
                .get("mimeType")
                .or_else(|| value.get("mediaType"))
                .and_then(Value::as_str)
        })
        .or_else(|| {
            matches!(kind, BrowserSnapshotImageKind::Screenshot)
                .then(|| raw.get("mimeType").and_then(Value::as_str))
                .flatten()
        })
        .unwrap_or("image/png")
        .to_string();
    let extension = image_extension_for_media_type(&media_type);
    let artifact = write_tool_artifact_bytes_with_kind(
        "web",
        turn_id,
        &format!("{tool_call_id}-{artifact_suffix}"),
        ToolArtifactKind::BrowserScreenshot,
        extension,
        &media_type,
        &bytes,
    )?;
    redact_browser_snapshot_image(raw, kind);
    Some(artifact)
}

fn redact_browser_snapshot_image(raw: &mut Value, kind: BrowserSnapshotImageKind) {
    let field = match kind {
        BrowserSnapshotImageKind::Screenshot => "screenshot",
        BrowserSnapshotImageKind::Pageshot => "pageshot",
    };
    if let Some(object) = raw.as_object_mut() {
        if matches!(kind, BrowserSnapshotImageKind::Screenshot) {
            object.remove("imageBase64");
        }
        if let Some(image) = object.get_mut(field).and_then(Value::as_object_mut) {
            image.remove("imageBase64");
            image.remove("data");
        }
    }
}

fn reader_error_to_native_failure(
    url: &str,
    error: lyra_agent_reader::ReaderError,
) -> NativeToolFailure {
    let recommendation = error
        .recommended_next_action()
        .unwrap_or("Retry later or use a browser capability.");
    match error {
        lyra_agent_reader::ReaderError::AccessDenied {
            status,
            final_url,
            content_type,
        } => NativeToolFailure::new(
            "permission_denied",
            format!("remote server refused access with HTTP status {status}"),
            recommendation,
        )
        .with_detail(json!({
            "url": url,
            "finalUrl": final_url,
            "status": status,
            "contentType": content_type,
        })),
        lyra_agent_reader::ReaderError::UnsupportedFormat {
            format,
            mime,
            final_url,
        } => NativeToolFailure::new(
            "unsupported_content_type",
            format!("web_fetch cannot render this response yet: {format} ({mime})"),
            recommendation,
        )
        .with_detail(json!({
            "url": url,
            "finalUrl": final_url,
            "format": format,
            "mimeType": mime,
            "warnings": [{
                "code": "unsupported_format",
                "message": format!("unsupported format: {format} ({mime})")
            }],
        })),
        lyra_agent_reader::ReaderError::Fetch {
            message,
            final_url,
            status,
        } => NativeToolFailure::new("network_failed", message, recommendation).with_detail(json!({
            "url": url,
            "finalUrl": final_url,
            "status": status,
        })),
        lyra_agent_reader::ReaderError::Budget(message) => {
            NativeToolFailure::new("budget_exceeded", message, recommendation)
                .with_detail(json!({ "url": url }))
        }
        lyra_agent_reader::ReaderError::Parse(message) => {
            NativeToolFailure::new("parse_failed", message, recommendation)
                .with_detail(json!({ "url": url }))
        }
        lyra_agent_reader::ReaderError::Decode(message) => {
            NativeToolFailure::new("decode_failed", message, recommendation)
                .with_detail(json!({ "url": url }))
        }
        lyra_agent_reader::ReaderError::Io(message) => {
            NativeToolFailure::new("io_failed", message, recommendation)
                .with_detail(json!({ "url": url }))
        }
    }
}

pub(crate) fn tool_web_search(input: &Value) -> NativeToolResult {
    let query = required_value_string(input, "query")?;
    let limit = value_usize(input, "limit", 5, 20);
    let provider = value_string(input, "provider");
    let (status, results) = fetch_search_results(&query, limit, provider.as_deref())?;
    Ok(NativeToolSuccess {
        content: web_search_content(&query, &results),
        raw: json!({
            "query": query,
            "status": status,
            "results": results,
        }),
        recommended_next_action: results
            .is_empty()
            .then_some("Try web_fetch with a known official URL or refine the query.".to_string()),
    })
}

fn fetch_duckduckgo_search_results(
    query: &str,
    limit: usize,
) -> Result<(u16, Vec<Value>), NativeToolFailure> {
    let url = format!(
        "https://duckduckgo.com/html/?q={}",
        urlencoding::encode(&query)
    );
    let response = http_client_builder(Duration::from_secs(20))
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()
        .map_err(|error| {
            NativeToolFailure::new(
                "network_failed",
                format!("failed to create web client: {error}"),
                "Retry later or use web_fetch with a known URL.",
            )
        })?
        .get(url)
        .header("user-agent", "Lyra Agent/0.1")
        .send()
        .map_err(|error| {
            NativeToolFailure::new(
                "network_failed",
                format!("search request failed: {error}"),
                "Retry later or use web_fetch with a known URL.",
            )
        })?;
    let status = response.status().as_u16();
    let body = response.text().unwrap_or_default();
    Ok((status, parse_duckduckgo_results(&body, limit)))
}

fn fetch_search_results(
    query: &str,
    limit: usize,
    provider: Option<&str>,
) -> Result<(u16, Vec<Value>), NativeToolFailure> {
    let provider = provider
        .map(str::to_string)
        .or_else(|| std::env::var("LYRA_WEB_SEARCH_PROVIDER").ok())
        .unwrap_or_else(|| "duckduckgo".to_string())
        .to_ascii_lowercase();
    match provider.as_str() {
        "searxng" | "searx" => fetch_json_search_results(
            "searxng",
            &required_env("LYRA_SEARXNG_URL", "SearXNG")?,
            query,
            limit,
            None,
        ),
        "brave" => fetch_json_search_results(
            "brave",
            "https://api.search.brave.com/res/v1/web/search",
            query,
            limit,
            Some((
                "X-Subscription-Token",
                required_env("BRAVE_API_KEY", "Brave Search")?,
            )),
        ),
        "serpapi" => fetch_json_search_results(
            "serpapi",
            "https://serpapi.com/search.json",
            query,
            limit,
            Some(("X-API-Key", required_env("SERPAPI_API_KEY", "SerpAPI")?)),
        ),
        "tavily" => fetch_json_search_results(
            "tavily",
            "https://api.tavily.com/search",
            query,
            limit,
            Some((
                "Authorization",
                format!("Bearer {}", required_env("TAVILY_API_KEY", "Tavily")?),
            )),
        ),
        "exa" => fetch_json_search_results(
            "exa",
            "https://api.exa.ai/search",
            query,
            limit,
            Some(("x-api-key", required_env("EXA_API_KEY", "Exa")?)),
        ),
        _ => fetch_duckduckgo_search_results(query, limit),
    }
}

fn required_env(name: &str, provider: &str) -> Result<String, NativeToolFailure> {
    std::env::var(name)
        .ok()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| {
            NativeToolFailure::new(
                "search_provider_unconfigured",
                format!("{provider} search requires {name}"),
                "Set the provider API key/base URL or use provider=duckduckgo.",
            )
        })
}

fn fetch_json_search_results(
    provider: &str,
    endpoint: &str,
    query: &str,
    limit: usize,
    header: Option<(&str, String)>,
) -> Result<(u16, Vec<Value>), NativeToolFailure> {
    let client = http_client_builder(Duration::from_secs(20))
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()
        .map_err(|error| {
            NativeToolFailure::new(
                "network_failed",
                format!("failed to create web client: {error}"),
                "Retry later or use web_fetch with a known URL.",
            )
        })?;
    let mut request = match provider {
        "tavily" => client
            .post(endpoint)
            .json(&json!({ "query": query, "max_results": limit })),
        "exa" => client
            .post(endpoint)
            .json(&json!({ "query": query, "num_results": limit })),
        "serpapi" => client
            .get(endpoint)
            .query(&[("q", query), ("num", &limit.to_string())]),
        "searxng" => {
            client
                .get(endpoint)
                .query(&[("q", query), ("format", "json"), ("language", "auto")])
        }
        _ => client
            .get(endpoint)
            .query(&[("q", query), ("count", &limit.to_string())]),
    };
    if let Some((name, value)) = header {
        request = request.header(name, value);
    }
    let response = request.send().map_err(|error| {
        NativeToolFailure::new(
            "network_failed",
            format!("{provider} search request failed: {error}"),
            "Retry later or use provider=duckduckgo.",
        )
    })?;
    let status = response.status().as_u16();
    let json_value = response.json::<Value>().unwrap_or(Value::Null);
    Ok((status, normalize_search_json(provider, &json_value, limit)))
}

fn normalize_search_json(provider: &str, value: &Value, limit: usize) -> Vec<Value> {
    let candidates = value
        .get("results")
        .or_else(|| value.pointer("/web/results"))
        .or_else(|| value.get("organic_results"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    candidates
        .into_iter()
        .take(limit)
        .filter_map(|item| {
            let title = item
                .get("title")
                .or_else(|| item.get("name"))
                .and_then(Value::as_str)?
                .to_string();
            let url = item
                .get("url")
                .or_else(|| item.get("link"))
                .and_then(Value::as_str)?
                .to_string();
            let snippet = item
                .get("snippet")
                .or_else(|| item.get("content"))
                .or_else(|| item.get("description"))
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            Some(json!({
                "title": title,
                "url": url,
                "snippet": snippet,
                "source": provider,
                "confidence": item.get("score").and_then(Value::as_f64).unwrap_or(0.75),
            }))
        })
        .collect()
}

fn web_search_content(query: &str, results: &[Value]) -> String {
    if results.is_empty() {
        return format!("No structured search results parsed for query: {query}");
    }
    results
        .iter()
        .filter_map(|result| {
            Some(format!(
                "{}\n{}\n{}",
                result.get("title")?.as_str()?,
                result.get("url")?.as_str()?,
                result.get("snippet").and_then(Value::as_str).unwrap_or("")
            ))
        })
        .collect::<Vec<_>>()
        .join("\n\n")
}

pub(crate) fn tool_web_research(
    session_id: &str,
    turn_id: &str,
    input: &Value,
) -> NativeToolResult {
    let query = required_value_string(input, "query")?;
    let limit = value_usize(input, "limit", 5, 20);
    let read_top_n = value_usize(input, "readTopN", 3, 5).min(limit);
    let max_chars_per_result = value_usize(input, "maxCharsPerResult", 4_000, 20_000);
    let include_failed_reads = value_bool(input, "includeFailedReads", true);
    let index_results = value_bool(input, "indexResult", true);
    let provider = value_string(input, "provider");
    let (status, results) = fetch_search_results(&query, limit, provider.as_deref())?;
    Ok(build_web_research_result_for_session(
        session_id,
        turn_id,
        &query,
        status,
        results,
        read_top_n,
        max_chars_per_result,
        include_failed_reads,
        index_results,
        false,
    ))
}

pub(crate) fn build_web_research_result(
    query: &str,
    status: u16,
    results: Vec<Value>,
    read_top_n: usize,
    max_chars_per_result: usize,
    include_failed_reads: bool,
) -> NativeToolSuccess {
    build_web_research_result_for_session(
        "web-research-session",
        "web-research-turn",
        query,
        status,
        results,
        read_top_n,
        max_chars_per_result,
        include_failed_reads,
        false,
        true,
    )
}

pub(crate) fn build_web_research_result_for_session(
    session_id: &str,
    turn_id: &str,
    query: &str,
    status: u16,
    results: Vec<Value>,
    read_top_n: usize,
    max_chars_per_result: usize,
    include_failed_reads: bool,
    index_results: bool,
    allow_private_network: bool,
) -> NativeToolSuccess {
    let provider = lyra_agent_reader::ReqwestFetchProvider::new();
    let mut read_results = Vec::new();
    let mut failed_reads = Vec::new();
    let mut sources = Vec::<String>::new();

    for result in results.iter().take(read_top_n) {
        let Some(url) = result.get("url").and_then(Value::as_str) else {
            continue;
        };
        push_unique_source(&mut sources, url);
        let source_id = source_id_for_url(&sources, url);
        let request = lyra_agent_reader::ReaderRequest {
            input: lyra_agent_reader::ReaderInput::Url(url.to_string()),
            options: lyra_agent_reader::ReaderOptions {
                query_focus: Some(query.to_string()),
                content_filter: lyra_agent_reader::ContentFilterMode::Hybrid,
                chunking: lyra_agent_reader::ChunkingOptions {
                    mode: lyra_agent_reader::ChunkingMode::Block,
                    max_chars_per_chunk: max_chars_per_result,
                    ..lyra_agent_reader::ChunkingOptions::default()
                },
                max_chars: Some(max_chars_per_result),
                retain_links: lyra_agent_reader::LinkRetention::Summary,
                retain_images: lyra_agent_reader::ImageRetention::Summary,
                allow_private_network,
                ..lyra_agent_reader::ReaderOptions::default()
            },
        };
        match lyra_agent_reader::read(&request, &provider) {
            Ok(reader) => {
                let summary = research_summary_from_reader(&reader);
                let index_result = if index_results {
                    index_reader_result(session_id, turn_id, &reader)
                } else {
                    json!({ "skipped": true })
                };
                read_results.push(json!({
                    "searchResult": result,
                    "sourceId": source_id,
                    "url": url,
                    "finalUrl": reader.final_url,
                    "status": reader.status,
                    "title": reader.metadata.title.or(reader.frontmatter.title),
                    "format": reader.format,
                    "mimeType": reader.mime_type,
                    "fitMarkdown": reader.fit_markdown,
                    "compactText": reader.compact_text,
                    "fetchedMarkdownExcerpt": summary.clone(),
                    "summary": summary,
                    "warnings": reader.warnings,
                    "timing": reader.timing,
                    "recommendedNextAction": reader.recommended_next_action,
                    "indexResult": index_result,
                }));
            }
            Err(error) => {
                let failure = reader_error_to_native_failure(url, error);
                failed_reads.push(json!({
                    "sourceId": source_id,
                    "url": url,
                    "code": failure.code,
                    "message": failure.message,
                    "recommendedNextAction": failure.recommended_next_action,
                    "detail": failure.detail,
                }));
            }
        }
    }

    for result in &results {
        if let Some(url) = result.get("url").and_then(Value::as_str) {
            push_unique_source(&mut sources, url);
        }
    }

    let content = web_research_content(query, &results, &read_results, &failed_reads, &sources);
    let recommended_next_action = if results.is_empty() {
        Some("Refine the query or try web_fetch with a known URL.".to_string())
    } else if !failed_reads.is_empty() {
        Some(
            "Use web_fetch on failed URLs individually, or use a browser path for blocked/rendered pages."
                .to_string(),
        )
    } else {
        None
    };

    let full_raw = json!({
        "query": query,
        "status": status,
        "results": results,
        "readTopN": read_top_n,
        "readResults": read_results,
        "failedReads": if include_failed_reads { failed_reads.clone() } else { Vec::<Value>::new() },
        "sources": sources,
    });
    let raw = web_research_raw_summary(session_id, turn_id, query, &full_raw);

    NativeToolSuccess {
        content,
        raw,
        recommended_next_action,
    }
}

fn web_research_raw_summary(
    session_id: &str,
    turn_id: &str,
    query: &str,
    full_raw: &Value,
) -> Value {
    let raw_text = serde_json::to_string_pretty(full_raw)
        .or_else(|_| serde_json::to_string(full_raw))
        .unwrap_or_else(|_| "null".to_string());
    let original_raw_chars = raw_text.chars().count();
    let raw_artifact_ref = write_tool_artifact_with_kind(
        session_id,
        turn_id,
        "web-research-raw",
        ToolArtifactKind::RawData,
        &raw_text,
    );
    let results = full_raw
        .get("results")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let read_results = full_raw
        .get("readResults")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let failed_reads = full_raw
        .get("failedReads")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    json!({
        "kind": "web_research_summary",
        "retention": {
            "policy": "artifact_only_raw",
            "reason": "full web_research raw is stored as an artifact; session/model context keeps compact result summaries",
            "originalRawChars": original_raw_chars,
        },
        "rawArtifactRef": raw_artifact_ref,
        "query": query,
        "status": full_raw.get("status").cloned().unwrap_or(Value::Null),
        "readTopN": full_raw.get("readTopN").cloned().unwrap_or(Value::Null),
        "resultCount": results.len(),
        "readResultCount": read_results.len(),
        "failedReadCount": failed_reads.len(),
        "results": results.iter().take(10).map(compact_search_result).collect::<Vec<_>>(),
        "readResults": read_results.iter().take(5).map(compact_research_read_result).collect::<Vec<_>>(),
        "failedReads": failed_reads.iter().take(10).cloned().collect::<Vec<_>>(),
        "sources": full_raw.get("sources").cloned().unwrap_or_else(|| Value::Array(Vec::new())),
    })
}

fn compact_search_result(result: &Value) -> Value {
    json!({
        "title": result.get("title").cloned().unwrap_or(Value::Null),
        "url": result.get("url").cloned().unwrap_or(Value::Null),
        "snippet": result.get("snippet").and_then(Value::as_str).map(|text| truncate_summary_string(text, 800)).unwrap_or_default(),
        "source": result.get("source").cloned().unwrap_or(Value::Null),
    })
}

fn compact_research_read_result(result: &Value) -> Value {
    json!({
        "sourceId": result.get("sourceId").cloned().unwrap_or(Value::Null),
        "url": result.get("url").cloned().unwrap_or(Value::Null),
        "finalUrl": result.get("finalUrl").cloned().unwrap_or(Value::Null),
        "status": result.get("status").cloned().unwrap_or(Value::Null),
        "title": result.get("title").cloned().unwrap_or(Value::Null),
        "format": result.get("format").cloned().unwrap_or(Value::Null),
        "mimeType": result.get("mimeType").cloned().unwrap_or(Value::Null),
        "fitMarkdown": result.get("fitMarkdown").and_then(Value::as_str).map(|text| truncate_summary_string(text, 1_200)).unwrap_or_default(),
        "summary": result.get("summary").and_then(Value::as_str).map(|text| truncate_summary_string(text, 1_200)).unwrap_or_default(),
        "warnings": result.get("warnings").cloned().unwrap_or_else(|| Value::Array(Vec::new())),
        "timing": result.get("timing").cloned().unwrap_or(Value::Null),
        "recommendedNextAction": result.get("recommendedNextAction").cloned().unwrap_or(Value::Null),
        "indexResult": result.get("indexResult").cloned().unwrap_or(Value::Null),
    })
}

fn research_summary_from_reader(reader: &lyra_agent_reader::ReaderResult) -> String {
    if !reader.fit_markdown.trim().is_empty() {
        return reader.fit_markdown.trim().to_string();
    }
    compact_body_without_header(&reader.compact_text)
}

fn compact_body_without_header(compact_text: &str) -> String {
    compact_text
        .split_once("\n\n")
        .map(|(_, body)| body.trim().to_string())
        .unwrap_or_else(|| compact_text.trim().to_string())
}

fn web_research_content(
    query: &str,
    results: &[Value],
    read_results: &[Value],
    failed_reads: &[Value],
    sources: &[String],
) -> String {
    let mut out = format!("Research: {query}");
    if results.is_empty() {
        out.push_str("\n\nNo structured search results parsed.");
        return out;
    }

    out.push_str("\n\n## Search Results\n");
    for (index, result) in results.iter().enumerate() {
        let title = result.get("title").and_then(Value::as_str).unwrap_or("");
        let url = result.get("url").and_then(Value::as_str).unwrap_or("");
        let snippet = result.get("snippet").and_then(Value::as_str).unwrap_or("");
        let source_id = source_id_for_url(sources, url);
        out.push_str(&format!(
            "\n{}. [{source_id}] {title}\n{url}\n{snippet}\n",
            index + 1
        ));
    }

    if !read_results.is_empty() {
        out.push_str("\n## Deep Reads\n");
        for (index, result) in read_results.iter().enumerate() {
            let title = result.get("title").and_then(Value::as_str).unwrap_or("");
            let url = result.get("url").and_then(Value::as_str).unwrap_or("");
            let summary = result.get("summary").and_then(Value::as_str).unwrap_or("");
            let source_id = result
                .get("sourceId")
                .and_then(Value::as_str)
                .map(str::to_string)
                .unwrap_or_else(|| source_id_for_url(sources, url));
            out.push_str(&format!(
                "\n### {}. [{source_id}] {title}\n{url}\n\n{summary}\n",
                index + 1
            ));
        }
    }

    if !failed_reads.is_empty() {
        out.push_str("\n## Failed Reads\n");
        for failure in failed_reads {
            let url = failure.get("url").and_then(Value::as_str).unwrap_or("");
            let source_id = failure
                .get("sourceId")
                .and_then(Value::as_str)
                .map(str::to_string)
                .unwrap_or_else(|| source_id_for_url(sources, url));
            let code = failure.get("code").and_then(Value::as_str).unwrap_or("");
            let message = failure.get("message").and_then(Value::as_str).unwrap_or("");
            out.push_str(&format!("\n- [{source_id}] {url}: {code} - {message}\n"));
        }
    }

    if !sources.is_empty() {
        out.push_str("\n## Sources\n");
        for (index, source) in sources.iter().enumerate() {
            out.push_str(&format!("\nS{}. {source}", index + 1));
        }
    }
    out
}

fn source_id_for_url(sources: &[String], url: &str) -> String {
    sources
        .iter()
        .position(|source| source == url)
        .map(|index| format!("S{}", index + 1))
        .unwrap_or_else(|| "S?".to_string())
}

fn push_unique_source(sources: &mut Vec<String>, url: &str) {
    if !sources.iter().any(|source| source == url) {
        sources.push(url.to_string());
    }
}

fn index_reader_result(
    session_id: &str,
    turn_id: &str,
    reader: &lyra_agent_reader::ReaderResult,
) -> Value {
    let Some(root) = state().lock().ok().map(|state| state.root.clone()) else {
        return json!({
            "indexed": 0,
            "error": "runtime state lock unavailable",
        });
    };
    match super::super::memory_store::index_reader_result_for_recall(
        &root, session_id, turn_id, reader,
    ) {
        Ok(value) => value,
        Err(error) => json!({
            "indexed": 0,
            "error": error.to_string(),
        }),
    }
}

pub(crate) fn tool_network_status() -> NativeToolResult {
    let status = network_runtime_context();
    Ok(NativeToolSuccess {
        content: network_status_summary(&status),
        raw: status,
        recommended_next_action: Some(
            "If native network calls fail while browser navigation works, use browser-backed search/open/read tools and inspect proxy settings."
                .to_string(),
        ),
    })
}

pub(crate) fn strip_html_tags(html: &str) -> String {
    let mut text = String::new();
    let mut in_tag = false;
    for character in html.chars() {
        match character {
            '<' => in_tag = true,
            '>' => {
                in_tag = false;
                text.push(' ');
            }
            _ if !in_tag => text.push(character),
            _ => {}
        }
    }
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

pub(crate) fn parse_duckduckgo_results(html: &str, limit: usize) -> Vec<Value> {
    let mut results = Vec::new();
    let mut rest = html;
    while results.len() < limit {
        let Some(index) = rest.find("class=\"result__a\"") else {
            break;
        };
        let before = &rest[..index];
        let href_start = before.rfind("href=\"").map(|value| value + 6);
        let Some(href_start) = href_start else {
            rest = &rest[index + 1..];
            continue;
        };
        let href_end = before[href_start..]
            .find('"')
            .map(|value| value + href_start)
            .unwrap_or(before.len());
        let url = html_unescape(&before[href_start..href_end]);
        let after = &rest[index..];
        let title_start = after.find('>').map(|value| value + 1).unwrap_or(0);
        let title_end = after[title_start..]
            .find("</a>")
            .map(|value| value + title_start)
            .unwrap_or(title_start);
        let title = strip_html_tags(&after[title_start..title_end]);
        let snippet = after
            .find("class=\"result__snippet\"")
            .and_then(|snippet_index| {
                let snippet_after = &after[snippet_index..];
                let start = snippet_after.find('>')? + 1;
                let end = snippet_after[start..].find("</")? + start;
                Some(strip_html_tags(&snippet_after[start..end]))
            })
            .unwrap_or_default();
        if !url.is_empty() && !title.is_empty() {
            results.push(json!({
                "title": title,
                "url": url,
                "snippet": snippet,
                "source": "duckduckgo",
                "confidence": 0.7,
            }));
        }
        rest = &after[title_end.min(after.len())..];
    }
    results
}

pub(crate) fn html_unescape(value: &str) -> String {
    value
        .replace("&amp;", "&")
        .replace("&quot;", "\"")
        .replace("&#x2F;", "/")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
}
