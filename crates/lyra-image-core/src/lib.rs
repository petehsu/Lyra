use std::collections::HashMap;
use std::ffi::CStr;
#[cfg(any(lyra_image_oiio, lyra_image_libtiff))]
use std::ffi::CString;
use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom};
#[cfg(any(lyra_image_oiio, lyra_image_libtiff))]
use std::os::raw::c_int;
use std::os::raw::{c_char, c_uint};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use image::{ImageFormat, ImageReader, RgbaImage};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use thiserror::Error;
use tiff::decoder::{Decoder as TiffDecoder, DecodingResult};
use tiff::ColorType as TiffColorType;

const TILE_SIZE: u32 = 512;
const MAX_LEVEL: u32 = 24;
const MAX_CHUNK_DECODE_BYTES: u64 = 128 * 1024 * 1024;
const MAX_CONCURRENT_DECODE_BYTES: u64 = 256 * 1024 * 1024;

struct DecodeMemoryGate {
    used: Mutex<u64>,
    available: Condvar,
}

struct DecodeMemoryPermit<'a> {
    gate: &'a DecodeMemoryGate,
    bytes: u64,
}

static DECODE_MEMORY_GATE: OnceLock<DecodeMemoryGate> = OnceLock::new();

fn decode_memory_gate() -> &'static DecodeMemoryGate {
    DECODE_MEMORY_GATE.get_or_init(|| DecodeMemoryGate {
        used: Mutex::new(0),
        available: Condvar::new(),
    })
}

fn acquire_decode_memory(estimated_bytes: u64) -> Result<DecodeMemoryPermit<'static>> {
    acquire_decode_memory_from_gate(decode_memory_gate(), estimated_bytes)
}

fn acquire_decode_memory_from_gate(
    gate: &DecodeMemoryGate,
    estimated_bytes: u64,
) -> Result<DecodeMemoryPermit<'_>> {
    let bytes = estimated_bytes.clamp(1, MAX_CONCURRENT_DECODE_BYTES);
    let mut used = gate
        .used
        .lock()
        .map_err(|_| ImageKernelError::LockPoisoned)?;
    while used.saturating_add(bytes) > MAX_CONCURRENT_DECODE_BYTES {
        used = gate
            .available
            .wait(used)
            .map_err(|_| ImageKernelError::LockPoisoned)?;
    }
    *used = used.saturating_add(bytes);
    Ok(DecodeMemoryPermit { gate, bytes })
}

impl Drop for DecodeMemoryPermit<'_> {
    fn drop(&mut self) {
        if let Ok(mut used) = self.gate.used.lock() {
            *used = used.saturating_sub(self.bytes);
            self.gate.available.notify_all();
        }
    }
}

unsafe extern "C" {
    fn lyra_image_tile_kernel_accel_name() -> *const c_char;
    fn lyra_image_extract_rgba_tile(
        source: *const u8,
        source_width: c_uint,
        source_height: c_uint,
        level_scale: c_uint,
        tile_size: c_uint,
        tile_x: c_uint,
        tile_y: c_uint,
        destination: *mut u8,
        destination_width: c_uint,
        destination_height: c_uint,
    );
}

#[cfg(lyra_image_oiio)]
unsafe extern "C" {
    fn lyra_oiio_available() -> c_int;
    fn lyra_oiio_probe(path: *const c_char, info: *mut LyraOiioImageInfo) -> c_int;
    fn lyra_oiio_read_rgba_tile(
        path: *const c_char,
        source_x: c_uint,
        source_y: c_uint,
        source_scale: c_uint,
        out_width: c_uint,
        out_height: c_uint,
        out_pixels: *mut u8,
        error: *mut c_char,
        error_len: usize,
    ) -> c_int;
}

#[cfg(lyra_image_libtiff)]
unsafe extern "C" {
    fn lyra_libtiff_available() -> c_int;
    fn lyra_libtiff_read_rgba_tile(
        path: *const c_char,
        source_x: c_uint,
        source_y: c_uint,
        source_scale: c_uint,
        out_width: c_uint,
        out_height: c_uint,
        out_pixels: *mut u8,
        error: *mut c_char,
        error_len: usize,
    ) -> c_int;
}

#[cfg(lyra_image_oiio)]
#[repr(C)]
#[derive(Clone, Copy)]
struct LyraOiioImageInfo {
    width: c_uint,
    height: c_uint,
    channel_count: c_uint,
    tile_width: c_uint,
    tile_height: c_uint,
    has_alpha: c_uint,
    has_internal_tiles: c_uint,
    has_internal_mipmaps: c_uint,
    sample_format: c_uint,
    format_name: [c_char; 64],
    color_space: [c_char; 64],
    error: [c_char; 512],
}

#[cfg(lyra_image_oiio)]
impl Default for LyraOiioImageInfo {
    fn default() -> Self {
        Self {
            width: 0,
            height: 0,
            channel_count: 0,
            tile_width: 0,
            tile_height: 0,
            has_alpha: 0,
            has_internal_tiles: 0,
            has_internal_mipmaps: 0,
            sample_format: 0,
            format_name: [0; 64],
            color_space: [0; 64],
            error: [0; 512],
        }
    }
}

#[derive(Debug, Error)]
pub enum ImageKernelError {
    #[error("image path is required")]
    EmptyPath,
    #[error("image file does not exist: {0}")]
    MissingFile(String),
    #[error("unsupported image format: {0}")]
    UnsupportedFormat(String),
    #[error("image decode failed: {0}")]
    Decode(String),
    #[error("image session not found: {0}")]
    MissingSession(String),
    #[error("image session does not expose native tiles")]
    NativeTileUnsupported,
    #[error("tile request belongs to an older image generation")]
    StaleTileRequest,
    #[error("tile is outside the image bounds")]
    TileOutOfBounds,
    #[error("invalid tile request")]
    InvalidTileRequest,
    #[error("image kernel lock poisoned")]
    LockPoisoned,
    #[error("file metadata failed: {0}")]
    Metadata(String),
    #[error("image cache failed: {0}")]
    Cache(String),
}

