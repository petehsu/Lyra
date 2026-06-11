use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::Path;
use std::time::{Duration, Instant};

use reqwest::blocking::Client;
use sha1::{Digest as Sha1Digest, Sha1};
use sha2::Sha256;

use crate::model::{
    DownloadPlanRequest, DownloadPlanResponse, DownloadProtocol, DownloadSegmentPlan, DownloadTask,
    DownloadTaskBackend,
};

const UNKNOWN_END: u64 = u64::MAX;
const DEFAULT_MIN_SEGMENT_BYTES: u64 = 2 * 1024 * 1024;
const MAX_NATIVE_SEGMENTS: usize = 32;

#[repr(C)]
#[derive(Clone, Copy, Debug)]
struct NativeSegment {
    index: u32,
    start: u64,
    end_inclusive: u64,
}

unsafe extern "C" {
    fn lyra_download_scheme_code(url: *const std::ffi::c_char, len: usize) -> u8;

    fn lyra_download_plan_segments(
        total_bytes: u64,
        requested_connections: u32,
        min_segment_bytes: u64,
        out_segments: *mut NativeSegment,
        out_len: usize,
    ) -> usize;
}

pub fn classify_download_protocol(url: &str) -> DownloadProtocol {
    let bytes = url.as_bytes();
    let code = unsafe { lyra_download_scheme_code(bytes.as_ptr().cast(), bytes.len()) };
    match code {
        1 => DownloadProtocol::Http,
        2 => DownloadProtocol::Https,
        3 => DownloadProtocol::Ftp,
        4 => DownloadProtocol::Ftps,
        5 => DownloadProtocol::Sftp,
        6 => DownloadProtocol::Webdav,
        7 => DownloadProtocol::Webdavs,
        8 => DownloadProtocol::Magnet,
        _ => DownloadProtocol::Unknown,
    }
}

fn plan_native_segments(
    total_bytes: u64,
    requested_connections: u32,
    min_segment_bytes: u64,
) -> Vec<NativeSegment> {
    let mut segments = vec![
        NativeSegment {
            index: 0,
            start: 0,
            end_inclusive: 0,
        };
        MAX_NATIVE_SEGMENTS
    ];
    let written = unsafe {
        lyra_download_plan_segments(
            total_bytes,
            requested_connections,
            min_segment_bytes,
            segments.as_mut_ptr(),
            segments.len(),
        )
    };
    segments.truncate(written.min(MAX_NATIVE_SEGMENTS));
    segments
}

pub fn plan_download(request: &DownloadPlanRequest) -> DownloadPlanResponse {
    let min_segment_bytes = request
        .min_segment_bytes
        .unwrap_or(DEFAULT_MIN_SEGMENT_BYTES);
    let native_segments = plan_native_segments(
        request.total_bytes,
        request.requested_connections,
        min_segment_bytes,
    );
    let segments = native_segments
        .into_iter()
        .map(|segment| {
            let known_end = segment.end_inclusive != UNKNOWN_END;
            let size_bytes = if known_end {
                Some(
                    segment
                        .end_inclusive
                        .saturating_sub(segment.start)
                        .saturating_add(1),
                )
            } else {
                None
            };
            let existing_bytes = request
                .existing_part_lengths
                .get(segment.index as usize)
                .copied()
                .unwrap_or(0)
                .min(size_bytes.unwrap_or(u64::MAX));
            let next_start = segment.start.saturating_add(existing_bytes);
            let complete = known_end && next_start > segment.end_inclusive;
            DownloadSegmentPlan {
                index: segment.index,
                start: segment.start,
                end_inclusive: if known_end {
                    Some(segment.end_inclusive)
                } else {
                    None
                },
                next_start,
                size_bytes,
                existing_bytes,
                complete,
            }
        })
        .collect::<Vec<_>>();

    DownloadPlanResponse {
        protocol: classify_download_protocol(&request.url),
        resumable: request.total_bytes > 0
            && segments.iter().any(|segment| segment.existing_bytes > 0),
        connections: segments.len() as u32,
        segments,
    }
}

pub(crate) struct HttpDownloadProgress {
    pub(crate) received: u64,
    pub(crate) total: u64,
    pub(crate) speed: u64,
}

pub(crate) struct HttpDownloadComplete {
    pub(crate) received: u64,
    pub(crate) total: u64,
}

