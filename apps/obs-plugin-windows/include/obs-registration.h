#pragma once

#include <obs-module.h>

#ifdef __cplusplus
extern "C" {
#endif

// Module entry point required by OBS
bool obs_module_load(void);
void obs_module_unload(void);
const char *obs_module_name(void);
const char *obs_module_ver(void);

#ifdef __cplusplus
}
#endif
