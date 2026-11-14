cmake_minimum_required(VERSION 3.16)
project(streaming-core VERSION 1.0.0)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

include_directories(include)
list(APPEND CMAKE_MODULE_PATH "${CMAKE_CURRENT_SOURCE_DIR}/../cmake")

set(SOURCES
    src/decoder/video-decoder.cpp
    src/audio/audio-decoder.cpp
    src/synchronization/stream-synchronizer.cpp
    src/transport/webrtc-transport.cpp
    src/transport/rtp-depay.cpp
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

include(FetchContent)

# Some bundled deps (e.g. libdatachannel's plog) declare cmake_minimum_required
# below 3.5, which CMake 4+ rejects outright; let them configure anyway.
set(CMAKE_POLICY_VERSION_MINIMUM 3.5 CACHE STRING
    "Minimum policy version for vendored dependencies")

# libdatachannel and its libsrtp dep ship a FindMbedTLS.cmake module that can
# only locate an *installed* MbedTLS. Prefer config mode so both resolve to
# the shim (cmake/MbedTLSConfig.cmake) backed by our FetchContent build.
set(CMAKE_FIND_PACKAGE_PREFER_CONFIG ON)

# libsrtp build knobs: skip its test apps and warnings-as-flags noise.
set(TEST_APPS OFF CACHE BOOL "" FORCE)
set(BUILD_WITH_WARNINGS OFF CACHE BOOL "" FORCE)

# libopus for Opus audio decoding
find_library(OPUS_LIB opus)
if(OPUS_LIB)
    target_link_libraries(streaming-core PRIVATE ${OPUS_LIB})
    target_compile_definitions(streaming-core PRIVATE OJO_OPUS_ENABLED)
    message(STATUS "[Ojowacam] libopus found - Opus audio decode enabled")
else()
    set(BUILD_SHARED_LIBS OFF)
    set(OPUS_BUILD_TESTING OFF CACHE BOOL "" FORCE)
    FetchContent_Declare(opus
        GIT_REPOSITORY https://github.com/xiph/opus.git
        GIT_TAG v1.5.2
        GIT_SHALLOW TRUE
    )
    FetchContent_MakeAvailable(opus)
    target_link_libraries(streaming-core PRIVATE opus)
    target_compile_definitions(streaming-core PRIVATE OJO_OPUS_ENABLED)
    message(STATUS "[Ojowacam] Opus built from source (FetchContent) - Opus audio decode enabled")
endif()

# libdatachannel for the WebRTC transport, with MbedTLS as the crypto backend
# (no system OpenSSL required).
set(USE_MBEDTLS ON CACHE BOOL "" FORCE)
set(NO_TESTS ON CACHE BOOL "" FORCE)
set(NO_EXAMPLES ON CACHE BOOL "" FORCE)
set(NO_WEBSOCKET ON CACHE BOOL "" FORCE)
set(WARNINGS_AS_ERRORS OFF CACHE BOOL "" FORCE)

set(ENABLE_PROGRAMS OFF CACHE BOOL "" FORCE)
set(ENABLE_TESTING OFF CACHE BOOL "" FORCE)

# libdatachannel's DtlsSrtpTransport needs the DTLS-SRTP extension, which
# MbedTLS 3.6 leaves off by default; MBEDTLS_USER_CONFIG_FILE injects
# MBEDTLS_SSL_DTLS_SRTP into every mbedtls TU (cache var is passed as a
# PUBLIC compile definition by the mbedtls build).
set(MBEDTLS_USER_CONFIG_FILE
    "${CMAKE_CURRENT_SOURCE_DIR}/../cmake/mbedtls-user-config.h"
    CACHE FILEPATH "User config header injected into MbedTLS" FORCE)

FetchContent_Declare(mbedtls
    GIT_REPOSITORY https://github.com/Mbed-TLS/mbedtls.git
    GIT_TAG v3.6.2
    GIT_SHALLOW TRUE
)
FetchContent_MakeAvailable(mbedtls)

set(MbedTLS_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../cmake" CACHE PATH
    "Shim config exposing FetchContent-built mbedtls to find_package" FORCE)

FetchContent_Declare(libdatachannel
    GIT_REPOSITORY https://github.com/paullouisageneau/libdatachannel.git
    GIT_TAG v0.20.1
)
FetchContent_MakeAvailable(libdatachannel)

target_link_libraries(streaming-core PRIVATE datachannel-static)
target_compile_definitions(streaming-core PRIVATE OJO_LIBDATACHANNEL)
message(STATUS "[Ojowacam] libdatachannel built from source (MbedTLS crypto) - WebRTC transport enabled")

# Native WebRTC framework when available (macOS path); absent on Windows, where
# the libdatachannel backend above provides the transport instead.
find_package(WebRTC QUIET)
if(WebRTC_FOUND)
    target_link_libraries(streaming-core PRIVATE WebRTC::WebRTC)
    target_compile_definitions(streaming-core PRIVATE OJO_WEBRTC_ENABLED)
    message(STATUS "[Ojowacam] WebRTC found - native peer connection enabled")
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
