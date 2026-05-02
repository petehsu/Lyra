#pragma once

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

int lyra_libtiff_available(void);

int lyra_libtiff_read_rgba_tile(
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
