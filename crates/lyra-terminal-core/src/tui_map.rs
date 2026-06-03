use crate::screen::{
    TerminalScreenCell, TerminalScreenLink, TerminalScreenRegion, TerminalScreenSnapshot,
    TerminalScreenStyle, TerminalScreenVisibleRow,
};
use crate::TerminalScreenReadResponse;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};

pub const DEFAULT_MAX_REGIONS: usize = 96;
pub const MAX_REGIONS: usize = 256;

const MAX_REGION_TEXT_CHARS: usize = 4_096;

#[derive(Clone, Debug)]
struct ScreenProjection<'a> {
    screen_version: u32,
    rows: u16,
    cols: u16,
    mode: &'a str,
    visible_rows: &'a [TerminalScreenVisibleRow],
    cells: &'a [TerminalScreenCell],
    styles: &'a [TerminalScreenStyle],
    links: &'a [TerminalScreenLink],
    seed_regions: &'a [TerminalScreenRegion],
    prompt: Option<&'a str>,
    cursor_row: u16,
    cursor_col: u16,
    cursor_visible: bool,
}

#[derive(Clone)]
struct CandidateRegion {
    region: TerminalScreenRegion,
    priority: u8,
    signature_text: String,
}

pub fn regions_from_screen_read(
    screen: &TerminalScreenReadResponse,
    max_regions: Option<u32>,
    include_text: bool,
) -> (Vec<TerminalScreenRegion>, bool) {
    let projection = ScreenProjection {
        screen_version: screen.screen_version,
        rows: screen.rows,
        cols: screen.cols,
        mode: &screen.mode,
        visible_rows: &screen.visible_rows,
        cells: &screen.cells,
        styles: &screen.styles,
        links: &screen.links,
        seed_regions: &screen.regions,
        prompt: screen.prompt.as_deref(),
        cursor_row: screen.cursor_position.row,
        cursor_col: screen.cursor_position.col,
        cursor_visible: screen.cursor_position.visible,
    };
    build_regions(&projection, max_regions, include_text)
}

pub fn regions_from_snapshot(
    snapshot: &TerminalScreenSnapshot,
    max_regions: Option<u32>,
    include_text: bool,
) -> (Vec<TerminalScreenRegion>, bool) {
    let projection = ScreenProjection {
        screen_version: snapshot.screen_version.min(u32::MAX as u64) as u32,
        rows: snapshot.rows,
        cols: snapshot.cols,
        mode: &snapshot.mode,
        visible_rows: &snapshot.visible_rows,
        cells: &snapshot.cells,
        styles: &snapshot.styles,
        links: &snapshot.links,
        seed_regions: &snapshot.regions,
        prompt: snapshot.prompt.as_deref(),
        cursor_row: snapshot.cursor_position.row,
        cursor_col: snapshot.cursor_position.col,
        cursor_visible: snapshot.cursor_position.visible,
    };
    build_regions(&projection, max_regions, include_text)
}

pub fn stale_cursor_warning(requested: Option<&str>, current: &str) -> Option<String> {
    let requested = requested?.trim();
    if requested.is_empty() || requested == current {
        return None;
    }
    Some(format!(
        "stale screen cursor: requested {requested}, current {current}"
    ))
}

