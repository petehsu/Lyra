use crate::ast::{HighlightSpan, LyraRenderDocument};
use crate::options::RenderDocumentOptions;
use blake3::Hasher;
use lru::LruCache;
use once_cell::sync::Lazy;
use std::num::NonZeroUsize;
use std::sync::Mutex;

const DEFAULT_CAPACITY: usize = 512;
// Per-block enrich products are smaller in count but individually heavier (SVG
// strings), so they get their own, more modest capacities.
const ENRICH_SVG_CAPACITY: usize = 256;
const ENRICH_HIGHLIGHT_CAPACITY: usize = 512;

static DOCUMENT_CACHE: Lazy<Mutex<RenderCache>> =
    Lazy::new(|| Mutex::new(RenderCache::new(DEFAULT_CAPACITY)));

struct RenderCache {
    entries: LruCache<String, LyraRenderDocument>,
}

impl RenderCache {
    fn new(capacity: usize) -> Self {
        let capacity = NonZeroUsize::new(capacity.max(1)).unwrap();
        Self {
            entries: LruCache::new(capacity),
        }
    }

    fn get(&mut self, key: &str) -> Option<LyraRenderDocument> {
        self.entries.get(key).cloned()
    }

    fn insert(&mut self, key: String, document: LyraRenderDocument) {
        self.entries.put(key, document);
    }

    fn clear(&mut self) {
        self.entries.clear();
    }
}

/// Cached enrich product for a single mermaid/math block: the rendered SVG and
/// any error, mirroring `MermaidRenderResult` / `MathRenderResult`.
#[derive(Clone)]
pub struct CachedSvg {
    pub svg: Option<String>,
    pub error: Option<String>,
}

/// Per-block enrich caches. Keyed by a hash of the block's own source plus the
/// inputs that affect its rendering (theme, display mode), these let streaming
/// re-renders reuse the enrich output of already-complete blocks instead of
/// recomputing mermaid/math/highlight for the whole document on every token.
static MERMAID_CACHE: Lazy<Mutex<LruCache<String, CachedSvg>>> =
    Lazy::new(|| Mutex::new(new_lru(ENRICH_SVG_CAPACITY)));
static MATH_CACHE: Lazy<Mutex<LruCache<String, CachedSvg>>> =
    Lazy::new(|| Mutex::new(new_lru(ENRICH_SVG_CAPACITY)));
static HIGHLIGHT_CACHE: Lazy<Mutex<LruCache<String, Vec<HighlightSpan>>>> =
    Lazy::new(|| Mutex::new(new_lru(ENRICH_HIGHLIGHT_CAPACITY)));

fn new_lru<V>(capacity: usize) -> LruCache<String, V> {
    LruCache::new(NonZeroUsize::new(capacity.max(1)).unwrap())
}

/// Hash a block's enrich inputs into a stable cache key. `kind` namespaces the
/// caches so a math and a mermaid block with identical source never collide;
/// `discriminator` carries theme/display-mode bits.
fn block_cache_key(kind: &str, source: &str, discriminator: &str) -> String {
    let mut hasher = Hasher::new();
    hasher.update(kind.as_bytes());
    hasher.update(&[0]);
    hasher.update(discriminator.as_bytes());
    hasher.update(&[0]);
    hasher.update(source.as_bytes());
    hasher.finalize().to_hex().to_string()
}

/// Look up a cached mermaid render for `source` under `theme_tag`, or compute
/// and store it via `compute`.
pub fn mermaid_cached_or<F>(source: &str, theme_tag: &str, compute: F) -> CachedSvg
where
    F: FnOnce() -> CachedSvg,
{
    let key = block_cache_key("mermaid", source, theme_tag);
    if let Some(hit) = MERMAID_CACHE
        .lock()
        .ok()
        .and_then(|mut c| c.get(&key).cloned())
    {
        return hit;
    }
    let value = compute();
    if let Ok(mut cache) = MERMAID_CACHE.lock() {
        cache.put(key, value.clone());
    }
    value
}

