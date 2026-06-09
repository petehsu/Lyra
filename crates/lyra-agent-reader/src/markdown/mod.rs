//! HTML→Markdown renderer (Turndown-like) operating on a scraper DOM subtree.
//!
//! The renderer walks retained nodes (per the [`CleanPlan`]) recursively,
//! emitting block and inline markdown while collecting links and images. Tables
//! are delegated to [`tables`], inline helpers to [`rules`], and the final
//! whitespace pass to [`whitespace`].

mod rules;
mod tables;
mod whitespace;

use ego_tree::{NodeId, NodeRef};
use scraper::Node;
use url::Url;

use crate::citation::{CitationState, citation_marker};
use crate::html::clean::{CleanPlan, resolve_url};
use crate::types::{
    CitationFormat, HeadingStyle, ImageRetention, LinkRetention, MarkdownOptions, MediaRetention,
    ReaderImage, ReaderLink, ReaderMedia,
};

/// Raw link captured during rendering (before retention/citation post-processing).
#[derive(Clone, Debug)]
pub struct CapturedLink {
    /// Absolute URL.
    pub url: String,
    /// Anchor text.
    pub text: String,
    /// Title attribute.
    pub title: Option<String>,
    /// `rel` attribute.
    pub rel: Option<String>,
    /// Nearest enclosing heading text at capture time.
    pub section: Option<String>,
    /// Best-effort DOM path/source hint.
    pub dom_path: Option<String>,
    /// Source byte offset when parser support is available.
    pub source_offset: Option<usize>,
}

/// The output of a render pass.
pub struct Rendered {
    /// Rendered markdown (pre whitespace-normalization is already applied).
    pub markdown: String,
    /// Captured links in document order.
    pub links: Vec<CapturedLink>,
    /// Captured images in document order.
    pub images: Vec<ReaderImage>,
    /// Captured media embeds in document order.
    pub media: Vec<ReaderMedia>,
    /// Citation numbering state (populated when citation markers were emitted).
    pub citations: CitationState,
}

/// Stateful markdown renderer over a cleaned DOM.
pub struct Renderer<'a> {
    plan: &'a CleanPlan,
    options: &'a MarkdownOptions,
    link_retention: LinkRetention,
    image_retention: ImageRetention,
    media_retention: MediaRetention,
    citation_format: CitationFormat,
    collect_media: bool,
    emit_citations: bool,
    links: Vec<CapturedLink>,
    images: Vec<ReaderImage>,
    media: Vec<ReaderMedia>,
    citations: CitationState,
    current_heading: Option<String>,
}

impl<'a> Renderer<'a> {
    /// Build a renderer with the given cleaning plan and options.
    pub fn new(
        plan: &'a CleanPlan,
        options: &'a MarkdownOptions,
        link_retention: LinkRetention,
        image_retention: ImageRetention,
        media_retention: MediaRetention,
        citation_format: CitationFormat,
        collect_media: bool,
        emit_citations: bool,
    ) -> Self {
        Self {
            plan,
            options,
            link_retention,
            image_retention,
            media_retention,
            citation_format,
            collect_media,
            emit_citations,
            links: Vec::new(),
            images: Vec::new(),
            media: Vec::new(),
            citations: CitationState::default(),
            current_heading: None,
        }
    }

    /// Whether a node was excluded by the cleaning plan.
    pub fn is_excluded(&self, id: NodeId) -> bool {
        self.plan.is_excluded(id)
    }

    /// Render the block content of `root` (its children) to markdown.
    pub fn render(mut self, root: NodeRef<'a, Node>) -> Rendered {
        let mut out = String::new();
        self.render_block_children(root, &mut out);
        Rendered {
            markdown: whitespace::normalize(&out),
            links: self.links,
            images: self.images,
            media: self.media,
            citations: self.citations,
        }
    }

