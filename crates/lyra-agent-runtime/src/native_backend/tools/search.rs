use super::*;
use glob::Pattern;
use regex::RegexBuilder;

const GREP_MAX_FILE_BYTES: usize = 2 * 1024 * 1024;

pub(crate) fn execute_code_tool_adapter(
    session_id: &str,
    turn_id: &str,
    cancellation: &Arc<AtomicBool>,
    tool_call_id: &str,
    tool_name: &str,
    display_name: &str,
    action: &str,
    arguments: Value,
    started_at: &str,
) -> Value {
    execute_native_tool_adapter(
        session_id,
        turn_id,
        cancellation,
        tool_call_id,
        tool_name,
        display_name,
        action,
        arguments,
        started_at,
    )
}

pub(crate) fn tool_code_grep_text(session_id: &str, input: &Value) -> NativeToolResult {
    let query = value_string(input, "query")
        .or_else(|| value_string(input, "pattern"))
        .ok_or_else(|| {
            NativeToolFailure::new(
                "bad_request",
                "query is required",
                "Retry with an exact string or regex pattern.",
            )
        })?;
    let glob = value_string(input, "glob");
    let mut include_globs = value_globs(input, "includeGlobs")?;
    if let Some(glob) = &glob {
        include_globs.push(glob.clone());
    }
    validate_globs(&include_globs)?;
    let exclude_globs = value_globs(input, "excludeGlobs")?;
    let roots = resolve_search_roots(session_id, input)?;
    let include_hidden = value_bool(input, "includeHidden", false);
    let case_sensitive = value_bool(input, "caseSensitive", false);
    let regex_enabled = value_bool(input, "regex", false);
    let limit = value_usize(input, "limit", DEFAULT_SEARCH_LIMIT, 500);
    let max_file_bytes = value_usize(
        input,
        "maxFileBytes",
        GREP_MAX_FILE_BYTES,
        GREP_MAX_FILE_BYTES,
    );
    let matcher = GrepMatcher::new(&query, regex_enabled, case_sensitive)?;
    let results = grep_workspace_text(GrepWorkspaceOptions {
        workspace_root: &roots.workspace_root,
        roots: roots.absolute_roots.clone(),
        include_globs,
        exclude_globs,
        include_hidden,
        regex_enabled,
        limit,
        max_file_bytes,
        matcher,
    })?;
    Ok(NativeToolSuccess {
        content: format_search_results(&results),
        raw: json!({
            "query": query,
            "roots": roots.relative_roots,
            "glob": glob,
            "regex": regex_enabled,
            "caseSensitive": case_sensitive,
            "results": results,
            "truncated": results.len() >= limit,
        }),
        recommended_next_action: None,
    })
}

struct GrepWorkspaceOptions<'a> {
    workspace_root: &'a Path,
    roots: Vec<PathBuf>,
    include_globs: Vec<String>,
    exclude_globs: Vec<String>,
    include_hidden: bool,
    regex_enabled: bool,
    limit: usize,
    max_file_bytes: usize,
    matcher: GrepMatcher,
}

enum GrepMatcher {
    Literal {
        needle: String,
        case_sensitive: bool,
    },
    Regex(regex::Regex),
}

impl GrepMatcher {
    fn new(
        query: &str,
        regex_enabled: bool,
        case_sensitive: bool,
    ) -> Result<Self, NativeToolFailure> {
        if regex_enabled {
            let regex = RegexBuilder::new(query)
                .case_insensitive(!case_sensitive)
                .build()
                .map_err(|error| {
                    NativeToolFailure::new(
                        "bad_regex",
                        format!("invalid regex pattern: {error}"),
                        "Retry with a valid Rust regex pattern or set regex=false for literal text.",
                    )
                })?;
            Ok(Self::Regex(regex))
        } else {
            Ok(Self::Literal {
                needle: if case_sensitive {
                    query.to_string()
                } else {
                    query.to_lowercase()
                },
                case_sensitive,
            })
        }
    }

    fn find(&self, line: &str) -> Option<(usize, usize)> {
        match self {
            Self::Literal {
                needle,
                case_sensitive,
            } => match_range(line, needle, *case_sensitive),
            Self::Regex(regex) => regex.find(line).map(|match_| {
                let start = line[..match_.start()].chars().count();
                let end = line[..match_.end()].chars().count();
                (start, end)
            }),
        }
    }
}

