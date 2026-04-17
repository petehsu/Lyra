use crate::types::{CodeSearchTextMatch, IndexedFile};
use globset::{GlobBuilder, GlobSet, GlobSetBuilder};

const MAX_EXCERPT_CHARS: usize = 240;

pub fn search_text(
    files: &[IndexedFile],
    query: &str,
    case_sensitive: bool,
    glob: Option<&str>,
    limit: usize,
) -> (Vec<CodeSearchTextMatch>, bool) {
    let normalized_query = if case_sensitive {
        query.trim().to_string()
    } else {
        query.trim().to_lowercase()
    };
    if normalized_query.is_empty() {
        return (Vec::new(), false);
    }

    let glob_matcher = glob.and_then(|value| build_glob(value).ok());
    let mut matches = Vec::<CodeSearchTextMatch>::new();
    let mut truncated = false;

    for file in files {
        if matches.len() >= limit {
            truncated = true;
            break;
        }
        if let Some(matcher) = glob_matcher.as_ref() {
            if matcher.is_match(&file.relative_path) == false
                && matcher.is_match(&file.file_name) == false
            {
                continue;
            }
        }

        for (line_index, line) in file.content.lines().enumerate() {
            if matches.len() >= limit {
                truncated = true;
                break;
            }
            let haystack = if case_sensitive {
                line.to_string()
            } else {
                line.to_lowercase()
            };
            if haystack.contains(&normalized_query) == false {
                continue;
            }
            matches.push(CodeSearchTextMatch {
                path: file.path.clone(),
                relative_path: file.relative_path.clone(),
                line: line_index as u32 + 1,
                excerpt: excerpt_for_line(line),
            });
        }
    }

    (matches, truncated)
}

fn build_glob(pattern: &str) -> Result<GlobSet, String> {
    let mut builder = GlobSetBuilder::new();
    let glob = GlobBuilder::new(pattern)
        .literal_separator(false)
        .build()
        .map_err(|error| format!("invalid glob pattern: {error}"))?;
    builder.add(glob);
    builder
        .build()
        .map_err(|error| format!("failed to build glob matcher: {error}"))
}

fn excerpt_for_line(line: &str) -> String {
    let trimmed = line.trim();
    if trimmed.len() <= MAX_EXCERPT_CHARS {
        return trimmed.to_string();
    }
    format!("{}…", &trimmed[..MAX_EXCERPT_CHARS])
}