    /// Render the children of `node` as a sequence of blocks.
    fn render_block_children(&mut self, node: NodeRef<'a, Node>, out: &mut String) {
        for child in node.children() {
            if self.is_excluded(child.id()) {
                continue;
            }
            self.render_block(child, out);
        }
    }

    /// Render a single node in block context.
    fn render_block(&mut self, node: NodeRef<'a, Node>, out: &mut String) {
        match node.value() {
            Node::Text(text) => {
                let collapsed = rules::collapse_ws(text);
                if !collapsed.trim().is_empty() {
                    push_block(out, &collapsed);
                }
            }
            Node::Element(element) => {
                let tag = element.name().to_string();
                match tag.as_str() {
                    "h1" | "h2" | "h3" | "h4" | "h5" | "h6" => self.render_heading(node, &tag, out),
                    "p" => {
                        let inline = self.render_inline_subtree(node);
                        if !inline.trim().is_empty() {
                            push_block(out, inline.trim());
                        }
                    }
                    "br" => out.push('\n'),
                    "hr" => push_block(out, "---"),
                    "pre" => self.render_pre(node, out),
                    "blockquote" => self.render_blockquote(node, out),
                    "ul" | "ol" => self.render_list(node, &tag, 0, out),
                    "table" => self.render_table(node, out),
                    "figure" => self.render_block_children(node, out),
                    "img" => {
                        let mut inline = String::new();
                        self.render_image(node, &mut inline);
                        if !inline.trim().is_empty() {
                            push_block(out, inline.trim());
                        }
                    }
                    "video" | "audio" | "iframe" | "embed" | "object" | "source" => {
                        self.render_media_block(node, &tag, out);
                    }
                    "figcaption" => {
                        let inline = self.render_inline_subtree(node);
                        if !inline.trim().is_empty() {
                            push_block(out, inline.trim());
                        }
                    }
                    // Generic containers: recurse into block children.
                    "div" | "section" | "article" | "main" | "body" | "html" | "span" | "a"
                    | "details" | "summary" | "dl" | "dd" | "dt" => {
                        // Inline-ish elements that may appear at block level: if
                        // they have only inline content, emit as a paragraph.
                        if is_inline_only(self, node) {
                            let inline = self.render_inline_subtree(node);
                            if !inline.trim().is_empty() {
                                push_block(out, inline.trim());
                            }
                        } else {
                            self.render_block_children(node, out);
                        }
                    }
                    _ => self.render_block_children(node, out),
                }
            }
            _ => {}
        }
    }

    fn render_heading(&mut self, node: NodeRef<'a, Node>, tag: &str, out: &mut String) {
        let level = tag.chars().nth(1).and_then(|c| c.to_digit(10)).unwrap_or(1) as usize;
        let text = self.render_inline_subtree(node);
        let text = text.trim();
        if text.is_empty() {
            return;
        }
        self.current_heading = Some(text.to_string());
        if self.options.heading_style == HeadingStyle::Setext && level <= 2 {
            let underline = if level == 1 { '=' } else { '-' };
            let width = text.chars().count().max(1);
            push_block(
                out,
                &format!("{text}\n{}", underline.to_string().repeat(width)),
            );
        } else {
            let hashes = "#".repeat(level.clamp(1, 6));
            push_block(out, &format!("{hashes} {text}"));
        }
    }

    fn render_pre(&mut self, node: NodeRef<'a, Node>, out: &mut String) {
        let pre_el = node.value().as_element();
        // Find a nested <code> for language inference and text.
        let code_node = node.children().find(|child| {
            child
                .value()
                .as_element()
                .is_some_and(|el| el.name() == "code")
        });
        let code_el = code_node.and_then(|n| n.value().as_element());
        let lang = rules::infer_code_language(pre_el, code_el).unwrap_or_default();
        let content_node = code_node.unwrap_or(node);
        let code_text = collect_raw_text(content_node);
        let fence = self.options.code_fence.to_string().repeat(3);
        let trimmed = code_text.trim_end_matches('\n');
        push_block(out, &format!("{fence}{lang}\n{trimmed}\n{fence}"));
    }

