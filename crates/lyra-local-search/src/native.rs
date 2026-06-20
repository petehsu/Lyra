#[repr(C)]
#[derive(Clone, Copy)]
#[allow(dead_code)]
struct TokenSpan {
    offset: usize,
    length: usize,
}

#[repr(C)]
#[derive(Clone, Copy, Debug)]
pub(crate) struct V3NativeScore {
    pub(crate) score: u32,
    pub(crate) match_kind: u32,
    pub(crate) source: u32,
}

pub(crate) const V3_MATCH_FILE_NAME: u32 = 1;
pub(crate) const V3_MATCH_PATH: u32 = 2;
pub(crate) const V3_MATCH_EXTENSION: u32 = 3;
pub(crate) const V3_MATCH_CONTENT: u32 = 4;
pub(crate) const V3_MATCH_FUZZY: u32 = 5;

pub(crate) const V3_SOURCE_CONTENT: u32 = 1;

pub(crate) struct V3ScoreInput<'a> {
    pub(crate) query: &'a str,
    pub(crate) lower_file_name: &'a str,
    pub(crate) lower_path: &'a str,
    pub(crate) extension: &'a str,
    pub(crate) content_hit: bool,
    pub(crate) is_directory: bool,
    pub(crate) vendor: bool,
    pub(crate) enable_fuzzy: bool,
    pub(crate) enable_extension_match: bool,
}

unsafe extern "C" {
    fn lyra_local_search_query_token_spans(
        query: *const u8,
        query_len: usize,
        spans: *mut TokenSpan,
        max_spans: usize,
    ) -> usize;

    fn lyra_local_search_subsequence_score(
        haystack: *const u8,
        haystack_len: usize,
        needle: *const u8,
        needle_len: usize,
    ) -> u32;

    fn lyra_local_search_v3_score_entry(
        query: *const u8,
        query_len: usize,
        name: *const u8,
        name_len: usize,
        path: *const u8,
        path_len: usize,
        extension: *const u8,
        extension_len: usize,
        content_hit: i32,
        is_directory: i32,
        vendor: i32,
        enable_fuzzy: i32,
        enable_extension_match: i32,
    ) -> V3NativeScore;

    fn lyra_local_search_v3_is_probably_text(bytes: *const u8, len: usize) -> i32;
}

#[allow(dead_code)]
pub(crate) fn subsequence_score(haystack: &str, needle: &str) -> u32 {
    if haystack.is_empty() || needle.is_empty() {
        return 0;
    }
    // SAFETY: The C scorer treats both pointers as read-only byte slices for the
    // exact lengths supplied here and does not retain either pointer.
    unsafe {
        lyra_local_search_subsequence_score(
            haystack.as_ptr(),
            haystack.len(),
            needle.as_ptr(),
            needle.len(),
        )
    }
}

pub(crate) fn v3_score_entry(input: V3ScoreInput<'_>) -> V3NativeScore {
    // SAFETY: The native scorer reads the supplied byte slices for the exact
    // lengths provided here and does not retain any pointer.
    unsafe {
        lyra_local_search_v3_score_entry(
            input.query.as_ptr(),
            input.query.len(),
            input.lower_file_name.as_ptr(),
            input.lower_file_name.len(),
            input.lower_path.as_ptr(),
            input.lower_path.len(),
            input.extension.as_ptr(),
            input.extension.len(),
            i32::from(input.content_hit),
            i32::from(input.is_directory),
            i32::from(input.vendor),
            i32::from(input.enable_fuzzy),
            i32::from(input.enable_extension_match),
        )
    }
}

pub(crate) fn is_probably_text(bytes: &[u8]) -> bool {
    // SAFETY: The native text detector reads the supplied byte slice for the
    // exact length provided here and does not retain the pointer.
    unsafe { lyra_local_search_v3_is_probably_text(bytes.as_ptr(), bytes.len()) != 0 }
}

