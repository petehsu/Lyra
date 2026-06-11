use super::*;

#[test]
fn native_web_tools_parse_fetch_and_return_structured_failures() {
    let html = r#"
        <html>
          <head><title>Example Page</title></head>
          <body>
            <a rel="nofollow" href="https://example.com/result" class="result__a">Example Result</a>
            <a class="result__snippet">Snippet &amp; detail</a>
            <main>
              <p>alpha beta gamma delta epsilon zeta eta theta iota kappa lambda</p>
              <p>Read <a href="/next">Next evidence</a>.</p>
            </main>
          </body>
        </html>
    "#;
    let parsed = parse_duckduckgo_results(html, 5);
    assert_eq!(parsed[0]["title"], "Example Result");
    assert_eq!(parsed[0]["url"], "https://example.com/result");
    assert!(parsed[0]["snippet"].as_str().unwrap().contains("Snippet"));
    let url = serve_http_once("HTTP/1.1 200 OK", "text/html; charset=utf-8", html);
    let fetched = tool_web_fetch(
        "turn-web",
        "tool-web-fetch",
        &json!({ "url": url, "maxChars": 24, "extractText": true, "includeLinks": true, "allowPrivateNetwork": true }),
    )
    .expect("fetch local html");
    assert_eq!(fetched.raw["status"], 200);
    assert_eq!(fetched.raw["format"], "html");
    assert_eq!(fetched.raw["title"], "Example Page");
    assert_eq!(fetched.raw["truncated"], true);
    assert!(fetched.raw["artifactRef"].is_object());
    assert!(fetched.raw["rawArtifactRef"].is_object());
    assert!(fetched.raw["markdown"].is_null());
    assert_eq!(fetched.raw["kind"], "web_fetch_summary");
    assert!(fetched.content.contains("Title: Example Page"));
    assert!(fetched.raw["timing"]["totalMs"].as_u64().is_some());
    assert!(!fetched.content.contains("totalMs"));
    assert!(fetched.content.contains("alpha beta"));
    assert!(
        fetched.raw["links"]
            .as_array()
            .unwrap()
            .iter()
            .any(|link| link["url"].as_str().unwrap().ends_with("/next"))
    );
    let focused_url = serve_http_once(
        "HTTP/1.1 200 OK",
        "text/html; charset=utf-8",
        r#"<html><body>
            <nav>Remove me</nav>
            <main>
              <h1>Rust Topic</h1><p>Ownership and borrowing details.</p>
              <p>Fruit apples oranges.</p>
            </main>
          </body></html>"#,
    );
    let focused = tool_web_fetch(
        "turn-web",
        "tool-web-focused",
        &json!({
            "url": focused_url,
            "targetSelector": "main",
            "removeSelector": "nav",
            "queryFocus": "ownership",
            "chunking": { "mode": "block", "maxCharsPerChunk": 48 },
            "includeDebugTrace": true,
            "allowPrivateNetwork": true
        }),
    )
    .expect("focused fetch");
    assert!(focused.content.contains("Ownership"));
    assert!(!focused.content.contains("Remove me"));
    assert!(focused.raw["counts"]["chunks"].as_u64().unwrap_or(0) >= 2);
    assert!(focused.raw["rawArtifactRef"].is_object());
    assert!(focused.raw["debugTrace"].is_null());
    assert!(!focused.content.contains("debugTrace"));

    let pdf_url = serve_http_bytes_once(
        "HTTP/1.1 200 OK",
        "application/pdf",
        &build_simple_pdf("Runtime PDF text"),
    );
    let pdf = tool_web_fetch(
        "turn-web",
        "tool-web-pdf",
        &json!({ "url": pdf_url, "allowPrivateNetwork": true }),
    )
    .expect("pdf fetch");
    assert_eq!(pdf.raw["format"], "pdf");
    assert!(pdf.content.contains("Runtime PDF text"));

    let mut png = vec![0u8; 24];
    png[..8].copy_from_slice(b"\x89PNG\r\n\x1A\n");
    png[16..20].copy_from_slice(&16u32.to_be_bytes());
    png[20..24].copy_from_slice(&8u32.to_be_bytes());
    let image_url = serve_http_bytes_once("HTTP/1.1 200 OK", "image/png", &png);
    let image = tool_web_fetch(
        "turn-web",
        "tool-web-image",
        &json!({ "url": image_url, "allowPrivateNetwork": true }),
    )
    .expect("image fetch");
    assert_eq!(image.raw["format"], "image");
    assert!(image.content.contains("Dimensions: 16 x 8"));
    assert!(
        image.raw["warnings"]
            .as_array()
            .unwrap()
            .iter()
            .any(|warning| warning["code"] == "ocr_recommended")
    );
    let image_without_ocr_url = serve_http_bytes_once("HTTP/1.1 200 OK", "image/png", &png);
    let image_without_ocr = tool_web_fetch(
        "turn-web",
        "tool-web-image-no-ocr",
        &json!({
            "url": image_without_ocr_url,
            "allowPrivateNetwork": true,
            "useOcr": false,
            "useCaption": false
        }),
    )
    .expect("image fetch without OCR/caption");
    assert!(
        !image_without_ocr.raw["warnings"]
            .as_array()
            .unwrap()
            .iter()
            .any(|warning| matches!(
                warning["code"].as_str(),
                Some("ocr_recommended" | "ocr_unavailable" | "caption_unavailable")
            ))
    );

    let final_url = serve_http_once(
        "HTTP/1.1 200 OK",
        "text/html; charset=utf-8",
        "<html><head><title>Redirected</title></head><body><main>redirect body</main></body></html>",
    );
    let redirect_url = serve_http_redirect_once(&final_url);
    let redirected = tool_web_fetch(
        "turn-web",
        "tool-web-redirect",
        &json!({ "url": redirect_url, "allowPrivateNetwork": true }),
    )
    .expect("redirect fetch");
    assert_eq!(
        redirected.raw["finalUrl"].as_str(),
        Some(final_url.as_str())
    );
    assert_eq!(redirected.raw["title"].as_str(), Some("Redirected"));

    let private_blocked = tool_web_fetch(
        "turn-web",
        "tool-web-private-blocked",
        &json!({ "url": "http://127.0.0.1:9/private" }),
    )
    .expect_err("private network should be blocked by default");
    assert_eq!(private_blocked.code, "network_failed");
    assert!(private_blocked.message.contains("private"));

    let forbidden_url = serve_http_once(
        "HTTP/1.1 403 Forbidden",
        "text/html; charset=utf-8",
        "blocked",
    );
    let forbidden = tool_web_fetch(
        "turn-web",
        "tool-web-forbidden",
        &json!({ "url": forbidden_url, "allowPrivateNetwork": true }),
    )
    .expect_err("forbidden response");
    assert_eq!(forbidden.code, "permission_denied");
    assert_eq!(forbidden.detail.unwrap()["status"], 403);
    let oversized_url = serve_http_once(
        "HTTP/1.1 200 OK",
        "text/html; charset=utf-8",
        "<html><body><main>this body is intentionally larger than max bytes</main></body></html>",
    );
    let oversized = tool_web_fetch(
        "turn-web",
        "tool-web-oversized",
        &json!({ "url": oversized_url, "maxBytes": 8, "allowPrivateNetwork": true }),
    )
    .expect_err("oversized response");
    assert_eq!(oversized.code, "network_failed");
    let oversized_detail = oversized.detail.expect("oversized detail");
    assert_eq!(oversized_detail["status"], 200);
    assert!(
        oversized
            .message
            .contains("response body exceeded maxBytes limit")
    );
    let binary_url = serve_http_bytes_once(
        "HTTP/1.1 200 OK",
        "application/octet-stream",
        &[0, 159, 146, 150],
    );
    let binary = tool_web_fetch(
        "turn-web",
        "tool-web-binary",
        &json!({ "url": binary_url, "allowPrivateNetwork": true }),
    )
    .expect_err("binary response");
    assert_eq!(binary.code, "unsupported_content_type");
    let binary_detail = binary.detail.unwrap();
    assert_eq!(binary_detail["mimeType"], "application/octet-stream");
    assert_eq!(
        binary_detail["warnings"][0]["code"].as_str(),
        Some("unsupported_format")
    );
}

