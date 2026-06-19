use crate::ast::{InlineNode, ListItem, LyraRenderDocument, RenderBlock};
use pulldown_cmark::{CodeBlockKind, Event, Options, Parser, Tag, TagEnd};

pub(crate) fn parse_markdown_plain(content: &str) -> LyraRenderDocument {
    let mut options = Options::empty();
    options.insert(Options::ENABLE_STRIKETHROUGH);
    options.insert(Options::ENABLE_TABLES);
    options.insert(Options::ENABLE_TASKLISTS);

    let events = Parser::new_ext(content, options);
    let mut builder = MarkdownBuilder::default();
    for event in events {
        builder.handle_event(event);
    }
    builder.finish()
}

#[derive(Debug)]
struct MarkdownBuilder {
    document: LyraRenderDocument,
    block_targets: Vec<BlockTarget>,
    inline_stack: Vec<Vec<InlineNode>>,
    code_block: Option<CodeBlockState>,
    table: Option<TableState>,
    link_destination: Option<String>,
    link_title: Option<String>,
    pending_task_checked: Option<bool>,
    list_items: Vec<ListItem>,
    list_ordered: bool,
    heading_level: Option<pulldown_cmark::HeadingLevel>,
}

#[derive(Debug)]
enum BlockTarget {
    Document,
    Blockquote(Vec<RenderBlock>),
    ListItem(Vec<RenderBlock>),
}

#[derive(Debug)]
struct CodeBlockState {
    language: Option<String>,
    body: String,
}

#[derive(Debug, Default)]
struct TableState {
    headers: Vec<Vec<InlineNode>>,
    rows: Vec<Vec<Vec<InlineNode>>>,
    current_row: Vec<Vec<InlineNode>>,
    in_head: bool,
}

impl MarkdownBuilder {
    fn finish(self) -> LyraRenderDocument {
        self.document
    }

    fn handle_event(&mut self, event: Event<'_>) {
        if self.code_block.is_some() {
            self.handle_code_block_event(event);
            return;
        }

        match event {
            Event::Start(tag) => self.handle_start(tag),
            Event::End(tag) => self.handle_end(tag),
            Event::Text(text) => self.push_text(&text),
            Event::Code(code) => self.push_inline(InlineNode::Code {
                value: code.to_string(),
            }),
            Event::SoftBreak => self.push_inline(InlineNode::SoftBreak),
            Event::HardBreak => self.push_inline(InlineNode::HardBreak),
            Event::Rule => self.push_block(RenderBlock::ThematicBreak),
            Event::Html(html) | Event::InlineHtml(html) => self.push_text(&html),
            Event::FootnoteReference(reference) => {
                self.push_text(&format!("[{reference}]"));
            }
            Event::TaskListMarker(checked) => {
                self.pending_task_checked = Some(checked);
            }
        }
    }

    fn handle_start(&mut self, tag: Tag<'_>) {
        match tag {
            Tag::Paragraph => self.inline_stack.push(Vec::new()),
            Tag::Heading { level, .. } => {
                self.inline_stack.push(Vec::new());
                self.heading_level = Some(level);
            }
            Tag::Strong | Tag::Emphasis | Tag::Strikethrough | Tag::Link { .. } => {
                if let Tag::Link {
                    dest_url, title, ..
                } = tag
                {
                    self.link_destination = Some(dest_url.to_string());
                    self.link_title = if title.is_empty() {
                        None
                    } else {
                        Some(title.to_string())
                    };
                }
                self.inline_stack.push(Vec::new());
            }
            Tag::BlockQuote => {
                self.block_targets.push(BlockTarget::Blockquote(Vec::new()));
            }
            Tag::CodeBlock(kind) => {
                let language = match kind {
                    CodeBlockKind::Fenced(language) if !language.is_empty() => {
                        Some(language.to_string())
                    }
                    _ => None,
                };
                self.code_block = Some(CodeBlockState {
                    language,
                    body: String::new(),
                });
            }
            Tag::List(start) => {
                self.list_ordered = start.is_some();
                self.list_items = Vec::new();
            }
            Tag::Item => {
                self.block_targets.push(BlockTarget::ListItem(Vec::new()));
            }
            Tag::Image {
                dest_url, title, ..
            } => {
                self.push_inline(InlineNode::Image {
                    src: dest_url.to_string(),
                    alt: String::new(),
                    title: if title.is_empty() {
                        None
                    } else {
                        Some(title.to_string())
                    },
                });
            }
            Tag::Table(_) => {
                self.table = Some(TableState::default());
            }
            Tag::TableHead => {
                if let Some(table) = self.table.as_mut() {
                    table.in_head = true;
                    table.current_row.clear();
                }
            }
            Tag::TableRow => {
                if let Some(table) = self.table.as_mut() {
                    table.current_row.clear();
                }
            }
            Tag::TableCell => {
                self.inline_stack.push(Vec::new());
            }
            _ => {}
        }
    }

