mod theme;

use crate::error::{RenderError, RenderResult};
use crate::options::RenderTheme;

#[derive(Debug, Clone)]
pub struct MermaidRenderResult {
    pub svg: Option<String>,
    pub error: Option<String>,
}

pub fn render_mermaid(source: &str, theme: RenderTheme) -> MermaidRenderResult {
    #[cfg(feature = "mermaid")]
    {
        match render_mermaid_sync(source, theme) {
            Ok(svg) => MermaidRenderResult {
                svg,
                error: None,
            },
            Err(error) => MermaidRenderResult {
                svg: None,
                error: Some(error.to_string()),
            },
        }
    }
    #[cfg(not(feature = "mermaid"))]
    {
        let _ = (source, theme);
        MermaidRenderResult {
            svg: None,
            error: Some("mermaid rendering disabled".to_string()),
        }
    }
}

#[cfg(feature = "mermaid")]
fn render_mermaid_sync(source: &str, theme: RenderTheme) -> RenderResult<Option<String>> {
    use merman::render::HeadlessRenderer;

    let trimmed = source.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }

    let renderer = HeadlessRenderer::new()
        .with_lenient_parsing()
        .with_compiled_host_theme(theme::compiled_host_theme(theme));

    renderer
        .render_svg_readable_sync(trimmed)
        .map_err(|error| RenderError::Mermaid(error.to_string()))
}

#[cfg(all(test, feature = "mermaid"))]
mod tests {
    use super::*;

    #[test]
    fn renders_flowchart_to_svg() {
        let rendered = render_mermaid("flowchart LR\n  A-->B\n", RenderTheme::Dark);
        assert!(rendered.error.is_none());
        assert!(rendered
            .svg
            .as_ref()
            .is_some_and(|svg| svg.contains("<svg")));
    }
}