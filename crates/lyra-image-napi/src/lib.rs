use napi::bindgen_prelude::{AsyncTask, Buffer};
use napi::{Env, Error, Result, Status, Task};
use napi_derive::napi;
use once_cell::sync::Lazy;

use lyra_image_core as core;
use lyra_image_core::ImageKernel;

static IMAGE_KERNEL: Lazy<ImageKernel> = Lazy::new(ImageKernel::new);

fn to_napi_error(error: impl std::fmt::Display) -> Error {
    Error::new(Status::GenericFailure, error.to_string())
}

#[napi(object)]
pub struct ImageViewerOpenRequest {
    pub path: String,
    pub storage_root: Option<String>,
}

#[napi(object)]
pub struct ImageViewerCloseSessionRequest {
    pub session_id: String,
}

#[napi(object)]
pub struct ImageViewerReadTileRequest {
    pub session_id: String,
    pub level: u32,
    pub tile_x: u32,
    pub tile_y: u32,
    pub generation_id: Option<String>,
}

#[napi(object)]
pub struct ImageViewerLevel {
    pub level: u32,
    pub width: u32,
    pub height: u32,
    pub scale: f64,
}

#[napi(object)]
pub struct ImageViewerOpenResult {
    pub session_id: String,
    pub path: String,
    pub title: String,
    pub format: String,
    pub mime_type: String,
    pub width: u32,
    pub height: u32,
    pub frame_count: u32,
    pub has_alpha: bool,
    pub orientation: u32,
    pub color_space: String,
    pub size_bytes: f64,
    pub tile_size: u32,
    pub levels: Vec<ImageViewerLevel>,
    pub native_tile_supported: bool,
    pub source_url: String,
    pub kernel: String,
    pub render_mode: String,
    pub cache_state: String,
    pub cache_id: String,
    pub generation_id: String,
    pub sample_format: String,
    pub channel_count: u32,
    pub has_internal_tiles: bool,
    pub has_internal_mipmaps: bool,
    pub import_progress: f64,
}

#[napi(object)]
pub struct ImageViewerTileResponse {
    pub width: u32,
    pub height: u32,
    pub stride: u32,
    pub pixel_format: String,
    pub pixels: Buffer,
}

impl From<core::ImageViewerLevel> for ImageViewerLevel {
    fn from(value: core::ImageViewerLevel) -> Self {
        Self {
            level: value.level,
            width: value.width,
            height: value.height,
            scale: value.scale,
        }
    }
}

impl From<core::ImageViewerOpenResult> for ImageViewerOpenResult {
    fn from(value: core::ImageViewerOpenResult) -> Self {
        Self {
            session_id: value.session_id,
            path: value.path,
            title: value.title,
            format: value.format,
            mime_type: value.mime_type,
            width: value.width,
            height: value.height,
            frame_count: value.frame_count,
            has_alpha: value.has_alpha,
            orientation: value.orientation,
            color_space: value.color_space,
            size_bytes: value.size_bytes as f64,
            tile_size: value.tile_size,
            levels: value.levels.into_iter().map(Into::into).collect(),
            native_tile_supported: value.native_tile_supported,
            source_url: value.source_url,
            kernel: value.kernel,
            render_mode: value.render_mode,
            cache_state: value.cache_state,
            cache_id: value.cache_id,
            generation_id: value.generation_id,
            sample_format: value.sample_format,
            channel_count: value.channel_count,
            has_internal_tiles: value.has_internal_tiles,
            has_internal_mipmaps: value.has_internal_mipmaps,
            import_progress: value.import_progress,
        }
    }
}

pub struct OpenImageTask {
    path: String,
    storage_root: Option<String>,
}

impl Task for OpenImageTask {
    type Output = core::ImageViewerOpenResult;
    type JsValue = ImageViewerOpenResult;

    fn compute(&mut self) -> Result<Self::Output> {
        IMAGE_KERNEL
            .open_image_with_storage(&self.path, self.storage_root.as_deref())
            .map_err(to_napi_error)
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output.into())
    }
}

pub struct ReadTileTask {
    session_id: String,
    level: u32,
    tile_x: u32,
    tile_y: u32,
    generation_id: Option<String>,
}

impl Task for ReadTileTask {
    type Output = core::ImageViewerTileResponse;
    type JsValue = ImageViewerTileResponse;

    fn compute(&mut self) -> Result<Self::Output> {
        IMAGE_KERNEL
            .read_tile(
                &self.session_id,
                self.level,
                self.tile_x,
                self.tile_y,
                self.generation_id.as_deref(),
            )
            .map_err(to_napi_error)
    }

    fn resolve(&mut self, _env: Env, tile: Self::Output) -> Result<Self::JsValue> {
        Ok(ImageViewerTileResponse {
            width: tile.width,
            height: tile.height,
            stride: tile.stride,
            pixel_format: tile.pixel_format,
            pixels: Buffer::from(tile.pixels),
        })
    }
}

pub struct CloseSessionTask {
    session_id: String,
}

impl Task for CloseSessionTask {
    type Output = bool;
    type JsValue = bool;

    fn compute(&mut self) -> Result<Self::Output> {
        IMAGE_KERNEL
            .close_session(&self.session_id)
            .map_err(to_napi_error)
    }

    fn resolve(&mut self, _env: Env, closed: Self::Output) -> Result<Self::JsValue> {
        Ok(closed)
    }
}

#[napi(js_name = "openImage")]
pub fn open_image(request: ImageViewerOpenRequest) -> AsyncTask<OpenImageTask> {
    AsyncTask::new(OpenImageTask {
        path: request.path,
        storage_root: request.storage_root,
    })
}

#[napi(js_name = "readTile")]
pub fn read_tile(request: ImageViewerReadTileRequest) -> AsyncTask<ReadTileTask> {
    AsyncTask::new(ReadTileTask {
        session_id: request.session_id,
        level: request.level,
        tile_x: request.tile_x,
        tile_y: request.tile_y,
        generation_id: request.generation_id,
    })
}

#[napi(js_name = "closeSession")]
pub fn close_session(request: ImageViewerCloseSessionRequest) -> AsyncTask<CloseSessionTask> {
    AsyncTask::new(CloseSessionTask {
        session_id: request.session_id,
    })
}
