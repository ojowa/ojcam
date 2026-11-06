cmake_minimum_required(VERSION 3.10)
project(ojowacam-obs-macos-plugin VERSION 1.0.0)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Find OBS Studio
find_package(OBS REQUIRED)

include_directories(
    include
    ${OBS_INCLUDE_DIRS}
    ../../../packages/streaming-core/include
    /System/Library/Frameworks/CoreMediaIO.framework/Headers
)

# Source files
set(SOURCES
    src/plugin.mm
    src/camera-source.mm
    src/audio-source.mm
    src/device-manager.mm
    src/stream-receiver.mm
)

add_library(ojowacam-obs-macos MODULE ${SOURCES})

target_link_libraries(ojowacam-obs-macos PRIVATE ${OBS_LIBRARIES} streaming-core
    CoreMediaIO
    CoreMedia
    CoreVideo
    CoreAudio
    AVFoundation
    Cocoa
)

# macOS bundle properties
set_target_properties(ojowacam-obs-macos PROPERTIES
    PREFIX ""
    SUFFIX ".bundle"
    MACOSX_BUNDLE true
    MACOSX_BUNDLE_INFO_PLIST ${CMAKE_CURRENT_SOURCE_DIR}/data/Info.plist
    LIBRARY_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR}/data/obs-plugins/ojowacam-obs-macos
)
