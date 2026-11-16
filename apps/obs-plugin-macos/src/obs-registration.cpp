#include "camera-source.h"
#include "device-manager.h"

OBS_DECLARE_MODULE()

// Module information
const char *obs_module_name(void)
{
    return "Ojowacam OBS Plugin";
}

const char *obs_module_description(void)
{
    return "Turn your smartphone into a webcam and microphone for OBS Studio "
           "(v" OJOWACAM_VERSION ")";
}

bool obs_module_load(void)
{
    // First log line on startup: which plugin build OBS just loaded.
    blog(LOG_INFO, "[Ojowacam] OBS plugin v%s loading", OJOWACAM_VERSION);

    // Register Ojowacam video source (also outputs audio from the phone's
    // microphone over the same signaling connection).
    obs_register_source(&ojowacam_camera_source_info);

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
