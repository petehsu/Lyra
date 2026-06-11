use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use serde::Serialize;
use tiny_http::{Header, Method, Response, Server, StatusCode};

use crate::manager::DownloadManager;
use crate::model::DownloadEnqueueRequest;

pub(crate) fn serve_remote_api(
    manager: Arc<DownloadManager>,
    host: String,
    port: u16,
    token: String,
    shutdown: Arc<AtomicBool>,
) {
    if let Ok(server) = Server::http(format!("{host}:{port}")) {
        while !shutdown.load(Ordering::Relaxed) {
            let Ok(Some(request)) = server.recv_timeout(Duration::from_millis(250)) else {
                continue;
            };
            handle_remote_request(&manager, request, &token);
        }
    }
}

pub(crate) fn handle_remote_request(
    manager: &Arc<DownloadManager>,
    mut request: tiny_http::Request,
    token: &str,
) {
    let authorized = request
        .headers()
        .iter()
        .find(|header| header.field.equiv("authorization"))
        .map(|header| header.value.as_str() == format!("Bearer {token}"))
        .unwrap_or(false);
    if !authorized {
        let _ = request.respond(Response::empty(StatusCode(401)));
        return;
    }
    let path = request.url().to_string();
    let method = request.method().clone();
    let response = match (method, path.as_str()) {
        (Method::Get, "/api/downloads") => json_response(&manager.snapshot()),
        (Method::Post, "/api/downloads") => {
            let mut body = String::new();
            let _ = request.as_reader().read_to_string(&mut body);
            let parsed = serde_json::from_str::<DownloadEnqueueRequest>(&body).unwrap_or_default();
            match manager.enqueue(parsed) {
                Ok(()) => json_response(&manager.snapshot()),
                Err(error) => text_response(StatusCode(400), error),
            }
        }
        (Method::Post, "/api/downloads/pause-all") => {
            for id in manager.select_batch_ids(None) {
                manager.pause_task(&id);
            }
            json_response(&manager.snapshot())
        }
        (Method::Post, "/api/downloads/resume-all") => {
            for id in manager.select_batch_ids(None) {
                manager.resume_task(&id);
            }
            json_response(&manager.snapshot())
        }
        (Method::Post, "/api/downloads/cancel-all") => {
            for id in manager.select_batch_ids(None) {
                manager.cancel_task(&id);
            }
            json_response(&manager.snapshot())
        }
        (Method::Post, _) => {
            if let Some((task_id, action)) = parse_remote_task_action(&path) {
                match action {
                    "pause" => json_response(&manager.pause_task(&task_id)),
                    "resume" => json_response(&manager.resume_task(&task_id)),
                    "cancel" => json_response(&manager.cancel_task(&task_id)),
                    "retry" => json_response(&manager.retry_task(&task_id)),
                    "remove" => {
                        manager.remove_task(&task_id);
                        json_response(&manager.snapshot())
                    }
                    _ => text_response(StatusCode(404), "not found".to_string()),
                }
            } else {
                text_response(StatusCode(404), "not found".to_string())
            }
        }
        _ => text_response(StatusCode(404), "not found".to_string()),
    };
    let _ = request.respond(response);
}

fn parse_remote_task_action(path: &str) -> Option<(String, &str)> {
    let rest = path.strip_prefix("/api/downloads/")?;
    let (task_id, action) = rest.rsplit_once('/')?;
    if task_id.is_empty() || action.is_empty() {
        return None;
    }
    Some((urlencoding::decode(task_id).ok()?.to_string(), action))
}

fn json_response<T: Serialize>(value: &T) -> Response<std::io::Cursor<Vec<u8>>> {
    let encoded = serde_json::to_vec(value).unwrap_or_else(|_| b"{}".to_vec());
    let mut response = Response::from_data(encoded);
    if let Ok(header) = Header::from_bytes("content-type", "application/json") {
        response.add_header(header);
    }
    response
}

fn text_response(status: StatusCode, value: String) -> Response<std::io::Cursor<Vec<u8>>> {
    Response::from_string(value).with_status_code(status)
}

#[cfg(test)]
mod tests {
    use super::*;
    use pretty_assertions::assert_eq;

    #[test]
    fn parses_remote_task_action_path() {
        assert_eq!(
            parse_remote_task_action("/api/downloads/task%201/pause"),
            Some(("task 1".to_string(), "pause"))
        );
        assert_eq!(parse_remote_task_action("/api/downloads/task-only"), None);
        assert_eq!(parse_remote_task_action("/other/task/pause"), None);
    }
}
