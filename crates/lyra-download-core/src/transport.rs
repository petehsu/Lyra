use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::Path;
use std::time::{Duration, Instant};

use reqwest::blocking::Client;

use crate::model::{DownloadTask, DownloadTaskBackend};

pub(crate) struct HttpDownloadProgress {
    pub(crate) received: u64,
    pub(crate) total: u64,
    pub(crate) speed: u64,
}

pub(crate) struct HttpDownloadComplete {
    pub(crate) received: u64,
    pub(crate) total: u64,
}

// Single-stream fallback used only when the aria2 component is unavailable.
// aria2 owns the primary path so resume and multi-connection behavior are
// identical across protocols.
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

// BitTorrent-family URLs expand into multi-file directory output handled by
// aria2's mem-followed torrent/metalink engine.
pub(crate) fn is_bt_url(url: &str) -> bool {
    let Ok(parsed) = url::Url::parse(url) else {
        return false;
    };
    if parsed.scheme().eq_ignore_ascii_case("magnet") {
        return true;
    }
    if !matches!(parsed.scheme(), "http" | "https") {
        return false;
    }
    let pathname = parsed.path().to_ascii_lowercase();
    [".torrent", ".metalink", ".meta4"]
        .iter()
        .any(|extension| pathname.ends_with(extension))
}

pub(crate) fn is_aria2_url(url: &str) -> bool {
    is_bt_url(url)
        || matches!(
            url::Url::parse(url).map(|parsed| parsed.scheme().to_string()),
            Ok(protocol) if matches!(protocol.as_str(), "http" | "https" | "ftp" | "ftps")
        )
}

pub(crate) fn select_backend(url: &str) -> DownloadTaskBackend {
    if is_aria2_url(url) {
        DownloadTaskBackend::Aria2
    } else if is_native_http_url(url) {
        DownloadTaskBackend::NativeHttp
    } else {
        DownloadTaskBackend::Electron
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use pretty_assertions::assert_eq;

    #[test]
    fn selects_aria2_for_http_ftp_and_bittorrent_urls() {
        assert_eq!(
            select_backend("https://example.com/a"),
            DownloadTaskBackend::Aria2
        );
        assert_eq!(
            select_backend("ftp://example.com/a"),
            DownloadTaskBackend::Aria2
        );
        assert_eq!(
            select_backend("magnet:?xt=urn:btih:abc"),
            DownloadTaskBackend::Aria2
        );
        assert_eq!(
            select_backend("https://example.com/releases/app.torrent?mirror=1"),
            DownloadTaskBackend::Aria2
        );
        assert_eq!(
            select_backend("https://example.com/releases/app.metalink"),
            DownloadTaskBackend::Aria2
        );
    }

    #[test]
    fn selects_native_http_for_webdav_and_electron_for_unsupported_schemes() {
        assert_eq!(
            select_backend("webdav://example.com/a"),
            DownloadTaskBackend::NativeHttp
        );
        assert_eq!(
            select_backend("sftp://example.com/a"),
            DownloadTaskBackend::Electron
        );
        assert_eq!(
            select_backend("file:///tmp/a"),
            DownloadTaskBackend::Electron
        );
    }

    #[test]
    fn bt_detection_covers_magnet_and_torrent_family_paths() {
        assert!(is_bt_url("magnet:?xt=urn:btih:abc"));
        assert!(is_bt_url("https://example.com/a.torrent"));
        assert!(is_bt_url("https://example.com/a.meta4#download"));
        assert!(!is_bt_url("https://example.com/archive.zip?file=app.torrent"));
        assert!(!is_bt_url("ftp://example.com/a.torrent"));
    }
}