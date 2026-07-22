use super::*;

use std::collections::HashSet;
use std::sync::Arc;
use std::thread;
use std::time::Duration;

const WEB_MAP_DEFAULT_LIMIT: usize = 50;
const WEB_MAP_MAX_LIMIT: usize = 500;
const WEB_BATCH_SYNC_MAX_URLS: usize = 8;
const WEB_BATCH_MAX_URLS: usize = 50;
const WEB_BATCH_ASYNC_THRESHOLD: usize = 4;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WebBatchJob {
    id: String,
    session_id: String,
    turn_id: String,
    cancelled: bool,
    status: String,
    total: usize,
    completed: usize,
    succeeded: usize,
    failed: usize,
    results: Vec<Value>,
    errors: Vec<Value>,
    started_at: String,
    finished_at: Option<String>,
    error: Option<String>,
}

static WEB_BATCH_JOBS: OnceLock<Mutex<HashMap<String, Arc<Mutex<WebBatchJob>>>>> = OnceLock::new();

fn web_batch_jobs() -> &'static Mutex<HashMap<String, Arc<Mutex<WebBatchJob>>>> {
    WEB_BATCH_JOBS.get_or_init(|| Mutex::new(HashMap::new()))
}

pub(crate) fn tool_web_map(input: &Value) -> NativeToolResult {
    let url = required_value_string(input, "url")?;
    let limit = value_usize(input, "limit", WEB_MAP_DEFAULT_LIMIT, WEB_MAP_MAX_LIMIT);
    let include_sitemap = value_bool(input, "includeSitemap", true);
    let same_origin_only = value_bool(input, "sameOriginOnly", true);
    let allow_private_network = value_bool(input, "allowPrivateNetwork", false);

    let parsed = Url::parse(&url).map_err(|error| {
        NativeToolFailure::new(
            "bad_url",
            format!("invalid URL: {error}"),
            "Retry with an absolute http or https URL.",
        )
    })?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err(NativeToolFailure::new(
            "unsupported_url_scheme",
            "web_map only supports http/https URLs",
            "Retry with an http or https URL.",
        ));
    }

    let provider = lyra_agent_reader::ReqwestFetchProvider::new();
    let request = lyra_agent_reader::ReaderRequest {
        input: lyra_agent_reader::ReaderInput::Url(parsed.to_string()),
        options: lyra_agent_reader::ReaderOptions {
            engine: lyra_agent_reader::ReaderEngine::Http,
            mode: lyra_agent_reader::ExtractionMode::Full,
            max_chars: Some(4_000),
            retain_links: lyra_agent_reader::LinkRetention::All,
            citations: false,
            allow_private_network,
            index_result: false,
            ..lyra_agent_reader::ReaderOptions::default()
        },
    };
    let reader = lyra_agent_reader::read(&request, &provider)
        .map_err(|error| reader_error_to_native_failure(&url, &error))?;

    let origin = format!(
        "{}://{}",
        parsed.scheme(),
        parsed.host_str().unwrap_or_default()
    );
    let mut discovered = Vec::new();
    let mut seen = HashSet::new();
    let seed_title = reader
        .metadata
        .title
        .clone()
        .or(reader.frontmatter.title.clone());

    for link in &reader.links {
        push_discovered_url(
            &mut discovered,
            &mut seen,
            &link.url,
            link.text.clone(),
            "pageLink",
            same_origin_only.then_some(origin.as_str()),
            limit,
        );
    }

    let mut sitemap_urls_tried = Vec::new();
    if include_sitemap {
        for sitemap_url in sitemap_candidates(&parsed) {
            sitemap_urls_tried.push(sitemap_url.clone());
            if discovered.len() >= limit {
                break;
            }
            if let Ok(body) = fetch_sitemap_body(&sitemap_url, allow_private_network) {
                for loc in extract_sitemap_locations(&body) {
                    push_discovered_url(
                        &mut discovered,
                        &mut seen,
                        &loc,
                        None,
                        "sitemap",
                        same_origin_only.then_some(origin.as_str()),
                        limit,
                    );
                }
            }
        }
    }

    let content = web_map_content(&url, &discovered);
    Ok(NativeToolSuccess {
        content,
        raw: json!({
            "url": url,
            "finalUrl": reader.final_url,
            "title": seed_title,
            "limit": limit,
            "sameOriginOnly": same_origin_only,
            "includeSitemap": include_sitemap,
            "sitemapUrlsTried": sitemap_urls_tried,
            "engineAttempts": reader.engine_attempts,
            "discoveredCount": discovered.len(),
            "urls": discovered,
            "recommendedNextAction": if discovered.is_empty() {
                "Try web_fetch on the seed URL directly or widen sameOriginOnly=false."
            } else {
                "Select high-value URLs from urls[] and call web_fetch or web_batch on them."
            },
        }),
        recommended_next_action: if discovered.is_empty() {
            Some("Try web_fetch on the seed URL directly.".to_string())
        } else {
            Some("Call web_fetch or web_batch on selected urls from the map result.".to_string())
        },
    })
}