    fn render_blockquote(&mut self, node: NodeRef<'a, Node>, out: &mut String) {
        let mut inner = String::new();
        self.render_block_children(node, &mut inner);
        let inner = whitespace::normalize(&inner);
        let quoted = inner
            .lines()
            .map(|line| {
                if line.is_empty() {
                    ">".to_string()
                } else {
                    format!("> {line}")
                }
            })
            .collect::<Vec<_>>()
            .join("\n");
        if !quoted.trim_matches(['>', ' ', '\n']).is_empty() {
            push_block(out, &quoted);
        }
    }

    fn render_list(&mut self, node: NodeRef<'a, Node>, tag: &str, depth: usize, out: &mut String) {
        let ordered = tag == "ol";
        let mut index = 1usize;
        let mut block = String::new();
        for child in node.children() {
            if self.is_excluded(child.id()) {
                continue;
            }
            let Some(element) = child.value().as_element() else {
                continue;
            };
            if element.name() != "li" {
                continue;
            }
            let marker = if ordered {
                format!("{index}.")
            } else {
                self.options.bullet_marker.to_string()
            };
            self.render_list_item(child, &marker, depth, &mut block);
            index += 1;
        }
        if !block.trim().is_empty() {
            if depth == 0 {
                push_block(out, block.trim_end());
            } else {
                out.push_str(&block);
            }
        }
    }

    fn render_list_item(
        &mut self,
        node: NodeRef<'a, Node>,
        marker: &str,
        depth: usize,
        out: &mut String,
    ) {
        let indent = "  ".repeat(depth);
        let task = task_marker(node);
        // Inline content of the item (excluding nested lists).
        let inline = self.render_item_inline(node);
        let prefix = match task {
            Some(checked) => format!("{indent}{marker} [{}] ", if checked { 'x' } else { ' ' }),
            None => format!("{indent}{marker} "),
        };
        let mut line = format!("{prefix}{}", inline.trim());
        line = line.trim_end().to_string();
        out.push_str(&line);
        out.push('\n');

        // Nested lists.
        for child in node.children() {
            if self.is_excluded(child.id()) {
                continue;
            }
            if let Some(element) = child.value().as_element() {
                if matches!(element.name(), "ul" | "ol") {
                    self.render_list(child, element.name(), depth + 1, out);
                }
            }
        }
    }

    /// Inline content of a list item, skipping nested lists.
    fn render_item_inline(&mut self, node: NodeRef<'a, Node>) -> String {
        let mut out = String::new();
        for child in node.children() {
            if self.is_excluded(child.id()) {
                continue;
            }
            if let Some(element) = child.value().as_element() {
                if matches!(element.name(), "ul" | "ol") {
                    continue;
                }
            }
            self.render_inline(child, &mut out);
        }
        out
    }

    fn render_table(&mut self, node: NodeRef<'a, Node>, out: &mut String) {
        if self.options.gfm_tables {
            if let Some(rendered) = tables::render_table(self, node) {
                push_block(out, rendered.trim_end());
                return;
            }
        }
        // Fallback: render rows as text lines.
        self.render_block_children(node, out);
    }

    /// Render a subtree as inline markdown (for headings, paragraphs, cells).
    pub fn render_inline_subtree(&mut self, node: NodeRef<'a, Node>) -> String {
        let mut out = String::new();
        for child in node.children() {
            if self.is_excluded(child.id()) {
                continue;
            }
            self.render_inline(child, &mut out);
        }
        out
    }

