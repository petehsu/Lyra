use super::*;
use sha2::{Digest, Sha256};
use std::fmt::Write as _;

include!(concat!(env!("OUT_DIR"), "/design_catalog.rs"));

/// `design_reference` tool — gives the Agent a curated library of real-world
/// DESIGN.md design system documents (colors, typography, spacing, patterns)
/// from production websites.
///
/// Actions:
/// - `list` (default): returns all brands + one-line descriptions
/// - `read`: activates a full DESIGN.md design context for the session
pub(crate) fn tool_design_reference(session_id: &str, input: &Value) -> NativeToolResult {
    let action = value_string(input, "action").unwrap_or_else(|| "list".to_string());
    match action.trim().to_ascii_lowercase().as_str() {
        "list" | "all" | "brands" | "list_brands" => {
            let entries: Vec<Value> = DESIGN_CATALOG
                .iter()
                .map(|entry| {
                    json!({
                        "brand": entry.brand,
                        "description": entry.description,
                    })
                })
                .collect();
            let list = DESIGN_CATALOG
                .iter()
                .map(|entry| format!("- {}: {}", entry.brand, entry.description))
                .collect::<Vec<_>>()
                .join("\n");
            Ok(NativeToolSuccess {
                content: format!(
                    "{} design references available:\n{}\n\nCall design_reference with action=read and brand=<name> to read a full DESIGN.md.",
                    entries.len(),
                    list
                ),
                raw: json!({
                    "count": entries.len(),
                    "references": entries,
                }),
                recommended_next_action: Some(
                    "Pick a brand that matches the target design language, then call design_reference with action=read, brand=<name>."
                        .to_string(),
                ),
            })
        }
        "read" => {
            let brand = required_value_string(input, "brand")?;
            let requested_brand = brand.trim();
            let entry = DESIGN_CATALOG
                .iter()
                .find(|entry| entry.brand.eq_ignore_ascii_case(requested_brand))
                .ok_or_else(|| {
                    NativeToolFailure::new(
                        "brand_not_found",
                        format!("Unknown design reference brand: {brand}"),
                        "Call design_reference with action=list to see available brands.",
                    )
                })?;
            activate_design_context(session_id, entry)
        }
        _ => Err(NativeToolFailure::new(
            "bad_action",
            format!("Unknown action: {action}"),
            "Use action=list to see all design references, or action=read with a brand name.",
        )),
    }
}

fn activate_design_context(
    session_id: &str,
    entry: &DesignEntry,
) -> Result<NativeToolSuccess, NativeToolFailure> {
    let document_hash = format!("sha256:{:x}", Sha256::digest(entry.content.as_bytes()));
    let tokens = design_document_tokens(entry.content)?;
    let components = tokens.get("components").cloned().unwrap_or(Value::Null);
    let component_rules = design_document_rules(entry.content);
    let css_variables = design_css_variables(&tokens, "lyra-design");
    let context = json!({
        "brand": entry.brand,
        "documentHash": document_hash,
        "tokens": tokens,
        "components": components,
        "componentRules": component_rules,
        "cssVariables": css_variables,
    });
    let context = {
        let mut state = state().lock().map_err(|_| {
            NativeToolFailure::new(
                "runtime_state_unavailable",
                "agent runtime state lock failed",
                "Retry the design reference read.",
            )
        })?;
        let session = state.sessions.get_mut(session_id).ok_or_else(|| {
            NativeToolFailure::new(
                "session_not_found",
                format!("session not found: {session_id}"),
                "Retry in an active session.",
            )
        })?;
        session.snapshot["activeDesignContext"] = context.clone();
        touch_session(session);
        state.save_state().map_err(|error| {
            NativeToolFailure::new(
                "write_failed",
                format!("failed to persist active design context: {error}"),
                "Retry after checking runtime storage.",
            )
        })?;
        context
    };
    Ok(NativeToolSuccess {
        content: format!(
            "Loaded {} ({}) as the current design reference. Use or adapt these generated CSS tokens when they help the product:\n\n{}\n\nFull DESIGN.md:\n\n{}",
            entry.brand,
            document_hash,
            context
                .get("cssVariables")
                .and_then(Value::as_str)
                .unwrap_or_default(),
            entry.content,
        ),
        raw: json!({
            "brand": entry.brand,
            "bytes": entry.content.len(),
            "activeDesignContext": context,
        }),
        recommended_next_action: Some(
            "Use this reference as design evidence, then make the implementation choices that best fit the product and existing UI.".to_string(),
        ),
    })
}

