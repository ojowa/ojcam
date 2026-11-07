//
//  audio-source.h
//  Ojowacam OBS macOS Plugin
//

#import <obs-module.h>

extern obs_source_info ojowacam_audio_source_info;

void *ojowacam_audio_create(obs_data_t *settings, obs_source_t *source);
void ojowacam_audio_destroy(void *data);
void ojowacam_audio_tick(void *data, float seconds);
obs_properties_t *ojowacam_audio_properties(void *data);
