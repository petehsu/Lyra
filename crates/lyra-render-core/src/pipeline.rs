use crate::ast::{InlineNode, LyraRenderDocument, RenderBlock};
use crate::cache::{
    cache_key, get_cached_document, highlight_cached_or, math_cached_or, mermaid_cached_or,
    store_cached_document, CachedSvg,
};
use crate::highlight::highlight_code;
use crate::link::normalize_link_href;
use crate::linkify;
use crate::markdown::parse_markdown;
use crate::math::{render_math, split_math_in_text, MathTextSegment};
use crate::mermaid::render_mermaid;
use crate::options::{RenderDocumentMode, RenderDocumentOptions};
use crate::preprocess::fix_markdown_issues;
use crate::safety::{image_fallback_text, is_safe_image_src, is_safe_link_url, link_fallback_text};
#[cfg(not(target_arch = "wasm32"))]
use rayon::prelude::*;

fn preprocess_content(content: &str, mode: RenderDocumentMode) -> String {
    let streaming = matches!(mode, RenderDocumentMode::Fragment);
    fix_markdown_issues(content, streaming)
}

pub fn render_document(content: &str, options: &RenderDocumentOptions) -> LyraRenderDocument {
    let normalized = preprocess_content(content, options.mode);
    let key = cache_key(&normalized, options);
    if let Some(cached) = get_cached_document(&key) {
        return cached;
    }

    let mut document = parse_markdown(&normalized);
    enrich_document(&mut document, options);
    store_cached_document(key, document.clone());
    document
}

fn enrich_document(document: &mut LyraRenderDocument, options: &RenderDocumentOptions) {
    document.blocks = enrich_blocks(&document.blocks, options);
}

fn enrich_blocks(blocks: &[RenderBlock], options: &RenderDocumentOptions) -> Vec<RenderBlock> {
    #[cfg(not(target_arch = "wasm32"))]
    {
        return blocks
            .par_iter()
            .map(|block| enrich_block(block.clone(), options))
            .collect();
    }
    #[cfg(target_arch = "wasm32")]
    {
        return blocks
            .iter()
            .map(|block| enrich_block(block.clone(), options))
            .collect();
    }
}

fn enrich_block(block: RenderBlock, options: &RenderDocumentOptions) -> RenderBlock {
    match block {
        RenderBlock::CodeBlock {
            language, source, ..
        } => enrich_code_block(language, source, options),
        RenderBlock::Paragraph { children } => RenderBlock::Paragraph {
            children: enrich_inline_nodes(children, options, true),
        },
        RenderBlock::Heading { level, children } => RenderBlock::Heading {
            level,
            children: enrich_inline_nodes(children, options, true),
        },
        RenderBlock::Blockquote { children } => RenderBlock::Blockquote {
            children: children
                .into_iter()
                .map(|child| enrich_block(child, options))
                .collect(),
        },
        RenderBlock::List { ordered, items } => RenderBlock::List {
            ordered,
            items: items
                .into_iter()
                .map(|item| crate::ast::ListItem {
                    checked: item.checked,
                    children: item
                        .children
                        .into_iter()
                        .map(|child| enrich_block(child, options))
                        .collect(),
                })
                .collect(),
        },
        RenderBlock::Table { headers, rows } => RenderBlock::Table {
            headers: headers
                .into_iter()
                .map(|row| enrich_inline_nodes(row, options, true))
                .collect(),
            rows: rows
                .into_iter()
                .map(|row| {
                    row.into_iter()
                        .map(|cell| enrich_inline_nodes(cell, options, true))
                        .collect()
                })
                .collect(),
        },
        RenderBlock::Details { summary, children } => RenderBlock::Details {
            summary: enrich_inline_nodes(summary, options, true),
            children: children
                .into_iter()
                .map(|child| enrich_block(child, options))
                .collect(),
        },
        other => other,
    }
}

/// Stable tag for the theme, used to namespace the per-block enrich caches so a
/// block re-rendered under a different theme doesn't return a stale SVG.
fn theme_tag(options: &RenderDocumentOptions) -> String {
    format!("{:?}", options.theme)
}

fn enrich_code_block(
    language: Option<String>,
    source: String,
    options: &RenderDocumentOptions,
) -> RenderBlock {
    let language_key = language.as_deref().unwrap_or_default().to_ascii_lowercase();

    if options.enable_mermaid && language_key == "mermaid" {
        let theme = options.theme;
        let rendered = mermaid_cached_or(&source, &theme_tag(options), || {
            let result = render_mermaid(&source, theme);
            CachedSvg {
                svg: result.svg,
                error: result.error,
            }
        });
        return RenderBlock::Mermaid {
            source,
            svg: rendered.svg,
            error: rendered.error,
        };
    }

    if options.enable_math && (language_key == "math" || language_key == "latex") {
        let theme = options.theme;
        let tag = format!("{}|display", theme_tag(options));
        let rendered = math_cached_or(&source, &tag, || {
            let result = render_math(&source, true, theme);
            CachedSvg {
                svg: result.svg,
                error: result.error,
            }
        });
        return RenderBlock::MathBlock {
            latex: source,
            svg: rendered.svg,
            error: rendered.error,
        };
    }

    let spans = if options.highlight_code {
        highlight_cached_or(language_key.as_str(), &source, || {
            highlight_code(language_key.as_str(), &source)
        })
    } else {
        Vec::new()
    };

    RenderBlock::CodeBlock {
        language,
        source,
        spans,
    }
}