    fn handle_end(&mut self, tag: TagEnd) {
        match tag {
            TagEnd::Paragraph => {
                let children = self.inline_stack.pop().unwrap_or_default();
                if !children.is_empty() {
                    self.push_block(RenderBlock::Paragraph { children });
                }
            }
            TagEnd::Heading(level) => {
                let children = self.inline_stack.pop().unwrap_or_default();
                let heading_level = self.heading_level.take().unwrap_or(level) as u8;
                self.push_block(RenderBlock::Heading {
                    level: heading_level,
                    children,
                });
            }
            TagEnd::Strong => self.wrap_inline(InlineNode::Strong {
                children: Vec::new(),
            }),
            TagEnd::Emphasis => self.wrap_inline(InlineNode::Emphasis {
                children: Vec::new(),
            }),
            TagEnd::Strikethrough => self.wrap_inline(InlineNode::Strikethrough {
                children: Vec::new(),
            }),
            TagEnd::Link => {
                let children = self.inline_stack.pop().unwrap_or_default();
                let node = InlineNode::Link {
                    href: self.link_destination.take().unwrap_or_default(),
                    title: self.link_title.take(),
                    children,
                };
                self.push_inline(node);
            }
            TagEnd::BlockQuote => {
                if let Some(BlockTarget::Blockquote(children)) = self.block_targets.pop() {
                    self.push_block(RenderBlock::Blockquote { children });
                }
            }
            TagEnd::Item => {
                if let Some(BlockTarget::ListItem(children)) = self.block_targets.pop() {
                    let checked = self.pending_task_checked.take();
                    self.list_items.push(ListItem { checked, children });
                }
            }
            TagEnd::List(_) => {
                let items = std::mem::take(&mut self.list_items);
                let ordered = self.list_ordered;
                self.push_block(RenderBlock::List { ordered, items });
            }
            TagEnd::CodeBlock => {
                if let Some(block) = self.code_block.take() {
                    self.push_block(RenderBlock::CodeBlock {
                        language: block.language,
                        source: block.body,
                        spans: Vec::new(),
                    });
                }
            }
            TagEnd::TableCell => {
                let children = self.inline_stack.pop().unwrap_or_default();
                if let Some(table) = self.table.as_mut() {
                    table.current_row.push(children);
                }
            }
            TagEnd::TableRow => {
                if let Some(table) = self.table.as_mut() {
                    let row = std::mem::take(&mut table.current_row);
                    if table.in_head {
                        table.headers = row;
                    } else {
                        table.rows.push(row);
                    }
                }
            }
            TagEnd::TableHead => {
                if let Some(table) = self.table.as_mut() {
                    // pulldown-cmark emits the header cells directly inside
                    // TableHead without a wrapping TableRow, so flush the
                    // accumulated header cells here. Without this the table's
                    // `headers` stays empty.
                    if !table.current_row.is_empty() {
                        table.headers = std::mem::take(&mut table.current_row);
                    }
                    table.in_head = false;
                }
            }
            TagEnd::Table => {
                if let Some(table) = self.table.take() {
                    self.push_block(RenderBlock::Table {
                        headers: table.headers,
                        rows: table.rows,
                    });
                }
            }
            _ => {}
        }
    }