pub(crate) fn tool_web_batch(
    session_id: &str,
    turn_id: &str,
    tool_call_id: &str,
    input: &Value,
    dispatcher: Option<&Arc<HostCapabilityDispatcher>>,
    cancellation: &CancellationToken,
) -> NativeToolResult {
    let mode = value_string(input, "mode")
        .unwrap_or_default()
        .to_ascii_lowercase();
    if mode == "status" {
        let job_id = required_value_string(input, "jobId")?;
        return web_batch_status(&job_id);
    }
    if mode == "cancel" {
        let job_id = required_value_string(input, "jobId")?;
        return web_batch_cancel(&job_id);
    }

    let urls = web_batch_urls_from_input(input);
    if urls.is_empty() {
        return Err(NativeToolFailure::new(
            "missing_urls",
            "web_batch requires a non-empty urls array",
            "Pass urls discovered by web_map or web_search.",
        ));
    }
    if urls.len() > WEB_BATCH_MAX_URLS {
        return Err(NativeToolFailure::new(
            "too_many_urls",
            format!("web_batch supports at most {WEB_BATCH_MAX_URLS} URLs per job"),
            "Split the batch or raise selective fetch with web_map first.",
        ));
    }

    let max_chars = value_usize(input, "maxCharsPerUrl", 4_000, 20_000);
    let force_async = matches!(mode.as_str(), "async" | "background");
    let force_sync = mode == "sync";
    let use_async = force_async || (!force_sync && urls.len() > WEB_BATCH_ASYNC_THRESHOLD);

    if use_async {
        return start_web_batch_job(
            session_id,
            turn_id,
            tool_call_id,
            &urls,
            max_chars,
            input,
            dispatcher.cloned(),
            cancellation,
        );
    }

    let results = fetch_urls_sync(
        session_id,
        turn_id,
        tool_call_id,
        &urls,
        max_chars,
        input,
        dispatcher,
        None,
        Some(cancellation.clone()),
    )?;
    Ok(batch_success_from_results(&urls, results, "sync"))
}

fn web_batch_cancel(job_id: &str) -> NativeToolResult {
    let Some(job) = web_batch_jobs()
        .lock()
        .ok()
        .and_then(|jobs| jobs.get(job_id).cloned())
    else {
        return Err(NativeToolFailure::new(
            "job_not_found",
            format!("no web batch job found for jobId={job_id}"),
            "Verify the jobId from the async start response.",
        ));
    };
    if let Ok(mut job) = job.lock() {
        job.cancelled = true;
        job.status = "cancelled".to_string();
        job.finished_at = Some(Utc::now().to_rfc3339());
    }
    Ok(NativeToolSuccess {
        content: format!("Cancelled web batch job {job_id}."),
        raw: json!({ "jobId": job_id, "status": "cancelled" }),
        recommended_next_action: None,
    })
}

