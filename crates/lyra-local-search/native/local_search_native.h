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

typedef struct LyraLocalSearchV3Score {
    uint32_t score;
    uint32_t match_kind;
    uint32_t source;
} LyraLocalSearchV3Score;

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

LyraLocalSearchV3Score lyra_local_search_v3_score_entry(
    const uint8_t *query,
    size_t query_len,
    const uint8_t *name,
    size_t name_len,
    const uint8_t *path,
    size_t path_len,
    const uint8_t *extension,
    size_t extension_len,
    int content_hit,
    int is_directory,
    int vendor,
    int enable_fuzzy,
    int enable_extension_match
);

int lyra_local_search_v3_is_probably_text(const uint8_t *bytes, size_t len);

#ifdef __cplusplus
}
#endif

#endif
