#include "obs-registration.h"
#include "video-source.h"
#include "device-manager.h"

OBS_DECLARE_MODULE()

// Module information
const char *obs_module_name(void)
{
    return "Ojowacam OBS Plugin";
}

bool obs_module_load(void)
{
    // Register Ojowacam video source (also outputs audio from the phone's
    // microphone over the same signaling connection).
    obs_register_source(&ojowacam_video_source_info);

    // Initialize device manager and start same-network discovery (UDP
    // beacons + mDNS where available) so sources can auto-connect.
    ojowacam::DeviceManager::GetInstance()->Initialize();
    ojowacam::DeviceManager::GetInstance()->StartDiscovery();

    return true;
}

void obs_module_unload(void)
{
    // Cleanup device manager
    ojowacam::DeviceManager::GetInstance()->Shutdown();
}
