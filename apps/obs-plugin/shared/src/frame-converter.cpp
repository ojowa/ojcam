#include "frame-converter.h"

namespace ojowacam {

FrameConverter::FrameConverter() = default;
FrameConverter::~FrameConverter() {
    if (current_texture_) {
        gs_texture_destroy(current_texture_);
    }
}

gs_texture_t* FrameConverter::convertToTexture(const std::vector<uint8_t>& data,
                                               int width, int height,
                                               gs_texture_t* existing_texture) {
    // Recreate texture if dimensions changed
    if (!existing_texture || width != current_width_ || height != current_height_) {
        if (existing_texture) {
            gs_texture_destroy(existing_texture);
        }
        // OBS expects 4-component RGBA for gs_texture_create. If the decoder
        // outputs raw YUV/H264 NAL data, this path should be replaced with a
        // proper decoder (FFmpeg/MediaCodec/VideoToolbox). For now we treat
        // incoming data as RGBA passthrough.
        current_texture_ = gs_texture_create(width, height, GS_RGBA, 1, nullptr, GS_DYNAMIC);
        current_width_ = width;
        current_height_ = height;
    }

    if (!current_texture_) return nullptr;

    // Upload pixel data to the texture. OBS uses tightly packed RGBA rows.
    gs_texture_set_data(current_texture_, data.data(), width * 4 * sizeof(uint8_t));

    return current_texture_;
}

void FrameConverter::releaseTexture(gs_texture_t* texture) {
    if (texture) {
        gs_texture_destroy(texture);
    }
}

} // namespace ojowacam