fn build_regions(
    screen: &ScreenProjection<'_>,
    max_regions: Option<u32>,
    include_text: bool,
) -> (Vec<TerminalScreenRegion>, bool) {
    let mut candidates = Vec::new();
    let mut seen = BTreeSet::new();
    let style_by_id = screen
        .styles
        .iter()
        .map(|style| (style.style_id.as_str(), style))
        .collect::<BTreeMap<_, _>>();
    let inverse_runs = inverse_runs_by_row(screen.cells, &style_by_id);
    let has_menu_context = screen
        .visible_rows
        .iter()
        .any(|row| is_menu_context(&row.text));

    for seed in screen.seed_regions {
        match seed.kind.as_str() {
            "prompt" => push_candidate(
                &mut candidates,
                &mut seen,
                candidate_from_parts(
                    screen,
                    "prompt",
                    &seed.text,
                    seed.row_start,
                    seed.row_end,
                    seed.col_start,
                    seed.col_end,
                    seed.confidence.max(0.82),
                    &["read", "type"],
                    90,
                ),
            ),
            "hyperlink" | "link" => push_candidate(
                &mut candidates,
                &mut seen,
                candidate_from_parts(
                    screen,
                    "link",
                    &seed.text,
                    seed.row_start,
                    seed.row_end,
                    seed.col_start,
                    seed.col_end,
                    seed.confidence.max(0.92),
                    &["read", "open"],
                    78,
                ),
            ),
            _ => {}
        }
    }

    for link in screen.links {
        let text = seed_link_text(screen, link);
        push_candidate(
            &mut candidates,
            &mut seen,
            candidate_from_parts(
                screen,
                "link",
                &text,
                link.row_start,
                link.row_end,
                link.col_start,
                link.col_end,
                0.96,
                &["read", "open"],
                78,
            ),
        );
    }

    add_table_regions(screen, &mut candidates, &mut seen);

    for row in screen.visible_rows {
        let text = row.text.trim_end();
        if text.is_empty() {
            continue;
        }
        let bounds = row_bounds(text, screen.cols);
        let trimmed = text.trim_start();
        let leading = text
            .len()
            .saturating_sub(trimmed.len())
            .min(u16::MAX as usize) as u16;

        if let Some((marker_col, marker_width)) = checkbox_marker(trimmed) {
            push_candidate(
                &mut candidates,
                &mut seen,
                candidate_from_parts(
                    screen,
                    "checkbox",
                    trimmed,
                    row.row,
                    row.row,
                    leading.saturating_add(marker_col),
                    bounds.1,
                    0.82,
                    &["toggle", "confirm"],
                    82,
                ),
            );
            if marker_width > 0 {
                continue;
            }
        }

        if let Some((marker_col, marker_width)) = radio_marker(trimmed) {
            push_candidate(
                &mut candidates,
                &mut seen,
                candidate_from_parts(
                    screen,
                    "radio",
                    trimmed,
                    row.row,
                    row.row,
                    leading.saturating_add(marker_col),
                    bounds.1,
                    0.82,
                    &["select", "confirm"],
                    82,
                ),
            );
            if marker_width > 0 {
                continue;
            }
        }

        if is_menu_item(text, has_menu_context) {
            let selected = is_selected_menu_item(trimmed);
            push_candidate(
                &mut candidates,
                &mut seen,
                candidate_from_parts(
                    screen,
                    "menu_item",
                    trimmed,
                    row.row,
                    row.row,
                    leading,
                    bounds.1,
                    if selected { 0.86 } else { 0.58 },
                    &["select", "confirm"],
                    if selected { 84 } else { 52 },
                ),
            );
        }

        if let Some(button) = button_bounds(text, screen.cols) {
            push_candidate(
                &mut candidates,
                &mut seen,
                candidate_from_parts(
                    screen,
                    "button",
                    button.text,
                    row.row,
                    row.row,
                    button.col_start,
                    button.col_end,
                    0.72,
                    &["select", "confirm"],
                    62,
                ),
            );
        }

        if is_error_row(text) {
            push_candidate(
                &mut candidates,
                &mut seen,
                candidate_from_parts(
                    screen,
                    "error",
                    text,
                    row.row,
                    row.row,
                    bounds.0,
                    bounds.1,
                    0.74,
                    &["read"],
                    70,
                ),
            );
        } else if is_log_row(text) {
            push_candidate(
                &mut candidates,
                &mut seen,
                candidate_from_parts(
                    screen,
                    "log",
                    text,
                    row.row,
                    row.row,
                    bounds.0,
                    bounds.1,
                    0.56,
                    &["read"],
                    34,
                ),
            );
        }

        if is_status_row(screen, row, text, &inverse_runs) {
            push_candidate(
                &mut candidates,
                &mut seen,
                candidate_from_parts(
                    screen,
                    "status",
                    text,
                    row.row,
                    row.row,
                    bounds.0,
                    bounds.1,
                    if screen.mode == "alternate" {
                        0.74
                    } else {
                        0.58
                    },
                    &["read", "cancel"],
                    60,
                ),
            );
        }
    }

    for (row, runs) in inverse_runs {
        for (start_col, end_col) in runs {
            let text = row_text_for_cols(screen.visible_rows, row, start_col, end_col);
            if text.trim().is_empty() {
                continue;
            }
            push_candidate(
                &mut candidates,
                &mut seen,
                candidate_from_parts(
                    screen,
                    "selection",
                    text.trim(),
                    row,
                    row,
                    start_col,
                    end_col,
                    0.76,
                    &["select", "confirm"],
                    72,
                ),
            );
        }
    }

    add_input_region(screen, &mut candidates, &mut seen);
    add_prompt_fallback(screen, &mut candidates, &mut seen);
    add_unknown_fallback(screen, &mut candidates, &mut seen);

    candidates.sort_by(|left, right| {
        right
            .priority
            .cmp(&left.priority)
            .then_with(|| left.region.row_start.cmp(&right.region.row_start))
            .then_with(|| left.region.col_start.cmp(&right.region.col_start))
            .then_with(|| left.region.kind.cmp(&right.region.kind))
    });

    let limit = max_regions
        .map(|value| value.max(1) as usize)
        .unwrap_or(DEFAULT_MAX_REGIONS)
        .min(MAX_REGIONS);
    let truncated = candidates.len() > limit;
    candidates.truncate(limit);
    candidates.sort_by(|left, right| {
        left.region
            .row_start
            .cmp(&right.region.row_start)
            .then_with(|| left.region.col_start.cmp(&right.region.col_start))
            .then_with(|| left.region.kind.cmp(&right.region.kind))
    });

    let regions = candidates
        .into_iter()
        .map(|mut candidate| {
            if !include_text {
                candidate.region.text.clear();
            } else {
                candidate.region.text = truncate_region_text(&candidate.region.text);
            }
            candidate.region
        })
        .collect::<Vec<_>>();
    (regions, truncated)
}

