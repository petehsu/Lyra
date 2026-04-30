#include <stdint.h>
#include <stddef.h>

static unsigned char lower_ascii(unsigned char value) {
    if (value >= 'A' && value <= 'Z') {
        return (unsigned char)(value + ('a' - 'A'));
    }
    return value;
}

uint32_t lyra_local_search_subsequence_score(
    const uint8_t *haystack,
    size_t haystack_len,
    const uint8_t *needle,
    size_t needle_len
) {
    if (haystack == NULL || needle == NULL || haystack_len == 0 || needle_len == 0) {
        return 0;
    }

    size_t cursor = 0;
    size_t gaps = 0;
    size_t contiguous = 0;
    size_t best_contiguous = 0;

    for (size_t n = 0; n < needle_len; n++) {
        unsigned char needle_ch = lower_ascii(needle[n]);
        int found = 0;
        size_t found_at = cursor;

        for (size_t h = cursor; h < haystack_len; h++) {
            if (lower_ascii(haystack[h]) == needle_ch) {
                found = 1;
                found_at = h;
                break;
            }
        }

        if (!found) {
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

    uint32_t coverage = (uint32_t)((needle_len * 1000u) / haystack_len);
    uint32_t continuity = (uint32_t)((best_contiguous * 500u) / needle_len);
    uint32_t penalty = gaps > 240u ? 240u : (uint32_t)gaps;
    uint32_t score = 700u + coverage + continuity;
    if (score <= penalty) {
        return 1;
    }
    return score - penalty;
}
