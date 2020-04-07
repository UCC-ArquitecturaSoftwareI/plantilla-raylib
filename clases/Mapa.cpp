//
// Created by martin on 7/4/20.
//

#include "Mapa.h"

Mapa::Mapa(std::string img) {

    dibujo = LoadTexture(img.c_str());
    x = 0;
    y = -940;
}

void Mapa::setX(int x) {
    Mapa::x += x;
}

void Mapa::setY(int y) {
    Mapa::y += y;
}

void Mapa::dibujar() {
    DrawTexture(dibujo, x, y, WHITE);

}
