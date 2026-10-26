# GridForge 3D External Assets Folder Guide

You do **not** need to bake textures or 3D `.glb` models into the TypeScript source code. GridForge 3D supports two ways to load assets directly from folders:

---

## Option A: Zero-Config Auto-Discovery (`/src/assets/`)
Drop files directly into these two folders and Vite will automatically discover and add them to the **Inspector → Asset Library** tab on startup:
- **`/src/assets/textures/`** — Drop any `.png`, `.jpg`, `.jpeg`, `.webp`, `.gif`, or `.svg` image here. Subfolders become texture folders in the Asset Library's folder list, e.g. `textures/Horror/Brick/brick_01.webp` → **Horror › Brick**. Keep each pack's license file in its folder.
- **`/src/assets/models/`** — Drop any `.glb` or `.gltf` 3D model here. Subfolders organize the **Model Library**:
  - `models/<category>/...` puts the model in that category: `characters`, `decorations`, `items`, `buildings` or `vehicles`. Deeper folders become library folders inside it, e.g. `models/vehicles/cars/truck.glb` → **Vehicles › cars**.
  - Any other top-level folder becomes a custom library folder in **Decorations**, e.g. `models/props/lamps/lamp.glb`.
  - Files directly in `models/` keep the old naming rule: a `prop_`, `prop-`, `crate_` or `static_` prefix (e.g. `prop_pillar.glb`) makes a **Decoration**, anything else (e.g. `zombie_guard.glb`) an **Enemy AI** character.
  - Characters use enemy AI and are scaled to character height. Every other category keeps the model's real size (1 grid cell = 4 m).

---

## Option B: Static Public Assets Folder (`/public/assets/`)
For large `.glb` models or textures you want served as raw static files over HTTP (`/assets/...`) without bundling:
1. Place texture images in **`/public/assets/textures/`**
2. Place 3D `.glb` / `.gltf` files in **`/public/assets/models/`**
3. List them in **`/public/assets/manifest.json`**:

```json
{
  "textures": [
    {
      "id": "dungeon-wall",
      "name": "Dungeon Stone Wall",
      "file": "/assets/textures/dungeon_wall.png"
    }
  ],
  "models": [
    {
      "id": "mech-boss",
      "name": "Heavy Mech Boss (.glb)",
      "file": "/assets/models/mech_boss.glb",
      "category": "characters",
      "isEnemy": true,
      "defaultHealth": 150,
      "moveSpeed": 4.2,
      "attackDamage": 20
    },
    {
      "id": "market-stall",
      "name": "Market Stall",
      "file": "/assets/models/market_stall.glb",
      "category": "buildings",
      "folder": "town/shops",
      "tags": ["wood", "town"]
    }
  ]
}
```

Optional model fields: `category` (default `characters`, or `decorations` when `isEnemy` is `false`), `folder` (slash path of a library folder inside the category) and `tags`. Combat stats only apply to `characters`.
