cmake_minimum_required(VERSION 3.10)
project(ojowacam-tests VERSION 1.0.0)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Find GoogleTest
find_package(GTest REQUIRED)

include_directories(
    ../../packages/streaming-core/include
)

# Test sources
set(TEST_SOURCES
    video-decoder-test.cpp
)

add_executable(run_tests ${TEST_SOURCES})
target_link_libraries(run_tests GTest::gtest_main GTest::gtest)

# Add test
include(GoogleTest)
gtest_discover_tests(run_tests)
