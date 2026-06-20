use std::fs;
use std::path::Path;

use lyra_render_core::ast::{InlineNode, LyraRenderDocument, RenderBlock};
use serde::Deserialize;

#[derive(Debug, Clone)]
pub struct CommonMarkExample {
    pub name: String,
    pub markdown: String,
}

pub fn load_commonmark_smoke_fixtures() -> Vec<CommonMarkExample> {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/commonmark-smoke.txt");
    let raw = fs::read_to_string(path).expect("commonmark smoke fixture");
    parse_commonmark_examples(&raw)
}

pub fn parse_commonmark_examples(raw: &str) -> Vec<CommonMarkExample> {
    let mut examples = Vec::new();
    let mut index = 0usize;

    for section in raw.split("~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~") {
        let section = section.trim();
        if section.is_empty() {
            continue;
        }

        let mut lines = section.lines();
        let header = lines.next().unwrap_or_default().trim();
        let name = if header.is_empty() {
            format!("example_{index}")
        } else {
            header.to_string()
        };

        let mut body = lines.collect::<Vec<_>>().join("\n");
        if let Some(stripped) = body.strip_prefix('\n') {
            body = stripped.to_string();
        }
        if let Some(stripped) = body.strip_suffix('\n') {
            body = stripped.to_string();
        }

        let Some(markdown) = extract_markdown_section(&body) else {
            continue;
        };

        examples.push(CommonMarkExample { name, markdown });
        index += 1;
    }

    examples
}

fn extract_markdown_section(body: &str) -> Option<String> {
    let mut lines = body.lines();
    while lines.next().is_some_and(|line| line.trim() != ".") {}

    let mut markdown_lines = Vec::new();
    for line in lines {
        if line.trim() == "." {
            break;
        }
        markdown_lines.push(line);
    }

    if markdown_lines.is_empty() {
        return None;
    }

    Some(markdown_lines.join("\n"))
}

#[derive(Debug, Deserialize)]
pub struct GoldenFixtureFile {
    pub cases: Vec<GoldenCase>,
}

#[derive(Debug, Deserialize)]
pub struct GoldenCase {
    pub name: String,
    pub markdown: String,
    pub expect: GoldenExpectation,
}