fn add_input_region(
    screen: &ScreenProjection<'_>,
    candidates: &mut Vec<CandidateRegion>,
    seen: &mut BTreeSet<String>,
) {
    if !screen.cursor_visible {
        return;
    }
    let Some(row) = screen
        .visible_rows
        .iter()
        .find(|row| row.row == screen.cursor_row)
    else {
        return;
    };
    let text = row.text.trim_end();
    if text.is_empty() {
        return;
    }
    let input_start = prompt_input_start(text).unwrap_or_else(|| {
        screen
            .prompt
            .and_then(|prompt| {
                text.find(prompt.trim())
                    .map(|index| index + prompt.trim().len())
            })
            .unwrap_or(0)
    });
    let col_start = input_start.min(u16::MAX as usize) as u16;
    let col_end = screen.cursor_col.max(col_start).min(screen.cols);
    push_candidate(
        candidates,
        seen,
        candidate_from_parts(
            screen,
            "input",
            text,
            row.row,
            row.row,
            col_start,
            col_end.max(col_start.saturating_add(1)).min(screen.cols),
            0.68,
            &["type", "confirm", "cancel"],
            76,
        ),
    );
}

fn add_prompt_fallback(
    screen: &ScreenProjection<'_>,
    candidates: &mut Vec<CandidateRegion>,
    seen: &mut BTreeSet<String>,
) {
    let Some(prompt) = screen.prompt else {
        return;
    };
    if prompt.trim().is_empty() {
        return;
    }
    if candidates
        .iter()
        .any(|candidate| candidate.region.kind == "prompt")
    {
        return;
    }
    let row = screen
        .visible_rows
        .iter()
        .rev()
        .find(|row| row.text.contains(prompt.trim()))
        .map(|row| row.row)
        .unwrap_or(screen.cursor_row);
    let col_start = screen
        .visible_rows
        .iter()
        .find(|item| item.row == row)
        .and_then(|item| item.text.find(prompt.trim()))
        .unwrap_or(0)
        .min(u16::MAX as usize) as u16;
    let col_end = col_start
        .saturating_add(prompt.trim().chars().count().min(u16::MAX as usize) as u16)
        .min(screen.cols);
    push_candidate(
        candidates,
        seen,
        candidate_from_parts(
            screen,
            "prompt",
            prompt.trim(),
            row,
            row,
            col_start,
            col_end.max(col_start.saturating_add(1)).min(screen.cols),
            0.62,
            &["read", "type"],
            64,
        ),
    );
}

fn add_unknown_fallback(
    screen: &ScreenProjection<'_>,
    candidates: &mut Vec<CandidateRegion>,
    seen: &mut BTreeSet<String>,
) {
    if !candidates.is_empty() {
        return;
    }
    let rows = screen
        .visible_rows
        .iter()
        .filter(|row| !row.text.trim().is_empty())
        .collect::<Vec<_>>();
    let Some(first) = rows.first() else {
        return;
    };
    let Some(last) = rows.last() else {
        return;
    };
    let text = rows
        .iter()
        .map(|row| row.text.trim_end())
        .collect::<Vec<_>>()
        .join("\n");
    push_candidate(
        candidates,
        seen,
        candidate_from_parts(
            screen,
            "unknown",
            &text,
            first.row,
            last.row,
            0,
            screen.cols,
            0.25,
            &["read"],
            1,
        ),
    );
}

