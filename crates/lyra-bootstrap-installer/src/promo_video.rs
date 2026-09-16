use std::io::{BufReader, Read};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::SyncSender;
use std::thread;
use std::time::{Duration, Instant};

use openh264::formats::YUVSource;
use serde::Deserialize;

pub const DEFAULT_MANIFEST_URL: &str =
    "https://jhpeihmmxfcwwodngybw.supabase.co/storage/v1/object/public/installer/manifest.json";

const MAX_MANIFEST_BYTES: u64 = 16 * 1024;
const MAX_VIDEO_BYTES: u64 = 80 * 1024 * 1024;
const FIRST_FRAME_TIMEOUT: Duration = Duration::from_secs(20);
pub const DISPLAY_WIDTH: u32 = 480;
pub const DISPLAY_HEIGHT: u32 = 270;

#[derive(Clone, Debug)]
pub struct PromoFrame {
    pub width: u32,
    pub height: u32,
    pub rgb: Vec<u8>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromoManifest {
    pub video_url: String,
    #[allow(dead_code)]
    pub updated_at: Option<String>,
}

pub fn spawn_promo_loader(
    manifest_url: String,
    proxy: Option<String>,
    frames: SyncSender<PromoFrame>,
    stop: std::sync::Arc<AtomicBool>,
) {
    thread::Builder::new()
        .name("lyra-promo-video".to_string())
        .spawn(move || {
            if let Err(error) = load_and_play(&manifest_url, proxy.as_deref(), &frames, &stop) {
                eprintln!("Lyra installer promo video skipped: {error}");
            }
        })
        .ok();
}

pub fn parse_manifest(bytes: &[u8]) -> Result<PromoManifest, String> {
    let manifest: PromoManifest = serde_json::from_slice(bytes)
        .map_err(|error| format!("promo manifest is invalid JSON: {error}"))?;
    require_https(&manifest.video_url)?;
    if manifest.video_url.trim().is_empty() {
        return Err("promo manifest videoUrl is empty".to_string());
    }
    Ok(manifest)
}

pub fn avcc_to_annexb(data: &[u8], nal_len: usize) -> Result<Vec<u8>, String> {
    if nal_len == 0 || nal_len > 4 {
        return Err(format!("unsupported NAL length size {nal_len}"));
    }
    let mut out = Vec::with_capacity(data.len().saturating_add(8));
    let mut index = 0;
    while index < data.len() {
        if index + nal_len > data.len() {
            return Err("truncated AVCC NAL length".to_string());
        }
        let mut length = 0_usize;
        for offset in 0..nal_len {
            length = (length << 8) | usize::from(data[index + offset]);
        }
        index += nal_len;
        let end = index.checked_add(length).ok_or("NAL length overflow")?;
        if end > data.len() {
            return Err("truncated AVCC NAL body".to_string());
        }
        out.extend_from_slice(&[0, 0, 0, 1]);
        out.extend_from_slice(&data[index..end]);
        index = end;
    }
    Ok(out)
}

fn load_and_play(
    manifest_url: &str,
    proxy: Option<&str>,
    frames: &SyncSender<PromoFrame>,
    stop: &AtomicBool,
) -> Result<(), String> {
    let started = Instant::now();
    let client = http_client(proxy)?;
    let manifest_bytes = fetch_limited(&client, require_https(manifest_url)?, MAX_MANIFEST_BYTES)?;
    let manifest = parse_manifest(&manifest_bytes)?;
    let video_bytes = fetch_limited(&client, &manifest.video_url, MAX_VIDEO_BYTES)?;
    if started.elapsed() > FIRST_FRAME_TIMEOUT {
        return Err("timed out before the first promo frame".to_string());
    }
    let encoded = demux_h264(&video_bytes)?;
    play_loop(encoded, frames, stop, started)
}

fn play_loop(
    encoded: EncodedH264,
    frames: &SyncSender<PromoFrame>,
    stop: &AtomicBool,
    started: Instant,
) -> Result<(), String> {
    let mut sent_first = false;
    loop {
        if stop.load(Ordering::Relaxed) {
            return Ok(());
        }
        let mut decoder =
            openh264::decoder::Decoder::new().map_err(|error| format!("H.264 decoder: {error}"))?;
        let loop_start = Instant::now();
        let mut pts_ms = 0_u64;
        for sample in &encoded.samples {
            if stop.load(Ordering::Relaxed) {
                return Ok(());
            }
            let unit = access_unit(&encoded.sps, &encoded.pps, sample, encoded.nal_len)?;
            let decoded = decoder
                .decode(unit.as_slice())
                .map_err(|error| format!("H.264 decode: {error}"))?;
            pts_ms = pts_ms.saturating_add(sample.duration_ms);
            let Some(yuv) = decoded else {
                continue;
            };
            let rgb = yuv_to_display_rgb(&yuv)?;
            if !sent_first && started.elapsed() > FIRST_FRAME_TIMEOUT {
                return Err("timed out before the first promo frame".to_string());
            }
            let target = loop_start + Duration::from_millis(pts_ms);
            if let Some(delay) = target.checked_duration_since(Instant::now()) {
                if delay > Duration::from_millis(2) {
                    thread::sleep(delay.min(Duration::from_millis(80)));
                }
            } else if sent_first {
                continue;
            }
            match frames.try_send(PromoFrame {
                width: DISPLAY_WIDTH,
                height: DISPLAY_HEIGHT,
                rgb,
            }) {
                Ok(()) => sent_first = true,
                Err(std::sync::mpsc::TrySendError::Full(frame)) => {
                    let _ = frames.try_send(frame);
                    sent_first = true;
                }
                Err(std::sync::mpsc::TrySendError::Disconnected(_)) => return Ok(()),
            }
        }
        if !sent_first {
            return Err("no decoded promo frames".to_string());
        }
    }
}

struct EncodedH264 {
    sps: Vec<u8>,
    pps: Vec<u8>,
    nal_len: usize,
    samples: Vec<EncodedSample>,
}

struct EncodedSample {
    bytes: Vec<u8>,
    is_sync: bool,
    duration_ms: u64,
}

fn demux_h264(bytes: &[u8]) -> Result<EncodedH264, String> {
    let cursor = std::io::Cursor::new(bytes.to_vec());
    let size = bytes.len() as u64;
    let mut mp4 = mp4::Mp4Reader::read_header(BufReader::new(cursor), size)
        .map_err(|error| format!("MP4 header: {error}"))?;
    let (track_id, timescale, sample_count, sps, pps, nal_len) = {
        let (track_id, track) = mp4
            .tracks()
            .iter()
            .find(|(_, track)| {
                track
                    .track_type()
                    .ok()
                    .is_some_and(|kind| kind == mp4::TrackType::Video)
            })
            .ok_or_else(|| "promo video has no video track".to_string())?;
        let sps = track
            .sequence_parameter_set()
            .map_err(|error| format!("missing SPS: {error}"))?
            .to_vec();
        let pps = track
            .picture_parameter_set()
            .map_err(|error| format!("missing PPS: {error}"))?
            .to_vec();
        let nal_len = track
            .trak
            .mdia
            .minf
            .stbl
            .stsd
            .avc1
            .as_ref()
            .map(|avc1| usize::from(avc1.avcc.length_size_minus_one) + 1)
            .unwrap_or(4)
            .clamp(1, 4);
        (
            *track_id,
            track.timescale(),
            track.sample_count(),
            sps,
            pps,
            nal_len.min(4),
        )
    };

    let mut samples = Vec::with_capacity(sample_count as usize);
    for sample_id in 1..=sample_count {
        let sample = mp4
            .read_sample(track_id, sample_id)
            .map_err(|error| format!("MP4 sample {sample_id}: {error}"))?
            .ok_or_else(|| format!("missing MP4 sample {sample_id}"))?;
        let duration_ms = if timescale == 0 {
            42
        } else {
            (u64::from(sample.duration) * 1000) / u64::from(timescale)
        }
        .max(1);
        samples.push(EncodedSample {
            bytes: sample.bytes.to_vec(),
            is_sync: sample.is_sync,
            duration_ms,
        });
    }
    if samples.is_empty() {
        return Err("promo video has no samples".to_string());
    }
    Ok(EncodedH264 {
        sps,
        pps,
        nal_len,
        samples,
    })
}

fn access_unit(
    sps: &[u8],
    pps: &[u8],
    sample: &EncodedSample,
    nal_len: usize,
) -> Result<Vec<u8>, String> {
    let mut unit = Vec::with_capacity(
        sample
            .bytes
            .len()
            .saturating_add(sps.len() + pps.len() + 16),
    );
    if sample.is_sync {
        unit.extend_from_slice(&[0, 0, 0, 1]);
        unit.extend_from_slice(sps);
        unit.extend_from_slice(&[0, 0, 0, 1]);
        unit.extend_from_slice(pps);
    }
    unit.extend(avcc_to_annexb(&sample.bytes, nal_len)?);
    Ok(unit)
}

fn yuv_to_display_rgb(yuv: &openh264::decoder::DecodedYUV<'_>) -> Result<Vec<u8>, String> {
    let (width, height) = yuv.dimensions();
    if width == 0 || height == 0 {
        return Err("decoded frame has empty dimensions".to_string());
    }
    let mut rgb = vec![0_u8; width.saturating_mul(height).saturating_mul(3)];
    yuv.write_rgb8(&mut rgb);
    Ok(scale_rgb(
        &rgb,
        width as u32,
        height as u32,
        DISPLAY_WIDTH,
        DISPLAY_HEIGHT,
    ))
}

fn scale_rgb(src: &[u8], src_w: u32, src_h: u32, dst_w: u32, dst_h: u32) -> Vec<u8> {
    let mut out = vec![0_u8; (dst_w * dst_h * 3) as usize];
    if src_w == 0 || src_h == 0 {
        return out;
    }
    for y in 0..dst_h {
        let src_y = y * src_h / dst_h;
        for x in 0..dst_w {
            let src_x = x * src_w / dst_w;
            let src_index = ((src_y * src_w + src_x) * 3) as usize;
            let dst_index = ((y * dst_w + x) * 3) as usize;
            out[dst_index..dst_index + 3].copy_from_slice(&src[src_index..src_index + 3]);
        }
    }
    out
}

fn http_client(proxy: Option<&str>) -> Result<reqwest::blocking::Client, String> {
    let redirect = reqwest::redirect::Policy::custom(|attempt| {
        if attempt.url().scheme() != "https" {
            return attempt.error("refusing an HTTPS downgrade redirect");
        }
        if attempt.previous().len() >= 8 {
            return attempt.error("too many redirects");
        }
        attempt.follow()
    });
    let mut builder = reqwest::blocking::Client::builder()
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(90))
        .redirect(redirect)
        .user_agent("Lyra-Installer/0.1");
    if let Some(proxy) = proxy.map(str::trim).filter(|value| !value.is_empty()) {
        builder = builder
            .proxy(reqwest::Proxy::all(proxy).map_err(|error| format!("invalid proxy: {error}"))?);
    }
    builder
        .build()
        .map_err(|error| format!("HTTP client: {error}"))
}