fn enrich_inline_nodes(
    nodes: Vec<InlineNode>,
    options: &RenderDocumentOptions,
    allow_linkify: bool,
) -> Vec<InlineNode> {
    let mut enriched = Vec::new();
    for node in nodes {
        enriched.extend(enrich_inline_node(node, options, allow_linkify));
    }
    enriched
}

fn enrich_inline_node(
    node: InlineNode,
    options: &RenderDocumentOptions,
    allow_linkify: bool,
) -> Vec<InlineNode> {
    match node {
        InlineNode::Text { value } => {
            let segments = if allow_linkify && options.enable_linkify {
                linkify::linkify_text(&value)
            } else {
                vec![InlineNode::Text { value }]
            };
            segments
                .into_iter()
                .flat_map(|segment| match segment {
                    InlineNode::Text { value } => enrich_text_with_math(value, options),
                    InlineNode::Link {
                        href,
                        title,
                        children,
                    } => vec![InlineNode::Link {
                        href,
                        title,
                        children: enrich_inline_nodes(children, options, false),
                    }],
                    other => vec![other],
                })
                .collect()
        }
        InlineNode::Strong { children } => vec![InlineNode::Strong {
            children: enrich_inline_nodes(children, options, allow_linkify),
        }],
        InlineNode::Emphasis { children } => vec![InlineNode::Emphasis {
            children: enrich_inline_nodes(children, options, allow_linkify),
        }],
        InlineNode::Strikethrough { children } => vec![InlineNode::Strikethrough {
            children: enrich_inline_nodes(children, options, allow_linkify),
        }],
        InlineNode::Link {
            href,
            title,
            children,
        } => {
            let normalized_href = normalize_link_href(&href);
            let enriched_children = enrich_inline_nodes(children, options, false);
            if is_safe_link_url(&normalized_href) {
                vec![InlineNode::Link {
                    href: normalized_href,
                    title,
                    children: enriched_children,
                }]
            } else {
                let fallback = link_fallback_text(&enriched_children);
                if fallback.is_empty() {
                    vec![]
                } else {
                    vec![InlineNode::Text { value: fallback }]
                }
            }
        }
        InlineNode::Image { src, alt, title } => {
            let normalized_src = normalize_link_href(&src);
            if is_safe_image_src(&normalized_src) {
                vec![InlineNode::Image {
                    src: normalized_src,
                    alt,
                    title,
                }]
            } else {
                vec![InlineNode::Text {
                    value: image_fallback_text(&alt),
                }]
            }
        }
        InlineNode::Code { .. } => vec![node],
        other => vec![other],
    }
}

