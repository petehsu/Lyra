#ifndef LYRA_LOCAL_SEARCH_NATIVE_H
#define LYRA_LOCAL_SEARCH_NATIVE_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct LyraLocalSearchTokenSpan {
    size_t offset;
    size_t length;
} LyraLocalSearchTokenSpan;

size_t lyra_local_search_query_token_spans(
    const uint8_t *query,
    size_t query_len,
    LyraLocalSearchTokenSpan *spans,
    size_t max_spans
);

uint32_t lyra_local_search_subsequence_score(
    const uint8_t *haystack,
    size_t haystack_len,
    const uint8_t *needle,
    size_t needle_len
);

uint32_t lyra_local_search_asm_subsequence_score(
    const uint8_t *haystack,
    size_t haystack_len,
    const uint8_t *needle,
    size_t needle_len
);

#ifdef __cplusplus
}
#endif

#endif
