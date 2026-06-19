mod theme;

use crate::error::{RenderError, RenderResult};
use crate::options::RenderTheme;

#[derive(Debug, Clone)]
pub struct MathRenderResult {
    pub svg: Option<String>,
    pub error: Option<String>,
}

pub fn render_math(latex: &str, display_mode: bool, theme: RenderTheme) -> MathRenderResult {
    #[cfg(feature = "math")]
    {
        match render_math_ratex(latex, display_mode, theme) {
            Ok(svg) => MathRenderResult {
                svg: Some(svg),
                error: None,
            },
            Err(error) => MathRenderResult {
                svg: None,
                error: Some(error.to_string()),
            },
        }
    }
    #[cfg(not(feature = "math"))]
    {
        let _ = (display_mode, theme);
        MathRenderResult {
            svg: None,
            error: Some("math rendering disabled".to_string()),
        }
    }
}

#[cfg(feature = "math")]
fn render_math_ratex(
    latex: &str,
    display_mode: bool,
    theme: RenderTheme,
) -> RenderResult<String> {
    use ratex_layout::{layout, to_display_list, LayoutOptions};
    use ratex_parser::parse;
    use ratex_svg::{render_to_svg, SvgOptions};
    use ratex_types::MathStyle;

    let parsed = parse(latex).map_err(|error| RenderError::Math(error.to_string()))?;
    let mut layout_options = LayoutOptions::default().with_color(theme::math_color_for_theme(theme));
    layout_options.style = if display_mode {
        MathStyle::Display
    } else {
        MathStyle::Text
    };
    let layout_box = layout(&parsed, &layout_options);
    let display_list = to_display_list(&layout_box);
    let mut svg_options = SvgOptions::default();
    svg_options.font_size = theme::math_font_size(display_mode);
    Ok(render_to_svg(&display_list, &svg_options))
}

pub fn split_math_in_text(text: &str) -> Vec<MathTextSegment> {
    let mut segments = Vec::new();
    let mut cursor = 0;
    let mut text_start = 0;

    while cursor < text.len() {
        let Some(dollar) = text[cursor..].find('$') else {
            break;
        };
        let index = cursor + dollar;
        if text.as_bytes().get(index + 1) == Some(&b'$') {
            cursor = index + 2;
            continue;
        }
        if index > 0 && text.as_bytes()[index - 1] == b'\\' {
            cursor = index + 1;
            continue;
        }
        if let Some(close_offset) = text[index + 1..].find('$') {
            let close = index + 1 + close_offset;
            if close + 1 < text.len() && text.as_bytes()[close + 1] == b'$' {
                cursor = index + 1;
                continue;
            }
            if close > index + 1 && text.as_bytes()[close - 1] != b'\\' {
                if text_start < index {
                    segments.push(MathTextSegment::Text {
                        value: text[text_start..index].to_string(),
                    });
                }
                segments.push(MathTextSegment::InlineMath {
                    latex: text[index + 1..close].to_string(),
                });
                cursor = close + 1;
                text_start = cursor;
                continue;
            }
        }
        cursor = index + 1;
    }

    if text_start < text.len() {
        segments.push(MathTextSegment::Text {
            value: text[text_start..].to_string(),
        });
    }
    if segments.is_empty() && !text.is_empty() {
        segments.push(MathTextSegment::Text {
            value: text.to_string(),
        });
    }
    segments
}

#[derive(Debug, Clone)]
pub enum MathTextSegment {
    Text { value: String },
    InlineMath { latex: String },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_inline_math_segments() {
        let segments = split_math_in_text("Energy is $E=mc^2$ today.");
        assert_eq!(segments.len(), 3);
        assert!(matches!(&segments[1], MathTextSegment::InlineMath { latex } if latex == "E=mc^2"));
    }

    #[cfg(feature = "math")]
    #[test]
    fn renders_inline_math_to_svg() {
        let rendered = render_math("x^2", false, RenderTheme::Dark);
        assert!(rendered.error.is_none());
        assert!(rendered.svg.as_ref().is_some_and(|svg| svg.contains("<svg")));
    }
}