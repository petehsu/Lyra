use crate::policy::normalize_path_string;
use crate::query::empty_stats;
use crate::service::{
    MAX_RESULT_LIMIT, SearchCoreService, clamp_limit, service_for_request_with_background,
};
use crate::types::*;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, OnceLock, RwLock};
use std::thread;
use uuid::Uuid;

const STREAM_RESULT_LIMIT_DEFAULT: usize = 120;

const STREAM_MAX_ACTIVE: usize = 64;

#[derive(Debug)]
pub(crate) struct SearchStreamState {
    pub(crate) snapshot: SearchLocalStreamReadResponse,
    pub(crate) cancel_flag: Arc<AtomicBool>,
}

static SEARCH_STREAMS: OnceLock<RwLock<HashMap<String, Arc<RwLock<SearchStreamState>>>>> =
    OnceLock::new();

pub(crate) fn stream_store() -> &'static RwLock<HashMap<String, Arc<RwLock<SearchStreamState>>>> {
    SEARCH_STREAMS.get_or_init(|| RwLock::new(HashMap::new()))
}

pub(crate) fn stream_is_active(stream_id: &str) -> bool {
    stream_store()
        .read()
        .map(|streams| streams.contains_key(stream_id))
        .unwrap_or(false)
}

pub(crate) fn prune_stream_store(streams: &mut HashMap<String, Arc<RwLock<SearchStreamState>>>) {
    if streams.len() <= STREAM_MAX_ACTIVE {
        return;
    }
    let removable = streams
        .iter()
        .filter_map(|(stream_id, state)| {
            let snapshot = state.read().ok()?;
            if snapshot.snapshot.done {
                Some(stream_id.clone())
            } else {
                None
            }
        })
        .collect::<Vec<_>>();
    for stream_id in removable {
        if streams.len() <= STREAM_MAX_ACTIVE {
            break;
        }
        streams.remove(&stream_id);
    }
}

pub(crate) fn run_stream_worker(
    stream_id: String,
    stream_state: Arc<RwLock<SearchStreamState>>,
    request: SearchLocalRequest,
    limit: usize,
    service: Arc<SearchCoreService>,
    cancel_flag: Arc<AtomicBool>,
) {
    if cancel_flag.load(Ordering::Relaxed) {
        return;
    }
    let update_stream_id = stream_id.clone();
    let update_state = stream_state.clone();
    let update_cancel_flag = cancel_flag.clone();
    let result = service.search_with_updates(&request, limit, move |payload| {
        if update_cancel_flag.load(Ordering::Relaxed) || !stream_is_active(&update_stream_id) {
            return;
        }
        if let Ok(mut guard) = update_state.write() {
            guard.snapshot.results = payload.results;
            guard.snapshot.truncated = payload.truncated;
            guard.snapshot.elapsed_ms = payload.elapsed_ms;
            guard.snapshot.stats = payload.stats;
            guard.snapshot.index_status = payload.index_status;
            guard.snapshot.done = false;
            guard.snapshot.error = None;
        }
    });
    if cancel_flag.load(Ordering::Relaxed) || !stream_is_active(&stream_id) {
        return;
    }
    if let Ok(mut guard) = stream_state.write() {
        guard.snapshot.results = result.results;
        guard.snapshot.truncated = result.truncated;
        guard.snapshot.elapsed_ms = result.elapsed_ms;
        guard.snapshot.stats = result.stats;
        guard.snapshot.index_status = result.index_status;
        guard.snapshot.done = true;
        guard.snapshot.error = None;
    }
}

pub fn search_local_stream_start_json(request_json: String) -> Result<String, String> {
    let request: SearchLocalRequest =
        serde_json::from_str(&request_json).map_err(|error| format!("invalid request: {error}"))?;
    let query = request.query.trim().to_string();
    if query.is_empty() {
        return Err("query is required".to_string());
    }
    let limit = request
        .limit
        .unwrap_or(STREAM_RESULT_LIMIT_DEFAULT)
        .max(1)
        .min(MAX_RESULT_LIMIT);
    let service = service_for_request_with_background(request.storage_root.as_deref(), false)?;
    let roots = service
        .roots_for_request(&request)
        .iter()
        .map(|root| normalize_path_string(root))
        .collect::<Vec<_>>();
    let scope_preset = request.scope_preset;
    let stream_id = format!("search-stream-{}", Uuid::new_v4());
    let cancel_flag = Arc::new(AtomicBool::new(false));
    let index_status = service.index_status();
    let stream_state = Arc::new(RwLock::new(SearchStreamState {
        snapshot: SearchLocalStreamReadResponse {
            stream_id: stream_id.clone(),
            query: query.clone(),
            scope_preset,
            roots: roots.clone(),
            results: Vec::new(),
            truncated: false,
            elapsed_ms: 0,
            stats: empty_stats(),
            index_status,
            done: false,
            error: None,
        },
        cancel_flag: cancel_flag.clone(),
    }));
    {
        let mut streams = stream_store()
            .write()
            .map_err(|_| "search stream state lock poisoned".to_string())?;
        prune_stream_store(&mut streams);
        streams.insert(stream_id.clone(), stream_state.clone());
    }

    let worker_stream_id = stream_id.clone();
    thread::spawn(move || {
        run_stream_worker(
            worker_stream_id,
            stream_state,
            request,
            limit,
            service,
            cancel_flag,
        );
    });

    serde_json::to_string(&SearchLocalStreamStartResponse {
        stream_id,
        query,
        scope_preset,
        roots,
    })
    .map_err(|error| format!("serialize response failed: {error}"))
}

pub fn search_local_stream_read_json(request_json: String) -> Result<String, String> {
    let request: SearchLocalStreamReadRequest =
        serde_json::from_str(&request_json).map_err(|error| format!("invalid request: {error}"))?;
    if request.stream_id.trim().is_empty() {
        return Err("streamId is required".to_string());
    }

    let stream_state = {
        let streams = stream_store()
            .read()
            .map_err(|_| "search stream state lock poisoned".to_string())?;
        streams.get(request.stream_id.as_str()).cloned()
    };
    let Some(stream_state) = stream_state else {
        return Err("search stream not found".to_string());
    };

    let mut snapshot = stream_state
        .read()
        .map_err(|_| "search stream snapshot lock poisoned".to_string())?
        .snapshot
        .clone();
    if let Some(limit) = request.limit {
        let clamped = clamp_limit(Some(limit));
        if snapshot.results.len() > clamped {
            snapshot.results.truncate(clamped);
            snapshot.truncated = true;
        }
    }

    serde_json::to_string(&snapshot).map_err(|error| format!("serialize response failed: {error}"))
}

pub fn search_local_stream_cancel_json(request_json: String) -> Result<String, String> {
    let request: SearchLocalStreamCancelRequest =
        serde_json::from_str(&request_json).map_err(|error| format!("invalid request: {error}"))?;
    if request.stream_id.trim().is_empty() {
        return Err("streamId is required".to_string());
    }
    let removed = stream_store()
        .write()
        .map_err(|_| "search stream state lock poisoned".to_string())?
        .remove(request.stream_id.as_str());
    if let Some(stream_state) = &removed {
        if let Ok(guard) = stream_state.read() {
            guard.cancel_flag.store(true, Ordering::Relaxed);
        }
    }
    serde_json::to_string(&SearchLocalStreamCancelResponse {
        removed: removed.is_some(),
    })
    .map_err(|error| format!("serialize response failed: {error}"))
}
