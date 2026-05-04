#ifndef LYRA_DOWNLOAD_NATIVE_H
#define LYRA_DOWNLOAD_NATIVE_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct LyraDownloadNativeSegment {
  uint32_t index;
  uint64_t start;
  uint64_t end_inclusive;
} LyraDownloadNativeSegment;

uint8_t lyra_download_scheme_code(const char *url, size_t len);

size_t lyra_download_plan_segments(
  uint64_t total_bytes,
  uint32_t requested_connections,
  uint64_t min_segment_bytes,
  LyraDownloadNativeSegment *out_segments,
  size_t out_len
);

#ifdef __cplusplus
}
#endif

#endif
