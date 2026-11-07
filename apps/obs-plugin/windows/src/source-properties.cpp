#include "video-source.h"

obs_properties_t *ojowacam_source_properties(void *data)
{
    auto *props = obs_properties_create();
    UNUSED_PARAMETER(data);

    obs_properties_add_text(props, "device_id", "Device ID", OBS_TEXT_DEFAULT);
    obs_properties_add_button(props, "refresh", "Refresh Devices", [](obs_properties_t *, obs_property_t *, void *) {
        // TODO: Refresh device list
        return true;
    });

    return props;
}
