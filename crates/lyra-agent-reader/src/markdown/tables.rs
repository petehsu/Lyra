//! GFM table rendering.

use ego_tree::NodeRef;
use scraper::Node;

use super::Renderer;

/// Render a `<table>` node to a GFM pipe table. Returns `None` if the table has
/// no usable rows (the caller then falls back to rendering children inline).
pub fn render_table<'a>(renderer: &mut Renderer<'a>, table: NodeRef<'a, Node>) -> Option<String> {
    let rows = collect_rows(renderer, table);
    if rows.is_empty() {
        return None;
    }
    let columns = rows.iter().map(Vec::len).max().unwrap_or(0);
    if columns == 0 {
        return None;
    }

    let mut out = String::new();
    // First row is the header (GFM requires a header row).
    let header = &rows[0];
    out.push_str(&render_row(header, columns));
    out.push('\n');
    out.push_str(&render_separator(columns));
    out.push('\n');
    for row in &rows[1..] {
        out.push_str(&render_row(row, columns));
        out.push('\n');
    }
    Some(out)
}

fn collect_rows<'a>(renderer: &mut Renderer<'a>, table: NodeRef<'a, Node>) -> Vec<Vec<String>> {
    let mut rows = Vec::new();
    collect_rows_recursive(renderer, table, &mut rows);
    rows
}

fn collect_rows_recursive<'a>(
    renderer: &mut Renderer<'a>,
    node: NodeRef<'a, Node>,
    rows: &mut Vec<Vec<String>>,
) {
    for child in node.children() {
        if renderer.is_excluded(child.id()) {
            continue;
        }
        let Some(element) = child.value().as_element() else {
            continue;
        };
        match element.name() {
            "tr" => rows.push(render_cells(renderer, child)),
            "thead" | "tbody" | "tfoot" => collect_rows_recursive(renderer, child, rows),
            _ => {}
        }
    }
}

fn render_cells<'a>(renderer: &mut Renderer<'a>, tr: NodeRef<'a, Node>) -> Vec<String> {
    let mut cells = Vec::new();
    for child in tr.children() {
        if renderer.is_excluded(child.id()) {
            continue;
        }
        let Some(element) = child.value().as_element() else {
            continue;
        };
        if matches!(element.name(), "td" | "th") {
            let text = renderer.render_inline_subtree(child);
            cells.push(sanitize_cell(&text));
        }
    }
    cells
}

/// Pipes and newlines break GFM tables; escape/replace them.
fn sanitize_cell(text: &str) -> String {
    text.replace('\n', " ")
        .replace('|', "\\|")
        .trim()
        .to_string()
}

fn render_row(cells: &[String], columns: usize) -> String {
    let mut out = String::from("|");
    for index in 0..columns {
        let value = cells.get(index).map(String::as_str).unwrap_or("");
        out.push(' ');
        out.push_str(value);
        out.push_str(" |");
    }
    out
}

fn render_separator(columns: usize) -> String {
    let mut out = String::from("|");
    for _ in 0..columns {
        out.push_str(" --- |");
    }
    out
}
