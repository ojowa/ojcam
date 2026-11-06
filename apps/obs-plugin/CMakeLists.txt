cmake_minimum_required(VERSION 3.10)
project(ojowacam-obs-plugin VERSION 1.0.0)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Find OBS Studio
find_package(OBS REQUIRED)

include_directories(
    include
    ${OBS_INCLUDE_DIRS}
    ../../../packages/streaming-core/include
)

# Source files
set(SOURCES
    src/plugin.cpp
    src/video-source.cpp
    src/audio-source.cpp
    src/device-manager.cpp
    src/source-properties.cpp
    src/obs-registration.cpp
    src/stream-receiver.cpp
    src/frame-converter.cpp
)

# Determine plugin output filename based on platform
if(WIN32)
    set(PLUGIN_PREFIX "")
    set(PLUGIN_SUFFIX ".dll")
elseif(APPLE)
    set(PLUGIN_PREFIX "")
    set(PLUGIN_SUFFIX ".bundle")
else()
    set(PLUGIN_PREFIX "lib")
    set(PLUGIN_SUFFIX ".so")
endif()

add_library(ojowacam-obs MODULE ${SOURCES})

target_link_libraries(ojowacam-obs PRIVATE ${OBS_LIBRARIES} streaming-core)

# Output to OBS plugins directory structure: obs-plugins/ojowacam-obs/
set_target_properties(ojowacam-obs PROPERTIES
    PREFIX ${PLUGIN_PREFIX}
    SUFFIX ${PLUGIN_SUFFIX}
    LIBRARY_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR}/data/obs-plugins/ojowacam-obs
)

# Copy module.json next to the plugin binary
configure_file(${CMAKE_SOURCE_DIR}/data/module.json
               ${CMAKE_BINARY_DIR}/data/obs-plugins/ojowacam-obs/module.json
               COPYONLY)
