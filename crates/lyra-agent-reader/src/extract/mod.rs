//! Main-content extraction: choose the DOM root to render based on the mode.

mod readability;
mod score;

use ego_tree::NodeId;
use scraper::selector::Selector;

use crate::errors::ReaderError;
use crate::html::clean::CleanPlan;
use crate::html::parse::ParsedHtml;
use crate::types::{
    ExtractionInfo, ExtractionMode, ReaderExtractorCandidateDebug, ReaderWarning, WarningCode,
};

/// Confidence below which a low-confidence warning is emitted.
const LOW_CONFIDENCE_THRESHOLD: f32 = 0.35;

/// The chosen render root plus how it was selected.
#[derive(Debug)]
pub struct Extracted {
    /// Node id whose children should be rendered.
    pub root_id: NodeId,
    /// Extraction info for the result.
    pub info: ExtractionInfo,
    /// Warnings raised during extraction.
    pub warnings: Vec<ReaderWarning>,
    /// Optional redacted candidate score summaries.
    pub debug_candidates: Vec<ReaderExtractorCandidateDebug>,
    /// Redacted explanation for fallback paths.
    pub fallback_reason: Option<String>,
}

/// Select the render root for the given mode.
pub fn extract(
    parsed: &ParsedHtml,
    plan: &CleanPlan,
    mode: ExtractionMode,
    target_selector: Option<&str>,
    include_debug: bool,
) -> Result<Extracted, ReaderError> {
    if let Some(selector) = target_selector {
        return selector_root(parsed, plan, selector);
    }
    match mode {
        ExtractionMode::Full | ExtractionMode::Text | ExtractionMode::Raw => Ok(full(parsed)),
        ExtractionMode::Main => Ok(main(parsed, plan, include_debug)),
    }
}

fn selector_root(
    parsed: &ParsedHtml,
    plan: &CleanPlan,
    raw_selector: &str,
) -> Result<Extracted, ReaderError> {
    let selector = Selector::parse(raw_selector)
        .map_err(|error| ReaderError::Parse(format!("invalid selector: {error}")))?;
    let root_id = parsed
        .document
        .select(&selector)
        .map(|element| element.id())
        .find(|id| !plan.is_excluded(*id))
        .ok_or_else(|| ReaderError::Parse("target selector matched no elements".to_string()))?;

    Ok(Extracted {
        root_id,
        info: ExtractionInfo {
            method: "selector".to_string(),
            main_content_confidence: 1.0,
            fallback_used: false,
        },
        warnings: Vec::new(),
        debug_candidates: Vec::new(),
        fallback_reason: None,
    })
}

fn full(parsed: &ParsedHtml) -> Extracted {
    Extracted {
        root_id: body_or_root(parsed),
        info: ExtractionInfo {
            method: "full".to_string(),
            main_content_confidence: 1.0,
            fallback_used: false,
        },
        warnings: Vec::new(),
        debug_candidates: Vec::new(),
        fallback_reason: None,
    }
}

fn main(parsed: &ParsedHtml, plan: &CleanPlan, include_debug: bool) -> Extracted {
    let selection = readability::select_with_debug(parsed, plan, include_debug);
    match selection.main {
        Some(main) => {
            let mut warnings = Vec::new();
            if main.confidence < LOW_CONFIDENCE_THRESHOLD {
                warnings.push(ReaderWarning {
                    code: WarningCode::LowMainContentConfidence,
                    message: format!(
                        "main content selected with low confidence ({:.2})",
                        main.confidence
                    ),
                });
            }
            Extracted {
                root_id: main.node_id,
                info: ExtractionInfo {
                    method: "readability".to_string(),
                    main_content_confidence: main.confidence,
                    fallback_used: false,
                },
                warnings,
                debug_candidates: selection.candidates,
                fallback_reason: None,
            }
        }
        None => {
            // Fall back to the full body.
            let mut fallback = full(parsed);
            fallback.info.method = "fallback".to_string();
            fallback.info.main_content_confidence = 0.0;
            fallback.info.fallback_used = true;
            fallback.warnings.push(ReaderWarning {
                code: WarningCode::LowMainContentConfidence,
                message: "no main content candidate; rendered full body".to_string(),
            });
            fallback.fallback_reason =
                Some("no main content candidate; rendered full body".to_string());
            fallback
        }
    }
}

fn body_or_root(parsed: &ParsedHtml) -> NodeId {
    parsed
        .document
        .tree
        .nodes()
        .find(|node| {
            node.value()
                .as_element()
                .is_some_and(|el| el.name() == "body")
        })
        .map(|node| node.id())
        .unwrap_or_else(|| parsed.document.tree.root().id())
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;
    use crate::html::clean::plan;
    use crate::html::parse::parse_str;

    #[test]
    fn full_mode_uses_body() {
        let parsed = parse_str("<html><body><p>hi there friend</p></body></html>");
        let clean = plan(&parsed, None, false);
        let extracted = extract(&parsed, &clean, ExtractionMode::Full, None, false).unwrap();
        let node = parsed.document.tree.get(extracted.root_id).unwrap();
        assert_eq!(node.value().as_element().unwrap().name(), "body");
        assert_eq!(extracted.info.method, "full");
    }

    #[test]
    fn main_mode_low_content_falls_back() {
        let parsed = parse_str("<html><body><nav><a href=\"#\">x</a></nav></body></html>");
        let clean = plan(&parsed, None, true);
        let extracted = extract(&parsed, &clean, ExtractionMode::Main, None, false).unwrap();
        assert!(extracted.info.fallback_used);
        assert!(
            extracted
                .warnings
                .iter()
                .any(|w| w.code == WarningCode::LowMainContentConfidence)
        );
    }

    #[test]
    fn target_selector_uses_first_match() {
        let parsed =
            parse_str("<html><body><main><p>yes</p></main><aside><p>no</p></aside></body></html>");
        let clean = plan(&parsed, None, true);
        let extracted =
            extract(&parsed, &clean, ExtractionMode::Main, Some("main"), false).unwrap();
        let node = parsed.document.tree.get(extracted.root_id).unwrap();
        assert_eq!(node.value().as_element().unwrap().name(), "main");
        assert_eq!(extracted.info.method, "selector");
    }

    #[test]
    fn target_selector_no_match_errors() {
        let parsed = parse_str("<html><body><p>hi</p></body></html>");
        let clean = plan(&parsed, None, true);
        let error = extract(
            &parsed,
            &clean,
            ExtractionMode::Main,
            Some(".missing"),
            false,
        )
        .expect_err("missing selector");
        assert!(
            error
                .to_string()
                .contains("target selector matched no elements")
        );
    }
}
