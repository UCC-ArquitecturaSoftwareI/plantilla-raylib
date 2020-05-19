
if(${PLATFORM} MATCHES "Web")

    # The local resources path needs to be mapped to /resources virtual path

    set_target_properties(${PROJECT_NAME} PROPERTIES LINK_FLAGS "--preload-file resources@resources")

    add_compile_options(
            -Wall -Werror -Wno-error=maybe-uninitialized
            $<$<CONFIG:RELEASE>:-Ofast>
            $<$<CONFIG:DEBUG>-O0>
            $<$<CONFIG:DEBUG>-ggdb3>
    )

    ADD_CUSTOM_COMMAND(TARGET ${PROJECT_NAME} POST_BUILD
            COMMAND ${CMAKE_COMMAND} -E copy
            ${CMAKE_BINARY_DIR}/bin/${PROJECT_NAME}.html
            ${CMAKE_BINARY_DIR}/bin/index.html
            COMMENT "Copying 'test' library to '${COPY_TO_PATH}'")


endif()