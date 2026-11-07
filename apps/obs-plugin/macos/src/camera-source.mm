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
@property (nonatomic) NSString *pairingCode;
@property (nonatomic) BOOL connected;
@end

// Source info for OBS
obs_source_info ojowacam_camera_source_info = {
    .id = "ojowacam_camera_source",
    .type = OBS_SOURCE_TYPE_INPUT,
    .flags = OBS_SOURCE_ASYNC_VIDEO,
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

    const char *deviceId = obs_data_get_string(settings, "device_id");
    const char *signalingUrl = obs_data_get_string(settings, "signaling_url");
    const char *pairingCode = obs_data_get_string(settings, "pairing_code");

    std::string resolvedDeviceId = deviceId ? deviceId : "";
    std::string resolvedSignalingUrl = signalingUrl ? signalingUrl : "";
    if (pairingCode && *pairingCode) {
        resolvedDeviceId = pairingCode;
        if (resolvedSignalingUrl.empty()) {
            resolvedSignalingUrl = "ws://localhost:8765";
        }
    }


void ojowacam_camera_destroy(void *data)
{
    auto *d = static_cast<OjowacamCameraData *>(data);
    if (d->streamReceiver) {
        [d->streamReceiver disconnect];
    }
    if (d->currentFrame) {
        CVPixelBufferRelease(d->currentFrame);
    }
    delete d;
}

void ojowacam_camera_render(void *data, gs_effect_t *effect)
{
    auto *d = static_cast<OjowacamCameraData *>(data);

    if (!d->currentFrame) return;

    // Push the current frame to OBS video output
    // In production, convert CVPixelBuffer to RGBA and use obs_source_output_video
    UNUSED_PARAMETER(effect);
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
}

bool ojowacam_camera_get_default_size(obs_data_t *settings, uint32_t *cx, uint32_t *cy)
{
    *cx = 1920;
    *cy = 1080;
    return true;
}
    if (!resolvedDeviceId.empty() && !resolvedSignalingUrl.empty()) {
        data->streamReceiver = [[OjowacamStreamReceiver alloc] initWithVideoSource:source audioSource:nil];
        [data->streamReceiver connectWithDeviceId:@(resolvedDeviceId.c_str()) signalingURL:@(resolvedSignalingUrl.c_str())];
        data->connected = data->streamReceiver.isConnected;
    }

    return data;
}

void ojowacam_camera_update(void *data, obs_data_t *settings)
{
    auto *d = static_cast<OjowacamCameraData *>(data);

    const char *deviceId = obs_data_get_string(settings, "device_id");
    const char *signalingUrl = obs_data_get_string(settings, "signaling_url");
    const char *pairingCode = obs_data_get_string(settings, "pairing_code");

    std::string resolvedDeviceId = deviceId ? deviceId : "";
    std::string resolvedSignalingUrl = signalingUrl ? signalingUrl : "";
    if (pairingCode && *pairingCode) {
        resolvedDeviceId = pairingCode;
        if (resolvedSignalingUrl.empty()) {
            resolvedSignalingUrl = "ws://localhost:8765";
        }
    }

    if (d->streamReceiver) {
        [d->streamReceiver disconnect];
    }

    if (!resolvedDeviceId.empty() && !resolvedSignalingUrl.empty()) {
        d->streamReceiver = [[OjowacamStreamReceiver alloc] initWithVideoSource:d->source audioSource:nil];
        [d->streamReceiver connectWithDeviceId:@(resolvedDeviceId.c_str()) signalingURL:@(resolvedSignalingUrl.c_str())];
        d->connected = d->streamReceiver.isConnected;
    } else {
        d->connected = NO;
    }
}

obs_properties_t *ojowacam_camera_properties(void *data)
{
    auto *props = obs_properties_create();

    obs_properties_add_text(props, "pairing_code", "Pairing Code (QR/manual)", OBS_TEXT_DEFAULT);

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

    obs_properties_add_bool(props, "connected", "Connected");

    return props;
}