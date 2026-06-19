use std::sync::OnceLock;

#[cfg(feature = "mermaid")]
use merman::render::{CompiledHostTheme, HostThemeProfile};

use crate::options::RenderTheme;

#[cfg(feature = "mermaid")]
pub fn compiled_host_theme(theme: RenderTheme) -> &'static CompiledHostTheme {
    static DARK: OnceLock<CompiledHostTheme> = OnceLock::new();
    static LIGHT: OnceLock<CompiledHostTheme> = OnceLock::new();

    match theme {
        RenderTheme::Light => LIGHT.get_or_init(|| HostThemeProfile::editor_light().compile()),
        RenderTheme::Dark | RenderTheme::Auto => {
            DARK.get_or_init(|| HostThemeProfile::editor_dark().compile())
        }
    }
}
