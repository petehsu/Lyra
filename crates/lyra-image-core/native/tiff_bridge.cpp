#include "tiff_bridge.h"

#include <tiffio.h>

#include <algorithm>
#include <cstring>
#include <string>
#include <unordered_map>
#include <vector>

namespace {

void copy_error(char *target, size_t target_len, const std::string &value)
{
    if (target == nullptr || target_len == 0) {
        return;
    }
    const std::string message = value.empty() ? "libtiff operation failed" : value;
    const size_t count = std::min(target_len - 1, message.size());
    std::memcpy(target, message.data(), count);
    target[count] = '\0';
}

void write_pixel(uint8_t *out, size_t offset, const uint8_t *sample, uint16_t samples, uint16_t photometric)
{
    if (samples == 0 || sample == nullptr) {
        out[offset + 0] = 0;
        out[offset + 1] = 0;
        out[offset + 2] = 0;
        out[offset + 3] = 255;
        return;
    }
    if (samples == 1) {
        uint8_t gray = sample[0];
        if (photometric == PHOTOMETRIC_MINISWHITE) {
            gray = 255 - gray;
        }
        out[offset + 0] = gray;
        out[offset + 1] = gray;
        out[offset + 2] = gray;
        out[offset + 3] = 255;
        return;
    }
    if (samples == 2) {
        uint8_t gray = sample[0];
        if (photometric == PHOTOMETRIC_MINISWHITE) {
            gray = 255 - gray;
        }
        out[offset + 0] = gray;
        out[offset + 1] = gray;
        out[offset + 2] = gray;
        out[offset + 3] = sample[1];
        return;
    }
    out[offset + 0] = sample[0];
    out[offset + 1] = sample[1];
    out[offset + 2] = sample[2];
    out[offset + 3] = samples >= 4 ? sample[3] : 255;
}

bool validate_supported(TIFF *tif, uint32_t &image_width, uint32_t &image_height, uint16_t &samples, uint16_t &photometric, std::string &error)
{
    uint16_t bits_per_sample = 0;
    uint16_t planar_config = PLANARCONFIG_CONTIG;
    TIFFGetField(tif, TIFFTAG_IMAGEWIDTH, &image_width);
    TIFFGetField(tif, TIFFTAG_IMAGELENGTH, &image_height);
    TIFFGetFieldDefaulted(tif, TIFFTAG_SAMPLESPERPIXEL, &samples);
    TIFFGetFieldDefaulted(tif, TIFFTAG_BITSPERSAMPLE, &bits_per_sample);
    TIFFGetFieldDefaulted(tif, TIFFTAG_PHOTOMETRIC, &photometric);
    TIFFGetFieldDefaulted(tif, TIFFTAG_PLANARCONFIG, &planar_config);
    if (image_width == 0 || image_height == 0) {
        error = "TIFF image has invalid dimensions";
        return false;
    }
    if (bits_per_sample != 8) {
        error = "libtiff ROI bridge currently supports 8-bit TIFF samples";
        return false;
    }
    if (planar_config != PLANARCONFIG_CONTIG) {
        error = "libtiff ROI bridge currently supports contiguous planar TIFF data";
        return false;
    }
    if (samples == 0 || samples > 4) {
        error = "libtiff ROI bridge currently supports 1-4 samples per pixel";
        return false;
    }
    if (
        photometric != PHOTOMETRIC_RGB &&
        photometric != PHOTOMETRIC_MINISBLACK &&
        photometric != PHOTOMETRIC_MINISWHITE
    ) {
        error = "libtiff ROI bridge currently supports RGB and grayscale TIFF data";
        return false;
    }
    return true;
}

bool read_stripped_tile(
    TIFF *tif,
    uint32_t image_width,
    uint32_t image_height,
    uint16_t samples,
    uint16_t photometric,
    uint32_t source_x,
    uint32_t source_y,
    uint32_t source_scale,
    uint32_t out_width,
    uint32_t out_height,
    uint8_t *out_pixels,
    std::string &error)
{
    uint32_t rows_per_strip = 0;
    TIFFGetFieldDefaulted(tif, TIFFTAG_ROWSPERSTRIP, &rows_per_strip);
    if (rows_per_strip == 0) {
        error = "TIFF rows per strip is invalid";
        return false;
    }
    const tmsize_t strip_size = TIFFStripSize(tif);
    const tmsize_t scanline_size = TIFFScanlineSize(tif);
    if (strip_size <= 0 || scanline_size <= 0) {
        error = "TIFF strip size is invalid";
        return false;
    }
    std::vector<uint8_t> strip(static_cast<size_t>(strip_size));
    uint32_t cached_strip = UINT32_MAX;
    source_scale = std::max(1u, source_scale);

    for (uint32_t row = 0; row < out_height; row += 1) {
        const uint32_t sy = std::min(
            source_y + row * source_scale,
            image_height - 1);
        const uint32_t strip_index = TIFFComputeStrip(tif, sy, 0);
        if (strip_index != cached_strip) {
            const tmsize_t bytes = TIFFReadEncodedStrip(tif, strip_index, strip.data(), strip_size);
            if (bytes < 0) {
                error = "libtiff failed to decode strip";
                return false;
            }
            cached_strip = strip_index;
        }
        const uint32_t row_in_strip = sy % rows_per_strip;
        const uint8_t *line = strip.data() + static_cast<size_t>(row_in_strip) * static_cast<size_t>(scanline_size);
        for (uint32_t column = 0; column < out_width; column += 1) {
            const uint32_t sx = std::min(
                source_x + column * source_scale,
                image_width - 1);
            const uint8_t *sample = line + static_cast<size_t>(sx) * samples;
            const size_t out_offset = (static_cast<size_t>(row) * out_width + column) * 4;
            write_pixel(out_pixels, out_offset, sample, samples, photometric);
        }
    }
    return true;
}

bool read_tiled_tile(
    TIFF *tif,
    uint32_t image_width,
    uint32_t image_height,
    uint16_t samples,
    uint16_t photometric,
    uint32_t source_x,
    uint32_t source_y,
    uint32_t source_scale,
    uint32_t out_width,
    uint32_t out_height,
    uint8_t *out_pixels,
    std::string &error)
{
    uint32_t tile_width = 0;
    uint32_t tile_height = 0;
    TIFFGetField(tif, TIFFTAG_TILEWIDTH, &tile_width);
    TIFFGetField(tif, TIFFTAG_TILELENGTH, &tile_height);
    const tmsize_t tile_size = TIFFTileSize(tif);
    if (tile_width == 0 || tile_height == 0 || tile_size <= 0) {
        error = "TIFF tile size is invalid";
        return false;
    }

    std::unordered_map<uint32_t, std::vector<uint8_t>> tiles;
    source_scale = std::max(1u, source_scale);
    for (uint32_t row = 0; row < out_height; row += 1) {
        const uint32_t sy = std::min(
            source_y + row * source_scale,
            image_height - 1);
        for (uint32_t column = 0; column < out_width; column += 1) {
            const uint32_t sx = std::min(
                source_x + column * source_scale,
                image_width - 1);
            const uint32_t tile_index = TIFFComputeTile(tif, sx, sy, 0, 0);
            auto entry = tiles.find(tile_index);
            if (entry == tiles.end()) {
                std::vector<uint8_t> tile(static_cast<size_t>(tile_size));
                const tmsize_t bytes = TIFFReadEncodedTile(tif, tile_index, tile.data(), tile_size);
                if (bytes < 0) {
                    error = "libtiff failed to decode tile";
                    return false;
                }
                entry = tiles.emplace(tile_index, std::move(tile)).first;
            }
            const uint32_t local_x = sx % tile_width;
            const uint32_t local_y = sy % tile_height;
            const uint8_t *sample = entry->second.data()
                + (static_cast<size_t>(local_y) * tile_width + local_x) * samples;
            const size_t out_offset = (static_cast<size_t>(row) * out_width + column) * 4;
            write_pixel(out_pixels, out_offset, sample, samples, photometric);
        }
    }
    return true;
}

} // namespace

