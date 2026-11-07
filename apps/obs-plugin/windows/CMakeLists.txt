cmake_minimum_required(VERSION 3.10)
project(ojowacam-obs-windows-plugin VERSION 1.0.0)

# ------------------------------------------------------------------
# Windows OBS Plugin (Windows 10 / 11)
# Output: ojowacam-obs.dll
# Install location: %APPDATA%\obs-studio\plugins\ojowacam-obs\
# ------------------------------------------------------------------

include_directories(
    include
    ../../shared/include
)

# Windows-specific source files
set(WINDOWS_SOURCES
    src/obs-registration.cpp
    src/video-source.cpp
    src/audio-source.cpp
    src/source-properties.cpp
)

# Shared cross-platform sources
set(SHARED_SOURCES
    ../../shared/src/device-manager.cpp
    ../../shared/src/stream-receiver.cpp
    ../../shared/src/frame-converter.cpp
)

set(SOURCES ${WINDOWS_SOURCES} ${SHARED_SOURCES})

add_library(ojowacam-obs MODULE ${SOURCES})

target_link_libraries(ojowacam-obs PRIVATE ${OBS_LIBRARIES} streaming-core)

# Windows plugin output: ojowacam-obs.dll
set_target_properties(ojowacam-obs PROPERTIES
    PREFIX ""
    SUFFIX ".dll"
    LIBRARY_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR}/data/obs-plugins/ojowacam-obs
)

# Copy Windows module.json next to the plugin binary
configure_file(${CMAKE_CURRENT_SOURCE_DIR}/data/module.json
               ${CMAKE_BINARY_DIR}/data/obs-plugins/ojowacam-obs/module.json
               COPYONLY)