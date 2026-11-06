//
//  audio-source.mm
//  Ojowacam OBS macOS Plugin
//

#import "audio-source.h"
#import "stream-receiver.h"

@interface OjowacamAudioData : NSObject
@property (nonatomic) obs_source_t *source;
@property (nonatomic) float sampleRate;
@property (nonatomic) OjowacamStreamReceiver *streamReceiver;
@end

obs_source_info ojowacam_audio_source_info = {
    .id = "ojowacam_audio_source",
    .type = OBS_SOURCE_TYPE_INPUT,
    .flags = OBS_SOURCE_AUDIO,
    .get_name = ^(void *data) {
        return "Ojowacam Microphone";
    },
    .create = ojowacam_audio_create,
    .destroy = ojowacam_audio_destroy,
    .tick = ojowacam_audio_tick,
    .get_properties = ojowacam_audio_properties,
};

void *ojowacam_audio_create(obs_data_t *settings, obs_source_t *source) {
    auto *data = new OjowacamAudioData();
    data->source = source;
    data->sampleRate = 48000.0f;
    
    const char *deviceId = obs_data_get_string(settings, "device_id");
    const char *signalingUrl = obs_data_get_string(settings, "signaling_url");
    
    if (deviceId && signalingUrl) {
        data->streamReceiver = [[OjowacamStreamReceiver alloc] initWithVideoSource:nil audioSource:source];
        [data->streamReceiver connectWithDeviceId:@(deviceId) signalingURL:@(signalingUrl)];
    }
    
    return data;
}

void ojowacam_audio_destroy(void *data) {
    auto *d = static_cast<OjowacamAudioData *>(data);
    if (d->streamReceiver) {
        [d->streamReceiver disconnect];
    }
    delete d;
}

void ojowacam_audio_tick(void *data, float seconds) {
    // Audio is pushed via stream receiver callback
    UNUSED_PARAMETER(data);
    UNUSED_PARAMETER(seconds);
}

obs_properties_t *ojowacam_audio_properties(void *data) {
    auto *props = obs_properties_create();
    
    obs_properties_add_text(props, "device_id", "Device ID", OBS_TEXT_DEFAULT);
    obs_properties_add_text(props, "signaling_url", "Signaling URL (ws://)", OBS_TEXT_DEFAULT);
    obs_properties_add_int(props, "sample_rate", "Sample Rate", 8000, 192000, 1);
    obs_properties_add_int(props, "channels", "Channels", 1, 8, 1);
    
    return props;
}
