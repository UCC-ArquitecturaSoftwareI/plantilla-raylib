#include "raylib.h"

#if defined(PLATFORM_WEB) // Para crear HTML5
#include <emscripten/emscripten.h>
#endif
const int screenWidth = 800;
const int screenHeight = 450;

static void UpdateDrawFrame(void);          // Update and Draw one frame

int main() {
    InitWindow(screenWidth, screenHeight, "raylib template - advance game");

#if defined(PLATFORM_WEB)
    emscripten_set_main_loop(UpdateDrawFrame, 0, 1);
#else
    SetTargetFPS(60);   // Set our game to run at 60 frames-per-second
    //--------------------------------------------------------------------------------------

    // Main game loop
    while (!WindowShouldClose())    // Detect window close button or ESC key
    {
        UpdateDrawFrame();
    }
#endif
    return 0;
}

static void UpdateDrawFrame(void)
{

    BeginDrawing();

    ClearBackground(RAYWHITE);
    DrawText("LOGO SCREEN", 20, 20, 40, LIGHTGRAY);

    EndDrawing();
}