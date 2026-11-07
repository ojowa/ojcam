#pragma once

#include <obs-module.h>
#include <vector>
#include <cstdint>

namespace ojowacam {

class FrameConverter {
public:
    FrameConverter();
    ~FrameConverter();
    
    // Convert decoded video frame to OBS texture
    gs_texture_t* convertToTexture(const std::vector<uint8_t>& data, 
                                   int width, int height,
                                   gs_texture_t* existing_texture = nullptr);
    
    // Release texture
    void releaseTexture(gs_texture_t* texture);
    
private:
    gs_texture_t* current_texture_ = nullptr;
    int current_width_ = 0;
    int current_height_ = 0;
};

} // namespace ojowacam