fn enrich_text_with_math(value: String, options: &RenderDocumentOptions) -> Vec<InlineNode> {
    if !options.enable_math {
        return vec![InlineNode::Text { value }];
    }
    split_math_in_text(&value)
        .into_iter()
        .map(|segment| match segment {
            MathTextSegment::Text { value } => InlineNode::Text { value },
            MathTextSegment::InlineMath { latex } => {
                let theme = options.theme;
                let tag = format!("{}|inline", theme_tag(options));
                let rendered = math_cached_or(&latex, &tag, || {
                    let result = render_math(&latex, false, theme);
                    CachedSvg {
                        svg: result.svg,
                        error: result.error,
                    }
                });
                InlineNode::MathInline {
                    latex,
                    svg: rendered.svg,
                    error: rendered.error,
                }
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn render_document_caches_identical_requests() {
        invalidate_cache_for_tests();
        let options = RenderDocumentOptions::default();
        let first = render_document("**hello**", &options);
        let second = render_document("**hello**", &options);
        assert_eq!(first, second);
    }

    #[test]
    fn fragment_mode_skips_bold_auto_close() {
        invalidate_cache_for_tests();
        let fragment = RenderDocumentOptions {
            mode: RenderDocumentMode::Fragment,
            ..RenderDocumentOptions::default()
        };
        let document = RenderDocumentOptions::default();
        let input = "Hello **world";

        let fragment_rendered = render_document(input, &fragment);
        let document_rendered = render_document(input, &document);

        assert_ne!(fragment_rendered, document_rendered);
    }

    #[test]
    fn repairs_ai_ordered_list_markdown_before_rendering() {
        invalidate_cache_for_tests();
        let options = RenderDocumentOptions::default();
        let input = "开始之前需要确认几个点：\n\n1. **这是哪个公司/产品的官网？** 名称、行业、一句话定位\n2. **需要哪些页面/模块？**比如首页、关于我们、产品介绍、联系方式等3. **技术栈偏好？** 纯静态（HTML/CSS/JS）、React、Vue、Next.js、还是其他？\n4. **设计风格？** 有没有参考网站？";
        let doc = render_document(input, &options);
        let items = doc
            .blocks
            .iter()
            .find_map(|block| match block {
                RenderBlock::List { ordered, items } if *ordered => Some(items),
                _ => None,
            })
            .expect("ordered list");
        assert_eq!(items.len(), 4);
        let stray_star_count = items
            .iter()
            .flat_map(|item| item.children.iter())
            .filter_map(|block| match block {
                RenderBlock::Paragraph { children } => Some(children),
                _ => None,
            })
            .flat_map(|children| children.iter())
            .filter(|node| matches!(node, InlineNode::Text { value } if value == "*"))
            .count();
        assert_eq!(stray_star_count, 0);
    }

    fn invalidate_cache_for_tests() {
        crate::cache::invalidate_cache();
    }

    fn contains_link_node(nodes: &[InlineNode]) -> bool {
        nodes.iter().any(|node| match node {
            InlineNode::Link { .. } => true,
            InlineNode::Strong { children }
            | InlineNode::Emphasis { children }
            | InlineNode::Strikethrough { children } => contains_link_node(children),
            _ => false,
        })
    }

    #[test]
    fn strips_unsafe_javascript_links_during_enrich() {
        invalidate_cache_for_tests();
        let options = RenderDocumentOptions::default();
        let doc = render_document("[click me](javascript:alert(1))", &options);
        let paragraph = doc
            .blocks
            .iter()
            .find_map(|block| match block {
                RenderBlock::Paragraph { children } => Some(children.as_slice()),
                _ => None,
            })
            .expect("paragraph");
        assert!(!contains_link_node(paragraph));
        assert!(paragraph.iter().any(|node| matches!(
            node,
            InlineNode::Text { value } if value == "click me"
        )));
    }

    #[test]
    fn linkifies_bare_urls_in_plain_text() {
        invalidate_cache_for_tests();
        let options = RenderDocumentOptions::default();
        let doc = render_document("Visit https://example.com today.", &options);
        let paragraph = doc
            .blocks
            .iter()
            .find_map(|block| match block {
                RenderBlock::Paragraph { children } => Some(children.as_slice()),
                _ => None,
            })
            .expect("paragraph");
        assert!(contains_link_node(paragraph));
        let href = paragraph
            .iter()
            .find_map(|node| match node {
                InlineNode::Link { href, .. } => Some(href.as_str()),
                _ => None,
            })
            .expect("link href");
        assert_eq!(href, "https://example.com");
    }

    #[test]
    fn normalizes_explicit_link_hrefs_during_enrich() {
        invalidate_cache_for_tests();
        let options = RenderDocumentOptions::default();
        let doc = render_document("[site](https://例子.测试)", &options);
        let paragraph = doc
            .blocks
            .iter()
            .find_map(|block| match block {
                RenderBlock::Paragraph { children } => Some(children.as_slice()),
                _ => None,
            })
            .expect("paragraph");
        let href = paragraph
            .iter()
            .find_map(|node| match node {
                InlineNode::Link { href, .. } => Some(href.as_str()),
                _ => None,
            })
            .expect("link href");
        assert!(href.contains("xn--"));
    }

    #[test]
    fn skips_linkify_when_disabled() {
        invalidate_cache_for_tests();
        let options = RenderDocumentOptions {
            enable_linkify: false,
            ..RenderDocumentOptions::default()
        };
        let doc = render_document("Visit https://example.com today.", &options);
        let paragraph = doc
            .blocks
            .iter()
            .find_map(|block| match block {
                RenderBlock::Paragraph { children } => Some(children.as_slice()),
                _ => None,
            })
            .expect("paragraph");
        assert!(!contains_link_node(paragraph));
    }

    #[test]
    fn strips_unsafe_image_sources_during_enrich() {
        invalidate_cache_for_tests();
        let options = RenderDocumentOptions::default();
        let doc = render_document("![logo](javascript:alert(1))", &options);
        let paragraph = doc
            .blocks
            .iter()
            .find_map(|block| match block {
                RenderBlock::Paragraph { children } => Some(children.as_slice()),
                _ => None,
            })
            .expect("paragraph");
        assert!(!paragraph
            .iter()
            .any(|node| matches!(node, InlineNode::Image { .. })));
        assert!(paragraph.iter().any(|node| matches!(
            node,
            InlineNode::Text { value } if value == "[image]" || value == "[logo]"
        )));
    }
}
