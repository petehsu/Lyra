use super::*;

pub(crate) const PAGE_CITATION_PREVIEW_CHARS: usize = 32;
pub(crate) const PAGE_CITATION_QUOTED_CHARS: usize = 480;

pub(crate) fn parse_page_citations(payload: &Value) -> Vec<Value> {
    payload
        .get("pageCitations")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .filter_map(normalize_page_citation)
        .collect()
}

pub(crate) fn apply_page_citations_to_user_message(user_message: &mut Value, citations: &[Value]) {
    if citations.is_empty() {
        return;
    }
    let metadata = user_message
        .get_mut("metadata")
        .and_then(Value::as_object_mut);
    let metadata = match metadata {
        Some(object) => object,
        None => {
            user_message["metadata"] = json!({});
            user_message
                .get_mut("metadata")
                .and_then(Value::as_object_mut)
                .expect("metadata object")
        }
    };
    metadata.insert("pageCitations".to_string(), json!(citations));
}

pub(crate) fn expand_page_cite_markers(
    text: &str,
    citations: &[Value],
    mode: PageCiteMarkerMode,
) -> String {
    let preview_by_id = citations
        .iter()
        .filter_map(|citation| {
            let id = citation.get("id").and_then(Value::as_str)?;
            let preview = citation
                .get("preview")
                .and_then(Value::as_str)
                .filter(|value| !value.is_empty())
                .or_else(|| citation.get("pageTitle").and_then(Value::as_str))
                .or_else(|| citation.get("tabTitle").and_then(Value::as_str))
                .unwrap_or("Page");
            Some((id, preview))
        })
        .collect::<std::collections::HashMap<_, _>>();
    let mut output = String::new();
    let mut rest = text;
    while let Some(start) = rest.find('⟦') {
        let Some(end_rel) = rest[start..].find('⟧') else {
            output.push_str(rest);
            rest = "";
            break;
        };
        output.push_str(&rest[..start]);
        let inner = &rest[start + '⟦'.len_utf8()..start + end_rel];
        let replacement = match inner.split_once(':') {
            Some(("page-cite", id)) => match mode {
                PageCiteMarkerMode::Title => {
                    preview_by_id.get(id).copied().unwrap_or("Page").to_string()
                }
                PageCiteMarkerMode::ModelUserText => String::new(),
            },
            Some((_, _)) if matches!(mode, PageCiteMarkerMode::Title) => String::new(),
            _ => rest[start..start + end_rel + '⟧'.len_utf8()].to_string(),
        };
        if !replacement.is_empty()
            && output
                .chars()
                .last()
                .is_some_and(|character| !character.is_whitespace())
        {
            output.push(' ');
        }
        output.push_str(&replacement);
        rest = &rest[start + end_rel + '⟧'.len_utf8()..];
        if !replacement.is_empty()
            && rest
                .chars()
                .next()
                .is_some_and(|character| !character.is_whitespace())
        {
            output.push(' ');
        }
    }
    output.push_str(rest);
    output.split_whitespace().collect::<Vec<_>>().join(" ")
}

#[derive(Clone, Copy)]
pub(crate) enum PageCiteMarkerMode {
    Title,
    ModelUserText,
}

fn normalize_page_citation(raw: Value) -> Option<Value> {
    let tab_id = raw.get("tabId").and_then(Value::as_str)?;
    let page_url = raw.get("pageUrl").and_then(Value::as_str)?;
    let id = raw
        .get("id")
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| format!("page-cite-{}", Uuid::new_v4()));
    let excerpt_kind = raw
        .get("excerptKind")
        .and_then(Value::as_str)
        .filter(|value| matches!(*value, "selection" | "link" | "page"))
        .unwrap_or("page");
    let quoted_text = raw
        .get("quotedText")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let (quoted_text, truncated, preview) = truncate_page_quoted_text(&quoted_text);
    Some(json!({
        "id": id,
        "tabId": tab_id,
        "tabTitle": raw.get("tabTitle").and_then(Value::as_str).unwrap_or(""),
        "pageUrl": page_url,
        "pageTitle": raw.get("pageTitle").and_then(Value::as_str).unwrap_or(page_url),
        "frameUrl": raw.get("frameUrl").cloned().unwrap_or(Value::Null),
        "linkUrl": raw.get("linkUrl").cloned().unwrap_or(Value::Null),
        "linkText": raw.get("linkText").cloned().unwrap_or(Value::Null),
        "srcUrl": raw.get("srcUrl").cloned().unwrap_or(Value::Null),
        "mediaType": raw.get("mediaType").cloned().unwrap_or(Value::Null),
        "elementTag": raw.get("elementTag").cloned().unwrap_or(Value::Null),
        "elementSelector": raw.get("elementSelector").cloned().unwrap_or(Value::Null),
        "elementId": raw.get("elementId").cloned().unwrap_or(Value::Null),
        "elementRole": raw.get("elementRole").cloned().unwrap_or(Value::Null),
        "elementAriaLabel": raw.get("elementAriaLabel").cloned().unwrap_or(Value::Null),
        "excerptKind": excerpt_kind,
        "preview": raw.get("preview").and_then(Value::as_str).unwrap_or(&preview),
        "quotedText": quoted_text,
        "truncated": raw.get("truncated").and_then(Value::as_bool).unwrap_or(truncated),
        "sourceCapturedAt": raw.get("sourceCapturedAt").cloned().unwrap_or(Value::Null),
        "sourceKind": raw.get("sourceKind").cloned().unwrap_or(Value::Null),
        "captureFidelity": raw.get("captureFidelity").cloned().unwrap_or(Value::Null),
        "tabPageKind": raw.get("tabPageKind").cloned().unwrap_or(Value::Null),
        "faviconUrl": raw.get("faviconUrl").cloned().unwrap_or(Value::Null),
        "appId": raw.get("appId").cloned().unwrap_or(Value::Null),
        "appIconKey": raw.get("appIconKey").cloned().unwrap_or(Value::Null),
    }))
}

