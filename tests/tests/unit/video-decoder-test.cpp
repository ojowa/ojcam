// tests/unit/streaming-core/video-decoder-test.cpp

#include <gtest/gtest.h>
#include "../../packages/streaming-core/include/decoder/video-decoder.h"
#include "../../packages/streaming-core/include/streaming-core.h"

using namespace ojowacam;

class MockVideoDecoder : public VideoDecoder {
public:
    bool initialized = false;
    int initWidth = 0;
    int initHeight = 0;
    std::string initCodec;
    int decodeCount = 0;
    int64_t lastTimestamp = 0;
    bool released = false;

    bool initialize(int width, int height, const std::string& codec) override {
        initialized = true;
        initWidth = width;
        initHeight = height;
        initCodec = codec;
        return true;
    }

    bool decode(const std::vector<uint8_t>& encoded_data, int64_t timestamp_us) override {
        decodeCount++;
        lastTimestamp = timestamp_us;
        if (onFrameDecoded) {
            VideoFrame frame;
            frame.data = encoded_data;
            frame.width = 1920;
            frame.height = 1080;
            frame.timestamp_us = timestamp_us;
            onFrameDecoded(frame);
        }
        return true;
    }

    void release() override {
        released = true;
        initialized = false;
    }

    bool isInitialized() const override { return initialized; }
};

TEST(VideoDecoderTest, InitializeAndDecode) {
    MockVideoDecoder decoder;
    
    // Test initialization
    EXPECT_FALSE(decoder.isInitialized());
    EXPECT_TRUE(decoder.initialize(1920, 1080, "H264"));
    EXPECT_TRUE(decoder.isInitialized());
    EXPECT_EQ(decoder.initWidth, 1920);
    EXPECT_EQ(decoder.initHeight, 1080);
    EXPECT_EQ(decoder.initCodec, "H264");
    
    // Test decoding
    std::vector<uint8_t> frameData = {0x00, 0x00, 0x00, 0x01, 0x67, 0x42, 0x00};
    int64_t timestamp = 1000000;
    EXPECT_TRUE(decoder.decode(frameData, timestamp));
    EXPECT_EQ(decoder.decodeCount, 1);
    EXPECT_EQ(decoder.lastTimestamp, timestamp);
    
    // Test release
    decoder.release();
    EXPECT_FALSE(decoder.isInitialized());
    EXPECT_TRUE(decoder.released);
}

TEST(VideoDecoderTest, DecodeWithoutInitialization) {
    MockVideoDecoder decoder;
    EXPECT_FALSE(decoder.isInitialized());
    
    std::vector<uint8_t> frameData = {0x00, 0x00, 0x00, 0x01};
    EXPECT_FALSE(decoder.decode(frameData, 0));
    EXPECT_EQ(decoder.decodeCount, 0);
}

TEST(StreamConfigTest, DefaultValues) {
    StreamConfig config;
    EXPECT_EQ(config.resolution, "1920x1080");
    EXPECT_EQ(config.fps, 30);
    EXPECT_EQ(config.bitrate, 8000000);
    EXPECT_EQ(config.video_codec, "H264");
    EXPECT_EQ(config.audio_codec, "OPUS");
    EXPECT_EQ(config.sample_rate, 48000);
    EXPECT_EQ(config.channels, 2);
}

TEST(VideoFrameTest, DefaultValues) {
    VideoFrame frame;
    EXPECT_TRUE(frame.data.empty());
    EXPECT_EQ(frame.width, 0);
    EXPECT_EQ(frame.height, 0);
    EXPECT_EQ(frame.timestamp_us, 0);
    EXPECT_EQ(frame.ntp_time_ms, 0);
}
