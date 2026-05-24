use anyhow::Result;
use std::path::Path;

pub mod image {
    use anyhow::Result;
    use std::path::Path;

    #[derive(Debug, Clone, Copy)]
    pub enum ImageProtocol {
        Auto,
        Iterm,
        Kitty,
        Sixel,
    }

    impl ImageProtocol {
        pub fn detect() -> Self {
            Self::Auto
        }

        pub fn is_supported(self) -> bool {
            false
        }
    }

    #[derive(Debug, Clone)]
    pub struct ImageDisplayParams {
        pub max_width: Option<u32>,
        pub max_height: Option<u32>,
        pub protocol: ImageProtocol,
    }

    impl ImageDisplayParams {
        pub fn from_terminal() -> Self {
            Self {
                max_width: None,
                max_height: None,
                protocol: ImageProtocol::Auto,
            }
        }
    }

    pub fn display_image(_path: &Path, _params: &ImageDisplayParams) -> Result<bool> {
        Ok(false)
    }
}

pub mod session_picker {
    #[derive(Debug, Clone, PartialEq, Eq)]
    pub enum ResumeTarget {
        JcodeSession {
            session_id: String,
        },
        ClaudeCodeSession {
            session_id: String,
            session_path: String,
        },
        CodexSession {
            session_id: String,
            session_path: String,
        },
        PiSession {
            session_path: String,
        },
        OpenCodeSession {
            session_id: String,
            session_path: String,
        },
    }

    pub fn invalidate_session_list_cache() {}
}

pub struct App;

impl App {
    pub fn save_startup_submission_for_session(
        _session_id: &str,
        _message: String,
        _images: Vec<(String, String)>,
    ) {
    }
}

pub fn write_generated_image_side_panel_page(
    _session_id: &str,
    _id: &str,
    _path: &str,
    _metadata_path: Option<&str>,
    _output_format: &str,
    _revised_prompt: Option<&str>,
) -> Result<crate::side_panel::SidePanelSnapshot> {
    Ok(crate::side_panel::SidePanelSnapshot::default())
}

pub fn cache_ttl_for_provider_model(_provider: &str, _model: Option<&str>) -> Option<u64> {
    None
}

pub fn open_path(_path: &Path) -> Result<()> {
    Ok(())
}
