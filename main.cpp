#include <raylib.h>

#include "clases/Nave.h"

#if defined(PLATFORM_WEB) // Para crear HTML5
#include <emscripten/emscripten.h>
#endif
const int screenWidth = 800;
const int screenHeight = 450;

// Variables Globales
Music music;
Nave *player;

static void UpdateDrawFrame(void);          // Función dedicada a operar cada frame

int main() {
    // Inicialización de la ventana
    InitWindow(screenWidth, screenHeight, "raylib template - advance game");
    InitAudioDevice();              // Initialize audio device

    /// Ejemplo de utilización de audio.
    music = LoadMusicStream("resources/Cyberpunk Moonlight Sonata.mp3");

    PlayMusicStream(music);
    player = new Nave("resources/ship.png", Vector2{screenWidth / 2, screenHeight / 2});


#if defined(PLATFORM_WEB)  // Para versión Web.
    emscripten_set_main_loop(UpdateDrawFrame, 0, 1);
#else
    SetTargetFPS(60);   // Set our game to run at 60 frames-per-second
    // Main loop
    while (!WindowShouldClose()) {
        UpdateDrawFrame();
    }
#endif


    // Descargar todos los resources cargados

    UnloadMusicStream(music);   // Descargo la musica de RAM
    CloseAudioDevice();         // Cierro el dispositivo de Audio
    CloseWindow();              // Cierro la ventana
    return 0;
}


/**
 *  Función dedicada a dibujar cada frame. Acá adentro se debe poner la logica necesaria para representar un nuevo frame
 *  del juego.
 */
static void UpdateDrawFrame(void) {

    // siempre hay que reproducir la musica que esta actualmente
    UpdateMusicStream(music);

    // Verifico Entradas de eventos.
    if (IsKeyDown(KEY_RIGHT)) player->move_x(2.0f);
    if (IsKeyDown(KEY_LEFT)) player->move_x(-2.0f);
    if (IsKeyDown(KEY_UP)) player->move_y(-2.0f);
    if (IsKeyDown(KEY_DOWN)) player->move_y(2.0f);


    // Comienzo a dibujar
    BeginDrawing();

    ClearBackground(RAYWHITE); // Limpio la pantalla con blanco

    // Dibujo todos los elementos del juego.
    player->draw();
    DrawText("Inicio", 20, 20, 40, LIGHTGRAY);

    // Finalizo el dibujado
    EndDrawing();
}