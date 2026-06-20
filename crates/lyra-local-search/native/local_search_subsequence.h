#ifndef LYRA_LOCAL_SEARCH_SUBSEQUENCE_H
#define LYRA_LOCAL_SEARCH_SUBSEQUENCE_H

// Shared fuzzy subsequence scorer used by the standalone FFI entry point and
// the v3 ranker. The inner case-folded byte scan is delegated to
// `lyra_ls_find_lower_byte`, which picks AVX2 / NEON / scalar per CPU and is
// guaranteed to return the same index as the scalar reference.

#include "local_search_simd.h"

#include <cstddef>
#include <cstdint>

static inline uint32_t lyra_ls_subsequence_score(
    const uint8_t *haystack,
    size_t haystack_len,
    const uint8_t *needle,
    size_t needle_len
) {
    if (haystack == nullptr || needle == nullptr || haystack_len == 0 || needle_len == 0) {
        return 0;
    }

    const char *haystack_ptr = reinterpret_cast<const char *>(haystack);
    size_t cursor = 0;
    size_t gaps = 0;
    size_t contiguous = 0;
    size_t best_contiguous = 0;

    for (size_t n = 0; n < needle_len; n++) {
        unsigned char needle_ch = lyra_ls_lower_ascii(needle[n]);
        size_t found_at =
            lyra_ls_find_lower_byte(haystack_ptr, cursor, haystack_len, needle_ch);

        if (found_at == haystack_len) {
            return 0;
        }

        if (found_at == cursor) {
            contiguous++;
        } else {
            gaps += found_at - cursor;
            if (contiguous > best_contiguous) {
                best_contiguous = contiguous;
            }
            contiguous = 1;
        }
        cursor = found_at + 1;
    }

    if (contiguous > best_contiguous) {
        best_contiguous = contiguous;
    }

    uint32_t coverage = static_cast<uint32_t>((needle_len * 1000u) / haystack_len);
    uint32_t continuity = static_cast<uint32_t>((best_contiguous * 500u) / needle_len);
    uint32_t penalty = gaps > 240u ? 240u : static_cast<uint32_t>(gaps);
    uint32_t score = 700u + coverage + continuity;
    if (score <= penalty) {
        return 1;
    }
    return score - penalty;
}

#endif