fn grep_workspace_text(options: GrepWorkspaceOptions<'_>) -> Result<Vec<Value>, NativeToolFailure> {
    validate_globs(&options.include_globs)?;
    validate_globs(&options.exclude_globs)?;
    let include_globs = options
        .include_globs
        .iter()
        .filter_map(|pattern| {
            Pattern::new(pattern)
                .ok()
                .map(|compiled| (pattern.clone(), compiled))
        })
        .collect::<Vec<_>>();
    let exclude_globs = options
        .exclude_globs
        .iter()
        .filter_map(|pattern| {
            Pattern::new(pattern)
                .ok()
                .map(|compiled| (pattern.clone(), compiled))
        })
        .collect::<Vec<_>>();
    let mut results = Vec::new();
    let mut seen = HashSet::new();
    for root in options.roots {
        let mut files = Vec::new();
        collect_workspace_files(
            options.workspace_root,
            &root,
            options.include_hidden,
            100_000,
            &mut files,
        )?;
        for path in files {
            if results.len() >= options.limit {
                return Ok(results);
            }
            let relative = path
                .strip_prefix(options.workspace_root)
                .map(|path| path.to_string_lossy().replace('\\', "/"))
                .unwrap_or_else(|_| path.display().to_string());
            let file_name = path
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or("");
            if !seen.insert(relative.clone()) {
                continue;
            }
            if !include_globs.is_empty()
                && !include_globs
                    .iter()
                    .any(|(pattern, glob)| path_matches_glob(pattern, glob, &relative, file_name))
            {
                continue;
            }
            if exclude_globs
                .iter()
                .any(|(pattern, glob)| path_matches_glob(pattern, glob, &relative, file_name))
            {
                continue;
            }
            if !looks_like_source_file(&path) {
                continue;
            }
            let metadata = match fs::metadata(&path) {
                Ok(metadata) => metadata,
                Err(_) => continue,
            };
            if !metadata.is_file() || metadata.len() as usize > options.max_file_bytes {
                continue;
            }
            let bytes = match fs::read(&path) {
                Ok(bytes) => bytes,
                Err(_) => continue,
            };
            if bytes.contains(&0) {
                continue;
            }
            let text = String::from_utf8_lossy(&bytes);
            for (index, line) in text.lines().enumerate() {
                if results.len() >= options.limit {
                    return Ok(results);
                }
                let Some((start_char, end_char)) = options.matcher.find(line) else {
                    continue;
                };
                results.push(json!({
                    "path": relative.clone(),
                    "line": index as u64 + 1,
                    "matchKind": if options.regex_enabled { "regex" } else { "grep" },
                    "snippet": line.trim(),
                    "matchRanges": [{
                        "line": index as u64 + 1,
                        "startChar": start_char,
                        "endChar": end_char,
                    }],
                }));
            }
        }
    }
    Ok(results)
}

fn path_matches_glob(pattern: &str, glob: &Pattern, relative: &str, file_name: &str) -> bool {
    glob.matches(relative) || (!pattern.contains('/') && glob.matches(file_name))
}

struct ResolvedSearchRoots {
    workspace_root: PathBuf,
    absolute_roots: Vec<PathBuf>,
    relative_roots: Vec<String>,
}

fn resolve_search_roots(
    session_id: &str,
    input: &Value,
) -> Result<ResolvedSearchRoots, NativeToolFailure> {
    let raw_roots = value_string_array(input, "roots").unwrap_or_else(|| {
        value_string(input, "root")
            .or_else(|| value_string(input, "path"))
            .map(|root| vec![root])
            .unwrap_or_else(|| vec![".".to_string()])
    });
    let mut absolute_roots = Vec::new();
    let mut relative_roots = Vec::new();
    let mut workspace_root = None::<PathBuf>;
    let mut seen = HashSet::new();
    for raw_root in raw_roots {
        let workspace_path = resolve_workspace_path(session_id, &raw_root, false)?;
        let key = workspace_path.absolute.to_string_lossy().replace('\\', "/");
        if !seen.insert(key) {
            continue;
        }
        workspace_root.get_or_insert_with(|| workspace_path.root.clone());
        absolute_roots.push(workspace_path.absolute);
        relative_roots.push(workspace_path.relative);
    }
    let workspace_root = workspace_root.ok_or_else(|| {
        NativeToolFailure::new(
            "bad_request",
            "at least one search root is required",
            "Retry with root or roots inside the workspace.",
        )
    })?;
    Ok(ResolvedSearchRoots {
        workspace_root,
        absolute_roots,
        relative_roots,
    })
}