fn design_document_tokens(content: &str) -> Result<Value, NativeToolFailure> {
    let frontmatter = content
        .trim_start()
        .strip_prefix("---")
        .and_then(|value| value.split_once("\n---"))
        .map(|(value, _)| value)
        .ok_or_else(|| {
            NativeToolFailure::new(
                "design_document_invalid",
                "DESIGN.md is missing YAML frontmatter",
                "Choose another curated design reference.",
            )
        })?;
    let tokens = serde_yaml::from_str::<serde_yaml::Value>(frontmatter).map_err(|error| {
        NativeToolFailure::new(
            "design_document_invalid",
            format!("DESIGN.md frontmatter could not be parsed: {error}"),
            "Choose another curated design reference.",
        )
    })?;
    serde_json::to_value(tokens).map_err(|error| {
        NativeToolFailure::new(
            "design_document_invalid",
            format!("DESIGN.md tokens could not be encoded: {error}"),
            "Choose another curated design reference.",
        )
    })
}

fn design_document_rules(content: &str) -> String {
    content
        .trim_start()
        .strip_prefix("---")
        .and_then(|value| value.split_once("\n---"))
        .map(|(_, rules)| rules.trim().to_string())
        .unwrap_or_default()
}

fn design_css_variables(tokens: &Value, prefix: &str) -> String {
    let mut variables = Vec::new();
    for (group, css_group) in [
        ("colors", "color"),
        ("rounded", "radius"),
        ("spacing", "space"),
        ("shadows", "shadow"),
    ] {
        append_css_variables(
            &mut variables,
            tokens.get(group),
            &format!("{prefix}-{css_group}"),
        );
    }
    append_css_variables(
        &mut variables,
        tokens.get("typography"),
        &format!("{prefix}-type"),
    );
    if variables.is_empty() {
        return String::new();
    }
    format!(
        "/* Lyra design tokens */\n:root {{\n{}\n}}",
        variables.join("\n")
    )
}

fn append_css_variables(variables: &mut Vec<String>, value: Option<&Value>, prefix: &str) {
    let Some(value) = value else {
        return;
    };
    match value {
        Value::Object(entries) => {
            for (key, value) in entries {
                append_css_variables(
                    variables,
                    Some(value),
                    &format!("{prefix}-{}", css_identifier(key)),
                );
            }
        }
        Value::String(value) => variables.push(format!("  --{prefix}: {value};")),
        Value::Number(value) => variables.push(format!("  --{prefix}: {value};")),
        _ => {}
    }
}

fn css_identifier(value: &str) -> String {
    let mut output = String::new();
    for (index, character) in value.chars().enumerate() {
        if character.is_ascii_uppercase() {
            if index > 0 {
                output.push('-');
            }
            output.push(character.to_ascii_lowercase());
        } else if character.is_ascii_alphanumeric() {
            output.push(character.to_ascii_lowercase());
        } else if !output.ends_with('-') {
            output.push('-');
        }
    }
    output.trim_matches('-').to_string()
}

pub(crate) fn active_design_context(session_id: &str) -> Option<Value> {
    state()
        .lock()
        .ok()?
        .sessions
        .get(session_id)?
        .snapshot
        .get("activeDesignContext")
        .filter(|value| value.is_object())
        .cloned()
}

