use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct LyraRenderDocument {
    pub blocks: Vec<RenderBlock>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum RenderBlock {
    Paragraph {
        children: Vec<InlineNode>,
    },
    Heading {
        level: u8,
        children: Vec<InlineNode>,
    },
    Blockquote {
        children: Vec<RenderBlock>,
    },
    List {
        ordered: bool,
        items: Vec<ListItem>,
    },
    CodeBlock {
        language: Option<String>,
        source: String,
        spans: Vec<HighlightSpan>,
    },
    Mermaid {
        source: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        svg: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        error: Option<String>,
    },
    MathBlock {
        latex: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        svg: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        error: Option<String>,
    },
    Table {
        headers: Vec<Vec<InlineNode>>,
        rows: Vec<Vec<Vec<InlineNode>>>,
    },
    ThematicBreak,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ListItem {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub checked: Option<bool>,
    pub children: Vec<RenderBlock>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum InlineNode {
    Text {
        value: String,
    },
    Code {
        value: String,
    },
    Strong {
        children: Vec<InlineNode>,
    },
    Emphasis {
        children: Vec<InlineNode>,
    },
    Strikethrough {
        children: Vec<InlineNode>,
    },
    Link {
        href: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        title: Option<String>,
        children: Vec<InlineNode>,
    },
    Image {
        src: String,
        alt: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        title: Option<String>,
    },
    MathInline {
        latex: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        svg: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        error: Option<String>,
    },
    SoftBreak,
    HardBreak,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HighlightSpan {
    pub start: usize,
    pub end: usize,
    pub scope: String,
}