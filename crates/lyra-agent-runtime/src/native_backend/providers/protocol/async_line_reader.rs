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
    buf: String,
}

impl<S> AsyncLineReader<S>
where
    S: Stream<Item = Result<Bytes, reqwest::Error>> + Unpin,
{
    pub(crate) fn new(stream: S) -> Self {
        Self {
            stream,
            buf: String::new(),
        }
    }

    /// Returns the next complete line (without trailing `\n` or `\r\n`).
    /// Returns `None` when the stream is exhausted and the buffer is empty.
    /// A trailing partial line (no final newline) is returned as the last
    /// `Some(Ok(line))`.
    pub(crate) async fn next_line(&mut self) -> Option<Result<String, AgentRuntimeError>> {
        use futures::StreamExt;
        loop {
            if let Some(idx) = self.buf.find('\n') {
                let line = self.buf[..idx]
                    .strip_suffix('\r')
                    .unwrap_or(&self.buf[..idx])
                    .to_string();
                self.buf.drain(..=idx);
                return Some(Ok(line));
            }
            match self.stream.next().await {
                Some(Ok(chunk)) => self.buf.push_str(&String::from_utf8_lossy(&chunk)),
                Some(Err(e)) => return Some(Err(body_read_error(e))),
                None => {
                    if self.buf.is_empty() {
                        return None;
                    }
                    let line = std::mem::take(&mut self.buf);
                    return Some(Ok(line));
                }
            }
        }
    }
}