pub type Result<T> = std::result::Result<T, ImageKernelError>;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageViewerLevel {
    pub level: u32,
    pub width: u32,
    pub height: u32,
    pub scale: f64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
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
    pub size_bytes: u64,
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

#[derive(Clone, Debug)]
pub struct ImageViewerTileResponse {
    pub width: u32,
    pub height: u32,
    pub stride: u32,
    pub pixel_format: String,
    pub pixels: Vec<u8>,
}

struct ImageSession {
    metadata: ImageViewerOpenResult,
    backend: ImageBackend,
}

enum ImageBackend {
    SourceOnly,
    DecodedRgba(Arc<RgbaImage>),
    Oiio(OiioSession),
    Tiff(TiffSession),
}

#[derive(Clone)]
#[cfg_attr(not(lyra_image_oiio), allow(dead_code))]
struct OiioSession {
    path: PathBuf,
    width: u32,
    height: u32,
    cache_root: Option<PathBuf>,
}

#[derive(Clone)]
struct TiffSession {
    path: PathBuf,
    width: u32,
    height: u32,
    color_type: TiffDisplayColor,
    chunk_type: TiffChunkType,
    chunk_width: u32,
    chunk_height: u32,
    chunks_across: u32,
    raw_layout: Option<RawTiffLayout>,
    cache_root: Option<PathBuf>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum TiffChunkType {
    Strip,
    Tile,
}

#[derive(Clone, Copy, Debug)]
struct TiffDisplayColor {
    samples: u16,
    bit_depth: u8,
    photometric: u16,
    sample_format: u16,
    has_alpha: bool,
}

#[derive(Clone, Debug)]
struct RawTiffLayout {
    path: PathBuf,
    endian: Endian,
    width: u32,
    height: u32,
    bits_per_sample: Vec<u16>,
    compression: u16,
    photometric: u16,
    strip_offsets: Vec<u64>,
    strip_byte_counts: Vec<u64>,
    rows_per_strip: Option<u32>,
    samples_per_pixel: u16,
    planar_config: u16,
    tile_width: Option<u32>,
    tile_length: Option<u32>,
    tile_offsets: Vec<u64>,
    _tile_byte_counts: Vec<u64>,
    sample_format: u16,
    extra_samples: Vec<u16>,
}

#[derive(Clone, Copy, Debug)]
enum Endian {
    Little,
    Big,
}

#[derive(Default)]
pub struct ImageKernel {
    sessions: Mutex<HashMap<String, ImageSession>>,
    serial: AtomicU64,
}

impl ImageKernel {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn open_image(&self, raw_path: &str) -> Result<ImageViewerOpenResult> {
        self.open_image_with_storage(raw_path, None)
    }

    pub fn open_image_with_storage(
        &self,
        raw_path: &str,
        storage_root: Option<&str>,
    ) -> Result<ImageViewerOpenResult> {
        let path = normalize_path(raw_path)?;
        if path.exists() == false {
            return Err(ImageKernelError::MissingFile(path.display().to_string()));
        }

        let file_metadata =
            fs::metadata(&path).map_err(|error| ImageKernelError::Metadata(error.to_string()))?;
        let size_bytes = file_metadata.len();
        let title = title_from_path(&path);
        let extension = extension_from_path(&path);

        if matches!(extension.as_deref(), Some("tif" | "tiff"))
            || is_oiio_candidate(extension.as_deref())
        {
            if let Some(opened) = self.try_open_oiio(
                &path,
                title.clone(),
                extension.as_deref(),
                size_bytes,
                storage_root,
            )? {
                return Ok(opened);
            }
        }

        if matches!(extension.as_deref(), Some("tif" | "tiff")) {
            return self.open_tiff(path, title, size_bytes, storage_root);
        }

        if extension.as_deref() == Some("svg") {
            return self.create_source_session(
                path,
                title,
                "svg".to_string(),
                mime_type_from_extension(Some("svg")),
                0,
                0,
                true,
                size_bytes,
                "vector".to_string(),
                "none".to_string(),
                "u8".to_string(),
                4,
            );
        }
        if extension.as_deref() == Some("avif") {
            return self.create_source_session(
                path,
                title,
                "avif".to_string(),
                mime_type_from_extension(Some("avif")),
                0,
                0,
                false,
                size_bytes,
                "source".to_string(),
                "none".to_string(),
                "u8".to_string(),
                3,
            );
        }
        if is_oiio_candidate(extension.as_deref()) {
            return Err(ImageKernelError::UnsupportedFormat(format!(
                "{} requires the OpenImageIO backend, but it is not available in this build",
                extension.unwrap_or_else(|| "unknown".to_string())
            )));
        }

        let reader = ImageReader::open(&path)
            .map_err(|error| ImageKernelError::Decode(error.to_string()))?
            .with_guessed_format()
            .map_err(|error| ImageKernelError::Decode(error.to_string()))?;
        let format = reader.format();
        let (width, height) = reader
            .into_dimensions()
            .map_err(|error| ImageKernelError::Decode(error.to_string()))?;
        let format_name = format
            .map(format_name)
            .unwrap_or_else(|| extension.clone().unwrap_or_else(|| "unknown".to_string()));
        let mime_type = format
            .map(format_mime_type)
            .unwrap_or_else(|| mime_type_from_extension(extension.as_deref()));

        if should_use_source_renderer(format, extension.as_deref()) {
            return self.create_source_session(
                path,
                title,
                format_name,
                mime_type,
                width,
                height,
                source_format_may_have_alpha(format, extension.as_deref()),
                size_bytes,
                "source".to_string(),
                "none".to_string(),
                "u8".to_string(),
                source_channel_count(format, extension.as_deref()),
            );
        }

        let reader = ImageReader::open(&path)
            .map_err(|error| ImageKernelError::Decode(error.to_string()))?
            .with_guessed_format()
            .map_err(|error| ImageKernelError::Decode(error.to_string()))?;
        let decoded = reader
            .decode()
            .map_err(|error| ImageKernelError::Decode(error.to_string()))?;
        let has_alpha = decoded.color().has_alpha();
        let rgba = Arc::new(decoded.into_rgba8());
        let session_id = self.next_session_id();
        let generation_id = self.next_generation_id(&session_id);
        let cache_id = cache_id_for_path(&path, size_bytes);
        let metadata = ImageViewerOpenResult {
            session_id: session_id.clone(),
            path: path.to_string_lossy().to_string(),
            title,
            format: format_name,
            mime_type,
            width,
            height,
            frame_count: 1,
            has_alpha,
            orientation: 1,
            color_space: "srgb".to_string(),
            size_bytes,
            tile_size: TILE_SIZE,
            levels: create_levels(width, height),
            native_tile_supported: true,
            source_url: String::new(),
            kernel: kernel_accel_name(),
            render_mode: "native-tiles".to_string(),
            cache_state: "memory".to_string(),
            cache_id,
            generation_id,
            sample_format: "u8".to_string(),
            channel_count: 4,
            has_internal_tiles: false,
            has_internal_mipmaps: false,
            import_progress: 1.0,
        };
        self.sessions
            .lock()
            .map_err(|_| ImageKernelError::LockPoisoned)?
            .insert(
                session_id,
                ImageSession {
                    metadata: metadata.clone(),
                    backend: ImageBackend::DecodedRgba(rgba),
                },
            );
        Ok(metadata)
    }

    pub fn read_tile(
        &self,
        session_id: &str,
        level: u32,
        tile_x: u32,
        tile_y: u32,
        generation_id: Option<&str>,
    ) -> Result<ImageViewerTileResponse> {
        let (metadata, backend) = {
            let sessions = self
                .sessions
                .lock()
                .map_err(|_| ImageKernelError::LockPoisoned)?;
            let session = sessions
                .get(session_id)
                .ok_or_else(|| ImageKernelError::MissingSession(session_id.to_string()))?;
            if session.metadata.native_tile_supported == false {
                return Err(ImageKernelError::NativeTileUnsupported);
            }
            if let Some(generation_id) = generation_id {
                if generation_id != session.metadata.generation_id {
                    return Err(ImageKernelError::StaleTileRequest);
                }
            }
            (session.metadata.clone(), session.backend.clone_for_read())
        };

        let scale = level_scale(level)?;
        let level_width = ceil_div(metadata.width, scale);
        let level_height = ceil_div(metadata.height, scale);
        let origin_x = tile_x
            .checked_mul(TILE_SIZE)
            .ok_or(ImageKernelError::InvalidTileRequest)?;
        let origin_y = tile_y
            .checked_mul(TILE_SIZE)
            .ok_or(ImageKernelError::InvalidTileRequest)?;
        if origin_x >= level_width || origin_y >= level_height {
            return Err(ImageKernelError::TileOutOfBounds);
        }
        let width = TILE_SIZE.min(level_width - origin_x);
        let height = TILE_SIZE.min(level_height - origin_y);
        let byte_len = width as usize * height as usize * 4;
        let mut out = vec![0u8; byte_len];

        match backend {
            ReadBackend::DecodedRgba(pixels) => unsafe {
                lyra_image_extract_rgba_tile(
                    pixels.as_raw().as_ptr(),
                    metadata.width,
                    metadata.height,
                    scale,
                    TILE_SIZE,
                    tile_x,
                    tile_y,
                    out.as_mut_ptr(),
                    width,
                    height,
                );
            },
            ReadBackend::Oiio(session) => {
                read_oiio_tile(&session, scale, tile_x, tile_y, width, height, &mut out)?;
            }
            ReadBackend::Tiff(session) => {
                read_tiff_tile(&session, scale, tile_x, tile_y, width, height, &mut out)?;
            }
        }

        Ok(ImageViewerTileResponse {
            width,
            height,
            stride: width * 4,
            pixel_format: "rgba8".to_string(),
            pixels: out,
        })
    }

    pub fn close_session(&self, session_id: &str) -> Result<bool> {
        Ok(self
            .sessions
            .lock()
            .map_err(|_| ImageKernelError::LockPoisoned)?
            .remove(session_id)
            .is_some())
    }

    fn try_open_oiio(
        &self,
        path: &Path,
        title: String,
        extension: Option<&str>,
        size_bytes: u64,
        storage_root: Option<&str>,
    ) -> Result<Option<ImageViewerOpenResult>> {
        if oiio_backend_available() == false {
            return Ok(None);
        }
        let Some(info) = probe_oiio(path)? else {
            return Ok(None);
        };
        if info.width == 0 || info.height == 0 {
            return Ok(None);
        }

        let session_id = self.next_session_id();
        let generation_id = self.next_generation_id(&session_id);
        let cache_id = cache_id_for_path(path, size_bytes);
        let levels = create_levels(info.width, info.height);
        let format = extension
            .map(|value| value.trim_start_matches('.').to_ascii_lowercase())
            .filter(|value| value.is_empty() == false)
            .unwrap_or_else(|| info.format_name);
        let metadata = ImageViewerOpenResult {
            session_id: session_id.clone(),
            path: path.to_string_lossy().to_string(),
            title,
            format: if format == "tif" {
                "tiff".to_string()
            } else {
                format
            },
            mime_type: mime_type_from_extension(extension),
            width: info.width,
            height: info.height,
            frame_count: 1,
            has_alpha: info.has_alpha,
            orientation: 1,
            color_space: if info.color_space.is_empty() {
                "srgb".to_string()
            } else {
                info.color_space
            },
            size_bytes,
            tile_size: TILE_SIZE,
            levels: levels.clone(),
            native_tile_supported: true,
            source_url: String::new(),
            kernel: format!("{}+oiio-imagecache", kernel_accel_name()),
            render_mode: "native-tiles".to_string(),
            cache_state: if info.has_internal_tiles || info.has_internal_mipmaps {
                "ready"
            } else {
                "metadata"
            }
            .to_string(),
            cache_id,
            generation_id,
            sample_format: sample_format_name(info.sample_format).to_string(),
            channel_count: info.channel_count,
            has_internal_tiles: info.has_internal_tiles,
            has_internal_mipmaps: info.has_internal_mipmaps,
            import_progress: 1.0,
        };

        if let Some(storage_root) = storage_root {
            let _ = write_cache_manifest(storage_root, &metadata, &levels);
        }
        let cache_root = storage_root.map(|root| cache_root_for(root, &metadata.cache_id));

        self.sessions
            .lock()
            .map_err(|_| ImageKernelError::LockPoisoned)?
            .insert(
                session_id,
                ImageSession {
                    metadata: metadata.clone(),
                    backend: ImageBackend::Oiio(OiioSession {
                        path: path.to_path_buf(),
                        width: info.width,
                        height: info.height,
                        cache_root,
                    }),
                },
            );
        Ok(Some(metadata))
    }

    fn open_tiff(
        &self,
        path: PathBuf,
        title: String,
        size_bytes: u64,
        storage_root: Option<&str>,
    ) -> Result<ImageViewerOpenResult> {
        let raw_layout = parse_tiff_layout(&path).ok();
        let tiff_meta = read_tiff_metadata(&path, raw_layout.as_ref())?;
        let session_id = self.next_session_id();
        let generation_id = self.next_generation_id(&session_id);
        let cache_id = cache_id_for_path(&path, size_bytes);
        let levels = create_levels(tiff_meta.width, tiff_meta.height);
        let cache_state = if libtiff_backend_available()
            || tiff_meta.has_internal_tiles
            || raw_layout_can_read_rows(raw_layout.as_ref())
        {
            "ready"
        } else {
            "importing"
        }
        .to_string();
        let kernel = if libtiff_backend_available() {
            format!("{}+libtiff-roi", kernel_accel_name())
        } else if tiff_meta.has_internal_tiles {
            format!("{}+tiff-chunks", kernel_accel_name())
        } else if raw_layout_can_read_rows(raw_layout.as_ref()) {
            format!("{}+tiff-row-roi", kernel_accel_name())
        } else {
            format!("{}+tiff-placeholder", kernel_accel_name())
        };
        let metadata = ImageViewerOpenResult {
            session_id: session_id.clone(),
            path: path.to_string_lossy().to_string(),
            title,
            format: "tiff".to_string(),
            mime_type: "image/tiff".to_string(),
            width: tiff_meta.width,
            height: tiff_meta.height,
            frame_count: tiff_meta.frame_count,
            has_alpha: tiff_meta.color.has_alpha,
            orientation: 1,
            color_space: "srgb".to_string(),
            size_bytes,
            tile_size: TILE_SIZE,
            levels: levels.clone(),
            native_tile_supported: true,
            source_url: String::new(),
            kernel,
            render_mode: "native-tiles".to_string(),
            cache_state,
            cache_id,
            generation_id,
            sample_format: sample_format_name(tiff_meta.color.sample_format).to_string(),
            channel_count: u32::from(tiff_meta.color.samples),
            has_internal_tiles: tiff_meta.has_internal_tiles,
            has_internal_mipmaps: tiff_meta.has_internal_mipmaps,
            import_progress: if libtiff_backend_available()
                || tiff_meta.has_internal_tiles
                || raw_layout_can_read_rows(raw_layout.as_ref())
            {
                1.0
            } else {
                0.0
            },
        };

        if let Some(storage_root) = storage_root {
            let _ = write_cache_manifest(storage_root, &metadata, &levels);
        }
        let cache_root = storage_root.map(|root| cache_root_for(root, &metadata.cache_id));

        let session = TiffSession {
            path,
            width: tiff_meta.width,
            height: tiff_meta.height,
            color_type: tiff_meta.color,
            chunk_type: tiff_meta.chunk_type,
            chunk_width: tiff_meta.chunk_width,
            chunk_height: tiff_meta.chunk_height,
            chunks_across: tiff_meta.chunks_across,
            raw_layout,
            cache_root,
        };
        self.sessions
            .lock()
            .map_err(|_| ImageKernelError::LockPoisoned)?
            .insert(
                session_id,
                ImageSession {
                    metadata: metadata.clone(),
                    backend: ImageBackend::Tiff(session),
                },
            );
        Ok(metadata)
    }

    fn create_source_session(
        &self,
        path: PathBuf,
        title: String,
        format: String,
        mime_type: String,
        width: u32,
        height: u32,
        has_alpha: bool,
        size_bytes: u64,
        render_mode: String,
        cache_state: String,
        sample_format: String,
        channel_count: u32,
    ) -> Result<ImageViewerOpenResult> {
        let session_id = self.next_session_id();
        let generation_id = self.next_generation_id(&session_id);
        let metadata = ImageViewerOpenResult {
            session_id: session_id.clone(),
            path: path.to_string_lossy().to_string(),
            title,
            format,
            mime_type,
            width,
            height,
            frame_count: 1,
            has_alpha,
            orientation: 1,
            color_space: "srgb".to_string(),
            size_bytes,
            tile_size: TILE_SIZE,
            levels: Vec::new(),
            native_tile_supported: false,
            source_url: String::new(),
            kernel: kernel_accel_name(),
            render_mode,
            cache_state,
            cache_id: String::new(),
            generation_id,
            sample_format,
            channel_count,
            has_internal_tiles: false,
            has_internal_mipmaps: false,
            import_progress: 1.0,
        };
        self.sessions
            .lock()
            .map_err(|_| ImageKernelError::LockPoisoned)?
            .insert(
                session_id,
                ImageSession {
                    metadata: metadata.clone(),
                    backend: ImageBackend::SourceOnly,
                },
            );
        Ok(metadata)
    }

    fn next_session_id(&self) -> String {
        let serial = self.serial.fetch_add(1, Ordering::Relaxed) + 1;
        let millis = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_millis())
            .unwrap_or(0);
        format!("image-session-{millis}-{serial}")
    }

    fn next_generation_id(&self, session_id: &str) -> String {
        format!("{session_id}-g{}", self.serial.load(Ordering::Relaxed))
    }
}

enum ReadBackend {
    DecodedRgba(Arc<RgbaImage>),
    Oiio(OiioSession),
    Tiff(TiffSession),
}

impl ImageBackend {
    fn clone_for_read(&self) -> ReadBackend {
        match self {
            ImageBackend::SourceOnly => ReadBackend::Tiff(TiffSession {
                path: PathBuf::new(),
                width: 0,
                height: 0,
                color_type: TiffDisplayColor {
                    samples: 4,
                    bit_depth: 8,
                    photometric: 2,
                    sample_format: 1,
                    has_alpha: true,
                },
                chunk_type: TiffChunkType::Strip,
                chunk_width: 0,
                chunk_height: 0,
                chunks_across: 0,
                raw_layout: None,
                cache_root: None,
            }),
            ImageBackend::DecodedRgba(pixels) => ReadBackend::DecodedRgba(pixels.clone()),
            ImageBackend::Oiio(session) => ReadBackend::Oiio(session.clone()),
            ImageBackend::Tiff(session) => ReadBackend::Tiff(session.clone()),
        }
    }
}

struct TiffMetadata {
    width: u32,
    height: u32,
    frame_count: u32,
    color: TiffDisplayColor,
    chunk_type: TiffChunkType,
    chunk_width: u32,
    chunk_height: u32,
    chunks_across: u32,
    has_internal_tiles: bool,
    has_internal_mipmaps: bool,
}

struct OiioProbe {
    width: u32,
    height: u32,
    channel_count: u32,
    has_alpha: bool,
    has_internal_tiles: bool,
    has_internal_mipmaps: bool,
    sample_format: u16,
    format_name: String,
    color_space: String,
}

#[cfg(lyra_image_oiio)]
fn oiio_backend_available() -> bool {
    unsafe { lyra_oiio_available() != 0 }
}

#[cfg(not(lyra_image_oiio))]
fn oiio_backend_available() -> bool {
    false
}

#[cfg(lyra_image_oiio)]
fn probe_oiio(path: &Path) -> Result<Option<OiioProbe>> {
    let raw_path = CString::new(path.to_string_lossy().as_bytes())
        .map_err(|error| ImageKernelError::Decode(error.to_string()))?;
    let mut info = LyraOiioImageInfo::default();
    let ok = unsafe { lyra_oiio_probe(raw_path.as_ptr(), &mut info) != 0 };
    if ok == false {
        let message = ffi_c_char_array_to_string(&info.error);
        return Err(ImageKernelError::Decode(message));
    }
    Ok(Some(OiioProbe {
        width: info.width,
        height: info.height,
        channel_count: info.channel_count.max(1),
        has_alpha: info.has_alpha != 0,
        has_internal_tiles: info.has_internal_tiles != 0,
        has_internal_mipmaps: info.has_internal_mipmaps != 0,
        sample_format: info.sample_format as u16,
        format_name: ffi_c_char_array_to_string(&info.format_name),
        color_space: ffi_c_char_array_to_string(&info.color_space),
    }))
}

#[cfg(not(lyra_image_oiio))]
fn probe_oiio(_path: &Path) -> Result<Option<OiioProbe>> {
    Ok(None)
}

#[cfg(lyra_image_oiio)]
fn read_oiio_tile(
    session: &OiioSession,
    scale: u32,
    tile_x: u32,
    tile_y: u32,
    width: u32,
    height: u32,
    out: &mut [u8],
) -> Result<()> {
    if read_cached_tile(
        session.cache_root.as_deref(),
        scale,
        tile_x,
        tile_y,
        width,
        height,
        out,
    ) {
        return Ok(());
    }
    let raw_path = CString::new(session.path.to_string_lossy().as_bytes())
        .map_err(|error| ImageKernelError::Decode(error.to_string()))?;
    let mut error = [0 as c_char; 512];
    let source_x = tile_x
        .checked_mul(TILE_SIZE)
        .and_then(|value| value.checked_mul(scale))
        .ok_or(ImageKernelError::InvalidTileRequest)?;
    let source_y = tile_y
        .checked_mul(TILE_SIZE)
        .and_then(|value| value.checked_mul(scale))
        .ok_or(ImageKernelError::InvalidTileRequest)?;
    let ok = unsafe {
        lyra_oiio_read_rgba_tile(
            raw_path.as_ptr(),
            source_x,
            source_y,
            scale,
            width,
            height,
            out.as_mut_ptr(),
            error.as_mut_ptr(),
            error.len(),
        ) != 0
    };
    if ok {
        write_cached_tile(session.cache_root.as_deref(), scale, tile_x, tile_y, out);
        return Ok(());
    }
    Err(ImageKernelError::Decode(ffi_c_char_array_to_string(&error)))
}

#[cfg(not(lyra_image_oiio))]
fn read_oiio_tile(
    session: &OiioSession,
    scale: u32,
    tile_x: u32,
    tile_y: u32,
    width: u32,
    height: u32,
    out: &mut [u8],
) -> Result<()> {
    fill_placeholder_tile(
        &TiffSession {
            path: PathBuf::new(),
            width: session.width,
            height: session.height,
            color_type: TiffDisplayColor {
                samples: 4,
                bit_depth: 8,
                photometric: 2,
                sample_format: 1,
                has_alpha: true,
            },
            chunk_type: TiffChunkType::Strip,
            chunk_width: TILE_SIZE,
            chunk_height: TILE_SIZE,
            chunks_across: ceil_div(session.width, TILE_SIZE),
            raw_layout: None,
            cache_root: None,
        },
        scale,
        tile_x,
        tile_y,
        width,
        height,
        out,
    );
    Ok(())
}

#[cfg(lyra_image_libtiff)]
fn libtiff_backend_available() -> bool {
    unsafe { lyra_libtiff_available() != 0 }
}

#[cfg(not(lyra_image_libtiff))]
fn libtiff_backend_available() -> bool {
    false
}

#[cfg(lyra_image_libtiff)]
fn read_libtiff_tile(
    session: &TiffSession,
    scale: u32,
    tile_x: u32,
    tile_y: u32,
    width: u32,
    height: u32,
    out: &mut [u8],
) -> Result<()> {
    let raw_path = CString::new(session.path.to_string_lossy().as_bytes())
        .map_err(|error| ImageKernelError::Decode(error.to_string()))?;
    let source_x = tile_x
        .checked_mul(TILE_SIZE)
        .and_then(|value| value.checked_mul(scale))
        .ok_or(ImageKernelError::InvalidTileRequest)?;
    let source_y = tile_y
        .checked_mul(TILE_SIZE)
        .and_then(|value| value.checked_mul(scale))
        .ok_or(ImageKernelError::InvalidTileRequest)?;
    let mut error = [0 as c_char; 512];
    let ok = unsafe {
        lyra_libtiff_read_rgba_tile(
            raw_path.as_ptr(),
            source_x,
            source_y,
            scale,
            width,
            height,
            out.as_mut_ptr(),
            error.as_mut_ptr(),
            error.len(),
        ) != 0
    };
    if ok {
        return Ok(());
    }
    Err(ImageKernelError::Decode(ffi_c_char_array_to_string(&error)))
}

#[cfg(not(lyra_image_libtiff))]
fn read_libtiff_tile(
    _session: &TiffSession,
    _scale: u32,
    _tile_x: u32,
    _tile_y: u32,
    _width: u32,
    _height: u32,
    _out: &mut [u8],
) -> Result<()> {
    Err(ImageKernelError::NativeTileUnsupported)
}

fn read_tiff_metadata(path: &Path, raw: Option<&RawTiffLayout>) -> Result<TiffMetadata> {
    if let Some(raw) = raw {
        let chunk_type = if raw.tile_offsets.is_empty() {
            TiffChunkType::Strip
        } else {
            TiffChunkType::Tile
        };
        let chunk_width = raw.tile_width.unwrap_or(raw.width).max(1);
        let chunk_height = raw
            .tile_length
            .or(raw.rows_per_strip)
            .unwrap_or(raw.height)
            .max(1);
        return Ok(TiffMetadata {
            width: raw.width,
            height: raw.height,
            frame_count: 1,
            color: TiffDisplayColor {
                samples: raw.samples_per_pixel,
                bit_depth: raw.bits_per_sample.first().copied().unwrap_or(8) as u8,
                photometric: raw.photometric,
                sample_format: raw.sample_format,
                has_alpha: raw.extra_samples.is_empty() == false
                    || raw.samples_per_pixel == 2
                    || raw.samples_per_pixel >= 4,
            },
            chunk_type,
            chunk_width,
            chunk_height,
            chunks_across: ceil_div(raw.width, chunk_width),
            has_internal_tiles: chunk_type == TiffChunkType::Tile,
            has_internal_mipmaps: false,
        });
    }

    let file = File::open(path).map_err(|error| ImageKernelError::Decode(error.to_string()))?;
    let mut decoder =
        TiffDecoder::new(file).map_err(|error| ImageKernelError::Decode(error.to_string()))?;
    let (width, height) = decoder
        .dimensions()
        .map_err(|error| ImageKernelError::Decode(error.to_string()))?;
    let color_type = decoder
        .colortype()
        .map_err(|error| ImageKernelError::Decode(error.to_string()))?;
    let chunk_dimensions = decoder.chunk_dimensions();
    let chunk_type = match decoder.get_chunk_type() {
        tiff::decoder::ChunkType::Tile => TiffChunkType::Tile,
        tiff::decoder::ChunkType::Strip => TiffChunkType::Strip,
    };
    Ok(TiffMetadata {
        width,
        height,
        frame_count: 1,
        color: display_color_from_tiff_color(color_type),
        chunk_type,
        chunk_width: chunk_dimensions.0.max(1),
        chunk_height: chunk_dimensions.1.max(1),
        chunks_across: ceil_div(width, chunk_dimensions.0.max(1)),
        has_internal_tiles: chunk_type == TiffChunkType::Tile,
        has_internal_mipmaps: false,
    })
}

fn read_tiff_tile(
    session: &TiffSession,
    scale: u32,
    tile_x: u32,
    tile_y: u32,
    width: u32,
    height: u32,
    out: &mut [u8],
) -> Result<()> {
    if read_cached_tile(
        session.cache_root.as_deref(),
        scale,
        tile_x,
        tile_y,
        width,
        height,
        out,
    ) {
        return Ok(());
    }
    if libtiff_backend_available() {
        if read_libtiff_tile(session, scale, tile_x, tile_y, width, height, out).is_ok() {
            write_cached_tile(session.cache_root.as_deref(), scale, tile_x, tile_y, out);
            return Ok(());
        }
    }
    if let Some(raw) = session.raw_layout.as_ref() {
        if raw_layout_can_read_rows(Some(raw)) {
            read_raw_tiff_rows(raw, scale, tile_x, tile_y, width, height, out)?;
            write_cached_tile(session.cache_root.as_deref(), scale, tile_x, tile_y, out);
            return Ok(());
        }
    }

    if session.chunk_width == 0 || session.chunk_height == 0 || session.chunks_across == 0 {
        fill_placeholder_tile(session, scale, tile_x, tile_y, width, height, out);
        return Ok(());
    }

    let estimated_chunk_bytes = u64::from(session.chunk_width)
        .saturating_mul(u64::from(session.chunk_height))
        .saturating_mul(u64::from(session.color_type.samples))
        .saturating_mul(u64::from(bytes_per_sample(session.color_type.bit_depth)));
    if estimated_chunk_bytes > MAX_CHUNK_DECODE_BYTES {
        fill_placeholder_tile(session, scale, tile_x, tile_y, width, height, out);
        return Ok(());
    }

    let estimated_decode_bytes = estimate_tiff_tile_decode_bytes(
        session,
        scale,
        tile_x,
        tile_y,
        width,
        height,
        estimated_chunk_bytes,
    );
    let _decode_permit = acquire_decode_memory(estimated_decode_bytes)?;
    match read_tiff_chunked_tile(session, scale, tile_x, tile_y, width, height, out) {
        Ok(()) => {
            write_cached_tile(session.cache_root.as_deref(), scale, tile_x, tile_y, out);
            Ok(())
        }
        Err(_) => {
            fill_placeholder_tile(session, scale, tile_x, tile_y, width, height, out);
            Ok(())
        }
    }
}

fn estimate_tiff_tile_decode_bytes(
    session: &TiffSession,
    scale: u32,
    tile_x: u32,
    tile_y: u32,
    width: u32,
    height: u32,
    chunk_bytes: u64,
) -> u64 {
    if chunk_bytes == 0 || session.chunk_width == 0 || session.chunk_height == 0 {
        return 1;
    }
    let image_origin_x = u64::from(tile_x) * u64::from(TILE_SIZE) * u64::from(scale);
    let image_origin_y = u64::from(tile_y) * u64::from(TILE_SIZE) * u64::from(scale);
    let image_end_x = image_origin_x
        .saturating_add(u64::from(width.saturating_sub(1)) * u64::from(scale))
        .min(u64::from(session.width.saturating_sub(1)));
    let image_end_y = image_origin_y
        .saturating_add(u64::from(height.saturating_sub(1)) * u64::from(scale))
        .min(u64::from(session.height.saturating_sub(1)));
    let chunks_y = image_end_y
        .saturating_div(u64::from(session.chunk_height))
        .saturating_sub(image_origin_y.saturating_div(u64::from(session.chunk_height)))
        .saturating_add(1);
    let chunks_x = match session.chunk_type {
        TiffChunkType::Strip => 1,
        TiffChunkType::Tile => image_end_x
            .saturating_div(u64::from(session.chunk_width))
            .saturating_sub(image_origin_x.saturating_div(u64::from(session.chunk_width)))
            .saturating_add(1),
    };
    chunk_bytes
        .saturating_mul(chunks_x.max(1))
        .saturating_mul(chunks_y.max(1))
}

fn read_tiff_chunked_tile(
    session: &TiffSession,
    scale: u32,
    tile_x: u32,
    tile_y: u32,
    width: u32,
    height: u32,
    out: &mut [u8],
) -> Result<()> {
    let file =
        File::open(&session.path).map_err(|error| ImageKernelError::Decode(error.to_string()))?;
    let mut decoder =
        TiffDecoder::new(file).map_err(|error| ImageKernelError::Decode(error.to_string()))?;
    let mut chunks: HashMap<u32, (u32, u32, DecodingResult)> = HashMap::new();
    let image_origin_x = u64::from(tile_x) * u64::from(TILE_SIZE) * u64::from(scale);
    let image_origin_y = u64::from(tile_y) * u64::from(TILE_SIZE) * u64::from(scale);

    for row in 0..height {
        let source_y = (image_origin_y + u64::from(row) * u64::from(scale))
            .min(u64::from(session.height.saturating_sub(1))) as u32;
        for column in 0..width {
            let source_x = (image_origin_x + u64::from(column) * u64::from(scale))
                .min(u64::from(session.width.saturating_sub(1))) as u32;
            let chunk_x = source_x / session.chunk_width;
            let chunk_y = source_y / session.chunk_height;
            let chunk_index = match session.chunk_type {
                TiffChunkType::Strip => chunk_y,
                TiffChunkType::Tile => chunk_y
                    .checked_mul(session.chunks_across)
                    .and_then(|value| value.checked_add(chunk_x))
                    .ok_or(ImageKernelError::InvalidTileRequest)?,
            };
            let entry = if let Some(entry) = chunks.get(&chunk_index) {
                entry
            } else {
                let data_dimensions = decoder.chunk_data_dimensions(chunk_index);
                let decoded = decoder
                    .read_chunk(chunk_index)
                    .map_err(|error| ImageKernelError::Decode(error.to_string()))?;
                chunks.insert(chunk_index, (data_dimensions.0, data_dimensions.1, decoded));
                chunks.get(&chunk_index).expect("inserted")
            };
            let local_x = source_x.saturating_sub(chunk_x * session.chunk_width);
            let local_y = source_y.saturating_sub(chunk_y * session.chunk_height);
            let rgba = sample_decoding_result(
                &entry.2,
                entry.0,
                entry.1,
                local_x,
                local_y,
                session.color_type,
            );
            write_rgba(out, width, column, row, rgba);
        }
    }
    Ok(())
}

fn read_raw_tiff_rows(
    raw: &RawTiffLayout,
    scale: u32,
    tile_x: u32,
    tile_y: u32,
    width: u32,
    height: u32,
    out: &mut [u8],
) -> Result<()> {
    let mut file =
        File::open(&raw.path).map_err(|error| ImageKernelError::Decode(error.to_string()))?;
    let bytes_per_sample =
        bytes_per_sample(raw.bits_per_sample.first().copied().unwrap_or(8) as u8);
    let samples = raw.samples_per_pixel.max(1);
    let row_bytes = u64::from(raw.width)
        .saturating_mul(u64::from(samples))
        .saturating_mul(u64::from(bytes_per_sample));
    if row_bytes == 0 || row_bytes > MAX_CHUNK_DECODE_BYTES {
        fill_raw_placeholder(raw, scale, tile_x, tile_y, width, height, out);
        return Ok(());
    }
    let _decode_permit = acquire_decode_memory(row_bytes)?;
    let mut row_buffer = vec![0u8; row_bytes as usize];
    let image_origin_x = u64::from(tile_x) * u64::from(TILE_SIZE) * u64::from(scale);
    let image_origin_y = u64::from(tile_y) * u64::from(TILE_SIZE) * u64::from(scale);
    let rows_per_strip = raw.rows_per_strip.unwrap_or(raw.height).max(1);

    for row in 0..height {
        let source_y = (image_origin_y + u64::from(row) * u64::from(scale))
            .min(u64::from(raw.height.saturating_sub(1))) as u32;
        let strip_index = (source_y / rows_per_strip) as usize;
        let Some(strip_offset) = raw.strip_offsets.get(strip_index).copied() else {
            continue;
        };
        let row_in_strip = u64::from(source_y % rows_per_strip);
        let offset = strip_offset.saturating_add(row_in_strip.saturating_mul(row_bytes));
        let strip_end = raw
            .strip_byte_counts
            .get(strip_index)
            .copied()
            .map(|count| strip_offset.saturating_add(count))
            .unwrap_or(u64::MAX);
        row_buffer.fill(0);
        if offset.saturating_add(row_bytes) <= strip_end {
            if file.seek(SeekFrom::Start(offset)).is_ok() {
                let _ = file.read_exact(&mut row_buffer);
            }
        }

        for column in 0..width {
            let source_x = (image_origin_x + u64::from(column) * u64::from(scale))
                .min(u64::from(raw.width.saturating_sub(1))) as u32;
            let rgba = sample_raw_row(&row_buffer, raw, source_x);
            write_rgba(out, width, column, row, rgba);
        }
    }
    Ok(())
}

fn sample_raw_row(row: &[u8], raw: &RawTiffLayout, source_x: u32) -> [u8; 4] {
    let bit_depth = raw.bits_per_sample.first().copied().unwrap_or(8) as u8;
    let bytes_per_sample = bytes_per_sample(bit_depth) as usize;
    let samples = usize::from(raw.samples_per_pixel.max(1));
    let index = source_x as usize * samples * bytes_per_sample;
    if index >= row.len() {
        return [0, 0, 0, 255];
    }
    let read_sample = |sample_index: usize| -> u8 {
        let offset = index + sample_index * bytes_per_sample;
        read_sample_as_u8(row, offset, bit_depth, raw.sample_format, raw.endian)
    };
    rgba_from_samples(
        read_sample,
        raw.samples_per_pixel,
        raw.photometric,
        raw.extra_samples.is_empty() == false,
    )
}

fn sample_decoding_result(
    result: &DecodingResult,
    width: u32,
    _height: u32,
    x: u32,
    y: u32,
    color: TiffDisplayColor,
) -> [u8; 4] {
    let samples = usize::from(color.samples.max(1));
    let index = (y as usize * width as usize + x as usize) * samples;
    match result {
        DecodingResult::U8(values) => rgba_from_samples(
            |sample| values.get(index + sample).copied().unwrap_or(0),
            color.samples,
            color.photometric,
            color.has_alpha,
        ),
        DecodingResult::U16(values) => rgba_from_samples(
            |sample| {
                values
                    .get(index + sample)
                    .map(|value| (value / 257) as u8)
                    .unwrap_or(0)
            },
            color.samples,
            color.photometric,
            color.has_alpha,
        ),
        DecodingResult::F32(values) => rgba_from_samples(
            |sample| {
                values
                    .get(index + sample)
                    .map(|value| (value.clamp(0.0, 1.0) * 255.0).round() as u8)
                    .unwrap_or(0)
            },
            color.samples,
            color.photometric,
            color.has_alpha,
        ),
        DecodingResult::F16(values) => rgba_from_samples(
            |sample| {
                values
                    .get(index + sample)
                    .map(|value| (f32::from(*value).clamp(0.0, 1.0) * 255.0).round() as u8)
                    .unwrap_or(0)
            },
            color.samples,
            color.photometric,
            color.has_alpha,
        ),
        _ => [0, 0, 0, 255],
    }
}

fn rgba_from_samples(
    read_sample: impl Fn(usize) -> u8,
    sample_count: u16,
    photometric: u16,
    has_alpha: bool,
) -> [u8; 4] {
    match sample_count {
        0 => [0, 0, 0, 255],
        1 => {
            let mut gray = read_sample(0);
            if photometric == 0 {
                gray = 255u8.saturating_sub(gray);
            }
            [gray, gray, gray, 255]
        }
        2 => {
            let mut gray = read_sample(0);
            if photometric == 0 {
                gray = 255u8.saturating_sub(gray);
            }
            [gray, gray, gray, read_sample(1)]
        }
        _ => {
            let alpha = if has_alpha && sample_count >= 4 {
                read_sample(3)
            } else {
                255
            };
            [read_sample(0), read_sample(1), read_sample(2), alpha]
        }
    }
}

fn read_sample_as_u8(
    row: &[u8],
    offset: usize,
    bit_depth: u8,
    sample_format: u16,
    endian: Endian,
) -> u8 {
    match (bit_depth, sample_format) {
        (8, _) => row.get(offset).copied().unwrap_or(0),
        (16, _) => {
            let Some(bytes) = row.get(offset..offset + 2) else {
                return 0;
            };
            let value = match endian {
                Endian::Little => u16::from_le_bytes([bytes[0], bytes[1]]),
                Endian::Big => u16::from_be_bytes([bytes[0], bytes[1]]),
            };
            (value / 257) as u8
        }
        (32, 3) => {
            let Some(bytes) = row.get(offset..offset + 4) else {
                return 0;
            };
            let value = match endian {
                Endian::Little => f32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]),
                Endian::Big => f32::from_be_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]),
            };
            (value.clamp(0.0, 1.0) * 255.0).round() as u8
        }
        _ => 0,
    }
}