pub(crate) fn tool_design_extract_reference(
    turn_id: &str,
    tool_call_id: &str,
    input: &Value,
    dispatcher: Option<&Arc<HostCapabilityDispatcher>>,
) -> NativeToolResult {
    let dispatcher = dispatcher.ok_or_else(|| {
        NativeToolFailure::new(
            "browser_host_unavailable",
            "Design reference extraction requires the Workbench Browser host capability.",
            "Open or enable the Workbench Browser, or use design_reference with action=list/read for curated DESIGN.md references.",
        )
    })?;
    let url = required_value_string(input, "url")?;
    let parsed_url = Url::parse(&url).map_err(|error| {
        NativeToolFailure::new(
            "bad_url",
            format!("invalid URL: {error}"),
            "Retry with an absolute http or https URL.",
        )
    })?;
    let trusted_local = value_bool(input, "trustedLocal", false);
    if !matches!(parsed_url.scheme(), "http" | "https")
        && !(trusted_local && parsed_url.scheme() == "file")
    {
        return Err(NativeToolFailure::new(
            "unsupported_url_scheme",
            "design_extract_reference only supports http/https URLs unless trustedLocal=true is used with file:",
            "Retry with an http or https URL, or set trustedLocal=true for a local file URL.",
        ));
    }

    let timeout_ms = value_u64(input, "timeoutMs", 20_000, 120_000);
    let max_elements = value_usize(input, "maxElements", 1200, 3000);
    let mut payload = json!({
        "url": parsed_url.to_string(),
        "browserMode": value_string(input, "browserMode").unwrap_or_else(|| "matchingOrNewTab".to_string()),
        "waitUntil": value_string(input, "waitUntil").unwrap_or_else(|| "loadIdle".to_string()),
        "timeoutMs": timeout_ms,
        "includeDesignReference": true,
        "includeMedia": true,
        "includeScreenshot": value_bool(input, "includeScreenshot", false),
        "includePageshot": value_bool(input, "includePageshot", false),
        "maxDesignElements": max_elements,
    });
    if let Some(object) = payload.as_object_mut() {
        for key in [
            "targetSelector",
            "tabId",
            "waitForSelector",
            "viewport",
            "mobile",
        ] {
            if let Some(value) = input.get(key) {
                object.insert(key.to_string(), value.clone());
            }
        }
    }

    let mut host_raw = invoke_host_capability_with_timeout(
        dispatcher.clone(),
        "workbench.browser.readRenderedSnapshot".to_string(),
        payload,
        timeout_ms.saturating_add(5_000).clamp(1_000, 122_000),
    )
    .map_err(|message| {
        NativeToolFailure::new(
            "browser_snapshot_failed",
            message,
            "Retry with a reachable reference URL, a narrower targetSelector, or use a curated DESIGN.md reference.",
        )
    })?;
    if host_raw.get("ok").and_then(Value::as_bool) == Some(false) || host_raw.get("error").is_some()
    {
        return Err(NativeToolFailure::new(
            "browser_snapshot_failed",
            host_raw
                .pointer("/error/message")
                .and_then(Value::as_str)
                .or_else(|| host_raw.get("message").and_then(Value::as_str))
                .unwrap_or("browser snapshot failed"),
            "Retry with a reachable reference URL, a narrower targetSelector, or use a curated DESIGN.md reference.",
        )
        .with_detail(host_raw));
    }

    let screenshot_artifact = materialize_browser_snapshot_image(
        turn_id,
        tool_call_id,
        &mut host_raw,
        BrowserSnapshotImageKind::Screenshot,
    );
    let pageshot_artifact = materialize_browser_snapshot_image(
        turn_id,
        tool_call_id,
        &mut host_raw,
        BrowserSnapshotImageKind::Pageshot,
    );
    if let Some(object) = host_raw.as_object_mut() {
        if let Some(artifact) = screenshot_artifact.as_ref() {
            object.insert("screenshotArtifactRef".to_string(), artifact.clone());
        }
        if let Some(artifact) = pageshot_artifact.as_ref() {
            object.insert("pageshotArtifactRef".to_string(), artifact.clone());
        }
    }

    let final_url = host_raw
        .get("finalUrl")
        .and_then(Value::as_str)
        .unwrap_or(parsed_url.as_str())
        .to_string();
    let report = host_raw
        .get("designReference")
        .cloned()
        .unwrap_or_else(|| {
            json!({
                "status": "degraded",
                "warnings": [{
                    "code": "missing_design_reference",
                    "message": "The browser host did not return a designReference block."
                }],
                "recommendedNextAction": "Update the desktop host, retry extraction, or use a curated DESIGN.md reference.",
                "source": {
                    "url": final_url,
                    "title": host_raw.get("title").and_then(Value::as_str).unwrap_or("")
                },
                "viewport": host_raw.get("viewport").cloned().unwrap_or(Value::Null),
                "tokens": {},
                "sections": [],
                "components": {},
                "assets": {}
            })
        });
    let status = report
        .get("status")
        .and_then(Value::as_str)
        .unwrap_or("degraded")
        .to_string();
    let recommended_next_action = report
        .get("recommendedNextAction")
        .and_then(Value::as_str)
        .map(str::to_string);
    let content = format_design_extract_content(&report, &host_raw, &final_url);
    let raw = json!({
        "kind": "design_reference_report",
        "url": parsed_url.to_string(),
        "finalUrl": final_url,
        "title": host_raw.get("title").cloned().unwrap_or(Value::Null),
        "status": status,
        "warnings": report.get("warnings").cloned().unwrap_or_else(|| Value::Array(Vec::new())),
        "hostWarnings": host_raw.get("warnings").cloned().unwrap_or_else(|| Value::Array(Vec::new())),
        "recommendedNextAction": recommended_next_action.clone(),
        "viewport": report.get("viewport").cloned().or_else(|| host_raw.get("viewport").cloned()).unwrap_or(Value::Null),
        "report": report,
        "screenshotArtifactRef": host_raw.get("screenshotArtifactRef").cloned().unwrap_or(Value::Null),
        "pageshotArtifactRef": host_raw.get("pageshotArtifactRef").cloned().unwrap_or(Value::Null),
    });

    Ok(NativeToolSuccess {
        content,
        raw,
        recommended_next_action,
    })
}

