#include "download_native.h"

#include <algorithm>
#include <cstddef>
#include <cstdint>

extern "C" size_t lyra_download_plan_segments(
  uint64_t total_bytes,
  uint32_t requested_connections,
  uint64_t min_segment_bytes,
  LyraDownloadNativeSegment *out_segments,
  size_t out_len
) {
  if (out_segments == nullptr || out_len == 0) {
    return 0;
  }

  if (total_bytes == 0) {
    out_segments[0] = LyraDownloadNativeSegment{0, 0, UINT64_MAX};
    return 1;
  }

  uint64_t connections = std::max<uint64_t>(1, std::min<uint64_t>(requested_connections, 32));
  const uint64_t segment_floor = std::max<uint64_t>(1, min_segment_bytes);
  connections = std::min<uint64_t>(connections, std::max<uint64_t>(1, total_bytes / segment_floor));
  connections = std::max<uint64_t>(1, connections);
  connections = std::min<uint64_t>(connections, out_len);

  const uint64_t segment_size = (total_bytes + connections - 1) / connections;
  size_t written = 0;
  for (uint64_t index = 0; index < connections; index += 1) {
    const uint64_t start = index * segment_size;
    if (start >= total_bytes) {
      break;
    }
    const uint64_t end = std::min<uint64_t>(total_bytes - 1, start + segment_size - 1);
    out_segments[written] = LyraDownloadNativeSegment{
      static_cast<uint32_t>(written),
      start,
      end
    };
    written += 1;
  }
  return written;
}
