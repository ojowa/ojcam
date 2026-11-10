#pragma once

#include <obs-module.h>

extern "C" {

// Video source info structure required by OBS
extern obs_source_info ojowacam_video_source_info;

// Video source callbacks
void *ojowacam_video_create(obs_data_t *settings, obs_source_t *source);
void ojowacam_video_destroy(void *data);
void ojowacam_video_render(void *data, gs_effect_t *effect);
uint32_t ojowacam_video_width(void *data);
uint32_t ojowacam_video_height(void *data);
void ojowacam_video_update(void *data, obs_data_t *settings);
obs_properties_t *ojowacam_video_properties(void *data);

} // extern "C"
