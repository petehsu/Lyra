use super::{object_schema, string_schema, usize_schema, AgentTool, JsonSchema, ToolContext};
use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::time::Duration;

#[derive(Default)]
pub struct WebSearchTool;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WebSearchInput {
    pub query: String,
    #[serde(default)]
    pub max_results: Option<usize>,
}

impl JsonSchema for WebSearchInput {
    fn json_schema() -> Value {
        object_schema(
            vec![
                ("query", string_schema("Search query.")),
                ("maxResults", usize_schema("Maximum search results.")),
            ],
            &["query"],
        )
    }
}

impl AgentTool for WebSearchTool {
    const NAME: &'static str = "web_search";
    type Input = WebSearchInput;
    type Output = Value;

    fn description() -> &'static str {
        "Search the web and return a bounded list of result snippets."
    }

    fn run(&self, input: Self::Input, _ctx: &ToolContext) -> Result<Self::Output> {
        let query = input.query.trim();
        if query.is_empty() {
            return Err(anyhow!("web_search query is required"));
        }
        let max_results = input.max_results.unwrap_or(5).clamp(1, 10);
        let url = format!(
            "https://duckduckgo.com/html/?q={}",
            query.split_whitespace().collect::<Vec<_>>().join("+")
        );
        let client = reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(30))
            .user_agent("LyraAgent/0.1")
            .build()?;
        let html = client.get(&url).send()?.text()?;
        let results = extract_duckduckgo_results(&html, max_results);
        Ok(json!({
            "query": query,
            "results": results,
            "source": url
        }))
    }
}

fn extract_duckduckgo_results(html: &str, max_results: usize) -> Vec<Value> {
    html.split("result__a")
        .skip(1)
        .take(max_results)
        .filter_map(|chunk| {
            let href = extract_between(chunk, "href=\"", "\"")?;
            let title_html = extract_between(chunk, ">", "</a>").unwrap_or_default();
            Some(json!({
                "title": strip_tags(&title_html),
                "url": html_unescape(&href)
            }))
        })
        .collect()
}

fn extract_between(input: &str, start: &str, end: &str) -> Option<String> {
    let after_start = input.split_once(start)?.1;
    Some(after_start.split_once(end)?.0.to_string())
}

fn strip_tags(input: &str) -> String {
    let mut output = String::new();
    let mut in_tag = false;
    for ch in input.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => output.push(ch),
            _ => {}
        }
    }
    html_unescape(output.trim())
}

fn html_unescape(input: &str) -> String {
    input
        .replace("&amp;", "&")
        .replace("&quot;", "\"")
        .replace("&#x27;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
}
