#include "oiio_bridge.h"

#include <OpenImageIO/imagecache.h>
#include <OpenImageIO/imageio.h>
#include <OpenImageIO/typedesc.h>
#include <OpenImageIO/ustring.h>

#include <algorithm>
#include <cctype>
#include <cstring>
#include <memory>
#include <mutex>
#include <string>
#include <vector>

namespace {

OIIO::ImageCache *shared_cache()
{
    static std::once_flag once;
    static OIIO::ImageCache *cache = nullptr;
    std::call_once(once, [] {
        cache = OIIO::ImageCache::create(true);
        cache->attribute("max_memory_MB", 768.0f);
        cache->attribute("autotile", 512);
        cache->attribute("autoscanline", 0);
        cache->attribute("forcefloat", 0);
    });
    return cache;
}

void copy_string(char *target, size_t target_len, const std::string &value)
{
    if (target == nullptr || target_len == 0) {
        return;
    }
    const size_t count = std::min(target_len - 1, value.size());
    std::memcpy(target, value.data(), count);
    target[count] = '\0';
}

void copy_error(char *target, size_t target_len, const std::string &value)
{
    copy_string(target, target_len, value.empty() ? "OpenImageIO operation failed" : value);
}

bool get_spec(const char *path, OIIO::ImageSpec &spec, std::string &error)
{
    auto *cache = shared_cache();
    if (cache == nullptr) {
        error = "OpenImageIO ImageCache is unavailable";
        return false;
    }
    const bool ok = cache->get_imagespec(OIIO::ustring(path), spec, 0);
    if (!ok) {
        error = cache->geterror();
    }
    return ok;
}

bool get_mip_dimensions(const char *path, int miplevel, OIIO::ImageSpec &spec, std::string &error)
{
    auto *cache = shared_cache();
    if (cache == nullptr) {
        error = "OpenImageIO ImageCache is unavailable";
        return false;
    }
    const bool ok = cache->get_cache_dimensions(OIIO::ustring(path), spec, 0, miplevel);
    if (!ok) {
        error = cache->geterror();
    }
    return ok;
}

uint32_t sample_format_code(const OIIO::TypeDesc &format)
{
    switch (format.basetype) {
        case OIIO::TypeDesc::INT8:
        case OIIO::TypeDesc::INT16:
        case OIIO::TypeDesc::INT32:
        case OIIO::TypeDesc::INT64:
            return 2;
        case OIIO::TypeDesc::HALF:
        case OIIO::TypeDesc::FLOAT:
        case OIIO::TypeDesc::DOUBLE:
            return 3;
        default:
            return 1;
    }
}

bool has_alpha_channel(const OIIO::ImageSpec &spec)
{
    if (spec.alpha_channel >= 0) {
        return true;
    }
    for (const auto &name : spec.channelnames) {
        std::string lower = name;
        std::transform(lower.begin(), lower.end(), lower.begin(), [](unsigned char value) {
            return static_cast<char>(std::tolower(value));
        });
        if (lower == "a" || lower == "alpha" || lower == "opacity") {
            return true;
        }
    }
    return spec.nchannels == 2 || spec.nchannels >= 4;
}

bool has_mipmaps(const char *path)
{
    OIIO::ImageSpec ignored;
    std::string error;
    return get_mip_dimensions(path, 1, ignored, error);
}

void write_rgba_pixel(uint8_t *out, size_t offset, const uint8_t *source, int channels, int alpha_channel)
{
    if (channels <= 0 || source == nullptr) {
        out[offset + 0] = 0;
        out[offset + 1] = 0;
        out[offset + 2] = 0;
        out[offset + 3] = 255;
        return;
    }

    if (channels == 1) {
        out[offset + 0] = source[0];
        out[offset + 1] = source[0];
        out[offset + 2] = source[0];
        out[offset + 3] = 255;
        return;
    }

    if (channels == 2) {
        out[offset + 0] = source[0];
        out[offset + 1] = source[0];
        out[offset + 2] = source[0];
        out[offset + 3] = source[1];
        return;
    }

    out[offset + 0] = source[0];
    out[offset + 1] = source[1];
    out[offset + 2] = source[2];
    out[offset + 3] = alpha_channel >= 0 && alpha_channel < channels
        ? source[alpha_channel]
        : (channels >= 4 ? source[3] : 255);
}

bool read_row_sampled(
    const char *path,
    const OIIO::ImageSpec &spec,
    uint32_t source_x,
    uint32_t source_y,
    uint32_t source_scale,
    uint32_t out_width,
    uint32_t out_row,
    uint8_t *out_pixels,
    std::string &error)
{
    const uint32_t channels = std::max(1, spec.nchannels);
    const uint32_t clamped_y = std::min(source_y, static_cast<uint32_t>(std::max(0, spec.height - 1)));
    const uint32_t last_x = std::min(
        source_x + (out_width == 0 ? 0 : (out_width - 1) * source_scale),
        static_cast<uint32_t>(std::max(0, spec.width - 1)));
    const uint32_t span = last_x >= source_x ? last_x - source_x + 1 : 1;
    std::vector<uint8_t> row(static_cast<size_t>(span) * channels);
    auto *cache = shared_cache();
    const bool ok = cache->get_pixels(
        OIIO::ustring(path),
        0,
        0,
        static_cast<int>(source_x),
        static_cast<int>(source_x + span),
        static_cast<int>(clamped_y),
        static_cast<int>(clamped_y + 1),
        0,
        1,
        0,
        static_cast<int>(channels),
        OIIO::TypeDesc::UINT8,
        row.data());
    if (!ok) {
        error = cache->geterror();
        return false;
    }

    for (uint32_t column = 0; column < out_width; column += 1) {
        const uint32_t local_x = std::min(column * source_scale, span - 1);
        const size_t source_offset = static_cast<size_t>(local_x) * channels;
        const size_t out_offset = (static_cast<size_t>(out_row) * out_width + column) * 4;
        write_rgba_pixel(out_pixels, out_offset, &row[source_offset], static_cast<int>(channels), spec.alpha_channel);
    }
    return true;
}

} // namespace

