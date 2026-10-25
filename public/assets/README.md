# GridForge 3D External Assets Folder Guide

You do **not** need to bake textures or 3D `.glb` models into the TypeScript source code. GridForge 3D supports two ways to load assets directly from folders:

---

## Option A: Zero-Config Auto-Discovery (`/src/assets/`)
Drop files directly into these two folders and Vite will automatically discover and add them to the **Inspector → Asset Library** tab on startup:
- **`/src/assets/textures/`** — Drop any `.png`, `.jpg`, `.jpeg`, `.webp`, `.gif`, or `.svg` image here.
- **`/src/assets/models/`** — Drop any `.glb` or `.gltf` 3D model here.
  - Tip: Name a file with `prop_` or `crate_` (e.g. `prop_pillar.glb`) to auto-classify it as a **Static Prop**, or anything else (e.g. `zombie_guard.glb`) to auto-classify it as an **Enemy AI** character.

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
      "isEnemy": true,
      "defaultHealth": 150,
      "moveSpeed": 4.2,
      "attackDamage": 20
    }
  ]
}
```
