# MbedTLSConfigVersion.cmake — satisfies find_package(MbedTLS 3 REQUIRED)
# for the FetchContent-pinned mbedtls release.

set(PACKAGE_VERSION "3.6.2")

if(PACKAGE_FIND_VERSION VERSION_GREATER PACKAGE_VERSION)
    set(PACKAGE_VERSION_COMPATIBLE FALSE)
else()
    set(PACKAGE_VERSION_COMPATIBLE TRUE)
    if(PACKAGE_FIND_VERSION VERSION_EQUAL PACKAGE_VERSION)
        set(PACKAGE_VERSION_EXACT TRUE)
    endif()
endif()