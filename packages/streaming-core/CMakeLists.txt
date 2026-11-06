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

# Link WebRTC if available
find_package(WebRTC QUIET)
if(WebRTC_FOUND)
    target_link_libraries(streaming-core PRIVATE WebRTC::WebRTC)
    target_compile_definitions(streaming-core PRIVATE OJO_WEBRTC_ENABLED)
endif()