fn add_table_regions(
    screen: &ScreenProjection<'_>,
    candidates: &mut Vec<CandidateRegion>,
    seen: &mut BTreeSet<String>,
) {
    let mut start: Option<usize> = None;
    for index in 0..=screen.visible_rows.len() {
        let tableish = screen
            .visible_rows
            .get(index)
            .map(|row| is_table_row(&row.text))
            .unwrap_or(false);
        if tableish {
            start.get_or_insert(index);
            continue;
        }
        let Some(start_index) = start.take() else {
            continue;
        };
        if index.saturating_sub(start_index) < 2 {
            continue;
        }
        let rows = &screen.visible_rows[start_index..index];
        let text = rows
            .iter()
            .map(|row| row.text.trim_end())
            .collect::<Vec<_>>()
            .join("\n");
        let row_start = rows.first().map(|row| row.row).unwrap_or(0);
        let row_end = rows.last().map(|row| row.row).unwrap_or(row_start);
        push_candidate(
            candidates,
            seen,
            candidate_from_parts(
                screen,
                "table",
                &text,
                row_start,
                row_end,
                0,
                screen.cols,
                0.62,
                &["read"],
                50,
            ),
        );
    }
}

fn push_candidate(
    candidates: &mut Vec<CandidateRegion>,
    seen: &mut BTreeSet<String>,
    candidate: CandidateRegion,
) {
    let signature = format!(
        "{}:{}:{}:{}:{}:{}",
        candidate.region.kind,
        candidate.region.row_start,
        candidate.region.row_end,
        candidate.region.col_start,
        candidate.region.col_end,
        candidate.signature_text
    );
    if seen.insert(signature) {
        candidates.push(candidate);
    }
}

#[allow(clippy::too_many_arguments)]
fn candidate_from_parts(
    screen: &ScreenProjection<'_>,
    kind: &str,
    text: &str,
    row_start: u16,
    row_end: u16,
    col_start: u16,
    col_end: u16,
    confidence: f64,
    suggested_actions: &[&str],
    priority: u8,
) -> CandidateRegion {
    let clean_text = text.trim_end().to_string();
    let col_start = col_start.min(screen.cols);
    let mut col_end = col_end.min(screen.cols);
    if col_end <= col_start {
        col_end = col_start.saturating_add(1).min(screen.cols.max(1));
    }
    let region_id = stable_region_id(
        screen.screen_version,
        kind,
        row_start,
        row_end,
        col_start,
        col_end,
        &clean_text,
    );
    CandidateRegion {
        region: TerminalScreenRegion {
            region_id,
            kind: kind.to_string(),
            text: clean_text.clone(),
            row_start: row_start.min(screen.rows.saturating_sub(1)),
            row_end: row_end.min(screen.rows.saturating_sub(1)),
            col_start,
            col_end,
            confidence: confidence.clamp(0.0, 1.0),
            suggested_actions: suggested_actions
                .iter()
                .map(|action| (*action).to_string())
                .collect(),
        },
        priority,
        signature_text: clean_text,
    }
}

fn stable_region_id(
    screen_version: u32,
    kind: &str,
    row_start: u16,
    row_end: u16,
    col_start: u16,
    col_end: u16,
    text: &str,
) -> String {
    let mut hasher = Sha256::new();
    hasher.update(screen_version.to_le_bytes());
    hasher.update(kind.as_bytes());
    hasher.update(row_start.to_le_bytes());
    hasher.update(row_end.to_le_bytes());
    hasher.update(col_start.to_le_bytes());
    hasher.update(col_end.to_le_bytes());
    hasher.update(text.as_bytes());
    let digest = hasher.finalize();
    let suffix = digest
        .iter()
        .take(5)
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    format!("sv{screen_version}:{kind}:{row_start}:{col_start}:{suffix}")
}

fn truncate_region_text(value: &str) -> String {
    value.chars().take(MAX_REGION_TEXT_CHARS).collect()
}

