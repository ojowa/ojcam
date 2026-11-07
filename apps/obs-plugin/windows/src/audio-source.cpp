#include "audio-source.h"
#include "stream-receiver.h"

struct OjowacamAudioData {
    obs_source_t *source;
    float sample_rate;
    ojowacam::StreamReceiver* stream_receiver = nullptr;
};

// Source info
obs_source_info ojowacam_audio_source_info = {
    .id = "ojowacam_audio_source",
    .type = OBS_SOURCE_TYPE_INPUT,
    .flags = OBS_SOURCE_AUDIO,
    .get_name = [](void *) -> const char * {
        return "Ojowacam Microphone";
    },
    .create = ojowacam_audio_create,
    .destroy = [](void *data) {
        auto *d = static_cast<OjowacamAudioData *>(data);
        if (d->stream_receiver) {
            d->stream_receiver->disconnect();
            delete d->stream_receiver;
        }
        delete d;
    },
    .tick = ojowacam_audio_tick,
    .get_properties = ojowacam_audio_properties,
};

void *ojowacam_audio_create(obs_data_t *settings, obs_source_t *source)
{
    auto data = new OjowacamAudioData();
    data->source = source;
    data->sample_rate = 48000.0f;

    const char* device_id = obs_data_get_string(settings, "device_id");
    const char* signaling_url = obs_data_get_string(settings, "signaling_url");
    
    if (device_id && signaling_url) {
        data->stream_receiver = new ojowacam::StreamReceiver(nullptr, source);
        data->stream_receiver->connect(device_id, signaling_url);
    }

    return data;
}

void ojowacam_audio_tick(void *data, float seconds)
{
    auto *d = static_cast<OjowacamAudioData *>(data);
    UNUSED_PARAMETER(seconds);

    // Audio is pushed via StreamReceiver callback to obs_source_output_audio
    UNUSED_PARAMETER(d);
}

obs_properties_t *ojowacam_audio_properties(void *data)
{
    auto *props = obs_properties_create();
    UNUSED_PARAMETER(data);

    obs_properties_add_text(props, "device_id", "Device ID", OBS_TEXT_DEFAULT);
    obs_properties_add_text(props, "signaling_url", "Signaling URL (ws://)", OBS_TEXT_DEFAULT);
    obs_properties_add_button(props, "connect", "Connect to Device", [](obs_properties_t*, obs_property_t*, void* data) {
        auto *d = static_cast<OjowacamAudioData*>(data);
        if (d->stream_receiver) {
            d->stream_receiver->disconnect();
            delete d->stream_receiver;
            d->stream_receiver = nullptr;
        }
        
        // Read current settings and reconnect
        // Note: settings access would need obs_source_get_settings here
        return true;
    });
    obs_properties_add_int(props, "sample_rate", "Sample Rate", 8000, 192000, 1);
    obs_properties_add_int(props, "channels", "Channels", 1, 8, 1);

    return props;
}
