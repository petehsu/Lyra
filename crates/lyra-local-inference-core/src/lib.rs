use anyhow::{Context, Result, anyhow};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

pub const LLAMA_CPP_FFI_BACKEND: &str = "llama_cpp_ffi";
pub const MLX_FFI_BACKEND: &str = "mlx_ffi";

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LocalBackendId {
    LlamaCppFfi,
    MlxFfi,
}

impl LocalBackendId {
    pub fn from_protocol_id(protocol_id: &str) -> Option<Self> {
        match protocol_id {
            LLAMA_CPP_FFI_BACKEND => Some(Self::LlamaCppFfi),
            MLX_FFI_BACKEND => Some(Self::MlxFfi),
            _ => None,
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Self::LlamaCppFfi => LLAMA_CPP_FFI_BACKEND,
            Self::MlxFfi => MLX_FFI_BACKEND,
        }
    }

    pub fn display_name(&self) -> &'static str {
        match self {
            Self::LlamaCppFfi => "llama.cpp FFI",
            Self::MlxFfi => "MLX FFI",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LocalModelRef {
    pub backend: LocalBackendId,
    pub model_path: PathBuf,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalModelInfo {
    pub id: String,
    pub name: String,
    pub local_model_path: String,
    pub backend: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LocalChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LocalInferenceRequest {
    pub model: LocalModelRef,
    pub model_id: String,
    pub messages: Vec<LocalChatMessage>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LocalInferenceResponse {
    pub text: String,
}

pub fn inspect_model(model: LocalModelRef) -> Result<LocalModelInfo> {
    let model_path = validate_model_path(&model.model_path)?;
    let id = model_id_from_path(&model_path);
    Ok(LocalModelInfo {
        id: id.clone(),
        name: id,
        local_model_path: model_path.to_string_lossy().to_string(),
        backend: model.backend.as_str().to_string(),
    })
}

pub fn generate_response(
    request: LocalInferenceRequest,
    cancel: &AtomicBool,
    on_delta: impl FnMut(&str) -> Result<()>,
) -> Result<LocalInferenceResponse> {
    if cancel.load(Ordering::Relaxed) {
        return Err(anyhow!("turn cancelled"));
    }
    validate_model_path(&request.model.model_path)?;
    match request.model.backend {
        LocalBackendId::LlamaCppFfi => llama_cpp::generate_response(request, cancel, on_delta),
        LocalBackendId::MlxFfi => mlx::generate_response(request, cancel, on_delta),
    }
}

pub fn backend_available(backend: &LocalBackendId) -> bool {
    match backend {
        LocalBackendId::LlamaCppFfi => llama_cpp::available(),
        LocalBackendId::MlxFfi => mlx::available(),
    }
}

fn validate_model_path(path: &Path) -> Result<PathBuf> {
    let normalized = path
        .to_str()
        .map(str::trim)
        .filter(|value| value.is_empty() == false)
        .ok_or_else(|| anyhow!("local model path is required"))?;
    let path = PathBuf::from(normalized);
    let metadata = std::fs::metadata(&path)
        .with_context(|| format!("local model path does not exist: {}", path.display()))?;
    if metadata.is_file() || metadata.is_dir() {
        Ok(path)
    } else {
        Err(anyhow!(
            "local model path must be a file or directory: {}",
            path.display()
        ))
    }
}

fn model_id_from_path(path: &Path) -> String {
    if let Some(name) = path
        .file_name()
        .and_then(|value| value.to_str())
        .map(str::trim)
        .filter(|value| value.is_empty() == false)
    {
        name.to_string()
    } else {
        path.to_string_lossy().to_string()
    }
}

mod llama_cpp {
    use super::{LocalInferenceRequest, LocalInferenceResponse};
    use anyhow::{Result, anyhow};
    use std::sync::atomic::AtomicBool;

    pub(super) fn available() -> bool {
        cfg!(feature = "llama-cpp-ffi")
    }

    pub(super) fn generate_response(
        _request: LocalInferenceRequest,
        _cancel: &AtomicBool,
        _on_delta: impl FnMut(&str) -> Result<()>,
    ) -> Result<LocalInferenceResponse> {
        Err(anyhow!(
            "llama.cpp FFI backend is not linked in this Lyra build. Build with the `llama-cpp-ffi` feature and provide the native llama.cpp library."
        ))
    }
}

mod mlx {
    use super::{LocalInferenceRequest, LocalInferenceResponse};
    use anyhow::{Result, anyhow};
    use std::sync::atomic::AtomicBool;

    pub(super) fn available() -> bool {
        cfg!(feature = "mlx-ffi")
    }

    pub(super) fn generate_response(
        _request: LocalInferenceRequest,
        _cancel: &AtomicBool,
        _on_delta: impl FnMut(&str) -> Result<()>,
    ) -> Result<LocalInferenceResponse> {
        Err(anyhow!(
            "MLX FFI backend is not linked in this Lyra build. Build with the `mlx-ffi` feature and provide the native MLX runtime."
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_missing_model_path() {
        let error = inspect_model(LocalModelRef {
            backend: LocalBackendId::LlamaCppFfi,
            model_path: PathBuf::from("/definitely/missing/model.gguf"),
        })
        .expect_err("missing path");

        assert!(
            error
                .to_string()
                .contains("local model path does not exist")
        );
    }

    #[test]
    fn inspects_existing_model_file() {
        let temp = tempfile::NamedTempFile::new().expect("temp file");
        let info = inspect_model(LocalModelRef {
            backend: LocalBackendId::MlxFfi,
            model_path: temp.path().to_path_buf(),
        })
        .expect("model info");

        assert_eq!(
            info.name,
            temp.path()
                .file_name()
                .unwrap()
                .to_string_lossy()
                .to_string()
        );
        assert_eq!(info.backend, MLX_FFI_BACKEND);
    }
}
