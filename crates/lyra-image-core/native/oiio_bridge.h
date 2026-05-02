#pragma once

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct LyraOiioImageInfo {
    uint32_t width;
    uint32_t height;
    uint32_t channel_count;
    uint32_t tile_width;
    uint32_t tile_height;
    uint32_t has_alpha;
    uint32_t has_internal_tiles;
    uint32_t has_internal_mipmaps;
    uint32_t sample_format;
    char format_name[64];
    char color_space[64];
    char error[512];
} LyraOiioImageInfo;

int lyra_oiio_available(void);

int lyra_oiio_probe(const char *path, LyraOiioImageInfo *info);

int lyra_oiio_read_rgba_tile(
    const char *path,
    uint32_t source_x,
    uint32_t source_y,
    uint32_t source_scale,
    uint32_t out_width,
    uint32_t out_height,
    uint8_t *out_pixels,
    char *error,
    size_t error_len);

#ifdef __cplusplus
}
#endif
