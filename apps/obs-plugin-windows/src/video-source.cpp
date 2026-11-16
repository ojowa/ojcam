#include "video-source.h"
#include "stream-receiver.h"
#include "shared-session.h"
#include "frame-converter.h"
#include "device-manager.h"
#include <algorithm>

struct OjowacamVideoData {
    obs_source_t *source;
    uint32_t width;
    uint32_t height;
    float sample_rate;
    int channels;
    std::shared_ptr<ojowacam::StreamReceiver> stream_receiver;
    ojowacam::FrameConverter* frame_converter = nullptr;
    gs_texture_t* current_texture = nullptr;
    bool streaming = false;  // User explicitly started streaming
    std::string configured_device_id;
    std::string configured_signaling_url;
    bool configured_auto_discover = false;
};

obs_source_info ojowacam_video_source_info = [] {
    obs_source_info info{};
    info.id = "ojowacam_video_source";
    info.type = OBS_SOURCE_TYPE_INPUT;
    // One source outputs both the camera video (WebRTC track) and the phone's
    // microphone audio (WebSocket binary frames), carried over a single
    // signaling connection.
    info.output_flags = OBS_SOURCE_VIDEO | OBS_SOURCE_AUDIO | OBS_SOURCE_ASYNC_VIDEO;
    info.get_name = [](void *) -> const char * { return "Ojowacam Camera"; };
    info.create = ojowacam_video_create;
    info.destroy = ojowacam_video_destroy;
    info.get_width = ojowacam_video_width;
    info.get_height = ojowacam_video_height;
    // Deliberately no video_render callback: this is an async source
    // (OBS_SOURCE_ASYNC_VIDEO). libobs only draws the frames pushed via
    // obs_source_output_video on the path where video_render is NULL
    // (obs_source_render_async_video). Registering a callback routes
    // rendering to obs_source_main_render instead, which calls our
    // (empty) callback and never touches the async texture — the source
    // then stays permanently black.
    info.update = ojowacam_video_update;
    info.get_properties = ojowacam_video_properties;
    info.get_defaults = [](obs_data_t *settings) {
        // Applies when the key is absent, so existing scenes gain
        // same-network auto-discovery without losing their stored URL.
        obs_data_set_default_bool(settings, "auto_discover", true);
        obs_data_set_default_bool(settings, "enabled", true);
        obs_data_set_default_bool(settings, "streaming", false);
        obs_data_set_default_double(settings, "sample_rate", 48000.0);
        obs_data_set_default_int(settings, "channels", 2);
        obs_data_set_default_string(settings, "signaling_url", "");
    };
    return info;
}();

void *ojowacam_video_create(obs_data_t *settings, obs_source_t *source)
{
    auto data = new OjowacamVideoData();
    data->source = source;
    data->width = 1920;
    data->height = 1080;
    data->sample_rate = (float)obs_data_get_double(settings, "sample_rate");
    data->channels = (int)obs_data_get_int(settings, "channels");
    data->streaming = false;
    data->frame_converter = new ojowacam::FrameConverter();

    const char* device_id = obs_data_get_string(settings, "device_id");
    const char* signaling_url = obs_data_get_string(settings, "signaling_url");
    const bool auto_discover = obs_data_get_bool(settings, "auto_discover");

    data->configured_device_id = device_id ? device_id : "";
    data->configured_signaling_url = signaling_url ? signaling_url : "";
    data->configured_auto_discover = auto_discover;

    blog(LOG_INFO, "[Ojowacam] video_create: device_id='%s' signaling_url='%s' auto_discover=%d",
         data->configured_device_id.c_str(), data->configured_signaling_url.c_str(),
         data->configured_auto_discover ? 1 : 0);

    // Do NOT auto-connect here. The user must click "Start Streaming"
    // to begin. This makes OBS the active connection party.

    return data;
}

void ojowacam_video_destroy(void *data)
{
    auto *d = static_cast<OjowacamVideoData *>(data);
    if (d->stream_receiver) {
        d->stream_receiver->setVideoSource(nullptr);
        d->stream_receiver->setAudioSource(nullptr);
        d->stream_receiver->onVideoSizeChanged = nullptr;
        d->stream_receiver->disconnect();
        d->stream_receiver.reset();
    }
    if (d->frame_converter) {
        delete d->frame_converter;
    }
    delete d;
}

uint32_t ojowacam_video_width(void *data)
{
    auto *d = static_cast<OjowacamVideoData *>(data);
    return d->width;
}

uint32_t ojowacam_video_height(void *data)
{
    auto *d = static_cast<OjowacamVideoData *>(data);
    return d->height;
}