#[test]
fn native_web_research_deep_reads_mocked_search_results() {
    let success_url = serve_http_once(
        "HTTP/1.1 200 OK",
        "text/html; charset=utf-8",
        r#"<html><head><title>Ownership Guide</title></head><body>
            <main>
              <h1>Rust ownership</h1>
              <p>Ownership borrowing lifetimes are the core topic for this result.</p>
              <p>Other unrelated fruit words should matter less.</p>
            </main>
        </body></html>"#,
    );
    let failed_url = serve_http_bytes_once(
        "HTTP/1.1 200 OK",
        "application/octet-stream",
        &[0, 159, 146, 150],
    );
    let results = vec![
        json!({
            "title": "Ownership Guide",
            "url": success_url,
            "snippet": "Rust ownership and borrowing guide."
        }),
        json!({
            "title": "Binary Result",
            "url": failed_url,
            "snippet": "This result cannot be rendered."
        }),
    ];
    let researched = build_web_research_result("ownership borrowing", 200, results, 2, 800, true);
    assert!(researched.content.contains("Research: ownership borrowing"));
    assert!(researched.content.contains("## Deep Reads"));
    assert!(researched.content.contains("Ownership borrowing lifetimes"));
    assert!(researched.content.contains("## Failed Reads"));
    assert_eq!(researched.raw["readTopN"], 2);
    assert_eq!(researched.raw["readResults"].as_array().unwrap().len(), 1);
    assert_eq!(researched.raw["failedReads"].as_array().unwrap().len(), 1);
    assert_eq!(researched.raw["sources"].as_array().unwrap().len(), 2);
    assert!(
        researched.raw["readResults"][0]["fitMarkdown"]
            .as_str()
            .unwrap()
            .contains("Ownership")
    );
    assert!(
        researched
            .recommended_next_action
            .as_deref()
            .unwrap_or("")
            .contains("web_fetch")
    );

    let empty = build_web_research_result("empty query", 200, Vec::new(), 3, 800, true);
    assert!(empty.content.contains("No structured search results"));
    assert!(
        empty
            .recommended_next_action
            .as_deref()
            .unwrap_or("")
            .contains("Refine")
    );
}

