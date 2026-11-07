cmake_minimum_required(VERSION 3.10)
project(streaming-core VERSION 1.0.0)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

include_directories(include)

# Source files
set(SOURCES
    src/transport/webrtc-transport.cpp
    src/transport/usb/adb-usb-transport.cpp
    src/transport/usb/ios-usb-transport.cpp
    src/decoder/video-decoder.cpp
    src/audio/audio-decoder.cpp
    src/synchronization/stream-synchronizer.cpp
)

add_library(streaming-core ${SOURCES})

# ---------------------------------------------------------------------------
# Optional dependencies: FFmpeg (H264 hardware decode), Opus (audio decode),
# WebRTC (native peer connection), Bonjour/Avahi (mDNS discovery)
// ---------------------------------------------------------------------------

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

# Bonjour (macOS/Windows) or Avahi (Linux) for mDNS discovery
if(APPLE OR WIN32)
    find_library(DNS_SD_LIB dns_sd)
    if(DNS_SD_LIB)
        target_link_libraries(streaming-core PRIVATE ${DNS_SD_LIB})
        message(STATUS "[Ojowacam] Bonjour DNS-SD found - mDNS discovery enabled")
    endif()
elseif(UNIX)
    find_library(AVAHI_CLIENT_LIB avahi-client)
    find_library(AVAHI_COMMON_LIB avahi-common)
    if(AVAHI_CLIENT_LIB AND AVAHI_COMMON_LIB)
        target_link_libraries(streaming-core PRIVATE ${AVAHI_CLIENT_LIB} ${AVAHI_COMMON_LIB})
        message(STATUS "[Ojowacam] Avahi found - mDNS discovery enabled")
    endif()
endif()