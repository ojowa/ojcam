//
//  OjowacamBridge.m
//

#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

// Forward declarations for Swift modules
@class OjowacamCameraModule;
@class OjowacamAudioModule;
@class OjowacamWebRTCModule;

@implementation RCTBridgeModule (Ojowacam)

+ (NSArray<NSString *> *)exportedModules
{
    return @[@"OjowacamCamera", @"OjowacamAudio", @"OjowacamWebRTC"];
}

@end
