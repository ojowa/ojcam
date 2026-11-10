#include "obs-registration.h"
#include "video-source.h"
#include "audio-source.h"
#include "device-manager.h"

OBS_DECLARE_MODULE()

// Module information
const char *obs_module_name(void)
{
    return "Ojowacam OBS Plugin";
}

const char *obs_module_ver(void)
{
    return "1.0.0";
}

bool obs_module_load(void)
{
    // Register Ojowacam video source
    obs_register_source(&ojowacam_video_source_info);

    // Register Ojowacam audio source
    obs_register_source(&ojowacam_audio_source_info);

    // Initialize device manager
    DeviceManager::GetInstance()->Initialize();

    return true;
}

void obs_module_unload(void)
{
    // Cleanup device manager
    DeviceManager::GetInstance()->Shutdown();
}
