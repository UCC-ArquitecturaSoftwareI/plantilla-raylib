cmake_minimum_required(VERSION 3.12)
project(raylibTemplate)

set(EXECUTABLE ${PROJECT_NAME})
set(CMAKE_CXX_STANDARD 14)

# Get the source toegher
file(GLOB sources *.cpp)

# Get the source  of classes toegher
file(GLOB sources_clases clases/*.cpp)


include("cmake/raylib_web.cmake")
include("cmake/raylib.cmake")


add_executable(${EXECUTABLE} ${sources} ${sources_clases})
add_dependencies(${EXECUTABLE} raylib)
target_link_libraries(${EXECUTABLE} ${raylib_LDFLAGS})
target_include_directories(${EXECUTABLE} PRIVATE ${raylib_INCLUDE_DIRS})

file(COPY "resources/"  DESTINATION "resources/")