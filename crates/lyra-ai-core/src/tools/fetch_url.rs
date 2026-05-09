use super::{object_schema, string_schema, usize_schema, AgentTool, JsonSchema, ToolContext};
use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::time::Duration;

#[derive(Default)]
pub struct FetchUrlTool;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FetchUrlInput {
    pub url: String,
    #[serde(default)]
    pub max_bytes: Option<usize>,
}

impl JsonSchema for FetchUrlInput {
    fn json_schema() -> Value {
        object_schema(
            vec![
                ("url", string_schema("HTTP or HTTPS URL to fetch.")),
                ("maxBytes", usize_schema("Maximum response text bytes.")),
            ],
            &["url"],
        )
    }
}

impl AgentTool for FetchUrlTool {
    const NAME: &'static str = "fetch_url";
    type Input = FetchUrlInput;
    type Output = Value;

    fn description() -> &'static str {
        "Fetch a URL with a bounded response projection."
    }

    fn run(&self, input: Self::Input, _ctx: &ToolContext) -> Result<Self::Output> {
        let url = input.url.trim();
        if !(url.starts_with("https://") || url.starts_with("http://")) {
            return Err(anyhow!("fetch_url only supports http and https URLs"));
        }
        let client = reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(30))
            .build()?;
        let response = client.get(url).send()?;
        let status = response.status().as_u16();
        let content_type = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .unwrap_or("")
            .to_string();
        let limit = input.max_bytes.unwrap_or(65_536).clamp(1, 262_144);
        let mut text = response.text()?;
        let truncated = text.len() > limit;
        if truncated {
            text.truncate(limit);
        }
        Ok(json!({
            "url": url,
            "status": status,
            "contentType": content_type,
            "text": text,
            "truncated": truncated
        }))
    }
}
