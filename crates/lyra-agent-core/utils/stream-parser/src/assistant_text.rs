use crate::CitationStreamParser;
use crate::InlineHiddenTagParser;
use crate::InlineTagSpec;
use crate::StreamTextParser;

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct AssistantTextChunk {
    pub visible_text: String,
    pub citations: Vec<String>,
}

impl AssistantTextChunk {
    pub fn is_empty(&self) -> bool {
        self.visible_text.is_empty() && self.citations.is_empty()
    }
}

/// Parses assistant text streaming markup in one pass:
/// - strips `<oai-mem-citation>` tags and extracts citation payloads
#[derive(Debug, Default)]
pub struct AssistantTextStreamParser {
    citations: CitationStreamParser,
    plan_tags: Option<InlineHiddenTagParser<AssistantHiddenTag>>,
}

impl AssistantTextStreamParser {
    pub fn new(plan_mode: bool) -> Self {
        Self {
            citations: CitationStreamParser::default(),
            plan_tags: plan_mode.then(|| {
                InlineHiddenTagParser::new(vec![
                    InlineTagSpec {
                        tag: AssistantHiddenTag::ProposedPlan,
                        open: "<proposed_plan>",
                        close: "</proposed_plan>",
                    },
                    InlineTagSpec {
                        tag: AssistantHiddenTag::DraftPlan,
                        open: "<draft_plan>",
                        close: "</draft_plan>",
                    },
                ])
            }),
        }
    }

    pub fn push_str(&mut self, chunk: &str) -> AssistantTextChunk {
        let visible_chunk = match self.plan_tags.as_mut() {
            Some(parser) => parser.push_str(chunk).visible_text,
            None => chunk.to_string(),
        };
        let citation_chunk = self.citations.push_str(&visible_chunk);
        AssistantTextChunk {
            visible_text: citation_chunk.visible_text,
            citations: citation_chunk.extracted,
        }
    }

    pub fn finish(&mut self) -> AssistantTextChunk {
        let mut citations = Vec::new();
        let mut visible_text = String::new();
        if let Some(parser) = self.plan_tags.as_mut() {
            let plan_tail = parser.finish();
            let citation_tail = self.citations.push_str(&plan_tail.visible_text);
            visible_text.push_str(&citation_tail.visible_text);
            citations.extend(citation_tail.extracted);
        }
        let citation_chunk = self.citations.finish();
        visible_text.push_str(&citation_chunk.visible_text);
        citations.extend(citation_chunk.extracted);
        AssistantTextChunk {
            visible_text,
            citations,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum AssistantHiddenTag {
    ProposedPlan,
    DraftPlan,
}

#[cfg(test)]
mod tests {
    use super::AssistantTextStreamParser;
    use pretty_assertions::assert_eq;

    #[test]
    fn parses_citations_across_seed_and_delta_boundaries() {
        let mut parser = AssistantTextStreamParser::new(/*plan_mode*/ false);

        let seeded = parser.push_str("hello <oai-mem-citation>doc");
        let parsed = parser.push_str("1</oai-mem-citation> world");
        let tail = parser.finish();

        assert_eq!(seeded.visible_text, "hello ");
        assert_eq!(seeded.citations, Vec::<String>::new());
        assert_eq!(parsed.visible_text, " world");
        assert_eq!(parsed.citations, vec!["doc1".to_string()]);
        assert_eq!(tail.visible_text, "");
        assert_eq!(tail.citations, Vec::<String>::new());
    }

    #[test]
    fn plan_tags_are_hidden_in_plan_mode() {
        let mut parser = AssistantTextStreamParser::new(/*plan_mode*/ true);

        let seeded = parser.push_str("Intro\n<draft");
        let parsed = parser.push_str("_plan>\n- step <oai-mem-citation>doc</oai-mem-citation>\n");
        let tail = parser.push_str("</draft_plan>\nOutro");
        let finish = parser.finish();

        assert_eq!(seeded.visible_text, "Intro\n");
        assert_eq!(parsed.visible_text, "");
        assert_eq!(parsed.citations, Vec::<String>::new());
        assert_eq!(tail.visible_text, "\nOutro");
        assert!(finish.is_empty());
    }

    #[test]
    fn plan_tags_are_plain_visible_text_outside_plan_mode() {
        let mut parser = AssistantTextStreamParser::new(/*plan_mode*/ false);

        let parsed = parser.push_str("<proposed_plan>\n- step\n</proposed_plan>");

        assert_eq!(
            parsed.visible_text,
            "<proposed_plan>\n- step\n</proposed_plan>"
        );
    }
}