extern "C" int lyra_oiio_available(void)
{
    return shared_cache() == nullptr ? 0 : 1;
}

extern "C" int lyra_oiio_probe(const char *path, LyraOiioImageInfo *info)
{
    if (path == nullptr || info == nullptr) {
        return 0;
    }
    std::memset(info, 0, sizeof(LyraOiioImageInfo));

    OIIO::ImageSpec spec;
    std::string error;
    if (!get_spec(path, spec, error)) {
        copy_error(info->error, sizeof(info->error), error);
        return 0;
    }

    info->width = static_cast<uint32_t>(std::max(0, spec.width));
    info->height = static_cast<uint32_t>(std::max(0, spec.height));
    info->channel_count = static_cast<uint32_t>(std::max(1, spec.nchannels));
    info->tile_width = static_cast<uint32_t>(std::max(0, spec.tile_width));
    info->tile_height = static_cast<uint32_t>(std::max(0, spec.tile_height));
    info->has_alpha = has_alpha_channel(spec) ? 1 : 0;
    info->has_internal_tiles = spec.tile_width > 0 && spec.tile_height > 0 ? 1 : 0;
    info->has_internal_mipmaps = has_mipmaps(path) ? 1 : 0;
    info->sample_format = sample_format_code(spec.format);
    copy_string(info->format_name, sizeof(info->format_name), "oiio");
    copy_string(info->color_space, sizeof(info->color_space), spec.get_string_attribute("oiio:ColorSpace", "srgb"));
    return 1;
}

extern "C" int lyra_oiio_read_rgba_tile(
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
        copy_error(error, error_len, "invalid OpenImageIO tile request");
        return 0;
    }

    OIIO::ImageSpec spec;
    std::string spec_error;
    if (!get_spec(path, spec, spec_error)) {
        copy_error(error, error_len, spec_error);
        return 0;
    }

    source_scale = std::max(1u, source_scale);
    const uint32_t channels = static_cast<uint32_t>(std::max(1, spec.nchannels));
    auto *cache = shared_cache();
    if (cache == nullptr) {
        copy_error(error, error_len, "OpenImageIO ImageCache is unavailable");
        return 0;
    }

    if (source_scale == 1) {
        std::vector<uint8_t> pixels(static_cast<size_t>(out_width) * out_height * channels);
        const bool ok = cache->get_pixels(
            OIIO::ustring(path),
            0,
            0,
            static_cast<int>(source_x),
            static_cast<int>(source_x + out_width),
            static_cast<int>(source_y),
            static_cast<int>(source_y + out_height),
            0,
            1,
            0,
            static_cast<int>(channels),
            OIIO::TypeDesc::UINT8,
            pixels.data());
        if (!ok) {
            copy_error(error, error_len, cache->geterror());
            return 0;
        }
        for (uint32_t row = 0; row < out_height; row += 1) {
            for (uint32_t column = 0; column < out_width; column += 1) {
                const size_t source_offset = (static_cast<size_t>(row) * out_width + column) * channels;
                const size_t out_offset = (static_cast<size_t>(row) * out_width + column) * 4;
                write_rgba_pixel(out_pixels, out_offset, &pixels[source_offset], static_cast<int>(channels), spec.alpha_channel);
            }
        }
        return 1;
    }

    for (uint32_t row = 0; row < out_height; row += 1) {
        std::string row_error;
        if (!read_row_sampled(
                path,
                spec,
                source_x,
                source_y + row * source_scale,
                source_scale,
                out_width,
                row,
                out_pixels,
                row_error)) {
            copy_error(error, error_len, row_error);
            return 0;
        }
    }
    return 1;
}