fn fetch_limited(
    client: &reqwest::blocking::Client,
    url: &str,
    max_bytes: u64,
) -> Result<Vec<u8>, String> {
    let response = client
        .get(url)
        .send()
        .map_err(|error| format!("download failed: {error}"))?;
    if response.url().scheme() != "https" {
        return Err("refusing a non-HTTPS promo URL".to_string());
    }
    let mut response = response
        .error_for_status()
        .map_err(|error| format!("download failed: {error}"))?;
    if response
        .content_length()
        .is_some_and(|length| length > max_bytes)
    {
        return Err(format!("promo asset exceeds the {max_bytes}-byte limit"));
    }
    let mut bytes = Vec::new();
    response
        .by_ref()
        .take(max_bytes.saturating_add(1))
        .read_to_end(&mut bytes)
        .map_err(|error| format!("download failed: {error}"))?;
    if bytes.len() as u64 > max_bytes {
        return Err(format!("promo asset exceeds the {max_bytes}-byte limit"));
    }
    Ok(bytes)
}

fn require_https(url: &str) -> Result<&str, String> {
    let parsed = reqwest::Url::parse(url).map_err(|error| format!("invalid promo URL: {error}"))?;
    if parsed.scheme() != "https" {
        return Err("promo URL must be HTTPS".to_string());
    }
    Ok(url)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn manifest_requires_https_video_url() {
        let parsed = parse_manifest(
            br#"{"videoUrl":"https://jhpeihmmxfcwwodngybw.supabase.co/storage/v1/object/public/installer/promotional.mp4","updatedAt":"2026-09-16T01:16:00Z"}"#,
        )
        .expect("manifest");
        assert!(parsed.video_url.starts_with("https://"));
        assert!(parse_manifest(br#"{"videoUrl":"http://example.test/a.mp4"}"#).is_err());
    }

    #[test]
    fn avcc_length_prefixed_nal_becomes_annex_b() {
        let avcc = [0, 0, 0, 1, 0x67];
        assert_eq!(
            avcc_to_annexb(&avcc, 4).expect("annexb"),
            vec![0, 0, 0, 1, 0x67]
        );
    }

    #[test]
    fn demuxes_local_baseline_promo_when_present() {
        let path = "/tmp/lyra-installer-promo/promotional.mp4";
        let Ok(bytes) = std::fs::read(path) else {
            return;
        };
        let encoded = demux_h264(&bytes).expect("demux promotional.mp4");
        assert!(!encoded.samples.is_empty());
        let sample = encoded
            .samples
            .iter()
            .find(|sample| sample.is_sync)
            .expect("keyframe");
        let unit = access_unit(&encoded.sps, &encoded.pps, sample, encoded.nal_len).expect("AU");
        let mut decoder = openh264::decoder::Decoder::new().expect("decoder");
        let decoded = decoder.decode(unit.as_slice()).expect("decode");
        assert!(decoded.is_some(), "first keyframe should decode");
    }
}