fn format_design_extract_content(report: &Value, host_raw: &Value, final_url: &str) -> String {
    let title = host_raw
        .get("title")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("Untitled reference");
    let status = report
        .get("status")
        .and_then(Value::as_str)
        .unwrap_or("degraded");
    let mut output = String::new();
    let _ = writeln!(output, "DesignReferenceReport: {title}");
    let _ = writeln!(output, "Status: {status}");
    let _ = writeln!(output, "Source: {final_url}");
    if let Some(viewport) = report.get("viewport").and_then(Value::as_object) {
        let _ = writeln!(
            output,
            "Viewport: {}x{} @{}",
            viewport.get("width").and_then(Value::as_u64).unwrap_or(0),
            viewport.get("height").and_then(Value::as_u64).unwrap_or(0),
            viewport
                .get("deviceScaleFactor")
                .and_then(Value::as_f64)
                .unwrap_or(1.0)
        );
    }
    append_token_line(&mut output, report, "colors", "Colors", 10);
    append_token_line(&mut output, report, "gradients", "Gradients", 4);
    append_token_line(&mut output, report, "fontFamilies", "Fonts", 5);
    append_token_line(&mut output, report, "fontSizes", "Font sizes", 8);
    append_token_line(&mut output, report, "fontWeights", "Weights", 6);
    append_token_line(&mut output, report, "spacing", "Spacing", 8);
    append_token_line(&mut output, report, "radius", "Radius", 6);
    append_token_line(&mut output, report, "shadow", "Shadows", 4);

    let sections = report
        .get("sections")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let _ = writeln!(output, "Sections: {}", sections.len());
    for section in sections.iter().take(8) {
        let tag = section
            .get("tag")
            .and_then(Value::as_str)
            .unwrap_or("section");
        let selector = section
            .get("selector")
            .and_then(Value::as_str)
            .unwrap_or("");
        let area = section
            .get("areaRatio")
            .and_then(Value::as_f64)
            .unwrap_or(0.0);
        let text = compact_text(
            section.get("text").and_then(Value::as_str).unwrap_or(""),
            120,
        );
        let _ = writeln!(output, "- {tag} {selector} area={area:.3} text=\"{text}\"");
    }

    let components = report.get("components").unwrap_or(&Value::Null);
    let _ = writeln!(
        output,
        "Components: buttons={}, cards={}, inputs={}, navItems={}",
        component_count(components, "buttons"),
        component_count(components, "cards"),
        component_count(components, "inputs"),
        component_count(components, "navItems")
    );
    append_component_samples(&mut output, components, "buttons", "Button", 3);
    append_component_samples(&mut output, components, "cards", "Card", 3);
    append_component_samples(&mut output, components, "inputs", "Input", 2);
    let assets = report.get("assets").unwrap_or(&Value::Null);
    let _ = writeln!(
        output,
        "Assets: images={}, backgrounds={}, inlineSvg={}, media={}",
        component_count(assets, "images"),
        component_count(assets, "backgroundImages"),
        assets
            .get("inlineSvgCount")
            .and_then(Value::as_u64)
            .unwrap_or(0),
        assets
            .get("mediaCount")
            .and_then(Value::as_u64)
            .unwrap_or(0)
    );
    append_asset_samples(&mut output, assets);
    append_foundation_samples(
        &mut output,
        report.get("foundations").unwrap_or(&Value::Null),
    );
    append_interaction_samples(
        &mut output,
        report.get("interactionSignals").unwrap_or(&Value::Null),
    );
    if let Some(warnings) = report.get("warnings").and_then(Value::as_array)
        && !warnings.is_empty()
    {
        let _ = writeln!(output, "Warnings:");
        for warning in warnings.iter().take(4) {
            let code = warning
                .get("code")
                .and_then(Value::as_str)
                .unwrap_or("warning");
            let message = warning.get("message").and_then(Value::as_str).unwrap_or("");
            let _ = writeln!(output, "- {code}: {message}");
        }
    }
    output
}