#[test]
fn native_web_fetch_browser_engine_uses_rendered_snapshot() {
    let payloads = Arc::new(Mutex::new(Vec::<Value>::new()));
    let payloads_for_dispatch = payloads.clone();
    let dispatcher: Arc<HostCapabilityDispatcher> = Arc::new(move |method, payload| {
        assert_eq!(method, "workbench.browser.readRenderedSnapshot");
        let payload: Value = serde_json::from_str(&payload).expect("payload json");
        payloads_for_dispatch
            .lock()
            .expect("payload lock")
            .push(payload);
        Ok(serde_json::to_string(&json!({
            "ok": true,
            "kind": "workbenchBrowserRenderedSnapshot",
            "tabId": "browser-tab-1",
            "finalUrl": "https://example.test/app",
            "title": "Rendered Browser App",
            "html": "<html><head><title>Rendered Browser App</title></head><body><main id=\"app\"><h1>Rendered Browser App</h1><p>Dynamic browser content loaded.</p></main></body></html>",
            "bodyText": "Rendered Browser App Dynamic browser content loaded.",
            "selectedElement": {
                "selector": "#app",
                "html": "<main id=\"app\">Dynamic browser content loaded.</main>",
                "text": "Dynamic browser content loaded."
            },
            "media": [{
                "kind": "video",
                "url": "https://example.test/demo.mp4",
                "title": "Demo video",
                "mimeType": "video/mp4",
                "width": 640,
                "height": 360
            }],
            "viewport": { "width": 390, "height": 844, "deviceScaleFactor": 3 },
            "warnings": [{ "code": "browser_wait_timeout", "message": "minor wait warning" }],
            "screenshot": {
                "mimeType": "image/png",
                "imageBase64": "AAAA",
                "width": 1,
                "height": 1,
                "visibleOnly": true
            },
            "pageshot": {
                "mimeType": "image/png",
                "imageBase64": "BBBB",
                "width": 390,
                "height": 1200,
                "visibleOnly": false
            }
        }))
        .expect("json"))
    });

    let fetched = tool_web_fetch_with_browser(
        "turn-web",
        "tool-web-browser",
        &json!({
            "url": "https://example.test/app",
            "engine": "browser",
            "waitForSelector": "#app",
            "browserMode": "newTab",
            "includeScreenshot": true,
            "targetSelector": "#app",
            "viewport": { "width": 390, "height": 844, "deviceScaleFactor": 3 },
            "mobile": true,
            "includeIframes": true,
            "includeShadowDom": true,
            "includePageshot": true,
            "includeMedia": true
        }),
        Some(&dispatcher),
    )
    .expect("browser fetch");

    assert_eq!(fetched.raw["engineUsed"], "browser");
    assert!(fetched.content.contains("Dynamic browser content"));
    assert_eq!(fetched.raw["browser"]["tabId"], "browser-tab-1");
    assert!(fetched.raw["screenshotArtifactRef"].is_object());
    assert!(fetched.raw["pageshotArtifactRef"].is_object());
    assert!(fetched.raw["browser"]["screenshot"].is_null());
    assert!(fetched.raw["browser"]["pageshot"].is_null());
    assert_eq!(
        fetched.raw["browser"]["selectedElement"]["selector"],
        "#app"
    );
    assert_eq!(fetched.raw["browser"]["viewport"]["width"], 390);
    assert_eq!(
        fetched.raw["media"][0]["url"],
        "https://example.test/demo.mp4"
    );
    assert!(
        fetched.raw["browserWarnings"]
            .as_array()
            .is_some_and(|warnings| !warnings.is_empty())
    );
    let first_payload = payloads.lock().expect("payload lock")[0].clone();
    assert_eq!(first_payload["waitForSelector"], "#app");
    assert_eq!(first_payload["browserMode"], "newTab");
    assert_eq!(first_payload["includeScreenshot"], true);
    assert_eq!(first_payload["targetSelector"], "#app");
    assert_eq!(first_payload["viewport"]["width"], 390);
    assert_eq!(first_payload["mobile"], true);
    assert_eq!(first_payload["includeIframes"], true);
    assert_eq!(first_payload["includeShadowDom"], true);
    assert_eq!(first_payload["includePageshot"], true);
    assert_eq!(first_payload["includeMedia"], true);
}

