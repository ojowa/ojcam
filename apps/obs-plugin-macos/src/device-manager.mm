//
//  device-manager.mm
//  Ojowacam OBS macOS Plugin
//

#import "device-manager.h"

@implementation OjowacamDeviceManager {
    NSMutableArray<NSDictionary *> *_devices;
    dispatch_queue_t _queue;
}

+ (instancetype)sharedManager {
    static OjowacamDeviceManager *sharedInstance = nil;
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        sharedInstance = [[self alloc] init];
    });
    return sharedInstance;
}

- (instancetype)init {
    self = [super init];
    if (self) {
        _devices = [NSMutableArray array];
        _queue = dispatch_queue_create("com.ojowacam.device-manager", DISPATCH_QUEUE_SERIAL);
    }
    return self;
}

- (void)initialize {
    // Start mDNS discovery for Ojowacam mobile devices
    // Using NetServiceBrowser on macOS
}

- (void)shutdown {
    dispatch_sync(_queue, ^{
        [_devices removeAllObjects];
    });
}

- (void)addDevice:(NSDictionary *)deviceInfo {
    dispatch_async(_queue, ^{
        [_devices addObject:deviceInfo];
    });
}

- (void)removeDeviceWithId:(NSString *)deviceId {
    dispatch_async(_queue, ^{
        [_devices removeObjectsWhere:^BOOL(NSDictionary *device, NSUInteger idx) {
            return [device[@"deviceId"] isEqualToString:deviceId];
        }];
    });
}

- (NSArray<NSDictionary *> *)discoveredDevices {
    __block NSArray<NSDictionary *> *result;
    dispatch_sync(_queue, ^{
        result = [_devices copy];
    });
    return result;
}

@end
