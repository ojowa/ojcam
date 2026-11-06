//
//  OjowacamPackage.m
//

#import <React/RCTBridgeModule.h>
#import <React/RCTViewManager.h>

@interface RCT_EXTERN_MODULE(OjowacamCamera, NSObject)
RCT_EXTERN_METHOD(getAvailableCameras: (RCTPromiseResolveBlock)rejecter: (RCTPromiseRejectBlock))
RCT_EXTERN_METHOD(startCapture:(NSString *)cameraId width:(NSNumber *)width height:(NSNumber *)height fps:(NSNumber *)fps resolver:(RCTPromiseResolveBlock)rejecter:(RCTPromiseRejectBlock))
RCT_EXTERN_METHOD(stopCapture:(RCTPromiseResolveBlock)rejecter:(RCTPromiseRejectBlock))
RCT_EXTERN_METHOD(switchCamera:(RCTPromiseResolveBlock)rejecter:(RCTPromiseRejectBlock))
RCT_EXTERN_METHOD(setTorch:(BOOL)enabled resolver:(RCTPromiseResolveBlock)rejecter:(RCTPromiseRejectBlock))
RCT_EXTERN_METHOD(setZoom:(float)zoomLevel resolver:(RCTPromiseResolveBlock)rejecter:(RCTPromiseRejectBlock))
RCT_EXTERN_METHOD(setFocusMode:(NSString *)mode resolver:(RCTPromiseResolveBlock)rejecter:(RCTPromiseRejectBlock))
@end

@interface RCT_EXTERN_MODULE(OjowacamAudio, NSObject)
RCT_EXTERN_METHOD(startRecording:(RCTPromiseResolveBlock)rejecter:(RCTPromiseRejectBlock))
RCT_EXTERN_METHOD(stopRecording:(RCTPromiseResolveBlock)rejecter:(RCTPromiseRejectBlock))
RCT_EXTERN_METHOD(getAudioLevels:(RCTPromiseResolveBlock)rejecter:(RCTPromiseRejectBlock))
@end

@interface RCT_EXTERN_MODULE(OjowacamWebRTC, NSObject)
RCT_EXTERN_METHOD(initWebRTC:(RCTPromiseResolveBlock)rejecter:(RCTPromiseRejectBlock))
RCT_EXTERN_METHOD(createPeerConnection:(NSString *)iceServers resolver:(RCTPromiseResolveBlock)rejecter:(RCTPromiseRejectBlock))
RCT_EXTERN_METHOD(createOffer:(RCTPromiseResolveBlock)rejecter:(RCTPromiseRejectBlock))
RCT_EXTERN_METHOD(setRemoteDescription:(NSString *)type sdp:(NSString *)sdp resolver:(RCTPromiseResolveBlock)rejecter:(RCTPromiseRejectBlock))
RCT_EXTERN_METHOD(addIceCandidate:(NSString *)candidate resolver:(RCTPromiseResolveBlock)rejecter:(RCTPromiseRejectBlock))
RCT_EXTERN_METHOD(addVideoTrack:(NSDictionary *)track resolver:(RCTPromiseResolveBlock)rejecter:(RCTPromiseRejectBlock))
RCT_EXTERN_METHOD(addAudioTrack:(NSDictionary *)track resolver:(RCTPromiseResolveBlock)rejecter:(RCTPromiseRejectBlock))
RCT_EXTERN_METHOD(closeConnection:(RCTPromiseResolveBlock)rejecter:(RCTPromiseRejectBlock))
@end