fn start_web_batch_job(
    session_id: &str,
    turn_id: &str,
    tool_call_id: &str,
    urls: &[String],
    max_chars: usize,
    input: &Value,
    dispatcher: Option<Arc<HostCapabilityDispatcher>>,
    cancellation: &CancellationToken,
) -> NativeToolResult {
    let job_id = format!("web-batch-{tool_call_id}");
    let job = Arc::new(Mutex::new(WebBatchJob {
        id: job_id.clone(),
        session_id: session_id.to_string(),
        turn_id: turn_id.to_string(),
        cancelled: false,
        status: "running".to_string(),
        total: urls.len(),
        completed: 0,
        succeeded: 0,
        failed: 0,
        results: Vec::new(),
        errors: Vec::new(),
        started_at: Utc::now().to_rfc3339(),
        finished_at: None,
        error: None,
    }));
    if let Ok(mut jobs) = web_batch_jobs().lock() {
        jobs.insert(job_id.clone(), job.clone());
    }

    let urls = urls.to_vec();
    let url_count = urls.len();
    let input = input.clone();
    let session_id = session_id.to_string();
    let turn_id = turn_id.to_string();
    let tool_call_id = tool_call_id.to_string();
    let urls_for_thread = urls.clone();
    let cancellation = cancellation.clone();
    thread::spawn(move || {
        let _ = fetch_urls_sync(
            &session_id,
            &turn_id,
            &tool_call_id,
            &urls_for_thread,
            max_chars,
            &input,
            dispatcher.as_ref(),
            Some(job),
            Some(cancellation),
        );
    });

    Ok(NativeToolSuccess {
        content: format!(
            "Started background web batch for {url_count} URLs (jobId={job_id}). Poll with mode=status."
        ),
        raw: json!({
            "mode": "async",
            "jobId": job_id,
            "status": "running",
            "total": urls.len(),
            "completed": 0,
            "recommendedNextAction": "Poll web_batch with mode=status and the returned jobId until status=completed.",
        }),
        recommended_next_action: Some(
            "Poll web_batch with mode=status and jobId until the batch completes.".to_string(),
        ),
    })
}

fn web_batch_status(job_id: &str) -> NativeToolResult {
    let job = web_batch_jobs()
        .lock()
        .ok()
        .and_then(|jobs| jobs.get(job_id).cloned());
    let Some(job) = job else {
        return Err(NativeToolFailure::new(
            "job_not_found",
            format!("no web batch job found for jobId={job_id}"),
            "Start a new web_batch job or verify the jobId from the start response.",
        ));
    };
    let snapshot = job
        .lock()
        .map(|job| serde_json::to_value(&*job).unwrap_or(Value::Null))
        .unwrap_or(Value::Null);
    let status = snapshot
        .get("status")
        .and_then(Value::as_str)
        .unwrap_or("unknown")
        .to_string();
    Ok(NativeToolSuccess {
        content: format!("web batch {job_id}: {status}"),
        raw: snapshot,
        recommended_next_action: if status == "running" {
            Some("Poll again with mode=status until status=completed.".to_string())
        } else {
            None
        },
    })
}

