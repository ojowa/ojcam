cmake_minimum_required(VERSION 3.10)
project(ojowacam-obs-plugin VERSION 1.0.0)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# ------------------------------------------------------------------
# Locate OBS Studio
# ------------------------------------------------------------------
# Try CMake config package first (OBS may install OBSConfig.cmake)
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

# Fallback: manually locate OBS headers and libraries
if(NOT OBS_FOUND)
    message(STATUS "OBS CMake config package not found, using manual detection")

    # Find obs-module.h header
    find_path(OBS_INCLUDE_DIR
        NAMES obs-module.h
        PATHS "${CMAKE_PREFIX_PATH}/include"
        PATH_SUFFIXES "obs" ""
        NO_DEFAULT_PATH
    )

    # Find obs library
    if(WIN32)
        find_library(OBS_LIB
            NAMES obs.lib obs
            PATHS "${CMAKE_PREFIX_PATH}/lib" "${CMAKE_PREFIX_PATH}/bin"
            NO_DEFAULT_PATH
        )
    elseif(APPLE)
        find_library(OBS_LIB
            NAMES obs
            PATHS "${CMAKE_PREFIX_PATH}/lib"
            NO_DEFAULT_PATH
        )
    else()
        find_library(OBS_LIB
            NAMES obs
            PATHS "${CMAKE_PREFIX_PATH}/lib" "${CMAKE_PREFIX_PATH}/lib64"
            NO_DEFAULT_PATH
        )
    endif()

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
