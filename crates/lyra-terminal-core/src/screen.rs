use serde::Serialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;

const DEFAULT_SCROLLBACK_ROWS: usize = 2_000;
const DEFAULT_SCREEN_MAX_BYTES: usize = 16 * 1024;
const MAX_SCREEN_MAX_BYTES: usize = 256 * 1024;
const DEFAULT_SCREEN_MAX_ROWS: usize = 200;
const MAX_SCREEN_MAX_ROWS: usize = 2_000;
const MIN_SCREEN_CELL_BUDGET: usize = 128;
const MAX_SCREEN_CELL_BUDGET: usize = 4_096;
const LYRA_PROMPT_OSC: &[u8] = b"633";
const LYRA_PROMPT_READY: &[u8] = b"LyraPrompt";

#[cfg_attr(feature = "node-api", napi_derive::napi(object))]
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalScreenCursorPosition {
    pub row: u16,
    pub col: u16,
    pub visible: bool,
}

#[cfg_attr(feature = "node-api", napi_derive::napi(object))]
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalScreenRegion {
    pub region_id: String,
    pub kind: String,
    pub text: String,
    pub row_start: u16,
    pub row_end: u16,
    pub col_start: u16,
    pub col_end: u16,
    pub confidence: f64,
    pub suggested_actions: Vec<String>,
}

#[cfg_attr(feature = "node-api", napi_derive::napi(object))]
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalScreenVisibleRow {
    pub row: u16,
    pub text: String,
    pub wrapped: bool,
}

#[cfg_attr(feature = "node-api", napi_derive::napi(object))]
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalScreenCell {
    pub row: u16,
    pub col: u16,
    pub text: String,
    pub width: u16,
    pub style_id: Option<String>,
    pub hyperlink_id: Option<String>,
}

#[cfg_attr(feature = "node-api", napi_derive::napi(object))]
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalScreenStyle {
    pub style_id: String,
    pub foreground: String,
    pub background: String,
    pub bold: bool,
    pub dim: bool,
    pub italic: bool,
    pub underline: bool,
    pub inverse: bool,
}

#[cfg_attr(feature = "node-api", napi_derive::napi(object))]
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalScreenLink {
    pub link_id: String,
    pub uri: String,
    pub row_start: u16,
    pub row_end: u16,
    pub col_start: u16,
    pub col_end: u16,
}