extern "C" int lyra_libtiff_available(void)
{
    return 1;
}

extern "C" int lyra_libtiff_read_rgba_tile(
    const char *path,
    uint32_t source_x,
    uint32_t source_y,
    uint32_t source_scale,
    uint32_t out_width,
    uint32_t out_height,
    uint8_t *out_pixels,
    char *error,
    size_t error_len)
{
    if (path == nullptr || out_pixels == nullptr || out_width == 0 || out_height == 0) {
        copy_error(error, error_len, "invalid libtiff tile request");
        return 0;
    }

    TIFFSetWarningHandler(nullptr);
    TIFFSetErrorHandler(nullptr);
    TIFF *tif = TIFFOpen(path, "r");
    if (tif == nullptr) {
        copy_error(error, error_len, "libtiff failed to open image");
        return 0;
    }

    uint32_t image_width = 0;
    uint32_t image_height = 0;
    uint16_t samples = 0;
    uint16_t photometric = 0;
    std::string message;
    bool ok = validate_supported(tif, image_width, image_height, samples, photometric, message);
    if (ok) {
        if (TIFFIsTiled(tif)) {
            ok = read_tiled_tile(
                tif,
                image_width,
                image_height,
                samples,
                photometric,
                source_x,
                source_y,
                source_scale,
                out_width,
                out_height,
                out_pixels,
                message);
        } else {
            ok = read_stripped_tile(
                tif,
                image_width,
                image_height,
                samples,
                photometric,
                source_x,
                source_y,
                source_scale,
                out_width,
                out_height,
                out_pixels,
                message);
        }
    }
    TIFFClose(tif);
    if (!ok) {
        copy_error(error, error_len, message);
        return 0;
    }
    return 1;
}