fn write_rgba(out: &mut [u8], width: u32, x: u32, y: u32, rgba: [u8; 4]) {
    let offset = (y as usize * width as usize + x as usize) * 4;
    if let Some(target) = out.get_mut(offset..offset + 4) {
        target.copy_from_slice(&rgba);
    }
}

fn fill_placeholder_tile(
    session: &TiffSession,
    scale: u32,
    tile_x: u32,
    tile_y: u32,
    width: u32,
    height: u32,
    out: &mut [u8],
) {
    for row in 0..height {
        for column in 0..width {
            let sx = tile_x * TILE_SIZE * scale + column * scale;
            let sy = tile_y * TILE_SIZE * scale + row * scale;
            let shade = if ((sx / 64) + (sy / 64)) % 2 == 0 {
                42
            } else {
                64
            };
            let edge = sx == 0
                || sy == 0
                || sx >= session.width.saturating_sub(1)
                || sy >= session.height.saturating_sub(1);
            let rgba = if edge {
                [91, 120, 226, 255]
            } else {
                [shade, shade, shade, 255]
            };
            write_rgba(out, width, column, row, rgba);
        }
    }
}

fn fill_raw_placeholder(
    raw: &RawTiffLayout,
    scale: u32,
    tile_x: u32,
    tile_y: u32,
    width: u32,
    height: u32,
    out: &mut [u8],
) {
    let session = TiffSession {
        path: PathBuf::new(),
        width: raw.width,
        height: raw.height,
        color_type: TiffDisplayColor {
            samples: raw.samples_per_pixel,
            bit_depth: raw.bits_per_sample.first().copied().unwrap_or(8) as u8,
            photometric: raw.photometric,
            sample_format: raw.sample_format,
            has_alpha: raw.extra_samples.is_empty() == false,
        },
        chunk_type: TiffChunkType::Strip,
        chunk_width: raw.width,
        chunk_height: raw.rows_per_strip.unwrap_or(raw.height).max(1),
        chunks_across: 1,
        raw_layout: None,
        cache_root: None,
    };
    fill_placeholder_tile(&session, scale, tile_x, tile_y, width, height, out);
}