#[cfg_attr(feature = "node-api", napi_derive::napi(object))]
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalScreenInputModes {
    pub application_cursor: bool,
    pub application_keypad: bool,
    pub bracketed_paste: bool,
    pub mouse_reporting: String,
    pub mouse_encoding: String,
    pub line_wrap: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalScreenDiffRow {
    pub row: u16,
    pub text: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalScreenDirtyRowRange {
    pub row: u16,
    pub start_col: u16,
    pub end_col: u16,
    pub text: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalScreenDiff {
    pub previous_screen_version: u64,
    pub screen_version: u64,
    pub previous_mode: String,
    pub mode: String,
    pub mode_changed: bool,
    pub dirty_rows: Vec<TerminalScreenDiffRow>,
    pub dirty_row_ranges: Vec<TerminalScreenDirtyRowRange>,
    pub previous_cursor: TerminalScreenCursorPosition,
    pub cursor: TerminalScreenCursorPosition,
    pub cursor_changed: bool,
    pub previous_input_modes: TerminalScreenInputModes,
    pub input_modes: TerminalScreenInputModes,
    pub style_hash: String,
    pub resized: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalScreenSnapshot {
    pub cursor: String,
    pub screen_version: u64,
    pub rows: u16,
    pub cols: u16,
    pub mode: String,
    pub visible_text: String,
    pub visible_rows: Vec<TerminalScreenVisibleRow>,
    pub scrollback_text: Option<String>,
    pub scrollback_cursor: String,
    pub scrollback_rows: Vec<TerminalScreenVisibleRow>,
    pub cursor_position: TerminalScreenCursorPosition,
    pub cells: Vec<TerminalScreenCell>,
    pub cells_truncated: bool,
    pub styles: Vec<TerminalScreenStyle>,
    pub links: Vec<TerminalScreenLink>,
    pub input_modes: TerminalScreenInputModes,
    pub selected_text: Option<String>,
    pub active_command: Option<String>,
    pub prompt: Option<String>,
    pub regions: Vec<TerminalScreenRegion>,
    pub truncated: bool,
}

pub struct TerminalScreenState {
    parser: vt100::Parser<TerminalScreenCallbacks>,
    screen_version: u64,
    line_wrap: bool,
}

impl TerminalScreenState {
    pub fn new(rows: u16, cols: u16) -> Self {
        Self {
            parser: vt100::Parser::new_with_callbacks(
                rows.max(1),
                cols.max(1),
                DEFAULT_SCROLLBACK_ROWS,
                TerminalScreenCallbacks::default(),
            ),
            screen_version: 0,
            line_wrap: true,
        }
    }

    pub fn feed(&mut self, bytes: &[u8]) -> TerminalScreenDiff {
        let previous = self.parser.screen().clone();
        let previous_screen_version = self.screen_version;
        let previous_mode = screen_mode(&previous);
        let previous_cursor = cursor_position(&previous);
        let previous_input_modes = input_modes(&previous, self.line_wrap);

        self.update_line_wrap_from_bytes(bytes);
        self.parser.process(bytes);
        self.screen_version = self.screen_version.saturating_add(1);

        self.diff_from_previous(
            previous_screen_version,
            &previous,
            previous_mode,
            previous_cursor,
            previous_input_modes,
            false,
        )
    }

    pub fn resize(&mut self, rows: u16, cols: u16) -> TerminalScreenDiff {
        let previous = self.parser.screen().clone();
        let previous_screen_version = self.screen_version;
        let previous_mode = screen_mode(&previous);
        let previous_cursor = cursor_position(&previous);
        let previous_input_modes = input_modes(&previous, self.line_wrap);

        self.parser.screen_mut().set_size(rows.max(1), cols.max(1));
        self.screen_version = self.screen_version.saturating_add(1);

        self.diff_from_previous(
            previous_screen_version,
            &previous,
            previous_mode,
            previous_cursor,
            previous_input_modes,
            true,
        )
    }

    pub fn snapshot(
        &self,
        include_scrollback: bool,
        max_rows: Option<u32>,
        max_bytes: Option<u32>,
    ) -> TerminalScreenSnapshot {
        let screen = self.parser.screen();
        let (rows, cols) = screen.size();
        let row_limit = max_rows
            .map(|value| value.max(1) as usize)
            .unwrap_or(DEFAULT_SCREEN_MAX_ROWS)
            .min(MAX_SCREEN_MAX_ROWS);
        let byte_limit = max_bytes
            .map(|value| value.max(1) as usize)
            .unwrap_or(DEFAULT_SCREEN_MAX_BYTES)
            .min(MAX_SCREEN_MAX_BYTES);
        let visible_rows = collect_visible_rows(screen, row_limit);
        let visible_row_truncated = usize::from(rows) > row_limit;
        let (visible_text, visible_byte_truncated) =
            truncate_utf8(&rows_to_text(&visible_rows), byte_limit);
        let (scrollback_cursor, scrollback_rows, scrollback_text, scrollback_truncated) =
            collect_scrollback_projection(
                screen,
                self.screen_version,
                include_scrollback,
                row_limit,
                byte_limit,
            );
        let links = self.parser.callbacks().visible_links(screen);
        let cell_budget = cell_budget(byte_limit);
        let (cells, styles, cells_truncated) =
            collect_cells_and_styles(screen, &links, row_limit, cell_budget);
        let cursor_position = cursor_position(screen);
        let prompt_projection = self.parser.callbacks().prompt_projection(screen);
        let regions = collect_regions(
            screen,
            &visible_rows,
            &links,
            prompt_projection.as_ref(),
            &cursor_position,
        );

        TerminalScreenSnapshot {
            cursor: self.screen_version.to_string(),
            screen_version: self.screen_version,
            rows,
            cols,
            mode: screen_mode(screen),
            visible_text,
            visible_rows,
            scrollback_text,
            scrollback_cursor,
            scrollback_rows,
            cursor_position,
            cells,
            cells_truncated,
            styles,
            links,
            input_modes: input_modes(screen, self.line_wrap),
            selected_text: None,
            active_command: None,
            prompt: prompt_projection.map(|prompt| prompt.text),
            regions,
            truncated: visible_row_truncated || visible_byte_truncated || scrollback_truncated,
        }
    }

    fn diff_from_previous(
        &self,
        previous_screen_version: u64,
        previous: &vt100::Screen,
        previous_mode: String,
        previous_cursor: TerminalScreenCursorPosition,
        previous_input_modes: TerminalScreenInputModes,
        resized: bool,
    ) -> TerminalScreenDiff {
        let screen = self.parser.screen();
        let (dirty_rows, dirty_row_ranges) = dirty_projection(previous, screen);
        let cursor = cursor_position(screen);
        let mode = screen_mode(screen);
        let input_modes = input_modes(screen, self.line_wrap);
        TerminalScreenDiff {
            previous_screen_version,
            screen_version: self.screen_version,
            previous_mode: previous_mode.clone(),
            mode: mode.clone(),
            mode_changed: previous_mode != mode,
            dirty_rows,
            dirty_row_ranges,
            previous_cursor: previous_cursor.clone(),
            cursor: cursor.clone(),
            cursor_changed: previous_cursor != cursor,
            previous_input_modes,
            input_modes,
            style_hash: style_hash(screen),
            resized,
        }
    }

    fn update_line_wrap_from_bytes(&mut self, bytes: &[u8]) {
        let mut index = 0;
        while index + 3 < bytes.len() {
            if bytes[index] != 0x1b || bytes[index + 1] != b'[' || bytes[index + 2] != b'?' {
                index += 1;
                continue;
            }
            let params_start = index + 3;
            let mut end = params_start;
            while end < bytes.len() && !bytes[end].is_ascii_alphabetic() {
                end += 1;
            }
            if end >= bytes.len() {
                break;
            }
            let action = bytes[end];
            if action == b'h' || action == b'l' {
                for param in bytes[params_start..end].split(|byte| *byte == b';') {
                    if param == b"7" {
                        self.line_wrap = action == b'h';
                    }
                }
            }
            index = end.saturating_add(1);
        }
    }
}

pub fn screen_diff_payload(diff: &TerminalScreenDiff) -> Value {
    json!({
        "previousScreenVersion": diff.previous_screen_version,
        "screenVersion": diff.screen_version,
        "previousMode": diff.previous_mode,
        "mode": diff.mode,
        "modeChanged": diff.mode_changed,
        "dirtyRows": diff.dirty_rows.iter().map(|row| {
            json!({
                "row": row.row,
                "text": row.text,
            })
        }).collect::<Vec<_>>(),
        "dirtyRowRanges": diff.dirty_row_ranges.iter().map(|range| {
            json!({
                "row": range.row,
                "startCol": range.start_col,
                "endCol": range.end_col,
                "text": range.text,
            })
        }).collect::<Vec<_>>(),
        "previousCursor": {
            "row": diff.previous_cursor.row,
            "col": diff.previous_cursor.col,
            "visible": diff.previous_cursor.visible
        },
        "cursor": {
            "row": diff.cursor.row,
            "col": diff.cursor.col,
            "visible": diff.cursor.visible
        },
        "cursorChanged": diff.cursor_changed,
        "previousInputModes": diff.previous_input_modes,
        "inputModes": diff.input_modes,
        "styleHash": diff.style_hash,
        "resized": diff.resized
    })
}

#[derive(Clone, Default)]
struct TerminalScreenCallbacks {
    next_link_id: u64,
    active_link: Option<ActiveLink>,
    links: Vec<TerminalScreenLink>,
    prompt_marker: Option<PromptMarker>,
}

#[derive(Clone)]
struct ActiveLink {
    link_id: String,
    uri: String,
    row_start: u16,
    col_start: u16,
}

#[derive(Clone)]
struct PromptMarker {
    row_start: u16,
    col_start: u16,
}

#[derive(Clone)]
struct PromptProjection {
    text: String,
    row_start: u16,
    row_end: u16,
    col_start: u16,
    col_end: u16,
}

impl TerminalScreenCallbacks {
    fn visible_links(&self, screen: &vt100::Screen) -> Vec<TerminalScreenLink> {
        let (rows, cols) = screen.size();
        let mut links = self
            .links
            .iter()
            .filter(|link| link.row_start < rows || link.row_end < rows)
            .cloned()
            .collect::<Vec<_>>();
        if let Some(active) = self.active_link.as_ref() {
            let (row_end, col_end) = screen.cursor_position();
            links.push(TerminalScreenLink {
                link_id: active.link_id.clone(),
                uri: active.uri.clone(),
                row_start: active.row_start.min(rows.saturating_sub(1)),
                row_end: row_end.min(rows.saturating_sub(1)),
                col_start: active.col_start.min(cols),
                col_end: col_end.min(cols),
            });
        }
        links
    }

    fn prompt_projection(&self, screen: &vt100::Screen) -> Option<PromptProjection> {
        prompt_projection_from_marker(screen, self.prompt_marker.as_ref()?)
    }

    fn close_active_link(&mut self, screen: &mut vt100::Screen) {
        let Some(active) = self.active_link.take() else {
            return;
        };
        let (rows, cols) = screen.size();
        let (row_end, col_end) = screen.cursor_position();
        if active.row_start == row_end && active.col_start == col_end {
            return;
        }
        self.links.push(TerminalScreenLink {
            link_id: active.link_id,
            uri: active.uri,
            row_start: active.row_start.min(rows.saturating_sub(1)),
            row_end: row_end.min(rows.saturating_sub(1)),
            col_start: active.col_start.min(cols),
            col_end: col_end.min(cols),
        });
    }
}

impl vt100::Callbacks for TerminalScreenCallbacks {
    fn unhandled_osc(&mut self, screen: &mut vt100::Screen, params: &[&[u8]]) {
        if params.first().copied() == Some(LYRA_PROMPT_OSC)
            && params.get(1).copied() == Some(LYRA_PROMPT_READY)
        {
            let (row_start, col_start) = screen.cursor_position();
            self.prompt_marker = Some(PromptMarker {
                row_start,
                col_start,
            });
            return;
        }
        if params.first().copied() != Some(b"8".as_slice()) {
            return;
        }
        let uri = params.get(2).copied().unwrap_or_default();
        if uri.is_empty() {
            self.close_active_link(screen);
            return;
        }
        self.close_active_link(screen);
        let (row_start, col_start) = screen.cursor_position();
        self.next_link_id = self.next_link_id.saturating_add(1);
        self.active_link = Some(ActiveLink {
            link_id: format!("link-{}", self.next_link_id),
            uri: String::from_utf8_lossy(uri).to_string(),
            row_start,
            col_start,
        });
    }
}

fn prompt_projection_from_marker(
    screen: &vt100::Screen,
    marker: &PromptMarker,
) -> Option<PromptProjection> {
    let (rows, cols) = screen.size();
    let (cursor_row, cursor_col) = screen.cursor_position();
    if marker.row_start >= rows || cursor_row < marker.row_start {
        return None;
    }

    let row_end = cursor_row.min(rows.saturating_sub(1));
    let mut lines = Vec::new();
    for row in marker.row_start..=row_end {
        let start_col = if row == marker.row_start {
            marker.col_start.min(cols)
        } else {
            0
        };
        let mut end_col = if row == row_end {
            cursor_col.min(cols)
        } else {
            cols
        };
        if end_col < start_col {
            end_col = cols;
        }
        lines.push(row_text_range(screen, row, start_col, end_col));
    }

    let text = lines.join("\n").trim().to_string();
    if text.is_empty() {
        return None;
    }

    Some(PromptProjection {
        text,
        row_start: marker.row_start,
        row_end,
        col_start: marker.col_start.min(cols),
        col_end: cursor_col.min(cols),
    })
}

fn dirty_projection(
    previous: &vt100::Screen,
    current: &vt100::Screen,
) -> (Vec<TerminalScreenDiffRow>, Vec<TerminalScreenDirtyRowRange>) {
    let (current_rows, current_cols) = current.size();
    let (previous_rows, previous_cols) = previous.size();
    let row_count = current_rows.max(previous_rows);
    let col_count = current_cols.max(previous_cols);
    let current_text_rows = current.rows(0, current_cols).collect::<Vec<_>>();
    let previous_text_rows = previous.rows(0, previous_cols).collect::<Vec<_>>();
    let mut dirty_rows = Vec::new();
    let mut dirty_row_ranges = Vec::new();

    for row_index in 0..row_count {
        let current_text = current_text_rows
            .get(usize::from(row_index))
            .map(String::as_str)
            .unwrap_or("");
        let previous_text = previous_text_rows
            .get(usize::from(row_index))
            .map(String::as_str)
            .unwrap_or("");
        let text_changed = current_text != previous_text;
        let wrap_changed = current.row_wrapped(row_index) != previous.row_wrapped(row_index);
        let range = dirty_cell_range(previous, current, row_index, col_count);

        if text_changed || wrap_changed || range.is_some() {
            dirty_rows.push(TerminalScreenDiffRow {
                row: row_index,
                text: current_text.trim_end().to_string(),
            });
            if let Some((start_col, end_col)) = range.or_else(|| {
                if wrap_changed || text_changed {
                    Some((0, current_cols))
                } else {
                    None
                }
            }) {
                dirty_row_ranges.push(TerminalScreenDirtyRowRange {
                    row: row_index,
                    start_col,
                    end_col,
                    text: row_text_range(current, row_index, start_col, end_col),
                });
            }
        }
    }

    (dirty_rows, dirty_row_ranges)
}

fn dirty_cell_range(
    previous: &vt100::Screen,
    current: &vt100::Screen,
    row: u16,
    cols: u16,
) -> Option<(u16, u16)> {
    let mut first = None;
    let mut last = None;
    for col in 0..cols {
        if cell_signature(previous.cell(row, col)) != cell_signature(current.cell(row, col)) {
            first.get_or_insert(col);
            last = Some(col);
        }
    }
    first
        .zip(last)
        .map(|(start, end)| (start, end.saturating_add(1)))
}

fn cell_signature(cell: Option<&vt100::Cell>) -> String {
    let Some(cell) = cell else {
        return "missing".to_string();
    };
    format!(
        "{}|{}|{}|{}|{}|{}|{}|{}|{}|{}|{}",
        cell.contents(),
        cell.is_wide(),
        cell.is_wide_continuation(),
        color_to_string(cell.fgcolor()),
        color_to_string(cell.bgcolor()),
        cell.bold(),
        cell.dim(),
        cell.italic(),
        cell.underline(),
        cell.inverse(),
        cell.has_contents()
    )
}

fn row_text_range(screen: &vt100::Screen, row: u16, start_col: u16, end_col: u16) -> String {
    let mut text = String::new();
    for col in start_col..end_col {
        let Some(cell) = screen.cell(row, col) else {
            continue;
        };
        if cell.is_wide_continuation() {
            continue;
        }
        text.push_str(cell.contents());
    }
    text.trim_end().to_string()
}

fn collect_visible_rows(screen: &vt100::Screen, row_limit: usize) -> Vec<TerminalScreenVisibleRow> {
    let (_rows, cols) = screen.size();
    screen
        .rows(0, cols)
        .take(row_limit)
        .enumerate()
        .map(|(index, row)| {
            let row_index = index.min(u16::MAX as usize) as u16;
            TerminalScreenVisibleRow {
                row: row_index,
                text: row.trim_end().to_string(),
                wrapped: screen.row_wrapped(row_index),
            }
        })
        .collect::<Vec<_>>()
}

fn collect_scrollback_projection(
    screen: &vt100::Screen,
    screen_version: u64,
    include_scrollback: bool,
    row_limit: usize,
    byte_limit: usize,
) -> (String, Vec<TerminalScreenVisibleRow>, Option<String>, bool) {
    let mut scrolled = screen.clone();
    scrolled.set_scrollback(usize::MAX);
    let scrollback_count = scrolled.scrollback();
    let scrollback_cursor = format!("{screen_version}:{scrollback_count}");
    if !include_scrollback {
        return (scrollback_cursor, Vec::new(), None, false);
    }
    let scrollback_rows = collect_visible_rows(&scrolled, row_limit);
    let row_truncated = scrollback_count > row_limit;
    let (scrollback_text, byte_truncated) =
        truncate_utf8(&rows_to_text(&scrollback_rows), byte_limit);
    (
        scrollback_cursor,
        scrollback_rows,
        Some(scrollback_text),
        row_truncated || byte_truncated,
    )
}

fn collect_cells_and_styles(
    screen: &vt100::Screen,
    links: &[TerminalScreenLink],
    row_limit: usize,
    cell_budget: usize,
) -> (Vec<TerminalScreenCell>, Vec<TerminalScreenStyle>, bool) {
    let (rows, cols) = screen.size();
    let row_count = usize::from(rows).min(row_limit);
    let mut cells = Vec::new();
    let mut styles = Vec::new();
    let mut style_ids_by_key = BTreeMap::<String, String>::new();
    let mut cells_truncated = false;

    'rows: for row in 0..row_count {
        let row = row.min(u16::MAX as usize) as u16;
        for col in 0..cols {
            if cells.len() >= cell_budget {
                cells_truncated = usize::from(row) + 1 < usize::from(rows) || col < cols;
                break 'rows;
            }
            let Some(cell) = screen.cell(row, col) else {
                continue;
            };
            let style = style_from_cell(cell);
            let style_id = if style_is_default(cell) {
                None
            } else {
                Some(style_id_for(style, &mut style_ids_by_key, &mut styles))
            };
            cells.push(TerminalScreenCell {
                row,
                col,
                text: if cell.is_wide_continuation() {
                    String::new()
                } else {
                    cell.contents().to_string()
                },
                width: if cell.is_wide_continuation() {
                    0
                } else if cell.is_wide() {
                    2
                } else {
                    1
                },
                style_id,
                hyperlink_id: hyperlink_id_for_cell(links, row, col),
            });
        }
    }

    (cells, styles, cells_truncated)
}

fn collect_regions(
    screen: &vt100::Screen,
    visible_rows: &[TerminalScreenVisibleRow],
    links: &[TerminalScreenLink],
    prompt: Option<&PromptProjection>,
    cursor: &TerminalScreenCursorPosition,
) -> Vec<TerminalScreenRegion> {
    let (_rows, cols) = screen.size();
    let mut regions = Vec::new();

    if let Some(prompt) = prompt {
        regions.push(TerminalScreenRegion {
            region_id: "prompt".to_string(),
            kind: "prompt".to_string(),
            text: prompt.text.clone(),
            row_start: prompt.row_start,
            row_end: prompt.row_end,
            col_start: prompt.col_start,
            col_end: prompt.col_end,
            confidence: 0.88,
            suggested_actions: vec!["copy-prompt".to_string()],
        });
    }

    if let Some(row) = visible_rows.iter().find(|row| row.row == cursor.row) {
        regions.push(TerminalScreenRegion {
            region_id: "cursor-line".to_string(),
            kind: "cursor_line".to_string(),
            text: row.text.clone(),
            row_start: cursor.row,
            row_end: cursor.row,
            col_start: 0,
            col_end: cols,
            confidence: 0.92,
            suggested_actions: vec!["copy-row".to_string(), "terminal-act".to_string()],
        });
    }

    for link in links {
        regions.push(TerminalScreenRegion {
            region_id: format!("hyperlink:{}", link.link_id),
            kind: "hyperlink".to_string(),
            text: link_text(screen, link),
            row_start: link.row_start,
            row_end: link.row_end,
            col_start: link.col_start,
            col_end: link.col_end,
            confidence: 0.96,
            suggested_actions: vec!["open-link".to_string(), "copy-link".to_string()],
        });
    }

    regions
}

fn link_text(screen: &vt100::Screen, link: &TerminalScreenLink) -> String {
    let (_rows, cols) = screen.size();
    let mut lines = Vec::new();
    for row in link.row_start..=link.row_end {
        let start_col = if row == link.row_start {
            link.col_start.min(cols)
        } else {
            0
        };
        let end_col = if row == link.row_end {
            link.col_end.min(cols)
        } else {
            cols
        };
        lines.push(row_text_range(screen, row, start_col, end_col));
    }
    let text = lines.join("\n").trim().to_string();
    if text.is_empty() {
        link.uri.clone()
    } else {
        text
    }
}

fn style_id_for(
    mut style: TerminalScreenStyle,
    style_ids_by_key: &mut BTreeMap<String, String>,
    styles: &mut Vec<TerminalScreenStyle>,
) -> String {
    let key = style_key(&style);
    if let Some(style_id) = style_ids_by_key.get(&key) {
        return style_id.clone();
    }
    let style_id = format!("style-{}", styles.len() + 1);
    style.style_id = style_id.clone();
    style_ids_by_key.insert(key, style_id.clone());
    styles.push(style);
    style_id
}

fn style_from_cell(cell: &vt100::Cell) -> TerminalScreenStyle {
    TerminalScreenStyle {
        style_id: String::new(),
        foreground: color_to_string(cell.fgcolor()),
        background: color_to_string(cell.bgcolor()),
        bold: cell.bold(),
        dim: cell.dim(),
        italic: cell.italic(),
        underline: cell.underline(),
        inverse: cell.inverse(),
    }
}

fn style_key(style: &TerminalScreenStyle) -> String {
    format!(
        "{}|{}|{}|{}|{}|{}|{}",
        style.foreground,
        style.background,
        style.bold,
        style.dim,
        style.italic,
        style.underline,
        style.inverse
    )
}

fn style_is_default(cell: &vt100::Cell) -> bool {
    matches!(cell.fgcolor(), vt100::Color::Default)
        && matches!(cell.bgcolor(), vt100::Color::Default)
        && !cell.bold()
        && !cell.dim()
        && !cell.italic()
        && !cell.underline()
        && !cell.inverse()
}

fn hyperlink_id_for_cell(links: &[TerminalScreenLink], row: u16, col: u16) -> Option<String> {
    links
        .iter()
        .find(|link| cell_in_link(row, col, link))
        .map(|link| link.link_id.clone())
}

fn cell_in_link(row: u16, col: u16, link: &TerminalScreenLink) -> bool {
    if row < link.row_start || row > link.row_end {
        return false;
    }
    if link.row_start == link.row_end {
        return col >= link.col_start && col < link.col_end;
    }
    if row == link.row_start {
        return col >= link.col_start;
    }
    if row == link.row_end {
        return col < link.col_end;
    }
    true
}

fn rows_to_text(rows: &[TerminalScreenVisibleRow]) -> String {
    rows.iter()
        .map(|row| row.text.as_str())
        .collect::<Vec<_>>()
        .join("\n")
}

fn cursor_position(screen: &vt100::Screen) -> TerminalScreenCursorPosition {
    let (cursor_row, cursor_col) = screen.cursor_position();
    TerminalScreenCursorPosition {
        row: cursor_row,
        col: cursor_col,
        visible: !screen.hide_cursor(),
    }
}

fn input_modes(screen: &vt100::Screen, line_wrap: bool) -> TerminalScreenInputModes {
    TerminalScreenInputModes {
        application_cursor: screen.application_cursor(),
        application_keypad: screen.application_keypad(),
        bracketed_paste: screen.bracketed_paste(),
        mouse_reporting: mouse_mode_to_string(screen.mouse_protocol_mode()),
        mouse_encoding: mouse_encoding_to_string(screen.mouse_protocol_encoding()),
        line_wrap,
    }
}

fn mouse_mode_to_string(mode: vt100::MouseProtocolMode) -> String {
    match mode {
        vt100::MouseProtocolMode::None => "none",
        vt100::MouseProtocolMode::Press => "press",
        vt100::MouseProtocolMode::PressRelease => "pressRelease",
        vt100::MouseProtocolMode::ButtonMotion => "buttonMotion",
        vt100::MouseProtocolMode::AnyMotion => "anyMotion",
    }
    .to_string()
}

fn mouse_encoding_to_string(encoding: vt100::MouseProtocolEncoding) -> String {
    match encoding {
        vt100::MouseProtocolEncoding::Default => "default",
        vt100::MouseProtocolEncoding::Utf8 => "utf8",
        vt100::MouseProtocolEncoding::Sgr => "sgr",
    }
    .to_string()
}

fn screen_mode(screen: &vt100::Screen) -> String {
    if screen.alternate_screen() {
        "alternate"
    } else {
        "normal"
    }
    .to_string()
}

fn color_to_string(color: vt100::Color) -> String {
    match color {
        vt100::Color::Default => "default".to_string(),
        vt100::Color::Idx(index) => format!("idx:{index}"),
        vt100::Color::Rgb(red, green, blue) => format!("rgb:{red},{green},{blue}"),
    }
}

fn style_hash(screen: &vt100::Screen) -> String {
    let (rows, cols) = screen.size();
    let mut hasher = Sha256::new();
    for row in 0..rows {
        for col in 0..cols {
            hasher.update(cell_signature(screen.cell(row, col)).as_bytes());
            hasher.update(b"\0");
        }
        hasher.update([u8::from(screen.row_wrapped(row))]);
    }
    let digest = hasher.finalize();
    digest
        .iter()
        .take(8)
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>()
}

fn cell_budget(byte_limit: usize) -> usize {
    (byte_limit / 32).clamp(MIN_SCREEN_CELL_BUDGET, MAX_SCREEN_CELL_BUDGET)
}

fn truncate_utf8(value: &str, max_bytes: usize) -> (String, bool) {
    if value.len() <= max_bytes {
        return (value.to_string(), false);
    }
    let mut end = max_bytes;
    while end > 0 && !value.is_char_boundary(end) {
        end -= 1;
    }
    (value[..end].to_string(), true)
}

#[cfg(test)]
mod tests {
    use serde_json::Value;

    use super::{screen_diff_payload, TerminalScreenState};

    #[test]
    fn screen_tracks_cursor_movement_and_clear() {
        let mut state = TerminalScreenState::new(4, 12);
        state.feed(b"hello");
        state.feed(b"\rworld");
        let snapshot = state.snapshot(false, None, None);
        assert!(snapshot.visible_text.contains("world"));
        assert!(!snapshot.visible_text.contains("hello"));

        state.feed(b"\x1b[2J\x1b[Hafter");
        let snapshot = state.snapshot(false, None, None);
        assert!(snapshot.visible_text.starts_with("after"));
        assert_eq!(snapshot.cursor_position.row, 0);
        assert_eq!(snapshot.cursor_position.col, 5);
    }

    #[test]
    fn screen_resize_changes_snapshot_size() {
        let mut state = TerminalScreenState::new(2, 8);
        state.feed(b"line one\nline two\nline three");
        state.resize(5, 20);
        let snapshot = state.snapshot(false, None, None);
        assert_eq!(snapshot.rows, 5);
        assert_eq!(snapshot.cols, 20);
        assert!(snapshot.screen_version >= 2);
    }

    #[test]
    fn screen_snapshot_truncates_projection_without_losing_version() {
        let mut state = TerminalScreenState::new(4, 20);
        state.feed(b"0123456789abcdef");
        let snapshot = state.snapshot(false, None, Some(5));
        assert_eq!(snapshot.visible_text, "01234");
        assert!(snapshot.truncated);
        assert_eq!(snapshot.cursor, snapshot.screen_version.to_string());
    }

    #[test]
    fn screen_tracks_alternate_screen_best_effort() {
        let mut state = TerminalScreenState::new(4, 20);
        let diff = state.feed(b"\x1b[?1049hinside");
        let snapshot = state.snapshot(false, None, None);
        assert_eq!(snapshot.mode, "alternate");
        assert_eq!(diff.previous_mode, "normal");
        assert_eq!(diff.mode, "alternate");
        assert!(diff.mode_changed);
        assert!(snapshot.visible_text.contains("inside"));
    }

    #[test]
    fn screen_diff_tracks_previous_current_cursor_and_ranges() {
        let mut state = TerminalScreenState::new(4, 12);
        state.feed(b"hello");
        let diff = state.feed(b"\x1b[Hj");
        assert_eq!(diff.previous_screen_version, 1);
        assert_eq!(diff.screen_version, 2);
        assert_eq!(diff.previous_cursor.col, 5);
        assert_eq!(diff.cursor.col, 1);
        assert!(diff.cursor_changed);
        assert_eq!(diff.dirty_row_ranges[0].row, 0);
        assert_eq!(diff.dirty_row_ranges[0].start_col, 0);
        assert!(diff.dirty_row_ranges[0].end_col >= 1);
    }

    #[test]
    fn screen_snapshot_includes_visible_rows_cells_styles_and_input_modes() {
        let mut state = TerminalScreenState::new(3, 12);
        state.feed(b"\x1b[31;1mred\x1b[m\nwide \xe4\xb8\xad");
        state.feed(b"\x1b[?1h\x1b[?2004h\x1b[?1000h\x1b[?1006h\x1b[?7l");
        let snapshot = state.snapshot(false, Some(3), Some(4096));
        assert_eq!(snapshot.visible_rows[0].row, 0);
        assert!(snapshot.visible_rows[0].text.contains("red"));
        assert!(snapshot.cells.iter().any(|cell| cell.text == "r"));
        assert!(snapshot.styles.iter().any(|style| style.bold));
        assert!(snapshot.input_modes.application_cursor);
        assert!(snapshot.input_modes.bracketed_paste);
        assert_eq!(snapshot.input_modes.mouse_reporting, "pressRelease");
        assert_eq!(snapshot.input_modes.mouse_encoding, "sgr");
        assert!(!snapshot.input_modes.line_wrap);
        assert!(snapshot
            .cells
            .iter()
            .any(|cell| cell.text == "中" && cell.width == 2));
    }

    #[test]
    fn screen_tracks_osc8_hyperlinks_for_visible_cells() {
        let mut state = TerminalScreenState::new(3, 40);
        state.feed(b"\x1b]8;;https://example.test\x07link\x1b]8;;\x07");
        let snapshot = state.snapshot(false, Some(3), Some(4096));
        assert_eq!(snapshot.links.len(), 1);
        assert_eq!(snapshot.links[0].uri, "https://example.test");
        assert!(snapshot
            .cells
            .iter()
            .filter(|cell| cell.text == "l")
            .any(|cell| cell.hyperlink_id.as_deref() == Some("link-1")));
        assert!(snapshot
            .regions
            .iter()
            .any(|region| region.kind == "hyperlink" && region.text == "link"));
    }

    #[test]
    fn screen_tracks_prompt_marker_and_terminal_map_regions() {
        let mut state = TerminalScreenState::new(4, 40);
        state.feed(b"\x1b]633;LyraPrompt\x07petehsu ~/Lyra\n$ ");
        let snapshot = state.snapshot(false, Some(4), Some(4096));
        assert_eq!(snapshot.prompt.as_deref(), Some("petehsu ~/Lyra\n$"));
        assert!(snapshot
            .regions
            .iter()
            .any(|region| region.kind == "prompt" && region.text.contains("~/Lyra")));
        assert!(snapshot
            .regions
            .iter()
            .any(|region| region.kind == "cursor_line" && region.text.contains('$')));
    }

    #[test]
    fn screen_tracks_wide_and_combining_cells() {
        let mut state = TerminalScreenState::new(3, 20);
        state.feed(b"\xe4\xb8\xad e\xcc\x81");
        let snapshot = state.snapshot(false, Some(3), Some(4096));
        assert!(snapshot
            .cells
            .iter()
            .any(|cell| cell.text == "\u{4e2d}" && cell.width == 2));
        assert!(snapshot
            .cells
            .iter()
            .any(|cell| cell.text == "e\u{301}" && cell.width == 1));
    }

    #[test]
    fn fixture_less_alternate_screen_visible_page() {
        let mut state = TerminalScreenState::new(6, 40);
        state.feed(b"\x1b[?1049h\x1b[H\x1b[2J");
        state.feed(b"README.md\n\nLine 1\nLine 2\n:");
        let snapshot = state.snapshot(false, Some(6), Some(4096));
        assert_eq!(snapshot.mode, "alternate");
        assert!(snapshot.visible_text.contains("README.md"));
        assert!(snapshot.visible_text.contains("Line 2"));
        assert!(snapshot.visible_text.contains(":"));
    }

    #[test]
    fn fixture_vim_alternate_screen_status_line() {
        let mut state = TerminalScreenState::new(8, 50);
        state.feed(b"\x1b[?1049h\x1b[H\x1b[2J");
        state.feed(b"fn main() {\n    println!(\"hi\");\n}\n\x1b[7;1H\x1b[7m-- INSERT --\x1b[0m");
        let snapshot = state.snapshot(false, Some(8), Some(4096));
        assert_eq!(snapshot.mode, "alternate");
        assert!(snapshot.visible_text.contains("fn main"));
        assert!(snapshot.visible_text.contains("-- INSERT --"));
    }

    #[test]
    fn fixture_top_like_updates_do_not_scroll_unbounded() {
        let mut state = TerminalScreenState::new(5, 40);
        state.feed(b"\x1b[?1049h");
        for tick in 0..20 {
            let frame = format!(
                "\x1b[H\x1b[2Ktop - tick {tick}\x1b[2;1H\x1b[2KPID CPU COMMAND\x1b[3;1H\x1b[2K100 {tick:02}% worker\x1b[4;1H\x1b[2Kq to quit"
            );
            let diff = state.feed(frame.as_bytes());
            assert!(diff.dirty_rows.len() <= 5);
        }
        let snapshot = state.snapshot(true, Some(5), Some(4096));
        assert_eq!(snapshot.mode, "alternate");
        assert!(snapshot.visible_text.contains("tick 19"));
        assert!(snapshot.visible_text.contains("worker"));
        assert!(snapshot.scrollback_cursor.ends_with(":0"));
    }

    #[test]
    fn fixture_pnpm_dev_logs_and_status_remain_readable() {
        let mut state = TerminalScreenState::new(6, 60);
        state.feed(b"> app@ dev /workspace\n> vite --host 127.0.0.1\n\n");
        state.feed(b"  VITE v5.0.0 ready in 120 ms\n  Local: http://127.0.0.1:5173/\n");
        let snapshot = state.snapshot(true, Some(6), Some(4096));
        assert_eq!(snapshot.mode, "normal");
        assert!(snapshot.visible_text.contains("VITE"));
        assert!(snapshot.visible_text.contains("127.0.0.1:5173"));
    }

    #[test]
    fn fixture_cli_wizard_selection_is_visible() {
        let mut state = TerminalScreenState::new(6, 44);
        state.feed(b"? Choose package manager\n  npm\n\x1b[7m> pnpm\x1b[0m\n  yarn");
        let snapshot = state.snapshot(false, Some(6), Some(4096));
        assert!(snapshot.visible_text.contains("Choose package manager"));
        assert!(snapshot.visible_text.contains("> pnpm"));
        assert!(snapshot.styles.iter().any(|style| style.inverse));
    }

    #[test]
    fn fixture_repl_prompt_and_current_input_are_visible() {
        let mut state = TerminalScreenState::new(5, 40);
        state.feed(b"node\n> const value = 42");
        let snapshot = state.snapshot(false, Some(5), Some(4096));
        assert!(snapshot.visible_text.contains("> const value = 42"));
        assert_eq!(snapshot.cursor_position.row, 1);
        assert!(snapshot.cursor_position.col >= 18);
    }

    #[test]
    fn fixture_resize_preserves_meaningful_screen_state() {
        let mut state = TerminalScreenState::new(4, 20);
        state.feed(b"alpha\nbeta\ngamma");
        let diff = state.resize(8, 50);
        let snapshot = state.snapshot(false, Some(8), Some(4096));
        assert!(diff.resized);
        assert_eq!(snapshot.rows, 8);
        assert_eq!(snapshot.cols, 50);
        assert!(snapshot.visible_text.contains("alpha"));
        assert!(snapshot.visible_text.contains("gamma"));
    }

    #[test]
    fn fixture_unicode_emoji_and_hyperlinks_survive_projection() {
        let mut state = TerminalScreenState::new(4, 50);
        state.feed("emoji 🙂 中\n".as_bytes());
        state.feed(b"\x1b]8;;https://example.test/path\x07open\x1b]8;;\x07");
        let snapshot = state.snapshot(false, Some(4), Some(4096));
        assert!(snapshot.visible_text.contains("emoji"));
        assert!(snapshot
            .cells
            .iter()
            .any(|cell| cell.text == "🙂" && cell.width == 2));
        assert!(snapshot
            .cells
            .iter()
            .any(|cell| cell.text == "中" && cell.width == 2));
        assert_eq!(snapshot.links[0].uri, "https://example.test/path");
    }

    #[test]
    fn screen_diff_payload_is_budgeted_and_replay_friendly() {
        let mut state = TerminalScreenState::new(3, 12);
        let diff = state.feed(b"ready");
        let payload = screen_diff_payload(&diff);
        assert_eq!(payload["previousScreenVersion"], Value::from(0));
        assert_eq!(payload["screenVersion"], Value::from(1));
        assert_eq!(payload["mode"], Value::from("normal"));
        assert_eq!(payload["cursorChanged"], Value::from(true));
        assert!(payload["dirtyRowRanges"].as_array().is_some());
        assert!(payload["styleHash"].as_str().is_some());
    }

    #[test]
    fn fuzz_ansi_parser_input_does_not_panic() {
        let mut state = TerminalScreenState::new(6, 20);
        let corpus = [
            b"\x1b[999;999Hedge".as_slice(),
            b"\x1b[?1049halt\x1b[?1049l",
            b"\x1b]8;;https://example.test\x07text\x1b]8;;\x07",
            b"\x1b[31mred\x1b[0m\x1b[?2004h",
            b"\xff\xfe\xfa\x1b[2J\x1b[H",
        ];
        for sample in corpus {
            state.feed(sample);
            let snapshot = state.snapshot(true, Some(6), Some(2048));
            assert_eq!(snapshot.rows, 6);
            assert_eq!(snapshot.cols, 20);
        }
    }
}
