#include "local_search_native.h"

#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <string>

namespace {

constexpr uint32_t MATCH_NONE = 0;
constexpr uint32_t MATCH_FILE_NAME = 1;
constexpr uint32_t MATCH_PATH = 2;
constexpr uint32_t MATCH_EXTENSION = 3;
constexpr uint32_t MATCH_CONTENT = 4;
constexpr uint32_t MATCH_FUZZY = 5;

constexpr uint32_t SOURCE_INDEX = 0;
constexpr uint32_t SOURCE_CONTENT = 1;

constexpr uint32_t CONTENT_SCORE = 900000;
constexpr uint32_t EXTENSION_SCORE = 860000;
constexpr uint32_t FILENAME_EXACT_SCORE = 1200000;
constexpr uint32_t FILENAME_PREFIX_SCORE = 1080000;
constexpr uint32_t FILENAME_SUBSTRING_SCORE = 1000000;
constexpr uint32_t PATH_SUBSTRING_SCORE = 760000;
constexpr uint32_t FUZZY_SCORE_BASE = 420000;
constexpr uint32_t VENDOR_PENALTY = 220000;
constexpr uint32_t DIRECTORY_PENALTY = 40000;

static unsigned char lower_ascii(unsigned char value) {
    if (value >= 'A' && value <= 'Z') {
        return static_cast<unsigned char>(value + ('a' - 'A'));
    }
    return value;
}

static std::string slice_string(const uint8_t *bytes, size_t len) {
    if (bytes == nullptr || len == 0) {
        return std::string();
    }
    return std::string(reinterpret_cast<const char *>(bytes), len);
}

static bool starts_with(const std::string &haystack, const std::string &needle) {
    return haystack.size() >= needle.size()
        && haystack.compare(0, needle.size(), needle) == 0;
}

static uint32_t apply_penalties(uint32_t score, int is_directory, int vendor) {
    if (vendor != 0) {
        score = score > VENDOR_PENALTY ? score - VENDOR_PENALTY : 1;
    }
    if (is_directory != 0) {
        score = score > DIRECTORY_PENALTY ? score - DIRECTORY_PENALTY : 1;
    }
    return score;
}

static std::string extension_query(const std::string &query) {
    if (starts_with(query, "ext:")) {
        std::string value = query.substr(4);
        while (!value.empty() && value.front() == '.') {
            value.erase(value.begin());
        }
        return value;
    }
    if (starts_with(query, ".") && query.find(' ') == std::string::npos) {
        return query.substr(1);
    }
    return std::string();
}

static LyraLocalSearchV3Score make_score(
    uint32_t score,
    uint32_t match_kind,
    uint32_t source,
    int is_directory,
    int vendor
) {
    LyraLocalSearchV3Score out;
    out.score = apply_penalties(score, is_directory, vendor);
    out.match_kind = match_kind;
    out.source = source;
    return out;
}

static LyraLocalSearchV3Score no_score() {
    LyraLocalSearchV3Score out;
    out.score = 0;
    out.match_kind = MATCH_NONE;
    out.source = SOURCE_INDEX;
    return out;
}

static uint32_t subsequence_score_bytes(const std::string &haystack, const std::string &needle) {
    if (haystack.empty() || needle.empty()) {
        return 0;
    }

    size_t cursor = 0;
    size_t gaps = 0;
    size_t contiguous = 0;
    size_t best_contiguous = 0;

    for (size_t n = 0; n < needle.size(); n++) {
        unsigned char needle_ch = lower_ascii(static_cast<unsigned char>(needle[n]));
        bool found = false;
        size_t found_at = cursor;

        for (size_t h = cursor; h < haystack.size(); h++) {
            if (lower_ascii(static_cast<unsigned char>(haystack[h])) == needle_ch) {
                found = true;
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
            best_contiguous = std::max(best_contiguous, contiguous);
            contiguous = 1;
        }
        cursor = found_at + 1;
    }

    best_contiguous = std::max(best_contiguous, contiguous);
    uint32_t coverage = static_cast<uint32_t>((needle.size() * 1000u) / haystack.size());
    uint32_t continuity = static_cast<uint32_t>((best_contiguous * 500u) / needle.size());
    uint32_t penalty = gaps > 240u ? 240u : static_cast<uint32_t>(gaps);
    uint32_t score = 700u + coverage + continuity;
    return score <= penalty ? 1 : score - penalty;
}

} // namespace

extern "C" LyraLocalSearchV3Score lyra_local_search_v3_score_entry(
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
) {
    std::string query_string = slice_string(query, query_len);
    if (query_string.empty()) {
        return no_score();
    }

    std::string name_string = slice_string(name, name_len);
    std::string path_string = slice_string(path, path_len);
    std::string extension_string = slice_string(extension, extension_len);

    if (content_hit != 0) {
        return make_score(CONTENT_SCORE, MATCH_CONTENT, SOURCE_CONTENT, is_directory, vendor);
    }

    if (enable_extension_match != 0) {
        std::string ext_query = extension_query(query_string);
        if (!ext_query.empty() && extension_string == ext_query) {
            return make_score(EXTENSION_SCORE, MATCH_EXTENSION, SOURCE_INDEX, is_directory, vendor);
        }
    }

    if (name_string == query_string) {
        return make_score(FILENAME_EXACT_SCORE, MATCH_FILE_NAME, SOURCE_INDEX, is_directory, vendor);
    }
    if (starts_with(name_string, query_string)) {
        return make_score(FILENAME_PREFIX_SCORE, MATCH_FILE_NAME, SOURCE_INDEX, is_directory, vendor);
    }
    if (name_string.find(query_string) != std::string::npos) {
        return make_score(FILENAME_SUBSTRING_SCORE, MATCH_FILE_NAME, SOURCE_INDEX, is_directory, vendor);
    }
    if (path_string.find(query_string) != std::string::npos) {
        return make_score(PATH_SUBSTRING_SCORE, MATCH_PATH, SOURCE_INDEX, is_directory, vendor);
    }
    if (enable_fuzzy != 0) {
        uint32_t basename_fuzzy = subsequence_score_bytes(name_string, query_string);
        uint32_t path_fuzzy = subsequence_score_bytes(path_string, query_string) / 2u;
        uint32_t fuzzy = std::max(basename_fuzzy, path_fuzzy);
        if (fuzzy > 900u) {
            return make_score(FUZZY_SCORE_BASE + fuzzy, MATCH_FUZZY, SOURCE_INDEX, is_directory, vendor);
        }
    }
    return no_score();
}

extern "C" int lyra_local_search_v3_is_probably_text(const uint8_t *bytes, size_t len) {
    if (bytes == nullptr) {
        return 0;
    }
    if (len == 0) {
        return 1;
    }
    size_t suspicious = 0;
    for (size_t i = 0; i < len; i++) {
        uint8_t value = bytes[i];
        if (value == 0) {
            return 0;
        }
        if (value < 0x08 || (value > 0x0D && value < 0x20)) {
            suspicious++;
        }
    }
    return suspicious * 100 <= len * 2 ? 1 : 0;
}
