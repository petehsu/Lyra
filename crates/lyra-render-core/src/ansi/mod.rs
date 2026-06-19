use crate::ast::{InlineNode, LyraRenderDocument, RenderBlock};
use crate::options::RenderDocumentOptions;
use crate::pipeline::render_document;

const RESET: &str = "\x1b[0m";
const BOLD: &str = "\x1b[1m";
const DIM: &str = "\x1b[2m";
const ITALIC: &str = "\x1b[3m";
const STRIKE: &str = "\x1b[9m";
const CYAN: &str = "\x1b[36m";
const GREEN: &str = "\x1b[32m";
const MAGENTA: &str = "\x1b[35m";

pub fn render_markdown_ansi(content: &str, options: &RenderDocumentOptions) -> String {
    let document = render_document(content, options);
    render_document_ansi(&document)
}

pub fn render_document_ansi(document: &LyraRenderDocument) -> String {
    let mut renderer = AnsiRenderer::default();
    for block in &document.blocks {
        renderer.render_block(block);
    }
    renderer.finish()
}

#[derive(Debug, Default)]
struct AnsiRenderer {
    output: String,
    list_depth: usize,
}

impl AnsiRenderer {
    fn finish(mut self) -> String {
        while self.output.ends_with('\n') {
            self.output.pop();
        }
        self.output.push('\n');
        self.output
    }

    fn render_block(&mut self, block: &RenderBlock) {
        match block {
            RenderBlock::Paragraph { children } => {
                self.render_inline_nodes(children);
                self.ensure_blank_line();
            }
            RenderBlock::Heading { level, children } => {
                self.ensure_blank_line();
                self.output.push_str(MAGENTA);
                self.output.push_str(BOLD);
                self.output.push_str(&"#".repeat(*level as usize));
                self.output.push(' ');
                self.render_inline_nodes(children);
                self.output.push_str(RESET);
                self.ensure_blank_line();
            }
            RenderBlock::Blockquote { children } => {
                self.ensure_blank_line();
                self.output.push_str(DIM);
                self.output.push_str("> ");
                self.output.push_str(RESET);
                for child in children {
                    self.render_block(child);
                }
                self.ensure_blank_line();
            }
            RenderBlock::List { ordered, items } => {
                self.ensure_blank_line();
                self.list_depth += 1;
                for (index, item) in items.iter().enumerate() {
                    let indent = "  ".repeat(self.list_depth.saturating_sub(1));
                    self.output.push_str(&indent);
                    if *ordered {
                        self.output.push_str(&format!("{}. ", index + 1));
                    } else if let Some(checked) = item.checked {
                        self.output.push_str(if checked { "[x] " } else { "[ ] " });
                    } else {
                        self.output.push('•');
                        self.output.push(' ');
                    }
                    for child in &item.children {
                        self.render_block(child);
                    }
                }
                self.list_depth = self.list_depth.saturating_sub(1);
                self.ensure_blank_line();
            }
            RenderBlock::CodeBlock {
                language, source, ..
            } => {
                self.render_code_block(language.as_deref(), source);
            }
            RenderBlock::Mermaid { source, error, .. } => {
                if error.is_some() {
                    self.render_code_block(Some("mermaid"), source);
                } else {
                    self.ensure_blank_line();
                    self.output.push_str(DIM);
                    self.output.push_str("╭─ mermaid\n│ [diagram rendered]\n╰─");
                    self.output.push_str(RESET);
                    self.ensure_blank_line();
                }
            }
            RenderBlock::MathBlock { latex, error, .. } => {
                if error.is_some() {
                    self.render_code_block(Some("math"), latex);
                } else {
                    self.ensure_blank_line();
                    self.output.push_str(DIM);
                    self.output.push_str("╭─ math\n│ ");
                    self.output.push_str(latex);
                    self.output.push_str("\n╰─");
                    self.output.push_str(RESET);
                    self.ensure_blank_line();
                }
            }
            RenderBlock::Table { headers, rows } => {
                self.ensure_blank_line();
                if !headers.is_empty() {
                    self.render_table_row(headers);
                }
                for row in rows {
                    self.render_table_row(row);
                }
                self.ensure_blank_line();
            }
            RenderBlock::Details { summary, children } => {
                self.ensure_blank_line();
                self.output.push_str(DIM);
                self.output.push('▸');
                self.output.push(' ');
                self.output.push_str(RESET);
                self.render_inline_nodes(summary);
                self.ensure_blank_line();
                for child in children {
                    self.render_block(child);
                }
            }
            RenderBlock::ThematicBreak => {
                self.ensure_blank_line();
                self.output.push_str(DIM);
                self.output.push_str("────────────────────────");
                self.output.push_str(RESET);
                self.ensure_blank_line();
            }
        }
    }