/// Look up a cached math render for `latex` under a `(theme, display_mode)` tag,
/// or compute and store it via `compute`.
pub fn math_cached_or<F>(latex: &str, tag: &str, compute: F) -> CachedSvg
where
    F: FnOnce() -> CachedSvg,
{
    let key = block_cache_key("math", latex, tag);
    if let Some(hit) = MATH_CACHE
        .lock()
        .ok()
        .and_then(|mut c| c.get(&key).cloned())
    {
        return hit;
    }
    let value = compute();
    if let Ok(mut cache) = MATH_CACHE.lock() {
        cache.put(key, value.clone());
    }
    value
}

/// Look up cached highlight spans for `source` under `language`, or compute and
/// store them via `compute`.
pub fn highlight_cached_or<F>(language: &str, source: &str, compute: F) -> Vec<HighlightSpan>
where
    F: FnOnce() -> Vec<HighlightSpan>,
{
    let key = block_cache_key("highlight", source, language);
    if let Some(hit) = HIGHLIGHT_CACHE
        .lock()
        .ok()
        .and_then(|mut c| c.get(&key).cloned())
    {
        return hit;
    }
    let value = compute();
    if let Ok(mut cache) = HIGHLIGHT_CACHE.lock() {
        cache.put(key, value.clone());
    }
    value
}

pub fn cache_key(content: &str, options: &RenderDocumentOptions) -> String {
    let mut hasher = Hasher::new();
    hasher.update(content.as_bytes());
    if let Ok(options_json) = serde_json::to_vec(options) {
        hasher.update(&options_json);
    }
    hasher.finalize().to_hex().to_string()
}

pub fn get_cached_document(key: &str) -> Option<LyraRenderDocument> {
    DOCUMENT_CACHE
        .lock()
        .ok()
        .and_then(|mut cache| cache.get(key))
}

pub fn store_cached_document(key: String, document: LyraRenderDocument) {
    if let Ok(mut cache) = DOCUMENT_CACHE.lock() {
        cache.insert(key, document);
    }
}

pub fn invalidate_cache() {
    if let Ok(mut cache) = DOCUMENT_CACHE.lock() {
        cache.clear();
    }
    if let Ok(mut cache) = MERMAID_CACHE.lock() {
        cache.clear();
    }
    if let Ok(mut cache) = MATH_CACHE.lock() {
        cache.clear();
    }
    if let Ok(mut cache) = HIGHLIGHT_CACHE.lock() {
        cache.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    #[test]
    fn cache_key_is_stable_for_same_input() {
        let options = RenderDocumentOptions::default();
        let first = cache_key("hello", &options);
        let second = cache_key("hello", &options);
        assert_eq!(first, second);
        assert_ne!(first, cache_key("hello!", &options));
    }

    #[test]
    fn highlight_cache_computes_once_per_source() {
        invalidate_cache();
        let calls = AtomicUsize::new(0);
        let compute = || {
            calls.fetch_add(1, Ordering::SeqCst);
            vec![HighlightSpan {
                start: 0,
                end: 1,
                scope: "keyword".to_string(),
            }]
        };
        // Unique source so other tests can't pre-populate the entry.
        let source = "fn cache_probe_unique_alpha() {}";
        let first = highlight_cached_or("rust", source, compute);
        let second = highlight_cached_or("rust", source, || {
            panic!("compute must not run on a cache hit");
        });
        assert_eq!(first, second);
        assert_eq!(calls.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn block_caches_namespace_by_kind_and_discriminator() {
        invalidate_cache();
        // Same source text under math vs mermaid must not collide.
        let math = math_cached_or("X", "dark|inline", || CachedSvg {
            svg: Some("math-svg".to_string()),
            error: None,
        });
        let mermaid = mermaid_cached_or("X", "dark", || CachedSvg {
            svg: Some("mermaid-svg".to_string()),
            error: None,
        });
        assert_eq!(math.svg.as_deref(), Some("math-svg"));
        assert_eq!(mermaid.svg.as_deref(), Some("mermaid-svg"));

        // Different discriminator (theme/display) must miss and recompute.
        let inline = math_cached_or("Y", "dark|inline", || CachedSvg {
            svg: Some("inline".to_string()),
            error: None,
        });
        let display = math_cached_or("Y", "dark|display", || CachedSvg {
            svg: Some("display".to_string()),
            error: None,
        });
        assert_eq!(inline.svg.as_deref(), Some("inline"));
        assert_eq!(display.svg.as_deref(), Some("display"));
    }
}
