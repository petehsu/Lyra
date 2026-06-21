use crate::types::{CodeSearchTextMatch, IndexedFile};
use globset::{GlobBuilder, GlobSet, GlobSetBuilder};
use grep_regex::{RegexMatcher, RegexMatcherBuilder};
use grep_searcher::{Searcher, SearcherBuilder, Sink, SinkMatch};

const MAX_EXCERPT_CHARS: usize = 240;

pub fn search_text(
    files: &[IndexedFile],
    query: &str,
    case_sensitive: bool,
    regex: bool,
    glob: Option<&str>,
    limit: usize,
) -> (Vec<CodeSearchTextMatch>, bool) {
    let trimmed_query = query.trim();
    if trimmed_query.is_empty() {
        return (Vec::new(), false);
    }

    let pattern = if regex {
        trimmed_query.to_string()
    } else {
        regex::escape(trimmed_query)
    };
    let Ok(matcher) = RegexMatcherBuilder::new()
        .case_insensitive(!case_sensitive)
        .line_terminator(Some(b'\n'))
        .build(&pattern)
    else {
        // Invalid user-supplied regex: no matches rather than a hard error so
        // the index stays usable. The literal path never reaches here.
        return (Vec::new(), false);
    };
    let mut searcher = SearcherBuilder::new().line_number(true).build();

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

        let mut sink = CollectSink {
            path: &file.path,
            relative_path: &file.relative_path,
            out: &mut matches,
            limit,
            truncated: false,
        };
        // Files removed since indexing surface as IO errors; skip rather than
        // abort the whole query.
        let _ = searcher.search_path(&matcher, &file.path, &mut sink);
        if sink.truncated {
            truncated = true;
            break;
        }
    }

    (matches, truncated)
}

struct CollectSink<'a> {
    path: &'a str,
    relative_path: &'a str,
    out: &'a mut Vec<CodeSearchTextMatch>,
    limit: usize,
    truncated: bool,
}

impl Sink for CollectSink<'_> {
    type Error = std::io::Error;

    fn matched(
        &mut self,
        _searcher: &Searcher,
        sink_match: &SinkMatch<'_>,
    ) -> Result<bool, std::io::Error> {
        let line = sink_match.line_number().unwrap_or(0) as u32;
        let text = String::from_utf8_lossy(sink_match.bytes());
        self.out.push(CodeSearchTextMatch {
            path: self.path.to_string(),
            relative_path: self.relative_path.to_string(),
            line,
            excerpt: excerpt_for_line(text.trim_end()),
        });
        if self.out.len() >= self.limit {
            self.truncated = true;
            return Ok(false);
        }
        Ok(true)
    }
}

/// Build a case-insensitive-aware matcher for a single literal needle, used by
/// the reference search in graph_engine.
pub fn build_word_matcher(symbol_name: &str) -> Option<RegexMatcher> {
    let pattern = format!(r"\b{}\b", regex::escape(symbol_name));
    RegexMatcherBuilder::new()
        .case_insensitive(false)
        .line_terminator(Some(b'\n'))
        .build(&pattern)
        .ok()
}

pub fn line_searcher() -> Searcher {
    SearcherBuilder::new().line_number(true).build()
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::Path;
    use tempfile::TempDir;

    fn write_file(dir: &Path, name: &str, contents: &str) -> IndexedFile {
        let path = dir.join(name);
        fs::write(&path, contents).unwrap();
        IndexedFile {
            path: path.to_string_lossy().to_string(),
            relative_path: name.to_string(),
            file_name: name.to_string(),
            extension: Path::new(name)
                .extension()
                .map(|e| e.to_string_lossy().to_string()),
            modified_at: 0,
            size_bytes: contents.len() as u64,
            symbols: Vec::new(),
        }
    }

    #[test]
    fn literal_match_is_case_insensitive_by_default() {
        let dir = TempDir::new().unwrap();
        let files = vec![write_file(
            dir.path(),
            "a.rs",
            "let Foo = 1;\nlet bar = 2;\n",
        )];
        let (matches, truncated) = search_text(&files, "foo", false, false, None, 40);
        assert_eq!(matches.len(), 1);
        assert_eq!(matches[0].line, 1);
        assert_eq!(matches[0].excerpt, "let Foo = 1;");
        assert!(!truncated);
    }

    #[test]
    fn case_sensitive_excludes_mismatched_case() {
        let dir = TempDir::new().unwrap();
        let files = vec![write_file(dir.path(), "a.rs", "let Foo = 1;\n")];
        let (matches, _) = search_text(&files, "foo", true, false, None, 40);
        assert!(matches.is_empty());
    }

    #[test]
    fn literal_does_not_interpret_regex_metacharacters() {
        let dir = TempDir::new().unwrap();
        let files = vec![write_file(
            dir.path(),
            "a.rs",
            "value.method()\nvaluexmethod\n",
        )];
        let (matches, _) = search_text(&files, "value.method", false, false, None, 40);
        assert_eq!(matches.len(), 1);
        assert_eq!(matches[0].line, 1);
    }

    #[test]
    fn regex_mode_matches_pattern() {
        let dir = TempDir::new().unwrap();
        let files = vec![write_file(dir.path(), "a.rs", "fn one() {}\nfn two() {}\n")];
        let (matches, _) = search_text(&files, r"fn \w+\(", false, true, None, 40);
        assert_eq!(matches.len(), 2);
    }

    #[test]
    fn glob_restricts_files() {
        let dir = TempDir::new().unwrap();
        let files = vec![
            write_file(dir.path(), "a.rs", "needle here\n"),
            write_file(dir.path(), "b.txt", "needle here\n"),
        ];
        let (matches, _) = search_text(&files, "needle", false, false, Some("*.rs"), 40);
        assert_eq!(matches.len(), 1);
        assert_eq!(matches[0].relative_path, "a.rs");
    }

    #[test]
    fn limit_truncates() {
        let dir = TempDir::new().unwrap();
        let files = vec![write_file(dir.path(), "a.rs", "x\nx\nx\nx\n")];
        let (matches, truncated) = search_text(&files, "x", false, false, None, 2);
        assert_eq!(matches.len(), 2);
        assert!(truncated);
    }

    #[test]
    fn missing_file_is_skipped() {
        let dir = TempDir::new().unwrap();
        let mut file = write_file(dir.path(), "gone.rs", "needle\n");
        fs::remove_file(&file.path).unwrap();
        file.size_bytes = 7;
        let files = vec![file];
        let (matches, _) = search_text(&files, "needle", false, false, None, 40);
        assert!(matches.is_empty());
    }
}
