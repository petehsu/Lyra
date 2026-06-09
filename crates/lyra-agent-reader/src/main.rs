use std::path::PathBuf;

use clap::{Parser, ValueEnum};
use lyra_agent_reader::{
    ChunkingMode, ContentFilterMode, ExtractionMode, ImageRetention, LinkRetention, ReaderEngine,
    ReaderInput, ReaderOptions, ReaderOutputFormat, ReaderPreset, ReaderRequest,
    ReqwestFetchProvider,
};

#[derive(Parser, Debug)]
#[command(name = "lyra-agent-reader")]
#[command(about = "Read a URL or local file into agent-friendly markdown/text/json.")]
struct Cli {
    /// URL or local file path.
    input: String,
    /// Output format.
    #[arg(long, value_enum)]
    format: Option<CliOutputFormat>,
    /// Reader preset.
    #[arg(long, value_enum)]
    preset: Option<CliPreset>,
    /// Extraction mode.
    #[arg(long, value_enum)]
    mode: Option<CliMode>,
    /// Query focus.
    #[arg(long)]
    query: Option<String>,
    /// User task text used as a secondary query focus signal.
    #[arg(long)]
    user_task: Option<String>,
    /// Maximum output chars.
    #[arg(long)]
    max_chars: Option<usize>,
    /// Maximum output tokens.
    #[arg(long)]
    max_tokens: Option<usize>,
    /// Reader engine.
    #[arg(long, value_enum)]
    engine: Option<CliEngine>,
    /// Jina Reader compatible header, e.g. `X-Target-Selector: main`.
    #[arg(long = "jina-header")]
    jina_headers: Vec<String>,
    /// Emit full JSON result.
    #[arg(long)]
    json: bool,
    /// Allow file: URLs and trusted local path behaviour.
    #[arg(long)]
    trusted_local: bool,
    /// Allow localhost/private/link-local URL fetches.
    #[arg(long)]
    allow_private_network: bool,
}

#[derive(Clone, Copy, Debug, ValueEnum)]
enum CliOutputFormat {
    Markdown,
    Text,
    Json,
    Chunks,
    FrontmatterMarkdown,
}

#[derive(Clone, Copy, Debug, ValueEnum)]
enum CliPreset {
    Agent,
    Research,
    Index,
    Reader,
    Raw,
}

#[derive(Clone, Copy, Debug, ValueEnum)]
enum CliMode {
    Main,
    Full,
    Text,
    Raw,
}

#[derive(Clone, Copy, Debug, ValueEnum)]
enum CliEngine {
    Auto,
    Http,
    Browser,
}

fn main() {
    let cli = Cli::parse();
    let mut options = ReaderOptions::default();
    options.trusted_local = cli.trusted_local;
    options.allow_private_network = cli.allow_private_network;
    if let Some(format) = cli.format {
        options.output_format = output_format(format);
    }
    if cli.json {
        options.output_format = ReaderOutputFormat::Json;
    }
    if let Some(preset) = cli.preset {
        options.preset = preset.into();
    }
    if let Some(mode) = cli.mode {
        options.mode = mode.into();
    }
    if let Some(query) = cli.query {
        options.query_focus = Some(query);
        options.content_filter = ContentFilterMode::Hybrid;
    }
    options.user_task = cli.user_task;
    options.max_chars = cli.max_chars;
    options.max_tokens = cli.max_tokens;
    if let Some(engine) = cli.engine {
        options.engine = engine.into();
    }
    for header in &cli.jina_headers {
        apply_jina_header(header, &mut options);
    }

    let input = reader_input(&cli.input);
    let request = ReaderRequest { input, options };
    let fetch = ReqwestFetchProvider::new();
    match lyra_agent_reader::read(&request, &fetch) {
        Ok(result) => {
            let text = match request.options.output_format {
                ReaderOutputFormat::Json => match serde_json::to_string_pretty(&result) {
                    Ok(value) => value,
                    Err(error) => {
                        eprintln!("failed to serialize reader JSON: {error}");
                        std::process::exit(5);
                    }
                },
                ReaderOutputFormat::Text => result.compact_text,
                ReaderOutputFormat::Chunks => match serde_json::to_string_pretty(&result.chunks) {
                    Ok(value) => value,
                    Err(error) => {
                        eprintln!("failed to serialize chunks JSON: {error}");
                        std::process::exit(5);
                    }
                },
                ReaderOutputFormat::FrontmatterMarkdown => {
                    format!(
                        "{}\n\n{}",
                        frontmatter_text(&result.frontmatter),
                        result.markdown_with_citations
                    )
                }
                ReaderOutputFormat::Markdown => result.markdown_with_citations,
            };
            println!("{text}");
        }
        Err(error) => {
            eprintln!("{error}");
            std::process::exit(exit_code(&error));
        }
    }
}

fn reader_input(input: &str) -> ReaderInput {
    if input.starts_with("http://") || input.starts_with("https://") || input.starts_with("file://")
    {
        ReaderInput::Url(input.to_string())
    } else {
        ReaderInput::LocalFile(PathBuf::from(input))
    }
}

