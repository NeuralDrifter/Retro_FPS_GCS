# High-Level Technical Design Document: GridForge UI Menu System

This document outlines the architecture, serialization schema, runtime state machine, and phased development plan for integrating **The Main Menu Studio (Out-of-Game UI)** and **The In-Game Menu Builder (Overlay UI)** into the **GridForge 3D Game Creation System**.

---

## 1. Architectural Overview & Stack Integration

GridForge operates with a strict boundary between the **Editor IDE (`src/components/*`, `src/engine/*` — React + TypeScript)** and the **Standalone Runtime (`src/runtime/*` — Pure Three.js + Vanilla DOM)**. Any menu system designed in the editor must render identically inside:
1. The **Editor Canvas Preview** (`MenuStudioWorkspace`).
2. The **In-Editor Test Play Mode** (`Viewport3D.tsx` -> `startGame.ts`).
3. **Exported Standalone Builds** (`singleHtmlExporter.ts` and `projectExporter.ts`), which run with zero React dependencies.

### Core Architectural Principle: Dual-Host Menu Renderer
To guarantee 1:1 visual parity between the drag-and-drop Menu Studio and exported standalone games without duplicating styling logic:
* **Pure Runtime Menu Renderer (`src/runtime/menu/MenuDOMRenderer.ts`)**: A zero-dependency Vanilla DOM/CSS renderer (following the same pattern as `CombatHUDController` in `src/runtime/hud/CombatHUD.ts`) that takes a `MenuScreenSpec` JSON object and mounts/updates interactive DOM nodes inside a normalized aspect-ratio container (`16:9` virtual reference canvas).
* **Editor WYSIWYG Canvas (`src/components/menuStudio/MenuCanvasEditor.tsx`)**: Wraps the runtime DOM representation with an interactive React authoring layer (selection gizmos, resize handles, snap guides, drag-and-drop hit targets) so what the creator drags in the studio is pixel-identical to what runs in `startGame.ts`.

---

## 2. Component 1: The Main Menu Studio (Out-of-Game UI)

### 2.1 IDE Workspace Integration & User Flow
* **Workspace Modes**: `'edit'` (2D/3D Level Editor) | `'menu-studio'` (UI Menu Studio) | `'play'` (Test Play).
* When `'menu-studio'` is active, the IDE shell preserves the 4-pane desktop engine layout:
  * **Left Dock (`MenuWidgetPalette.tsx`)**: Draggable UI primitives (`Button`, `Title / Text`, `Image / Logo`, `Panel / Frame`, `Stat Readout`, `Inventory Grid`, `Slider Setting`, `Toggle Setting`, `Save Slot List`) and starter templates (*GridForge Tactical*, *Retro Shareware Doom*, *Minimalist Cyber*).
  * **Center Workspace (`MenuCanvasEditor.tsx`)**: A 16:9 virtual stage (`1280×720` logical coordinate space, percentage-anchored) with live background rendering, grid/center snap lines, resize handles, and a **Top Screen Tab Bar** to switch between Out-of-Game screens (`Main Menu`, `Options`, `Credits`) and In-Game overlays (`Pause Menu`, `Inventory / Status Hub`), plus a live interactive Preview toggle.
  * **Right Dock (`MenuInspector.tsx`)**: Context-sensitive inspector tabs:
    * **Screen & Background Tab**: Configure static artwork, scrolling texture shaders, or live 3D camera dioramas, plus overlay pause/dim settings.
    * **Widget Style & Layout Tab**: Edit X/Y/Width/Height, anchor presets, button shapes, 9-slice or tiled textures, typography, and state styles (`default`, `hover`, `active`).
    * **Actions & Data Binding Tab**: Bind click events to engine commands (`MenuAction`), or bind dynamic widgets to simulation stats/variables and settings.

### 2.2 Background Asset Customization
The Main Menu Studio supports three background modes per screen:
1. **Static / Scrolling Image (`type: 'image'`)**: Uses any texture from `AssetRegistry` with fit modes (`cover`, `contain`, `tile`, `scroll`), tint color, and vignette/scanline retro post-processing overlays.
2. **Live 3D Level Diorama (`type: '3d-scene'`)**: Renders an actual campaign level in the background using `WorldBuilder` and `Skybox` while the menu DOM floats above it (`cameraMode: 'orbit' | 'fixed'`, configurable orbit radius/speed and target coordinates).
3. **Solid / Gradient Backdrop (`type: 'solid'`)**: Clean CSS radial/linear gradient + optional animated cyber grid.