fn inverse_runs_by_row(
    cells: &[TerminalScreenCell],
    styles_by_id: &BTreeMap<&str, &TerminalScreenStyle>,
) -> BTreeMap<u16, Vec<(u16, u16)>> {
    let mut rows = BTreeMap::<u16, Vec<(u16, u16)>>::new();
    let mut sorted = cells
        .iter()
        .filter(|cell| cell.width > 0)
        .collect::<Vec<_>>();
    sorted.sort_by_key(|cell| (cell.row, cell.col));
    let mut active_row = None;
    let mut active_start = 0_u16;
    let mut active_end = 0_u16;
    for cell in sorted {
        let inverse = cell
            .style_id
            .as_deref()
            .and_then(|style_id| styles_by_id.get(style_id))
            .is_some_and(|style| style.inverse);
        if !inverse {
            if let Some(row) = active_row.take() {
                rows.entry(row)
                    .or_default()
                    .push((active_start, active_end));
            }
            continue;
        }
        let cell_end = cell.col.saturating_add(cell.width.max(1));
        if active_row == Some(cell.row) && cell.col <= active_end.saturating_add(1) {
            active_end = active_end.max(cell_end);
            continue;
        }
        if let Some(row) = active_row.take() {
            rows.entry(row)
                .or_default()
                .push((active_start, active_end));
        }
        active_row = Some(cell.row);
        active_start = cell.col;
        active_end = cell_end;
    }
    if let Some(row) = active_row {
        rows.entry(row)
            .or_default()
            .push((active_start, active_end));
    }
    rows
}

fn row_text_for_cols(
    rows: &[TerminalScreenVisibleRow],
    row: u16,
    start_col: u16,
    end_col: u16,
) -> String {
    let Some(text) = rows
        .iter()
        .find(|item| item.row == row)
        .map(|item| &item.text)
    else {
        return String::new();
    };
    text.chars()
        .skip(usize::from(start_col))
        .take(usize::from(end_col.saturating_sub(start_col)))
        .collect()
}

fn row_bounds(text: &str, cols: u16) -> (u16, u16) {
    let leading = text
        .chars()
        .take_while(|value| value.is_whitespace())
        .count()
        .min(u16::MAX as usize) as u16;
    let width = text.trim_end().chars().count().min(u16::MAX as usize) as u16;
    (
        leading.min(cols),
        width.max(leading.saturating_add(1)).min(cols),
    )
}

fn is_menu_context(text: &str) -> bool {
    let trimmed = text.trim_start();
    trimmed.starts_with('?')
        || trimmed.to_ascii_lowercase().contains("choose ")
        || trimmed.to_ascii_lowercase().contains("select ")
}

fn is_selected_menu_item(trimmed: &str) -> bool {
    ["> ", "❯ ", "➜ ", "▶ ", "* "]
        .iter()
        .any(|marker| trimmed.starts_with(marker))
}

fn is_menu_item(text: &str, has_menu_context: bool) -> bool {
    let trimmed = text.trim_start();
    if trimmed.is_empty() {
        return false;
    }
    if is_selected_menu_item(trimmed) {
        return true;
    }
    has_menu_context
        && text.starts_with("  ")
        && !is_error_row(text)
        && !is_log_row(text)
        && !is_table_row(text)
}

fn checkbox_marker(trimmed: &str) -> Option<(u16, u16)> {
    let normalized = trimmed
        .strip_prefix("> ")
        .or_else(|| trimmed.strip_prefix("❯ "))
        .or_else(|| trimmed.strip_prefix("➜ "))
        .unwrap_or(trimmed);
    let offset = trimmed
        .len()
        .saturating_sub(normalized.len())
        .min(u16::MAX as usize) as u16;
    ["[ ]", "[x]", "[X]", "☐", "☑"]
        .iter()
        .find(|marker| normalized.starts_with(**marker))
        .map(|marker| (offset, marker.chars().count().min(u16::MAX as usize) as u16))
}

fn radio_marker(trimmed: &str) -> Option<(u16, u16)> {
    let normalized = trimmed
        .strip_prefix("> ")
        .or_else(|| trimmed.strip_prefix("❯ "))
        .or_else(|| trimmed.strip_prefix("➜ "))
        .unwrap_or(trimmed);
    let offset = trimmed
        .len()
        .saturating_sub(normalized.len())
        .min(u16::MAX as usize) as u16;
    ["( )", "(*)", "(x)", "(X)", "○", "●"]
        .iter()
        .find(|marker| normalized.starts_with(**marker))
        .map(|marker| (offset, marker.chars().count().min(u16::MAX as usize) as u16))
}

struct ButtonBounds<'a> {
    text: &'a str,
    col_start: u16,
    col_end: u16,
}

