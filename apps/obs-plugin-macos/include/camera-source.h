//
//  camera-source.h
//  Ojowacam OBS macOS Plugin
//

#import <obs-module.h>
#import <CoreMediaIO/CoreMediaIO.h>

extern obs_source_info ojowacam_camera_source_info;

void *ojowacam_camera_create(obs_data_t *settings, obs_source_t *source);
void ojowacam_camera_destroy(void *data);
void ojowacam_camera_render(void *data, gs_effect_t *effect);
uint32_t ojowacam_camera_width(void *data);
uint32_t ojowacam_camera_height(void *data);
bool ojowacam_camera_get_default_size(obs_data_t *settings, uint32_t *cx, uint32_t *cy);
void ojowacam_camera_update(void *data, obs_data_t *settings);
obs_properties_t *ojowacam_camera_properties(void *data);
