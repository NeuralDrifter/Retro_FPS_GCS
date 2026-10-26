# 3D Models

Drop `.glb` or `.gltf` models in here and the Asset Library finds them automatically.

- `<category>/<folders>/model.glb` puts the model in that category (`characters`,
  `decorations`, `items`, `buildings` or `vehicles`), and the deeper folders become
  library folders, e.g. `decorations/Dungeon/Barrel.glb` → **Decorations › Dungeon**.
- Files directly in this folder use the old rule: a `prop_` prefix makes a decoration,
  anything else an enemy character.
- An optional `model-sizes.json` here lists models' real width and depth in meters
  (`{"decorations/Dungeon/Barrel.glb": {"width": 1.04, "depth": 1.03}}`), so the editor
  knows their footprint without loading them. Models missing from it are measured the
  first time they are used.

The project's CC0 model collection (608 models with `model-sizes.json`, license texts and
credits) is kept outside the repository to keep the AI Studio project small. Copying its
`models/` folder here restores it.
