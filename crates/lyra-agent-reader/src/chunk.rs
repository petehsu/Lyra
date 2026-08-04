//! Markdown chunking and local query-focused filtering.

use std::collections::{HashMap, HashSet};

use crate::budget;
use crate::types::{
    ChunkingMode, ChunkingOptions, ContentFilterMode, FilteredOutSummary, FitChunkScoreDebug,
    ReaderChunk,
};

const DEFAULT_FIT_LIMIT: usize = 6;

/// Generate chunks according to the requested chunking options.
pub fn generate(markdown: &str, options: &ChunkingOptions) -> Vec<ReaderChunk> {
    match options.mode {
        ChunkingMode::Disabled => Vec::new(),
        ChunkingMode::Heading => heading_chunks(markdown, options.overlap_chars),
        ChunkingMode::Block => {
            block_chunks(markdown, options.max_chars_per_chunk, options.overlap_chars)
        }
    }
}

/// Query-focused fit markdown output.
#[derive(Debug, Default)]
pub struct FitMarkdownResult {
    pub markdown: String,
    pub chunks: Vec<ReaderChunk>,
    pub filtered_out_summary: Option<FilteredOutSummary>,
    pub scoring_debug: Vec<FitChunkScoreDebug>,
}

/// Generate query-focused chunks and markdown.
pub fn fit_markdown(
    markdown: &str,
    chunks: &[ReaderChunk],
    query: Option<&str>,
    mode: ContentFilterMode,
) -> FitMarkdownResult {
    if mode == ContentFilterMode::None {
        return FitMarkdownResult::default();
    }
    let query = query.unwrap_or("").trim();
    if query.is_empty() {
        return FitMarkdownResult::default();
    }

    let corpus = if chunks.is_empty() {
        block_chunks(markdown, 4_000, 0)
    } else {
        chunks.to_vec()
    };
    if corpus.is_empty() {
        return FitMarkdownResult::default();
    }

    let query_terms = tokenize(query);
    if query_terms.is_empty() {
        return FitMarkdownResult::default();
    }

    let mut document_terms = Vec::new();
    let mut document_frequency: HashMap<String, usize> = HashMap::new();
    for chunk in &corpus {
        let terms = tokenize(&chunk.plain_text);
        let unique = terms.iter().cloned().collect::<HashSet<_>>();
        for term in unique {
            *document_frequency.entry(term).or_insert(0) += 1;
        }
        document_terms.push(terms);
    }

    let average_len = document_terms.iter().map(Vec::len).sum::<usize>().max(1) as f32
        / document_terms.len().max(1) as f32;
    let total_docs = corpus.len() as f32;

    let mut scored = corpus
        .iter()
        .cloned()
        .zip(document_terms.iter())
        .map(|(chunk, terms)| {
            let bm25 = bm25_score(
                terms,
                &query_terms,
                &document_frequency,
                total_docs,
                average_len,
            );
            let matched_terms = matched_terms(&chunk, &query_terms);
            let heading_score = heading_score(&chunk, &query_terms);
            let link_score = link_score(&chunk, &query_terms);
            let table_score = table_score(&chunk, &matched_terms);
            let code_score = code_score(&chunk, &query_terms, &matched_terms);
            let total_score = match mode {
                ContentFilterMode::None => 0.0,
                ContentFilterMode::Prune => {
                    if matched_terms.is_empty() {
                        0.0
                    } else {
                        1.0
                    }
                }
                ContentFilterMode::Bm25 => bm25,
                ContentFilterMode::Hybrid => {
                    bm25 + heading_score + link_score + table_score + code_score
                }
            };
            (
                FitChunkScoreDebug {
                    chunk_id: chunk.id.clone(),
                    total_score,
                    bm25_score: bm25,
                    heading_score,
                    link_score,
                    table_score,
                    code_score,
                    matched_terms,
                    kept: false,
                },
                chunk,
            )
        })
        .collect::<Vec<_>>();

    scored.sort_by(|left, right| {
        right
            .0
            .total_score
            .partial_cmp(&left.0.total_score)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| left.1.id.cmp(&right.1.id))
    });

    let kept_ids = scored
        .iter()
        .filter(|(debug, _)| debug.total_score > 0.0)
        .take(DEFAULT_FIT_LIMIT)
        .map(|(_, chunk)| chunk.id.clone())
        .collect::<HashSet<_>>();
    for (debug, _) in &mut scored {
        debug.kept = kept_ids.contains(&debug.chunk_id);
    }

    let mut chunks = scored
        .iter()
        .filter(|(debug, _)| debug.kept)
        .map(|(_, chunk)| chunk.clone())
        .collect::<Vec<_>>();
    chunks.sort_by_key(|chunk| chunk_index(&chunk.id));

    let markdown = chunks
        .iter()
        .map(|chunk| chunk.markdown.trim())
        .filter(|chunk| !chunk.is_empty())
        .collect::<Vec<_>>()
        .join("\n\n");
    let kept_chunk_ids = chunks
        .iter()
        .map(|chunk| chunk.id.clone())
        .collect::<Vec<_>>();
    let filtered_chunk_ids = corpus
        .iter()
        .filter(|chunk| !kept_ids.contains(&chunk.id))
        .map(|chunk| chunk.id.clone())
        .collect::<Vec<_>>();
    let mut matched_terms = scored
        .iter()
        .filter(|(debug, _)| debug.kept)
        .flat_map(|(debug, _)| debug.matched_terms.iter().cloned())
        .collect::<Vec<_>>();
    matched_terms.sort();
    matched_terms.dedup();

    FitMarkdownResult {
        markdown,
        chunks,
        filtered_out_summary: Some(FilteredOutSummary {
            total_chunks: corpus.len(),
            kept_chunks: kept_chunk_ids.len(),
            filtered_chunks: filtered_chunk_ids.len(),
            kept_chunk_ids,
            filtered_chunk_ids,
            matched_terms,
        }),
        scoring_debug: scored.into_iter().map(|(debug, _)| debug).collect(),
    }
}

