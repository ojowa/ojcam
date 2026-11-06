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

add_library(ojowacam-obs MODULE ${SOURCES})

target_link_libraries(ojowacam-obs PRIVATE ${OBS_LIBRARIES} streaming-core)

# Output to OBS plugins directory
set_target_properties(ojowacam-obs PROPERTIES
    PREFIX ""
    SUFFIX ".so"
    LIBRARY_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR}/data/obs-plugins/ojowacam-obs
)