    /// Render a node in inline context.
    fn render_inline(&mut self, node: NodeRef<'a, Node>, out: &mut String) {
        match node.value() {
            Node::Text(text) => out.push_str(&rules::escape_inline(&rules::collapse_ws(text))),
            Node::Element(element) => {
                let tag = element.name();
                match tag {
                    "strong" | "b" => {
                        let inner = self.render_inline_subtree(node);
                        out.push_str(&rules::wrap("**", &inner));
                    }
                    "em" | "i" => {
                        let inner = self.render_inline_subtree(node);
                        out.push_str(&rules::wrap("*", &inner));
                    }
                    "del" | "s" | "strike" => {
                        let inner = self.render_inline_subtree(node);
                        out.push_str(&rules::wrap("~~", &inner));
                    }
                    "code" => {
                        let raw = collect_raw_text(node);
                        out.push('`');
                        out.push_str(raw.trim());
                        out.push('`');
                    }
                    "br" => out.push_str("  \n"),
                    "a" => self.render_anchor(node, out),
                    "img" => self.render_image(node, out),
                    "video" | "audio" | "iframe" | "embed" | "object" | "source" => {
                        self.render_media_inline(node, tag, out);
                    }
                    tag if self.should_preserve_html_tag(tag) => {
                        self.render_preserved_inline_html(node, tag, out);
                    }
                    "wbr" => {}
                    _ => {
                        let inner = self.render_inline_subtree(node);
                        out.push_str(&inner);
                    }
                }
            }
            _ => {}
        }
    }

    fn render_anchor(&mut self, node: NodeRef<'a, Node>, out: &mut String) {
        let element = match node.value().as_element() {
            Some(element) => element,
            None => return,
        };
        let text = self.render_inline_subtree(node);
        let href = element.attr("href").map(|raw| resolve_url(self.plan, raw));

        if let Some(url) = &href {
            if url.starts_with("http://") || url.starts_with("https://") {
                self.links.push(CapturedLink {
                    url: url.clone(),
                    text: strip_markdown(&text),
                    title: element.attr("title").map(str::to_string),
                    rel: element.attr("rel").map(str::to_string),
                    section: self.current_heading.clone(),
                    dom_path: Some(dom_path(node)),
                    source_offset: None,
                });
            }
        }

        let is_web = href
            .as_deref()
            .is_some_and(|url| url.starts_with("http://") || url.starts_with("https://"));

        match (self.link_retention, href) {
            (LinkRetention::All, Some(url)) if is_web => {
                let title = element
                    .attr("title")
                    .map(|t| format!(" \"{t}\""))
                    .unwrap_or_default();
                out.push_str(&format!("[{}]({}{})", text.trim(), url, title));
                if self.emit_citations {
                    let number = self.citations.number_for(&url);
                    out.push_str(&citation_marker(number, self.citation_format));
                }
            }
            (LinkRetention::Citations, Some(url)) if is_web => {
                out.push_str(text.trim());
                let number = self.citations.number_for(&url);
                out.push_str(&citation_marker(number, self.citation_format));
            }
            (LinkRetention::Summary, Some(url)) if is_web => {
                out.push_str(text.trim());
                self.citations.number_for(&url);
            }
            // Text/None (and non-web hrefs) collapse to anchor text inline.
            _ => out.push_str(text.trim()),
        }
    }

    fn render_image(&mut self, node: NodeRef<'a, Node>, out: &mut String) {
        let element = match node.value().as_element() {
            Some(element) => element,
            None => return,
        };
        let src = element.attr("src").map(|raw| resolve_url(self.plan, raw));
        let Some(url) = src else { return };
        let alt = element.attr("alt").map(str::to_string);
        let title = element.attr("title").map(str::to_string);
        let srcset = element
            .attr("srcset")
            .map(|raw| parse_srcset(self.plan, raw))
            .unwrap_or_default();
        let width = element.attr("width").and_then(parse_dimension);
        let height = element.attr("height").and_then(parse_dimension);
        let caption = figure_caption(self, node);
        let likely_decorative = is_decorative_image(alt.as_deref(), width, height, &url);

        self.images.push(ReaderImage {
            url: url.clone(),
            alt: alt.clone(),
            title: title.clone(),
            srcset,
            width,
            height,
            caption,
            likely_decorative,
        });

        match self.image_retention {
            ImageRetention::All => {
                let alt_text = alt.unwrap_or_default();
                let title_part = title.map(|t| format!(" \"{t}\"")).unwrap_or_default();
                out.push_str(&format!("![{alt_text}]({url}{title_part})"));
            }
            ImageRetention::Alt | ImageRetention::Summary => {
                if let Some(alt_text) = alt {
                    if !alt_text.trim().is_empty() {
                        out.push_str(alt_text.trim());
                    }
                }
            }
            ImageRetention::None => {}
        }
    }