void ojowacam_video_update(void *data, obs_data_t *settings)
{
    auto *d = static_cast<OjowacamVideoData *>(data);

    const char* device_id = obs_data_get_string(settings, "device_id");
    const char* signaling_url = obs_data_get_string(settings, "signaling_url");
    const bool auto_discover = obs_data_get_bool(settings, "auto_discover");

    std::string resolved_device_id = device_id ? device_id : "";
    std::string resolved_signaling_url = signaling_url ? signaling_url : "";
    blog(LOG_INFO, "[Ojowacam] video_update: device_id='%s' signaling_url='%s' auto_discover=%d",
         resolved_device_id.c_str(), resolved_signaling_url.c_str(), auto_discover ? 1 : 0);

    // Update stored configuration
    d->configured_device_id = resolved_device_id;
    d->configured_signaling_url = resolved_signaling_url;
    d->configured_auto_discover = auto_discover;
    d->streaming = obs_data_get_bool(settings, "streaming");

    // If streaming was turned off, disconnect
    if (!d->streaming && d->stream_receiver) {
        d->stream_receiver->setVideoSource(nullptr);
        d->stream_receiver->setAudioSource(nullptr);
        d->stream_receiver->onVideoSizeChanged = nullptr;
        d->stream_receiver->disconnect();
        d->stream_receiver.reset();
    }

    // If streaming is on and we don't have a receiver yet, start connecting
    if (d->streaming && !d->stream_receiver &&
        (!resolved_signaling_url.empty() || d->configured_auto_discover)) {
        d->stream_receiver = ojowacam::SharedSession::acquire(
            resolved_device_id, resolved_signaling_url, d->configured_auto_discover);
        if (d->stream_receiver) {
            d->stream_receiver->setVideoSource(d->source);
            d->stream_receiver->setAudioSource(d->source);
            d->stream_receiver->onVideoSizeChanged = [d](uint32_t w, uint32_t h) {
                d->width = w;
                d->height = h;
            };
        }
    }
}

obs_properties_t *ojowacam_video_properties(void *data)
{
    auto *d = static_cast<OjowacamVideoData*>(data);
    auto *props = obs_properties_create();

    // Read-only version indication for the loaded DLL. OJOWACAM_VERSION is
    // baked in from CMake's project(VERSION ...) at build time, and with no
    // settings value stored OBS renders this as a plain non-editable label.
    obs_properties_add_text(props, "plugin_version",
                            "Ojowacam OBS Plugin v" OJOWACAM_VERSION,
                            OBS_TEXT_INFO);

    obs_property_t *device_list = obs_properties_add_list(
        props, "device_id", "Device", OBS_COMBO_TYPE_LIST, OBS_COMBO_FORMAT_STRING);

    auto *dm = ojowacam::DeviceManager::GetInstance();
    auto devices = dm->GetDevices();
    if (devices.empty()) {
        obs_property_list_add_string(device_list, "No devices found", "");
    } else {
        for (const auto& dev : devices) {
            std::string label = dev.device_name + " (" + dev.ip_address + ")";
            obs_property_list_add_string(device_list, label.c_str(), dev.device_id.c_str());
        }
    }

    obs_properties_add_button(props, "refresh_devices", "Refresh Devices",
        [](obs_properties_t*, obs_property_t*, void*) {
            auto *dm = ojowacam::DeviceManager::GetInstance();
            (void)dm;
            return true;
        });

    // Connect to the selected discovered device: build ws://ip:port from the
    // device manager's beacon table (no manual URL entry needed).
    obs_properties_add_button(props, "connect", "Connect to Device", [](obs_properties_t*, obs_property_t*, void* data) {
        auto *d = static_cast<OjowacamVideoData*>(data);
        obs_data_t *settings = obs_source_get_settings(d->source);
        const char *device_id = obs_data_get_string(settings, "device_id");

        std::string signaling_url;
        auto *dm = ojowacam::DeviceManager::GetInstance();
        auto devices = dm->GetDevices();
        for (const auto& dev : devices) {
            if (dev.device_id == device_id) {
                signaling_url = "ws://" + dev.ip_address + ":" + std::to_string(dev.port);
                break;
            }
        }
        obs_data_set_string(settings, "signaling_url", signaling_url.c_str());
        obs_source_update(d->source, settings);
        obs_data_release(settings);
        return true;
    });

    // Deactivate the current device: stop the stream receiver and clear
    // the stored signaling URL / device ID.
    obs_properties_add_button(props, "deactivate", "Deactivate Device", [](obs_properties_t*, obs_property_t*, void* data) {
        auto *d = static_cast<OjowacamVideoData*>(data);
        if (d->stream_receiver) {
            d->stream_receiver->setVideoSource(nullptr);
            d->stream_receiver->setAudioSource(nullptr);
            d->stream_receiver->onVideoSizeChanged = nullptr;
            d->stream_receiver->disconnect();
            d->stream_receiver.reset();
        }
        d->streaming = false;

        obs_data_t *settings = obs_source_get_settings(d->source);
        obs_data_set_string(settings, "signaling_url", "");
        obs_data_set_string(settings, "device_id", "");
        obs_data_set_bool(settings, "streaming", false);
        obs_source_update(d->source, settings);
        obs_data_release(settings);
        return true;
    });

    // Start/Stop streaming: OBS actively initiates the connection to the phone.
    obs_properties_add_button(props, "stream_toggle", d->streaming ? "Stop Streaming" : "Start Streaming", [](obs_properties_t*, obs_property_t*, void* data) {
        auto *d = static_cast<OjowacamVideoData*>(data);
        obs_data_t *settings = obs_source_get_settings(d->source);
        bool current = obs_data_get_bool(settings, "streaming");
        obs_data_set_bool(settings, "streaming", !current);
        obs_source_update(d->source, settings);
        obs_data_release(settings);
        return true;
    });

    obs_properties_add_bool(props, "streaming", "Streaming Active");
    obs_properties_add_float(props, "sample_rate", "Sample Rate (Hz)", 8000.0f, 192000.0f, 1.0f);
    obs_properties_add_int(props, "channels", "Channels", 1, 8, 1);
    obs_properties_add_int(props, "resolution_width", "Width", 1, 7680, 1);
    obs_properties_add_int(props, "resolution_height", "Height", 1, 4320, 1);
    obs_properties_add_int(props, "fps", "Frame Rate", 1, 60, 1);

    return props;
}
