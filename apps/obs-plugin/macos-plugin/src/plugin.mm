//
//  plugin.mm
//  Ojowacam OBS macOS Plugin
//

#import "plugin.h"
#import "camera-source.h"
#import "audio-source.h"
#import "device-manager.h"

NSString *const kOjowacamModuleName = @"Ojowacam OBS Plugin";

BOOL obs_module_load(void) {
    // Register Ojowacam video source (CoreMediaIO virtual camera)
    obs_register_source(&ojowacam_camera_source_info);
    
    // Register Ojowacam audio source
    obs_register_source(&ojowacam_audio_source_info);
    
    // Initialize device manager
    [OjowacamDeviceManager sharedManager];
    
    return TRUE;
}

void obs_module_unload(void) {
    [[OjowacamDeviceManager sharedManager] shutdown];
}

const char *obs_module_name(void) {
    return "Ojowacam OBS Plugin";
}