fn raw_layout_can_read_rows(raw: Option<&RawTiffLayout>) -> bool {
    raw.is_some_and(|layout| {
        layout.compression == 1
            && layout.planar_config == 1
            && layout.tile_offsets.is_empty()
            && layout.strip_offsets.is_empty() == false
            && layout
                .bits_per_sample
                .iter()
                .all(|bits| matches!(*bits, 8 | 16 | 32))
    })
}

fn display_color_from_tiff_color(color_type: TiffColorType) -> TiffDisplayColor {
    TiffDisplayColor {
        samples: color_type.num_samples(),
        bit_depth: color_type.bit_depth(),
        photometric: match color_type {
            TiffColorType::Gray(_) | TiffColorType::GrayA(_) => 1,
            _ => 2,
        },
        sample_format: match color_type {
            TiffColorType::Multiband { .. } => 1,
            _ => 1,
        },
        has_alpha: matches!(
            color_type,
            TiffColorType::GrayA(_) | TiffColorType::RGBA(_) | TiffColorType::CMYKA(_)
        ),
    }
}

fn bytes_per_sample(bit_depth: u8) -> u8 {
    match bit_depth {
        0..=8 => 1,
        9..=16 => 2,
        17..=32 => 4,
        _ => 8,
    }
}

fn sample_format_name(sample_format: u16) -> &'static str {
    match sample_format {
        2 => "i",
        3 => "f",
        _ => "u",
    }
}

