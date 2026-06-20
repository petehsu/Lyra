#include "local_search_native.h"
#include "local_search_subsequence.h"

extern "C" uint32_t lyra_local_search_subsequence_score(
    const uint8_t *haystack,
    size_t haystack_len,
    const uint8_t *needle,
    size_t needle_len
) {
    return lyra_ls_subsequence_score(haystack, haystack_len, needle, needle_len);
}