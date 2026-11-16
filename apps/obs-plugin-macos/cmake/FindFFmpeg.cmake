# FindFFmpeg.cmake
#
# Locates a local FFmpeg development distribution (headers + import libs),
# e.g. BtbN/gyan.dev builds extracted to the repo's .deps/ffmpeg.
#
# Hints, in order:
#   -DFFMPEG_ROOT=<dir>   (CMake cache var)
#   $ENV{FFMPEG_ROOT}
#   repo-local .deps/ffmpeg
#
# On success defines:
#   FFmpeg_FOUND, FFmpeg_INCLUDE_DIRS, FFmpeg_LIBRARIES
#   imported targets: FFmpeg::avcodec, FFmpeg::avutil,
#                     FFmpeg::avformat, FFmpeg::swscale (if present)

set(_ffmpeg_root_hints
    "${FFMPEG_ROOT}"
    "$ENV{FFMPEG_ROOT}"
    "${CMAKE_CURRENT_LIST_DIR}/../../../.deps/ffmpeg"
    "${CMAKE_SOURCE_DIR}/../../.deps/ffmpeg"
)

find_path(FFmpeg_INCLUDE_DIR
    NAMES libavcodec/avcodec.h
    HINTS ${_ffmpeg_root_hints}
    PATH_SUFFIXES include
)

find_library(FFmpeg_AVCODEC_LIBRARY
    NAMES avcodec
    HINTS ${_ffmpeg_root_hints}
    PATH_SUFFIXES lib lib/x64
)
find_library(FFmpeg_AVUTIL_LIBRARY
    NAMES avutil
    HINTS ${_ffmpeg_root_hints}
    PATH_SUFFIXES lib lib/x64
)
find_library(FFmpeg_AVFORMAT_LIBRARY
    NAMES avformat
    HINTS ${_ffmpeg_root_hints}
    PATH_SUFFIXES lib lib/x64
)
find_library(FFmpeg_SWSCALE_LIBRARY
    NAMES swscale
    HINTS ${_ffmpeg_root_hints}
    PATH_SUFFIXES lib lib/x64
)

include(FindPackageHandleStandardArgs)
find_package_handle_standard_args(FFmpeg
    REQUIRED_VARS FFmpeg_AVCODEC_LIBRARY FFmpeg_AVUTIL_LIBRARY FFmpeg_INCLUDE_DIR
)

if(FFmpeg_FOUND)
    set(FFmpeg_INCLUDE_DIRS "${FFmpeg_INCLUDE_DIR}")
    set(FFmpeg_LIBRARIES "${FFmpeg_AVCODEC_LIBRARY}" "${FFmpeg_AVUTIL_LIBRARY}")

    if(NOT TARGET FFmpeg::avcodec)
        add_library(FFmpeg::avcodec UNKNOWN IMPORTED)
        set_target_properties(FFmpeg::avcodec PROPERTIES
            IMPORTED_LOCATION "${FFmpeg_AVCODEC_LIBRARY}"
            INTERFACE_INCLUDE_DIRECTORIES "${FFmpeg_INCLUDE_DIR}"
        )
    endif()
    if(NOT TARGET FFmpeg::avutil)
        add_library(FFmpeg::avutil UNKNOWN IMPORTED)
        set_target_properties(FFmpeg::avutil PROPERTIES
            IMPORTED_LOCATION "${FFmpeg_AVUTIL_LIBRARY}"
            INTERFACE_INCLUDE_DIRECTORIES "${FFmpeg_INCLUDE_DIR}"
        )
    endif()
    if(FFmpeg_AVFORMAT_LIBRARY AND NOT TARGET FFmpeg::avformat)
        add_library(FFmpeg::avformat UNKNOWN IMPORTED)
        set_target_properties(FFmpeg::avformat PROPERTIES
            IMPORTED_LOCATION "${FFmpeg_AVFORMAT_LIBRARY}"
            INTERFACE_INCLUDE_DIRECTORIES "${FFmpeg_INCLUDE_DIR}"
        )
    endif()
    if(FFmpeg_SWSCALE_LIBRARY AND NOT TARGET FFmpeg::swscale)
        add_library(FFmpeg::swscale UNKNOWN IMPORTED)
        set_target_properties(FFmpeg::swscale PROPERTIES
            IMPORTED_LOCATION "${FFmpeg_SWSCALE_LIBRARY}"
            INTERFACE_INCLUDE_DIRECTORIES "${FFmpeg_INCLUDE_DIR}"
        )
    endif()
endif()

mark_as_advanced(
    FFmpeg_INCLUDE_DIR
    FFmpeg_AVCODEC_LIBRARY
    FFmpeg_AVUTIL_LIBRARY
    FFmpeg_AVFORMAT_LIBRARY
    FFmpeg_SWSCALE_LIBRARY
)
