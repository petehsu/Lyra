#[repr(C)]
#[derive(Clone, Copy)]
struct TokenSpan {
    offset: usize,
    length: usize,
}

unsafe extern "C" {
    fn lyra_local_search_query_token_spans(
        query: *const u8,
        query_len: usize,
        spans: *mut TokenSpan,
        max_spans: usize,
    ) -> usize;

    #[cfg(not(feature = "asm-kernels"))]
    fn lyra_local_search_subsequence_score(
        haystack: *const u8,
        haystack_len: usize,
        needle: *const u8,
        needle_len: usize,
    ) -> u32;

    #[cfg(feature = "asm-kernels")]
    fn lyra_local_search_asm_subsequence_score(
        haystack: *const u8,
        haystack_len: usize,
        needle: *const u8,
        needle_len: usize,
    ) -> u32;
}

pub(crate) fn subsequence_score(haystack: &str, needle: &str) -> u32 {
    if haystack.is_empty() || needle.is_empty() {
        return 0;
    }
    // SAFETY: The C scorer treats both pointers as read-only byte slices for the
    // exact lengths supplied here and does not retain either pointer.
    unsafe {
        #[cfg(feature = "asm-kernels")]
        {
            return lyra_local_search_asm_subsequence_score(
                haystack.as_ptr(),
                haystack.len(),
                needle.as_ptr(),
                needle.len(),
            );
        }
        #[cfg(not(feature = "asm-kernels"))]
        {
            lyra_local_search_subsequence_score(
                haystack.as_ptr(),
                haystack.len(),
                needle.as_ptr(),
                needle.len(),
            )
        }
    }
}

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
}