fn output_format(format: CliOutputFormat) -> ReaderOutputFormat {
    match format {
        CliOutputFormat::Markdown => ReaderOutputFormat::Markdown,
        CliOutputFormat::Text => ReaderOutputFormat::Text,
        CliOutputFormat::Json => ReaderOutputFormat::Json,
        CliOutputFormat::Chunks => ReaderOutputFormat::Chunks,
        CliOutputFormat::FrontmatterMarkdown => ReaderOutputFormat::FrontmatterMarkdown,
    }
}

impl From<CliPreset> for ReaderPreset {
    fn from(value: CliPreset) -> Self {
        match value {
            CliPreset::Agent => ReaderPreset::Agent,
            CliPreset::Research => ReaderPreset::Research,
            CliPreset::Index => ReaderPreset::Index,
            CliPreset::Reader => ReaderPreset::Reader,
            CliPreset::Raw => ReaderPreset::Raw,
        }
    }
}

impl From<CliMode> for ExtractionMode {
    fn from(value: CliMode) -> Self {
        match value {
            CliMode::Main => ExtractionMode::Main,
            CliMode::Full => ExtractionMode::Full,
            CliMode::Text => ExtractionMode::Text,
            CliMode::Raw => ExtractionMode::Raw,
        }
    }
}

impl From<CliEngine> for ReaderEngine {
    fn from(value: CliEngine) -> Self {
        match value {
            CliEngine::Auto => ReaderEngine::Auto,
            CliEngine::Http => ReaderEngine::Http,
            CliEngine::Browser => ReaderEngine::Browser,
        }
    }
}

fn apply_jina_header(header: &str, options: &mut ReaderOptions) {
    let Some((name, value)) = header.split_once(':') else {
        return;
    };
    let name = name.trim().to_ascii_lowercase();
    let value = value.trim();
    match name.as_str() {
        "x-respond-with" => {
            options.output_format = match value.to_ascii_lowercase().as_str() {
                "text" => ReaderOutputFormat::Text,
                "json" => ReaderOutputFormat::Json,
                "chunks" => ReaderOutputFormat::Chunks,
                "frontmatter+markdown" | "frontmatter-markdown" => {
                    ReaderOutputFormat::FrontmatterMarkdown
                }
                _ => ReaderOutputFormat::Markdown,
            };
        }
        "x-target-selector" => options.target_selector = nonempty(value),
        "x-remove-selector" => options.remove_selectors.push(value.to_string()),
        "x-wait-for-selector" => options.wait_for_selector = nonempty(value),
        "x-with-generated-alt" => options.use_caption = truthy(value),
        "x-with-links-summary" => {
            if truthy(value) {
                options.retain_links = LinkRetention::Summary;
            }
        }
        "x-no-cache" => {
            if truthy(value) {
                options.cache_policy = lyra_agent_reader::ReaderCachePolicy::NoStore;
            }
        }
        "x-cache-tolerance" => {
            if value != "0" {
                options.cache_policy = lyra_agent_reader::ReaderCachePolicy::ReadWrite;
            }
        }
        "x-with-images-summary" => {
            if truthy(value) {
                options.retain_images = ImageRetention::Summary;
            }
        }
        "x-engine" => {
            options.engine = match value.to_ascii_lowercase().as_str() {
                "http" => ReaderEngine::Http,
                "browser" => ReaderEngine::Browser,
                _ => ReaderEngine::Auto,
            };
        }
        "x-chunking" => {
            if truthy(value) {
                options.chunking.mode = ChunkingMode::Block;
            }
        }
        _ => {}
    }
}

fn nonempty(value: &str) -> Option<String> {
    (!value.trim().is_empty()).then(|| value.trim().to_string())
}

fn truthy(value: &str) -> bool {
    matches!(
        value.trim().to_ascii_lowercase().as_str(),
        "1" | "true" | "yes" | "on"
    )
}

fn frontmatter_text(frontmatter: &lyra_agent_reader::Frontmatter) -> String {
    let json = serde_json::to_value(frontmatter).unwrap_or(serde_json::Value::Null);
    let mut lines = vec!["---".to_string()];
    if let Some(object) = json.as_object() {
        for (key, value) in object {
            if !value.is_null() {
                lines.push(format!("{key}: {value}"));
            }
        }
    }
    lines.push("---".to_string());
    lines.join("\n")
}

fn exit_code(error: &lyra_agent_reader::ReaderError) -> i32 {
    match error {
        lyra_agent_reader::ReaderError::Fetch { .. } => 2,
        lyra_agent_reader::ReaderError::AccessDenied { .. } => 2,
        lyra_agent_reader::ReaderError::Parse(_) => 3,
        lyra_agent_reader::ReaderError::Decode(_) => 3,
        lyra_agent_reader::ReaderError::Budget(_) => 4,
        lyra_agent_reader::ReaderError::UnsupportedFormat { .. } => 6,
        lyra_agent_reader::ReaderError::Io(_) => 7,
    }
}
