//
//  plugin.h
//  Ojowacam OBS macOS Plugin
//

#import <obs-module.h>

#ifdef __cplusplus
extern "C" {
#endif

BOOL obs_module_load(void);
void obs_module_unload(void);
const char *obs_module_name(void);

#ifdef __cplusplus
}
#endif