fn parse_tiff_layout(path: &Path) -> std::result::Result<RawTiffLayout, String> {
    let mut file = File::open(path).map_err(|error| error.to_string())?;
    let mut header = [0u8; 16];
    file.read_exact(&mut header[0..8])
        .map_err(|error| error.to_string())?;
    let endian = match &header[0..2] {
        b"II" => Endian::Little,
        b"MM" => Endian::Big,
        _ => return Err("not a TIFF file".to_string()),
    };
    let magic = read_u16(&header[2..4], endian);
    let (big_tiff, ifd_offset) = if magic == 42 {
        (false, u64::from(read_u32(&header[4..8], endian)))
    } else if magic == 43 {
        file.read_exact(&mut header[8..16])
            .map_err(|error| error.to_string())?;
        let offset_size = read_u16(&header[4..6], endian);
        if offset_size != 8 {
            return Err("unsupported BigTIFF offset size".to_string());
        }
        (true, read_u64(&header[8..16], endian))
    } else {
        return Err("unsupported TIFF magic".to_string());
    };

    file.seek(SeekFrom::Start(ifd_offset))
        .map_err(|error| error.to_string())?;
    let entry_count = if big_tiff {
        let mut count = [0u8; 8];
        file.read_exact(&mut count)
            .map_err(|error| error.to_string())?;
        read_u64(&count, endian)
    } else {
        let mut count = [0u8; 2];
        file.read_exact(&mut count)
            .map_err(|error| error.to_string())?;
        u64::from(read_u16(&count, endian))
    };

    let mut entries: HashMap<u16, Vec<u64>> = HashMap::new();
    for _ in 0..entry_count {
        if big_tiff {
            let mut entry = [0u8; 20];
            file.read_exact(&mut entry)
                .map_err(|error| error.to_string())?;
            let tag = read_u16(&entry[0..2], endian);
            let field_type = read_u16(&entry[2..4], endian);
            let count = read_u64(&entry[4..12], endian);
            let value_or_offset = read_u64(&entry[12..20], endian);
            let values =
                read_tiff_values(&mut file, endian, true, field_type, count, value_or_offset)?;
            entries.insert(tag, values);
        } else {
            let mut entry = [0u8; 12];
            file.read_exact(&mut entry)
                .map_err(|error| error.to_string())?;
            let tag = read_u16(&entry[0..2], endian);
            let field_type = read_u16(&entry[2..4], endian);
            let count = u64::from(read_u32(&entry[4..8], endian));
            let value_or_offset = u64::from(read_u32(&entry[8..12], endian));
            let values =
                read_tiff_values(&mut file, endian, false, field_type, count, value_or_offset)?;
            entries.insert(tag, values);
        }
    }

    let width = tag_first(&entries, 256).ok_or("missing TIFF width")? as u32;
    let height = tag_first(&entries, 257).ok_or("missing TIFF height")? as u32;
    let samples_per_pixel = tag_first(&entries, 277).unwrap_or(1) as u16;
    let bits_per_sample = entries
        .get(&258)
        .cloned()
        .unwrap_or_else(|| vec![1])
        .into_iter()
        .map(|value| value as u16)
        .collect::<Vec<_>>();
    Ok(RawTiffLayout {
        path: path.to_path_buf(),
        endian,
        width,
        height,
        bits_per_sample,
        compression: tag_first(&entries, 259).unwrap_or(1) as u16,
        photometric: tag_first(&entries, 262).unwrap_or(1) as u16,
        strip_offsets: entries.get(&273).cloned().unwrap_or_default(),
        strip_byte_counts: entries.get(&279).cloned().unwrap_or_default(),
        rows_per_strip: tag_first(&entries, 278).map(|value| value as u32),
        samples_per_pixel,
        planar_config: tag_first(&entries, 284).unwrap_or(1) as u16,
        tile_width: tag_first(&entries, 322).map(|value| value as u32),
        tile_length: tag_first(&entries, 323).map(|value| value as u32),
        tile_offsets: entries.get(&324).cloned().unwrap_or_default(),
        _tile_byte_counts: entries.get(&325).cloned().unwrap_or_default(),
        sample_format: tag_first(&entries, 339).unwrap_or(1) as u16,
        extra_samples: entries
            .get(&338)
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .map(|value| value as u16)
            .collect(),
    })
}

