//
//  stream-receiver.mm
//  Ojowacam OBS macOS Plugin
//

#import "stream-receiver.h"
#import <WebRTC/WebRTC.h>
#import <CoreVideo/CoreVideo.h>
#import <CoreGraphics/CoreGraphics.h>
#include <obs-module.h>
#include <string>

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

- (instancetype)initWithVideoSource:(obs_source_t *)videoSource audioSource:(obs_source_t *)audioSource
{
    self = [super init];
    if (self) {
        _videoSource = videoSource;
        _audioSource = audioSource;
        _connected = NO;
    }
    return self;
}

- (void)connectWithDeviceId:(NSString *)deviceId signalingURL:(NSString *)signalingUrl
{
    if (!_factory) {
        [PeerConnectionFactory initializeEncoderFactory:[[DefaultVideoEncoderFactory alloc] init]
                                            decoderFactory:[[DefaultVideoDecoderFactory alloc] init]];
        _factory = [[PeerConnectionFactory alloc] initWithOptions:[[PeerConnectionFactory.Options alloc] init]];
    }

    RTCConfiguration *config = [[RTCConfiguration alloc] init];
    config.iceServers = @[[[RTCIceServer alloc] initWithURLStrings:@[@"stun:stun.l.google.com:19302"]]];

    RTCMediaConstraints *constraints = [[RTCMediaConstraints alloc] initWithMandatoryConstraints:@{
        @"OfferToReceiveAudio": @"true",
        @"OfferToReceiveVideo": @"true"
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

- (void)disconnect
{
    if (_peerConnection) {
        [_peerConnection close];
        _peerConnection = nil;
    }
    _videoTrack = nil;
    _audioTrack = nil;
    _connected = NO;
}

- (BOOL)isConnected
{
    return _connected;
}

#pragma mark - RTCPeerConnectionDelegate

- (void)peerConnection:(RTCPeerConnection *)peerConnection didGenerateIceCandidate:(RTCIceCandidate *)candidate url:(NSString *)url
{
    // Send ICE candidate via signaling
}

- (void)peerConnection:(RTCPeerConnection *)peerConnection didAddStream:(RTCMediaStream *)stream
{
    for (RTCVideoTrack *track in stream.videoTracks) {
        _videoTrack = track;
        [_videoTrack addRenderer:self];
    }
    for (RTCAudioTrack *track in stream.audioTracks) {
        _audioTrack = track;
    }
}

- (void)peerConnection:(RTCPeerConnection *)peerConnection didChangeIceConnectionState:(RTCIceConnectionState)state
{
    _connected = (state == RTCIceConnectionStateConnected || state == RTCIceConnectionStateCompleted);
    if (!_connected) {
        _videoTrack = nil;
        _audioTrack = nil;
    }
}

- (void)peerConnection:(RTCPeerConnection *)peerConnection didRemoveStream:(RTCMediaStream *)stream
{
    _videoTrack = nil;
    _audioTrack = nil;
    _connected = NO;
}

#pragma mark - RTCVideoRenderer

- (void)setSize:(CGSize)size
{
    // Handle size changes
}

- (void)renderFrame:(RTCVideoFrame *)frame
{
    RTCCVPixelBuffer *pixelBuffer = (RTCCVPixelBuffer *)frame.buffer;
    CVPixelBufferRef buffer = pixelBuffer.pixelBuffer;

    CVPixelBufferLockBaseAddress(buffer, kCVPixelBufferLock_ReadOnly);
    void *baseAddress = CVPixelBufferGetBaseAddress(buffer);
    size_t width = CVPixelBufferGetWidth(buffer);
    size_t height = CVPixelBufferGetHeight(buffer);
    size_t bytesPerRow = CVPixelBufferGetBytesPerRow(buffer);
    OSType pixelFormat = CVPixelBufferGetPixelFormatType(buffer);

    if (baseAddress && pixelFormat == kCVPixelFormatType_32BGRA) {
        // Convert BGRA to RGBA for OBS
        std::vector<uint8_t> rgbaData(width * height * 4);
        const uint8_t *bgra = static_cast<const uint8_t *>(baseAddress);
        for (size_t y = 0; y < height; y++) {
            const uint8_t *row = bgra + y * bytesPerRow;
            uint8_t *outRow = rgbaData.data() + y * width * 4;
            for (size_t x = 0; x < width; x++) {
                outRow[x * 4 + 0] = row[x * 4 + 2]; // R = B
                outRow[x * 4 + 1] = row[x * 4 + 1]; // G = G
                outRow[x * 4 + 2] = row[x * 4 + 0]; // B = R
                outRow[x * 4 + 3] = row[x * 4 + 3]; // A = A
            }
        }

        obs_source_frame obs_frame{};
        obs_frame.format = VIDEO_FORMAT_RGBA;
        obs_frame.width = (int)width;
        obs_frame.height = (int)height;
        obs_frame.timestamp = frame.timeStampNanoseconds;
        obs_frame.data[0] = rgbaData.data();
        obs_frame.linesize[0] = width * 4 * sizeof(uint8_t);

        obs_source_output_video(_videoSource, &obs_frame);
    }

    CVPixelBufferUnlockBaseAddress(buffer, kCVPixelBufferLock_ReadOnly);
}

@end