mod support;

use lyra_render_core::parse_standard_markdown;
use support::fixture::{
    assert_document_matches_golden, load_commonmark_smoke_fixtures, load_golden_fixtures,
};

#[test]
fn commonmark_smoke_examples_parse_without_panic() {
    let fixtures = load_commonmark_smoke_fixtures();
    assert!(fixtures.len() >= 20, "expected curated smoke fixtures");

    for example in fixtures {
        let document = parse_standard_markdown(&example.markdown);
        assert!(
            !document.blocks.is_empty() || example.markdown.trim().is_empty(),
            "example '{}' produced no blocks",
            example.name
        );
    }
}

#[test]
fn commonmark_golden_ast_expectations_match() {
    let fixtures = load_golden_fixtures();
    assert!(fixtures.cases.len() >= 15, "expected golden AST cases");

    for case in fixtures.cases {
        let document = parse_standard_markdown(&case.markdown);
        assert_document_matches_golden(&document, &case.expect, &case.name);
    }
}
