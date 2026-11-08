//
//  OjowacamModuleRegistry.m
//  Ojowacam
//

#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

// Forward declarations for Swift modules
@class OjowacamCameraModule;
@class OjowacamAudioModule;
@class OjowacamEncoderModule;
@class OjowacamWebRTCModule;

@implementation RCTBridgeModule (Ojowacam)

+ (NSArray<NSString *> *)exportedModules
{
    return @[@"OjowacamCamera", @"OjowacamAudio", @"OjowacamEncoder", @"OjowacamWebRTC"];
}

@end
