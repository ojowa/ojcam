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
    // Recreate texture if size changed
    if (width != current_width_ || height != current_height_) {
        if (current_texture_) {
            gs_texture_destroy(current_texture_);
            current_texture_ = nullptr;
        }
        
        current_texture_ = gs_texture_create(width, height, GS_BGRA, false, 1, nullptr);
        current_width_ = width;
        current_height_ = height;
    }
    
    if (!current_texture_) return nullptr;
    
    // TODO: Convert encoded data to BGRA texture
    // For now, return existing texture (actual decode would fill it)
    return current_texture_;
}

void FrameConverter::releaseTexture(gs_texture_t* texture) {
    if (texture) {
        gs_texture_destroy(texture);
    }
}

} // namespace ojowacam