#[test]
fn native_web_fetch_include_media_defaults_to_summary_footer() {
    let url = serve_http_once(
        "HTTP/1.1 200 OK",
        "text/html; charset=utf-8",
        r#"<html><head><title>Media Page</title></head><body><main>
            <p>Static media page with enough readable text.</p>
            <video src="/movie.mp4" title="Demo video"></video>
        </main></body></html>"#,
    );

    let fetched = tool_web_fetch(
        "turn-web",
        "tool-web-media",
        &json!({
            "url": url,
            "engine": "http",
            "includeMedia": true,
            "allowPrivateNetwork": true
        }),
    )
    .expect("media fetch");

    assert!(
        fetched.raw["media"][0]["url"]
            .as_str()
            .is_some_and(|url| url.ends_with("/movie.mp4"))
    );
    assert!(fetched.content.contains("## Media"));
}

#[test]
fn native_web_fetch_retain_media_none_keeps_raw_media_without_footer() {
    let url = serve_http_once(
        "HTTP/1.1 200 OK",
        "text/html; charset=utf-8",
        r#"<html><head><title>Media Page</title></head><body><main>
            <p>Static media page with enough readable text.</p>
            <iframe src="https://www.youtube.com/embed/abc123" title="Demo clip"></iframe>
        </main></body></html>"#,
    );

    let fetched = tool_web_fetch(
        "turn-web",
        "tool-web-media-none",
        &json!({
            "url": url,
            "engine": "http",
            "includeMedia": true,
            "retainMedia": "none",
            "allowPrivateNetwork": true
        }),
    )
    .expect("media fetch");

    assert_eq!(
        fetched.raw["media"][0]["url"],
        "https://www.youtube.com/watch?v=abc123"
    );
    assert!(!fetched.content.contains("## Media"));
}

#[test]
fn native_web_fetch_markdown_citation_options_are_mapped() {
    let url = serve_http_once(
        "HTTP/1.1 200 OK",
        "text/html; charset=utf-8",
        r#"<html><head><title>Markdown Options</title></head><body><main>
            <h1>Markdown Options</h1>
            <p>Read <a href="https://example.test/docs">docs</a> and <mark onclick="bad()">highlight</mark>.</p>
        </main></body></html>"#,
    );

    let fetched = tool_web_fetch(
        "turn-web",
        "tool-web-markdown-options",
        &json!({
            "url": url,
            "engine": "http",
            "headingStyle": "setext",
            "citationFormat": "angle",
            "preserveHtmlTags": ["mark"],
            "allowPrivateNetwork": true
        }),
    )
    .expect("markdown options fetch");

    let markdown = fetched.content.as_str();
    assert!(markdown.contains("Markdown Options\n================"));
    assert!(markdown.contains("[docs](https://example.test/docs)⟨1⟩"));
    assert!(markdown.contains("⟨1⟩ docs — https://example.test/docs"));
    assert!(markdown.contains("<mark>highlight</mark>"));
    assert!(!markdown.contains("onclick"));
}

