use reqwest::blocking::{Client, Response};
use reqwest::redirect::Policy;
use scraper::{Html, Selector};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet, VecDeque};
use std::io::Read;
use std::sync::{Arc, OnceLock, RwLock};
use std::time::Duration;
use url::Url;
use uuid::Uuid;

const REQUEST_TIMEOUT_SECS: u64 = 10;
const MAX_HTML_BYTES: u64 = 512 * 1024;
const MAX_XML_BYTES: u64 = 1024 * 1024;
const USER_AGENT: &str = "Mozilla/5.0 Lyra/0.1 (site-expansion)";
const HIGH_VALUE_SUBDOMAINS: [&str; 15] = [
    "www",
    "docs",
    "developer",
    "developers",
    "help",
    "support",
    "blog",
    "status",
    "app",
    "login",
    "account",
    "api",
    "pricing",
    "download",
    "community",
];
const BLOCKED_PATH_SEGMENTS: [&str; 7] = [
    "/logout",
    "/signout",
    "/delete",
    "/cart",
    "/checkout",
    "/billing",
    "/wp-admin",
];
const COMMON_MULTI_LEVEL_SUFFIXES: [&str; 8] = [
    "com.cn", "com.hk", "com.tw", "co.jp", "co.kr", "co.uk", "com.au", "co.nz",
];

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchSiteStreamStartRequest {
    pub query: String,
    pub understanding: SearchSiteQueryUnderstanding,
    pub budget_preset: SearchSiteBudgetPreset,
    #[serde(default)]
    pub seeds: Vec<SearchSiteSeed>,
    #[serde(default)]
    pub targets: Vec<SearchSiteTarget>,
    #[serde(default)]
    pub enable_proactive_domain_guessing: Option<bool>,
    #[serde(default)]
    pub crawl_policy: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchSiteStreamReadRequest {
    pub stream_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchSiteStreamCancelRequest {
    pub stream_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchSiteQueryUnderstanding {
    pub entity_candidate: String,
    pub primary_intent: String,
    pub official_hint: bool,
    pub docs_hint: bool,
    pub login_hint: bool,
    pub download_hint: bool,
    pub contains_cjk: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchSiteSeed {
    pub registrable_domain: String,
    pub hostname: String,
    pub url: String,
    pub title: String,
    pub snippet: String,
    #[serde(default)]
    pub source_engine_ids: Vec<String>,
    pub is_official_result: bool,
    pub guess_source: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchSiteTarget {
    pub registrable_domain: String,
    #[serde(default)]
    pub candidate_urls: Vec<String>,
    #[serde(default)]
    pub hostnames: Vec<String>,
    pub score: f64,
    pub official_weight: f64,
    #[serde(default)]
    pub guess_sources: Vec<String>,
    pub guessed_only: bool,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SearchSiteBudgetPreset {
    Low,
    Medium,
    High,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchSiteDomain {
    pub registrable_domain: String,
    pub final_url: String,
    pub verification_score: f64,
    pub verified_from: String,
    pub guess_sources: Vec<String>,
    pub is_official_result: Option<bool>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchSiteSubdomain {
    pub hostname: String,
    pub registrable_domain: String,
    pub final_url: String,
    pub verification_score: f64,
    pub discovered_by: String,
    pub is_official_result: Option<bool>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchSitePage {
    pub url: String,
    pub title: String,
    pub canonical_url: Option<String>,
    pub hostname: String,
    pub registrable_domain: String,
    pub snippet: Option<String>,
    pub content_preview: Option<String>,
    pub fetch_depth: u32,
    pub discovered_by: String,
    pub parent_host: String,
    pub source_engine_ids: Option<Vec<String>>,
    pub is_official_result: Option<bool>,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchSiteStats {
    pub domain_candidates: u64,
    pub verified_domains: u64,
    pub discovered_subdomains: u64,
    pub visited_pages: u64,
    pub queued_pages: u64,
    pub dropped_pages: u64,
    pub guess_attempts: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchSiteStreamSnapshot {
    pub query: String,
    pub status: String,
    pub stats: SearchSiteStats,
    pub domains: Vec<SearchSiteDomain>,
    pub subdomains: Vec<SearchSiteSubdomain>,
    pub pages: Vec<SearchSitePage>,
    pub done: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchSiteStreamStartResponse {
    pub stream_id: String,
    pub snapshot: SearchSiteStreamSnapshot,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchSiteStreamReadResponse {
    pub stream_id: String,
    pub snapshot: SearchSiteStreamSnapshot,
    pub done: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchSiteStreamCancelResponse {
    pub removed: bool,
}

#[derive(Debug, Clone)]
struct SearchSiteStreamState {
    snapshot: SearchSiteStreamSnapshot,
    cancelled: bool,
}

#[derive(Debug, Clone, Copy)]
struct SiteBudget {
    max_domain_families: usize,
    max_subdomains: usize,
    max_pages: usize,
    max_depth: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SearchSiteCrawlPolicy {
    AccessibilityOnly,
}

#[derive(Debug, Clone)]
struct FetchedDocument {
    final_url: String,
    hostname: String,
    registrable_domain: String,
    title: String,
    snippet: String,
    content_preview: String,
    canonical_url: Option<String>,
    links: Vec<String>,
    sitemap_urls: Vec<String>,
}

static SITE_STREAMS: OnceLock<RwLock<HashMap<String, Arc<RwLock<SearchSiteStreamState>>>>> =
    OnceLock::new();

fn site_stream_store() -> &'static RwLock<HashMap<String, Arc<RwLock<SearchSiteStreamState>>>> {
    SITE_STREAMS.get_or_init(|| RwLock::new(HashMap::new()))
}

fn resolve_budget(preset: SearchSiteBudgetPreset) -> SiteBudget {
    match preset {
        SearchSiteBudgetPreset::Low => SiteBudget {
            max_domain_families: 1,
            max_subdomains: 6,
            max_pages: 16,
            max_depth: 1,
        },
        SearchSiteBudgetPreset::High => SiteBudget {
            max_domain_families: 4,
            max_subdomains: 24,
            max_pages: 64,
            max_depth: 3,
        },
        SearchSiteBudgetPreset::Medium => SiteBudget {
            max_domain_families: 2,
            max_subdomains: 12,
            max_pages: 32,
            max_depth: 2,
        },
    }
}

fn resolve_crawl_policy(value: Option<&str>) -> SearchSiteCrawlPolicy {
    match value.unwrap_or("accessibility_only") {
        "accessibility_only" => SearchSiteCrawlPolicy::AccessibilityOnly,
        _ => SearchSiteCrawlPolicy::AccessibilityOnly,
    }
}

fn apply_site_request_policy(request: &mut SearchSiteStreamStartRequest) {
    let enable_proactive_domain_guessing = request.enable_proactive_domain_guessing.unwrap_or(true);
    if enable_proactive_domain_guessing {
        return;
    }
    request.seeds.retain(|seed| seed.guess_source != "guessed");
    request.targets.retain(|target| !target.guessed_only);
}

fn create_snapshot(query: &str) -> SearchSiteStreamSnapshot {
    SearchSiteStreamSnapshot {
        query: query.to_string(),
        status: "loading".to_string(),
        stats: SearchSiteStats::default(),
        domains: Vec::new(),
        subdomains: Vec::new(),
        pages: Vec::new(),
        done: false,
        error: None,
    }
}

fn build_client() -> Result<Client, String> {
    Client::builder()
        .user_agent(USER_AGENT)
        .timeout(Duration::from_secs(REQUEST_TIMEOUT_SECS))
        .redirect(Policy::limited(10))
        .build()
        .map_err(|error| format!("build site expansion client failed: {error}"))
}

fn normalize_url_key(url: &str) -> String {
    match Url::parse(url) {
        Ok(mut parsed) => {
            parsed.set_fragment(None);
            parsed.set_query(None);
            parsed.to_string()
        }
        Err(_) => url.to_string(),
    }
}

fn to_registrable_domain(hostname: &str) -> String {
    let normalized = hostname
        .to_lowercase()
        .trim_start_matches("www.")
        .to_string();
    let segments = normalized
        .split('.')
        .filter(|segment| !segment.is_empty())
        .collect::<Vec<_>>();
    if segments.len() <= 2 {
        return normalized;
    }
    let last_two = segments[segments.len() - 2..].join(".");
    if COMMON_MULTI_LEVEL_SUFFIXES.contains(&last_two.as_str()) && segments.len() >= 3 {
        return segments[segments.len() - 3..].join(".");
    }
    segments[segments.len() - 2..].join(".")
}

fn is_blocked_path(path: &str) -> bool {
    BLOCKED_PATH_SEGMENTS
        .iter()
        .any(|segment| path.contains(segment))
}

fn join_url(base: &str, href: &str) -> Option<String> {
    if href.trim().is_empty() || href.starts_with('#') || href.starts_with("javascript:") {
        return None;
    }
    let base_url = Url::parse(base).ok()?;
    let joined = base_url.join(href).ok()?;
    if joined.scheme() != "http" && joined.scheme() != "https" {
        return None;
    }
    Some(joined.to_string())
}

fn read_response_body(response: Response, byte_limit: u64) -> Result<String, String> {
    let mut buffer = Vec::new();
    response
        .take(byte_limit)
        .read_to_end(&mut buffer)
        .map_err(|error| format!("read response body failed: {error}"))?;
    Ok(String::from_utf8_lossy(&buffer).into_owned())
}

fn select_text(document: &Html, selector: &str) -> Option<String> {
    let selector = Selector::parse(selector).ok()?;
    let text = document
        .select(&selector)
        .next()?
        .text()
        .collect::<Vec<_>>()
        .join(" ");
    let compact = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if compact.is_empty() {
        None
    } else {
        Some(compact)
    }
}

fn attribute(document: &Html, selector: &str, attribute_name: &str) -> Option<String> {
    let selector = Selector::parse(selector).ok()?;
    document
        .select(&selector)
        .next()?
        .value()
        .attr(attribute_name)
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn extract_html_links(final_url: &str, document: &Html) -> Vec<String> {
    let selector = match Selector::parse("a[href]") {
        Ok(selector) => selector,
        Err(_) => return Vec::new(),
    };
    let mut links = Vec::new();
    let mut seen = HashSet::new();
    for node in document.select(&selector) {
        let Some(href) = node.value().attr("href") else {
            continue;
        };
        let Some(link) = join_url(final_url, href) else {
            continue;
        };
        let key = normalize_url_key(&link);
        if seen.insert(key) {
            links.push(link);
        }
    }
    links
}

fn extract_sitemap_links(body: &str) -> Vec<String> {
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

fn extract_text_preview(document: &Html) -> String {
    document
        .root_element()
        .text()
        .collect::<Vec<_>>()
        .join(" ")
        .split_whitespace()
        .take(80)
        .collect::<Vec<_>>()
        .join(" ")
}

fn fetch_document(client: &Client, url: &str) -> Result<FetchedDocument, String> {
    let _ = client.head(url).send();
    let response = client
        .get(url)
        .header(
            "accept",
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        )
        .send()
        .map_err(|error| format!("fetch {url} failed: {error}"))?;
    if !response.status().is_success() && !response.status().is_redirection() {
        return Err(format!("fetch {url} returned HTTP {}", response.status()));
    }
    let final_url = response.url().to_string();
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("")
        .to_lowercase();
    let body = read_response_body(
        response,
        if content_type.contains("xml") {
            MAX_XML_BYTES
        } else {
            MAX_HTML_BYTES
        },
    )?;
    let parsed_final =
        Url::parse(&final_url).map_err(|error| format!("parse final url failed: {error}"))?;
    let hostname = parsed_final.host_str().unwrap_or_default().to_lowercase();
    let registrable_domain = to_registrable_domain(&hostname);
    if content_type.contains("xml") {
        return Ok(FetchedDocument {
            final_url,
            hostname,
            registrable_domain,
            title: parsed_final.path().to_string(),
            snippet: String::new(),
            content_preview: String::new(),
            canonical_url: None,
            links: extract_sitemap_links(&body),
            sitemap_urls: vec![],
        });
    }

    let document = Html::parse_document(&body);
    let title = select_text(&document, "title").unwrap_or_else(|| hostname.clone());
    let snippet = attribute(&document, "meta[name='description']", "content")
        .or_else(|| attribute(&document, "meta[property='og:description']", "content"))
        .unwrap_or_default();
    let canonical_url = attribute(&document, "link[rel='canonical']", "href")
        .and_then(|value| join_url(&final_url, &value));
    let sitemap_from_link = attribute(&document, "link[rel='sitemap']", "href")
        .and_then(|value| join_url(&final_url, &value));
    let mut sitemap_urls = vec![format!(
        "{}://{}/sitemap.xml",
        parsed_final.scheme(),
        hostname
    )];
    if let Some(link) = sitemap_from_link {
        sitemap_urls.push(link);
    }
    let content_preview = extract_text_preview(&document);
    Ok(FetchedDocument {
        final_url: final_url.clone(),
        hostname,
        registrable_domain,
        title,
        snippet,
        content_preview,
        canonical_url,
        links: extract_html_links(&final_url, &document),
        sitemap_urls,
    })
}

fn verify_candidate(
    client: &Client,
    urls: &[String],
    registrable_domain: &str,
) -> Option<FetchedDocument> {
    for url in urls {
        let Ok(document) = fetch_document(client, url) else {
            continue;
        };
        if document.registrable_domain == registrable_domain {
            return Some(document);
        }
    }
    None
}

fn update_state<F>(state: &Arc<RwLock<SearchSiteStreamState>>, updater: F)
where
    F: FnOnce(&mut SearchSiteStreamState),
{
    if let Ok(mut guard) = state.write() {
        updater(&mut guard);
    }
}

fn is_cancelled(state: &Arc<RwLock<SearchSiteStreamState>>) -> bool {
    state.read().map(|guard| guard.cancelled).unwrap_or(true)
}

fn push_domain(state: &Arc<RwLock<SearchSiteStreamState>>, domain: SearchSiteDomain) {
    update_state(state, |guard| {
        if guard
            .snapshot
            .domains
            .iter()
            .any(|entry| entry.registrable_domain == domain.registrable_domain)
        {
            return;
        }
        guard.snapshot.domains.push(domain);
        guard.snapshot.stats.verified_domains += 1;
    });
}

fn push_subdomain(state: &Arc<RwLock<SearchSiteStreamState>>, subdomain: SearchSiteSubdomain) {
    update_state(state, |guard| {
        if guard
            .snapshot
            .subdomains
            .iter()
            .any(|entry| entry.hostname == subdomain.hostname)
        {
            return;
        }
        guard.snapshot.subdomains.push(subdomain);
        guard.snapshot.stats.discovered_subdomains += 1;
    });
}

fn push_page(state: &Arc<RwLock<SearchSiteStreamState>>, page: SearchSitePage) {
    update_state(state, |guard| {
        if guard.snapshot.pages.iter().any(|entry| {
            normalize_url_key(&entry.url) == normalize_url_key(&page.url)
                || entry.canonical_url.as_deref().map(normalize_url_key)
                    == page.canonical_url.as_deref().map(normalize_url_key)
        }) {
            return;
        }
        guard.snapshot.pages.push(page);
        guard.snapshot.stats.visited_pages += 1;
    });
}

fn default_domain_urls(registrable_domain: &str) -> Vec<String> {
    vec![
        format!("https://{registrable_domain}/"),
        format!("https://www.{registrable_domain}/"),
        format!("http://{registrable_domain}/"),
    ]
}

fn is_same_domain(url: &str, registrable_domain: &str) -> bool {
    match Url::parse(url) {
        Ok(parsed) => parsed
            .host_str()
            .map(|host| to_registrable_domain(host) == registrable_domain)
            .unwrap_or(false),
        Err(_) => false,
    }
}

fn filter_same_domain_links(links: Vec<String>, registrable_domain: &str) -> Vec<String> {
    let mut seen = HashSet::new();
    links
        .into_iter()
        .filter(|link| is_same_domain(link, registrable_domain))
        .filter(|link| {
            Url::parse(link)
                .ok()
                .map(|parsed| !is_blocked_path(parsed.path()))
                .unwrap_or(false)
        })
        .filter(|link| seen.insert(normalize_url_key(link)))
        .collect()
}

fn hint_priority(hostname: &str, path: &str, understanding: &SearchSiteQueryUnderstanding) -> i32 {
    let host = hostname.to_lowercase();
    let path = path.to_lowercase();
    let primary_intent = understanding.primary_intent.to_lowercase();
    let docs_hint = understanding.docs_hint
        || primary_intent.contains("doc")
        || primary_intent.contains("developer")
        || primary_intent.contains("api");
    let login_hint = understanding.login_hint
        || primary_intent.contains("login")
        || primary_intent.contains("sign in")
        || primary_intent.contains("account");
    let download_hint = understanding.download_hint
        || primary_intent.contains("download")
        || primary_intent.contains("install")
        || primary_intent.contains("release");
    let mut score = 0;
    if docs_hint {
        if host.starts_with("docs.") {
            score += 60;
        }
        if host.starts_with("developer.") || host.starts_with("developers.") {
            score += 55;
        }
        if path.contains("/docs") || path.contains("/documentation") {
            score += 45;
        }
        if path.contains("/developer") || path.contains("/api") {
            score += 25;
        }
    }
    if login_hint {
        if host.starts_with("login.") {
            score += 60;
        }
        if host.starts_with("app.") {
            score += 50;
        }
        if host.starts_with("account.") || host.starts_with("accounts.") {
            score += 45;
        }
        if path.contains("/login") || path.contains("/signin") || path.contains("/sign-in") {
            score += 45;
        }
        if path.contains("/account") || path.contains("/dashboard") {
            score += 25;
        }
    }
    if download_hint {
        if host.starts_with("download.") || host.starts_with("downloads.") {
            score += 60;
        }
        if path.contains("/download") || path.contains("/downloads") {
            score += 50;
        }
        if path.contains("/releases") || path.contains("/install") {
            score += 25;
        }
    }
    let entity_hint = understanding
        .entity_candidate
        .to_lowercase()
        .replace(|character: char| !character.is_ascii_alphanumeric(), "");
    if !entity_hint.is_empty() {
        let compact_host = host.replace(|character: char| !character.is_ascii_alphanumeric(), "");
        let compact_path = path.replace(|character: char| !character.is_ascii_alphanumeric(), "");
        if compact_host.contains(&entity_hint) || compact_path.contains(&entity_hint) {
            score += 8;
        }
    }
    if understanding.contains_cjk
        && (path.contains("/zh")
            || path.contains("/cn")
            || path.contains("/ja")
            || path.contains("/ko"))
    {
        score += 5;
    }
    score
}

fn hint_priority_for_text(text: &str, understanding: &SearchSiteQueryUnderstanding) -> i32 {
    let value = text.to_lowercase();
    let mut score = 0;
    if understanding.docs_hint
        && (value.contains("docs")
            || value.contains("documentation")
            || value.contains("developer")
            || value.contains("api"))
    {
        score += 20;
    }
    if understanding.login_hint
        && (value.contains("login")
            || value.contains("sign in")
            || value.contains("account")
            || value.contains("dashboard"))
    {
        score += 20;
    }
    if understanding.download_hint
        && (value.contains("download") || value.contains("install") || value.contains("release"))
    {
        score += 20;
    }
    score
}

fn hint_priority_for_url(url: &str, understanding: &SearchSiteQueryUnderstanding) -> i32 {
    Url::parse(url)
        .ok()
        .and_then(|parsed| {
            parsed
                .host_str()
                .map(|host| hint_priority(host, parsed.path(), understanding))
        })
        .unwrap_or(0)
}

fn hint_priority_for_hostname(hostname: &str, understanding: &SearchSiteQueryUnderstanding) -> i32 {
    hint_priority(hostname, "/", understanding)
}

fn hint_priority_for_seed(
    seed: &SearchSiteSeed,
    understanding: &SearchSiteQueryUnderstanding,
) -> i32 {
    hint_priority_for_url(&seed.url, understanding)
        + hint_priority_for_text(&seed.title, understanding)
        + hint_priority_for_text(&seed.snippet, understanding)
}

fn sort_urls_by_hints(urls: &mut [String], understanding: &SearchSiteQueryUnderstanding) {
    urls.sort_by(|left, right| {
        let right_score = hint_priority_for_url(right, understanding);
        let left_score = hint_priority_for_url(left, understanding);
        right_score.cmp(&left_score).then_with(|| left.cmp(right))
    });
}

fn hint_priority_for_target(
    target: &SearchSiteTarget,
    understanding: &SearchSiteQueryUnderstanding,
) -> i32 {
    target
        .candidate_urls
        .iter()
        .map(|url| hint_priority_for_url(url, understanding))
        .chain(
            target
                .hostnames
                .iter()
                .map(|hostname| hint_priority_for_hostname(hostname, understanding)),
        )
        .max()
        .unwrap_or(0)
}

fn discover_sitemap_pages(
    client: &Client,
    sitemap_urls: &[String],
    registrable_domain: &str,
) -> Vec<String> {
    let mut all_urls = Vec::new();
    let mut seen = HashSet::new();
    for sitemap_url in sitemap_urls {
        let Ok(document) = fetch_document(client, sitemap_url) else {
            continue;
        };
        for link in document.links {
            if !is_same_domain(&link, registrable_domain) {
                continue;
            }
            let key = normalize_url_key(&link);
            if seen.insert(key) {
                all_urls.push(link);
            }
        }
    }
    all_urls
}

fn build_subdomain_candidates(
    registrable_domain: &str,
    target: &SearchSiteTarget,
    seed_links: &[String],
    sitemap_links: &[String],
) -> Vec<(String, String)> {
    let mut hostnames = HashSet::new();
    for hostname in &target.hostnames {
        if to_registrable_domain(hostname) == registrable_domain {
            hostnames.insert((hostname.clone(), "result".to_string()));
        }
    }
    for prefix in HIGH_VALUE_SUBDOMAINS {
        hostnames.insert((
            format!("{prefix}.{registrable_domain}"),
            "guess".to_string(),
        ));
    }
    for link in seed_links.iter().chain(sitemap_links.iter()) {
        if let Ok(parsed) = Url::parse(link) {
            if let Some(host) = parsed.host_str() {
                let host = host.to_lowercase();
                if to_registrable_domain(&host) == registrable_domain && host != registrable_domain
                {
                    hostnames.insert((
                        host.clone(),
                        if seed_links.iter().any(|entry| entry == link) {
                            "html".to_string()
                        } else {
                            "sitemap".to_string()
                        },
                    ));
                }
            }
        }
    }
    hostnames.into_iter().collect()
}

fn crawl_domain(
    client: &Client,
    request: &SearchSiteStreamStartRequest,
    state: &Arc<RwLock<SearchSiteStreamState>>,
    budget: SiteBudget,
    crawl_policy: SearchSiteCrawlPolicy,
    target: &SearchSiteTarget,
    document: &FetchedDocument,
) {
    let registrable_domain = &target.registrable_domain;
    let (mut same_domain_links, mut sitemap_links) = match crawl_policy {
        SearchSiteCrawlPolicy::AccessibilityOnly => (
            filter_same_domain_links(document.links.clone(), registrable_domain),
            discover_sitemap_pages(client, &document.sitemap_urls, registrable_domain),
        ),
    };
    sort_urls_by_hints(&mut same_domain_links, &request.understanding);
    sort_urls_by_hints(&mut sitemap_links, &request.understanding);

    let mut subdomain_candidates = build_subdomain_candidates(
        registrable_domain,
        target,
        &same_domain_links,
        &sitemap_links,
    );
    subdomain_candidates.sort_by(|left, right| {
        let right_score = hint_priority_for_hostname(&right.0, &request.understanding);
        let left_score = hint_priority_for_hostname(&left.0, &request.understanding);
        right_score
            .cmp(&left_score)
            .then_with(|| left.0.cmp(&right.0))
    });
    let mut verified_subdomains = HashSet::new();
    for (hostname, discovered_by) in subdomain_candidates.into_iter().take(budget.max_subdomains) {
        if is_cancelled(state) {
            return;
        }
        if hostname == *registrable_domain || verified_subdomains.contains(&hostname) {
            continue;
        }
        let urls = vec![
            format!("https://{hostname}/"),
            format!("http://{hostname}/"),
        ];
        let Some(sub_document) = verify_candidate(client, &urls, registrable_domain) else {
            continue;
        };
        verified_subdomains.insert(hostname.clone());
        push_subdomain(
            state,
            SearchSiteSubdomain {
                hostname: hostname.clone(),
                registrable_domain: registrable_domain.clone(),
                final_url: sub_document.final_url.clone(),
                verification_score: 72.0,
                discovered_by: discovered_by.clone(),
                is_official_result: Some(
                    request.understanding.official_hint || discovered_by == "result",
                ),
            },
        );
    }

    let mut queued = VecDeque::new();
    let mut seen_urls = HashSet::new();

    let mut seeds = request
        .seeds
        .iter()
        .filter(|seed| seed.registrable_domain == *registrable_domain)
        .collect::<Vec<_>>();
    seeds.sort_by(|left, right| {
        let right_score = hint_priority_for_seed(right, &request.understanding);
        let left_score = hint_priority_for_seed(left, &request.understanding);
        right_score
            .cmp(&left_score)
            .then_with(|| left.url.cmp(&right.url))
    });
    for seed in seeds {
        let key = normalize_url_key(&seed.url);
        if seen_urls.insert(key) {
            queued.push_back((
                seed.url.clone(),
                0_u32,
                seed.hostname.clone(),
                "search".to_string(),
                Some(seed.clone()),
            ));
        }
    }

    let landing_key = normalize_url_key(&document.final_url);
    if seen_urls.insert(landing_key) {
        queued.push_back((
            document.final_url.clone(),
            0_u32,
            document.hostname.clone(),
            if document.final_url != format!("https://{registrable_domain}/") {
                "redirect".to_string()
            } else {
                "html".to_string()
            },
            None,
        ));
    }

    let mut discovered_links = sitemap_links
        .into_iter()
        .chain(same_domain_links.into_iter())
        .collect::<Vec<_>>();
    sort_urls_by_hints(&mut discovered_links, &request.understanding);
    for link in discovered_links {
        let key = normalize_url_key(&link);
        if seen_urls.insert(key) {
            let discovered_by = if link.contains("sitemap") {
                "sitemap"
            } else {
                "html"
            };
            let parent_host = Url::parse(&link)
                .ok()
                .and_then(|parsed| parsed.host_str().map(|host| host.to_lowercase()))
                .unwrap_or_else(|| registrable_domain.clone());
            queued.push_back((link, 1_u32, parent_host, discovered_by.to_string(), None));
        }
    }

    while let Some((url, depth, parent_host, discovered_by, seed)) = queued.pop_front() {
        if is_cancelled(state) {
            return;
        }
        update_state(state, |guard| {
            guard.snapshot.stats.queued_pages = queued.len() as u64;
        });
        if depth > budget.max_depth
            || is_blocked_path(
                Url::parse(&url)
                    .ok()
                    .map(|parsed| parsed.path().to_string())
                    .unwrap_or_default()
                    .as_str(),
            )
        {
            update_state(state, |guard| {
                guard.snapshot.stats.dropped_pages += 1;
            });
            continue;
        }
        let Ok(page_document) = fetch_document(client, &url) else {
            update_state(state, |guard| {
                guard.snapshot.stats.dropped_pages += 1;
            });
            continue;
        };
        if page_document.registrable_domain != *registrable_domain {
            continue;
        }
        let seed_source_engines = seed.as_ref().map(|entry| entry.source_engine_ids.clone());
        let is_official = seed
            .as_ref()
            .map(|entry| entry.is_official_result)
            .unwrap_or(false)
            || request.understanding.official_hint;
        push_page(
            state,
            SearchSitePage {
                url: page_document.final_url.clone(),
                title: if page_document.title.is_empty() {
                    page_document.hostname.clone()
                } else {
                    page_document.title.clone()
                },
                canonical_url: page_document.canonical_url.clone(),
                hostname: page_document.hostname.clone(),
                registrable_domain: registrable_domain.clone(),
                snippet: if page_document.snippet.is_empty() {
                    None
                } else {
                    Some(page_document.snippet.clone())
                },
                content_preview: if page_document.content_preview.is_empty() {
                    None
                } else {
                    Some(page_document.content_preview.clone())
                },
                fetch_depth: depth,
                discovered_by: discovered_by.clone(),
                parent_host: parent_host.clone(),
                source_engine_ids: seed_source_engines,
                is_official_result: if is_official { Some(true) } else { None },
            },
        );
        if state
            .read()
            .map(|guard| guard.snapshot.pages.len() >= budget.max_pages)
            .unwrap_or(true)
        {
            break;
        }
        if depth >= budget.max_depth {
            continue;
        }
        for link in filter_same_domain_links(page_document.links.clone(), registrable_domain) {
            let key = normalize_url_key(&link);
            if seen_urls.insert(key) {
                let next_parent = Url::parse(&link)
                    .ok()
                    .and_then(|parsed| parsed.host_str().map(|host| host.to_lowercase()))
                    .unwrap_or_else(|| registrable_domain.clone());
                queued.push_back((link, depth + 1, next_parent, "html".to_string(), None));
            }
        }
        if let Some(canonical) = page_document.canonical_url.as_ref() {
            let key = normalize_url_key(canonical);
            if seen_urls.insert(key) {
                queued.push_back((
                    canonical.clone(),
                    depth + 1,
                    page_document.hostname.clone(),
                    "redirect".to_string(),
                    None,
                ));
            }
        }
    }
}

fn run_site_expansion(
    mut request: SearchSiteStreamStartRequest,
    state: Arc<RwLock<SearchSiteStreamState>>,
) {
    apply_site_request_policy(&mut request);
    let budget = resolve_budget(request.budget_preset);
    let crawl_policy = resolve_crawl_policy(request.crawl_policy.as_deref());
    update_state(&state, |guard| {
        guard.snapshot.stats.domain_candidates = request.targets.len() as u64;
        guard.snapshot.stats.guess_attempts = request
            .seeds
            .iter()
            .filter(|seed| seed.guess_source == "guessed")
            .count() as u64;
    });
    let client = match build_client() {
        Ok(client) => client,
        Err(error) => {
            update_state(&state, |guard| {
                guard.snapshot.status = "error".to_string();
                guard.snapshot.error = Some(error.clone());
                guard.snapshot.done = true;
            });
            return;
        }
    };

    let mut targets = request.targets.clone();
    targets.sort_by(|left, right| {
        right
            .score
            .partial_cmp(&left.score)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| {
                hint_priority_for_target(right, &request.understanding)
                    .cmp(&hint_priority_for_target(left, &request.understanding))
            })
    });

    for target in targets.into_iter().take(budget.max_domain_families) {
        if is_cancelled(&state) {
            return;
        }
        let mut candidate_urls = target.candidate_urls.clone();
        candidate_urls.extend(default_domain_urls(&target.registrable_domain));
        candidate_urls.sort();
        candidate_urls.dedup();
        sort_urls_by_hints(&mut candidate_urls, &request.understanding);
        let Some(domain_document) =
            verify_candidate(&client, &candidate_urls, &target.registrable_domain)
        else {
            update_state(&state, |guard| {
                guard.snapshot.stats.dropped_pages += 1;
            });
            continue;
        };
        let verified_from = if target.guessed_only {
            "guessed"
        } else if domain_document.final_url != format!("https://{}/", target.registrable_domain) {
            "redirect"
        } else {
            "result"
        };
        push_domain(
            &state,
            SearchSiteDomain {
                registrable_domain: target.registrable_domain.clone(),
                final_url: domain_document.final_url.clone(),
                verification_score: target.score,
                verified_from: verified_from.to_string(),
                guess_sources: target.guess_sources.clone(),
                is_official_result: Some(
                    request.understanding.official_hint || target.official_weight > 0.0,
                ),
            },
        );
        crawl_domain(
            &client,
            &request,
            &state,
            budget,
            crawl_policy,
            &target,
            &domain_document,
        );
    }

    update_state(&state, |guard| {
        guard.snapshot.status = if guard.snapshot.error.is_some() {
            "error".to_string()
        } else {
            "ready".to_string()
        };
        guard.snapshot.done = true;
        guard.snapshot.stats.queued_pages = 0;
    });
}

pub fn search_site_stream_start_json(request_json: String) -> Result<String, String> {
    let request: SearchSiteStreamStartRequest = serde_json::from_str(&request_json)
        .map_err(|error| format!("parse request failed: {error}"))?;
    let stream_id = format!("site-stream-{}", Uuid::new_v4());
    let snapshot = create_snapshot(&request.query);
    let state = Arc::new(RwLock::new(SearchSiteStreamState {
        snapshot: snapshot.clone(),
        cancelled: false,
    }));
    site_stream_store()
        .write()
        .map_err(|_| "site stream state lock poisoned".to_string())?
        .insert(stream_id.clone(), Arc::clone(&state));
    std::thread::spawn(move || {
        run_site_expansion(request, state);
    });
    serde_json::to_string(&SearchSiteStreamStartResponse {
        stream_id,
        snapshot,
    })
    .map_err(|error| format!("serialize response failed: {error}"))
}

pub fn search_site_stream_read_json(request_json: String) -> Result<String, String> {
    let request: SearchSiteStreamReadRequest = serde_json::from_str(&request_json)
        .map_err(|error| format!("parse request failed: {error}"))?;
    let streams = site_stream_store()
        .read()
        .map_err(|_| "site stream state lock poisoned".to_string())?;
    let state = streams
        .get(&request.stream_id)
        .ok_or_else(|| "site stream not found".to_string())?;
    let guard = state
        .read()
        .map_err(|_| "site stream lock poisoned".to_string())?;
    serde_json::to_string(&SearchSiteStreamReadResponse {
        stream_id: request.stream_id,
        snapshot: guard.snapshot.clone(),
        done: guard.snapshot.done,
        error: guard.snapshot.error.clone(),
    })
    .map_err(|error| format!("serialize response failed: {error}"))
}

pub fn search_site_stream_cancel_json(request_json: String) -> Result<String, String> {
    let request: SearchSiteStreamCancelRequest = serde_json::from_str(&request_json)
        .map_err(|error| format!("parse request failed: {error}"))?;
    let removed = site_stream_store()
        .write()
        .map_err(|_| "site stream state lock poisoned".to_string())?
        .remove(&request.stream_id);
    if let Some(state) = removed.as_ref() {
        if let Ok(mut guard) = state.write() {
            guard.cancelled = true;
            guard.snapshot.done = true;
        }
    }
    serde_json::to_string(&SearchSiteStreamCancelResponse {
        removed: removed.is_some(),
    })
    .map_err(|error| format!("serialize response failed: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registrable_domain_handles_common_multilevel_suffixes() {
        assert_eq!(to_registrable_domain("docs.example.com"), "example.com");
        assert_eq!(
            to_registrable_domain("a.b.example.com.cn"),
            "example.com.cn"
        );
    }

    #[test]
    fn sitemap_xml_loc_entries_are_extracted() {
        let xml = r#"<?xml version='1.0'?><urlset><url><loc>https://example.com/docs</loc></url><url><loc>https://docs.example.com/api</loc></url></urlset>"#;
        let entries = extract_sitemap_links(xml);
        assert_eq!(entries.len(), 2);
        assert!(entries
            .iter()
            .any(|entry| entry == "https://example.com/docs"));
    }

    #[test]
    fn blocked_paths_are_filtered() {
        assert!(is_blocked_path("/checkout"));
        assert!(is_blocked_path("/account/logout"));
        assert!(!is_blocked_path("/docs/get-started"));
    }

    fn test_understanding() -> SearchSiteQueryUnderstanding {
        SearchSiteQueryUnderstanding {
            entity_candidate: "Example".to_string(),
            primary_intent: "docs".to_string(),
            official_hint: true,
            docs_hint: false,
            login_hint: false,
            download_hint: false,
            contains_cjk: false,
        }
    }

    #[test]
    fn proactive_guessing_policy_drops_guessed_only_inputs_when_disabled() {
        let mut request = SearchSiteStreamStartRequest {
            query: "example".to_string(),
            understanding: test_understanding(),
            budget_preset: SearchSiteBudgetPreset::Low,
            seeds: vec![
                SearchSiteSeed {
                    registrable_domain: "example.com".to_string(),
                    hostname: "example.com".to_string(),
                    url: "https://example.com/".to_string(),
                    title: "Example".to_string(),
                    snippet: String::new(),
                    source_engine_ids: vec![],
                    is_official_result: true,
                    guess_source: "result".to_string(),
                },
                SearchSiteSeed {
                    registrable_domain: "guessed.test".to_string(),
                    hostname: "guessed.test".to_string(),
                    url: "https://guessed.test/".to_string(),
                    title: "Guessed".to_string(),
                    snippet: String::new(),
                    source_engine_ids: vec![],
                    is_official_result: false,
                    guess_source: "guessed".to_string(),
                },
            ],
            targets: vec![
                SearchSiteTarget {
                    registrable_domain: "example.com".to_string(),
                    candidate_urls: vec!["https://example.com/".to_string()],
                    hostnames: vec!["example.com".to_string()],
                    score: 90.0,
                    official_weight: 1.0,
                    guess_sources: vec!["result".to_string()],
                    guessed_only: false,
                },
                SearchSiteTarget {
                    registrable_domain: "guessed.test".to_string(),
                    candidate_urls: vec!["https://guessed.test/".to_string()],
                    hostnames: vec!["guessed.test".to_string()],
                    score: 10.0,
                    official_weight: 0.0,
                    guess_sources: vec!["guessed".to_string()],
                    guessed_only: true,
                },
            ],
            enable_proactive_domain_guessing: Some(false),
            crawl_policy: Some("accessibility_only".to_string()),
        };

        apply_site_request_policy(&mut request);

        assert_eq!(request.seeds.len(), 1);
        assert_eq!(request.seeds[0].registrable_domain, "example.com");
        assert_eq!(request.targets.len(), 1);
        assert_eq!(request.targets[0].registrable_domain, "example.com");
        assert_eq!(
            resolve_crawl_policy(request.crawl_policy.as_deref()),
            SearchSiteCrawlPolicy::AccessibilityOnly
        );
    }

    #[test]
    fn hints_prioritize_urls_without_filtering_candidates() {
        let mut understanding = test_understanding();
        understanding.docs_hint = true;
        let mut urls = vec![
            "https://example.com/pricing".to_string(),
            "https://developer.example.com/reference".to_string(),
            "https://example.com/docs/start".to_string(),
            "https://www.example.com/".to_string(),
        ];

        sort_urls_by_hints(&mut urls, &understanding);

        assert_eq!(urls[0], "https://developer.example.com/reference");
        assert_eq!(urls[1], "https://example.com/docs/start");
        assert!(urls.contains(&"https://example.com/pricing".to_string()));
        assert!(urls.contains(&"https://www.example.com/".to_string()));
    }

    #[test]
    fn login_and_download_hints_prioritize_expected_subdomains() {
        let mut login = test_understanding();
        login.login_hint = true;
        assert!(
            hint_priority_for_hostname("login.example.com", &login)
                > hint_priority_for_hostname("www.example.com", &login)
        );

        let mut download = test_understanding();
        download.download_hint = true;
        assert!(
            hint_priority_for_url("https://example.com/download/app", &download)
                > hint_priority_for_url("https://example.com/pricing", &download)
        );
    }
}
