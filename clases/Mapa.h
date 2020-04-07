//
// Created by martin on 7/4/20.
//

#ifndef RAYLIBTEMPLATE_MAPA_H
#define RAYLIBTEMPLATE_MAPA_H


#include <string>
#include <raylib.h>

class Mapa {
    Texture2D dibujo;
    int y;
    int x;
public:
    Mapa(std::string img);

    void setX(int x);

    void setY(int y);

    void dibujar();
};


#endif //RAYLIBTEMPLATE_MAPA_H
