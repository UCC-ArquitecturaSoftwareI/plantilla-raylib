
if(${PLATFORM} MATCHES "Web")

    ADD_CUSTOM_COMMAND(TARGET ${PROJECT_NAME} POST_BUILD
            COMMAND ${CMAKE_COMMAND} -E copy
            ${CMAKE_BINARY_DIR}/bin/${PROJECT_NAME}.html
            ${CMAKE_BINARY_DIR}/bin/index.html
            COMMENT "Copying 'test' library to '${COPY_TO_PATH}'")

endif()