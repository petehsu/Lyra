//! Post-processing of captured links and images: dedup and finalization.

use std::collections::HashSet;

use crate::markdown::{CapturedLink, to_reader_links};
use crate::types::{ReaderImage, ReaderLink, ReaderMedia};

/// Finalize captured links into deduplicated public [`ReaderLink`]s.
///
/// Links are deduplicated by `(normalized url, anchor text)` so distinct anchors
/// to the same URL are preserved, but identical repeats are dropped.
pub fn finalize_links(captured: &[CapturedLink]) -> Vec<ReaderLink> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for link in to_reader_links(captured) {
        let key = (normalize(&link.url), link.text.clone().unwrap_or_default());
        if seen.insert(key) {
            out.push(link);
        }
    }
    out
}

/// Finalize captured images into deduplicated public images (by URL).
pub fn finalize_images(images: &[ReaderImage]) -> Vec<ReaderImage> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for image in images {
        if seen.insert(normalize(&image.url)) {
            out.push(image.clone());
        }
    }
    out
}

/// Finalize captured/static/browser media into deduplicated public media.
pub fn finalize_media(media: &[ReaderMedia]) -> Vec<ReaderMedia> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for item in media {
        let key = (
            item.kind.clone(),
            item.url
                .as_deref()
                .map(normalize)
                .unwrap_or_else(String::new),
            item.title.clone().unwrap_or_default(),
        );
        if seen.insert(key) {
            out.push(item.clone());
        }
    }
    out
}

fn normalize(url: &str) -> String {
    url.trim().trim_end_matches('/').to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn captured(url: &str, text: &str) -> CapturedLink {
        CapturedLink {
            url: url.to_string(),
            text: text.to_string(),
            title: None,
            rel: None,
            section: None,
            dom_path: None,
            source_offset: None,
        }
    }

    #[test]
    fn dedups_identical_links() {
        let links = finalize_links(&[
            captured("https://a.test", "Home"),
            captured("https://a.test/", "Home"),
        ]);
        assert_eq!(links.len(), 1);
    }

    #[test]
    fn keeps_distinct_anchor_texts() {
        let links = finalize_links(&[
            captured("https://a.test", "Home"),
            captured("https://a.test", "Start"),
        ]);
        assert_eq!(links.len(), 2);
    }

    #[test]
    fn dedups_images_by_url() {
        let image = |url: &str| ReaderImage {
            url: url.to_string(),
            alt: None,
            title: None,
            srcset: Vec::new(),
            width: None,
            height: None,
            caption: None,
            likely_decorative: false,
        };
        let images = finalize_images(&[
            image("https://a.test/i.png"),
            image("https://a.test/i.png/"),
        ]);
        assert_eq!(images.len(), 1);
    }
}
