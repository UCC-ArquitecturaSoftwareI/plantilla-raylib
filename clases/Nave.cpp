//
// Created by martin on 21/3/20.
//

#include <string>
#include "Nave.h"

Nave::Nave(std::string text, const Vector2 &navePos) : nave_pos(navePos) {

    nave = LoadTexture(text.c_str());
}

void Nave::draw() {

    DrawTexture(nave, nave_pos.x - nave.width/2, nave_pos.y- nave.height/2, WHITE);
}

void Nave::move_x(float d) {
    nave_pos.x += d;
}
void Nave::move_y(float d) {
    nave_pos.y += d;
}
