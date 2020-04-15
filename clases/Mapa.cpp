//
// Created by martin on 7/4/20.
//

#include <iostream>
#include <cmath>
#include "Mapa.h"

Mapa::Mapa(std::string file) {
    tson::Tileson parser;
    map = parser.parse(fs::path(file));

    for (auto &tileset : map.getTilesets()) {
        map_tex = LoadTexture(fs::path("resources/mapa/" + tileset.getImage().string()).c_str());
        map_tileset = &tileset;
    }


    if (map.getStatus() == tson::ParseStatus::OK) {

        tson::Object *player = map.getLayer("Objetos")->firstObj("player");
        player_init_pos.x = player->getPosition().x;
        player_init_pos.y = player->getPosition().y;

        for (auto &layer : map.getLayers()) { // Recorro todos los layers



            if (layer.getType() == tson::LayerType::ObjectGroup) {
                for (auto &obj : layer.getObjects()) {
                    //Just iterate through all the objects
                    std::cout << " \x01\xF6\x42 " << obj.getName() << " en ";
                    std::cout << obj.getPosition().x << ", ";
                    std::cout << obj.getPosition().y << std::endl;

                }
            }
        }
    }

}

void Mapa::dibujar() {
    Rectangle tile_rec = {0.0f, 0.0f, map.getTileSize().x, map.getTileSize().y};
    int firstId = map_tileset->getFirstgid(); //First tile id of the tileset
    int columns = map_tileset->getColumns(); //For the demo map it is 8.
    int rows = map_tileset->getTileCount() / columns;
    int lastId = (map_tileset->getFirstgid() + map_tileset->getTileCount()) - 1;
    int margin = map_tileset->getMargin();
    int space = map_tileset->getSpacing();


    auto &c = map.getBackgroundColor();
    ClearBackground({c.r, c.g, c.b, c.a}); // Limpio la pantalla con blanco

    for(auto nombre: {"Fondo", "Frente"}){
        auto *layer = map.getLayer(nombre);
        for (auto&[pos, tile] : layer->getTileData()) //Loops through absolutely all existing tiles
        {
            //Must check for nullptr, due to how we got the first invalid tile (pos: 0, 4)
            //Would be unnecessary otherwise.
            if (tile != nullptr) {
                tson::Vector2f position = {(float) std::get<0>(pos) * map.getTileSize().x,
                                           (float) std::get<1>(pos) * map.getTileSize().y};

                int baseTilePosition = (tile->getId() - firstId);

                int tileModX = (baseTilePosition % columns);
                int currentRow = (baseTilePosition / columns);
                int offsetX = tileModX * (map.getTileSize().x + space) + margin;
                int offsetY = currentRow * (map.getTileSize().y + space) + margin;

                tile_rec.x = offsetX;
                tile_rec.y = offsetY;
                DrawTextureRec(map_tex, tile_rec, {position.x, position.y}, WHITE);

            }
        }

    }
}
