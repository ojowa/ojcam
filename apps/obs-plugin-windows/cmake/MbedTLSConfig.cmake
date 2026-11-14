# MbedTLSConfig.cmake
#
# Shim so libdatachannel's `find_package(MbedTLS 3 REQUIRED)` + link against
# `MbedTLS::MbedTLS` (see libdatachannel CMakeLists.txt) resolves to the
# mbedtls targets built via FetchContent in streaming-core/CMakeLists.txt.
# The mbedtls repository does not ship an installable package config usable
# for FetchContent consumption, hence this file (MbedTLS_DIR points here).

if(TARGET mbedcrypto AND NOT TARGET MbedTLS::MbedTLS)
    # Umbrella target: libdatachannel links only MbedTLS::MbedTLS, which must
    # pull in all three mbedtls libraries and their headers. BUILD_INTERFACE
    # keeps any downstream install(EXPORT) validation from demanding the
    # FetchContent targets in an export set.
    add_library(MbedTLS::MbedTLS INTERFACE IMPORTED GLOBAL)
    set_property(TARGET MbedTLS::MbedTLS PROPERTY INTERFACE_LINK_LIBRARIES
        "$<BUILD_INTERFACE:mbedtls>"
        "$<BUILD_INTERFACE:mbedx509>"
        "$<BUILD_INTERFACE:mbedcrypto>")
endif()
if(TARGET mbedtls AND NOT TARGET MbedTLS::mbedtls)
    add_library(MbedTLS::mbedtls INTERFACE IMPORTED GLOBAL)
    set_property(TARGET MbedTLS::mbedtls PROPERTY INTERFACE_LINK_LIBRARIES mbedtls)
endif()
if(TARGET mbedx509 AND NOT TARGET MbedTLS::mbedx509)
    add_library(MbedTLS::mbedx509 INTERFACE IMPORTED GLOBAL)
    set_property(TARGET MbedTLS::mbedx509 PROPERTY INTERFACE_LINK_LIBRARIES mbedx509)
endif()
if(TARGET mbedcrypto AND NOT TARGET MbedTLS::mbedcrypto)
    add_library(MbedTLS::mbedcrypto INTERFACE IMPORTED GLOBAL)
    set_property(TARGET MbedTLS::mbedcrypto PROPERTY INTERFACE_LINK_LIBRARIES mbedcrypto)
endif()

if(DEFINED mbedtls_SOURCE_DIR)
    set(MbedTLS_INCLUDE_DIRS "${mbedtls_SOURCE_DIR}/include")
    set(MbedTLS_INCLUDE_DIR "${mbedtls_SOURCE_DIR}/include")
endif()

# libsrtp links via ${MBEDTLS_LIBRARIES}/${MbedTLS_LIBRARIES} and includes via
# ${MBEDTLS_INCLUDE_DIRS} after find_package(MbedTLS). Wrap the FetchContent-
# built targets in $<BUILD_INTERFACE:> so libsrtp's install(EXPORT) rule does
# not demand them in an export set (they are not installable targets), while
# the build itself still links them with correct target ordering.
set(MbedTLS_LIBRARIES
    "$<BUILD_INTERFACE:mbedtls>"
    "$<BUILD_INTERFACE:mbedx509>"
    "$<BUILD_INTERFACE:mbedcrypto>")
set(MBEDTLS_LIBRARIES ${MbedTLS_LIBRARIES})
set(MBEDTLS_INCLUDE_DIRS ${MbedTLS_INCLUDE_DIRS})

set(MbedTLS_FOUND TRUE)
