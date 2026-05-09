use serde::{Deserialize, Serialize};

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

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum DownloadProtocol {
    Http,
    Https,
    Ftp,
    Ftps,
    Sftp,
    Webdav,
    Webdavs,
    Magnet,
    Unknown,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DownloadPlanRequest {
    pub url: String,
    pub total_bytes: u64,
    pub requested_connections: u32,
    #[serde(default)]
    pub min_segment_bytes: Option<u64>,
    #[serde(default)]
    pub existing_part_lengths: Vec<u64>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DownloadSegmentPlan {
    pub index: u32,
    pub start: u64,
    pub end_inclusive: Option<u64>,
    pub next_start: u64,
    pub size_bytes: Option<u64>,
    pub existing_bytes: u64,
    pub complete: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DownloadPlanResponse {
    pub protocol: DownloadProtocol,
    pub resumable: bool,
    pub connections: u32,
    pub segments: Vec<DownloadSegmentPlan>,
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

pub fn plan_download_json(payload: &str) -> Result<String, String> {
    let request = serde_json::from_str::<DownloadPlanRequest>(payload)
        .map_err(|error| format!("invalid download plan request: {error}"))?;
    serde_json::to_string(&plan_download(&request))
        .map_err(|error| format!("failed to encode download plan: {error}"))
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
    fn emits_json_plan_for_napi_boundary() {
        let json = plan_download_json(
            r#"{"url":"webdavs://example.com/file.iso","totalBytes":0,"requestedConnections":8}"#,
        )
        .unwrap_or_else(|error| panic!("{error}"));
        let parsed: DownloadPlanResponse =
            serde_json::from_str(&json).unwrap_or_else(|error| panic!("{error}"));

        assert_eq!(parsed.protocol, DownloadProtocol::Webdavs);
        assert_eq!(parsed.connections, 1);
        assert_eq!(parsed.segments[0].end_inclusive, None);
    }
}
