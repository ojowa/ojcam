#pragma once

#include <obs-module.h>

#ifdef __cplusplus
extern "C" {
#endif

// Module entry points required by OBS
// (obs_module_ver is provided by OBS_DECLARE_MODULE in the .cpp)
bool obs_module_load(void);
void obs_module_unload(void);
const char *obs_module_name(void);

#ifdef __cplusplus
}
#endif