fn value_string_array(input: &Value, key: &str) -> Option<Vec<String>> {
    let value = input.get(key)?;
    if let Some(value) = value.as_str() {
        let value = value.trim();
        return (!value.is_empty()).then(|| vec![value.to_string()]);
    }
    let values = value
        .as_array()?
        .iter()
        .filter_map(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .collect::<Vec<_>>();
    (!values.is_empty()).then_some(values)
}

fn value_globs(input: &Value, key: &str) -> Result<Vec<String>, NativeToolFailure> {
    let globs = value_string_array(input, key).unwrap_or_default();
    validate_globs(&globs)?;
    Ok(globs)
}

fn validate_globs(globs: &[String]) -> Result<(), NativeToolFailure> {
    for glob in globs {
        Pattern::new(glob).map_err(|error| {
            NativeToolFailure::new(
                "bad_glob",
                format!("invalid glob pattern `{glob}`: {error}"),
                "Retry with a valid source glob such as **/*.rs.",
            )
        })?;
    }
    Ok(())
}

fn match_range(haystack: &str, needle: &str, case_sensitive: bool) -> Option<(usize, usize)> {
    if needle.is_empty() {
        return None;
    }
    let haystack_cmp = if case_sensitive {
        haystack.to_string()
    } else {
        haystack.to_lowercase()
    };
    let needle_cmp = if case_sensitive {
        needle.to_string()
    } else {
        needle.to_lowercase()
    };
    let byte_start = haystack_cmp.find(&needle_cmp)?;
    let byte_end = byte_start + needle_cmp.len();
    let start_char = haystack[..byte_start].chars().count();
    let end_char = haystack[..byte_end].chars().count();
    Some((start_char, end_char))
}

pub(crate) fn looks_like_source_file(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|value| value.to_str())
            .unwrap_or(""),
        "rs" | "ts"
            | "tsx"
            | "js"
            | "jsx"
            | "mjs"
            | "cjs"
            | "py"
            | "go"
            | "java"
            | "kt"
            | "swift"
            | "cpp"
            | "c"
            | "h"
            | "hpp"
            | "cs"
            | "rb"
            | "php"
            | "scala"
            | "toml"
            | "json"
            | "md"
            | "yml"
            | "yaml"
    )
}

pub(crate) fn format_search_results(results: &[Value]) -> String {
    if results.is_empty() {
        return "No matches.".to_string();
    }
    results
        .iter()
        .map(|result| {
            let path = result.get("path").and_then(Value::as_str).unwrap_or("-");
            let line = result.get("line").and_then(Value::as_u64);
            let snippet = result.get("snippet").and_then(Value::as_str).unwrap_or("");
            match line {
                Some(line) => format!("{path}:{line}: {snippet}"),
                None => format!("{path}: {snippet}"),
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

pub(crate) fn tool_lsp_query(session_id: &str, input: &Value) -> NativeToolResult {
    let workspace = session_workspace_root(session_id)?;
    let query_type = value_string(input, "queryType").unwrap_or_else(|| "diagnostics".to_string());
    Ok(NativeToolSuccess {
        content: format!(
            "LSP query '{query_type}' is not available in the native runtime fallback. Workspace: {}",
            workspace.display()
        ),
        raw: json!({
            "available": false,
            "degraded": true,
            "queryType": query_type,
            "workspaceRoot": workspace.display().to_string(),
            "message": "LSP bridge is unavailable; use code_search_text or code_search_symbol for local evidence."
        }),
        recommended_next_action: Some(
            "Use code_search_text or code_search_symbol for local code evidence.".to_string(),
        ),
    })
}