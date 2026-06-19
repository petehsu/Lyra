use crate::ast::{InlineNode, LyraRenderDocument, RenderBlock};
use crate::cache::{cache_key, get_cached_document, store_cached_document};
use crate::highlight::highlight_code;
use crate::markdown::parse_markdown;
use crate::math::{render_math, split_math_in_text, MathTextSegment};
use crate::mermaid::render_mermaid;
use crate::options::{RenderDocumentMode, RenderDocumentOptions};
use crate::preprocess::fix_markdown_issues;
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
            children: enrich_inline_nodes(children, options),
        },
        RenderBlock::Heading { level, children } => RenderBlock::Heading {
            level,
            children: enrich_inline_nodes(children, options),
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
                .map(|row| enrich_inline_nodes(row, options))
                .collect(),
            rows: rows
                .into_iter()
                .map(|row| {
                    row.into_iter()
                        .map(|cell| enrich_inline_nodes(cell, options))
                        .collect()
                })
                .collect(),
        },
        RenderBlock::Details { summary, children } => RenderBlock::Details {
            summary: enrich_inline_nodes(summary, options),
            children: children
                .into_iter()
                .map(|child| enrich_block(child, options))
                .collect(),
        },
        other => other,
    }
}

fn enrich_code_block(
    language: Option<String>,
    source: String,
    options: &RenderDocumentOptions,
) -> RenderBlock {
    let language_key = language.as_deref().unwrap_or_default().to_ascii_lowercase();

    if options.enable_mermaid && language_key == "mermaid" {
        let rendered = render_mermaid(&source, options.theme);
        return RenderBlock::Mermaid {
            source,
            svg: rendered.svg,
            error: rendered.error,
        };
    }

    if options.enable_math && (language_key == "math" || language_key == "latex") {
        let rendered = render_math(&source, true, options.theme);
        return RenderBlock::MathBlock {
            latex: source,
            svg: rendered.svg,
            error: rendered.error,
        };
    }

    let spans = if options.highlight_code {
        highlight_code(language_key.as_str(), &source)
    } else {
        Vec::new()
    };

    RenderBlock::CodeBlock {
        language,
        source,
        spans,
    }
}

fn enrich_inline_nodes(nodes: Vec<InlineNode>, options: &RenderDocumentOptions) -> Vec<InlineNode> {
    let mut enriched = Vec::new();
    for node in nodes {
        enriched.extend(enrich_inline_node(node, options));
    }
    enriched
}

fn enrich_inline_node(node: InlineNode, options: &RenderDocumentOptions) -> Vec<InlineNode> {
    match node {
        InlineNode::Text { value } => {
            if !options.enable_math {
                return vec![InlineNode::Text { value }];
            }
            split_math_in_text(&value)
                .into_iter()
                .map(|segment| match segment {
                    MathTextSegment::Text { value } => InlineNode::Text { value },
                    MathTextSegment::InlineMath { latex } => {
                        let rendered = render_math(&latex, false, options.theme);
                        InlineNode::MathInline {
                            latex,
                            svg: rendered.svg,
                            error: rendered.error,
                        }
                    }
                })
                .collect()
        }
        InlineNode::Strong { children } => vec![InlineNode::Strong {
            children: enrich_inline_nodes(children, options),
        }],
        InlineNode::Emphasis { children } => vec![InlineNode::Emphasis {
            children: enrich_inline_nodes(children, options),
        }],
        InlineNode::Strikethrough { children } => vec![InlineNode::Strikethrough {
            children: enrich_inline_nodes(children, options),
        }],
        InlineNode::Link {
            href,
            title,
            children,
        } => vec![InlineNode::Link {
            href,
            title,
            children: enrich_inline_nodes(children, options),
        }],
        other => vec![other],
    }
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
}