pub(crate) fn download_http(
    task: &DownloadTask,
    mut should_continue: impl FnMut() -> bool,
    mut on_progress: impl FnMut(HttpDownloadProgress),
) -> Result<Option<HttpDownloadComplete>, String> {
    let client = Client::builder()
        .redirect(reqwest::redirect::Policy::limited(8))
        .build()
        .map_err(|error| error.to_string())?;
    if let Some(parent) = Path::new(&task.save_path).parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let mut request = client.get(&task.url);
    if let Some(headers) = task.request_headers.as_ref() {
        for (name, value) in headers {
            request = request.header(name, value);
        }
    }
    let mut response = request.send().map_err(|error| error.to_string())?;
    if !response.status().is_success() {
        return Err(format!("server returned {}", response.status()));
    }
    let total = response.content_length().unwrap_or(0);
    let mut file = File::create(&task.save_path).map_err(|error| error.to_string())?;
    let mut received = 0_u64;
    let mut buffer = [0_u8; 64 * 1024];
    let mut last_emit = Instant::now();
    let mut last_bytes = 0_u64;
    loop {
        if !should_continue() {
            return Ok(None);
        }
        let read = response
            .read(&mut buffer)
            .map_err(|error| error.to_string())?;
        if read == 0 {
            break;
        }
        file.write_all(&buffer[..read])
            .map_err(|error| error.to_string())?;
        received += read as u64;
        if last_emit.elapsed() >= Duration::from_millis(250) {
            let elapsed = last_emit.elapsed().as_secs_f64().max(0.001);
            let speed = ((received - last_bytes) as f64 / elapsed).round() as u64;
            on_progress(HttpDownloadProgress {
                received,
                total,
                speed,
            });
            last_emit = Instant::now();
            last_bytes = received;
        }
    }
    Ok(Some(HttpDownloadComplete { received, total }))
}

pub(crate) fn parse_protocol(url: &str) -> String {
    url::Url::parse(url)
        .map(|parsed| parsed.scheme().to_string())
        .unwrap_or_else(|_| "unknown".to_string())
}

pub(crate) fn is_native_http_url(url: &str) -> bool {
    matches!(
        url::Url::parse(url).map(|parsed| parsed.scheme().to_string()),
        Ok(protocol) if matches!(protocol.as_str(), "http" | "https" | "webdav" | "webdavs")
    )
}

pub(crate) fn is_curl_url(url: &str) -> bool {
    matches!(
        url::Url::parse(url).map(|parsed| parsed.scheme().to_string()),
        Ok(protocol) if matches!(protocol.as_str(), "ftp" | "ftps" | "sftp")
    )
}

pub(crate) fn is_aria2_url(url: &str) -> bool {
    url.to_ascii_lowercase().starts_with("magnet:")
}

pub(crate) fn select_backend(url: &str) -> DownloadTaskBackend {
    if is_aria2_url(url) {
        DownloadTaskBackend::Aria2
    } else if is_native_http_url(url) {
        DownloadTaskBackend::NativeHttp
    } else if is_curl_url(url) {
        DownloadTaskBackend::Curl
    } else {
        DownloadTaskBackend::Electron
    }
}

pub(crate) fn compute_hash(path: &str, algorithm: &str) -> Result<String, String> {
    let bytes = fs::read(path).map_err(|error| error.to_string())?;
    match algorithm {
        "sha1" => {
            let mut hasher = Sha1::new();
            hasher.update(&bytes);
            Ok(format!("{:x}", hasher.finalize()))
        }
        "sha256" => {
            let mut hasher = Sha256::new();
            hasher.update(&bytes);
            Ok(format!("{:x}", hasher.finalize()))
        }
        "md5" => Err("md5 checksum is not available in the Rust runtime yet".to_string()),
        other => Err(format!("unsupported checksum algorithm: {other}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use pretty_assertions::assert_eq;

    #[test]
    fn classifies_supported_protocols_with_native_c_helper() {
        assert_eq!(
            classify_download_protocol("HTTPS://example.com/file.zip"),
            DownloadProtocol::Https
        );
        assert_eq!(
            classify_download_protocol("sftp://files.example.com/a.tar"),
            DownloadProtocol::Sftp
        );
        assert_eq!(
            classify_download_protocol("magnet:?xt=urn:btih:abc"),
            DownloadProtocol::Magnet
        );
        assert_eq!(
            classify_download_protocol("file:///tmp/a"),
            DownloadProtocol::Unknown
        );
    }

    #[test]
    fn plans_multi_connection_segments_with_resume_offsets() {
        let response = plan_download(&DownloadPlanRequest {
            url: "https://example.com/artifact.bin".to_string(),
            total_bytes: 10_000,
            requested_connections: 4,
            min_segment_bytes: Some(1),
            existing_part_lengths: vec![2500, 100, 3000, 0],
        });

        assert_eq!(response.protocol, DownloadProtocol::Https);
        assert_eq!(response.connections, 4);
        assert_eq!(response.segments[0].complete, true);
        assert_eq!(response.segments[1].next_start, 2600);
        assert_eq!(response.segments[2].complete, true);
        assert_eq!(response.resumable, true);
    }

    #[test]
    fn selects_backend_by_url_protocol() {
        assert_eq!(
            select_backend("https://example.com/a"),
            DownloadTaskBackend::NativeHttp
        );
        assert_eq!(
            select_backend("sftp://example.com/a"),
            DownloadTaskBackend::Curl
        );
        assert_eq!(
            select_backend("magnet:?xt=urn:btih:abc"),
            DownloadTaskBackend::Aria2
        );
        assert_eq!(
            select_backend("file:///tmp/a"),
            DownloadTaskBackend::Electron
        );
    }
}