fn heading_chunks(markdown: &str, overlap_chars: usize) -> Vec<ReaderChunk> {
    let page_markers = page_markers(markdown);
    let mut specs = Vec::<ChunkSpec>::new();
    let mut current = String::new();
    let mut current_path = Vec::<String>::new();
    let mut heading_stack = Vec::<String>::new();
    let mut current_start = 0usize;
    let mut char_pos = 0usize;

    for line in markdown.split_inclusive('\n') {
        let line_without_newline = line.trim_end_matches('\n');
        if let Some((level, title)) = heading(line) {
            if !current.trim().is_empty() {
                specs.push(ChunkSpec {
                    heading_path: current_path.clone(),
                    main_markdown: current.trim().to_string(),
                    overlap_markdown: String::new(),
                    source_start_char: current_start,
                    source_end_char: char_pos,
                });
                current.clear();
            }
            let depth = level.saturating_sub(1);
            heading_stack.truncate(depth);
            heading_stack.push(title);
            current_path = heading_stack.clone();
            current_start = char_pos;
        }
        current.push_str(line);
        char_pos += line_without_newline.chars().count();
        if line.ends_with('\n') {
            char_pos += 1;
        }
    }

    if !current.trim().is_empty() {
        specs.push(ChunkSpec {
            heading_path: current_path,
            main_markdown: current.trim().to_string(),
            overlap_markdown: String::new(),
            source_start_char: current_start,
            source_end_char: char_pos,
        });
    }
    apply_overlap(&mut specs, overlap_chars);
    specs_to_chunks(specs, &page_markers)
}

fn block_chunks(
    markdown: &str,
    max_chars_per_chunk: usize,
    overlap_chars: usize,
) -> Vec<ReaderChunk> {
    let page_markers = page_markers(markdown);
    let blocks = markdown_blocks(markdown);
    let mut specs = Vec::<ChunkSpec>::new();
    let mut current = Vec::<MarkdownBlock>::new();
    let mut heading_path = Vec::<String>::new();

    for block in blocks {
        if is_page_marker_block(&block.markdown) && !current.is_empty() {
            specs.push(spec_from_blocks(&heading_path, &current));
            current.clear();
        }
        if let Some((_level, title)) = heading(block.markdown.lines().next().unwrap_or_default()) {
            heading_path.push(title);
            if heading_path.len() > 5 {
                heading_path.remove(0);
            }
        }
        let next_len = blocks_char_len(&current) + block.markdown.chars().count() + 2;
        if !current.is_empty() && next_len > max_chars_per_chunk {
            specs.push(spec_from_blocks(&heading_path, &current));
            current.clear();
        }
        current.push(block);
    }

    if !current.is_empty() {
        specs.push(spec_from_blocks(&heading_path, &current));
    }
    apply_overlap(&mut specs, overlap_chars);
    specs_to_chunks(specs, &page_markers)
}