    fn render_media_block(&mut self, node: NodeRef<'a, Node>, tag: &str, out: &mut String) {
        if !self.collect_media {
            if tag != "iframe" {
                self.render_block_children(node, out);
            }
            return;
        }
        if let Some(rendered) = self.capture_and_render_media(node, tag) {
            if !rendered.trim().is_empty() {
                push_block(out, rendered.trim());
            }
        }
    }

    fn render_media_inline(&mut self, node: NodeRef<'a, Node>, tag: &str, out: &mut String) {
        if !self.collect_media {
            if tag != "iframe" {
                out.push_str(&self.render_inline_subtree(node));
            }
            return;
        }
        if let Some(rendered) = self.capture_and_render_media(node, tag) {
            out.push_str(rendered.trim());
        }
    }

    fn capture_and_render_media(&mut self, node: NodeRef<'a, Node>, tag: &str) -> Option<String> {
        let media = media_from_node(self.plan, node, tag)?;
        self.media.push(media.clone());
        Some(render_media(&media, self.media_retention))
    }

    fn should_preserve_html_tag(&self, tag: &str) -> bool {
        is_safe_preserved_tag(tag)
            && self
                .options
                .preserve_html_tags
                .iter()
                .any(|allowed| allowed.eq_ignore_ascii_case(tag))
    }

    fn render_preserved_inline_html(
        &mut self,
        node: NodeRef<'a, Node>,
        tag: &str,
        out: &mut String,
    ) {
        let inner = self.render_inline_subtree(node);
        if inner.trim().is_empty() {
            return;
        }
        let attrs = node
            .value()
            .as_element()
            .and_then(|element| {
                if tag.eq_ignore_ascii_case("abbr") {
                    element
                        .attr("title")
                        .map(str::trim)
                        .filter(|value| !value.is_empty())
                        .map(|title| format!(" title=\"{}\"", escape_html_attr(title)))
                } else {
                    None
                }
            })
            .unwrap_or_default();
        out.push_str(&format!(
            "<{tag}{attrs}>{}</{tag}>",
            escape_html_text(&inner)
        ));
    }
}

/// Append `text` to `out` as a block, ensuring a blank-line separator.
fn push_block(out: &mut String, text: &str) {
    if !out.is_empty() {
        if !out.ends_with('\n') {
            out.push('\n');
        }
        out.push('\n');
    }
    out.push_str(text);
    out.push('\n');
}

fn is_safe_preserved_tag(tag: &str) -> bool {
    matches!(
        tag,
        "mark" | "sub" | "sup" | "kbd" | "abbr" | "small" | "u" | "ins"
    )
}

/// Whether all of `node`'s retained children are inline-level.
fn is_inline_only(renderer: &Renderer<'_>, node: NodeRef<'_, Node>) -> bool {
    const BLOCK_TAGS: &[&str] = &[
        "p",
        "div",
        "section",
        "article",
        "main",
        "ul",
        "ol",
        "li",
        "table",
        "pre",
        "blockquote",
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "hr",
        "figure",
        "video",
        "audio",
        "iframe",
        "embed",
        "object",
        "source",
        "dl",
    ];
    for child in node.children() {
        if renderer.is_excluded(child.id()) {
            continue;
        }
        if let Some(element) = child.value().as_element() {
            if BLOCK_TAGS.contains(&element.name()) {
                return false;
            }
            if !is_inline_only(renderer, child) {
                return false;
            }
        }
    }
    true
}

