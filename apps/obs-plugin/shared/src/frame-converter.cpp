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
    (void)data;
    (void)width;
    (void)height;
    (void)existing_texture;
    return nullptr;
}

void FrameConverter::releaseTexture(gs_texture_t* texture) {
    if (texture) {
        gs_texture_destroy(texture);
    }
}

} // namespace ojowacam