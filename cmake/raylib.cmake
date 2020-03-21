

find_package(raylib 2.6 QUIET) # Let CMake search for a raylib-config.cmake


if (NOT raylib_FOUND) # if coudnt find it, download and install it
    include(FetchContent)

    FetchContent_Declare(
            raylib
            URL https://github.com/raysan5/raylib/archive/2.6.0.zip
    )

    FetchContent_GetProperties(raylib)
    if (NOT raylib_POPULATED) # Have we downloaded raylib yet?
        set(FETCHCONTENT_QUIET NO)
        FetchContent_Populate(raylib)

        set(BUILD_EXAMPLES OFF CACHE BOOL "" FORCE) # don't build the supplied examples
        set(BUILD_GAMES    OFF CACHE BOOL "" FORCE) # or games

        # build raylib
        add_subdirectory(${raylib_SOURCE_DIR} ${raylib_BINARY_DIR})

        set(raylib_LDFLAGS "raylib")
        set(raylib_INCLUDE_DIRS "${raylib_BINARY_DIR}/src")
    endif()

endif()