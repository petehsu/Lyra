use lyra_agent_reader::{
    ChunkingMode, ChunkingOptions, ContentFilterMode, Format, ImageRetention, LinkRetention,
    ReaderOptions, ReaderResult, WarningCode, read_html,
};
use serde_json::json;

struct Fixture {
    slug: &'static str,
    html: &'static str,
}

const FIXTURES: &[Fixture] = &[
    Fixture {
        slug: "clean_article",
        html: include_str!("fixtures/html/clean_article.html"),
    },
    Fixture {
        slug: "noisy_article",
        html: include_str!("fixtures/html/noisy_article.html"),
    },
    Fixture {
        slug: "documentation_page",
        html: include_str!("fixtures/html/documentation_page.html"),
    },
    Fixture {
        slug: "ecommerce_listing",
        html: include_str!("fixtures/html/ecommerce_listing.html"),
    },
    Fixture {
        slug: "table_heavy_report",
        html: include_str!("fixtures/html/table_heavy_report.html"),
    },
    Fixture {
        slug: "code_heavy_tutorial",
        html: include_str!("fixtures/html/code_heavy_tutorial.html"),
    },
    Fixture {
        slug: "malformed_html",
        html: include_str!("fixtures/html/malformed_html.html"),
    },
    Fixture {
        slug: "deep_nested_layout",
        html: include_str!("fixtures/html/deep_nested_layout.html"),
    },
    Fixture {
        slug: "spa_shell",
        html: include_str!("fixtures/html/spa_shell.html"),
    },
    Fixture {
        slug: "news_article_related",
        html: include_str!("fixtures/html/news_article_related.html"),
    },
    Fixture {
        slug: "blog_with_comments",
        html: include_str!("fixtures/html/blog_with_comments.html"),
    },
    Fixture {
        slug: "recipe_page",
        html: include_str!("fixtures/html/recipe_page.html"),
    },
    Fixture {
        slug: "faq_static",
        html: include_str!("fixtures/html/faq_static.html"),
    },
    Fixture {
        slug: "api_reference",
        html: include_str!("fixtures/html/api_reference.html"),
    },
    Fixture {
        slug: "release_notes",
        html: include_str!("fixtures/html/release_notes.html"),
    },
    Fixture {
        slug: "forum_thread",
        html: include_str!("fixtures/html/forum_thread.html"),
    },
    Fixture {
        slug: "product_comparison",
        html: include_str!("fixtures/html/product_comparison.html"),
    },
    Fixture {
        slug: "image_gallery",
        html: include_str!("fixtures/html/image_gallery.html"),
    },
    Fixture {
        slug: "multilingual_article",
        html: include_str!("fixtures/html/multilingual_article.html"),
    },
    Fixture {
        slug: "landing_weak_signal",
        html: include_str!("fixtures/html/landing_weak_signal.html"),
    },
    Fixture {
        slug: "github_readme_like",
        html: include_str!("fixtures/html/github_readme_like.html"),
    },
];

#[test]
fn golden_html_fixture_count_is_first_release_ready() {
    assert!(
        FIXTURES.len() >= 20,
        "first useful release requires at least 20 HTML golden fixtures"
    );
}

#[test]
fn golden_html_markdown_snapshots_are_stable() {
    let options = golden_options();

    for fixture in FIXTURES {
        let base_url = format!("https://example.test/{}/", fixture.slug);
        let result =
            read_html(fixture.html, Some(&base_url), &options).expect("fixture should render");

        assert_eq!(
            result.format,
            Format::Html,
            "{} should be detected as HTML",
            fixture.slug
        );
        assert!(
            !result.markdown_with_citations.trim().is_empty(),
            "{} should render non-empty markdown",
            fixture.slug
        );

        insta::assert_snapshot!(
            format!("{}__summary", fixture.slug),
            serde_json::to_string_pretty(&stable_summary(&result)).expect("summary json")
        );
        insta::assert_snapshot!(
            format!("{}__markdown", fixture.slug),
            normalize_snapshot_text(&result.markdown_with_citations)
        );
    }
}

fn golden_options() -> ReaderOptions {
    ReaderOptions {
        max_chars: None,
        retain_links: LinkRetention::Summary,
        retain_images: ImageRetention::Summary,
        citations: true,
        include_metadata: true,
        chunking: ChunkingOptions {
            mode: ChunkingMode::Block,
            max_chars_per_chunk: 900,
            overlap_chars: 0,
        },
        content_filter: ContentFilterMode::None,
        ..ReaderOptions::default()
    }
}

fn stable_summary(result: &ReaderResult) -> serde_json::Value {
    json!({
        "title": result.metadata.title,
        "format": result.format.label(),
        "extractionMethod": result.extraction.method,
        "fallbackUsed": result.extraction.fallback_used,
        "warningCodes": result.warnings.iter().map(|warning| warning_code(warning.code)).collect::<Vec<_>>(),
        "linkCount": result.links.len(),
        "imageCount": result.images.len(),
        "chunkCount": result.chunks.len(),
        "hasReferencesFooter": result.markdown_with_citations.contains("## References"),
        "hasImagesFooter": result.markdown_with_citations.contains("## Images"),
    })
}

fn warning_code(code: WarningCode) -> &'static str {
    match code {
        WarningCode::LowMainContentConfidence => "low_main_content_confidence",
        WarningCode::Truncated => "truncated",
        WarningCode::UnsupportedFormat => "unsupported_format",
        WarningCode::BrowserRecommended => "browser_recommended",
        WarningCode::OcrRecommended => "ocr_recommended",
        WarningCode::MalformedHtml => "malformed_html",
        WarningCode::NonUtf8Charset => "non_utf8_charset",
        WarningCode::ExternalAdapterMissing => "external_adapter_missing",
        WarningCode::ExternalAdapterFailed => "external_adapter_failed",
        WarningCode::ResourceLimitExceeded => "resource_limit_exceeded",
        WarningCode::SecurityBlocked => "security_blocked",
        WarningCode::CacheHit => "cache_hit",
        WarningCode::CacheMiss => "cache_miss",
        WarningCode::OcrUnavailable => "ocr_unavailable",
        WarningCode::CaptionUnavailable => "caption_unavailable",
        WarningCode::SanitizedHtml => "sanitized_html",
    }
}

fn normalize_snapshot_text(text: &str) -> String {
    text.replace("\r\n", "\n").trim().to_string()
}