#[test]
fn native_web_fetch_http_engine_does_not_call_browser_dispatcher() {
    let url = serve_http_once(
        "HTTP/1.1 200 OK",
        "text/html; charset=utf-8",
        "<html><head><title>HTTP Only</title></head><body><main>static http body with enough readable words for the test</main></body></html>",
    );
    let dispatcher: Arc<HostCapabilityDispatcher> = Arc::new(|method, _payload| {
        panic!("unexpected browser host method {method}");
    });

    let fetched = tool_web_fetch_with_browser(
        "turn-web",
        "tool-web-http-only",
        &json!({ "url": url, "engine": "http", "allowPrivateNetwork": true }),
        Some(&dispatcher),
    )
    .expect("http fetch");

    assert_eq!(fetched.raw["engineUsed"], "http");
    assert_eq!(fetched.raw["title"], "HTTP Only");
}

#[test]
fn native_web_fetch_auto_falls_back_for_spa_shell() {
    let url = serve_http_once(
        "HTTP/1.1 200 OK",
        "text/html; charset=utf-8",
        r#"<html><head><title>Shell</title></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>"#,
    );
    let final_url = url.clone();
    let dispatcher: Arc<HostCapabilityDispatcher> = Arc::new(move |method, _payload| {
        assert_eq!(method, "workbench.browser.readRenderedSnapshot");
        Ok(serde_json::to_string(&json!({
            "ok": true,
            "kind": "workbenchBrowserRenderedSnapshot",
            "tabId": "browser-tab-2",
            "finalUrl": final_url,
            "title": "Rendered Shell",
            "html": "<html><head><title>Rendered Shell</title></head><body><main><p>SPA rendered evidence text.</p></main></body></html>",
            "bodyText": "SPA rendered evidence text.",
            "warnings": []
        }))
        .expect("json"))
    });

    let fetched = tool_web_fetch_with_browser(
        "turn-web",
        "tool-web-auto-browser",
        &json!({ "url": url, "allowPrivateNetwork": true }),
        Some(&dispatcher),
    )
    .expect("auto browser fetch");

    assert_eq!(fetched.raw["engineUsed"], "browser");
    assert!(fetched.content.contains("SPA rendered evidence"));
}

#[test]
fn native_web_fetch_auto_falls_back_for_forbidden_http_when_browser_available() {
    let url = serve_http_once(
        "HTTP/1.1 403 Forbidden",
        "text/html; charset=utf-8",
        "blocked",
    );
    let final_url = url.clone();
    let dispatcher: Arc<HostCapabilityDispatcher> = Arc::new(move |method, _payload| {
        assert_eq!(method, "workbench.browser.readRenderedSnapshot");
        Ok(serde_json::to_string(&json!({
            "ok": true,
            "kind": "workbenchBrowserRenderedSnapshot",
            "tabId": "browser-auth-tab",
            "finalUrl": final_url,
            "title": "Authorized Page",
            "html": "<html><head><title>Authorized Page</title></head><body><main><p>Browser session unlocked the blocked page.</p></main></body></html>",
            "bodyText": "Browser session unlocked the blocked page.",
            "warnings": []
        }))
        .expect("json"))
    });

    let fetched = tool_web_fetch_with_browser(
        "turn-web",
        "tool-web-auto-forbidden",
        &json!({ "url": url, "engine": "auto", "allowPrivateNetwork": true }),
        Some(&dispatcher),
    )
    .expect("browser fallback for forbidden page");

    assert_eq!(fetched.raw["engineUsed"], "browser");
    assert!(fetched.content.contains("unlocked the blocked page"));
}

#[test]
fn native_web_fetch_browser_unavailable_and_auto_http_recommendation() {
    let err = tool_web_fetch_with_browser(
        "turn-web",
        "tool-web-browser-missing",
        &json!({ "url": "https://example.test/app", "engine": "browser" }),
        None,
    )
    .expect_err("browser unavailable");
    assert_eq!(err.code, "browser_unavailable");

    let url = serve_http_once(
        "HTTP/1.1 200 OK",
        "text/html; charset=utf-8",
        r#"<html><body><div id="root"></div><script src="/bundle.js"></script></body></html>"#,
    );
    let fetched = tool_web_fetch_with_browser(
        "turn-web",
        "tool-web-auto-no-browser",
        &json!({ "url": url, "allowPrivateNetwork": true }),
        None,
    )
    .expect("auto http fallback");
    assert_eq!(fetched.raw["engineUsed"], "http");
    assert!(
        fetched
            .recommended_next_action
            .as_deref()
            .unwrap_or("")
            .contains("browser")
    );
}

