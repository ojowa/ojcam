#include "video-source.h"
#include "stream-receiver.h"
#include "frame-converter.h"
#include "device-manager.h"
#include <algorithm>

struct OjowacamVideoData {
    obs_source_t *source;
    uint32_t width;
    uint32_t height;
    ojowacam::StreamReceiver* stream_receiver = nullptr;
    ojowacam::FrameConverter* frame_converter = nullptr;
    gs_texture_t* current_texture = nullptr;
    bool connected = false;
};

obs_source_info ojowacam_video_source_info = [] {
    obs_source_info info{};
    info.id = "ojowacam_video_source";
    info.type = OBS_SOURCE_TYPE_INPUT;
    info.output_flags = OBS_SOURCE_VIDEO | OBS_SOURCE_ASYNC_VIDEO;
    info.get_name = [](void *) -> const char * { return "Ojowacam Video"; };
    info.create = ojowacam_video_create;
    info.destroy = ojowacam_video_destroy;
    info.get_width = ojowacam_video_width;
    info.get_height = ojowacam_video_height;
    info.video_render = ojowacam_video_render;
    info.update = ojowacam_video_update;
    info.get_properties = ojowacam_video_properties;
    return info;
}();

void *ojowacam_video_create(obs_data_t *settings, obs_source_t *source)
{
    auto data = new OjowacamVideoData();
    data->source = source;
    data->width = 1920;
    data->height = 1080;
    data->frame_converter = new ojowacam::FrameConverter();

    const char* device_id = obs_data_get_string(settings, "device_id");
    const char* signaling_url = obs_data_get_string(settings, "signaling_url");

    std::string resolved_device_id = device_id ? device_id : "";
    std::string resolved_signaling_url = signaling_url ? signaling_url : "";

    if (!resolved_signaling_url.empty()) {
        data->stream_receiver = new ojowacam::StreamReceiver(source, nullptr);
        data->stream_receiver->onVideoSizeChanged = [data](uint32_t w, uint32_t h) {
            data->width = w;
            data->height = h;
        };
        data->stream_receiver->connect(resolved_device_id, resolved_signaling_url);
        data->connected = data->stream_receiver->isConnected();
    }

    return data;
}

void ojowacam_video_destroy(void *data)
{
    auto *d = static_cast<OjowacamVideoData *>(data);
    if (d->stream_receiver) {
        d->stream_receiver->disconnect();
        delete d->stream_receiver;
    }
    if (d->frame_converter) {
        delete d->frame_converter;
    }
    delete d;
}

void ojowacam_video_render(void *data, gs_effect_t *effect)
{
    // Async sources (OBS_SOURCE_ASYNC_VIDEO) are drawn by libobs from the
    // frame pushed via obs_source_output_video. No custom draw required.
    UNUSED_PARAMETER(data);
    UNUSED_PARAMETER(effect);
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

    std::string resolved_device_id = device_id ? device_id : "";
    std::string resolved_signaling_url = signaling_url ? signaling_url : "";

    if (d->stream_receiver) {
        d->stream_receiver->disconnect();
        delete d->stream_receiver;
        d->stream_receiver = nullptr;
    }
    d->connected = false;

    if (!resolved_signaling_url.empty()) {
        d->stream_receiver = new ojowacam::StreamReceiver(d->source, nullptr);
        d->stream_receiver->onVideoSizeChanged = [d](uint32_t w, uint32_t h) {
            d->width = w;
            d->height = h;
        };
        if (d->stream_receiver->connect(resolved_device_id, resolved_signaling_url)) {
            d->connected = true;
        }
    }
}

obs_properties_t *ojowacam_video_properties(void *data)
{
    auto *props = obs_properties_create();
    UNUSED_PARAMETER(data);

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

    obs_properties_add_text(props, "signaling_url", "Signaling URL (ws://phone-ip:8765)", OBS_TEXT_DEFAULT);
    obs_properties_add_button(props, "connect", "Connect to Device", [](obs_properties_t*, obs_property_t*, void* data) {
        auto *d = static_cast<OjowacamVideoData*>(data);
        obs_data_t *settings = obs_source_get_settings(d->source);
        ojowacam_video_update(d, settings);
        obs_data_release(settings);
        return true;
    });

    obs_properties_add_bool(props, "connected", "Connected");

    obs_properties_add_int(props, "resolution_width", "Width", 1, 7680, 1);
    obs_properties_add_int(props, "resolution_height", "Height", 1, 4320, 1);
    obs_properties_add_int(props, "fps", "Frame Rate", 1, 60, 1);

    return props;
}