fn truncate_page_quoted_text(text: &str) -> (String, bool, String) {
    let chars: Vec<char> = text.chars().collect();
    let truncated = chars.len() > PAGE_CITATION_QUOTED_CHARS;
    let quoted: String = chars.iter().take(PAGE_CITATION_QUOTED_CHARS).collect();
    let preview: String = chars.iter().take(PAGE_CITATION_PREVIEW_CHARS).collect();
    let preview = if chars.len() > PAGE_CITATION_PREVIEW_CHARS {
        format!("{preview}…")
    } else {
        preview
    };
    (quoted, truncated, preview)
}

pub(crate) fn format_page_cite_xml(citation: &Value) -> Option<String> {
    let id = citation.get("id").and_then(Value::as_str)?;
    let tab_id = citation.get("tabId").and_then(Value::as_str)?;
    let tab_title = citation
        .get("tabTitle")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let page_url = citation.get("pageUrl").and_then(Value::as_str)?;
    let page_title = citation
        .get("pageTitle")
        .and_then(Value::as_str)
        .unwrap_or(page_url);
    let excerpt_kind = citation
        .get("excerptKind")
        .and_then(Value::as_str)
        .unwrap_or("page");
    let truncated = citation
        .get("truncated")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let link_url = citation
        .get("linkUrl")
        .and_then(Value::as_str)
        .map(|value| format!(" linkUrl=\"{value}\""))
        .unwrap_or_default();
    let link_text = citation
        .get("linkText")
        .and_then(Value::as_str)
        .map(|value| format!(" linkText=\"{value}\""))
        .unwrap_or_default();
    let src_url = citation
        .get("srcUrl")
        .and_then(Value::as_str)
        .map(|value| format!(" srcUrl=\"{value}\""))
        .unwrap_or_default();
    let element_selector = citation
        .get("elementSelector")
        .and_then(Value::as_str)
        .map(|value| format!(" elementSelector=\"{value}\""))
        .unwrap_or_default();
    let element_tag = citation
        .get("elementTag")
        .and_then(Value::as_str)
        .map(|value| format!(" elementTag=\"{value}\""))
        .unwrap_or_default();
    let source_kind = citation
        .get("sourceKind")
        .and_then(Value::as_str)
        .map(|value| format!(" sourceKind=\"{value}\""))
        .unwrap_or_default();
    let capture_fidelity = citation
        .get("captureFidelity")
        .and_then(Value::as_str)
        .map(|value| format!(" captureFidelity=\"{value}\""))
        .unwrap_or_default();
    let quoted = citation
        .get("quotedText")
        .and_then(Value::as_str)
        .unwrap_or_default();
    Some(format!(
        "<lyra-page-cite id=\"{id}\" tabId=\"{tab_id}\" tabTitle=\"{tab_title}\" pageUrl=\"{page_url}\" pageTitle=\"{page_title}\" excerptKind=\"{excerpt_kind}\" truncated=\"{truncated}\"{link_url}{link_text}{src_url}{element_selector}{element_tag}{source_kind}{capture_fidelity}>\n{quoted}\n</lyra-page-cite>"
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_page_citations_normalizes_payload() {
        let payload = json!({
            "pageCitations": [{
                "id": "page-cite-1",
                "tabId": "tab-1",
                "tabTitle": "Docs",
                "pageUrl": "https://example.com/docs",
                "pageTitle": "Documentation",
                "excerptKind": "selection",
                "quotedText": "hello world"
            }]
        });
        let citations = parse_page_citations(&payload);
        assert_eq!(citations.len(), 1);
        assert_eq!(citations[0]["tabId"], "tab-1");
        assert_eq!(citations[0]["pageUrl"], "https://example.com/docs");
    }

    #[test]
    fn format_page_cite_xml_includes_metadata() {
        let citation = json!({
            "id": "page-cite-1",
            "tabId": "tab-1",
            "tabTitle": "Docs",
            "pageUrl": "https://example.com/docs",
            "pageTitle": "Documentation",
            "excerptKind": "link",
            "truncated": false,
            "linkUrl": "https://example.com/a",
            "linkText": "Read more",
            "quotedText": "Read more"
        });
        let xml = format_page_cite_xml(&citation).expect("xml");
        assert!(xml.contains("tabId=\"tab-1\""));
        assert!(xml.contains("pageUrl=\"https://example.com/docs\""));
        assert!(xml.contains("linkUrl=\"https://example.com/a\""));
        assert!(xml.contains("Read more"));
    }

    #[test]
    fn expand_page_cite_markers_uses_preview_for_titles() {
        let citations = vec![json!({
            "id": "page-cite-1",
            "preview": "Cloudflare Dashboard",
            "pageTitle": "Cloudflare | Web Performance & Security"
        })];
        let title = expand_page_cite_markers(
            "给你自己配置⟦page-cite:page-cite-1⟧",
            &citations,
            PageCiteMarkerMode::Title,
        );
        assert_eq!(title, "给你自己配置 Cloudflare Dashboard");
        assert!(!title.contains("⟦"));
        let model = expand_page_cite_markers(
            "给你自己配置⟦page-cite:page-cite-1⟧",
            &citations,
            PageCiteMarkerMode::ModelUserText,
        );
        assert_eq!(model, "给你自己配置");
    }
}
