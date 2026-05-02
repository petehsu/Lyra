#ifndef LYRA_IMAGE_TILE_KERNEL_H
#define LYRA_IMAGE_TILE_KERNEL_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

const char *lyra_image_tile_kernel_accel_name(void);

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
);

#ifdef __cplusplus
}
#endif

#endif
