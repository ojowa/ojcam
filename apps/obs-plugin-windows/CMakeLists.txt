cmake_minimum_required(VERSION 3.16)
project(ojowacam-obs-windows-plugin VERSION 1.0.0)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# ------------------------------------------------------------------
# OBS Plugin CMake for Windows
# Output: ojowacam-obs.dll
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

    # Manual paths: repo-local OBS headers + generated import lib
    set(_OBS_HEADER_CANDIDATES
        "${CMAKE_CURRENT_SOURCE_DIR}/../../../.deps/obs-studio/libobs"
        "${CMAKE_SOURCE_DIR}/../../.deps/obs-studio/libobs"
        "${CMAKE_PREFIX_PATH}/include"
        "${CMAKE_PREFIX_PATH}/include/obs"
    )
    set(_OBS_LIB_CANDIDATES
        "${CMAKE_CURRENT_SOURCE_DIR}/../../../.deps/obs-lib/obs.lib"
        "${CMAKE_SOURCE_DIR}/../../.deps/obs-lib/obs.lib"
        "${CMAKE_PREFIX_PATH}/lib/obs.lib"
        "${CMAKE_PREFIX_PATH}/lib/obs"
        "${CMAKE_PREFIX_PATH}/bin/obs.lib"
    )

    set(OBS_INCLUDE_DIR "")
    foreach(_p IN LISTS _OBS_HEADER_CANDIDATES)
        if(EXISTS "${_p}/obs-module.h")
            set(OBS_INCLUDE_DIR "${_p}")
            break()
        endif()
    endforeach()

    set(OBS_LIB "")
    foreach(_p IN LISTS _OBS_LIB_CANDIDATES)
        if(EXISTS "${_p}")
            set(OBS_LIB "${_p}")
            break()
        endif()
    endforeach()

    if(NOT OBS_INCLUDE_DIR OR NOT OBS_LIB)
        message(FATAL_ERROR
            "Could not find OBS Studio headers and libraries.\n"
            "  OBS_INCLUDE_DIR: ${OBS_INCLUDE_DIR}\n"
            "  OBS_LIB: ${OBS_LIB}\n"
            "  CMAKE_PREFIX_PATH: ${CMAKE_PREFIX_PATH}\n"
            "Expected headers at .deps/obs-studio/libobs and import lib at .deps/obs-lib/obs.lib"
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

# Windows-specific source files
set(PLUGIN_SOURCES
    src/obs-registration.cpp
    src/video-source.cpp
    src/audio-source.cpp
    src/source-properties.cpp
    shared/src/device-manager.cpp
    shared/src/stream-receiver.cpp
    shared/src/frame-converter.cpp
)

add_library(ojowacam-obs MODULE ${PLUGIN_SOURCES})

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

# Package layout
file(MAKE_DIRECTORY "${CMAKE_BINARY_DIR}/package/data")
configure_file(${CMAKE_CURRENT_SOURCE_DIR}/data/module.json
               ${CMAKE_BINARY_DIR}/package/data/module.json
               COPYONLY)
