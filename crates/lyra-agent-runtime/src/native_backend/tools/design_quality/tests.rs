use super::*;
use tempfile::tempdir;

#[test]
fn rule_catalog_is_unique_compilable_and_product_neutral() {
    let mut ids = HashSet::new();
    let categories = HashSet::from([
        "intent_copy",
        "color_material",
        "typography",
        "components_assets",
        "layout_density",
        "interaction_state",
        "motion_performance",
        "responsive_accessibility",
    ]);
    for compiled in compiled_rules() {
        assert!(ids.insert(compiled.rule.id));
        assert!(categories.contains(compiled.rule.category));
        assert!(!compiled.rule.title.trim().is_empty());
        assert!(!compiled.rule.principle.trim().is_empty());
        assert!(!compiled.rule.recommendation.trim().is_empty());
        assert!(matches!(compiled.rule.severity, "high" | "medium" | "low"));
        assert!(matches!(
            compiled.rule.confidence,
            "high" | "medium" | "low"
        ));
        assert!(!compiled.rule.surfaces.is_empty());
        assert!(!compiled.rule.source_patterns.is_empty());
        assert!(!compiled.rule.rendered_signals.is_empty());
        assert!(!compiled.rule.false_positive_checks.is_empty());
        assert!(
            compiled
                .rule
                .surfaces
                .iter()
                .all(|surface| ALL_SURFACES.contains(surface))
        );
        let rule_text = format!(
            "{} {} {} {} {} {}",
            compiled.rule.title,
            compiled.rule.principle,
            compiled.rule.recommendation,
            compiled.rule.source_patterns.join(" "),
            compiled.rule.rendered_signals.join(" "),
            compiled.rule.false_positive_checks.join(" "),
        )
        .to_ascii_lowercase();
        for product_term in [
            "lyra",
            "oh my agents",
            "hermes orange",
            "character logo",
            "ascii logo",
        ] {
            assert!(
                !rule_text.contains(product_term),
                "{} contains product-specific term {product_term}",
                compiled.rule.id
            );
        }
    }
    assert_eq!(ids.len(), RULES.len());
    assert_eq!(
        RULES
            .iter()
            .map(|rule| rule.category)
            .collect::<HashSet<_>>(),
        categories
    );
}

#[test]
fn source_scan_skips_dependencies_and_reports_contextual_leads() {
    let root = tempdir().expect("tempdir");
    fs::create_dir_all(root.path().join("src")).expect("src");
    fs::create_dir_all(root.path().join("node_modules/demo")).expect("deps");
    let source_path = root.path().join("src/page.tsx");
    let source = r##"<a href="#">Unlock the power</a><button><svg /></button>"##;
    fs::write(&source_path, source).expect("fixture");
    let large_path = root.path().join("src/large.tsx");
    fs::write(&large_path, vec![b'x'; MAX_SOURCE_FILE_BYTES as usize + 1]).expect("large fixture");
    fs::write(
        root.path().join("node_modules/demo/index.tsx"),
        r##"<a href="#">ignored</a>"##,
    )
    .expect("ignored fixture");
    let mut files = Vec::new();
    let mut truncated = false;
    collect_source_files(
        root.path(),
        root.path(),
        &[],
        &[],
        20,
        &mut files,
        &mut truncated,
    );
    assert_eq!(files.len(), 2);
    assert!(matches!(
        read_source_file(&large_path),
        SourceFileRead::TooLarge
    ));
    let SourceFileRead::Text(text) = read_source_file(&source_path) else {
        panic!("source fixture should be readable");
    };
    let mut findings = Vec::new();
    scan_source_text(
        "src/page.tsx",
        &text,
        &RuleFilters::default(),
        "marketing",
        1,
        &mut findings,
    );
    assert_eq!(findings.len(), 1);
    assert!(findings.iter().any(|finding| {
        finding.get("ruleId").and_then(Value::as_str) == Some("intent.generic_claims")
    }));
    assert!(
        findings.iter().all(|finding| {
            finding.get("needsHumanReview").and_then(Value::as_bool) == Some(true)
        })
    );
    assert_eq!(fs::read_to_string(&source_path).expect("unchanged"), source);

    let mut multiline_findings = Vec::new();
    let generic_only = RuleFilters {
        categories: HashSet::new(),
        rule_ids: HashSet::from(["intent.generic_claims".to_string()]),
    };
    scan_source_text(
        "src/multiline.tsx",
        "<main>\n  <p>Unlock the power</p>\n</main>",
        &generic_only,
        "marketing",
        20,
        &mut multiline_findings,
    );
    assert_eq!(multiline_findings.len(), 1);
    assert_eq!(multiline_findings[0]["evidence"]["line"], 2);
    assert_eq!(
        multiline_findings[0]["evidence"]["excerpt"],
        "<p>Unlock the power</p>"
    );

    let report = quality_report(
        "source",
        json!({ "path": "src" }),
        files.len(),
        findings,
        true,
        json!({}),
        Vec::new(),
        false,
    );
    assert_eq!(report.raw["summary"]["truncated"], true);
    assert_eq!(report.raw["status"], "findings");
}

