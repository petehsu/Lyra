use super::*;

pub(crate) fn tool_web_fetch(turn_id: &str, tool_call_id: &str, input: &Value) -> NativeToolResult {
    let url = required_value_string(input, "url")?;
    let max_chars = value_usize(input, "maxChars", 12_000, 100_000);
    let extract_text = value_bool(input, "extractText", true);
    let include_links = value_bool(input, "includeLinks", true);
    let parsed_url = Url::parse(&url).map_err(|error| {
        NativeToolFailure::new(
            "bad_url",
            format!("invalid URL: {error}"),
            "Retry with an absolute http or https URL.",
        )
    })?;
    if !matches!(parsed_url.scheme(), "http" | "https") {
        return Err(NativeToolFailure::new(
            "unsupported_url_scheme",
            "web_fetch only supports http and https URLs",
            "Retry with an http or https URL.",
        ));
    }
    let response = http_client_builder(Duration::from_secs(20))
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()
        .map_err(|error| {
            NativeToolFailure::new(
                "network_failed",
                format!("failed to create web client: {error}"),
                "Retry later or use a browser capability.",
            )
        })?
        .get(parsed_url.clone())
        .header("user-agent", "Lyra Agent/0.1")
        .send()
        .map_err(|error| {
            NativeToolFailure::new(
                "network_failed",
                format!("request failed: {error}"),
                "Retry later or use a browser capability.",
            )
        })?;
    let status = response.status().as_u16();
    let final_url = response.url().to_string();
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("")
        .to_string();
    if matches!(status, 401 | 403 | 451) {
        return Err(NativeToolFailure::new(
            "permission_denied",
            format!("remote server refused access with HTTP status {status}"),
            "Use a browser session, provide authorized access, or choose another public source.",
        )
        .with_detail(json!({
            "url": url,
            "finalUrl": final_url,
            "status": status,
            "contentType": content_type,
        })));
    }
    if !is_textual_content_type(&content_type) {
        return Err(NativeToolFailure::new(
            "unsupported_content_type",
            format!(
                "web_fetch received a non-text response: {}",
                if content_type.is_empty() {
                    "unknown content type"
                } else {
                    content_type.as_str()
                }
            ),
            "Open the URL in a browser/workbench viewer or fetch a text/HTML endpoint.",
        )
        .with_detail(json!({
            "url": url,
            "finalUrl": final_url,
            "status": status,
            "contentType": content_type,
        })));
    }
    let body = response.text().map_err(|error| {
        NativeToolFailure::new(
            "network_failed",
            format!("failed to read response body: {error}"),
            "Retry later or use a browser capability.",
        )
    })?;
    let title = extract_html_title(&body);
    let links = if include_links {
        extract_html_links(&final_url, &body)
    } else {
        Vec::new()
    };
    let mut text = if extract_text && content_type.contains("html") {
        strip_html_tags(&body)
    } else {
        body.clone()
    };
    let full_text = text.clone();
    let truncated = text.chars().count() > max_chars;
    if truncated {
        text = truncate_chars(&text, max_chars);
    }
    let artifact_ref = if truncated {
        write_tool_artifact("web", turn_id, tool_call_id, &full_text)
    } else {
        None
    };
    Ok(NativeToolSuccess {
        content: format!(
            "Fetched {final_url}\nstatus: {status}\ntitle: {}\n\n{}",
            title.clone().unwrap_or_default(),
            text
        ),
        raw: json!({
            "url": url,
            "finalUrl": final_url,
            "status": status,
            "contentType": content_type,
            "title": title,
            "text": text,
            "links": links,
            "truncated": truncated,
            "artifactRef": artifact_ref,
        }),
        recommended_next_action: truncated.then_some(
            "Fetch again with a narrower page target or inspect the artifact reference."
                .to_string(),
        ),
    })
}

pub(crate) fn tool_web_search(input: &Value) -> NativeToolResult {
    let query = required_value_string(input, "query")?;
    let limit = value_usize(input, "limit", 5, 20);
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
    let results = parse_duckduckgo_results(&body, limit);
    Ok(NativeToolSuccess {
        content: if results.is_empty() {
            format!("No structured search results parsed for query: {query}")
        } else {
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
        },
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

pub(crate) fn extract_html_title(html: &str) -> Option<String> {
    let lower = html.to_lowercase();
    let start = lower.find("<title")?;
    let after_start = lower[start..].find('>')? + start + 1;
    let end = lower[after_start..].find("</title>")? + after_start;
    Some(html[after_start..end].trim().to_string())
}

pub(crate) fn extract_html_links(base_url: &str, html: &str) -> Vec<Value> {
    let base = Url::parse(base_url).ok();
    let mut links = Vec::new();
    for marker in ["href=\"", "href='"] {
        let quote = marker.chars().last().unwrap_or('"');
        let mut rest = html;
        while let Some(index) = rest.find(marker) {
            let after = &rest[index + marker.len()..];
            let Some(end) = after.find(quote) else {
                break;
            };
            let raw = &after[..end];
            let resolved = base
                .as_ref()
                .and_then(|base| base.join(raw).ok())
                .map(|url| url.to_string())
                .unwrap_or_else(|| raw.to_string());
            if resolved.starts_with("http") {
                links.push(json!({ "url": resolved }));
            }
            if links.len() >= 100 {
                return links;
            }
            rest = &after[end + 1..];
        }
    }
    links
}

pub(crate) fn is_textual_content_type(content_type: &str) -> bool {
    let content_type = content_type
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase();
    content_type.is_empty()
        || content_type.starts_with("text/")
        || matches!(
            content_type.as_str(),
            "application/json"
                | "application/ld+json"
                | "application/xml"
                | "application/xhtml+xml"
                | "application/javascript"
                | "application/x-www-form-urlencoded"
        )
        || content_type.ends_with("+json")
        || content_type.ends_with("+xml")
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
