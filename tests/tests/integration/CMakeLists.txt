cmake_minimum_required(VERSION 3.10)
project(ojowacam-integration-tests VERSION 1.0.0)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

find_package(GTest REQUIRED)

include_directories(
    ../../packages/streaming-core/include
)

set(TEST_SOURCES
    streaming-pipeline-test.cpp
)

add_executable(run_integration_tests ${TEST_SOURCES})
target_link_libraries(run_integration_tests GTest::gtest_main GTest::gtest)

include(GoogleTest)
gtest_discover_tests(run_integration_tests)