/// Detect a task-list checkbox in a list item, returning its checked state.
fn task_marker(node: NodeRef<'_, Node>) -> Option<bool> {
    for descendant in node.descendants() {
        if let Some(element) = descendant.value().as_element() {
            if element.name() == "input"
                && element
                    .attr("type")
                    .is_some_and(|t| t.eq_ignore_ascii_case("checkbox"))
            {
                return Some(element.attr("checked").is_some());
            }
        }
    }
    None
}

/// Collect raw (un-collapsed) text of a subtree — used for code blocks.
fn collect_raw_text(node: NodeRef<'_, Node>) -> String {
    let mut out = String::new();
    for descendant in node.descendants() {
        if let Node::Text(text) = descendant.value() {
            out.push_str(text);
        }
    }
    out
}

/// Strip simple markdown emphasis from captured anchor text for the link list.
fn strip_markdown(text: &str) -> String {
    text.replace("**", "")
        .replace('`', "")
        .replace('\\', "")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// Parse a `srcset` attribute into resolved candidate URLs.
fn parse_srcset(plan: &CleanPlan, srcset: &str) -> Vec<String> {
    srcset
        .split(',')
        .filter_map(|candidate| candidate.split_whitespace().next())
        .filter(|url| !url.is_empty())
        .map(|url| resolve_url(plan, url))
        .collect()
}

fn parse_dimension(value: &str) -> Option<u32> {
    value
        .trim()
        .trim_end_matches("px")
        .parse::<u32>()
        .ok()
        .filter(|value| *value > 0)
}

fn figure_caption<'a>(renderer: &mut Renderer<'a>, node: NodeRef<'a, Node>) -> Option<String> {
    let figure = node.ancestors().find(|ancestor| {
        ancestor
            .value()
            .as_element()
            .is_some_and(|element| element.name() == "figure")
    })?;
    for child in figure.children() {
        if renderer.is_excluded(child.id()) {
            continue;
        }
        if child
            .value()
            .as_element()
            .is_some_and(|element| element.name() == "figcaption")
        {
            let caption = renderer.render_inline_subtree(child);
            let caption = strip_markdown(&caption);
            return (!caption.trim().is_empty()).then_some(caption);
        }
    }
    None
}

fn is_decorative_image(
    alt: Option<&str>,
    width: Option<u32>,
    height: Option<u32>,
    url: &str,
) -> bool {
    let empty_alt = alt.is_none_or(|value| value.trim().is_empty());
    let tiny = width.zip(height).is_some_and(|(w, h)| w <= 2 || h <= 2);
    let lower_url = url.to_ascii_lowercase();
    empty_alt
        && (tiny
            || lower_url.contains("spacer")
            || lower_url.contains("pixel")
            || lower_url.contains("tracking"))
}

fn media_from_node(plan: &CleanPlan, node: NodeRef<'_, Node>, tag: &str) -> Option<ReaderMedia> {
    let element = node.value().as_element()?;
    let (raw_url, source_mime) = media_url_and_mime(node, tag);
    let url = raw_url
        .as_deref()
        .map(|raw| canonical_media_url(&resolve_url(plan, raw)));
    let title = first_non_empty_attr(element, &["title", "aria-label", "name"]);
    let text = media_text(node, title.as_deref());
    let poster = if tag == "video" {
        element
            .attr("poster")
            .map(|raw| canonical_media_url(&resolve_url(plan, raw)))
    } else {
        None
    };
    let mime_type = first_non_empty_attr(element, &["type"]).or(source_mime);
    let width = element.attr("width").and_then(parse_dimension);
    let height = element.attr("height").and_then(parse_dimension);
    if url.is_none() && title.is_none() && text.is_none() && poster.is_none() {
        return None;
    }
    Some(ReaderMedia {
        kind: tag.to_string(),
        url,
        title,
        text,
        poster,
        mime_type,
        width,
        height,
    })
}

