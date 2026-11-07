cmake_minimum_required(VERSION 3.10)
project(ojowacam-obs-windows-plugin VERSION 1.0.0)

# ------------------------------------------------------------------
# Windows OBS Plugin (Windows 10 / 11)
# Output: ojowacam-obs.dll
# Install location: %PROGRAMDATA%\obs-studio\plugins\ojowacam-obs\
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
    RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/package/bin/64bit"
    LIBRARY_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/package/bin/64bit"
)

foreach(config DEBUG RELEASE RELWITHDEBINFO MINSIZEREL)
    set_target_properties(ojowacam-obs PROPERTIES
        RUNTIME_OUTPUT_DIRECTORY_${config} "${CMAKE_BINARY_DIR}/package/bin/64bit"
        LIBRARY_OUTPUT_DIRECTORY_${config} "${CMAKE_BINARY_DIR}/package/bin/64bit"
    )
endforeach()

# Link WebRTC if available
find_package(WebRTC QUIET)
if(WebRTC_FOUND)
    target_link_libraries(ojowacam-obs PRIVATE WebRTC::WebRTC)
    target_compile_definitions(ojowacam-obs PRIVATE OJO_WEBRTC_ENABLED)
endif()

# OBS's modern Windows plugin layout separates binaries and data.
file(MAKE_DIRECTORY "${CMAKE_BINARY_DIR}/package/data")
configure_file(${CMAKE_CURRENT_SOURCE_DIR}/data/module.json
               ${CMAKE_BINARY_DIR}/package/data/module.json
               COPYONLY)