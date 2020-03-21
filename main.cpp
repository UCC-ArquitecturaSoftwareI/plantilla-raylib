#include <raylib.h>

#include "clases/Nave.h"

#if defined(PLATFORM_WEB) // Para crear HTML5
#include <emscripten/emscripten.h>
#endif
const int screenWidth = 800;
const int screenHeight = 450;

Music music;
Nave *player;

static void UpdateDrawFrame(void);          // Update and Draw one frame

int main() {
    InitWindow(screenWidth, screenHeight, "raylib template - advance game");
    InitAudioDevice();              // Initialize audio device

    music = LoadMusicStream("resources/Cyberpunk Moonlight Sonata.mp3");

    PlayMusicStream(music);
    player = new Nave("resources/ship.png", Vector2{screenWidth / 2, screenHeight / 2});


#if defined(PLATFORM_WEB)
    emscripten_set_main_loop(UpdateDrawFrame, 0, 1);
#else
    SetTargetFPS(60);   // Set our game to run at 60 frames-per-second
    // Main game loop
    while (!WindowShouldClose())    // Detect window close button or ESC key
    {
        UpdateDrawFrame();
    }
#endif

    UnloadMusicStream(music);   // Unload music stream buffers from RAM
    CloseAudioDevice();         // Close audio device (music streaming is automatically stopped)
    return 0;
}

static void UpdateDrawFrame(void) {
    // Allways play music
    UpdateMusicStream(music);

    // Verify input
    if (IsKeyDown(KEY_RIGHT)) player->move_x(2.0f);
    if (IsKeyDown(KEY_LEFT)) player->move_x(-2.0f);
    if (IsKeyDown(KEY_UP)) player->move_y(-2.0f);
    if (IsKeyDown(KEY_DOWN)) player->move_y(2.0f);


    BeginDrawing();

    ClearBackground(RAYWHITE);

    player->draw();

    DrawText("Inicio", 20, 20, 40, LIGHTGRAY);

    EndDrawing();
}