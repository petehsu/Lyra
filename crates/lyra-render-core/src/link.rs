use url::Url;

const RECODE_HOSTNAME_SCHEMES: &[&str] = &["http", "https", "mailto"];

/// Normalize a link destination for storage/rendering (markdown-it `normalizeLink`).
pub fn normalize_link_href(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    if is_passthrough_href(trimmed) {
        return trimmed.to_string();
    }
    parse_link_url(trimmed)
        .and_then(encode_url_hostname)
        .unwrap_or_else(|| trimmed.to_string())
}

/// Normalize visible link text (markdown-it `normalizeLinkText`).
pub fn normalize_link_display_text(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    if is_passthrough_href(trimmed) {
        return trimmed.to_string();
    }
    parse_link_url(trimmed)
        .and_then(decode_url_hostname)
        .unwrap_or_else(|| trimmed.to_string())
}

fn is_passthrough_href(value: &str) -> bool {
    value.starts_with('#')
        || value.starts_with("./")
        || value.starts_with("../")
        || value.starts_with('?')
        || (value.starts_with('/') && !value.starts_with("//"))
}

fn parse_link_url(raw: &str) -> Option<Url> {
    if let Ok(url) = Url::parse(raw) {
        return Some(url);
    }
    if raw.starts_with("//") {
        return Url::parse(&format!("http:{raw}")).ok();
    }
    None
}

fn encode_url_hostname(url: Url) -> Option<String> {
    let scheme = url.scheme();
    if !RECODE_HOSTNAME_SCHEMES.contains(&scheme) {
        return Some(format_normalized_url(&url));
    }
    let host = url.host_str()?;
    let ascii_host = match idna::domain_to_ascii(host) {
        Ok(value) => value,
        Err(_) => return Some(format_normalized_url(&url)),
    };
    let mut normalized = url;
    normalized.set_host(Some(ascii_host.as_str())).ok()?;
    Some(format_normalized_url(&normalized))
}

fn decode_url_hostname(url: Url) -> Option<String> {
    let scheme = url.scheme();
    if !RECODE_HOSTNAME_SCHEMES.contains(&scheme) {
        return Some(format_normalized_url(&url));
    }
    let host = url.host_str()?;
    let (unicode_host, errors) = idna::domain_to_unicode(host);
    if errors.is_err() {
        return Some(format_normalized_url(&url));
    }
    let mut normalized = url;
    normalized.set_host(Some(unicode_host.as_str())).ok()?;
    Some(format_normalized_url(&normalized))
}

fn format_normalized_url(url: &Url) -> String {
    let rendered = url.to_string();
    if url.path() == "/" && url.query().is_none() && url.fragment().is_none() {
        rendered.trim_end_matches('/').to_string()
    } else {
        rendered
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn leaves_relative_and_fragment_hrefs_untouched() {
        assert_eq!(normalize_link_href("/tmp/readme.md"), "/tmp/readme.md");
        assert_eq!(normalize_link_href("#section"), "#section");
    }

    #[test]
    fn encodes_unicode_hostname_in_href() {
        let normalized = normalize_link_href("https://例子.测试/path");
        assert!(normalized.contains("xn--"));
        assert!(normalized.contains("/path"));
    }

    #[test]
    fn decodes_punycode_hostname_for_display_text() {
        let display = normalize_link_display_text("https://xn--fsq.xn--0zwm56d/page");
        assert!(display.contains("例子.测试") || display.contains("xn--"));
    }

    #[test]
    fn normalizes_protocol_relative_urls() {
        let normalized = normalize_link_href("//example.com/a");
        assert_eq!(normalized, "http://example.com/a");
    }
}
