use ratex_types::color::Color;

use crate::options::RenderTheme;

pub fn math_color_for_theme(theme: RenderTheme) -> Color {
    match theme {
        RenderTheme::Light => Color::BLACK,
        RenderTheme::Dark | RenderTheme::Auto => Color::rgb(0.835, 0.843, 0.871),
    }
}

pub fn math_font_size(display_mode: bool) -> f64 {
    if display_mode {
        20.0
    } else {
        16.0
    }
}