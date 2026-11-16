//
//  camera-source.h
//  Ojowacam OBS macOS Plugin
//

#pragma once

#include <obs-module.h>

#ifdef __cplusplus
extern "C" {
#endif

// Video source info structure required by OBS
extern obs_source_info ojowacam_camera_source_info;

// Video source callbacks
void *ojowacam_camera_create(obs_data_t *settings, obs_source_t *source);
void ojowacam_camera_destroy(void *data);
uint32_t ojowacam_camera_width(void *data);
uint32_t ojowacam_camera_height(void *data);
void ojowacam_camera_update(void *data, obs_data_t *settings);
obs_properties_t *ojowacam_camera_properties(void *data);

#ifdef __cplusplus
}
#endif
