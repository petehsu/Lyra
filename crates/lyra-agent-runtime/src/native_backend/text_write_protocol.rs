use super::*;

const TEXT_WRITE_MARKER: &str = "lyra-write-file";
const MAX_PROVIDER_SUMMARY_CHARS: usize = 8_000;

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct TextWriteBlock {
    pub(crate) path: String,
    pub(crate) overwrite: bool,
    pub(crate) content: String,
}

pub(crate) fn extract_text_write_blocks(text: &str) -> Result<Vec<TextWriteBlock>, String> {
    let lines = text.split_inclusive('\n').collect::<Vec<_>>();
    let mut blocks = Vec::new();
    let mut index = 0_usize;
    while index < lines.len() {
        let line = lines[index].trim_end_matches(['\r', '\n']);
        let Some((fence, info)) = opening_text_write_fence(line) else {
            index += 1;
            continue;
        };
        let attrs = parse_text_write_attrs(info)?;
        let content_start = index + 1;
        let mut content_end = None;
        let mut scan = content_start;
        while scan < lines.len() {
            if is_closing_fence(lines[scan].trim_end_matches(['\r', '\n']), fence) {
                content_end = Some(scan);
                break;
            }
            scan += 1;
        }
        let Some(content_end) = content_end else {
            return Err(format!(
                "{TEXT_WRITE_MARKER} block for {} is missing its closing fence",
                attrs.path
            ));
        };
        blocks.push(TextWriteBlock {
            path: attrs.path,
            overwrite: attrs.overwrite,
            content: lines[content_start..content_end].concat(),
        });
        index = content_end + 1;
    }
    Ok(blocks)
}

pub(crate) fn execute_text_write_blocks(
    session_id: &str,
    turn_id: &str,
    dispatcher: &Option<Arc<HostCapabilityDispatcher>>,
    cancellation: &Arc<AtomicBool>,
    mut runtime: ToolExecutionRuntime,
    blocks: &[TextWriteBlock],
) -> String {
    runtime.allow_large_text_file_write = true;
    let mut summaries = Vec::new();
    for (index, block) in blocks.iter().enumerate() {
        let output = execute_model_tool_with_runtime(
            session_id,
            turn_id,
            dispatcher,
            cancellation,
            runtime,
            ModelToolCall {
                id: format!("text-write-{}", Uuid::new_v4()),
                name: lyra_tool_fs_core::TOOL_FS_RUN.to_string(),
                arguments: json!({
                    "path": "/tools/filesystem/write_file",
                    "args": {
                        "path": block.path.clone(),
                        "content": block.content.clone(),
                        "overwrite": block.overwrite
                    }
                }),
            },
        );
        let content = output
            .get("content")
            .and_then(Value::as_str)
            .filter(|text| !text.trim().is_empty())
            .map(truncate_provider_summary)
            .unwrap_or_else(|| {
                serde_json::to_string_pretty(&output)
                    .map(|text| truncate_provider_summary(&text))
                    .unwrap_or_else(|_| {
                        "Text write block executed with no readable output.".to_string()
                    })
            });
        summaries.push(format!(
            "Text write block {} for `{}`:\n{}",
            index + 1,
            block.path,
            content
        ));
    }
    summaries.join("\n\n")
}

fn truncate_provider_summary(text: &str) -> String {
    if text.chars().count() <= MAX_PROVIDER_SUMMARY_CHARS {
        return text.to_string();
    }
    let kept = text
        .chars()
        .take(MAX_PROVIDER_SUMMARY_CHARS)
        .collect::<String>();
    format!(
        "{kept}\n\n[Text write result truncated for provider context; full details remain in Lyra tool activity.]"
    )
}