fn fetch_urls_sync(
    session_id: &str,
    turn_id: &str,
    tool_call_id: &str,
    urls: &[String],
    max_chars: usize,
    input: &Value,
    dispatcher: Option<&Arc<HostCapabilityDispatcher>>,
    job: Option<Arc<Mutex<WebBatchJob>>>,
    cancellation: Option<CancellationToken>,
) -> Result<Vec<Value>, NativeToolFailure> {
    let mut results = Vec::new();
    for (index, url) in urls.iter().enumerate() {
        if cancellation
            .as_ref()
            .is_some_and(|token| token.is_cancelled())
            || job
                .as_ref()
                .and_then(|job| job.lock().ok())
                .is_some_and(|job| job.cancelled)
        {
            if let Some(job) = job.as_ref() {
                if let Ok(mut job) = job.lock() {
                    job.status = "cancelled".to_string();
                    job.finished_at = Some(Utc::now().to_rfc3339());
                }
            }
            break;
        }
        if let Some(job) = job.as_ref() {
            emit_web_job_progress(
                session_id,
                turn_id,
                &job.lock().map(|job| job.id.clone()).unwrap_or_default(),
                json!({
                    "phase": "fetch",
                    "index": index,
                    "total": urls.len(),
                    "url": url,
                }),
            );
        }
        let fetch_input = json!({
            "url": url,
            "maxChars": max_chars,
            "engine": input.get("engine").cloned().unwrap_or(Value::String("auto".to_string())),
            "allowPrivateNetwork": input.get("allowPrivateNetwork").cloned().unwrap_or(Value::Bool(false)),
            "queryFocus": input.get("queryFocus").cloned().unwrap_or(Value::Null),
            "preset": input.get("preset").cloned().unwrap_or(Value::String("agent".to_string())),
        });
        let outcome = tool_web_fetch_with_browser_for_session(
            session_id,
            turn_id,
            &format!("{tool_call_id}-{index}"),
            &fetch_input,
            dispatcher,
        );
        let entry = match outcome {
            Ok(success) => json!({
                "url": url,
                "ok": true,
                "engineUsed": success.raw.get("engineUsed").cloned().unwrap_or(Value::Null),
                "engineAttempts": success.raw.get("engineAttempts").cloned().unwrap_or(Value::Null),
                "title": success.raw.get("title").cloned().unwrap_or(Value::Null),
                "compactText": success.raw.get("compactText").cloned().unwrap_or(Value::Null),
                "tokenBudget": success.raw.get("tokenBudget").cloned().unwrap_or(Value::Null),
                "truncated": success.raw.get("truncated").cloned().unwrap_or(Value::Null),
                "warnings": success.raw.get("warnings").cloned().unwrap_or_else(|| Value::Array(Vec::new())),
            }),
            Err(error) => json!({
                "url": url,
                "ok": false,
                "code": error.code,
                "message": error.message,
                "engineAttempts": error
                    .detail
                    .as_ref()
                    .and_then(|detail| detail.get("engineAttempts"))
                    .cloned()
                    .unwrap_or(Value::Null),
                "recommendedNextAction": error.recommended_next_action,
            }),
        };
        if let Some(job) = job.as_ref() {
            if let Ok(mut job) = job.lock() {
                if entry.get("ok").and_then(Value::as_bool) == Some(true) {
                    job.succeeded += 1;
                    job.results.push(entry.clone());
                } else {
                    job.failed += 1;
                    job.errors.push(entry.clone());
                }
                job.completed += 1;
                emit_web_job_progress(
                    session_id,
                    turn_id,
                    &job.id,
                    json!({
                        "phase": "progress",
                        "completed": job.completed,
                        "total": job.total,
                        "succeeded": job.succeeded,
                        "failed": job.failed,
                        "lastUrl": url,
                    }),
                );
            }
        }
        results.push(entry);
    }

    if let Some(job) = job.as_ref() {
        if let Ok(mut job) = job.lock() {
            job.status = "completed".to_string();
            job.finished_at = Some(Utc::now().to_rfc3339());
            emit_web_job_progress(
                session_id,
                turn_id,
                &job.id,
                json!({
                    "phase": "completed",
                    "completed": job.completed,
                    "total": job.total,
                    "succeeded": job.succeeded,
                    "failed": job.failed,
                }),
            );
        }
    }
    Ok(results)
}

fn batch_success_from_results(
    urls: &[String],
    results: Vec<Value>,
    mode: &str,
) -> NativeToolSuccess {
    let succeeded = results
        .iter()
        .filter(|entry| entry.get("ok").and_then(Value::as_bool) == Some(true))
        .count();
    let failed = results.len().saturating_sub(succeeded);
    let content = format!(
        "Batch fetched {} URLs ({} succeeded, {} failed).",
        urls.len(),
        succeeded,
        failed
    );
    NativeToolSuccess {
        content,
        raw: json!({
            "mode": mode,
            "total": urls.len(),
            "succeeded": succeeded,
            "failed": failed,
            "results": results,
            "recommendedNextAction": if failed > 0 {
                "Inspect failed entries and retry individual URLs with web_fetch."
            } else {
                "Use compactText/fitMarkdown from successful results for the task."
            },
        }),
        recommended_next_action: if failed > 0 {
            Some("Retry failed URLs individually with web_fetch.".to_string())
        } else {
            None
        },
    }
}

fn emit_web_job_progress(session_id: &str, turn_id: &str, job_id: &str, detail: Value) {
    let callback = event_callback();
    emit_with_callback(
        &callback,
        json!({
            "kind": "webJobProgress",
            "sessionId": session_id,
            "turnId": turn_id,
            "jobId": job_id,
            "detail": detail,
        }),
    );
}

fn web_map_content(seed_url: &str, discovered: &[Value]) -> String {
    let mut out = format!("Mapped {seed_url}");
    if discovered.is_empty() {
        out.push_str("\n\nNo URLs discovered.");
        return out;
    }
    out.push_str(&format!("\n\nDiscovered {} URLs:\n", discovered.len()));
    for (index, entry) in discovered.iter().take(20).enumerate() {
        let url = entry.get("url").and_then(Value::as_str).unwrap_or("");
        let title = entry.get("title").and_then(Value::as_str).unwrap_or("");
        let discovered_by = entry
            .get("discoveredBy")
            .and_then(Value::as_str)
            .unwrap_or("page");
        out.push_str(&format!(
            "{}. [{discovered_by}] {title}\n{url}\n",
            index + 1
        ));
    }
    if discovered.len() > 20 {
        out.push_str(&format!(
            "\n... and {} more in raw.urls\n",
            discovered.len() - 20
        ));
    }
    out
}