fn append_component_samples(
    output: &mut String,
    components: &Value,
    key: &str,
    label: &str,
    limit: usize,
) {
    let Some(items) = components.get(key).and_then(Value::as_array) else {
        return;
    };
    if items.is_empty() {
        return;
    }
    let _ = writeln!(output, "{label} samples:");
    for item in items.iter().take(limit) {
        let selector = compact_text(
            item.get("selector").and_then(Value::as_str).unwrap_or(""),
            80,
        );
        let text = compact_text(item.get("text").and_then(Value::as_str).unwrap_or(""), 80);
        let style = item.get("style").unwrap_or(&Value::Null);
        let _ = writeln!(
            output,
            "- {} {} text=\"{}\" bg={} color={} font={}/{} pad={} radius={} shadow={}",
            selector,
            bounds_text(item.get("bounds").unwrap_or(&Value::Null)),
            text,
            style_str(style, "backgroundColor"),
            style_str(style, "color"),
            style_str(style, "fontSize"),
            style_str(style, "fontWeight"),
            edge_text(style.get("padding").unwrap_or(&Value::Null)),
            radius_text(style.get("borderRadius").unwrap_or(&Value::Null)),
            style_str(style, "boxShadow")
        );
    }
}

fn append_asset_samples(output: &mut String, assets: &Value) {
    if let Some(images) = assets.get("images").and_then(Value::as_array)
        && !images.is_empty()
    {
        let _ = writeln!(output, "Image samples:");
        for image in images.iter().take(4) {
            let _ = writeln!(
                output,
                "- {} {} alt=\"{}\" natural={}x{}",
                compact_text(image.get("url").and_then(Value::as_str).unwrap_or(""), 140),
                bounds_text(image.get("bounds").unwrap_or(&Value::Null)),
                compact_text(image.get("alt").and_then(Value::as_str).unwrap_or(""), 80),
                image
                    .get("naturalWidth")
                    .and_then(Value::as_u64)
                    .unwrap_or(0),
                image
                    .get("naturalHeight")
                    .and_then(Value::as_u64)
                    .unwrap_or(0)
            );
        }
    }
    if let Some(backgrounds) = assets.get("backgroundImages").and_then(Value::as_array)
        && !backgrounds.is_empty()
    {
        let _ = writeln!(output, "Background samples:");
        for background in backgrounds.iter().take(4) {
            let urls = background
                .get("urls")
                .and_then(Value::as_array)
                .map(|items| {
                    items
                        .iter()
                        .take(3)
                        .filter_map(Value::as_str)
                        .map(|url| compact_text(url, 120))
                        .collect::<Vec<_>>()
                        .join(", ")
                })
                .unwrap_or_default();
            let _ = writeln!(
                output,
                "- {} {} urls=[{}] image={}",
                compact_text(
                    background
                        .get("selector")
                        .and_then(Value::as_str)
                        .unwrap_or(""),
                    80
                ),
                bounds_text(background.get("bounds").unwrap_or(&Value::Null)),
                urls,
                compact_text(
                    background
                        .get("image")
                        .and_then(Value::as_str)
                        .unwrap_or(""),
                    160
                )
            );
        }
    }
}

fn append_foundation_samples(output: &mut String, foundations: &Value) {
    let fonts = component_count(foundations, "fontLinks");
    let favicons = component_count(foundations, "faviconLinks");
    let meta_images = component_count(foundations, "metaImages");
    if fonts + favicons + meta_images == 0 {
        return;
    }
    let _ = writeln!(
        output,
        "Foundations: fontLinks={fonts}, favicons={favicons}, metaImages={meta_images}"
    );
    if let Some(items) = foundations.get("fontLinks").and_then(Value::as_array)
        && let Some(first) = items.first()
    {
        let value = first
            .get("href")
            .or_else(|| first.get("text"))
            .and_then(Value::as_str)
            .unwrap_or("");
        let _ = writeln!(output, "- font: {}", compact_text(value, 160));
    }
}

