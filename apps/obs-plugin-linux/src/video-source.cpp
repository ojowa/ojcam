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
    bool connected = false;  // True while this source dials the phone
    std::string configured_device_id;
    std::string configured_signaling_url;
};

obs_source_info ojowacam_video_source_info = [] {
    obs_source_info info{};
    info.id = "ojowacam_video_source";
    info.type = OBS_SOURCE_TYPE_INPUT;
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
    return info;
}();

void *ojowacam_video_create(obs_data_t *settings, obs_source_t *source)
{
    auto data = new OjowacamVideoData();
    data->source = source;
    data->width = 1920;
    data->height = 1080;
    data->frame_converter = new ojowacam::FrameConverter();
    data->connected = false;

    const char* device_id = obs_data_get_string(settings, "device_id");
    const char* signaling_url = obs_data_get_string(settings, "signaling_url");

    data->configured_device_id = device_id ? device_id : "";
    data->configured_signaling_url = signaling_url ? signaling_url : "";

    blog(LOG_INFO, "[Ojowacam] video_create: device_id='%s' signaling_url='%s'",
         data->configured_device_id.c_str(), data->configured_signaling_url.c_str());

    // Do NOT auto-connect here. The user must click "Connect to Device" to
    // dial the phone; the phone serves its camera automatically once the
    // signaling link is up. This makes OBS the active connection party.

    return data;
}

void ojowacam_video_destroy(void *data)
{
    auto *d = static_cast<OjowacamVideoData *>(data);
    if (d->stream_receiver) {
        d->stream_receiver->disconnect();
        delete d->stream_receiver;
        d->stream_receiver = nullptr;
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

    // Migrate pre-passive scenes that stored the old "streaming" key so
    // their stored connection state survives the rename to "connected".
    if (obs_data_has_user_value(settings, "streaming") &&
        !obs_data_has_user_value(settings, "connected")) {
        obs_data_set_bool(settings, "connected",
                          obs_data_get_bool(settings, "streaming"));
    }
    obs_data_erase(settings, "streaming");
    const bool connected = obs_data_get_bool(settings, "connected");

    std::string resolved_device_id = device_id ? device_id : "";
    std::string resolved_signaling_url = signaling_url ? signaling_url : "";

    d->configured_device_id = resolved_device_id;
    d->configured_signaling_url = resolved_signaling_url;
    d->connected = connected;

    // If the source was told to disconnect, tear the receiver down
    if (!connected && d->stream_receiver) {
        d->stream_receiver->disconnect();
        delete d->stream_receiver;
        d->stream_receiver = nullptr;
    }

    // If connected and we don't have a receiver yet, start dialing
    if (connected && !d->stream_receiver && !resolved_signaling_url.empty()) {
        d->stream_receiver = new ojowacam::StreamReceiver(d->source, d->source);
        d->stream_receiver->onVideoSizeChanged = [d](uint32_t w, uint32_t h) {
            d->width = w;
            d->height = h;
        };
        (void)d->stream_receiver->connect(resolved_device_id, resolved_signaling_url);
    }
}

obs_properties_t *ojowacam_video_properties(void *data)
{
    auto *d = static_cast<OjowacamVideoData*>(data);
    auto *props = obs_properties_create();

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

    // Single action: resolve ws://ip:port for the selected device from the
    // beacon table (falling back to the manual URL above) and dial it in
    // one step. Pressing it while connected hangs up; Deactivate clears
    // the configuration.
    obs_properties_add_button(props, "connect_stream",
        d->connected ? "Disconnect" : "Connect to Device",
        [](obs_properties_t*, obs_property_t*, void* data) {
        auto *d = static_cast<OjowacamVideoData*>(data);
        obs_data_t *settings = obs_source_get_settings(d->source);

        if (obs_data_get_bool(settings, "connected")) {
            // Hang up; video_update tears the receiver down.
            obs_data_set_bool(settings, "connected", false);
        } else {
            // Prefer the beacon table for the selected device; keep the
            // manually entered URL when the device is not discovered.
            const char *device_id = obs_data_get_string(settings, "device_id");
            auto *dm = ojowacam::DeviceManager::GetInstance();
            for (const auto& dev : dm->GetDevices()) {
                if (dev.device_id == device_id) {
                    obs_data_set_string(settings, "signaling_url",
                        ("ws://" + dev.ip_address + ":" + std::to_string(dev.port)).c_str());
                    break;
                }
            }

            const char *url = obs_data_get_string(settings, "signaling_url");
            if (url && *url) {
                obs_data_set_bool(settings, "connected", true);
            } else {
                blog(LOG_WARNING, "[Ojowacam] Connect: no signaling URL for device '%s'",
                     device_id ? device_id : "");
            }
        }
        obs_source_update(d->source, settings);
        obs_data_release(settings);
        return true;
    });

    // Deactivate the current device: hang up the receiver and clear
    // the stored signaling URL / device ID.
    obs_properties_add_button(props, "deactivate", "Deactivate Device", [](obs_properties_t*, obs_property_t*, void* data) {
        auto *d = static_cast<OjowacamVideoData*>(data);
        if (d->stream_receiver) {
            d->stream_receiver->disconnect();
            delete d->stream_receiver;
            d->stream_receiver = nullptr;
        }
        d->connected = false;

        obs_data_t *settings = obs_source_get_settings(d->source);
        obs_data_set_string(settings, "signaling_url", "");
        obs_data_set_string(settings, "device_id", "");
        obs_data_set_bool(settings, "connected", false);
        obs_source_update(d->source, settings);
        obs_data_release(settings);
        return true;
    });

    obs_properties_add_int(props, "resolution_width", "Width", 1, 7680, 1);
    obs_properties_add_int(props, "resolution_height", "Height", 1, 4320, 1);
    obs_properties_add_int(props, "fps", "Frame Rate", 1, 60, 1);

    return props;
}