fn media_url_and_mime(node: NodeRef<'_, Node>, tag: &str) -> (Option<String>, Option<String>) {
    let element = match node.value().as_element() {
        Some(element) => element,
        None => return (None, None),
    };
    match tag {
        "video" | "audio" => {
            let direct = first_non_empty_attr(element, &["src"]);
            if direct.is_some() {
                return (direct, first_non_empty_attr(element, &["type"]));
            }
            first_source_child(node)
        }
        "iframe" | "embed" | "source" => (
            first_non_empty_attr(element, &["src"]),
            first_non_empty_attr(element, &["type"]),
        ),
        "object" => (
            first_non_empty_attr(element, &["data", "src"]),
            first_non_empty_attr(element, &["type"]),
        ),
        _ => (None, None),
    }
}

fn first_source_child(node: NodeRef<'_, Node>) -> (Option<String>, Option<String>) {
    for child in node.children() {
        let Some(element) = child.value().as_element() else {
            continue;
        };
        if element.name() != "source" {
            continue;
        }
        let url = first_non_empty_attr(element, &["src"]);
        if url.is_some() {
            return (url, first_non_empty_attr(element, &["type"]));
        }
    }
    (None, None)
}

fn first_non_empty_attr(element: &scraper::node::Element, attrs: &[&str]) -> Option<String> {
    attrs.iter().find_map(|attr| {
        element
            .attr(attr)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
    })
}

fn media_text(node: NodeRef<'_, Node>, title: Option<&str>) -> Option<String> {
    let text = strip_markdown(&rules::collapse_ws(&collect_raw_text(node)));
    if text.is_empty() || title.is_some_and(|title| title.trim() == text) {
        None
    } else {
        Some(text)
    }
}

fn render_media(media: &ReaderMedia, retention: MediaRetention) -> String {
    match retention {
        MediaRetention::Link => match media.url.as_deref() {
            Some(url) => format!("[{}]({url})", rules::escape_inline(&media_label(media))),
            None => rules::escape_inline(&media_label(media)),
        },
        MediaRetention::Text => rules::escape_inline(&media_label(media)),
        MediaRetention::Html => render_media_html(media),
        MediaRetention::Summary | MediaRetention::None => String::new(),
    }
}

fn media_label(media: &ReaderMedia) -> String {
    media
        .title
        .as_deref()
        .or(media.text.as_deref())
        .or(media.url.as_deref())
        .unwrap_or(&media.kind)
        .trim()
        .to_string()
}

fn render_media_html(media: &ReaderMedia) -> String {
    let mut attrs = Vec::new();
    if let Some(url) = &media.url {
        let attr_name = if media.kind == "object" {
            "data"
        } else {
            "src"
        };
        attrs.push(format!("{attr_name}=\"{}\"", escape_html_attr(url)));
    }
    if let Some(title) = &media.title {
        attrs.push(format!("title=\"{}\"", escape_html_attr(title)));
    }
    if let Some(poster) = &media.poster {
        attrs.push(format!("poster=\"{}\"", escape_html_attr(poster)));
    }
    if let Some(mime) = &media.mime_type {
        attrs.push(format!("type=\"{}\"", escape_html_attr(mime)));
    }
    if let Some(width) = media.width {
        attrs.push(format!("width=\"{width}\""));
    }
    if let Some(height) = media.height {
        attrs.push(format!("height=\"{height}\""));
    }
    if matches!(media.kind.as_str(), "video" | "audio") {
        attrs.push("controls".to_string());
    }
    let attrs = if attrs.is_empty() {
        String::new()
    } else {
        format!(" {}", attrs.join(" "))
    };
    match media.kind.as_str() {
        "audio" => format!("<audio{attrs}></audio>"),
        "iframe" => format!("<iframe{attrs}></iframe>"),
        "embed" => format!("<embed{attrs}>"),
        "object" => format!("<object{attrs}></object>"),
        _ => format!("<video{attrs}></video>"),
    }
}

