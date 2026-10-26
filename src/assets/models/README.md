# 3D Models

Drop `.glb` or `.gltf` models in here and the Asset Library finds them automatically.

- `<category>/<folders>/model.glb` puts the model in that category (`characters`,
  `decorations`, `items`, `buildings` or `vehicles`), and the deeper folders become
  library folders, e.g. `decorations/Dungeon/Barrel.glb` → **Decorations › Dungeon**.
- Files directly in this folder use the old rule: a `prop_` prefix makes a decoration,
  anything else an enemy character.
- `model-sizes.json` lists each shipped model's real width and depth in meters, so the
  editor knows its footprint without loading it. Models missing from it are measured the
  first time they are used.

## Included models (all CC0 / public domain)

The models were converted to `.glb` with only their color textures, shrunk to 512 px or
less, so they stay small and use little video memory. Some packs were rescaled so that
1 unit is 1 meter. The original license texts are in `licenses/`.

| Folders | Source | Author |
|---|---|---|
| RPG Characters, Mechs, Sci-Fi Essentials, Sci-Fi MegaKit, Pirate, Fantasy Props, Survival, Guns, RPG Items, Spaceships, Dungeon, Modular Sci-Fi, Town | Quaternius packs: RPG Characters, Animated Mech Pack, Sci-Fi Essentials Kit, Modular SciFi MegaKit, Pirate Pack, Fantasy Props MegaKit, Survival Pack, Ultimate Gun Pack, Ultimate RPG Items, Ultimate Spaceships, Modular Dungeon, Ultimate Modular Sci-Fi, Ultimate Textured Buildings (https://quaternius.com). The MegaKits and the Sci-Fi Essentials Kit are the free Standard editions. | Quaternius |
| characters/DeadProject | 3rd person blender sci-fi pack (https://opengameart.org/content/3rd-person-blender-sci-fi-pack) | JohnnyBlack |
| characters/Monsters: Fatty | https://opengameart.org/content/fatty | Drummyfish |
| characters/Monsters: Dragon | Cethiel's Dragon 3D (https://opengameart.org/content/cethiels-dragon-3d) | Drummyfish, after Cethiel |
| characters/Monsters: Zombie | Mobile Ready Zombie (https://opengameart.org/content/mobile-ready-zombie) | Lucian Pavel |
| characters/Monsters: Glutton Demon | https://opengameart.org/content/glutton-demon | Teh_Bucket (FreeDoom), concept by RayMooHawk |
| characters/Monsters: Mutant Grunt | https://opengameart.org/content/mutant-grunt | laleksic |
| characters/Monsters: Undead Squirrel | Kelgar project (www.kelgar.org) | Čestmír Dammer |
| characters/Robots: BA-2, SENTRY-2 | Quandtum's BA-2 and SENTRY-2 on OpenGameArt | Quandtum |
| characters/Humans: Grapple Girl | https://opengameart.org/content/grapple-girl | Quandtum |
| characters/Robots: Golem Robot | Low Poly Robot (Golem) (https://opengameart.org/content/low-poly-robot-golem-with-hand-painted-texture) | DevMops |
| characters/Robots: Turret | Turret on OpenGameArt | PolygonDan |
| items/Hand-Painted Weapons | Cethiel's Weapons 3D (https://opengameart.org/content/cethiels-weapons-3d) | Drummyfish, after Cethiel |
| decorations/Torches | Fantasy torch pack 1 and 2 (https://opengameart.org/content/fantasy-torch-pack-1) | rubberduck |
| decorations/Mine | Free mine assets pack (https://opengameart.org/content/free-mine-assets-pack) | rubberduck |
| decorations/Props: Skull | Skull prop (https://opengameart.org/content/skull-prop) | piacenti |