#[test]
fn tool_fs_web_fetch_browser_engine_uses_host_dispatcher() {
    let backend = LyraAgentBackend;
    let created = backend
        .call_agent_method(
            "agent.session.create",
            json!({ "title": "Tool-FS Browser Fetch" }),
        )
        .expect("create session");
    let session_id = created["id"].as_str().expect("session id").to_string();
    let turn_id = start_test_runtime_turn(&session_id);
    let cancellation = Arc::new(AtomicBool::new(false));
    let dispatcher: Arc<HostCapabilityDispatcher> = Arc::new(move |method, payload| {
        assert_eq!(method, "workbench.browser.readRenderedSnapshot");
        let payload: Value = serde_json::from_str(&payload).expect("payload json");
        assert_eq!(payload["browserMode"], "matchingOrNewTab");
        Ok(serde_json::to_string(&json!({
            "ok": true,
            "kind": "workbenchBrowserRenderedSnapshot",
            "tabId": "browser-tab-tool-fs",
            "finalUrl": "https://example.test/tool-fs",
            "title": "Tool FS Rendered",
            "html": "<html><head><title>Tool FS Rendered</title></head><body><main>tool fs browser rendered text</main></body></html>",
            "bodyText": "tool fs browser rendered text",
            "warnings": []
        }))
        .expect("json"))
    });

    let output = execute_model_tool(
        &session_id,
        &turn_id,
        &Some(dispatcher),
        &cancellation,
        tool_fs_run_call(
            "tool-fs-web-browser-fetch",
            "/tools/web/fetch",
            json!({
                "url": "https://example.test/tool-fs",
                "engine": "browser"
            }),
        ),
    );

    assert_eq!(output["status"].as_str(), Some("completed"));
    assert_eq!(output["toolPath"].as_str(), Some("/tools/web/fetch"));
    assert_eq!(output["raw"]["engineUsed"], "browser");
    assert!(
        output["content"]
            .as_str()
            .expect("content")
            .contains("tool fs browser rendered text")
    );
}

#[test]
fn tool_fs_web_and_network_read_tools_are_runnable() {
    let backend = LyraAgentBackend;
    let created = backend
        .call_agent_method(
            "agent.session.create",
            json!({ "title": "Tool-FS Web Network Coverage" }),
        )
        .expect("create session");
    let session_id = created["id"].as_str().expect("session id").to_string();
    let turn_id = start_test_runtime_turn(&session_id);
    let cancellation = Arc::new(AtomicBool::new(false));
    let url = serve_http_once(
        "HTTP/1.1 200 OK",
        "text/html; charset=utf-8",
        "<html><head><title>Tool FS Web</title></head><body>local web evidence</body></html>",
    );
    let fetched = execute_model_tool(
        &session_id,
        &turn_id,
        &None,
        &cancellation,
        tool_fs_run_call(
            "tool-fs-web-fetch",
            "/tools/web/fetch",
            json!({
                "url": url,
                "maxChars": 128,
                "extractText": true,
                "allowPrivateNetwork": true
            }),
        ),
    );
    assert_eq!(fetched["status"].as_str(), Some("completed"));
    assert_eq!(fetched["toolPath"].as_str(), Some("/tools/web/fetch"));
    assert_eq!(fetched["raw"]["title"].as_str(), Some("Tool FS Web"));
    assert!(
        fetched["content"]
            .as_str()
            .expect("web fetch content")
            .contains("Tool FS Web")
    );

    let network = execute_model_tool(
        &session_id,
        &turn_id,
        &None,
        &cancellation,
        tool_fs_run_call("tool-fs-network", "/tools/network/status", json!({})),
    );
    assert_eq!(network["status"].as_str(), Some("completed"));
    assert_eq!(network["toolPath"].as_str(), Some("/tools/network/status"));
    assert_eq!(
        network
            .pointer("/raw/nativeHttpClient/implementation")
            .and_then(Value::as_str),
        Some("reqwest")
    );
}