fn read_tiff_values(
    file: &mut File,
    endian: Endian,
    big_tiff: bool,
    field_type: u16,
    count: u64,
    value_or_offset: u64,
) -> std::result::Result<Vec<u64>, String> {
    let type_size =
        tiff_type_size(field_type).ok_or_else(|| format!("unsupported TIFF type {field_type}"))?;
    let byte_count = type_size
        .checked_mul(count)
        .ok_or_else(|| "TIFF tag byte count overflow".to_string())?;
    let inline_bytes = if big_tiff { 8 } else { 4 };
    let mut data = vec![0u8; byte_count as usize];
    if byte_count <= inline_bytes {
        let source = if big_tiff {
            value_or_offset.to_ne_bytes().to_vec()
        } else {
            (value_or_offset as u32).to_ne_bytes().to_vec()
        };
        let ordered = match endian {
            Endian::Little => source,
            Endian::Big => {
                let mut source = source;
                source.reverse();
                source
            }
        };
        data[..byte_count as usize].copy_from_slice(&ordered[..byte_count as usize]);
    } else {
        let previous = file.stream_position().map_err(|error| error.to_string())?;
        file.seek(SeekFrom::Start(value_or_offset))
            .map_err(|error| error.to_string())?;
        file.read_exact(&mut data)
            .map_err(|error| error.to_string())?;
        file.seek(SeekFrom::Start(previous))
            .map_err(|error| error.to_string())?;
    }
    let mut values = Vec::with_capacity(count as usize);
    for index in 0..count as usize {
        let offset = index * type_size as usize;
        let value = match field_type {
            1 | 2 | 6 | 7 => data[offset] as u64,
            3 | 8 => u64::from(read_u16(&data[offset..offset + 2], endian)),
            4 | 9 | 13 => u64::from(read_u32(&data[offset..offset + 4], endian)),
            16 | 17 | 18 => read_u64(&data[offset..offset + 8], endian),
            _ => 0,
        };
        values.push(value);
    }
    Ok(values)
}

fn tiff_type_size(field_type: u16) -> Option<u64> {
    match field_type {
        1 | 2 | 6 | 7 => Some(1),
        3 | 8 => Some(2),
        4 | 9 | 11 | 13 => Some(4),
        5 | 10 | 12 | 16 | 17 | 18 => Some(8),
        _ => None,
    }
}

fn tag_first(entries: &HashMap<u16, Vec<u64>>, tag: u16) -> Option<u64> {
    entries.get(&tag).and_then(|values| values.first().copied())
}

fn read_u16(bytes: &[u8], endian: Endian) -> u16 {
    match endian {
        Endian::Little => u16::from_le_bytes([bytes[0], bytes[1]]),
        Endian::Big => u16::from_be_bytes([bytes[0], bytes[1]]),
    }
}

fn read_u32(bytes: &[u8], endian: Endian) -> u32 {
    match endian {
        Endian::Little => u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]),
        Endian::Big => u32::from_be_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]),
    }
}

