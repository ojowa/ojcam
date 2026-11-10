cmake_minimum_required(VERSION 3.10)
project(streaming-core VERSION 1.0.0)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

include_directories(include)

set(SOURCES
    src/decoder/video-decoder.cpp
    src/audio/audio-decoder.cpp
    src/synchronization/stream-synchronizer.cpp
    src/transport/webrtc-transport.cpp
)

add_library(streaming-core STATIC ${SOURCES})

# FFmpeg for hardware-accelerated H264 decoding
find_package(FFmpeg QUIET)
if(FFmpeg_FOUND)
    target_link_libraries(streaming-core PRIVATE FFmpeg::avcodec FFmpeg::avutil)
    target_compile_definitions(streaming-core PRIVATE OJO_FFMPEG_ENABLED)
    message(STATUS "[Ojowacam] FFmpeg found - H264 hardware decode enabled")
else()
    message(STATUS "[Ojowacam] FFmpeg not found - using software H264 decoder only")
endif()

# libopus for Opus audio decoding
find_library(OPUS_LIB opus)
if(OPUS_LIB)
    target_link_libraries(streaming-core PRIVATE ${OPUS_LIB})
    target_compile_definitions(streaming-core PRIVATE OJO_OPUS_ENABLED)
    message(STATUS "[Ojowacam] libopus found - Opus audio decode enabled")
else()
    message(STATUS "[Ojowacam] libopus not found - using silence fallback for audio")
endif()

# Link WebRTC if available (native peer connection on macOS/Windows)
find_package(WebRTC QUIET)
if(WebRTC_FOUND)
    target_link_libraries(streaming-core PRIVATE WebRTC::WebRTC)
    target_compile_definitions(streaming-core PRIVATE OJO_WEBRTC_ENABLED)
    message(STATUS "[Ojowacam] WebRTC found - native peer connection enabled")
else()
    message(STATUS "[Ojowacam] WebRTC not found - using WebSocket signaling fallback")
endif()

# Bonjour (macOS/Windows) for mDNS discovery
if(APPLE)
    find_library(COREFOUNDATION_LIB CoreFoundation)
    if(COREFOUNDATION_LIB)
        target_link_libraries(streaming-core PRIVATE ${COREFOUNDATION_LIB})
    endif()
elseif(WIN32)
    target_link_libraries(streaming-core PRIVATE ws2_32)
    # dns_sd.h (Bonjour) is optional on Windows – detected via __has_include
endif()

# OBS headers for blog()/obs logging used in decoders
if(OBS_INCLUDE_DIRS)
    target_include_directories(streaming-core PRIVATE ${OBS_INCLUDE_DIRS})
endif()