#[derive(Debug, Deserialize)]
pub struct GoldenExpectation {
    pub blocks: Vec<GoldenBlock>,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum GoldenBlock {
    Heading {
        level: u8,
        text: String,
    },
    Paragraph {
        text: String,
    },
    CodeBlock {
        language: Option<String>,
        source: String,
    },
    List {
        ordered: bool,
        #[serde(rename = "itemCount")]
        item_count: usize,
        #[serde(rename = "checkedStates", default)]
        checked_states: Option<Vec<bool>>,
    },
    Link {
        href: String,
        text: String,
    },
    Image {
        src: String,
        alt: String,
    },
    Blockquote {
        text: String,
    },
    Table {
        #[serde(rename = "columnCount")]
        column_count: usize,
        #[serde(rename = "rowCount")]
        row_count: usize,
    },
    ThematicBreak,
}

pub fn load_golden_fixtures() -> GoldenFixtureFile {
    let path =
        Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/commonmark-ast-golden.json");
    let raw = fs::read_to_string(path).expect("commonmark golden fixture");
    serde_json::from_str(&raw).expect("valid golden fixture json")
}

pub fn assert_document_matches_golden(
    document: &LyraRenderDocument,
    expect: &GoldenExpectation,
    case_name: &str,
) {
    assert_eq!(
        document.blocks.len(),
        expect.blocks.len(),
        "block count mismatch in case '{case_name}'"
    );

    for (block, expected) in document.blocks.iter().zip(expect.blocks.iter()) {
        match (block, expected) {
            (
                RenderBlock::Heading { level, children },
                GoldenBlock::Heading {
                    level: expected_level,
                    text,
                },
            ) => {
                assert_eq!(*level, *expected_level);
                assert_eq!(inline_plain_text(children), *text);
            }
            (RenderBlock::Paragraph { children }, GoldenBlock::Paragraph { text }) => {
                assert_eq!(inline_plain_text(children), *text);
            }
            (
                RenderBlock::CodeBlock {
                    language,
                    source: actual_source,
                    ..
                },
                GoldenBlock::CodeBlock {
                    language: expected_language,
                    source: expected_source,
                },
            ) => {
                assert_eq!(language.as_deref(), expected_language.as_deref());
                assert_eq!(actual_source, expected_source);
            }
            (
                RenderBlock::List { ordered, items },
                GoldenBlock::List {
                    ordered: expected_ordered,
                    item_count,
                    checked_states,
                },
            ) => {
                assert_eq!(*ordered, *expected_ordered);
                assert_eq!(items.len(), *item_count);
                if let Some(expected_checked) = checked_states {
                    let actual_checked: Vec<bool> = items
                        .iter()
                        .map(|item| item.checked.unwrap_or(false))
                        .collect();
                    assert_eq!(actual_checked, *expected_checked);
                }
            }
            (RenderBlock::ThematicBreak, GoldenBlock::ThematicBreak) => {}
            (RenderBlock::Blockquote { children }, GoldenBlock::Blockquote { text }) => {
                let paragraph_text = children
                    .iter()
                    .find_map(|block| match block {
                        RenderBlock::Paragraph { children } => Some(inline_plain_text(children)),
                        _ => None,
                    })
                    .unwrap_or_default();
                assert_eq!(paragraph_text, *text);
            }
            (
                RenderBlock::Table { headers, rows },
                GoldenBlock::Table {
                    column_count,
                    row_count,
                },
            ) => {
                assert_eq!(headers.len(), *column_count);
                assert_eq!(rows.len(), *row_count);
            }
            (block, GoldenBlock::Link { href, text }) => {
                let paragraph = match block {
                    RenderBlock::Paragraph { children } => children,
                    other => panic!("expected paragraph for link case, got {other:?}"),
                };
                let link = paragraph
                    .iter()
                    .find_map(|node| match node {
                        InlineNode::Link { href, children, .. } => {
                            Some((href.clone(), inline_plain_text(children)))
                        }
                        _ => None,
                    })
                    .expect("link node");
                assert_eq!(link.0, *href);
                assert_eq!(link.1, *text);
            }
            (block, GoldenBlock::Image { src, alt }) => {
                let paragraph = match block {
                    RenderBlock::Paragraph { children } => children,
                    other => panic!("expected paragraph for image case, got {other:?}"),
                };
                let image = paragraph
                    .iter()
                    .find_map(|node| match node {
                        InlineNode::Image { src, alt, .. } => Some((src.clone(), alt.clone())),
                        _ => None,
                    })
                    .expect("image node");
                assert_eq!(image.0, *src);
                assert_eq!(image.1, *alt);
            }
            (block, expected) => {
                panic!(
                    "block mismatch in case '{case_name}': got {block:?}, expected {expected:?}"
                );
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_commonmark_examples_extracts_markdown_sections() {
        let raw = r#"~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
atx_heading_h1
.
# Heading one
.
<h1>Heading one</h1>
.
"#;
        let examples = parse_commonmark_examples(raw);
        assert_eq!(examples.len(), 1);
        assert_eq!(examples[0].name, "atx_heading_h1");
        assert_eq!(examples[0].markdown, "# Heading one");
    }

    #[test]
    fn load_commonmark_smoke_fixtures_meets_minimum_count() {
        let fixtures = load_commonmark_smoke_fixtures();
        assert!(fixtures.len() >= 20, "expected curated smoke fixtures");
    }
}

fn inline_plain_text(nodes: &[InlineNode]) -> String {
    nodes
        .iter()
        .map(|node| match node {
            InlineNode::Text { value } | InlineNode::Code { value } => value.clone(),
            InlineNode::Strong { children }
            | InlineNode::Emphasis { children }
            | InlineNode::Strikethrough { children }
            | InlineNode::Link { children, .. } => inline_plain_text(children),
            InlineNode::Image { alt, .. } => format!("[{alt}]"),
            InlineNode::MathInline { latex, .. } => format!("${latex}$"),
            InlineNode::SoftBreak | InlineNode::HardBreak => " ".to_string(),
        })
        .collect::<Vec<_>>()
        .join("")
}
