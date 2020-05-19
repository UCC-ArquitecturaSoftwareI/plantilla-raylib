//
// Created by martin on 21/3/20.
//
#include <raylib.h>
#include <string>

#ifndef RAYLIBTEMPLATE_NAVE_H
#define RAYLIBTEMPLATE_NAVE_H


class Nave {
    Texture2D nave;
    float velo;
    Vector2 nave_pos;
    float rot;
public:
    Nave(std::string text, const Vector2 &navePos);

    void draw();

    void move(float d);

    void rotar(float r);
};


#endif //RAYLIBTEMPLATE_NAVE_H