fn escape_html_attr(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('"', "&quot;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

fn escape_html_text(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

fn canonical_media_url(url: &str) -> String {
    let Ok(parsed) = Url::parse(url) else {
        return url.to_string();
    };
    let host = parsed.host_str().unwrap_or("").to_ascii_lowercase();
    if let Some(id) = youtube_id(&parsed, &host) {
        return format!("https://www.youtube.com/watch?v={id}");
    }
    if let Some(id) = vimeo_id(&parsed, &host) {
        return format!("https://vimeo.com/{id}");
    }
    if let Some(id) = bilibili_id(&parsed, &host) {
        return format!("https://www.bilibili.com/video/{id}");
    }
    url.to_string()
}

fn youtube_id(url: &Url, host: &str) -> Option<String> {
    if host == "youtu.be" {
        return path_segment(url, 0);
    }
    if !host.ends_with("youtube.com") && !host.ends_with("youtube-nocookie.com") {
        return None;
    }
    if url.path() == "/watch" {
        return url
            .query_pairs()
            .find(|(key, _)| key == "v")
            .map(|(_, value)| value.to_string())
            .filter(|value| !value.trim().is_empty());
    }
    match path_segment(url, 0).as_deref() {
        Some("embed" | "shorts" | "v") => path_segment(url, 1),
        _ => None,
    }
}

fn vimeo_id(url: &Url, host: &str) -> Option<String> {
    if !host.ends_with("vimeo.com") {
        return None;
    }
    let first = path_segment(url, 0)?;
    let candidate = if first == "video" {
        path_segment(url, 1)?
    } else {
        first
    };
    candidate
        .chars()
        .all(|ch| ch.is_ascii_digit())
        .then_some(candidate)
}

fn bilibili_id(url: &Url, host: &str) -> Option<String> {
    if !host.ends_with("bilibili.com") {
        return None;
    }
    for segment in url.path_segments()? {
        if segment.starts_with("BV") || segment.starts_with("av") {
            return Some(segment.to_string());
        }
    }
    url.query_pairs()
        .find(|(key, _)| key == "bvid" || key == "aid")
        .map(|(key, value)| {
            if key == "aid" {
                format!("av{value}")
            } else {
                value.to_string()
            }
        })
        .filter(|value| !value.trim().is_empty())
}

fn path_segment(url: &Url, index: usize) -> Option<String> {
    url.path_segments()?
        .nth(index)
        .map(str::to_string)
        .filter(|value| !value.trim().is_empty())
}

/// Convenience: convert captured links to public [`ReaderLink`]s.
pub fn to_reader_links(captured: &[CapturedLink]) -> Vec<ReaderLink> {
    captured
        .iter()
        .map(|link| ReaderLink {
            url: link.url.clone(),
            text: non_empty(&link.text),
            title: link.title.clone(),
            rel: link.rel.clone(),
            section: link.section.clone(),
            dom_path: link.dom_path.clone(),
            source_offset: link.source_offset,
        })
        .collect()
}

fn dom_path(node: NodeRef<'_, Node>) -> String {
    let mut tags = Vec::new();
    let mut current = Some(node);
    while let Some(item) = current {
        if let Some(element) = item.value().as_element() {
            tags.push(element.name().to_string());
        }
        current = item.parent();
    }
    tags.reverse();
    tags.join(">")
}

fn non_empty(value: &str) -> Option<String> {
    let trimmed = value.trim();
    (!trimmed.is_empty()).then(|| trimmed.to_string())
}