fn opening_text_write_fence(line: &str) -> Option<(&'static str, &str)> {
    let trimmed = line.trim_start_matches(' ');
    if line.len().saturating_sub(trimmed.len()) > 3 {
        return None;
    }
    for fence in ["```", "~~~"] {
        let Some(info) = trimmed.strip_prefix(fence) else {
            continue;
        };
        let info = info.trim();
        if info == TEXT_WRITE_MARKER || info.starts_with(&format!("{TEXT_WRITE_MARKER} ")) {
            return Some((fence, info));
        }
    }
    None
}

fn is_closing_fence(line: &str, fence: &str) -> bool {
    let trimmed = line.trim_start_matches(' ');
    line.len().saturating_sub(trimmed.len()) <= 3
        && trimmed
            .strip_prefix(fence)
            .is_some_and(|tail| tail.trim().is_empty())
}

#[derive(Clone, Debug)]
struct TextWriteAttrs {
    path: String,
    overwrite: bool,
}

fn parse_text_write_attrs(info: &str) -> Result<TextWriteAttrs, String> {
    let attrs = parse_attrs(info.strip_prefix(TEXT_WRITE_MARKER).unwrap_or_default())?;
    let path = attrs
        .get("path")
        .or_else(|| attrs.get("file"))
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| format!("{TEXT_WRITE_MARKER} block requires path=\"...\""))?;
    let overwrite = attrs
        .get("overwrite")
        .map(|value| matches!(value.trim(), "true" | "1" | "yes"))
        .unwrap_or(true);
    Ok(TextWriteAttrs { path, overwrite })
}

fn parse_attrs(input: &str) -> Result<HashMap<String, String>, String> {
    let chars = input.chars().collect::<Vec<_>>();
    let mut attrs = HashMap::new();
    let mut index = 0_usize;
    while index < chars.len() {
        while index < chars.len() && chars[index].is_whitespace() {
            index += 1;
        }
        if index >= chars.len() {
            break;
        }
        let key_start = index;
        while index < chars.len() && !chars[index].is_whitespace() && chars[index] != '=' {
            index += 1;
        }
        let key = chars[key_start..index].iter().collect::<String>();
        while index < chars.len() && chars[index].is_whitespace() {
            index += 1;
        }
        if index >= chars.len() || chars[index] != '=' {
            return Err(format!(
                "{TEXT_WRITE_MARKER} attribute `{key}` must use key=value syntax"
            ));
        }
        index += 1;
        while index < chars.len() && chars[index].is_whitespace() {
            index += 1;
        }
        let value = if index < chars.len() && matches!(chars[index], '"' | '\'') {
            let quote = chars[index];
            index += 1;
            let mut value = String::new();
            while index < chars.len() {
                let ch = chars[index];
                index += 1;
                if ch == quote {
                    break;
                }
                if ch == '\\' && index < chars.len() {
                    value.push(chars[index]);
                    index += 1;
                } else {
                    value.push(ch);
                }
            }
            value
        } else {
            let value_start = index;
            while index < chars.len() && !chars[index].is_whitespace() {
                index += 1;
            }
            chars[value_start..index].iter().collect::<String>()
        };
        if !key.is_empty() {
            attrs.insert(key, value);
        }
    }
    Ok(attrs)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_lyra_write_file_blocks_without_touching_plain_code() {
        let text = concat!(
            "Here is a normal snippet:\n",
            "```rust\nfn main() {}\n```\n\n",
            "```lyra-write-file path=\"src/index.html\" overwrite=true\n",
            "<!doctype html>\n<html></html>\n",
            "```\n"
        );
        let blocks = extract_text_write_blocks(text).expect("extract");
        assert_eq!(
            blocks,
            vec![TextWriteBlock {
                path: "src/index.html".to_string(),
                overwrite: true,
                content: "<!doctype html>\n<html></html>\n".to_string(),
            }]
        );
    }

    #[test]
    fn rejects_malformed_lyra_write_file_block() {
        let error = extract_text_write_blocks("```lyra-write-file overwrite=true\nx\n```\n")
            .expect_err("missing path");
        assert!(error.contains("requires path"));
    }
}
