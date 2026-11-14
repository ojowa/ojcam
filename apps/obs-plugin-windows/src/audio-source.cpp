#include "audio-source.h"
#include "stream-receiver.h"
#include "shared-session.h"
#include <string>

struct OjowacamAudioData {
    obs_source_t *source;
    float sample_rate;
    std::shared_ptr<ojowacam::StreamReceiver> stream_receiver;
};

obs_source_info ojowacam_audio_source_info = [] {
    obs_source_info info{};
    info.id = "ojowacam_audio_source";
    info.type = OBS_SOURCE_TYPE_INPUT;
    info.output_flags = OBS_SOURCE_AUDIO;
    info.get_name = [](void *) -> const char * { return "Ojowacam Microphone"; };
    info.create = ojowacam_audio_create;
    info.destroy = [](void *data) {
        auto *d = static_cast<OjowacamAudioData *>(data);
        if (d->stream_receiver) {
            d->stream_receiver->setAudioSource(nullptr);
            d->stream_receiver.reset();
        }
        delete d;
    };
    info.get_properties = ojowacam_audio_properties;
    info.get_defaults = [](obs_data_t *settings) {
        obs_data_set_default_bool(settings, "auto_discover", true);
        obs_data_set_default_string(settings, "signaling_url", "");
    };
    return info;
}();

void *ojowacam_audio_create(obs_data_t *settings, obs_source_t *source)
{
    auto data = new OjowacamAudioData();
    data->source = source;
    data->sample_rate = 48000.0f;

    const char* device_id = obs_data_get_string(settings, "device_id");
    const char* signaling_url = obs_data_get_string(settings, "signaling_url");
    const bool auto_discover = obs_data_get_bool(settings, "auto_discover");

    std::string resolved_device_id = device_id ? device_id : "";
    std::string resolved_signaling_url = signaling_url ? signaling_url : "";

    if (!resolved_signaling_url.empty() || auto_discover) {
        data->stream_receiver = ojowacam::SharedSession::acquire(
            resolved_device_id, resolved_signaling_url, auto_discover);
        if (data->stream_receiver) {
            data->stream_receiver->setAudioSource(source);
        }
    }

    return data;
}

obs_properties_t *ojowacam_audio_properties(void *data)
{
    auto *props = obs_properties_create();
    UNUSED_PARAMETER(data);

    obs_properties_add_text(props, "device_id", "Device ID", OBS_TEXT_DEFAULT);
    obs_properties_add_text(props, "signaling_url", "Signaling URL (optional with auto-discovery)", OBS_TEXT_DEFAULT);
    obs_properties_add_bool(props, "auto_discover",
                            "Auto-discover the phone on this network (any IP)");
    obs_properties_add_button(props, "connect", "Connect to Device", [](obs_properties_t*, obs_property_t*, void* data) {
        auto *d = static_cast<OjowacamAudioData*>(data);

        if (d->stream_receiver) {
            d->stream_receiver->setAudioSource(nullptr);
            d->stream_receiver.reset();
        }

        obs_data_t *settings = obs_source_get_settings(d->source);
        const char *device_id = obs_data_get_string(settings, "device_id");
        const char *signaling_url = obs_data_get_string(settings, "signaling_url");
        const bool auto_discover = obs_data_get_bool(settings, "auto_discover");

        std::string resolved_device_id = device_id ? device_id : "";
        std::string resolved_signaling_url = signaling_url ? signaling_url : "";

        if (!resolved_signaling_url.empty() || auto_discover) {
            d->stream_receiver = ojowacam::SharedSession::acquire(
                resolved_device_id, resolved_signaling_url, auto_discover);
            if (d->stream_receiver) {
                d->stream_receiver->setAudioSource(d->source);
            }
        }
        obs_data_release(settings);
        return true;
    });
    obs_properties_add_int(props, "sample_rate", "Sample Rate", 8000, 192000, 1);
    obs_properties_add_int(props, "channels", "Channels", 1, 8, 1);

    return props;
}