fn append_interaction_samples(output: &mut String, interaction: &Value) {
    let sticky = component_count(interaction, "stickyOrFixed");
    let transitions = component_count(interaction, "transitionSamples");
    let animations = component_count(interaction, "animationSamples");
    let scroll_snap = component_count(interaction, "scrollSnap");
    if sticky + transitions + animations + scroll_snap == 0 {
        return;
    }
    let _ = writeln!(
        output,
        "Interaction signals: stickyOrFixed={sticky}, transitions={transitions}, animations={animations}, scrollSnap={scroll_snap}, interactive={}",
        interaction
            .get("interactiveCount")
            .and_then(Value::as_u64)
            .unwrap_or(0)
    );
    append_first_interaction(output, interaction, "stickyOrFixed", "sticky/fixed");
    append_first_interaction(output, interaction, "transitionSamples", "transition");
    append_first_interaction(output, interaction, "scrollSnap", "scrollSnap");
}

fn append_first_interaction(output: &mut String, interaction: &Value, key: &str, label: &str) {
    let Some(first) = interaction
        .get(key)
        .and_then(Value::as_array)
        .and_then(|items| items.first())
    else {
        return;
    };
    let selector = compact_text(
        first.get("selector").and_then(Value::as_str).unwrap_or(""),
        80,
    );
    let detail = first
        .get("transition")
        .or_else(|| first.get("scrollSnapType"))
        .or_else(|| first.get("animation"))
        .and_then(Value::as_str)
        .unwrap_or("");
    let _ = writeln!(
        output,
        "- {label}: {} {} {}",
        selector,
        bounds_text(first.get("bounds").unwrap_or(&Value::Null)),
        compact_text(detail, 140)
    );
}

fn append_token_line(output: &mut String, report: &Value, key: &str, label: &str, limit: usize) {
    let values = report
        .get("tokens")
        .and_then(|tokens| tokens.get(key))
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .take(limit)
                .filter_map(|item| {
                    let value = item.get("value").and_then(Value::as_str)?;
                    let count = item.get("count").and_then(Value::as_u64).unwrap_or(0);
                    Some(format!("{} ({})", compact_text(value, 120), count))
                })
                .collect::<Vec<_>>()
                .join(", ")
        })
        .unwrap_or_default();
    if !values.is_empty() {
        let _ = writeln!(output, "{label}: {values}");
    }
}

fn component_count(value: &Value, key: &str) -> usize {
    value
        .get(key)
        .and_then(Value::as_array)
        .map(Vec::len)
        .unwrap_or(0)
}

fn style_str<'a>(style: &'a Value, key: &str) -> &'a str {
    style.get(key).and_then(Value::as_str).unwrap_or("-")
}

fn edge_text(value: &Value) -> String {
    let Some(object) = value.as_object() else {
        return "-".to_string();
    };
    let top = object.get("top").and_then(Value::as_str).unwrap_or("-");
    let right = object.get("right").and_then(Value::as_str).unwrap_or("-");
    let bottom = object.get("bottom").and_then(Value::as_str).unwrap_or("-");
    let left = object.get("left").and_then(Value::as_str).unwrap_or("-");
    if top == right && right == bottom && bottom == left {
        top.to_string()
    } else {
        format!("{top}/{right}/{bottom}/{left}")
    }
}

fn radius_text(value: &Value) -> String {
    let Some(object) = value.as_object() else {
        return "-".to_string();
    };
    object
        .get("topLeft")
        .and_then(Value::as_str)
        .unwrap_or("-")
        .to_string()
}

fn bounds_text(value: &Value) -> String {
    let Some(object) = value.as_object() else {
        return String::new();
    };
    let x = object.get("x").and_then(Value::as_f64).unwrap_or(0.0);
    let y = object.get("y").and_then(Value::as_f64).unwrap_or(0.0);
    let width = object.get("width").and_then(Value::as_f64).unwrap_or(0.0);
    let height = object.get("height").and_then(Value::as_f64).unwrap_or(0.0);
    format!("@{x:.0},{y:.0} {width:.0}x{height:.0}")
}

fn compact_text(value: &str, max_chars: usize) -> String {
    let mut text = value.split_whitespace().collect::<Vec<_>>().join(" ");
    if text.chars().count() > max_chars {
        text = text.chars().take(max_chars).collect::<String>();
        text.push_str("...");
    }
    text
}