fn read_u64(bytes: &[u8], endian: Endian) -> u64 {
    match endian {
        Endian::Little => u64::from_le_bytes([
            bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5], bytes[6], bytes[7],
        ]),
        Endian::Big => u64::from_be_bytes([
            bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5], bytes[6], bytes[7],
        ]),
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CacheManifest<'a> {
    source_path: &'a str,
    cache_id: &'a str,
    width: u32,
    height: u32,
    size_bytes: u64,
    tile_size: u32,
    levels: &'a [ImageViewerLevel],
    kernel: &'a str,
    generated_at_unix_ms: u128,
}

fn write_cache_manifest(
    storage_root: &str,
    metadata: &ImageViewerOpenResult,
    levels: &[ImageViewerLevel],
) -> Result<()> {
    let cache_root = Path::new(storage_root)
        .join("cache")
        .join(&metadata.cache_id);
    fs::create_dir_all(&cache_root).map_err(|error| ImageKernelError::Cache(error.to_string()))?;
    let manifest = CacheManifest {
        source_path: &metadata.path,
        cache_id: &metadata.cache_id,
        width: metadata.width,
        height: metadata.height,
        size_bytes: metadata.size_bytes,
        tile_size: metadata.tile_size,
        levels,
        kernel: &metadata.kernel,
        generated_at_unix_ms: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_millis())
            .unwrap_or(0),
    };
    let json = serde_json::to_vec_pretty(&manifest)
        .map_err(|error| ImageKernelError::Cache(error.to_string()))?;
    fs::write(cache_root.join("manifest.json"), json)
        .map_err(|error| ImageKernelError::Cache(error.to_string()))?;
    Ok(())
}

fn cache_root_for(storage_root: &str, cache_id: &str) -> PathBuf {
    Path::new(storage_root).join("cache").join(cache_id)
}

fn tile_cache_path(cache_root: &Path, scale: u32, tile_x: u32, tile_y: u32) -> PathBuf {
    cache_root
        .join("tiles")
        .join(format!("s{scale}"))
        .join(format!("{tile_x}_{tile_y}.rgba8"))
}

fn read_cached_tile(
    cache_root: Option<&Path>,
    scale: u32,
    tile_x: u32,
    tile_y: u32,
    width: u32,
    height: u32,
    out: &mut [u8],
) -> bool {
    let Some(cache_root) = cache_root else {
        return false;
    };
    let path = tile_cache_path(cache_root, scale, tile_x, tile_y);
    let expected_len = width as usize * height as usize * 4;
    if expected_len != out.len() {
        return false;
    }
    let Ok(bytes) = fs::read(path) else {
        return false;
    };
    if bytes.len() != expected_len {
        return false;
    }
    out.copy_from_slice(&bytes);
    true
}

fn write_cached_tile(
    cache_root: Option<&Path>,
    scale: u32,
    tile_x: u32,
    tile_y: u32,
    pixels: &[u8],
) {
    let Some(cache_root) = cache_root else {
        return;
    };
    let path = tile_cache_path(cache_root, scale, tile_x, tile_y);
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let _ = fs::write(path, pixels);
}

fn cache_id_for_path(path: &Path, size_bytes: u64) -> String {
    let mut hasher = Sha256::new();
    hasher.update(path.to_string_lossy().as_bytes());
    hasher.update(size_bytes.to_le_bytes());
    if let Ok(metadata) = fs::metadata(path) {
        if let Ok(modified) = metadata.modified() {
            if let Ok(duration) = modified.duration_since(UNIX_EPOCH) {
                hasher.update(duration.as_secs().to_le_bytes());
                hasher.update(duration.subsec_nanos().to_le_bytes());
            }
        }
    }
    if let Ok(mut file) = File::open(path) {
        let mut buffer = vec![0u8; 64 * 1024];
        if let Ok(read) = file.read(&mut buffer) {
            hasher.update(&buffer[..read]);
        }
        if size_bytes > 64 * 1024 {
            let _ = file.seek(SeekFrom::Start(size_bytes.saturating_sub(64 * 1024)));
            if let Ok(read) = file.read(&mut buffer) {
                hasher.update(&buffer[..read]);
            }
        }
    }
    let digest = hasher.finalize();
    digest[..16]
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn normalize_path(raw_path: &str) -> Result<PathBuf> {
    let trimmed = raw_path.trim();
    if trimmed.is_empty() {
        return Err(ImageKernelError::EmptyPath);
    }
    Ok(PathBuf::from(trimmed))
}

fn title_from_path(path: &Path) -> String {
    if let Some(value) = path
        .file_name()
        .and_then(|value| value.to_str())
        .filter(|value| value.is_empty() == false)
    {
        return value.to_string();
    }
    path.to_string_lossy().to_string()
}

fn extension_from_path(path: &Path) -> Option<String> {
    path.extension()
        .and_then(|value| value.to_str())
        .map(|value| value.trim_start_matches('.').to_ascii_lowercase())
        .filter(|value| value.is_empty() == false)
}

fn create_levels(width: u32, height: u32) -> Vec<ImageViewerLevel> {
    let mut levels = Vec::new();
    let mut level = 0;
    loop {
        let scale = 1u32 << level;
        levels.push(ImageViewerLevel {
            level,
            width: ceil_div(width, scale),
            height: ceil_div(height, scale),
            scale: f64::from(scale),
        });
        if level >= MAX_LEVEL
            || (ceil_div(width, scale) <= TILE_SIZE && ceil_div(height, scale) <= TILE_SIZE)
        {
            break;
        }
        level += 1;
    }
    levels
}

fn level_scale(level: u32) -> Result<u32> {
    if level > MAX_LEVEL {
        return Err(ImageKernelError::InvalidTileRequest);
    }
    Ok(1u32 << level)
}

fn ceil_div(value: u32, divisor: u32) -> u32 {
    if divisor == 0 {
        return value;
    }
    value.div_ceil(divisor)
}

fn format_name(format: ImageFormat) -> String {
    match format {
        ImageFormat::Png => "png",
        ImageFormat::Jpeg => "jpeg",
        ImageFormat::Gif => "gif",
        ImageFormat::WebP => "webp",
        ImageFormat::Bmp => "bmp",
        ImageFormat::Ico => "ico",
        ImageFormat::Tiff => "tiff",
        _ => "unknown",
    }
    .to_string()
}

fn format_mime_type(format: ImageFormat) -> String {
    match format {
        ImageFormat::Png => "image/png",
        ImageFormat::Jpeg => "image/jpeg",
        ImageFormat::Gif => "image/gif",
        ImageFormat::WebP => "image/webp",
        ImageFormat::Bmp => "image/bmp",
        ImageFormat::Ico => "image/x-icon",
        ImageFormat::Tiff => "image/tiff",
        _ => "application/octet-stream",
    }
    .to_string()
}

fn should_use_source_renderer(format: Option<ImageFormat>, extension: Option<&str>) -> bool {
    match format {
        Some(
            ImageFormat::Png
            | ImageFormat::Jpeg
            | ImageFormat::Gif
            | ImageFormat::WebP
            | ImageFormat::Bmp
            | ImageFormat::Ico,
        ) => true,
        _ => matches!(
            extension.unwrap_or_default(),
            "png" | "jpg" | "jpeg" | "gif" | "webp" | "bmp" | "ico" | "avif" | "svg"
        ),
    }
}

fn source_format_may_have_alpha(format: Option<ImageFormat>, extension: Option<&str>) -> bool {
    match format {
        Some(
            ImageFormat::Png
            | ImageFormat::Gif
            | ImageFormat::WebP
            | ImageFormat::Bmp
            | ImageFormat::Ico,
        ) => true,
        _ => matches!(
            extension.unwrap_or_default(),
            "png" | "gif" | "webp" | "bmp" | "ico" | "svg" | "avif"
        ),
    }
}

fn source_channel_count(format: Option<ImageFormat>, extension: Option<&str>) -> u32 {
    if source_format_may_have_alpha(format, extension) {
        4
    } else {
        3
    }
}

fn mime_type_from_extension(extension: Option<&str>) -> String {
    match extension.unwrap_or_default() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "ico" => "image/x-icon",
        "tiff" | "tif" => "image/tiff",
        "svg" => "image/svg+xml",
        "avif" => "image/avif",
        "heic" | "heif" => "image/heif",
        "jxl" => "image/jxl",
        "exr" => "image/x-exr",
        "dpx" => "image/x-dpx",
        "psd" | "psb" => "image/vnd.adobe.photoshop",
        _ => "application/octet-stream",
    }
    .to_string()
}

fn is_oiio_candidate(extension: Option<&str>) -> bool {
    matches!(
        extension.unwrap_or_default(),
        "heic"
            | "heif"
            | "jxl"
            | "exr"
            | "hdr"
            | "dpx"
            | "cin"
            | "dds"
            | "tga"
            | "psd"
            | "psb"
            | "fits"
            | "fit"
            | "dicom"
            | "dcm"
            | "cr2"
            | "nef"
            | "arw"
            | "dng"
            | "orf"
            | "raf"
            | "rw2"
    )
}

fn kernel_accel_name() -> String {
    unsafe {
        let ptr = lyra_image_tile_kernel_accel_name();
        if ptr.is_null() {
            return "portable-cpp".to_string();
        }
        CStr::from_ptr(ptr).to_string_lossy().to_string()
    }
}