#[allow(dead_code)]
pub(crate) fn query_token_spans(query: &str, max_spans: usize) -> Vec<&str> {
    if query.is_empty() || max_spans == 0 {
        return Vec::new();
    }
    let mut spans = vec![
        TokenSpan {
            offset: 0,
            length: 0,
        };
        max_spans
    ];
    // SAFETY: The tokenizer writes at most `spans.len()` TokenSpan values, does
    // not retain pointers, and returns byte spans bounded by the input length.
    let count = unsafe {
        lyra_local_search_query_token_spans(
            query.as_ptr(),
            query.len(),
            spans.as_mut_ptr(),
            spans.len(),
        )
    }
    .min(spans.len());
    spans
        .into_iter()
        .take(count)
        .filter_map(|span| {
            let end = span.offset.checked_add(span.length)?;
            query.get(span.offset..end)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tokenizer_splits_ascii_separators_and_preserves_utf8() {
        assert_eq!(
            query_token_spans("src/main.rs 搜索", 8),
            vec!["src", "main", "rs", "搜索"]
        );
    }

    #[test]
    fn subsequence_score_rejects_null_equivalent_inputs() {
        assert_eq!(subsequence_score("", "abc"), 0);
        assert_eq!(subsequence_score("abc", ""), 0);
    }

    /// Pure-Rust reference mirroring the scalar contract in
    /// `local_search_subsequence.h`. The SIMD-backed FFI must agree with this
    /// for every input, which locks SIMD output to the scalar reference.
    fn reference_score(haystack: &str, needle: &str) -> u32 {
        if haystack.is_empty() || needle.is_empty() {
            return 0;
        }
        let hay = haystack.as_bytes();
        let need = needle.as_bytes();
        let lower = |b: u8| -> u8 {
            if b.is_ascii_uppercase() {
                b + (b'a' - b'A')
            } else {
                b
            }
        };
        let mut cursor = 0usize;
        let mut gaps = 0usize;
        let mut contiguous = 0usize;
        let mut best_contiguous = 0usize;
        for &nb in need {
            let target = lower(nb);
            let mut found_at = hay.len();
            for h in cursor..hay.len() {
                if lower(hay[h]) == target {
                    found_at = h;
                    break;
                }
            }
            if found_at == hay.len() {
                return 0;
            }
            if found_at == cursor {
                contiguous += 1;
            } else {
                gaps += found_at - cursor;
                best_contiguous = best_contiguous.max(contiguous);
                contiguous = 1;
            }
            cursor = found_at + 1;
        }
        best_contiguous = best_contiguous.max(contiguous);
        let coverage = (need.len() * 1000) / hay.len();
        let continuity = (best_contiguous * 500) / need.len();
        let penalty = gaps.min(240);
        let score = 700 + coverage + continuity;
        if score <= penalty {
            1
        } else {
            (score - penalty) as u32
        }
    }

    #[test]
    fn simd_matches_scalar_reference_across_inputs() {
        // Deterministic pseudo-random corpus crossing the 16/32-byte SIMD lane
        // boundaries, with a small alphabet so subsequences actually hit, plus
        // mixed case to exercise the case-folding path.
        let alphabet = b"abcAB/._12";
        let mut state: u64 = 0x9E3779B97F4A7C15;
        let mut next = || {
            state ^= state << 13;
            state ^= state >> 7;
            state ^= state << 17;
            state
        };
        for _ in 0..4000 {
            let hay_len = (next() % 80) as usize;
            let need_len = (next() % 8) as usize;
            let hay: String = (0..hay_len)
                .map(|_| alphabet[(next() as usize) % alphabet.len()] as char)
                .collect();
            let need: String = (0..need_len)
                .map(|_| alphabet[(next() as usize) % alphabet.len()] as char)
                .collect();
            assert_eq!(
                subsequence_score(&hay, &need),
                reference_score(&hay, &need),
                "mismatch for haystack={hay:?} needle={need:?}"
            );
        }
    }

    #[test]
    fn simd_matches_scalar_on_long_haystack() {
        // Long inputs ensure multiple full SIMD iterations before the tail.
        let hay = "the_quick_brown_fox/jumps/over_the_lazy_DOG.rs".repeat(10);
        for needle in ["qbf", "dogrs", "OVER", "zzz", "the_lazy", "/jumps/"] {
            assert_eq!(
                subsequence_score(&hay, needle),
                reference_score(&hay, needle),
                "mismatch for needle={needle:?}"
            );
        }
    }
}
