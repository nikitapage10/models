# Models

A web-ready library of 812 CC0 models for [C.E.O.](https://github.com/nikitapage10/C.E.O.). Every file is a self-contained `.glb`:
- meshopt-compressed (load it with three.js `GLTFLoader` + `MeshoptDecoder`)
- textures at most 1024 px WebP

Total size is about 240 MB.

## Finding a model

- **`catalog.json`:** one row per model. Fields:
  - `glb`: the path in this repo
  - `tris` and `textures`
  - `size`: bounding box in source units
  - `rig`: models with the same rig can share animations
  - `anims`: clip names
  - `source`: its path in the original packs
- **`thumbs/<pack>/<id>.webp`:** a preview of each model.

| Pack | Contents | Rig / clips |
| --- | --- | --- |
| `men`, `women` | Ultimate Modular Men/Women: 21 people (casual, suit, worker, sci-fi, witch, king…) | one shared 62-bone rig, 24 clips |
| `robots` | George, Leela, Mike, Stan | own rigs, 20 clips |
| `monsters` | Ultimate Monsters, in `Big/`, `Blob/` and `Flying/` (50) | per family, 14 clips |
| `animals` | 12 farm and wild animals | own rigs, 13 clips |
| `bestiary`, `outfits`, `ual2` | Imp, Puglin; Fantasy peasant and ranger outfits; Universal Animation Library 2 and a female mannequin | the Quaternius universal rig |
| `fantasy-props` | 94 props: books, candles, chests, potions, furniture | static |
| `scifi-essentials` | 37 props: desks, chairs, crates, lockers, drones | static, plus 3 animated drones |
| `scifi-modular` | 189 kit pieces: walls, platforms, rails, decals, 3 aliens | static |
| `nature` | 68 trees, bushes, flowers, rocks, paths | static |
| `medieval` | 176 village kit pieces | static |
| `downtown` | 153 city kit pieces and 3 whole buildings | static |
| `custom` | Characters made for C.E.O. (Meshy AI): the Gestral. Originals in `custom/_source/` | Mixamo skeleton |

## Rebuilding

The originals (FBX, OBJ, Blender and full-size textures) are not in this repo. To rebuild the library from them:
1. Run `scripts/fetch-assets.sh` from the C.E.O. repo to download the originals.
2. Run `scripts/index.mjs` to index them.
3. Run `scripts/catalog.mjs` to build the catalog.
4. Run `scripts/optimize.mjs` to write the GLBs.

These scripts need `@gltf-transform/{core,functions,extensions}`, `meshoptimizer` and `sharp`.

## License

Everything outside `custom/` is by [Quaternius](https://quaternius.com) and released under CC0 1.0 (public domain). `custom/` holds models made for this project.