#[derive(Clone)]
struct MarkdownBlock {
    markdown: String,
    start_char: usize,
    end_char: usize,
}

struct ChunkSpec {
    heading_path: Vec<String>,
    overlap_markdown: String,
    main_markdown: String,
    source_start_char: usize,
    source_end_char: usize,
}

fn markdown_blocks(markdown: &str) -> Vec<MarkdownBlock> {
    let mut blocks = Vec::new();
    let mut current = Vec::<String>::new();
    let mut in_fence = false;
    let mut current_start = 0usize;
    let mut char_pos = 0usize;

    for line in markdown.split_inclusive('\n') {
        let line_without_newline = line.trim_end_matches('\n');
        let trimmed = line_without_newline.trim();
        if trimmed.starts_with("```") {
            in_fence = !in_fence;
            current.push(line.to_string());
            char_pos += line_without_newline.chars().count() + usize::from(line.ends_with('\n'));
            continue;
        }
        if !in_fence && trimmed.is_empty() {
            if !current.is_empty() {
                blocks.push(MarkdownBlock {
                    markdown: current.join("").trim().to_string(),
                    start_char: current_start,
                    end_char: char_pos,
                });
                current.clear();
            }
            char_pos += line_without_newline.chars().count() + usize::from(line.ends_with('\n'));
            current_start = char_pos;
            continue;
        }
        current.push(line.to_string());
        char_pos += line_without_newline.chars().count() + usize::from(line.ends_with('\n'));
    }

    if !current.is_empty() {
        blocks.push(MarkdownBlock {
            markdown: current.join("").trim().to_string(),
            start_char: current_start,
            end_char: char_pos,
        });
    }
    blocks
}

fn blocks_char_len(blocks: &[MarkdownBlock]) -> usize {
    blocks
        .iter()
        .map(|block| block.markdown.chars().count())
        .sum::<usize>()
        + blocks.len().saturating_sub(1) * 2
}

fn spec_from_blocks(heading_path: &[String], blocks: &[MarkdownBlock]) -> ChunkSpec {
    ChunkSpec {
        heading_path: heading_path.to_vec(),
        overlap_markdown: String::new(),
        main_markdown: blocks
            .iter()
            .map(|block| block.markdown.trim())
            .collect::<Vec<_>>()
            .join("\n\n"),
        source_start_char: blocks.first().map(|block| block.start_char).unwrap_or(0),
        source_end_char: blocks.last().map(|block| block.end_char).unwrap_or(0),
    }
}

fn apply_overlap(specs: &mut [ChunkSpec], overlap_chars: usize) {
    if overlap_chars == 0 {
        return;
    }
    for index in 1..specs.len() {
        let overlap = trailing_blocks(&specs[index - 1].main_markdown, overlap_chars);
        specs[index].overlap_markdown = overlap;
    }
}

fn trailing_blocks(markdown: &str, overlap_chars: usize) -> String {
    let blocks = markdown_blocks(markdown);
    let mut selected = Vec::new();
    let mut total = 0usize;
    for block in blocks.iter().rev() {
        let block_len = block.markdown.chars().count();
        if !selected.is_empty() && total + block_len > overlap_chars {
            break;
        }
        total += block_len + usize::from(!selected.is_empty()) * 2;
        selected.push(block.markdown.trim().to_string());
        if total >= overlap_chars {
            break;
        }
    }
    selected.reverse();
    selected.join("\n\n")
}

#[derive(Clone, Copy)]
struct PageMarker {
    page: u32,
    start_char: usize,
}

fn page_markers(markdown: &str) -> Vec<PageMarker> {
    let mut markers = Vec::new();
    let mut char_pos = 0usize;
    for line in markdown.split_inclusive('\n') {
        if let Some(page) = page_marker_page(line) {
            markers.push(PageMarker {
                page,
                start_char: char_pos,
            });
        }
        let line_without_newline = line.trim_end_matches('\n');
        char_pos += line_without_newline.chars().count();
        if line.ends_with('\n') {
            char_pos += 1;
        }
    }
    markers
}