fn push_discovered_url(
    discovered: &mut Vec<Value>,
    seen: &mut HashSet<String>,
    url: &str,
    title: Option<String>,
    discovered_by: &str,
    same_origin: Option<&str>,
    limit: usize,
) {
    if discovered.len() >= limit {
        return;
    }
    let normalized = normalize_map_url(url);
    if normalized.is_empty() || seen.contains(&normalized) {
        return;
    }
    if let Some(origin) = same_origin {
        if !normalized.starts_with(origin) {
            return;
        }
    }
    if !normalized.starts_with("http://") && !normalized.starts_with("https://") {
        return;
    }
    seen.insert(normalized.clone());
    discovered.push(json!({
        "url": normalized,
        "title": title.filter(|value| !value.trim().is_empty()),
        "discoveredBy": discovered_by,
    }));
}

fn normalize_map_url(url: &str) -> String {
    let trimmed = url.trim();
    if trimmed.is_empty()
        || trimmed.starts_with('#')
        || trimmed.starts_with("mailto:")
        || trimmed.starts_with("javascript:")
    {
        return String::new();
    }
    trimmed
        .split('#')
        .next()
        .unwrap_or(trimmed)
        .trim()
        .to_string()
}

fn sitemap_candidates(parsed: &Url) -> Vec<String> {
    let host = parsed.host_str().unwrap_or_default();
    let mut candidates = vec![format!("{}://{host}/sitemap.xml", parsed.scheme())];
    if let Some(path) = parsed.path_segments() {
        let base: Vec<_> = path.collect();
        if base.len() > 1 {
            let joined = base[..base.len().saturating_sub(1)].join("/");
            if !joined.is_empty() {
                candidates.push(format!("{}://{host}/{joined}/sitemap.xml", parsed.scheme()));
            }
        }
    }
    candidates.sort();
    candidates.dedup();
    candidates
}

fn fetch_sitemap_body(url: &str, allow_private_network: bool) -> Result<String, String> {
    if !allow_private_network && is_private_network_url(url) {
        return Err("private network blocked".to_string());
    }
    let response = http_client_builder(Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::limited(3))
        .build()
        .map_err(|error| error.to_string())?
        .get(url)
        .header("user-agent", "Lyra Agent/0.1")
        .send()
        .map_err(|error| error.to_string())?;
    if !response.status().is_success() {
        return Err(format!("HTTP {}", response.status()));
    }
    let body = response.text().map_err(|error| error.to_string())?;
    if body.len() > 1_000_000 {
        return Err("sitemap too large".to_string());
    }
    Ok(body)
}

fn extract_sitemap_locations(body: &str) -> Vec<String> {
    let mut entries = Vec::new();
    let mut cursor = body;
    while let Some(start) = cursor.find("<loc>") {
        let next = &cursor[start + 5..];
        let Some(end) = next.find("</loc>") else {
            break;
        };
        let value = next[..end].trim();
        if value.starts_with("http://") || value.starts_with("https://") {
            entries.push(value.to_string());
        }
        cursor = &next[end + 6..];
    }
    entries
}

fn web_batch_urls_from_input(input: &Value) -> Vec<String> {
    let Some(value) = input.get("urls") else {
        return Vec::new();
    };
    let Some(items) = value.as_array() else {
        return Vec::new();
    };
    items
        .iter()
        .filter_map(Value::as_str)
        .map(str::trim)
        .filter(|url| !url.is_empty())
        .map(str::to_string)
        .collect()
}

fn is_private_network_url(url: &str) -> bool {
    let Ok(parsed) = Url::parse(url) else {
        return false;
    };
    let Some(host) = parsed.host_str() else {
        return false;
    };
    host == "localhost"
        || host.ends_with(".local")
        || host.starts_with("127.")
        || host.starts_with("10.")
        || host.starts_with("192.168.")
        || host == "::1"
}
