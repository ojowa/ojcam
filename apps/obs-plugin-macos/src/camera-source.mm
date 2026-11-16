//
//  camera-source.mm
//  Ojowacam OBS macOS Plugin
//

#import "camera-source.h"
#import "stream-receiver.h"
#import "device-manager.h"
#include <string>

@interface OjowacamCameraData : NSObject
@property (nonatomic) obs_source_t *source;
@property (nonatomic) uint32_t width;
@property (nonatomic) uint32_t height;
@property (nonatomic) OjowacamStreamReceiver *streamReceiver;
@property (nonatomic) CVPixelBufferRef currentFrame;
@property (nonatomic) BOOL connected;
@property (nonatomic) BOOL streaming;
@end

// Source info for OBS
obs_source_info ojowacam_camera_source_info = {
    .id = "ojowacam_camera_source",
    .type = OBS_SOURCE_TYPE_INPUT,
    .flags = OBS_SOURCE_VIDEO | OBS_SOURCE_AUDIO | OBS_SOURCE_ASYNC_VIDEO,
    .get_name = ^(void *data) {
        return "Ojowacam Camera";
    },
    .create = ojowacam_camera_create,
    .destroy = ojowacam_camera_destroy,
    .render = ojowacam_camera_render,
    .get_width = ojowacam_camera_width,
    .get_height = ojowacam_camera_height,
    .get_default_size = ojowacam_camera_get_default_size,
    .update = ojowacam_camera_update,
    .get_properties = ojowacam_camera_properties,
};

void *ojowacam_camera_create(obs_data_t *settings, obs_source_t *source)
{
    auto *data = new OjowacamCameraData();
    data->source = source;
    data->width = 1920;
    data->height = 1080;
    data->currentFrame = nullptr;
    data->connected = NO;
    data->streaming = NO;

    const char *deviceId = obs_data_get_string(settings, "device_id");
    const char *signalingUrl = obs_data_get_string(settings, "signaling_url");

    std::string resolvedDeviceId = deviceId ? deviceId : "";
    std::string resolvedSignalingUrl = signalingUrl ? signalingUrl : "";

    // Do NOT auto-connect here. The user must click "Start Streaming"
    // to begin. This makes OBS the active connection party.

    return data;
}
void ojowacam_camera_destroy(void *data)
{
    auto *d = static_cast<OjowacamCameraData *>(data);
    if (d->streamReceiver) {
        [d->streamReceiver disconnect];
    }
    if (d->currentFrame) {
        CVPixelBufferRelease(d->currentFrame);
        d->currentFrame = nullptr;
    }
    delete d;
}

void ojowacam_camera_render(void *data, gs_effect_t *effect)
{
    auto *d = static_cast<OjowacamCameraData *>(data);

    gs_eparam_t *image = gs_effect_get_param_by_name(effect, "image");
    if (!image) return;

    gs_texture_t *tex = gs_effect_get_texture(image);
    if (!tex) return;

    gs_effect_set_texture(image, tex);
    gs_draw_sprite(tex, 0, d->width, d->height);
}

uint32_t ojowacam_camera_width(void *data)
{
    auto *d = static_cast<OjowacamCameraData *>(data);
    return d->width;
}

uint32_t ojowacam_camera_height(void *data)
{
    auto *d = static_cast<OjowacamCameraData *>(data);
    return d->height;

void ojowacam_camera_update(void *data, obs_data_t *settings)
{
    auto *d = static_cast<OjowacamCameraData *>(data);

    const char *deviceId = obs_data_get_string(settings, "device_id");
    const char *signalingUrl = obs_data_get_string(settings, "signaling_url");
    const bool streaming = obs_data_get_bool(settings, "streaming");

    std::string resolvedDeviceId = deviceId ? deviceId : "";
    std::string resolvedSignalingUrl = signalingUrl ? signalingUrl : "";

    // If streaming was turned off, disconnect
    if (!streaming && d->streamReceiver) {
        [d->streamReceiver disconnect];
        d->streamReceiver = nil;
        d->connected = NO;
    }

    d->streaming = streaming;

    // If streaming is on and we don't have a receiver yet, start connecting
    if (streaming && !d->streamReceiver && !resolvedSignalingUrl.empty()) {
        d->streamReceiver = [[OjowacamStreamReceiver alloc] initWithVideoSource:d->source audioSource:d->source];
        [d->streamReceiver connectWithDeviceId:@(resolvedDeviceId.c_str()) signalingURL:@(resolvedSignalingUrl.c_str())];
        d->connected = d->streamReceiver.isConnected;
    } else if (!streaming) {
        d->connected = NO;
    }
}

obs_properties_t *ojowacam_camera_properties(void *data)
{
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
        ^(obs_properties_t *p, obs_property_t *prop, void *d) {
            auto *mgr = ojowacam::DeviceManager::GetInstance();
            (void)mgr; (void)p; (void)prop; (void)d;
            return true;
        });

    obs_properties_add_text(props, "signaling_url", "Signaling URL (ws://)", OBS_TEXT_DEFAULT);
    obs_properties_add_button(props, "connect", "Connect to Device",
        ^(obs_properties_t *p, obs_property_t *prop, void *d) {
            auto *data = static_cast<OjowacamCameraData*>(d);
            obs_data_t *settings = obs_source_get_settings(data->source);
            ojowacam_camera_update(data, settings);
            obs_data_release(settings);
            return true;
        });

    // Deactivate the current device: stop the stream receiver and clear
    // the stored signaling URL / device ID.
    obs_properties_add_button(props, "deactivate", "Deactivate Device",
        ^(obs_properties_t *p, obs_property_t *prop, void *d) {
            auto *data = static_cast<OjowacamCameraData*>(d);
            if (data->streamReceiver) {
                [data->streamReceiver disconnect];
                data->streamReceiver = nil;
            }
            data->connected = NO;

            obs_data_t *settings = obs_source_get_settings(data->source);
            obs_data_set_string(settings, "signaling_url", "");
            obs_data_set_string(settings, "device_id", "");
            obs_source_update(data->source, settings);
            obs_data_release(settings);
            return true;
        });

    // Start/Stop streaming: OBS actively initiates the connection to the phone.
    obs_properties_add_button(props, "stream_toggle", data->streaming ? "Stop Streaming" : "Start Streaming", ^(obs_properties_t *p, obs_property_t *prop, void *d) {
        auto *data = static_cast<OjowacamCameraData*>(d);
        obs_data_t *settings = obs_source_get_settings(data->source);
        bool current = obs_data_get_bool(settings, "streaming");
        obs_data_set_bool(settings, "streaming", !current);
        obs_source_update(data->source, settings);
        obs_data_release(settings);
        return true;
    });

    obs_properties_add_bool(props, "connected", "Connected");
    obs_properties_add_bool(props, "streaming", "Streaming Active");

    return props;
}
}

bool ojowacam_camera_get_default_size(obs_data_t *settings, uint32_t *cx, uint32_t *cy)
{
    *cx = 1920;
    *cy = 1080;
    return true;
}