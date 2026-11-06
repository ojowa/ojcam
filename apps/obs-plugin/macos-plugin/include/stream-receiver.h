//
//  stream-receiver.h
//  Ojowacam OBS macOS Plugin
//

#import <Foundation/Foundation.h>
#import <CoreMedia/CoreMedia.h>
#import <obs-module.h>

@interface OjowacamStreamReceiver : NSObject

- (instancetype)initWithVideoSource:(obs_source_t *)videoSource audioSource:(obs_source_t *)audioSource;
- (void)connectWithDeviceId:(NSString *)deviceId signalingURL:(NSString *)signalingUrl;
- (void)disconnect;
- (BOOL)isConnected;

@end