#[test]
fn nova_style_fixture_reports_split_metrics_dead_actions_and_monolith() {
    let mut source = String::from(
        r##"<html><head><style>.hero{background:linear-gradient(135deg,#8b5cf6,#6366f1)}.title{background-clip:text}</style></head><body>"##,
    );
    for _ in 0..490 {
        source.push_str("\n<div class=\"glass\">content</div>");
    }
    source.push_str(
        r##"
<section><div data-target="500">0</div><div>万+ 活跃用户</div></section>
<section><div data-target="98">0</div><div>% 用户满意度</div></section>
<section><a href="#">免费开始使用</a></section>
<script>document.querySelectorAll("[data-target]")</script></body></html>"##,
    );
    let mut findings = Vec::new();
    scan_source_text(
        "index.html",
        &source,
        &RuleFilters::default(),
        "marketing",
        100,
        &mut findings,
    );
    let rule_ids = findings
        .iter()
        .filter_map(|finding| finding.get("ruleId").and_then(Value::as_str))
        .collect::<HashSet<_>>();
    assert!(rule_ids.contains("intent.unsourced_metrics"));
    assert!(rule_ids.contains("intent.placeholder_or_dead_action"));
    assert!(rule_ids.contains("components.monolithic_page"));
    let report = quality_report(
        "source",
        json!({ "path": "." }),
        1,
        findings,
        false,
        json!({}),
        Vec::new(),
        false,
    );
    assert!(
        report.raw["summary"]["blockingFindings"]
            .as_u64()
            .is_some_and(|count| count > 0)
    );
    assert!(report.content.contains("Blocking high/high findings:"));
    assert!(
        report
            .content
            .contains("BLOCKER intent.placeholder_or_dead_action")
    );
}

#[cfg(unix)]
#[test]
fn source_collection_does_not_follow_symlinks_outside_workspace() {
    use std::os::unix::fs::symlink;

    let root = tempdir().expect("workspace");
    let outside = tempdir().expect("outside");
    fs::write(
        outside.path().join("outside.tsx"),
        "<a href=\"#\">outside</a>",
    )
    .expect("outside fixture");
    symlink(outside.path(), root.path().join("linked")).expect("symlink");

    let mut files = Vec::new();
    let mut truncated = false;
    collect_source_files(
        root.path(),
        root.path(),
        &[],
        &[],
        20,
        &mut files,
        &mut truncated,
    );

    assert!(files.is_empty());
    assert!(!truncated);
}

#[test]
fn rendered_signals_create_accessibility_and_overflow_findings() {
    let report = json!({
        "status": "ok",
        "viewport": { "width": 1200, "height": 800 },
        "document": { "sampledElementCount": 30 },
        "tokens": { "fontSizes": [{ "value": "16px", "count": 20 }] },
        "components": {
            "headings": [
                { "text": "Title", "style": { "fontSize": "18px" } },
                { "text": "Section", "style": { "fontSize": "18px" } }
            ],
            "buttons": []
        },
        "qualitySignals": {
            "horizontalOverflow": [{ "selector": ".wide" }],
            "textClipping": [{ "selector": ".clipped" }],
            "unlabelledControls": [{ "selector": "button.icon" }],
            "missingAltImages": [{ "selector": "img.hero" }],
            "reducedMotionSupported": false
        }
    });
    let mut findings = Vec::new();
    rendered_token_findings(
        &report,
        &RuleFilters::default(),
        "product_ui",
        20,
        &mut findings,
    );
    rendered_quality_signal_findings(
        &report,
        &RuleFilters::default(),
        "product_ui",
        20,
        &mut findings,
    );
    let ids = findings
        .iter()
        .filter_map(|finding| finding.get("ruleId").and_then(Value::as_str))
        .collect::<HashSet<_>>();
    assert!(ids.contains("typography.flat_hierarchy"));
    assert!(ids.contains("responsive.horizontal_overflow"));
    assert!(ids.contains("accessibility.unlabelled_control"));
    assert!(ids.contains("accessibility.missing_alt"));
    let finding_ids = findings
        .iter()
        .filter_map(|finding| finding.get("id").and_then(Value::as_str))
        .collect::<HashSet<_>>();
    assert_eq!(finding_ids.len(), findings.len());

    let degraded = quality_report(
        "rendered",
        json!({ "url": "https://example.test" }),
        0,
        findings,
        false,
        json!({ "sourceReportStatus": "blocked" }),
        rendered_unverified_checks(&json!({})),
        true,
    );
    assert_eq!(degraded.raw["status"], "degraded");
    assert!(
        degraded.raw["unverifiedChecks"]
            .as_array()
            .is_some_and(|checks| !checks.is_empty())
    );
}