    fn render_table_row(&mut self, cells: &[Vec<InlineNode>]) {
        for (index, cell) in cells.iter().enumerate() {
            if index > 0 {
                self.output.push_str(DIM);
                self.output.push_str(" │ ");
                self.output.push_str(RESET);
            }
            self.render_inline_nodes(cell);
        }
        self.output.push('\n');
    }

    fn render_code_block(&mut self, language: Option<&str>, source: &str) {
        self.ensure_blank_line();
        let language = language.unwrap_or("code");
        self.output.push_str(DIM);
        self.output.push_str("╭─ ");
        self.output.push_str(language);
        self.output.push('\n');
        self.output.push_str(RESET);
        for line in source.trim_end_matches('\n').lines() {
            self.output.push_str(DIM);
            self.output.push_str("│ ");
            self.output.push_str(RESET);
            self.output.push_str(GREEN);
            self.output.push_str(line);
            self.output.push_str(RESET);
            self.output.push('\n');
        }
        self.output.push_str(DIM);
        self.output.push_str("╰─");
        self.output.push_str(RESET);
        self.ensure_blank_line();
    }

    fn render_inline_nodes(&mut self, nodes: &[InlineNode]) {
        for node in nodes {
            self.render_inline(node);
        }
    }

    fn render_inline(&mut self, node: &InlineNode) {
        match node {
            InlineNode::Text { value } => self.output.push_str(value),
            InlineNode::Code { value } => {
                self.output.push_str(CYAN);
                self.output.push('`');
                self.output.push_str(value);
                self.output.push('`');
                self.output.push_str(RESET);
            }
            InlineNode::Strong { children } => {
                self.output.push_str(BOLD);
                self.render_inline_nodes(children);
                self.output.push_str(RESET);
            }
            InlineNode::Emphasis { children } => {
                self.output.push_str(ITALIC);
                self.render_inline_nodes(children);
                self.output.push_str(RESET);
            }
            InlineNode::Strikethrough { children } => {
                self.output.push_str(STRIKE);
                self.render_inline_nodes(children);
                self.output.push_str(RESET);
            }
            InlineNode::Link { href, children, .. } => {
                self.output.push_str(CYAN);
                self.render_inline_nodes(children);
                self.output.push_str(RESET);
                self.output.push_str(DIM);
                self.output.push_str(" <");
                self.output.push_str(href);
                self.output.push('>');
                self.output.push_str(RESET);
            }
            InlineNode::Image { src, alt, .. } => {
                self.output.push_str(CYAN);
                self.output.push_str("[image: ");
                self.output.push_str(alt);
                self.output.push_str("](");
                self.output.push_str(src);
                self.output.push(')');
                self.output.push_str(RESET);
            }
            InlineNode::MathInline { latex, .. } => {
                self.output.push_str(latex);
            }
            InlineNode::SoftBreak => self.output.push(' '),
            InlineNode::HardBreak => self.output.push('\n'),
        }
    }

    fn ensure_blank_line(&mut self) {
        self.trim_trailing_spaces();
        if self.output.is_empty() {
            return;
        }
        if !self.output.ends_with('\n') {
            self.output.push('\n');
        }
        if !self.output.ends_with("\n\n") {
            self.output.push('\n');
        }
    }

    fn trim_trailing_spaces(&mut self) {
        while self.output.ends_with(' ') || self.output.ends_with('\t') {
            self.output.pop();
        }
    }
}

pub fn render_agent_markdown(content: &str) -> String {
    render_markdown_ansi(content, &RenderDocumentOptions::default())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn strip_ansi(value: &str) -> String {
        let mut output = String::new();
        let mut chars = value.chars().peekable();
        while let Some(ch) = chars.next() {
            if ch == '\x1b' && chars.peek() == Some(&'[') {
                chars.next();
                for next in chars.by_ref() {
                    if next.is_ascii_alphabetic() {
                        break;
                    }
                }
                continue;
            }
            output.push(ch);
        }
        output
    }

    #[test]
    fn markdown_rendering_adds_terminal_structure() {
        let rendered = render_agent_markdown(
            "# Title\n\n- one\n- `two`\n\n```sh\necho ok\n```\n\n[site](https://example.com)",
        );
        let plain = strip_ansi(&rendered);
        assert!(plain.contains("# Title"));
        assert!(plain.contains("• one") || plain.contains("1. one"));
        assert!(plain.contains("`two`"));
        assert!(plain.contains("╭─ sh"));
        assert!(plain.contains("│ echo ok"));
        assert!(plain.contains("site <https://example.com>"));
    }
}
