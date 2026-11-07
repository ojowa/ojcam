#include "decoder/video-decoder.h"
#include <cstring>
#include <algorithm>

namespace ojowacam {

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
        nal_units.push_back(std::move(nal));
        i = next;
    }
    return nal_units;
}

bool H264VideoDecoder::parseNalHeader(const uint8_t* data, size_t size,

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
        if (reader.readBits(1)) {
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
        height = static_cast<int>(pic_h * 16 * (2 - frame_mbs_only)) -

void H264VideoDecoder::emitFrame() {
    if (!onFrameDecoded || frame_buffer_.empty()) return;

    VideoFrame frame;
    frame.data = frame_buffer_;
    frame.width = width_;
    frame.height = height_;
    frame.timestamp_us = frame_timestamp_;
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

} // namespace ojowacam
                 static_cast<int>((ct + cb) * 4);
    } else {
        width = static_cast<int>(pic_w * 16);
        height = static_cast<int>(pic_h * 16 * (2 - frame_mbs_only));
    }
    return width > 0 && height > 0;
}
                                       int& nal_type, int& nal_ref_idc) const {
    if (size < 1) return false;
    nal_ref_idc = (data[0] >> 5) & 0x3;
    nal_type = data[0] & 0x1F;
    return true;
}
    unsigned int code = readUe();
    if (code & 1) return (code + 1) / 2;
    return -(static_cast<int>(code) / 2);
}