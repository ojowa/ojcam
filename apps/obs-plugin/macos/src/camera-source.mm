//
//  camera-source.mm
//  Ojowacam OBS macOS Plugin
//

#import "camera-source.h"
#import "stream-receiver.h"

@interface OjowacamCameraData : NSObject
@property (nonatomic) obs_source_t *source;
@property (nonatomic) uint32_t width;
@property (nonatomic) uint32_t height;
@property (nonatomic) OjowacamStreamReceiver *streamReceiver;
@property (nonatomic) CVPixelBufferRef currentFrame;
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

void *ojowacam_camera_create(obs_data_t *settings, obs_source_t *source) {
    auto *data = new OjowacamCameraData();
    data->source = source;
    data->width = 1920;
    data->height = 1080;
    data->currentFrame = nullptr;
    
    // Read settings
    const char *deviceId = obs_data_get_string(settings, "device_id");
    const char *signalingUrl = obs_data_get_string(settings, "signaling_url");
    
    if (deviceId && signalingUrl) {
        data->streamReceiver = [[OjowacamStreamReceiver alloc] initWithVideoSource:source audioSource:nil];
        [data->streamReceiver connectWithDeviceId:@(deviceId) signalingURL:@(signalingUrl)];
    }
    
    return data;
}

void ojowacam_camera_destroy(void *data) {
    auto *d = static_cast<OjowacamCameraData *>(data);
    if (d->streamReceiver) {
        [d->streamReceiver disconnect];
    }
    if (d->currentFrame) {
        CVPixelBufferRelease(d->currentFrame);
    }
    delete d;
}

void ojowacam_camera_render(void *data, gs_effect_t *effect) {
    auto *d = static_cast<OjowacamCameraData *>(data);
    
    if (!d->currentFrame) return;
    
    // Convert CVPixelBuffer to OBS texture
    // This is a simplified version - in production use CoreVideo to create texture
    UNUSED_PARAMETER(effect);
}

uint32_t ojowacam_camera_width(void *data) {
    auto *d = static_cast<OjowacamCameraData *>(data);
    return d->width;
}

uint32_t ojowacam_camera_height(void *data) {
    auto *d = static_cast<OjowacamCameraData *>(data);
    return d->height;
}

bool ojowacam_camera_get_default_size(obs_data_t *settings, uint32_t *cx, uint32_t *cy) {
    *cx = 1920;
    *cy = 1080;
    return true;
}

void ojowacam_camera_update(void *data, obs_data_t *settings) {
    auto *d = static_cast<OjowacamCameraData *>(data);
    
    const char *deviceId = obs_data_get_string(settings, "device_id");
    const char *signalingUrl = obs_data_get_string(settings, "signaling_url");
    
    if (deviceId && signalingUrl) {
        if (!d->streamReceiver) {
            d->streamReceiver = [[OjowacamStreamReceiver alloc] initWithVideoSource:d->source audioSource:nil];
        }
        [d->streamReceiver connectWithDeviceId:@(deviceId) signalingURL:@(signalingUrl)];
    }
}

obs_properties_t *ojowacam_camera_properties(void *data) {
    auto *props = obs_properties_create();
    
    obs_properties_add_text(props, "device_id", "Device ID", OBS_TEXT_DEFAULT);
    obs_properties_add_text(props, "signaling_url", "Signaling URL (ws://)", OBS_TEXT_DEFAULT);
    obs_properties_add_button(props, "connect", "Connect to Device", ^(obs_properties_t *p, obs_property_t *prop, void *d) {
        // Reconnect with current settings
        return true;
    });
    
    return props;
}
