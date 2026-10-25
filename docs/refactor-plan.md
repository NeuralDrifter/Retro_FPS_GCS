# Refactor Plan: Pie3D Game Creation System
Status: phase 5 of 5 (Complete) | Started: 2026-10-25

## 1. Responsibility Map & Code Smell Audit (Phase 1)
- **`src/components/AssetPanel.tsx` (lines 1–397)** — Smell: `dead-code`
  - Legacy Phase 2 component superseded by the Inspector's Asset Library tab; zero callers across the codebase.
- **`src/components/PropertiesInspector.tsx` (lines 1–1366)** — Smells: `god-module`, `long-function`, `duplication`
  - lines 89–276: Isometric 3D wireframe SVG thumbnail renderer (`Model3DThumbnailSvg`).
  - lines 358–492: FileReader / ObjectURL upload builders and drag-start handlers for 2D textures and 3D `.glb` assets.
  - lines 540–873: `Inspector` tab (Cell transform, Block Type, Surface UV materials, Placed `.glb` Entity & Enemy AI stats).
  - lines 875–1267: `Asset Library` tab (2D Texture draggable grid + dropzone, 3D `.glb` Model draggable grid + dropzone).
  - lines 1269–1361: `World` tab (Skybox theme selector, procedural seed generator, ceiling/minimap/perimeter actions).
- **`src/App.tsx` (lines 1–1389)** — Smells: `god-module`, `long-function`, `mixed-abstraction`
  - lines 860–945: Tool palette metadata and Top Menu Bar chrome (`TopMenuBar`).
  - lines 1070–1155: Left vertical 40px SVG Tool Palette + Undo/Redo toolbar (`LeftToolPalette`).
  - lines 1310–1380: Bottom 24px Status Bar with Engine Log, History depth, Wall/Entity counts, and Coordinate readout (`BottomStatusBar`).

## 2. Safety Net (Phase 2)
- Build: `npm run build` (`vite build`)
- Typecheck / Lint: `npm run lint` (`tsc --noEmit`)
- Characterization Tests: `npm test` (`tsx --test src/engine/__tests__/engine.test.ts`)
  - Pins `CollisionSystem` coordinate math (`gridToWorld` / `worldToGrid` round-trip, AABB wall & closed/open door collision, entity sliding collision).
  - Pins `HistoryManager` deep-cloning (`cloneSnapshot`) and structural equality (`areSnapshotsEqual`) across `grid`, `wallTextures`, `floorTextures`, `ceilingTextures`, `entities`, and `spawn`.
  - Pins `LevelSerializer` JSON round-trip (`serializeLevel` -> `parseLevelJson`) and schema validation error handling.

## 3. Target Structure (Phase 3)
```
src/
  types/engine.ts                     — Domain types, constants, and presets (depends on nothing)
  engine/                             — Pure engine domain & Three.js systems (depends on types)
    CollisionSystem.ts
    HistoryManager.ts
    LevelSerializer.ts
    AssetFolderLoader.ts
    TextureGenerator.ts
    EntityLoader.ts
    EnemyAISystem.ts
    CombatSystem.ts
    WorldBuilder.ts
  components/                         — UI Delivery layer (depends on engine & types)
    ide/
      TopMenuBar.tsx                  — 28px top IDE menu bar (File, Undo/Redo, Scene Presets, Play View)
      LeftToolPalette.tsx             — 40px vertical tool palette & quick Undo/Redo buttons
      BottomStatusBar.tsx             — 24px bottom engine log, history depth, and coordinate readout
    inspector/
      Model3DThumbnailSvg.tsx         — Isometric 3D wireframe SVG preview for .glb asset cards
      CellInspectorTab.tsx            — Selected [X, Z] cell, surface UV materials & placed entity editor
      AssetLibraryTab.tsx             — Draggable 2D texture & 3D .glb model library + file/URL dropzones
      WorldSettingsTab.tsx            — Skybox atmosphere themes, seed generator & level geometry toggles
    PropertiesInspector.tsx           — Thin tab coordinator for the right-hand 280px Inspector dock
    MapEditor2D.tsx                   — 2D orthographic 10x10 grid editor with drag-and-drop cell targets
    Viewport3D.tsx                    — 3D perspective Three.js viewport & combat loop
    CombatHUD.tsx                     — Retro first-person health/ammo/crosshair overlay
    MinimapHUD.tsx                    — In-game 2D radar overlay
    ArchitectureModal.tsx             — Architecture & JSON state viewer modal
  App.tsx                             — Composition root & state/history coordinator
```
Dependency rule: `App -> components -> engine -> types -> (nothing)`.

## 4. Move Checklist (Phase 4)
- [x] `delete-dead-code`: Remove unused `src/components/AssetPanel.tsx`
- [x] `extract-leaf-module`: Extract `Model3DThumbnailSvg` -> `src/components/inspector/Model3DThumbnailSvg.tsx`
- [x] `extract-module`: Extract `CellInspectorTab` -> `src/components/inspector/CellInspectorTab.tsx`
- [x] `extract-module`: Extract `AssetLibraryTab` -> `src/components/inspector/AssetLibraryTab.tsx`
- [x] `extract-module`: Extract `WorldSettingsTab` -> `src/components/inspector/WorldSettingsTab.tsx`
- [x] `thin-facade`: Slim `src/components/PropertiesInspector.tsx` to a clean tab container
- [x] `extract-module`: Extract `TopMenuBar`, `LeftToolPalette`, and `BottomStatusBar` -> `src/components/ide/*`
- [x] `thin-entry-point`: Update `src/App.tsx` to compose the extracted IDE bars and inspector

## 5. Decisions & Discoveries
- 2026-10-25: Fixed React `setState-in-render` issue where `Viewport3D` invoked `onEngineLogRef.current` inside `setCombatState`'s functional updater and `App` invoked nested `setState` calls inside `setGrid` and `setPastHistory`/`setFutureHistory`.
- 2026-10-25: Preserved exact JSON wire format (`version: '2.0-pie3d'`) in `LevelSerializer` so exported level files remain 100% backward-compatible.

## 6. Deferred — Hand Off to Next Campaign
- [ ] Decompose `src/components/Viewport3D.tsx` WebGL setup vs. keyboard/mouse input controller hook (`useFirstPersonInput`) — kept together in this campaign to avoid disturbing the WebGL pointer-lock lifecycle — owned by `refactor-monolith`.