    fn handle_code_block_event(&mut self, event: Event<'_>) {
        match event {
            Event::End(TagEnd::CodeBlock) => {
                if let Some(block) = self.code_block.take() {
                    self.push_block(RenderBlock::CodeBlock {
                        language: block.language,
                        source: block.body,
                        spans: Vec::new(),
                    });
                }
            }
            Event::Text(text) | Event::Code(text) | Event::Html(text) | Event::InlineHtml(text) => {
                if let Some(block) = self.code_block.as_mut() {
                    block.body.push_str(&text);
                }
            }
            Event::SoftBreak | Event::HardBreak => {
                if let Some(block) = self.code_block.as_mut() {
                    block.body.push('\n');
                }
            }
            _ => {}
        }
    }

    fn wrap_inline(&mut self, template: InlineNode) {
        let children = self.inline_stack.pop().unwrap_or_default();
        let node = match template {
            InlineNode::Strong { .. } => InlineNode::Strong { children },
            InlineNode::Emphasis { .. } => InlineNode::Emphasis { children },
            InlineNode::Strikethrough { .. } => InlineNode::Strikethrough { children },
            other => other,
        };
        self.push_inline(node);
    }

    fn push_text(&mut self, text: &str) {
        if text.is_empty() {
            return;
        }
        let buffer = self.inline_stack.last_mut();
        if let Some(buffer) = buffer {
            if let Some(InlineNode::Text { value }) = buffer.last_mut() {
                value.push_str(text);
                return;
            }
            buffer.push(InlineNode::Text {
                value: text.to_string(),
            });
            return;
        }
        self.push_block(RenderBlock::Paragraph {
            children: vec![InlineNode::Text {
                value: text.to_string(),
            }],
        });
    }

    fn push_inline(&mut self, node: InlineNode) {
        if let Some(buffer) = self.inline_stack.last_mut() {
            buffer.push(node);
        } else {
            self.push_block(RenderBlock::Paragraph {
                children: vec![node],
            });
        }
    }

    fn push_block(&mut self, block: RenderBlock) {
        if let Some(BlockTarget::ListItem(children)) = self.block_targets.last_mut() {
            children.push(block);
            return;
        }
        if let Some(BlockTarget::Blockquote(children)) = self.block_targets.last_mut() {
            children.push(block);
            return;
        }
        self.document.blocks.push(block);
    }
}

impl Default for MarkdownBuilder {
    fn default() -> Self {
        Self {
            document: LyraRenderDocument::default(),
            block_targets: vec![BlockTarget::Document],
            inline_stack: Vec::new(),
            code_block: None,
            table: None,
            link_destination: None,
            link_title: None,
            pending_task_checked: None,
            list_items: Vec::new(),
            list_ordered: false,
            heading_level: None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ast::InlineNode;

    #[test]
    fn parses_headings_lists_and_code_blocks() {
        let doc = parse_markdown_plain("# Title\n\n- one\n- `two`\n\n```sh\necho ok\n```");
        assert!(doc
            .blocks
            .iter()
            .any(|block| matches!(block, RenderBlock::Heading { level: 1, .. })));
        assert!(doc
            .blocks
            .iter()
            .any(|block| matches!(block, RenderBlock::List { .. })));
        assert!(doc
            .blocks
            .iter()
            .any(|block| matches!(block, RenderBlock::CodeBlock { .. })));
    }

    #[test]
    fn parses_table_header_and_rows() {
        let doc = parse_markdown_plain("| A | B |\n|---|---|\n| 1 | 2 |");
        let (headers, rows) = doc
            .blocks
            .iter()
            .find_map(|block| match block {
                RenderBlock::Table { headers, rows } => Some((headers, rows)),
                _ => None,
            })
            .expect("table block");
        // Header row must be populated (regression: it used to come back empty
        // because pulldown-cmark emits header cells without a wrapping row).
        assert_eq!(headers.len(), 2, "expected 2 header cells");
        assert_eq!(rows.len(), 1, "expected 1 body row");
        assert_eq!(rows[0].len(), 2, "expected 2 body cells");
    }

    #[test]
    fn parses_links() {
        let doc = parse_markdown_plain("[site](https://example.com)");
        let paragraph = doc
            .blocks
            .iter()
            .find_map(|block| match block {
                RenderBlock::Paragraph { children } => Some(children),
                _ => None,
            })
            .expect("paragraph");
        assert!(matches!(
            &paragraph[0],
            InlineNode::Link { href, .. } if href == "https://example.com"
        ));
    }
}
