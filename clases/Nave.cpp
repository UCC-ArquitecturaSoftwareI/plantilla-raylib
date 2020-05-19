//
// Created by martin on 21/3/20.
//

#include <string>
#include <cmath>
#include "Nave.h"

Nave::Nave(std::string text, const Vector2 &navePos) : nave_pos(navePos) {

    nave = LoadTexture(text.c_str());
    rot = 0;
}

void Nave::draw() {
    // Rectantulo con tamaño de la textura
    Rectangle sourceRec = { 0.0f, 0.0f, nave.width, nave.height };

    // rectangulo ubicado donde estará en la pantalla
    Rectangle destRec = { nave_pos.x, nave_pos.y, nave.width, nave.height };

    Vector2 origin = {nave.width/2, nave.height/2}; // Centro de la textura

    DrawTexturePro(nave, sourceRec, destRec, origin, (float)rot, WHITE);
}

void Nave::move(float d) {

    nave_pos.x += d * std::sin(-rot * M_PI / 180);
    nave_pos.y += d * std::cos(-rot * M_PI / 180);
}

void Nave::rotar(float r) {
    rot += r;
}