fn page_marker_page(line: &str) -> Option<u32> {
    let trimmed = line.trim();
    let inner = trimmed.strip_prefix("<!--")?.strip_suffix("-->")?.trim();
    inner.strip_prefix("page:")?.trim().parse().ok()
}

fn is_page_marker_block(markdown: &str) -> bool {
    markdown.lines().all(|line| {
        let trimmed = line.trim();
        trimmed.is_empty() || page_marker_page(trimmed).is_some()
    })
}

fn page_range_for_source(
    start: usize,
    end: usize,
    markers: &[PageMarker],
) -> (Option<u32>, Option<u32>) {
    if start >= end || markers.is_empty() {
        return (None, None);
    }
    let start_page = markers
        .iter()
        .rev()
        .find(|marker| marker.start_char <= start)
        .or_else(|| markers.iter().find(|marker| marker.start_char < end))
        .map(|marker| marker.page);
    let end_page = markers
        .iter()
        .rev()
        .find(|marker| marker.start_char < end)
        .map(|marker| marker.page)
        .or(start_page);
    (start_page, end_page)
}

fn specs_to_chunks(specs: Vec<ChunkSpec>, page_markers: &[PageMarker]) -> Vec<ReaderChunk> {
    specs
        .into_iter()
        .enumerate()
        .map(|(index, spec)| {
            let markdown = if spec.overlap_markdown.trim().is_empty() {
                spec.main_markdown
            } else {
                format!(
                    "{}\n\n{}",
                    spec.overlap_markdown.trim(),
                    spec.main_markdown.trim()
                )
            };
            let (page_start, page_end) =
                page_range_for_source(spec.source_start_char, spec.source_end_char, page_markers);
            make_chunk_with_pages(
                index,
                &spec.heading_path,
                &markdown,
                Some(spec.source_start_char),
                Some(spec.source_end_char),
                page_start,
                page_end,
            )
        })
        .collect()
}

#[cfg(test)]
fn make_chunk(
    index: usize,
    heading_path: &[String],
    markdown: &str,
    source_start_char: Option<usize>,
    source_end_char: Option<usize>,
) -> ReaderChunk {
    make_chunk_with_pages(
        index,
        heading_path,
        markdown,
        source_start_char,
        source_end_char,
        None,
        None,
    )
}

fn make_chunk_with_pages(
    index: usize,
    heading_path: &[String],
    markdown: &str,
    source_start_char: Option<usize>,
    source_end_char: Option<usize>,
    page_start: Option<u32>,
    page_end: Option<u32>,
) -> ReaderChunk {
    let markdown = markdown.trim().to_string();
    let plain_text = plain_text(&markdown);
    ReaderChunk {
        id: format!("chunk-{}", index + 1),
        heading_path: heading_path.to_vec(),
        source_start_char,
        source_end_char,
        page_start,
        page_end,
        token_estimate: budget::estimate_tokens(&markdown),
        markdown,
        plain_text,
        links: Vec::new(),
        images: Vec::new(),
    }
}

fn heading(line: &str) -> Option<(usize, String)> {
    let trimmed = line.trim_start();
    let hashes = trimmed.chars().take_while(|ch| *ch == '#').count();
    if !(1..=5).contains(&hashes) {
        return None;
    }
    let rest = trimmed.get(hashes..)?;
    if !rest.starts_with(' ') {
        return None;
    }
    let title = rest.trim().to_string();
    (!title.is_empty()).then_some((hashes, title))
}

