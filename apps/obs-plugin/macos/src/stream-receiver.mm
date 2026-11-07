//
//  stream-receiver.mm
//  Ojowacam OBS macOS Plugin
//

#import "stream-receiver.h"
#import <WebRTC/WebRTC.h>

@interface OjowacamStreamReceiver () {
    PeerConnectionFactory *_factory;
    RTCPeerConnection *_peerConnection;
    RTCVideoTrack *_videoTrack;
    RTCAudioTrack *_audioTrack;
    
    obs_source_t *_videoSource;
    obs_source_t *_audioSource;
    
    BOOL _connected;
}

@end

@implementation OjowacamStreamReceiver

- (instancetype)initWithVideoSource:(obs_source_t *)videoSource audioSource:(obs_source_t *)audioSource {
    self = [super init];
    if (self) {
        _videoSource = videoSource;
        _audioSource = audioSource;
        _connected = NO;
    }
    return self;
}

- (void)connectWithDeviceId:(NSString *)deviceId signalingURL:(NSString *)signalingUrl {
    if (!_factory) {
        [PeerConnectionFactory initializeEncoderFactory:[[DefaultVideoEncoderFactory alloc] init]
                                            decoderFactory:[[DefaultVideoDecoderFactory alloc] init]];
        _factory = [[PeerConnectionFactory alloc] initWithOptions:[[PeerConnectionFactory.Options alloc] init]];
    }
    
    RTCConfiguration *config = [[RTCConfiguration alloc] init];
    config.iceServers = @[[[RTCIceServer alloc] initWithURLStrings:@[@"stun:stun.l.google.com:19302"]]];
    
    RTCMediaConstraints *constraints = [[RTCMediaConstraints alloc] initWithMandatoryConstraints:@{
        @"OfferToReceiveAudio": @"true",
        @"OfferToReceiveVideo": @"false"
    } optionalConstraints:nil];
    
    _peerConnection = [_factory peerConnectionWithConfiguration:config
                                                  constraints:constraints
                                                    delegate:self];
    
    // Create offer
    [_peerConnection offerForConstraints:constraints completionHandler:^(RTCSessionDescription *sdp, NSError *error) {
        if (error) {
            NSLog(@"Ojowacam: Offer error: %@", error.localizedDescription);
            return;
        }
        
        [_peerConnection setLocalDescription:sdp completionHandler:^(NSError *error) {
            if (error) {
                NSLog(@"Ojowacam: Set local description error: %@", error.localizedDescription);
                return;
            }
            
            _connected = YES;
            NSLog(@"Ojowacam: Connected to device %@", deviceId);
        }];
    }];
}

- (void)disconnect {
    if (_peerConnection) {
        [_peerConnection close];
        _peerConnection = nil;
    }
    _videoTrack = nil;
    _audioTrack = nil;
    _connected = NO;
}

- (BOOL)isConnected {
    return _connected;
}

#pragma mark - RTCPeerConnectionDelegate

- (void)peerConnection:(RTCPeerConnection *)peerConnection didGenerateIceCandidate:(RTCIceCandidate *)candidate url:(NSString *)url {
    // Send ICE candidate via signaling
}

- (void)peerConnection:(RTCPeerConnection *)peerConnection didAddStream:(RTCMediaStream *)stream {
    for (RTCVideoTrack *track in stream.videoTracks) {
        _videoTrack = track;
        [_videoTrack addRenderer:self];
    }
    for (RTCAudioTrack *track in stream.audioTracks) {
        _audioTrack = track;
    }
}

- (void)peerConnection:(RTCPeerConnection *)peerConnection didChangeIceConnectionState:(RTCIceConnectionState)state {
    _connected = (state == RTCIceConnectionStateConnected || state == RTCIceConnectionStateCompleted);
}

- (void)peerConnection:(RTCPeerConnection *)peerConnection didRemoveStream:(RTCMediaStream *)stream {
    _videoTrack = nil;
    _audioTrack = nil;
    _connected = NO;
}

#pragma mark - RTCVideoRenderer

- (void)setSize:(CGSize)size {
    // Handle size changes
}

- (void)renderFrame:(RTCVideoFrame *)frame {
    RTCCVPixelBuffer *pixelBuffer = (RTCCVPixelBuffer *)frame.buffer;
    CVPixelBufferRef buffer = pixelBuffer.pixelBuffer;
    
    CIImage *ciImage = [CIImage imageWithCVPixelBuffer:buffer];
    CIContext *context = [CIContext context];
    CGRect extent = ciImage.extent;
    CGImageRef cgImage = [context createCGImage:ciImage fromRect:extent];
    
    if (cgImage) {
        NSImage *nsImage = [[NSImage alloc] initWithCGImage:cgImage size:extent.size];
        CGImageRelease(cgImage);
        
        // Push frame to OBS video source
        // This would use obs_source_frame to push the frame
    }
}

@end