### 2.3 State Management: Transitioning from Main Menu to Active Game Loop
A top-level **Runtime Application Finite State Machine (`RuntimeAppState`)** inside `startGame.ts` governs transitions between:
* `MAIN_MENU`: Pointer unlocked, 3D Diorama or Image background active, `CombatHUD` & `MinimapHUD` hidden, simulation physics paused.
* `ACTIVE_GAMEPLAY`: 35 Hz deterministic simulation tick running, pointer locked, `CombatHUD` & `MinimapHUD` visible.
* `IN_GAME_OVERLAY`: Simulation tick frozen (when `pauseSimulation: true`), pointer unlocked, active overlay (`Pause`, `Inventory`, `Options`, `Save/Load`) mounted over dimmed/blurred 3D viewport.

---

## 3. Component 2: The In-Game Menu Builder (Overlay UI)

### 3.1 Overlay Mechanics (Pausing, Dimming & Pointer Lock Handshake)
* **Simulation Freeze vs. Live Background**: Each overlay screen defines `pauseSimulation: boolean`. When `true`, `startGame.ts` pauses the fixed-timestep accumulator so deterministic simulation ticks (`step()`), enemy AI, and timers freeze cleanly while Three.js continues rendering the paused 3D scene behind the backdrop.
* **Visual Dimming & Backdrop Filter**: Configurable `dimOpacity`, `dimColorHex`, `backdropBlurPx`, and `scanlineEffect`.
* **Pointer Lock & Hotkey Lifecycle**: Pressing `ESC` (or configured overlay hotkeys like `Tab` / `I` / `P`) exits Pointer Lock and mounts the corresponding In-Game Overlay. Clicking a `RESUME_GAME` button unmounts the overlay and re-engages `controls.lock()` directly inside the user gesture handler.

### 3.2 Contextual In-Game Elements & Action Dispatcher
* **Dynamic Widgets**:
  * `stat-readout`: Live binding to `health`, `ammo`, `kills`, `secrets`, `level-title`, `time`, or custom `SimulationState` flags/counters (`sim-flag`, `sim-counter`).
  * `inventory-grid`: Displays collected keycards, weapons, and active status flags.
  * `slider-setting` & `toggle-setting`: Real-time controls for `masterVolume`, `mouseSensitivity`, `fov`, `minimapEnabled`, and `invertY`.
  * `save-slot-list`: Interactive 3-slot persistent save/load manager backed by `localStorage`.
* **Declarative MenuAction Dispatcher**:
  * `START_NEW_GAME`, `RESUME_GAME`, `OPEN_MENU_SCREEN`, `BACK_MENU_SCREEN`, `RESTART_CURRENT_LEVEL`, `SAVE_GAME_SLOT`, `LOAD_GAME_SLOT`, `FIRE_SIM_EVENT`, `QUIT_TO_MAIN_MENU`.

---

## 4. Phased Implementation Checklist

- [x] **Phase 0**: Save Technical Design Document to `/docs/ui-menu-system-plan.md`.
- [x] **Phase 1**: Core Data Contracts (`src/runtime/menu/types.ts`), Starter Presets (`src/runtime/menu/presets.ts`), and Serialization/Bundler Bridge (`CampaignSettings`, `GameManifest`, `assetBundler.ts`, `LevelSerializer.ts`).
- [x] **Phase 2**: Pure Runtime Menu DOM Renderer (`src/runtime/menu/MenuDOMRenderer.ts`) and Runtime FSM & Action Controller (`src/runtime/menu/MenuRuntimeController.ts` integrated into `src/runtime/startGame.ts` and `Viewport3D.tsx`).
- [x] **Phase 3**: Main Menu Studio & In-Game Menu Builder IDE (`src/components/menuStudio/MenuStudioWorkspace.tsx`, `MenuCanvasEditor.tsx`, `MenuWidgetPalette.tsx`, `MenuInspector.tsx`, and `TopMenuBar.tsx` integration).
- [x] **Phase 4**: Unit/Integration Tests (`src/engine/__tests__/menuSystem.test.ts`), Single HTML Runtime Bundle rebuild, and build/lint verification.