#[cfg(any(lyra_image_oiio, lyra_image_libtiff))]
fn ffi_c_char_array_to_string(value: &[c_char]) -> String {
    if value.is_empty() {
        return String::new();
    }
    unsafe { CStr::from_ptr(value.as_ptr()) }
        .to_string_lossy()
        .trim()
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decode_memory_permit_releases_reserved_bytes() {
        let gate = DecodeMemoryGate {
            used: Mutex::new(0),
            available: Condvar::new(),
        };
        {
            let _permit = acquire_decode_memory_from_gate(&gate, 4_096).expect("permit");
            assert_eq!(*gate.used.lock().expect("lock"), 4_096);
        }
        assert_eq!(*gate.used.lock().expect("lock"), 0);
    }

    #[test]
    fn opens_png_as_source_renderer_without_native_decode() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("sample.png");
        let mut image = RgbaImage::new(2, 2);
        image.put_pixel(0, 0, image::Rgba([1, 2, 3, 255]));
        image.put_pixel(1, 0, image::Rgba([4, 5, 6, 255]));
        image.put_pixel(0, 1, image::Rgba([7, 8, 9, 255]));
        image.put_pixel(1, 1, image::Rgba([10, 11, 12, 255]));
        image.save(&path).expect("save png");

        let kernel = ImageKernel::new();
        let opened = kernel
            .open_image(path.to_str().expect("path"))
            .expect("open");
        assert_eq!(opened.width, 2);
        assert_eq!(opened.height, 2);
        assert_eq!(opened.render_mode, "source");
        assert!(!opened.native_tile_supported);
        assert!(kernel.read_tile(&opened.session_id, 0, 0, 0, None).is_err());
    }

    #[test]
    fn opens_tiff_and_reads_native_tile_without_full_image_limit() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("sample.tiff");
        write_minimal_rgb_tiff_with_pixels(&path, 2, 2, &[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);

        let kernel = ImageKernel::new();
        let opened = kernel
            .open_image(path.to_str().expect("path"))
            .expect("open");
        assert_eq!(opened.width, 2);
        assert_eq!(opened.height, 2);
        assert!(opened.native_tile_supported);
        assert_eq!(opened.render_mode, "native-tiles");

        let tile = kernel
            .read_tile(&opened.session_id, 0, 0, 0, Some(&opened.generation_id))
            .expect("tile");
        assert_eq!(tile.width, 2);
        assert_eq!(tile.height, 2);
        assert_eq!(&tile.pixels[0..4], &[1, 2, 3, 255]);
        assert_eq!(&tile.pixels[4..8], &[4, 5, 6, 255]);
    }

    #[test]
    fn oversized_tiff_opens_with_native_tiles_and_placeholder_if_data_missing() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("huge.tiff");
        write_minimal_rgb_tiff_with_pixels(&path, 40_000, 12_788, &[]);

        let kernel = ImageKernel::new();
        let opened = kernel
            .open_image(path.to_str().expect("path"))
            .expect("open");
        assert_eq!(opened.width, 40_000);
        assert_eq!(opened.height, 12_788);
        assert_eq!(opened.format, "tiff");
        assert!(opened.native_tile_supported);
        assert_eq!(opened.render_mode, "native-tiles");
        assert!(!opened.levels.is_empty());

        let tile = kernel
            .read_tile(&opened.session_id, 0, 0, 0, Some(&opened.generation_id))
            .expect("tile");
        assert_eq!(tile.width, 512);
        assert_eq!(tile.height, 512);
    }

    #[test]
    fn stale_generation_tile_request_is_rejected() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("sample.tiff");
        write_minimal_rgb_tiff_with_pixels(&path, 1, 1, &[9, 8, 7]);

        let kernel = ImageKernel::new();
        let opened = kernel
            .open_image(path.to_str().expect("path"))
            .expect("open");
        let error = kernel
            .read_tile(&opened.session_id, 0, 0, 0, Some("old-generation"))
            .expect_err("stale request");
        assert!(matches!(error, ImageKernelError::StaleTileRequest));
    }

    #[test]
    fn source_only_svg_has_no_native_tiles() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("sample.svg");
        fs::write(&path, "<svg xmlns=\"http://www.w3.org/2000/svg\"/>").expect("write svg");

        let kernel = ImageKernel::new();
        let opened = kernel
            .open_image(path.to_str().expect("path"))
            .expect("open");
        assert_eq!(opened.format, "svg");
        assert!(!opened.native_tile_supported);
        assert!(kernel.read_tile(&opened.session_id, 0, 0, 0, None).is_err());
    }

    #[test]
    fn unsupported_oiio_codec_returns_controlled_error_when_oiio_is_absent() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("sample.heic");
        fs::write(&path, b"not-a-real-heic").expect("write heic");

        let kernel = ImageKernel::new();
        let error = kernel
            .open_image(path.to_str().expect("path"))
            .expect_err("unsupported");
        assert!(matches!(error, ImageKernelError::UnsupportedFormat(_)));
    }

    #[test]
    fn open_with_storage_writes_cache_manifest_under_image_viewer_cache() {
        let dir = tempfile::tempdir().expect("tempdir");
        let storage = tempfile::tempdir().expect("storage");
        let path = dir.path().join("sample.tiff");
        write_minimal_rgb_tiff_with_pixels(&path, 2, 1, &[1, 2, 3, 4, 5, 6]);

        let kernel = ImageKernel::new();
        let opened = kernel
            .open_image_with_storage(
                path.to_str().expect("path"),
                Some(storage.path().to_str().expect("storage")),
            )
            .expect("open");

        let manifest = storage
            .path()
            .join("cache")
            .join(&opened.cache_id)
            .join("manifest.json");
        assert!(manifest.exists());
        let contents = fs::read_to_string(manifest).expect("read manifest");
        assert!(contents.contains("\"tileSize\": 512"));
        assert!(contents.contains(&opened.cache_id));

        let tile = kernel
            .read_tile(&opened.session_id, 0, 0, 0, Some(&opened.generation_id))
            .expect("tile");
        let cached_tile = storage
            .path()
            .join("cache")
            .join(&opened.cache_id)
            .join("tiles")
            .join("s1")
            .join("0_0.rgba8");
        assert!(cached_tile.exists());
        assert_eq!(
            fs::read(cached_tile).expect("read tile").len(),
            tile.pixels.len()
        );
    }

    #[test]
    fn opens_webp_content_with_misleading_jpeg_extension() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("mislabeled.jpg");
        let mut image = RgbaImage::new(2, 1);
        image.put_pixel(0, 0, image::Rgba([12, 34, 56, 255]));
        image.put_pixel(1, 0, image::Rgba([78, 90, 123, 255]));
        image
            .save_with_format(&path, ImageFormat::WebP)
            .expect("save webp with jpg extension");

        let kernel = ImageKernel::new();
        let opened = kernel
            .open_image(path.to_str().expect("path"))
            .expect("open");
        assert_eq!(opened.format, "webp");
        assert_eq!(opened.mime_type, "image/webp");
        assert_eq!(opened.width, 2);
        assert_eq!(opened.height, 1);
        assert!(!opened.native_tile_supported);
    }

    fn write_minimal_rgb_tiff_with_pixels(path: &Path, width: u32, height: u32, pixels: &[u8]) {
        const ENTRY_COUNT: u16 = 10;
        const IFD_OFFSET: u32 = 8;
        const IFD_BYTES: u32 = 2 + (ENTRY_COUNT as u32) * 12 + 4;
        const BITS_OFFSET: u32 = IFD_OFFSET + IFD_BYTES;
        const STRIP_OFFSET: u32 = BITS_OFFSET + 6;
        let byte_count = width.saturating_mul(height).saturating_mul(3);
        let mut bytes = Vec::new();
        bytes.extend_from_slice(b"II");
        bytes.extend_from_slice(&42u16.to_le_bytes());
        bytes.extend_from_slice(&IFD_OFFSET.to_le_bytes());
        bytes.extend_from_slice(&ENTRY_COUNT.to_le_bytes());

        write_tiff_entry(&mut bytes, 256, 4, 1, width);
        write_tiff_entry(&mut bytes, 257, 4, 1, height);
        write_tiff_entry(&mut bytes, 258, 3, 3, BITS_OFFSET);
        write_tiff_entry(&mut bytes, 259, 3, 1, 1);
        write_tiff_entry(&mut bytes, 262, 3, 1, 2);
        write_tiff_entry(&mut bytes, 273, 4, 1, STRIP_OFFSET);
        write_tiff_entry(&mut bytes, 277, 3, 1, 3);
        write_tiff_entry(&mut bytes, 278, 4, 1, height);
        write_tiff_entry(&mut bytes, 279, 4, 1, byte_count);
        write_tiff_entry(&mut bytes, 284, 3, 1, 1);
        bytes.extend_from_slice(&0u32.to_le_bytes());
        bytes.extend_from_slice(&8u16.to_le_bytes());
        bytes.extend_from_slice(&8u16.to_le_bytes());
        bytes.extend_from_slice(&8u16.to_le_bytes());
        bytes.extend_from_slice(pixels);
        fs::write(path, bytes).expect("write minimal tiff");
    }

    fn write_tiff_entry(bytes: &mut Vec<u8>, tag: u16, field_type: u16, count: u32, value: u32) {
        bytes.extend_from_slice(&tag.to_le_bytes());
        bytes.extend_from_slice(&field_type.to_le_bytes());
        bytes.extend_from_slice(&count.to_le_bytes());
        if field_type == 3 && count == 1 {
            bytes.extend_from_slice(&(value as u16).to_le_bytes());
            bytes.extend_from_slice(&0u16.to_le_bytes());
        } else {
            bytes.extend_from_slice(&value.to_le_bytes());
        }
    }
}
