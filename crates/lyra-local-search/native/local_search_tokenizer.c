#include "local_search_native.h"

static int is_ascii_token_byte(uint8_t value) {
    return (value >= 'A' && value <= 'Z')
        || (value >= 'a' && value <= 'z')
        || (value >= '0' && value <= '9')
        || value == '_';
}

static int is_token_byte(uint8_t value) {
    return is_ascii_token_byte(value) || value >= 0x80;
}

size_t lyra_local_search_query_token_spans(
    const uint8_t *query,
    size_t query_len,
    LyraLocalSearchTokenSpan *spans,
    size_t max_spans
) {
    if (query == 0 || query_len == 0 || spans == 0 || max_spans == 0) {
        return 0;
    }

    size_t count = 0;
    size_t cursor = 0;
    while (cursor < query_len && count < max_spans) {
        while (cursor < query_len && !is_token_byte(query[cursor])) {
            cursor++;
        }
        if (cursor >= query_len) {
            break;
        }

        size_t start = cursor;
        while (cursor < query_len && is_token_byte(query[cursor])) {
            cursor++;
        }

        spans[count].offset = start;
        spans[count].length = cursor - start;
        count++;
    }

    return count;
}