fn button_bounds(text: &str, cols: u16) -> Option<ButtonBounds<'_>> {
    let trimmed = text.trim();
    if trimmed.len() < 3 || checkbox_marker(trimmed).is_some() || radio_marker(trimmed).is_some() {
        return None;
    }
    let pairs = [('[', ']'), ('<', '>'), ('(', ')')];
    for (open, close) in pairs {
        let Some(start) = text.find(open) else {
            continue;
        };
        let Some(relative_end) = text[start + open.len_utf8()..].find(close) else {
            continue;
        };
        let end = start + open.len_utf8() + relative_end + close.len_utf8();
        let label = text[start + open.len_utf8()..start + open.len_utf8() + relative_end].trim();
        if label.is_empty() || label.len() > 24 {
            continue;
        }
        let looks_like_button = label
            .chars()
            .all(|value| value.is_alphanumeric() || value == ' ' || value == '-' || value == '_');
        if looks_like_button {
            return Some(ButtonBounds {
                text: &text[start..end],
                col_start: start.min(u16::MAX as usize) as u16,
                col_end: end.min(u16::MAX as usize).min(usize::from(cols)) as u16,
            });
        }
    }
    None
}

fn is_error_row(text: &str) -> bool {
    let lower = text.to_ascii_lowercase();
    [
        "error",
        "failed",
        "exception",
        "traceback",
        "panic",
        "fatal",
    ]
    .iter()
    .any(|needle| lower.contains(needle))
}

fn is_log_row(text: &str) -> bool {
    let trimmed = text.trim_start();
    let lower = trimmed.to_ascii_lowercase();
    lower.starts_with("[info]")
        || lower.starts_with("[warn]")
        || lower.starts_with("[debug]")
        || lower.starts_with("[trace]")
        || lower.starts_with("info ")
        || lower.starts_with("warn ")
        || looks_like_timestamp(trimmed)
}

fn looks_like_timestamp(text: &str) -> bool {
    let bytes = text.as_bytes();
    bytes.len() >= 8
        && bytes[0..4].iter().all(u8::is_ascii_digit)
        && bytes.get(4) == Some(&b'-')
        && bytes.get(7) == Some(&b'-')
}

fn is_status_row(
    screen: &ScreenProjection<'_>,
    row: &TerminalScreenVisibleRow,
    text: &str,
    inverse_runs: &BTreeMap<u16, Vec<(u16, u16)>>,
) -> bool {
    let lower = text.to_ascii_lowercase();
    if lower.contains("-- insert --")
        || lower.contains("-- normal --")
        || lower.contains("press q to quit")
        || lower.starts_with(':')
    {
        return true;
    }
    if screen.mode == "alternate" {
        let last_non_empty = screen
            .visible_rows
            .iter()
            .rev()
            .find(|item| !item.text.trim().is_empty())
            .map(|item| item.row);
        if last_non_empty == Some(row.row) {
            return true;
        }
    }
    inverse_runs.get(&row.row).is_some_and(|runs| {
        runs.iter()
            .any(|(start, end)| end.saturating_sub(*start) >= 8)
    })
}

fn is_table_row(text: &str) -> bool {
    let trimmed = text.trim();
    if trimmed.len() < 5 || is_selected_menu_item(trimmed) {
        return false;
    }
    if trimmed.matches('|').count() >= 2 {
        return true;
    }
    let columns = trimmed
        .split("  ")
        .filter(|part| !part.trim().is_empty())
        .count();
    columns >= 3
}

fn prompt_input_start(text: &str) -> Option<usize> {
    let trimmed = text.trim_start();
    let leading = text.len().saturating_sub(trimmed.len());
    for marker in ["> ", "$ ", "% ", "# ", ": "] {
        if trimmed.starts_with(marker) {
            return Some(leading + marker.len());
        }
    }
    trimmed
        .rfind(['>', '$', '%', '#'])
        .map(|index| leading + index + 1)
}

fn seed_link_text(screen: &ScreenProjection<'_>, link: &TerminalScreenLink) -> String {
    let mut rows = Vec::new();
    for row in link.row_start..=link.row_end {
        rows.push(row_text_for_cols(
            screen.visible_rows,
            row,
            if row == link.row_start {
                link.col_start
            } else {
                0
            },
            if row == link.row_end {
                link.col_end
            } else {
                screen.cols
            },
        ));
    }
    let text = rows.join("\n").trim().to_string();
    if text.is_empty() {
        link.uri.clone()
    } else {
        text
    }
}
