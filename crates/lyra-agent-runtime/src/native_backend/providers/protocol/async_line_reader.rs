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
            match self.stream.next().await {
                Some(Ok(chunk)) => self.buf.extend_from_slice(&chunk),
                Some(Err(e)) => return Some(Err(body_read_error(e))),
                None => {
                    if self.buf.is_empty() {
                        return None;
                    }
                    let bytes = std::mem::take(&mut self.buf);
                    let line = String::from_utf8(bytes)
                        .unwrap_or_else(|e| String::from_utf8_lossy(&e.into_bytes()).into_owned());
                    return Some(Ok(line));
                }
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
