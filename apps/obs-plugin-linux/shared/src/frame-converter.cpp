#include "frame-converter.h"
#include <obs-module.h>
#include <cmath>
#include <algorithm>

namespace ojowacam {

FrameConverter::FrameConverter() = default;

FrameConverter::~FrameConverter() {
    if (current_texture_) {
        gs_texture_destroy(current_texture_);
        current_texture_ = nullptr;
    }
}

// ---------------------------------------------------------------------------
// Helper: clamp a value to [0, 255]
// ---------------------------------------------------------------------------

static inline uint8_t clamp255(int v) {
    return static_cast<uint8_t>(std::max(0, std::min(255, v)));
}

// ---------------------------------------------------------------------------
// YUV420 (I420) → RGBA conversion
//
// Y plane:  width × height
// U plane: (width/2) × (height/2)
// V plane: (width/2) × (height/2)
// ---------------------------------------------------------------------------

static void yuv420ToRgba(const uint8_t* y, const uint8_t* u, const uint8_t* v,
                         int width, int height, uint8_t* rgba) {
    int uv_width = (width + 1) / 2;
    int uv_height = (height + 1) / 2;

    for (int row = 0; row < height; ++row) {
        int uv_row = row / 2;
        const uint8_t* y_row = y + row * width;
        const uint8_t* u_row = u + uv_row * uv_width;
        const uint8_t* v_row = v + uv_row * uv_width;
        uint8_t* rgba_row = rgba + row * width * 4;

        for (int col = 0; col < width; ++col) {
            int uv_col = col / 2;
            int Y = y_row[col] - 16;
            int U = u_row[uv_col] - 128;
            int V = v_row[uv_col] - 128;

            if (Y < 0) Y = 0;

            int R = (298 * Y + 409 * V + 128) >> 8;
            int G = (298 * Y - 100 * U - 208 * V + 128) >> 8;
            int B = (298 * Y + 516 * U + 128) >> 8;

            rgba_row[col * 4 + 0] = clamp255(R);
            rgba_row[col * 4 + 1] = clamp255(G);
            rgba_row[col * 4 + 2] = clamp255(B);
            rgba_row[col * 4 + 3] = 255;
        }
    }
}

// ---------------------------------------------------------------------------
// NV12 → RGBA conversion
//
// Y plane:  width × height
// UV plane: (width/2) × (height/2) with interleaved U,V bytes
// ---------------------------------------------------------------------------

static void nv12ToRgba(const uint8_t* y, const uint8_t* uv,
                        int width, int height, uint8_t* rgba) {
    int uv_width = (width + 1) / 2;
    int uv_height = (height + 1) / 2;

    for (int row = 0; row < height; ++row) {
        int uv_row = row / 2;
        const uint8_t* y_row = y + row * width;
        const uint8_t* uv_row = uv + uv_row * uv_width * 2;
        uint8_t* rgba_row = rgba + row * width * 4;

        for (int col = 0; col < width; ++col) {
            int uv_col = col / 2;
            int Y = y_row[col] - 16;
            int U = uv_row[uv_col * 2 + 0] - 128;
            int V = uv_row[uv_col * 2 + 1] - 128;

            if (Y < 0) Y = 0;

// ---------------------------------------------------------------------------
// convertToTexture – convert any supported pixel format to an OBS RGBA texture
// ---------------------------------------------------------------------------

gs_texture_t* FrameConverter::convertToTexture(const std::vector<uint8_t>& data,
                                               int width, int height,
                                               gs_texture_t* existing_texture) {
    if (width <= 0 || height <= 0) return nullptr;

    // Recreate texture if dimensions changed
    if (!existing_texture || width != current_width_ || height != current_height_) {
        if (existing_texture) {
            gs_texture_destroy(existing_texture);
        }
        current_texture_ = gs_texture_create(width, height, GS_RGBA, 1, nullptr, GS_DYNAMIC);
        current_width_ = width;
        current_height_ = height;
    }

    if (!current_texture_) return nullptr;

    // Convert pixel data to RGBA in a temporary buffer
    size_t rgba_size = static_cast<size_t>(width) * height * 4;
    std::vector<uint8_t> rgba(rgba_size);

    const uint8_t* src = data.data();
    switch (current_format_) {
        case VideoPixelFormat::YUV420: {
            size_t y_size = static_cast<size_t>(width) * height;
            size_t uv_size = ((width + 1) / 2) * ((height + 1) / 2);
            yuv420ToRgba(src, src + y_size, src + y_size + uv_size,
                         width, height, rgba.data());
            break;
        }
        case VideoPixelFormat::NV12: {
            size_t y_size = static_cast<size_t>(width) * height;
            nv12ToRgba(src, src + y_size, width, height, rgba.data());
            break;
        }
        case VideoPixelFormat::RGBA:
            rgbaToRgba(src, width, height, rgba.data());
            break;
        case VideoPixelFormat::Unknown:
        default:
            // Passthrough – copy as-is (caller must ensure RGBA layout)
            std::memcpy(rgba.data(), src,
                        std::min(rgba_size, data.size()));
            break;
    }

    gs_texture_set_data(current_texture_, rgba.data(),
                        width * 4 * sizeof(uint8_t));

    return current_texture_;
}

void FrameConverter::releaseTexture(gs_texture_t* texture) {
    if (texture) {
        gs_texture_destroy(texture);
    }
}

} // namespace ojowacam

            int R = (298 * Y + 409 * V + 128) >> 8;
            int G = (298 * Y - 100 * U - 208 * V + 128) >> 8;
            int B = (298 * Y + 516 * U + 128) >> 8;

            rgba_row[col * 4 + 0] = clamp255(R);
            rgba_row[col * 4 + 1] = clamp255(G);
            rgba_row[col * 4 + 2] = clamp255(B);
            rgba_row[col * 4 + 3] = 255;
        }
    }
}

// ---------------------------------------------------------------------------
// RGBA passthrough (data is already RGBA)
// ---------------------------------------------------------------------------

static void rgbaToRgba(const uint8_t* data, int width, int height, uint8_t* rgba) {
    size_t size = static_cast<size_t>(width) * height * 4;
    std::memcpy(rgba, data, size);
}