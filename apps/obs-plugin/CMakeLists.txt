cmake_minimum_required(VERSION 3.10)
project(ojowacam-obs-plugin VERSION 1.0.0)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# ------------------------------------------------------------------
# Top-level OBS Plugin CMake
# Dispatches to platform-specific subdirectory
# ------------------------------------------------------------------

# Locate OBS Studio (shared logic for all platforms)
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

# Include directories for shared code + OBS + streaming-core
include_directories(
    shared/include
    ${OBS_INCLUDE_DIRS}
    "${CMAKE_CURRENT_SOURCE_DIR}/../../packages/streaming-core/include"
)

add_subdirectory(
    "${CMAKE_CURRENT_SOURCE_DIR}/../../packages/streaming-core"
    "${CMAKE_CURRENT_BINARY_DIR}/streaming-core"
)

# Select platform subdirectory
if(WIN32)
    add_subdirectory(windows)
elseif(APPLE)
    add_subdirectory(macos)
else()
    message(FATAL_ERROR "Unsupported platform for OBS plugin")
endif()
