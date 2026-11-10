//
//  device-manager.h
//  Ojowacam OBS macOS Plugin
//

#import <Foundation/Foundation.h>

@interface OjowacamDeviceManager : NSObject

+ (instancetype)sharedManager;
- (void)initialize;
- (void)shutdown;
- (void)addDevice:(NSDictionary *)deviceInfo;
- (void)removeDeviceWithId:(NSString *)deviceId;
- (NSArray<NSDictionary *> *)discoveredDevices;

@end
