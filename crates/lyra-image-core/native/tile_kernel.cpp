#include "tile_kernel.h"

#include <algorithm>
#include <cstddef>
#include <cstring>

#if defined(__SSE2__)
#include <emmintrin.h>
#elif defined(__ARM_NEON) || defined(__ARM_NEON__)
#include <arm_neon.h>
#endif

const char *lyra_image_tile_kernel_accel_name(void) {
#if defined(__SSE2__)
    return "simd-sse2";
#elif defined(__ARM_NEON) || defined(__ARM_NEON__)
    return "simd-neon";
#else
    return "portable-cpp";
#endif
}

static void lyra_image_copy_rgba_row(
    uint8_t *destination,
    const uint8_t *source,
    uint32_t pixel_count
) {
    const size_t byte_count = static_cast<size_t>(pixel_count) * 4;
#if defined(__SSE2__)
    size_t offset = 0;
    for (; offset + 16 <= byte_count; offset += 16) {
        const __m128i chunk = _mm_loadu_si128(reinterpret_cast<const __m128i *>(source + offset));
        _mm_storeu_si128(reinterpret_cast<__m128i *>(destination + offset), chunk);
    }
    if (offset < byte_count) {
        std::memcpy(destination + offset, source + offset, byte_count - offset);
    }
#elif defined(__ARM_NEON) || defined(__ARM_NEON__)
    size_t offset = 0;
    for (; offset + 16 <= byte_count; offset += 16) {
        const uint8x16_t chunk = vld1q_u8(source + offset);
        vst1q_u8(destination + offset, chunk);
    }
    if (offset < byte_count) {
        std::memcpy(destination + offset, source + offset, byte_count - offset);
    }
#else
    std::memcpy(destination, source, byte_count);
#endif
}

void lyra_image_extract_rgba_tile(
    const uint8_t *source,
    uint32_t source_width,
    uint32_t source_height,
    uint32_t level_scale,
    uint32_t tile_size,
    uint32_t tile_x,
    uint32_t tile_y,
    uint8_t *destination,
    uint32_t destination_width,
    uint32_t destination_height
) {
    if (source == nullptr || destination == nullptr || source_width == 0 || source_height == 0) {
        return;
    }

    const uint32_t scale = std::max<uint32_t>(1, level_scale);
    const uint64_t image_origin_x = static_cast<uint64_t>(tile_x) * tile_size * scale;
    const uint64_t image_origin_y = static_cast<uint64_t>(tile_y) * tile_size * scale;

    for (uint32_t row = 0; row < destination_height; ++row) {
        const uint64_t source_y = std::min<uint64_t>(
            image_origin_y + static_cast<uint64_t>(row) * scale,
            static_cast<uint64_t>(source_height - 1)
        );
        uint8_t *destination_row = destination + static_cast<size_t>(row) * destination_width * 4;

        if (scale == 1) {
            const uint64_t source_x = std::min<uint64_t>(
                image_origin_x,
                static_cast<uint64_t>(source_width - 1)
            );
            const uint8_t *source_row = source
                + (static_cast<size_t>(source_y) * source_width + static_cast<size_t>(source_x)) * 4;
            const uint32_t available = source_width - static_cast<uint32_t>(source_x);
            const uint32_t copy_pixels = std::min<uint32_t>(destination_width, available);
            lyra_image_copy_rgba_row(destination_row, source_row, copy_pixels);
            continue;
        }

        for (uint32_t column = 0; column < destination_width; ++column) {
            const uint64_t source_x = std::min<uint64_t>(
                image_origin_x + static_cast<uint64_t>(column) * scale,
                static_cast<uint64_t>(source_width - 1)
            );
            const uint8_t *pixel = source
                + (static_cast<size_t>(source_y) * source_width + static_cast<size_t>(source_x)) * 4;
            uint8_t *out = destination_row + static_cast<size_t>(column) * 4;
            out[0] = pixel[0];
            out[1] = pixel[1];
            out[2] = pixel[2];
            out[3] = pixel[3];
        }
    }
}
