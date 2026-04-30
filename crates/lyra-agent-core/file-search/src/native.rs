unsafe extern "C" {
    fn lyra_local_search_subsequence_score(
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
        lyra_local_search_subsequence_score(
            haystack.as_ptr(),
            haystack.len(),
            needle.as_ptr(),
            needle.len(),
        )
    }
}
