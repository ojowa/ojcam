cmake_minimum_required(VERSION 3.10)
project(ojowacam-obs-macos-plugin VERSION 1.0.0)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# ------------------------------------------------------------------
# OBS Plugin CMake for macOS
# Output: ojowacam-obs.bundle
# ------------------------------------------------------------------

# Locate OBS Studio
set(OBS_FOUND FALSE)

set(_OBS_CONFIG_PATHS
    "${CMAKE_PREFIX_PATH}/lib/cmake/OBS/OBSConfig.cmake"
    "${CMAKE_PREFIX_PATH}/lib64/cmake/OBS/OBSConfig.cmake"
    "${CMAKE_PREFIX_PATH}/share/cmake/OBS/OBSConfig.cmake"
    "${CMAKE_PREFIX_PATH}/cmake/OBS/OBSConfig.cmake"
)

foreach(_cfg IN LISTS _OBS_CONFIG_PATHS)
    if(EXISTS "${_cfg}")
        message(STATUS "Found OBS CMake config: ${_cfg}")
        find_package(OBS REQUIRED CONFIG)
        set(OBS_FOUND TRUE)
        break()
    endif()
endforeach()

if(NOT OBS_FOUND)
    message(STATUS "OBS CMake config package not found, using manual detection")

    find_path(OBS_INCLUDE_DIR
        NAMES obs-module.h
        PATHS "${CMAKE_PREFIX_PATH}/include"
        PATH_SUFFIXES "obs" ""
        NO_DEFAULT_PATH
    )

    find_library(OBS_LIB
        NAMES obs
        PATHS "${CMAKE_PREFIX_PATH}/lib"
        NO_DEFAULT_PATH
    )

    if(NOT OBS_INCLUDE_DIR OR NOT OBS_LIB)
        message(FATAL_ERROR
            "Could not find OBS Studio headers and libraries.\n"
            "  OBS_INCLUDE_DIR: ${OBS_INCLUDE_DIR}\n"
            "  OBS_LIB: ${OBS_LIB}\n"
            "  CMAKE_PREFIX_PATH: ${CMAKE_PREFIX_PATH}"
        )
    endif()

    set(OBS_INCLUDE_DIRS "${OBS_INCLUDE_DIR}")
    set(OBS_LIBRARIES "${OBS_LIB}")
    set(OBS_FOUND TRUE)
endif()

message(STATUS "OBS_INCLUDE_DIRS: ${OBS_INCLUDE_DIRS}")
message(STATUS "OBS_LIBRARIES: ${OBS_LIBRARIES}")

# Include directories
include_directories(
    include
    shared/include
    streaming-core/include
    ${OBS_INCLUDE_DIRS}
)

# Add streaming-core library
add_subdirectory(streaming-core)

# macOS-specific source files (Objective-C++)
set(MACOS_SOURCES
    src/plugin.mm
    src/camera-source.mm
    src/audio-source.mm
    src/device-manager.mm
    src/stream-receiver.mm
    shared/src/device-manager.cpp
    shared/src/stream-receiver.cpp
    shared/src/frame-converter.cpp
)

add_library(ojowacam-obs-macos MODULE ${MACOS_SOURCES})

target_link_libraries(ojowacam-obs-macos PRIVATE ${OBS_LIBRARIES} streaming-core
    CoreFoundation
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
    MACOSX_BUNDLE TRUE
    MACOSX_BUNDLE_INFO_PLIST ${CMAKE_CURRENT_SOURCE_DIR}/data/Info.plist
    LIBRARY_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR}/data/obs-plugins/ojowacam-obs
)

# Link WebRTC if available
find_package(WebRTC QUIET)
if(WebRTC_FOUND)
    target_link_libraries(ojowacam-obs-macos PRIVATE WebRTC::WebRTC)
    target_compile_definitions(ojowacam-obs-macos PRIVATE OJO_WEBRTC_ENABLED)
endif()

# Copy module.json next to the plugin binary
configure_file(${CMAKE_CURRENT_SOURCE_DIR}/data/module.json
               ${CMAKE_BINARY_DIR}/data/obs-plugins/ojowacam-obs/module.json
               COPYONLY)