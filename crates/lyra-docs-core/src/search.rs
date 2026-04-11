pub fn excerpt_for_match(text: &str, start: usize, end: usize, radius: usize) -> String {
    let start_bound = start.saturating_sub(radius);
    let end_bound = text.len().min(end.saturating_add(radius));
    let snippet = text
        .get(start_bound..end_bound)
        .unwrap_or("")
        .replace('\n', " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    snippet.trim().to_string()
}
