//! In-process grep used when the external `rg` binary is unavailable.
//! Mirrors the `rg --line-number --no-heading --color=never` output format.

use super::*;

pub(super) fn fallback_file_grep(
    absolute_root: &Path,
    relative_root: &str,
    pattern: &str,
    glob: Option<&str>,
    case_insensitive: bool,
    max_results: usize,
) -> NativeToolResult {
    let expression = if case_insensitive {
        format!("(?i){pattern}")
    } else {
        pattern.to_string()
    };
    let matcher = match regex::Regex::new(&expression) {
        Ok(matcher) => matcher,
        Err(error) => {
            return Err(NativeToolFailure::new(
                "grep_failed",
                format!("invalid pattern: {error}"),
                "Check the regex pattern and try again.",
            ));
        }
    };
    let glob_matcher = glob.map(|raw| glob::Pattern::new(raw).ok());
    let mut files = Vec::new();
    if let Err(error) = collect_workspace_files(absolute_root, absolute_root, true, 5_000, &mut files) {
        return Err(error);
    }
    let mut display: Vec<String> = Vec::new();
    let mut truncated = false;
    for file in files {
        if display.len() >= max_results {
            truncated = true;
            break;
        }
        let relative = file
            .strip_prefix(absolute_root)
            .unwrap_or(&file)
            .to_string_lossy()
            .replace('\\', "/");
        if let Some(Some(pattern)) = glob_matcher.as_ref() {
            if !pattern.matches(&relative) {
                continue;
            }
        }
        let Ok(content) = fs::read_to_string(&file) else {
            continue;
        };
        for (index, line) in content.lines().enumerate() {
            if matcher.is_match(line) {
                if display.len() >= max_results {
                    truncated = true;
                    break;
                }
                display.push(format!("{relative}:{}:{}", index + 1, line));
            }
        }
    }
    if truncated || display.len() > max_results {
        display.truncate(max_results);
    }
    Ok(NativeToolSuccess {
        content: if display.is_empty() {
            "No matches found.".to_string()
        } else {
            display.join("\n")
        },
        raw: json!({
            "pattern": pattern,
            "path": relative_root,
            "matches": display.len(),
            "truncated": truncated,
            "engine": "internal",
        }),
        recommended_next_action: truncated
            .then_some("Narrow the pattern or path to reduce results.".to_string()),
    })
}