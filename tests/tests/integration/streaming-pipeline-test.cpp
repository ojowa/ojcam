// tests/integration/streaming-pipeline-test.cpp

#include <gtest/gtest.h>
#include "../../packages/streaming-core/include/streaming-core.h"
#include "../../packages/streaming-core/include/transport/transport.h"
#include "../../packages/streaming-core/include/decoder/video-decoder.h"
#include "../../packages/streaming-core/include/audio/audio-decoder.h"
#include "../../packages/streaming-core/include/synchronization/stream-synchronizer.h"

using namespace ojowacam;

class MockTransport : public Transport {
public:
    bool connected = false;
    std::string connectUrl;
    int sendVideoCount = 0;
    int sendAudioCount = 0;

    bool connect(const std::string& url) override {
        connectUrl = url;
        connected = true;
        if (onConnectionStateChanged) onConnectionStateChanged(true);
        return true;
    }

    void disconnect() override {
        connected = false;
        if (onConnectionStateChanged) onConnectionStateChanged(false);
    }

    bool sendVideoFrame(const VideoFrame& frame) override {
        sendVideoCount++;
        return true;
    }

    bool sendAudioFrame(const AudioFrame& frame) override {
        sendAudioCount++;
        return true;
    }

    bool isConnected() const override { return connected; }
};

TEST(StreamingPipelineTest, TransportConnectDisconnect) {
    MockTransport transport;
    
    EXPECT_FALSE(transport.isConnected());
    
    EXPECT_TRUE(transport.connect("ws://localhost:8080"));
    EXPECT_TRUE(transport.isConnected());
    EXPECT_EQ(transport.connectUrl, "ws://localhost:8080");
    
    transport.disconnect();
    EXPECT_FALSE(transport.isConnected());
}

TEST(StreamingPipelineTest, VideoFrameThroughTransport) {
    MockTransport transport;
    transport.connect("ws://localhost:8080");
    
    VideoFrame frame;
    frame.data = {0x00, 0x00, 0x00, 0x01, 0x67};
    frame.width = 1920;
    frame.height = 1080;
    frame.timestamp_us = 500000;
    
    EXPECT_TRUE(transport.sendVideoFrame(frame));
    EXPECT_EQ(transport.sendVideoCount, 1);
    EXPECT_EQ(transport.sendAudioCount, 0);
}

TEST(StreamingPipelineTest, AudioFrameThroughTransport) {
    MockTransport transport;
    transport.connect("ws://localhost:8080");
    
    AudioFrame audio;
    audio.samples = {0.1f, -0.2f, 0.3f, -0.4f};
    audio.sample_rate = 48000;
    audio.channels = 2;
    audio.timestamp_us = 500000;
    
    EXPECT_TRUE(transport.sendAudioFrame(audio));
    EXPECT_EQ(transport.sendAudioCount, 1);
    EXPECT_EQ(transport.sendVideoCount, 0);
}

TEST(StreamSynchronizerTest, PushAndGetVideoFrame) {
    StreamSynchronizer sync;
    
    VideoFrame frame1;
    frame1.ntp_time_ms = 1000;
    frame1.width = 1920;
    frame1.height = 1080;
    
    VideoFrame frame2;
    frame2.ntp_time_ms = 2000;
    frame2.width = 1920;
    frame2.height = 1080;
    
    sync.pushVideoFrame(frame1);
    sync.pushVideoFrame(frame2);
    
    // Get frame at time 1500ms (should return frame2 as it's closest)
    auto result = sync.getNextVideoFrame(1500);
    ASSERT_TRUE(result.has_value());
    EXPECT_EQ(result->ntp_time_ms, 2000);
}

TEST(StreamSynchronizerTest, PushAndGetAudioFrame) {
    StreamSynchronizer sync;
    
    AudioFrame audio1;
    audio1.ntp_time_ms = 1000;
    audio1.sample_rate = 48000;
    audio1.channels = 2;
    
    sync.pushAudioFrame(audio1);
    
    auto result = sync.getNextAudioFrame(1000);
    ASSERT_TRUE(result.has_value());
    EXPECT_EQ(result->sample_rate, 48000);
    EXPECT_EQ(result->channels, 2);
}

TEST(StreamSynchronizerTest, EmptyQueue) {
    StreamSynchronizer sync;
    
    auto videoResult = sync.getNextVideoFrame(1000);
    EXPECT_FALSE(videoResult.has_value());
    
    auto audioResult = sync.getNextAudioFrame(1000);
    EXPECT_FALSE(audioResult.has_value());
}

TEST(StreamSynchronizerTest, Reset) {
    StreamSynchronizer sync;
    
    VideoFrame frame;
    frame.ntp_time_ms = 1000;
    sync.pushVideoFrame(frame);
    
    sync.reset();
    
    auto result = sync.getNextVideoFrame(2000);
    EXPECT_FALSE(result.has_value());
}
