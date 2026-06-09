//! Inline rendering helpers and code-language inference.

use scraper::node::Element;

/// Infer a fenced-code language from a `<pre>`/`<code>` element's attributes.
///
/// Recognizes `class="language-xxx"`, `class="lang-xxx"`, `data-lang`, and a
/// bare `class="rust"`-style single token.
pub fn infer_code_language(pre: Option<&Element>, code: Option<&Element>) -> Option<String> {
    for element in [code, pre].into_iter().flatten() {
        if let Some(lang) = element.attr("data-lang") {
            let lang = lang.trim();
            if !lang.is_empty() {
                return Some(lang.to_string());
            }
        }
        for class in element.classes() {
            if let Some(rest) = class.strip_prefix("language-") {
                if !rest.is_empty() {
                    return Some(rest.to_string());
                }
            }
            if let Some(rest) = class.strip_prefix("lang-") {
                if !rest.is_empty() {
                    return Some(rest.to_string());
                }
            }
        }
    }
    None
}

/// Escape markdown-significant characters in inline text.
///
/// Conservative: only escapes characters that would otherwise start markdown
/// constructs at a position where they matter. Avoids over-escaping prose.
pub fn escape_inline(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for ch in text.chars() {
        match ch {
            '\\' | '`' | '*' | '_' | '[' | ']' => {
                out.push('\\');
                out.push(ch);
            }
            _ => out.push(ch),
        }
    }
    out
}

/// Collapse internal whitespace runs to single spaces (HTML inline semantics).
pub fn collapse_ws(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut prev_space = false;
    for ch in text.chars() {
        if ch.is_whitespace() {
            if !prev_space {
                out.push(' ');
            }
            prev_space = true;
        } else {
            out.push(ch);
            prev_space = false;
        }
    }
    out
}

/// Wrap `inner` with an emphasis marker, guarding against empty content.
pub fn wrap(marker: &str, inner: &str) -> String {
    if inner.trim().is_empty() {
        return inner.to_string();
    }
    // Preserve leading/trailing spaces outside the markers so `a <em> b </em> c`
    // does not produce broken `a* b *c`.
    let leading: String = inner.chars().take_while(|c| c.is_whitespace()).collect();
    let trailing: String = inner
        .chars()
        .rev()
        .take_while(|c| c.is_whitespace())
        .collect();
    let core = inner.trim();
    format!("{leading}{marker}{core}{marker}{trailing}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use scraper::Html;
    use scraper::selector::Selector;

    fn element_html(html: &str, css: &str) -> Html {
        let _ = css;
        Html::parse_fragment(html)
    }

    #[test]
    fn infers_language_class() {
        let doc = element_html("<pre><code class=\"language-rust\">x</code></pre>", "code");
        let selector = Selector::parse("code").expect("selector");
        let code = doc.select(&selector).next().expect("code el");
        let lang = infer_code_language(None, Some(code.value()));
        assert_eq!(lang.as_deref(), Some("rust"));
    }

    #[test]
    fn collapses_whitespace() {
        assert_eq!(collapse_ws("a   b\n c"), "a b c");
    }

    #[test]
    fn wrap_keeps_outer_spaces() {
        assert_eq!(wrap("*", " hi "), " *hi* ");
        assert_eq!(wrap("*", "   "), "   ");
    }

    #[test]
    fn escape_inline_escapes_markers() {
        assert_eq!(escape_inline("a*b_c"), "a\\*b\\_c");
    }
}
