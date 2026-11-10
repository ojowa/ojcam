#include "decoder/video-decoder.h"
#include <cstring>
#include <algorithm>

#ifdef OJO_FFMPEG_ENABLED
    extern "C" {
    #include <libavcodec/avcodec.h>
    #include <libavutil/frame.h>
    #include <libavutil/pixfmt.h>
    #include <libavutil/hwcontext.h>
    #include <libavutil/opt.h>
    }
#endif

namespace ojowacam {

// ===========================================================================
// BitReader – Exp-Golomb bit-level reader for SPS parsing (software decoder)
// ===========================================================================

unsigned int H264VideoDecoder::BitReader::readBits(int count) {
    unsigned int value = 0;
    for (int i = 0; i < count; ++i) {
        size_t byte_idx = bit_pos / 8;
        size_t bit_idx = 7 - (bit_pos % 8);
        if (byte_idx >= size_bytes) break;
        unsigned int bit = (data[byte_idx] >> bit_idx) & 1u;
        value = (value << 1) | bit;
        ++bit_pos;
    }
    return value;
}

unsigned int H264VideoDecoder::BitReader::readUe() {
    unsigned int leading_zeros = 0;
    while (readBits(1) == 0 && leading_zeros < 32) {
        ++leading_zeros;
    }
    if (leading_zeros >= 32) return 0;
    return (1u << leading_zeros) - 1u + readBits(static_cast<int>(leading_zeros));
}

unsigned int H264VideoDecoder::BitReader::readSe() {
    unsigned int code = readUe();
    if (code & 1) return (code + 1) / 2;
    return -(static_cast<int>(code) / 2);
}

// ===========================================================================
// NAL unit splitting (Annex B start codes)
// ===========================================================================

std::vector<std::vector<uint8_t>> H264VideoDecoder::splitNalUnits(
    const std::vector<uint8_t>& data) {

    std::vector<std::vector<uint8_t>> nal_units;
    size_t i = 0;
    while (i < data.size()) {
        size_t start = data.size();
        for (size_t j = i; j + 3 < data.size(); ++j) {
            if (data[j] == 0 && data[j+1] == 0 && data[j+2] == 1) {
                start = j;
                break;
            }
            if (data[j] == 0 && data[j+1] == 0 && data[j+2] == 0 && data[j+3] == 1) {
                start = j;
                break;
            }
        }
        if (start == data.size()) break;

        size_t next = data.size();
        for (size_t j = start + 1; j + 3 < data.size(); ++j) {
            if (data[j] == 0 && data[j+1] == 0 && data[j+2] == 1) {
                next = j;
                break;
            }
            if (data[j] == 0 && data[j+1] == 0 && data[j+2] == 0 && data[j+3] == 1) {
                next = j;
                break;
            }
        }

        size_t payload_start = start;
        if (data[start] == 0 && data[start+1] == 0 && data[start+2] == 0 && data[start+3] == 1)
            payload_start = start + 4;
        else if (data[start] == 0 && data[start+1] == 0 && data[start+2] == 1)
            payload_start = start + 3;

        std::vector<uint8_t> nal(data.begin() + payload_start,
                                 data.begin() + next);

// ===========================================================================
// SPS parsing – extract width/height using Exp-Golomb
// ===========================================================================

bool H264VideoDecoder::parseSps(const std::vector<uint8_t>& sps, int& width, int& height) {
    if (sps.size() < 2) return false;

    BitReader reader;
    reader.data = sps.data();
    reader.bit_pos = 16;
    reader.size_bytes = sps.size();

    unsigned int profile_idc = reader.readBits(8);
    unsigned int constraint_flags = reader.readBits(8);
    unsigned int level_idc = reader.readBits(8);
    (void)profile_idc; (void)constraint_flags; (void)level_idc;

    reader.readUe();  // seq_parameter_set_id

    if (profile_idc == 100 || profile_idc == 110 || profile_idc == 122 ||
        profile_idc == 244 || profile_idc == 44 || profile_idc == 83 ||
        profile_idc == 86 || profile_idc == 118 || profile_idc == 128 ||
        profile_idc == 138 || profile_idc == 139 || profile_idc == 134) {
        reader.readUe();  // chroma_format_idc
        if (reader.readUe() == 3) reader.readBits(1);
        reader.readUe();  // bit_depth_luma_minus8
        reader.readUe();  // bit_depth_chroma_minus8
        reader.readBits(1);  // qpprime_y_zero_transform_bypass
        if (reader.readBits(1)) {  // seq_scaling_matrix_present
            for (int i = 0; i < 8; ++i) {
                if (reader.readBits(1)) {
                    int size = (i < 6) ? 16 : 64;
                    int last = 8, next = 8;
                    for (int j = 0; j < size; ++j) {
                        if (next != 0) {
                            int delta = static_cast<int>(reader.readSe());
                            next = (last + delta + 256) % 256;
                        }
                        last = (next == 0) ? last : next;
                    }
                }
            }
        }
    }

    reader.readUe() + 4;  // log2_max_frame_num
    unsigned int poc_type = reader.readUe();
    if (poc_type == 0) {
        reader.readUe();
    } else if (poc_type == 1) {
        reader.readBits(1);
        reader.readSe();
        reader.readSe();
        unsigned int n = reader.readUe();
        for (unsigned int i = 0; i < n; ++i) reader.readSe();
    }
    reader.readUe();  // max_num_ref_frames
    reader.readBits(1);  // gaps_in_frame_num_value_allowed

    unsigned int pic_w = reader.readUe() + 1;
    unsigned int pic_h = reader.readUe() + 1;
    unsigned int frame_mbs_only = reader.readBits(1);
    if (!frame_mbs_only) reader.readBits(1);
    reader.readBits(1);  // direct_8x8_inference
    if (reader.readBits(1)) {  // frame_cropping
        unsigned int cl = reader.readUe();
        unsigned int cr = reader.readUe();
        unsigned int ct = reader.readUe();
        unsigned int cb = reader.readUe();
        width = static_cast<int>(pic_w * 16) - static_cast<int>((cl + cr) * 4);
// ===========================================================================
// Software H264 decoder public API
// ===========================================================================

void H264VideoDecoder::emitFrame() {
    if (!onFrameDecoded || frame_buffer_.empty()) return;

    VideoFrame frame;
    frame.data = frame_buffer_;
    frame.width = width_;
    frame.height = height_;
    frame.timestamp_us = frame_timestamp_;
    frame.format = VideoPixelFormat::YUV420;  // H264 typically outputs YUV420
    onFrameDecoded(frame);
}

bool H264VideoDecoder::initialize(int width, int height, const std::string& codec) {
    (void)codec;
    width_ = width;
    height_ = height;
    initialized_ = true;
    waiting_for_idr_ = true;
    frame_buffer_.clear();
    sps_.clear();
    pps_.clear();
    return true;
}

bool H264VideoDecoder::decode(const std::vector<uint8_t>& encoded_data,
                               int64_t timestamp_us) {
    if (!initialized_) return false;

    frame_timestamp_ = timestamp_us;
    auto nal_units = splitNalUnits(encoded_data);
    bool emitted_frame = false;

    for (const auto& nal : nal_units) {
        if (nal.empty()) continue;

        int nal_type = 0, nal_ref_idc = 0;
        if (!parseNalHeader(nal.data(), nal.size(), nal_type, nal_ref_idc)) continue;

        switch (nal_type) {
            case H264_NAL_SPS:
                sps_ = nal;
                if (parseSps(sps_, width_, height_)) {
                    blog(LOG_DEBUG, "[Ojowacam] SPS parsed: %dx%d", width_, height_);
                }
                break;

            case H264_NAL_PPS:
                pps_ = nal;
                break;

            case H264_NAL_IDR:
                if (!frame_buffer_.empty()) {
                    emitFrame();
                    frame_buffer_.clear();
                    emitted_frame = true;
                }
                waiting_for_idr_ = false;
                frame_buffer_.insert(frame_buffer_.end(), nal.begin(), nal.end());
                break;

            case H264_NAL_SLICE:
                if (!waiting_for_idr_) {
                    frame_buffer_.insert(frame_buffer_.end(), nal.begin(), nal.end());
                }
                break;

            case H264_NAL_SEI:
            case H264_NAL_AUD:
            case H264_NAL_END_STREAM:
            case H264_NAL_END_SEQUENCE:
                break;

            default:
                if (!waiting_for_idr_) {
                    frame_buffer_.insert(frame_buffer_.end(), nal.begin(), nal.end());
                }
                break;
        }
    }

    if (!frame_buffer_.empty() && !waiting_for_idr_) {
        emitFrame();
        frame_buffer_.clear();
        emitted_frame = true;
    }
// ===========================================================================
// FFmpeg H264 hardware/software decoder implementation
// ===========================================================================

#ifdef OJO_FFMPEG_ENABLED

struct FFmpegH264Decoder::Impl {
    AVCodecContext* codec_ctx = nullptr;
    AVCodec* codec = nullptr;
    AVFrame* frame = nullptr;
    AVPacket* packet = nullptr;
    AVBufferRef* hw_device_ctx = nullptr;
    enum AVPixelFormat hw_pix_fmt = AV_PIX_FMT_NONE;
    bool use_hardware = false;
    int width = 0;
    int height = 0;
    bool initialized = false;

    ~Impl() {
        if (frame) av_frame_free(&frame);
        if (packet) av_packet_free(&packet);
        if (codec_ctx) avcodec_free_context(&codec_ctx);
        if (hw_device_ctx) av_buffer_unref(&hw_device_ctx);
    }

bool FFmpegH264Decoder::initialize(int width, int height, const std::string& codec) {
    if (impl_->initialized) return true;

    impl_->use_hardware = false;

#ifdef _WIN32
    if (av_hwdevice_ctx_create(&impl_->hw_device_ctx, AV_HWDEVICE_TYPE_D3D11VA, nullptr, nullptr, 0) >= 0) {
        impl_->use_hardware = true;
        impl_->hw_pix_fmt = AV_PIX_FMT_D3D11;
    }
#elif defined(__APPLE__)
    if (av_hwdevice_ctx_create(&impl_->hw_device_ctx, AV_HWDEVICE_TYPE_VIDEOTOOLBOX, nullptr, nullptr, 0) >= 0) {
        impl_->use_hardware = true;
        impl_->hw_pix_fmt = AV_PIX_FMT_VIDEOTOOLBOX;
    }
#else
    if (av_hwdevice_ctx_create(&impl_->hw_device_ctx, AV_HWDEVICE_TYPE_VAAPI, nullptr, nullptr, 0) >= 0) {
        impl_->use_hardware = true;
        impl_->hw_pix_fmt = AV_PIX_FMT_VAAPI;
    }
#endif

    impl_->codec = avcodec_find_decoder(AV_CODEC_ID_H264);
    if (!impl_->codec) {
        blog(LOG_ERROR, "[Ojowacam] FFmpeg: H264 decoder not found");
        return false;
    }

    impl_->codec_ctx = avcodec_alloc_context3(impl_->codec);
    if (!impl_->codec_ctx) {
        blog(LOG_ERROR, "[Ojowacam] FFmpeg: Could not allocate codec context");
        return false;
    }

    impl_->codec_ctx->width = width;
    impl_->codec_ctx->height = height;
    impl_->codec_ctx->thread_count = 4;

    if (impl_->use_hardware) {
        impl_->codec_ctx->hw_device_ctx = av_buffer_ref(impl_->hw_device_ctx);
    }

    if (avcodec_open2(impl_->codec_ctx, impl_->codec, nullptr) < 0) {
        if (impl_->use_hardware) {
            blog(LOG_WARNING, "[Ojowacam] FFmpeg: Hardware decode failed, falling back to software");
            av_buffer_unref(&impl_->hw_device_ctx);
            impl_->hw_device_ctx = nullptr;
            impl_->use_hardware = false;
            impl_->codec_ctx->hw_device_ctx = nullptr;

            if (avcodec_open2(impl_->codec_ctx, impl_->codec, nullptr) < 0) {
                blog(LOG_ERROR, "[Ojowacam] FFmpeg: Software decode also failed");
                avcodec_free_context(&impl_->codec_ctx);
                impl_->codec_ctx = nullptr;
                return false;
            }
        } else {
            blog(LOG_ERROR, "[Ojowacam] FFmpeg: Could not open codec");
            avcodec_free_context(&impl_->codec_ctx);
            impl_->codec_ctx = nullptr;
            return false;
        }
    }

    impl_->frame = av_frame_alloc();
    impl_->packet = av_packet_alloc();


bool FFmpegH264Decoder::decode(const std::vector<uint8_t>& encoded_data,
                                int64_t timestamp_us) {
    if (!impl_->initialized || !impl_->codec_ctx) return false;

    AVPacket* pkt = av_packet_alloc();
    av_packet_from_data(pkt, const_cast<uint8_t*>(encoded_data.data()),
                        static_cast<int>(encoded_data.size()));

    int ret = avcodec_send_packet(impl_->codec_ctx, pkt);
    av_packet_free(&pkt);

    if (ret == AVERROR(EAGAIN) || ret == AVERROR_EOF) {
        // Will try receiving frames below
    } else if (ret < 0) {
        blog(LOG_ERROR, "[Ojowacam] FFmpeg: Error sending packet: %s", av_err2str(ret));
        return false;
    }

    while (true) {
        ret = avcodec_receive_frame(impl_->codec_ctx, impl_->frame);
        if (ret == AVERROR(EAGAIN) || ret == AVERROR_EOF) break;
        if (ret < 0) {
            blog(LOG_ERROR, "[Ojowacam] FFmpeg: Error during decoding: %s", av_err2str(ret));
            return false;
        }

        AVFrame* output_frame = impl_->frame;
        AVFrame* tmp_frame = nullptr;

        if (impl_->use_hardware) {
            tmp_frame = av_frame_alloc();
            if (av_hwframe_transfer_data(tmp_frame, impl_->frame, 0) >= 0) {
                output_frame = tmp_frame;
            } else {
                av_frame_free(&tmp_frame);
            }
        }

        VideoFrame out_frame;
        out_frame.width = output_frame->width;
        out_frame.height = output_frame->height;
        out_frame.timestamp_us = timestamp_us;
        out_frame.format = impl_->use_hardware
            ? VideoPixelFormat::YUV420
            : VideoPixelFormat::RGBA;

        size_t data_size = static_cast<size_t>(output_frame->width) *
                          output_frame->height * 4;
        out_frame.data.resize(data_size);

        if (output_frame->data[0]) {
            std::memcpy(out_frame.data.data(), output_frame->data[0],
                       std::min(data_size, static_cast<size_t>(

void FFmpegH264Decoder::release() {
    if (impl_) {
        impl_->initialized = false;
        impl_->width = 0;
        impl_->height = 0;
    }
}

bool FFmpegH264Decoder::isInitialized() const {
    return impl_ && impl_->initialized;
}

#endif  // OJO_FFMPEG_ENABLED

std::unique_ptr<HardwareVideoDecoder> HardwareVideoDecoder::Create(
    const std::string& codec) {

    if (codec != "H264" && codec != "h264" && codec != "HEVC" && codec != "hevc") {
        return nullptr;
    }

#ifdef OJO_FFMPEG_ENABLED
    return std::make_unique<FFmpegH264Decoder>();
#else
    return nullptr;
#endif
}

bool HardwareVideoDecoder::IsHardwareDecodingAvailable() {
#ifdef OJO_FFMPEG_ENABLED
    return true;
#else
    return false;
#endif
}

} // namespace ojowacam
                           output_frame->linesize[0] * output_frame->height)));
        }

        if (impl_->onFrameDecoded) {
            impl_->onFrameDecoded(out_frame);
        }

        if (tmp_frame) av_frame_free(&tmp_frame);
        av_frame_unref(impl_->frame);
    }

    return true;
}
    if (!impl_->frame || !impl_->packet) {
        blog(LOG_ERROR, "[Ojowacam] FFmpeg: Could not allocate frame/packet");
        return false;
    }

    impl_->width = width;
    impl_->height = height;
    impl_->initialized = true;

    blog(LOG_INFO, "[Ojowacam] FFmpeg H264 decoder initialized (%s, %dx%d)",
         impl_->use_hardware ? "hardware" : "software", width, height);
    return true;
}
};

FFmpegH264Decoder::FFmpegH264Decoder() : impl_(new Impl()) {}
FFmpegH264Decoder::~FFmpegH264Decoder() { release(); delete impl_; }

    return emitted_frame || !frame_buffer_.empty();
}

void H264VideoDecoder::release() {
    initialized_ = false;
    width_ = 0;
    height_ = 0;
    frame_buffer_.clear();
    sps_.clear();
    pps_.clear();
    waiting_for_idr_ = true;
}

bool H264VideoDecoder::isInitialized() const {
    return initialized_;
}
        height = static_cast<int>(pic_h * 16 * (2 - frame_mbs_only)) -
                 static_cast<int>((ct + cb) * 4);
    } else {
        width = static_cast<int>(pic_w * 16);
        height = static_cast<int>(pic_h * 16 * (2 - frame_mbs_only));
    }
    return width > 0 && height > 0;
}
        nal_units.push_back(std::move(nal));
        i = next;
    }
    return nal_units;
}

bool H264VideoDecoder::parseNalHeader(const uint8_t* data, size_t size,
                                       int& nal_type, int& nal_ref_idc) const {
    if (size < 1) return false;
    nal_ref_idc = (data[0] >> 5) & 0x3;
    nal_type = data[0] & 0x1F;
    return true;
}