fn plain_text(markdown: &str) -> String {
    markdown
        .lines()
        .filter(|line| !line.trim_start().starts_with("```"))
        .filter(|line| page_marker_page(line).is_none())
        .map(|line| {
            line.trim()
                .trim_start_matches('#')
                .trim_start_matches('>')
                .trim()
                .replace("**", "")
                .replace("~~", "")
                .replace('`', "")
        })
        .filter(|line| !line.trim().is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

fn tokenize(text: &str) -> Vec<String> {
    text.split(|ch: char| !ch.is_alphanumeric())
        .map(str::trim)
        .filter(|term| term.len() > 1)
        .map(str::to_ascii_lowercase)
        .collect()
}

fn matched_terms(chunk: &ReaderChunk, query_terms: &[String]) -> Vec<String> {
    let mut haystacks = vec![chunk.plain_text.clone(), chunk.heading_path.join(" ")];
    haystacks.extend(chunk.links.iter().flat_map(|link| {
        [
            link.text.clone().unwrap_or_default(),
            link.title.clone().unwrap_or_default(),
            link.url.clone(),
        ]
    }));
    let haystack_terms = haystacks
        .iter()
        .flat_map(|value| tokenize(value))
        .collect::<HashSet<_>>();
    let mut matched = query_terms
        .iter()
        .filter(|term| haystack_terms.contains(*term))
        .cloned()
        .collect::<Vec<_>>();
    matched.sort();
    matched.dedup();
    matched
}

fn heading_score(chunk: &ReaderChunk, query_terms: &[String]) -> f32 {
    let terms = tokenize(&chunk.heading_path.join(" "));
    overlap_count(&terms, query_terms) as f32 * 2.0
}

fn link_score(chunk: &ReaderChunk, query_terms: &[String]) -> f32 {
    let terms = chunk
        .links
        .iter()
        .flat_map(|link| {
            tokenize(&format!(
                "{} {} {}",
                link.text.as_deref().unwrap_or(""),
                link.title.as_deref().unwrap_or(""),
                link.url
            ))
        })
        .collect::<Vec<_>>();
    overlap_count(&terms, query_terms) as f32 * 1.5
}

fn table_score(chunk: &ReaderChunk, matched_terms: &[String]) -> f32 {
    if matched_terms.is_empty() || !looks_like_table(&chunk.markdown) {
        return 0.0;
    }
    0.5
}

fn code_score(chunk: &ReaderChunk, query_terms: &[String], matched_terms: &[String]) -> f32 {
    if !chunk.markdown.contains("```") {
        return 0.0;
    }
    let language_terms = chunk
        .markdown
        .lines()
        .filter_map(|line| line.trim().strip_prefix("```"))
        .filter(|language| !language.is_empty())
        .flat_map(tokenize)
        .collect::<Vec<_>>();
    if !matched_terms.is_empty() || overlap_count(&language_terms, query_terms) > 0 {
        return 0.5;
    }
    0.0
}

fn overlap_count(terms: &[String], query_terms: &[String]) -> usize {
    let terms = terms.iter().collect::<HashSet<_>>();
    query_terms
        .iter()
        .filter(|query| terms.contains(query))
        .count()
}

fn looks_like_table(markdown: &str) -> bool {
    markdown
        .lines()
        .any(|line| line.trim_start().starts_with('|') && line.contains('|'))
        && markdown.lines().any(|line| line.contains("---"))
}

fn bm25_score(
    terms: &[String],
    query_terms: &[String],
    document_frequency: &HashMap<String, usize>,
    total_docs: f32,
    average_len: f32,
) -> f32 {
    if terms.is_empty() {
        return 0.0;
    }
    let mut term_frequency: HashMap<&str, usize> = HashMap::new();
    for term in terms {
        *term_frequency.entry(term).or_insert(0) += 1;
    }

    let k1 = 1.2;
    let b = 0.75;
    let document_len = terms.len() as f32;
    let mut score = 0.0;
    for query in query_terms {
        let frequency = *term_frequency.get(query.as_str()).unwrap_or(&0) as f32;
        if frequency == 0.0 {
            continue;
        }
        let df = *document_frequency.get(query).unwrap_or(&0) as f32;
        let idf = ((total_docs - df + 0.5) / (df + 0.5) + 1.0).ln().max(0.0);
        let denominator = frequency + k1 * (1.0 - b + b * document_len / average_len.max(1.0));
        score += idf * (frequency * (k1 + 1.0)) / denominator;
    }
    score
}

fn chunk_index(id: &str) -> usize {
    id.strip_prefix("chunk-")
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(usize::MAX)
}

#[cfg(test)]
#[allow(clippy::expect_used, clippy::unwrap_used)]
mod tests {
    use super::*;

    #[test]
    fn heading_chunks_keep_heading_paths() {
        let chunks = heading_chunks("# A\nalpha\n\n## B\nbeta\n\n# C\ngamma", 0);
        assert_eq!(chunks.len(), 3);
        assert_eq!(chunks[0].id, "chunk-1");
        assert_eq!(chunks[1].heading_path, vec!["A", "B"]);
        assert_eq!(chunks[2].heading_path, vec!["C"]);
    }

    #[test]
    fn block_chunks_keep_code_block_together() {
        let chunks = block_chunks("intro\n\n```rust\nfn main() {}\n```\n\noutro", 12, 0);
        assert!(chunks.iter().any(|chunk| {
            chunk.markdown.contains("```rust") && chunk.markdown.contains("fn main()")
        }));
    }

    #[test]
    fn heading_chunks_include_source_ranges() {
        let markdown = "# A\nalpha\n\n## B\nbeta";
        let chunks = heading_chunks(markdown, 0);
        assert_eq!(chunks[0].source_start_char, Some(0));
        assert_eq!(
            chunks[0].source_end_char,
            Some("# A\nalpha\n\n".chars().count())
        );
        assert_eq!(
            chunks[1].source_start_char,
            Some("# A\nalpha\n\n".chars().count())
        );
    }

    #[test]
    fn block_overlap_copies_complete_previous_block() {
        let chunks = block_chunks(
            "first paragraph words\n\nsecond paragraph words\n\nthird paragraph words",
            28,
            12,
        );
        assert!(chunks.len() >= 2);
        assert!(chunks[1].markdown.starts_with("first paragraph words"));
        assert!(chunks[1].markdown.contains("second paragraph words"));
    }

    #[test]
    fn block_overlap_does_not_split_code_block() {
        let chunks = block_chunks(
            "intro\n\n```rust\nfn main() {}\n```\n\noutro paragraph",
            24,
            8,
        );
        let chunk_with_overlap = chunks
            .iter()
            .find(|chunk| chunk.markdown.contains("outro paragraph"))
            .expect("outro chunk");
        assert!(
            chunk_with_overlap
                .markdown
                .contains("```rust\nfn main() {}\n```")
                || !chunk_with_overlap.markdown.contains("fn main()")
        );
    }

    #[test]
    fn block_source_range_excludes_overlap() {
        let markdown = "first paragraph words\n\nsecond paragraph words\n\nthird paragraph words";
        let chunks = block_chunks(markdown, 28, 12);
        let second = &chunks[1];
        assert!(second.markdown.starts_with("first paragraph words"));
        let expected_start = markdown.find("second paragraph words").unwrap();
        assert_eq!(second.source_start_char, Some(expected_start));
    }

    #[test]
    fn chunks_without_page_markers_have_no_page_range() {
        let chunks = block_chunks("# Article\n\nplain markdown", 100, 0);
        assert_eq!(chunks.len(), 1);
        assert_eq!(chunks[0].page_start, None);
        assert_eq!(chunks[0].page_end, None);
    }

    #[test]
    fn block_chunks_infer_pdf_page_ranges() {
        let markdown = "# PDF Document\n\n<!-- page: 1 -->\n\nalpha page body\n\n<!-- page: 2 -->\n\nbeta page body";
        let chunks = block_chunks(markdown, 42, 0);
        assert!(chunks.iter().any(|chunk| {
            chunk.page_start == Some(1)
                && chunk.page_end == Some(1)
                && chunk.markdown.contains("alpha")
        }));
        assert!(chunks.iter().any(|chunk| {
            chunk.page_start == Some(2)
                && chunk.page_end == Some(2)
                && chunk.markdown.contains("beta")
        }));
        assert!(
            chunks
                .iter()
                .all(|chunk| !chunk.plain_text.contains("<!-- page:"))
        );
    }

    #[test]
    fn block_chunker_starts_new_chunk_at_pdf_page_marker() {
        let markdown = "# PDF Document\n\n<!-- page: 1 -->\n\nalpha page body\n\n<!-- page: 2 -->\n\nbeta page body";
        let chunks = block_chunks(markdown, 1_000, 0);
        assert!(chunks.len() >= 3);
        let alpha = chunks
            .iter()
            .find(|chunk| chunk.markdown.contains("alpha page body"))
            .expect("alpha chunk");
        let beta = chunks
            .iter()
            .find(|chunk| chunk.markdown.contains("beta page body"))
            .expect("beta chunk");
        assert_eq!(alpha.page_start, Some(1));
        assert_eq!(alpha.page_end, Some(1));
        assert_eq!(beta.page_start, Some(2));
        assert_eq!(beta.page_end, Some(2));
    }

    #[test]
    fn heading_chunk_crossing_pdf_pages_has_page_range() {
        let markdown = "# PDF Document\n\n<!-- page: 1 -->\n\nalpha page body\n\n<!-- page: 2 -->\n\nbeta page body";
        let chunks = heading_chunks(markdown, 0);
        assert_eq!(chunks.len(), 1);
        assert_eq!(chunks[0].page_start, Some(1));
        assert_eq!(chunks[0].page_end, Some(2));
    }

    #[test]
    fn bm25_fit_prefers_query_chunk() {
        let chunks = block_chunks(
            "apples and oranges\n\nrust ownership borrowing lifetimes\n\nbananas",
            24,
            0,
        );
        let fit = fit_markdown("", &chunks, Some("rust ownership"), ContentFilterMode::Bm25);
        assert!(fit.markdown.contains("rust ownership"));
        assert_eq!(fit.chunks.len(), 1);
        assert_eq!(
            fit.filtered_out_summary
                .as_ref()
                .expect("summary")
                .kept_chunks,
            1
        );
        assert_eq!(fit.scoring_debug.len(), 3);
    }

    #[test]
    fn empty_query_returns_empty_fit() {
        let chunks = block_chunks("alpha\n\nbeta", 100, 0);
        let fit = fit_markdown("", &chunks, Some(" "), ContentFilterMode::Bm25);
        assert!(fit.markdown.is_empty());
        assert!(fit.chunks.is_empty());
        assert!(fit.filtered_out_summary.is_none());
        assert!(fit.scoring_debug.is_empty());
    }

    #[test]
    fn prune_keeps_direct_query_matches() {
        let chunks = block_chunks("alpha guide\n\nrust ownership notes\n\nbeta", 16, 0);
        let fit = fit_markdown("", &chunks, Some("ownership"), ContentFilterMode::Prune);
        assert_eq!(fit.chunks.len(), 1);
        assert!(fit.markdown.contains("rust ownership"));
        assert!(!fit.markdown.contains("alpha guide"));
    }

    #[test]
    fn hybrid_scores_heading_link_table_and_code_signals() {
        let mut chunks = vec![
            make_chunk(0, &["Rust".to_string()], "# Rust\nintro", Some(0), Some(12)),
            make_chunk(
                1,
                &[],
                "[ownership guide](https://example.test/ownership)",
                Some(13),
                Some(60),
            ),
            make_chunk(
                2,
                &[],
                "| topic |\n| --- |\n| ownership |",
                Some(61),
                Some(94),
            ),
            make_chunk(
                3,
                &[],
                "```rust\nfn ownership() {}\n```",
                Some(95),
                Some(124),
            ),
        ];
        chunks[1].links.push(crate::types::ReaderLink {
            url: "https://example.test/ownership".to_string(),
            text: Some("ownership guide".to_string()),
            title: None,
            rel: None,
            section: None,
            dom_path: None,
            source_offset: None,
        });
        let fit = fit_markdown(
            "",
            &chunks,
            Some("rust ownership"),
            ContentFilterMode::Hybrid,
        );
        assert!(!fit.chunks.is_empty());
        let heading = fit
            .scoring_debug
            .iter()
            .find(|debug| debug.chunk_id == "chunk-1")
            .expect("heading debug");
        assert!(heading.heading_score > 0.0);
        let link = fit
            .scoring_debug
            .iter()
            .find(|debug| debug.chunk_id == "chunk-2")
            .expect("link debug");
        assert!(link.link_score > 0.0);
        let table = fit
            .scoring_debug
            .iter()
            .find(|debug| debug.chunk_id == "chunk-3")
            .expect("table debug");
        assert!(table.table_score > 0.0);
        let code = fit
            .scoring_debug
            .iter()
            .find(|debug| debug.chunk_id == "chunk-4")
            .expect("code debug");
        assert!(code.code_score > 0.0);
    }
}
