//
// Created by martin on 21/3/20.
//

#include <string>
#include "Nave.h"

/**
 * Constructor of the ship
 * @param text is the file name
 * @param navePos intiial pos of the whip
 */
Nave::Nave(std::string text, const Vector2 &navePos) : nave_pos(navePos) {

    nave = LoadTexture(text.c_str());
}
/**
 * draw the ship
 */
void Nave::draw() {

    DrawTexture(nave, nave_pos.x - nave.width/2, nave_pos.y- nave.height/2, WHITE);
}

/**
 * Move in x the ship
 * @param d the amount of movement in X
 */
void Nave::move_x(float d) {
    nave_pos.x += d;
}

void Nave::move_y(float d) {
    nave_pos.y += d;
}

const Vector2 &Nave::getNavePos() const {
    return nave_pos;
}
