use crate::ast::LyraRenderDocument;
use crate::options::RenderDocumentOptions;
use blake3::Hasher;
use lru::LruCache;
use once_cell::sync::Lazy;
use std::num::NonZeroUsize;
use std::sync::Mutex;

const DEFAULT_CAPACITY: usize = 512;

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
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cache_key_is_stable_for_same_input() {
        let options = RenderDocumentOptions::default();
        let first = cache_key("hello", &options);
        let second = cache_key("hello", &options);
        assert_eq!(first, second);
        assert_ne!(first, cache_key("hello!", &options));
    }
}