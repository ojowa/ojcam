#include "video-source.h"
#include "stream-receiver.h"
#include "frame-converter.h"

struct OjowacamVideoData {
    obs_source_t *source;
    uint32_t width;
    uint32_t height;
    ojowacam::StreamReceiver* stream_receiver = nullptr;
    ojowacam::FrameConverter* frame_converter = nullptr;
    gs_texture_t* current_texture = nullptr;
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
    info.get_default_size = ojowacam_video_get_default_size;
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

    // Read settings
    const char* device_id = obs_data_get_string(settings, "device_id");
    const char* signaling_url = obs_data_get_string(settings, "signaling_url");
    
    if (device_id && *device_id && signaling_url && *signaling_url) {
        data->stream_receiver = new ojowacam::StreamReceiver(source, nullptr);
        data->stream_receiver->connect(device_id, signaling_url);
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
    auto *d = static_cast<OjowacamVideoData *>(data);

    if (!d->current_texture) return;

    gs_eparam_t *image = gs_effect_get_param_by_name(effect, "image");
    if (!image) return;

    gs_effect_set_texture(image, d->current_texture);
    gs_draw_sprite(d->current_texture, 0, d->width, d->height);
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

bool ojowacam_video_get_default_size(obs_data_t *settings, uint32_t *cx, uint32_t *cy)
{
    UNUSED_PARAMETER(settings);
    *cx = 1920;
    *cy = 1080;
    return true;
}

void ojowacam_video_update(void *data, obs_data_t *settings)
{
    auto *d = static_cast<OjowacamVideoData *>(data);
    
    const char* device_id = obs_data_get_string(settings, "device_id");
    const char* signaling_url = obs_data_get_string(settings, "signaling_url");

    if (d->stream_receiver) {
        d->stream_receiver->disconnect();
    }
    
    if (device_id && *device_id && signaling_url && *signaling_url) {
        if (!d->stream_receiver) {
            d->stream_receiver = new ojowacam::StreamReceiver(d->source, nullptr);
        }
        d->stream_receiver->connect(device_id, signaling_url);
    }
}

obs_properties_t *ojowacam_video_properties(void *data)
{
    auto *props = obs_properties_create();
    UNUSED_PARAMETER(data);

    obs_properties_add_text(props, "device_id", "Device ID", OBS_TEXT_DEFAULT);
    obs_properties_add_text(props, "signaling_url", "Signaling URL (ws://)", OBS_TEXT_DEFAULT);
    obs_properties_add_button(props, "connect", "Connect to Device", [](obs_properties_t*, obs_property_t*, void* data) {
        auto *d = static_cast<OjowacamVideoData*>(data);
        obs_data_t *settings = obs_source_get_settings(d->source);
        ojowacam_video_update(d, settings);
        obs_data_release(settings);
        return true;
    });
    obs_properties_add_int(props, "resolution_width", "Width", 1, 7680, 1);
    obs_properties_add_int(props, "resolution_height", "Height", 1, 4320, 1);
    obs_properties_add_int(props, "fps", "Frame Rate", 1, 60, 1);

    return props;
}
