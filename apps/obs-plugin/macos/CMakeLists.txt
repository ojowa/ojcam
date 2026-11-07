cmake_minimum_required(VERSION 3.10)
project(ojowacam-obs-macos-plugin VERSION 1.0.0)

# ------------------------------------------------------------------
# macOS OBS Plugin
# Output: ojowacam-obs.bundle
# Install location: ~/Library/Application Support/obs-studio/plugins/ojowacam-obs/
# ------------------------------------------------------------------

include_directories(
    include
)

# macOS-specific source files (Objective-C++)
set(MACOS_SOURCES
    src/plugin.mm
    src/camera-source.mm
    src/audio-source.mm
    src/device-manager.mm
    src/stream-receiver.mm
)

add_library(ojowacam-obs-macos MODULE ${MACOS_SOURCES})

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
    LIBRARY_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR}/data/obs-plugins/ojowacam-obs
)

# Copy macOS module.json next to the plugin binary
configure_file(${CMAKE_CURRENT_SOURCE_DIR}/data/module.json
               ${CMAKE_BINARY_DIR}/data/obs-plugins/ojowacam-obs/module.json
               COPYONLY)