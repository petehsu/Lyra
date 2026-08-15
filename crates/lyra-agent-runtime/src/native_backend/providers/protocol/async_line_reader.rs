//! Async line reader for streaming SSE/JSONL responses.
//!
//! Wraps `reqwest::Response::bytes_stream()` and yields complete lines,
//! buffering partial chunks the same way `BufReader::lines()` does for
//! synchronous readers.

use bytes::Bytes;
use futures::Stream;

use crate::AgentRuntimeError;

/// Error wrapper so callers get the same typed transport classification
/// they had with the sync `streaming_body_read_error`.
fn body_read_error(error: reqwest::Error) -> AgentRuntimeError {
    let kind = crate::native_backend::provider::classify_reqwest_transport(&error);
    AgentRuntimeError::ProviderTransport {
        kind,
        detail: format!("provider streaming response body read failed: {error}"),
    }
}

/// A chunk did not arrive within the per-op idle timeout. Mirrors the comment
/// on `PROVIDER_STREAMING_IDLE_TIMEOUT` in `network.rs`: a provider that keeps
/// the TCP connection open but stops sending bytes (route hiccup, cold-path
/// TTFT, etc.) used to block `next_line().await` forever in the async path —
/// the sync `reqwest::blocking::Client` applies `.timeout()` per read(), but
/// the async client is unbounded (see `provider_http_client_builder_async`). So
/// the watchdog had to fire on the coarse turn-idle budget (120s) to recover,
/// which made a stalled stream look "stuck" to the user instead of surfacing
/// as a typed transport Timeout that the existing safe-retry / non-streaming
/// fallback in `call_model_once_inner` already recovers from. Ported the
/// per-chunk timeout idiom from jcode (`tokio::time::timeout(stream_idle,
/// stream.next())` resets on every chunk; bail as `Stream read timeout` on
/// the first absent chunk within the budget).
fn body_read_idle_timeout_error(timeout_secs: u64) -> AgentRuntimeError {
    let kind = crate::ProviderTransportKind::Timeout;
    AgentRuntimeError::ProviderTransport {
        kind,
        detail: format!(
            "provider streaming response chunk read timed out: no data received within {timeout_secs} seconds"
        ),
    }
}

pub(crate) struct AsyncLineReader<S>
where
    S: Stream<Item = Result<Bytes, reqwest::Error>> + Unpin,
{
    stream: S,
    // ponytail: 字节缓冲而非 String。reqwest chunk 边界可能切在一个
    // 多字节 UTF-8 字符中间；若逐 chunk 用 from_utf8_lossy 解码，残缺字节
    // 会被永久替换成 U+FFFD（中文乱码）。先存原始字节，按 `\n` 切出完整行
    // 后再解码，跨 chunk 字符即可完整还原。升级路径：用 tokio_util::codec
    // 的 LinesCodec 可省去手写分行，但当前规模不值得引新类型。
    buf: Vec<u8>,
}

impl<S> AsyncLineReader<S>
where
    S: Stream<Item = Result<Bytes, reqwest::Error>> + Unpin,
{
    pub(crate) fn new(stream: S) -> Self {
        Self {
            stream,
            buf: Vec::new(),
        }
    }

    /// Returns the next complete line (without trailing `\n` or `\r\n`).
    /// Returns `None` when the stream is exhausted and the buffer is empty.
    /// A trailing partial line (no final newline) is returned as the last
    /// `Some(Ok(line))`.
    pub(crate) async fn next_line(&mut self) -> Option<Result<String, AgentRuntimeError>> {
        use futures::StreamExt;
        loop {
            if let Some(idx) = self.buf.iter().position(|&b| b == b'\n') {
                let end = if idx > 0 && self.buf[idx - 1] == b'\r' {
                    idx - 1
                } else {
                    idx
                };
                let line = String::from_utf8(self.buf[..end].to_vec())
                    .unwrap_or_else(|_| String::from_utf8_lossy(&self.buf[..end]).into_owned());
                self.buf.drain(..=idx);
                return Some(Ok(line));
            }
            // Race the network read against a per-chunk idle timeout. reqwest's
            // async client applies no per-operation timeout in streaming mode
            // (`provider_http_client_builder_async`), so without this race the
            // SSE/JSONL loop parks on `stream.next().await` indefinitely while
            // the idle watchdog can only kill the turn at 120s granularity —
            // the bug that made the agent "freeze" while the user watched a
            // partial message + spinner. Reuse the same knob the blocking path
            // uses (`PROVIDER_STREAMING_IDLE_TIMEOUT`, 180s default) so tuning is
            // uniform. Each arriving chunk resets the clock; a slow-but-progressing
            // stream is never cut off, only a true stall (socket open, no bytes).
            // The typed Timeout the race produces flows through the existing
            // safe-retry / non-streaming fallback in `call_model_once_inner`.
            let idle_timeout = crate::native_backend::network::streaming_idle_timeout();
            match tokio::time::timeout(idle_timeout, self.stream.next()).await {
                Ok(Some(Ok(chunk))) => self.buf.extend_from_slice(&chunk),
                Ok(Some(Err(e))) => return Some(Err(body_read_error(e))),
                Ok(None) => {
                    if self.buf.is_empty() {
                        return None;
                    }
                    let bytes = std::mem::take(&mut self.buf);
                    let line = String::from_utf8(bytes)
                        .unwrap_or_else(|e| String::from_utf8_lossy(&e.into_bytes()).into_owned());
                    return Some(Ok(line));
                }
                Err(_) => return Some(Err(body_read_idle_timeout_error(idle_timeout.as_secs()))),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use futures::stream;

    // "你好\n" 的 UTF-8 字节按中文字符(3 字节)中间切断成 3 个 chunk，
    // 验证字节缓冲能在行边界完整还原多字节字符（修复前的逐 chunk
    // from_utf8_lossy 会把残缺字节变成 U+FFFD）。
    #[tokio::test]
    async fn next_line_reassembles_multibyte_char_across_chunks() {
        let chunks: Vec<Result<Bytes, reqwest::Error>> = vec![
            Ok(Bytes::from_static(&[0xE4, 0xBD])),
            Ok(Bytes::from_static(&[0xA0, 0xE5, 0xA5])),
            Ok(Bytes::from_static(&[0xBD, 0x0A])),
        ];
        let mut reader = AsyncLineReader::new(stream::iter(chunks));
        let line = reader.next_line().await.expect("line").expect("ok");
        assert_eq!(line, "你好");
    }
}
