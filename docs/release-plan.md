# Retro FPS GCS: Audit and Release Plan

Prepared 2026-11-12 against commit `cf7bd9e` on `main`. That commit was `a5f61d2` until the history rewrites of 2026-11-13 (P0.1, Q1) changed every hash. It covers two products: the GCS editor (React, Tailwind and Three.js, hosted on GitHub Pages) and the web games the editor exports.

## How to use this document

- Each task is sized for one directed session with an AI coding agent. A session reads this file, its task row, and the files the row lists. It ends when the acceptance criteria pass and the verification has been run.
- Task IDs (`P3.4`) are stable. Put them in branch names and commit messages, for example `feat(export): one-click export UX (P3.4)`.
- Release criteria IDs (`E-07`, `G-12`, `M-03`, `S-05`) are defined in Step 2. A criterion counts as met only when its test passes.
- Audit labels: **Confirmed** means I read the code and traced the path. **Likely** means the pattern is present but I did not exercise it at runtime. **Needs verification** means the answer depends on something I could not read or run.
- Appendix C is a checkbox tracker for every task.

## Decisions and open questions

These could not be settled from the code. The plan proceeds on the stated assumption. Changing an assumption changes only the tasks listed.

| ID | Question | Assumption used in this plan | Tasks affected |
|---|---|---|---|
| Q1 | `public/assets/aistudio/` is committed and deployed to the public Pages site. It holds three skill files (`clean-code`, `refactor-legacy`, `refactor-monolith`), a report that names you and describes your machine, a development log, plans and screenshots. Remove it, and also purge it from git history? | Remove from the tree in P0.1 and add the path to `.git/info/exclude`. A scan found no keys, tokens, email addresses or local paths, so the history purge is optional. | P0.1 |
| Q2 | License for the GCS itself | MIT for editor and runtime, copyright Michael P. Burgus and contributors | P0.7, P3.5, P8.2 |
| Q3 | Product name. The repo says "Retro_FPS_GCS", the UI says "GridForge 3D", `metadata.json` says "Pie3D", and the runtime calls itself "ForgeCore" | Pick one name before Phase 8. This plan says "the GCS". | P8.2, P8.6 |
| Q4 | Every pack in the assets repo is CC0, including Quandtum BA-2, PolygonDan Turret, Undead Squirrel and Quaternius MegaKit | Yes, as you stated. P8.2 records a per-pack check against each license file. | P2.7, P3.5, P8.2 |
| Q5 | Size of the assets repo (a GitHub Pages site is capped at 1 GB) | Under 1 GB, so it can publish to its own Pages site | P2.7 |
| Q6 | Do any library models use Draco compression? | Some might. Keep a local decoder and ship it only when an export needs it. | P0.5, P3.2 |
| Q7 | Keep the single-HTML export? | Decided 2026-11-12: keep it as an optional single-player format next to the default zip. P3.9 moves it onto the new pipeline, which fixes its three current bugs (campaign levels dropped, no Draco decoder, absolute fetch path). | P3.9 |
| Q8 | Keep "import texture or model from any URL"? | Remove it. Creators download the file and upload it. | P2.6 |
| Q9 | Keep "load assets from my own GitHub repo"? | Keep it, restricted to GitHub hosts. Export requires license metadata for those assets. | P2.7, P7.1 |
| Q10 | Multiplayer modes and size | Co-op for 2 to 4 players and deathmatch for 2 to 8. Hard cap of 8 in v1. | P9, P10 |
| Q11 | Who runs multiplayer servers | Creators. You run none. A public demo server is optional and is flagged as a cost. | P10.7 |
| Q12 | Mobile and touch | Desktop only for v1. Exported games show a message on touch-only devices. | P5.4 |
| Q13 | Heaviest level the performance targets must hold for | 64x64 cells, 64 enemies, 300 static models. The validator allows more, so that is not the target. | Step 2 |
| Q14 | Editor fonts | System font stack: no network request and no font license to ship | P0.5 |
| Q15 | When the Pages editor updates | On version tags, not on every push to `main` | P8.1 |

---

## Step 1: Audit

### 1.1 Snapshot

| Measure | Value | How measured |
|---|---|---|
| Tracked files | 144 | `git ls-files` |
| TypeScript source | 36,605 lines: runtime, sim and HUD 21,058; editor about 15,540 | `wc -l` excluding tests |
| Tests | 174 passing in 21 suites, 5.3 s, 6,096 lines | `npm test` (`tsx --test`, Node's runner) |
| Typecheck | 0 errors | `npx tsc --noEmit`, TypeScript 7.0.2 |
| Editor build | One JS chunk of 2,353 KB (607 KB gzip), 41 KB CSS, plus duplicate Draco decoders (two `.wasm`, one 719 KB `.js`) | `vite build --base=/Retro_FPS_GCS/` into a scratch folder |
| Prebuilt runtime | `public/single-html-runtime.js`: 940 KB minified, 250 KB gzip, includes three.js | `gzip -9 \| wc -c` |
| Production dependency tree | 155 packages | Walk of `node_modules` from `package.json` |
| Node | 24.14.0 locally, 22 in CI | `node --version`, `deploy.yml` |
| Lockfile | `bun.lock` only, while scripts and CI use npm | Repo root |

### 1.2 Architecture as it exists

#### Modules

| Area | Main files | Role | Imports from |
|---|---|---|---|
| Editor shell | `src/App.tsx` (2,450 lines, 46 `useState`, 52 `useCallback`, 19 `useMemo`), `src/main.tsx` | Owns all document and UI state and wires every panel | Everything below |
| Editor hooks | `src/hooks/useCampaignManager.ts`, `useEditorHistory.ts`, `useLayerManager.ts`, `useLevelPersistence.ts` | Extracted from App during the monolith refactor. They take App's setters as props. | runtime, engine, types |
| Editor panels | `src/components/MapEditor2D.tsx` (canvas 2D grid), `Viewport3D.tsx` (playtest), `EditorViewport3D.tsx` (3D editor), `EventTriggerEditorModal.tsx`, `PropertiesInspector.tsx`, `inspector/*`, `ide/*` | UI | runtime, engine, types, lucide-react |
| 3D editor scene | `src/editor3d/EditorScene.ts` (852 lines) | Its own WebGLRenderer, camera, gizmo and render loop | runtime |
| Editor services | `src/engine/AssetFolderLoader.ts`, `gitHubAssets.ts`, `bundledGitHubAssetsIndex.json` (138 KB), `textureLibrary.ts`, `modelLibrary/*`, `HistoryManager.ts`, `LevelSerializer.ts` | Asset discovery, library state, undo snapshots, file download | runtime, types |
| Export | `src/engine/export/projectExporter.ts`, `singleHtmlExporter.ts`, `singleHtmlRuntimeBuild.ts`, `safetyScanner.ts` | Two export formats | runtime, jszip, esbuild (Node only) |
| Game runtime | `src/runtime/startGame.ts` (2,163 lines, one closure), `WorldBuilder.ts`, `EnemyAISystem.ts`, `CombatSystem.ts`, `EntityLoader.ts`, `TextureGenerator.ts`, `SoundEffects.ts`, `hud/*` | Three.js rendering, input, the Three.js-side AI and combat, HUD | three, sim |
| Deterministic sim | `src/runtime/sim/*` (executor, actionExecutor, moverSim, entitySim, raycast, vertical, validator 2,938 lines, hash, rng, trigTable) | Integer-only fixed-step simulation (30 Hz), level validation, state hashing | `runtime/AssetRegistry.ts` (one edge, no Three.js) |
| Runtime authoring helpers | `src/runtime/assetBundler.ts`, `manifest.ts`, `LevelSerializer.ts` | Asset collection for export, manifest creation, v1/v2 migrations. They sit in the runtime folder but are authoring-time code. | sim |

The runtime imports no React, no lucide and no editor module. The sim has no Three.js or DOM dependency, and the tests run it in Node. Measured import graph: Appendix B.

#### Data flow

1. **Editing.** App holds the level as separate states (`grid`, `wallTextures`, `floorTextures`, `ceilingTextures`, `vertical`, `entities`, `spawn`, skybox, title) plus `simState`, which carries events, regions and variables. Campaign levels are held as `LevelStateData[]` in `campaignLevels`.
2. **Serialization.** There are three overlapping representations. `LevelStateData` is the editor save format (`version: '2.0'`, `formatVersion: 3`). `LevelDataV3` is the sim input. `GameManifest` (`schemaVersion: 1`) is the export container. App and its hooks convert between them in at least six places (`App.tsx:1594`, `App.tsx:2069-2091`, `App.tsx:2260-2280`, `Viewport3D.tsx:132-152`, `useLevelPersistence.ts:155-171`, `useLevelPersistence.ts:252-271`).
3. **Playtest.** `Viewport3D` mounts `startGame()` once and keeps callbacks in refs (`Viewport3D.tsx:127-181`). Later prop changes go through effects into `syncEditorLevel()`, which rebuilds the whole 3D world (`startGame.ts:2029-2151`). Runtime events flow back up: `onPlayerMove` feeds `setPlayerTransform` and `onSimStateChange` feeds `setSimState` (`App.tsx:2312-2315`).
4. **3D editing.** `EditorViewport3D` owns an `EditorScene`. `setLevel()` builds a change key with `JSON.stringify` over the whole level and rebuilds every mesh when it changes (`EditorScene.ts:187-221`).
5. **Saving.** "Save JSON" downloads `LevelStateData` with all campaign levels nested (`useLevelPersistence.ts:302-361`, `engine/LevelSerializer.ts:22-38`). "Load JSON" reads the file, migrates v1, v2 or v3 to `LevelDataV3`, validates it, and restores (`useLevelPersistence.ts:363-383`, `runtime/LevelSerializer.ts:314-673, 850-882`). There is no autosave and no project storage in the browser. Uploaded models live only in IndexedDB (`engine/modelLibrary/uploadStore.ts`). Uploaded textures are base64 data URLs inside the JSON.
6. **Export.** `ExportModal` builds a `GameManifest` with `createGameManifest`, then calls `downloadProjectZip` or `downloadSingleHtml` (`ExportModal.tsx:110-147`). Both run `bundleLevelAssets` to fetch or decode every referenced asset (`assetBundler.ts:680-820`). Section 1.4 covers this.
7. **Asset resolution.** IDs, never URLs, are stored in levels. `AssetRegistry` is a global static map from ID to `TextureAsset` or `Model3DAsset`, with IDs restricted to `^[a-z0-9_-]+$` (`runtime/AssetRegistry.ts:47, 77-103`). Sources are:
   - built-in procedural textures and models (`assetBundler.ts:35-61`)
   - a baked index of `NeuralDrifter/Retro_FPS_GCS-assets@main` (1,077 `.webp` textures, 608 `.glb` models, 16 license files) loaded from `raw.githubusercontent.com` (`AssetFolderLoader.ts:89-104`, `gitHubAssets.ts:117-131`)
   - files dropped into `src/assets/` (Vite glob)
   - `public/assets/manifest.json`
   - uploads (data URLs for textures, IndexedDB blobs for models)
   - any URL a creator pastes
   - any GitHub repo a creator names, listed through `api.github.com` with `data.jsdelivr.com` as fallback (`AssetFolderLoader.ts:289-435`)

#### How React state and the Three.js scenes interact

- **The good part.** Neither renderer runs inside React's render cycle. Each owns a `requestAnimationFrame` loop. React only calls imperative methods from effects.
- **Problem 1: about 20 re-renders a second during play.** `onPlayerMove` fires up to 20 times a second while the player moves (`startGame.ts:1848-1883`). App stores the transform in state, so the whole editor tree re-renders at that rate during playtest. `MapEditor2D` is not memoized. This main-thread work competes with the WebGL frame. **Confirmed.**
- **Problem 2: world rebuilds mid-play.** `cloneSimulationState` deep-copies `events` every tick (`executor.ts:200-206`). The chain from there:
  1. Each `onSimStateChange` (door, key, message) hands App a new `simState.events` array.
  2. That gives `buildActiveSingleLevelState` a new identity (`App.tsx:1365-1430`), then `getSyncedCampaignLevels`, then `campaignLevelsV3` (`App.tsx:2069-2091`).
  3. The new `campaignLevels` prop fires Viewport3D's sync effect (`Viewport3D.tsx:213-247`), which calls `rebuild3DWorld()`.

  Opening a door during playtest therefore rebuilds the world, which should snap enemies back to their placed positions. **Likely** (traced statically; confirm with a rebuild counter).
- **Problem 3: double WebGL contexts.** Switching between Edit and Test Play unmounts one renderer and mounts another. Neither calls `forceContextLoss()`. **Confirmed** (section 1.10).

### 1.3 What works, what is partial, what is missing

| Feature | State | Evidence |
|---|---|---|
| Deterministic integer sim with replay hashing | Works | `runtime/sim/*`; 3,000-tick replays in `engine/__tests__/determinism.test.ts`; 174 tests pass |
| Level validation (schema allowlist, forbidden keys, caps on events, entities, movers, flags, grid 128, layers 8) | Works | `runtime/sim/validator.ts:64-78, 511-560, 761-772, 1079-1277` |
| 2D grid editor (canvas, zoom, pan, textures, entities) | Works | `components/MapEditor2D.tsx:349-541` |
| 3D editor (gizmos, layers, model placement, fly camera) | Works | `editor3d/EditorScene.ts`, `components/EditorViewport3D.tsx` |
| Vertical levels (layers, slopes, lifts, holes) and classic flat mode | Works | `runtime/sim/vertical.ts`, `verticalMovement.ts`, `runtime/LayeredSurfaces.ts`, `vertical.test.ts` |
| Event system: 4 trigger kinds, 12 condition kinds, about 60 action kinds, visual editor | Works | `runtime/sim/types.ts`, `actionExecutor.ts`, `components/EventTriggerEditorModal.tsx` |
| Multi-level campaign with health and ammo carry-over | Works in editor and runtime | `hooks/useCampaignManager.ts`, `startGame.ts:776-932` |
| Model library (folders, tags, footprints, content-hash upload IDs) | Works | `engine/modelLibrary/*`, `modelLibrary.test.ts` |
| Playtest inside the editor | Works, with the rebuild and re-render problems above | `components/Viewport3D.tsx` |
| Undo and redo | Partial. Covers grid, textures, entities, spawn and layers. Misses events, regions, variables, world and skybox settings, title, campaign operations and imported textures. The trigger editor records a history entry (`useLevelPersistence.ts:251`), but undoing it does not restore the events. | `engine/HistoryManager.ts:21-30` |
| Save and load | Partial. Manual JSON download only, with no autosave or recovery. Uploaded models are not in the file, so a project moved to another browser shows stand-ins. Cell tags are not serialized (`runtime/LevelSerializer.ts:678-739`) and the trigger editor zeroes them (`useLevelPersistence.ts:266`). | as cited |
| Enemy setup | Partial. Per-model defaults and per-instance fields exist (`sim/types.ts:575-578`, `EntityLoader.ts:194-204`). Exported models are registered as non-enemies (`startGame.ts:321-338`), so enemy behavior in exports depends on the editor writing per-instance fields. **Needs verification** with an export parity test. | as cited |
| Weapons | Stub. One hardcoded weapon (`runtime/types.ts:511-512`). Pressing R adds 24 ammo from nothing (`startGame.ts:622-634`). | as cited |
| Combat and enemy AI | Works in live play, but outside the deterministic sim. Three.js raycasts decide hits (`CombatSystem.ts`). `EnemyAISystem` moves enemies and copies their positions into the sim each tick (`startGame.ts:943-973`). Player collision is patched after `step()` (`startGame.ts:1090-1144`). The sim's own AI (`entitySim.ts:233-310`) runs only in replays. | as cited |
| Audio | Partial. Procedural oscillator SFX only, with no volume control and no music. | `runtime/SoundEffects.ts` |
| Exported game shell | Missing: main menu, pause, settings, save data, fullscreen, gamepad, key rebinding, WebGL context-loss handling. Present: click-to-play overlay, death and level-complete modals, tab-hidden pause of the sim. | `startGame.ts:1484-1495`, `hud/CombatHUD.ts` |
| Editor error handling | Missing. No error boundary and no global error handler, so a render exception blanks the editor, and with no autosave the work is lost. | grep for `ErrorBoundary`, `componentDidCatch`, `unhandledrejection`: none |
| Project management | Missing: New, Recent, Save As, autosave, recovery | `components/ide/TopMenuBar.tsx` |
| Multiplayer | Missing (section 1.5) | `runtime/types.ts:554` |
| Cell tag editing UI | Missing. Tags come only from presets. | grep `cellTags` in `src/components`: none |
| Credits for CC0 packs in exports | Missing. The license files exist in the assets repo, but exports label those assets "MIT". | `assetBundler.ts:427-429, 497-499` |
| CI | Partial. The deploy workflow runs `npm install`, `npm test` and a build. There is no typecheck, lint or e2e step and no lockfile. | `.github/workflows/deploy.yml` |
| Repo documents | Missing: no LICENSE, README, CONTRIBUTING, CHANGELOG or SECURITY | repo root |

### 1.4 How export works today

The menu has an "Export Game" item that opens `ExportModal`. The modal offers two formats.

| | Standalone Project (.zip), the default | Single Offline HTML |
|---|---|---|
| Clicks in the editor | 2: open the modal, press Export (title, author and description are edited in the modal) | 3: open, pick the format, press Export |
| Output | A Vite source project: `package.json` depending on `three` and `vite`, `vite.config.js`, `index.html`, `src/main.js`, the verbatim TypeScript of `src/runtime/**`, `public/manifest.json`, assets, and `public/draco/` when needed (`projectExporter.ts:411-515`) | One `.html` file with the minified runtime and base64 data-URI assets inlined (`singleHtmlExporter.ts:121-301`) |
| Steps before players can play | 5 more steps: unzip, install Node 18+, `npm install` (pulls from the npm registry), `npm run build`, upload `dist/`. This needs build tools, a terminal and network access to npm. | Upload or double-click the file |
| Works on a subpath host such as itch.io or a GitHub project page | No. The generated `vite.config.js` keeps the default `base: '/'`, so built asset URLs are absolute. `main.js` fetches `/manifest.json` and passes `/draco/` (`projectExporter.ts:267, 278`). | The file itself works, but the export step fails on the Pages editor (next row) |
| Works from the deployed Pages editor | Yes, with one gap. The Draco decoder bundling fetches `/draco/...` (`assetBundler.ts:609`), which misses the `/Retro_FPS_GCS/` base, so a Draco model exports without its decoder. The failure is only logged (`assetBundler.ts:786-789`). | No. The exporter fetches `/single-html-runtime.js` (`singleHtmlExporter.ts:83`), which on Pages resolves outside the site. Confirmed in the built bundle. |
| Campaign levels | Kept | Dropped. The manifest is rebuilt without `levels` and `campaign` (`singleHtmlExporter.ts:149-157`), so only level 1 ships. |
| Draco models | Bundles decoders when they can be fetched | Broken. The decoder path is `''`, and the gstatic default is stripped by a regex (`singleHtmlExporter.ts:162`). |
| Asset licenses | `ASSET_LICENSES.md` with wrong "MIT" labels | Not included |
| Depends on anything outside the browser | Yes. The creator needs Node and npm after export. At export time the editor fetches assets from `raw.githubusercontent.com`. | Only the asset fetches at export time |
| Deterministic output | No. JSZip stamps the current time, and asset names come from `slug-id`, not a content hash. | Byte-stable only if the runtime bundle is unchanged |
| Main thread | Zipping and base64 conversion run on the main thread | Same |

Neither path meets "one click to a zip that runs when unzipped onto a static host". The deployed editor's single-HTML path fails outright.

### 1.5 Multiplayer today

- No networking code exists. `GameManifest` is documented as "No multiplayer field in v1" (`runtime/types.ts:554`), and `manifest.test.ts:49-51` asserts that. A grep for WebSocket, RTC, XMLHttpRequest, EventSource and sendBeacon in `src` finds nothing.
- The sim was written with several players in mind:
  - `createInitialSimulationState(level, playerIds)` takes a list of player IDs (`executor.ts:230-278`).
  - `step()` iterates the players in sorted order (`executor.ts:526-531`).
  - `PlayerTickInput` is a compact per-tick input.
  - Activator contexts carry a `playerId` (`sim/types.ts:733-739`).
  - The state hash gives a ready-made desync detector.
- **Can it be separated so single-player exports exclude it?** Yes. Nothing exists to untangle, and the runtime has no network imports today. P1.5 enforces this with lint rules and P3.2 with a bundle scan.
- **The real blocker.** Combat and enemy AI live in Three.js classes outside the sim (section 1.3). A server cannot run those classes, and clients would disagree with each other. Phase 4 moves weapons, hit tests, enemy AI and pickups into the sim. The sim already has an integer DDA raycaster (`sim/raycast.ts:101`) and a basic AI loop (`entitySim.ts:233`) to build on.

### 1.6 What the exported game carries

- **Prebuilt runtime bundle** (`public/single-html-runtime.js`).
  - Contains no React, Tailwind CSS, lucide or networking code. Verified by string search.
  - It does carry:
    - the editor sync API (`syncEditorLevel`)
    - legacy editor-format migrations (the "Invalid level JSON" and "Migrated level failed v3 validation" paths)
    - the editor save-format serializer
    - 29 dead Tailwind class strings in HUD markup
    - editor-style HUD controls ("Fire [LMB/F]", "Reload [R]", "Respawn at Start Pad")
  - Size: 940 KB minified, 250 KB gzip, most of it three.js.
- **Source-zip export.** Copies every file under `src/runtime/` verbatim, including `assetBundler.ts` with its Node `fs` fallbacks and the single-HTML launcher. A creator's `vite build` would tree-shake most of that away, but the source ships.
- **Estimated size without the editor code.** Moving authoring code out (P1.3) and splitting the editor adapter out of `startGame` (P1.4) should bring the single-player runtime to about 220 to 240 KB gzip with three.js included. The budget in Step 2 is 300 KB gzip.

### 1.7 TypeScript strictness

| Item | Finding |
|---|---|
| `tsconfig.json` | No `strict` key, plus `allowJs: true`, `experimentalDecorators: true`, `useDefineForClassFields: false` (AI Studio template), and `paths` mapping `@/*` to the repo root. There is no `include`, so the whole tree is in scope except `dist`. |
| Effective strictness | TypeScript 7 turns strict on by default. A probe file with an implicit `any`, a `null` assigned to `string` and an optional property read all fail with no config. The project passes `--strict` with 0 errors and fails 1 check with `--strict false` (`sim/validator.ts:868`). It is strict today, but the config does not say so. |
| Extra flags (errors outside tests) | `noUncheckedIndexedAccess`: 355 (grid indexing). `noUnusedLocals` plus `noUnusedParameters`: 30 (11 in `sim/executor.ts`). `exactOptionalPropertyTypes`: 40. |
| Explicit `any` (non-test) | 33 total: `EventTriggerEditorModal.tsx` 12, `runtime/manifest.ts` 8, `startGame.ts` 4, `assetBundler.ts` 4, `ExportModal.tsx` 3, `runtime/LevelSerializer.ts` 2. One `@ts-ignore` (`projectExporter.ts:51`) and one eslint-disable (`Viewport3D.tsx:180`). |
| Boundary gap: runtime entry | `startGame()` accepts four shapes (`GameManifest \| RuntimeManifestLike \| LevelDataV3 \| LevelStateData`) and probes them with `as any` (`startGame.ts:87-91, 173-192, 288-294`). The boundary should be one validated type. |
| Boundary gap: export dialog (bug) | `ExportModal` pre-fills from `(levelState as any)?.metadata?.title`. `LevelStateData` has no `metadata` field, only `title`, so the dialog always shows "GridForge 3D Game" and "Creator" (`ExportModal.tsx:51-59`). |
| Boundary gap: spawn yaw (bug) | On load, spawn yaw is read raw with `(parsedObj as any).spawn?.yaw` after validation (`runtime/LevelSerializer.ts:818-824`). `NaN` and `Infinity` pass the `typeof` check. |
| Boundary gap: asset collector | `collectAllReferencedAssets` probes `(levelInput as any).level` and `.levels` (`assetBundler.ts:140-148`) |
| Three level types | `LevelStateData`, `LevelDataV3` and `GameManifest` overlap, with conversion code in several places (section 1.2). Phase 2 replaces them with one project document type and one manifest type. |
| Tooling note | The TypeScript 7.0.2 npm package exposes no classic compiler API. `require('typescript')` returns only `version`, and the API sits under `./unstable/*`. Tools that need that API, such as the `typescript-eslint` parser, will not work against it. This drives the lint decision in D8. |

### 1.8 Leftovers, dead code, unused dependencies, hardcoded paths

**Google, Gemini and AI Studio leftovers**

| Location | What it is |
|---|---|
| `index.html:12-14` | Google Fonts (`fonts.googleapis.com`, `fonts.gstatic.com`) load on every editor visit. This is a Google service. |
| `runtime/EntityLoader.ts:67-68` | Default Draco decoder path `https://www.gstatic.com/draco/versioned/decoders/1.5.6/`. The editor never overrides it, so any Draco model makes the editor fetch from Google. |
| `engine/export/singleHtmlExporter.ts:162` | A regex that deletes gstatic URLs from the runtime bundle, which works around the line above |
| `package.json:16` | `@google/genai` (unused; pulls `google-auth-library`, `gcp-metadata`, `protobufjs`) |
| `metadata.json` | AI Studio app metadata, including `MAJOR_CAPABILITY_SERVER_SIDE_GEMINI_API` |
| `.env.example` | `GEMINI_API_KEY` and `APP_URL` |
| `vite.config.ts:15-19` | AI Studio `DISABLE_HMR` block |
| `src/App.tsx:1-4` | Apache-2.0 SPDX header from the AI Studio template |
| `package.json:2, 11` | Package name `react-example`; the `clean` script deletes a nonexistent `server.js` |
| `public/assets/aistudio/*` | Skill files, a personal report, logs, plans, screenshots (Q1). Deployed publicly. |
| `src/assets/*/README.md` | Text about "the AI Studio project" |
| `engine/export/safetyScanner.ts:30-46` | Gemini-specific scan patterns. A generic secret scan is worth keeping. |

**Unused dependencies (zero imports):** `@google/genai`, `express`, `dotenv`, `motion`, `autoprefixer`, `@types/express`, `@types/jszip` (jszip ships its own types). `vite`, `@vitejs/plugin-react`, `@tailwindcss/vite` and `tailwindcss` sit under `dependencies` but are build tools.

**Dead or redundant code:**

- 30 unused locals and parameters (1.7).
- Node `fs` fallbacks inside browser modules (`assetBundler.ts:542-571, 588-606`, `projectExporter.ts:72-99`, `singleHtmlExporter.ts:57-78`). Vite warns that it externalized `node:fs` and `node:path` for these.
- The eager `import.meta.glob('/src/runtime/**/*', { query: '?raw', eager: true })` (`projectExporter.ts:52-56`) puts the entire runtime TypeScript source into the editor bundle.
- The committed build artifact `public/single-html-runtime.js` (940 KB), rebuilt before every `dev` and `build`.
- The `ExportModal` Draco heuristic (it checks whether an ID contains "draco", `ExportModal.tsx:77-79`), its "<1MB" claim (`:226`) and its fixed size estimate (`:81-84`).
- The stray untracked `New folder/` and a stale `dist/` from 2026-10-28.

**Hardcoded paths and URLs:**

| Location | Value | Problem |
|---|---|---|
| `engine/AssetFolderLoader.ts:90-94`, `gitHubAssets.ts:17-18` | `NeuralDrifter/Retro_FPS_GCS-assets`, branch `main` | Not pinned. Any push to the assets repo changes every editor and export, and there are no integrity hashes. |
| `gitHubAssets.ts:126` | `raw.githubusercontent.com` | Not meant as a production CDN. Unauthenticated traffic is rate limited. |
| `AssetFolderLoader.ts:395, 420` | `api.github.com`, `data.jsdelivr.com` | Third-party calls from the editor |
| `AssetFolderLoader.ts:229` | `fetch('/assets/manifest.json')` | Absolute. Silently empty on Pages. |
| `singleHtmlExporter.ts:83` | `fetch('/single-html-runtime.js')` | Absolute. Export fails on Pages. |
| `assetBundler.ts:609` | `fetch('/draco/...')` | Absolute. Draco is missing from Pages exports. |
| `assetBundler.ts:429, 498` | `'MIT (NeuralDrifter/Retro_FPS_GCS-assets)'` | Wrong license, applied to any `github.com` URL |
| `projectExporter.ts:260, 267, 278, 338, 381` | `/src/main.js`, `/draco/`, `/manifest.json`, `localhost:3000`, "GridForge 3D Engine Contributors" | Absolute paths in exported games, and a copyright holder that does not exist |
| `public/manifest.json:5, 11` | `start_url: "/"`, `/favicon.ico` (no such file) | Breaks under the Pages subpath |
| `.github/workflows/deploy.yml:28` | `--base=/Retro_FPS_GCS/` | Fine, but lives only in CI, so local `vite preview` never tests the base path |
| `package.json:7` | `vite --host=0.0.0.0` | Exposes the dev server to the LAN (1.9) |

### 1.9 Security exposure

Scope: editor source and config, export code, runtime, CI. The deployed site was not probed; findings come from code and build output. No server exists yet; Phase 9 lists the requirements a server must meet.

**Editor**

| # | Finding | Label | Severity | Fix direction |
|---|---|---|---|---|
| ED-1 | Skill files, a personal report and dev logs are committed and served from the public Pages site (`public/assets/aistudio/`) | Confirmed | Medium (privacy, policy) | P0.1 |
| ED-2 | Project files register `customTextures` with only a "`previewUrl` is a string" check (`runtime/LevelSerializer.ts:508-521`). The whole object is copied, any URL scheme or host is accepted, and an entry can overwrite a built-in or library ID in the global registry for the session. Opening a shared project makes the editor request attacker-chosen hosts (IP and referrer leak) and can swap textures. | Confirmed | Medium | P2.6: field and scheme allowlists, no ID overrides |
| ED-3 | Pasted URLs (`AssetLibraryTab.tsx:309-322` and the model URL field) accept any scheme and host, and those URLs persist into project files | Confirmed | Low | P2.6 removes URL import (Q8) |
| ED-4 | No size or dimension limits on project files, texture uploads or model uploads (`useLevelPersistence.ts:363-383`, `AssetLibraryTab.tsx:283-298`) | Confirmed | Low (tab freeze or crash) | P2.6 caps |
| ED-5 | glTF files can reference external URIs. GLTFLoader would fetch them for uploaded or library models. | Needs verification | Low (privacy) | P7.2 sanitizer rejects external URIs |
| ED-6 | No Content Security Policy. GitHub Pages cannot set headers, so a `<meta>` CSP is the only option. | Confirmed | Low (no live XSS sink found) | P7.1 |
| ED-7 | Asset source pinned to a moving branch with no integrity hashes. A push to the assets repo, or a compromised account, changes what every editor loads and exports. | Confirmed | Medium | P2.7 versioned index with SHA-256 |
| ED-8 | Exports label any GitHub-hosted asset "MIT, Verified", including third-party repos a creator types in | Confirmed | Medium (legal exposure for creators) | P3.5 |
| ED-9 | `npm run dev` binds to `0.0.0.0`, so the dev server, with its file-serving endpoints, is reachable from the LAN | Confirmed | Medium for contributors | P0.5 |
| ED-10 | No lockfile. CI's `npm install` resolves new versions on every build, and `npm audit` refuses to run (`ENOLOCK`). | Confirmed | Medium (supply chain) | P0.2 |
| ED-11 | Unused server-side packages (`express`, `@google/genai` and their trees) widen the install surface | Confirmed | Low | P0.2 |

**Exported client**

| # | Finding | Label | Severity | Fix direction |
|---|---|---|---|---|
| EX-1 | No CSP in either export format | Confirmed | Low | P3.1 template CSP |
| EX-2 | Single-HTML manifest JSON escapes only `</script` (`singleHtmlExporter.ts:109-111`). A `<!--` sequence in level text can break page parsing. | Confirmed | Low (page DoS only) | P3.9 stores data in non-executed JSON blocks with every `<` escaped |
| EX-3 | The source-zip launcher writes `err.stack \|\| err.message` with `innerHTML` (`projectExporter.ts:303-306`) | Confirmed sink, limited reachability | Low | The P3.1 error screen uses `textContent` |
| EX-4 | Exported source projects depend on `^` ranges of `three` and `vite` from the public registry, so every creator build can differ | Confirmed | Low | Prebuilt, pinned runtime (P3.2) |
| EX-5 | Debug hooks ship in the runtime API (`noclip`, `syncEditorLevel`, `setSimState`), though no UI exposes them | Confirmed | Informational | P1.4 split |

**Server:** none exists. P9.2 and P10.6 set the controls: origin allowlist, payload caps, rate limits, schema-validated messages, no file transfer, non-root container.

**Verified controls**

- The level validator rejects unknown fields and `__proto__`, `constructor` and `prototype` keys, checking both the raw text and the parsed object (`validator.ts:64-78`). It caps counts of events, conditions, actions, entities, movers, flags, counters and timers, and limits message length to 120 (`sim/types.ts:28-45`).
- Asset IDs must match `^[a-z0-9_-]+$`, otherwise they are replaced by a content hash (`runtime/AssetRegistry.ts:77-103`). This stops path traversal into export zip paths.
- HUD text from levels (titles, messages, enemy names) is written with `textContent` (`hud/CombatHUD.ts:529-650`). The HUD `innerHTML` calls use only static markup, numbers and icons.
- Export HTML escapes the title and description (`projectExporter.ts:143-157`).
- Uploaded models get SHA-256 content IDs (`modelLibrary/uploadStore.ts:54-64`).
- A secret scan runs over export payloads (`safetyScanner.ts`).

### 1.10 Performance bottlenecks visible in the code

| # | Bottleneck | Evidence | Label | Impact | Fix |
|---|---|---|---|---|---|
| PF-1 | Deep clone of the full sim state every tick: all grids, events, regions, logs, messages, sounds | `sim/executor.ts:113-223, 502` | Confirmed | CPU and GC churn at 30 Hz | P1.6 |
| PF-2 | Full canonical-JSON hash of the state every tick in live play, used only by tests and replays | `startGame.ts:1148-1150`, `sim/hash.ts:98-214` | Confirmed | Large string building at 30 Hz | P1.6 |
| PF-3 | `logs`, `messages` and `soundsPlayed` grow without a cap and are cloned and hashed every tick, so per-tick cost grows with session length | `sim/simLog.ts:16`, `actionExecutor.ts:849-1019`, `moverSim.ts:199-620` | Confirmed | Slowdown over long sessions | P1.6 |
| PF-4 | About 20 editor re-renders a second during playtest from `onPlayerMove` | `App.tsx:2313`, `startGame.ts:1848-1883` | Confirmed | Main-thread contention with the frame | P1.7 |
| PF-5 | World rebuild when the sim changes during playtest | Section 1.2 | Likely | Hitches, enemy resets | P1.7 |
| PF-6 | The 3D editor stringifies the whole level and rebuilds every mesh on each change, and creates a new door `CanvasTexture` per rebuild that nothing disposes | `EditorScene.ts:199-211, 234`; `WorldBuilder.ts:691-712` never disposes maps | Confirmed rebuild, likely leak | Lag on large maps, GPU memory growth | P1.8, P6.5 |
| PF-7 | Disposal gaps: `PointerLockControls` never disposed (document listeners), PMREM environment target never freed, no `forceContextLoss` on either renderer | `startGame.ts:1270-1275, 1302, 1957-1977`; `EditorScene.ts:832-842` | Confirmed | Leaks and context accumulation across Edit and Play | P1.8 |
| PF-8 | Minimap SVG rebuilt through `innerHTML` about 20 times a second (bounded by the visible window) | `hud/MinimapHUD.ts:200-334` | Confirmed | Layout and parse cost | P5.7 canvas minimap |
| PF-9 | Per-frame allocations and scans: a new open-door `Set`, occluder arrays, `getObjectByName` per door and key, `lerpHeights` arrays, full-grid height loops | `startGame.ts:1679-1846` | Confirmed | Minor GC | P4.5 |
| PF-10 | Soft shadows (PCFSoft, 1024 map) on all walls with a camera-following light, and no quality presets | `startGame.ts:1255-1294` | Confirmed config | Doubles draw cost on integrated GPUs | P5.7 |
| PF-11 | Editor ships one 2.35 MB chunk with no code splitting. It includes the raw runtime source, the 138 KB asset index, three.js and JSZip. | Build output | Confirmed | Slow first load | P3.6, P7.4 |
| PF-12 | Draco decoder emitted twice in the editor build, plus a third copy in `public/draco` | Build output | Confirmed | Wasted bytes | P3.2 |
| PF-13 | Library previews load full textures from `raw.githubusercontent.com` with no thumbnails | `gitHubAssets.ts:161` | Confirmed; rate-limit risk needs verification | Slow browsing, 429 errors | P2.7, P6.6 |
| PF-14 | Undo snapshots deep-copy every matrix, up to 60 deep | `HistoryManager.ts:51-70` | Likely | Large memory on big levels | P2.3 |
| PF-15 | Export runs on the main thread (base64 loops, JSZip DEFLATE) | `singleHtmlExporter.ts:36-49`, `projectExporter.ts:502-513` | Confirmed | UI freeze on big exports | P3.3 |
| PF-16 | Draw calls. Walls, floors and ceilings are batched into chunked `InstancedMesh`es per texture, and vertical levels into merged geometry per texture, which is good. But every placed model is a separate clone with its own meshes, nothing reports draw calls, and the shadow pass draws every caster again. 300 static models can mean well over 1,000 draw calls. | `WorldBuilder.ts:11, 45-110, 483-532`; `EntityLoader.ts` has no instancing | Confirmed structure; counts need measurement | Frame rate on integrated GPUs | P5.7 |

### 1.11 Other open questions and the assumptions used

| Question | Assumption |
|---|---|
| Does the live Pages site match a fresh build of `main`? | Yes. The workflow deploys every push to `main`. |
| Are there saved project files from earlier versions in the wild that must keep loading? | Yes. Migrations from v1, v2 and v3 stay supported (P2.2). |
| Reference hardware for performance targets | Defined in Step 2 |
| Does GitHub rate-limit unauthenticated `raw.githubusercontent.com` traffic enough to hurt the asset browser? | Treated as a risk. P2.7 moves library traffic to a Pages site with thumbnails. |
| Does TypeScript 7.0.2 support build mode for project references? | Not relied on. P1.1 uses separate per-area tsconfig files run with `tsc -p`. |

---

## Step 2: What "ready to distribute" means

### Reference environments

These are assumptions (Q13). Every performance number below refers to one of them.

| Name | Definition |
|---|---|
| Reference PC | A 2021-or-later laptop or desktop with a 4-core, 8-thread CPU (Intel Core i5-1135G7 or AMD Ryzen 5 5500U class), integrated graphics (Intel Iris Xe or Radeon Vega 7 class), 8 GB RAM, a 1920x1080 window, current Chrome |
| Low-end floor | Intel UHD 620 class graphics, otherwise as above |
| Reference network | 50 Mbps down, 30 ms round trip |
| Reference server | 1 vCPU, 1 GB RAM Linux VM, Node 24 LTS |
| Heaviest sample level | The heaviest level of the sample game: 64x64 cells, 64 enemies, 300 static models |
| Target browsers | The latest two stable versions of Chrome, Edge, Firefox and Safari (macOS) on the release date. Desktop only. WebGL2 required (three.js no longer supports WebGL 1). |

### A. GCS editor

| ID | Criterion | Test |
|---|---|---|
| E-01 | A creator can create a project and build a level with every tool: walls, doors, keys and holes; textures; layers and slopes; entities and models; events; campaign levels. They can then playtest, save, reload and export it. | Playwright "editor tour" spec, plus QA checklist section A on all target browsers |
| E-02 | Every document edit can be undone and redone | Unit test that iterates every store action type and compares canonical documents before, after undo and after redo |
| E-03 | After a crash, at most 15 s of edits are lost, and a recovery prompt restores the rest | Playwright closes the page without unload after edits, reopens, and compares documents |
| E-04 | Save then load is lossless | Property test over the sample plus 100 generated projects: save, load, save gives identical canonical JSON |
| E-05 | A project file carries its uploaded assets | Playwright downloads a project in one browser profile and opens it in a fresh profile, expecting no stand-in models or textures |
| E-06 | Legacy v1, v2 and v3 files load | Unit test over `tests/fixtures/legacy/*` with key-field assertions |
| E-07 | Invalid or malicious project files are rejected with a message naming the problem, and the open project is unchanged | Unit tests over `tests/fixtures/malicious/*`, plus one Playwright case |
| E-08 | An error in any panel shows a recoverable error view, keeps the document, and offers a recovery download | Playwright with a test-only fault flag |
| E-09 | Playtest starts within 2 s on the heaviest sample level. The world is never rebuilt during play unless the document changes. Ten Edit to Play to Edit cycles add no WebGL contexts and grow the JS heap by less than 30 MB. | Playwright with debug counters and a Chrome DevTools Protocol heap reading |
| E-10 | Initial editor JavaScript is at most 500 KB gzip. The editor is interactive within 4 s on the reference PC and network with a cold cache. | CI size budget, plus a Playwright timing from navigation to the `gcs:editor-ready` event |
| E-11 | Editing a 64x64 level never produces a main-thread task longer than 200 ms | Playwright `PerformanceObserver` long-task check during a scripted editing session |
| E-12 | Works in all target browsers at a 1280x720 viewport or larger | Playwright on Chromium, Firefox and WebKit, plus manual Edge and Safari passes |
| E-13 | Fully operable with keyboard and mouse. Shortcuts are listed in Help, and icon buttons have accessible names. | axe checks plus a manual keyboard-only pass |
| E-14 | axe reports 0 serious or critical issues on the main views. Focus is visible. Text contrast is at least 4.5:1. | Playwright with axe-core |
| E-15 | The editor contacts only its own origin and the configured asset hosts, with zero requests to Google domains | Playwright network allowlist across the full suite |
| E-16 | The production editor ships a CSP with `script-src 'self' 'wasm-unsafe-eval'`, and the suite triggers no violations | Playwright `securitypolicyviolation` listener |
| E-17 | Help > About shows the editor, runtime and schema versions and links to the licenses and credits | Playwright |

### B. Exported game, single-player

| ID | Criterion | Test |
|---|---|---|
| G-01 | One click on Export turns a valid project into `<slug>-<version>.zip` with no further prompts. An invalid project shows a problems list and downloads nothing. | Playwright |
| G-02 | The unzipped package runs unchanged at a domain root, under a subpath on another origin, on itch.io, on GitHub Pages, and on one more static host | Playwright for root and subpath; manual, recorded results for the hosts |
| G-03 | Exporting the same project twice with the same editor version gives byte-identical zips in Chromium and Firefox | Playwright SHA-256 comparison |
| G-04 | A full playthrough requests only same-origin URLs: nothing from GitHub and no CDN | Playwright network log |
| G-05 | The single-player bundles (the ES module and the single-HTML classic script) contain none of `WebSocket`, `RTCPeerConnection`, `RTCDataChannel`, `WebTransport`, `EventSource`, `sendBeacon` or `XMLHttpRequest`. The entry's import graph excludes `src/net`. The page CSP allows no other origin: `connect-src 'self' data: blob:`, or `data: blob:` for the single-HTML file. | CI bundle scan, boundary check, and Playwright CSP check |
| G-06 | Package limits: at most 1,000 files, no file over 200 MB, at most 500 MB in total. These are the commonly cited itch.io limits; recheck them on itch.io's HTML5 docs before release. The sample export is at most 15 MB. | Exporter unit test, plus Playwright on the sample |
| G-07 | First playable frame within 3 s cold and 1.5 s warm for the sample on the reference PC and network | Playwright with network throttling, plus a manual run on the reference PC |
| G-08 | On the heaviest sample level at 1080p on the Medium preset: at least 60 FPS average and 50 FPS 1% low on the reference PC, and at least 30 FPS average on Low on the low-end floor | Built-in benchmark mode (`?benchmark=1`) run on hardware, results in `docs/qa/perf.md` |
| G-09 | p95 sim tick time of at most 2 ms on the heaviest sample level, flat over 30 minutes | `vitest bench`, plus the in-game benchmark |
| G-10 | The single-player runtime JavaScript is at most 300 KB gzip | CI budget |
| G-11 | Pointer lock on click with a drag-look fallback. Esc opens pause, and fullscreen toggles. A hidden tab pauses the sim and audio. WebGL context loss shows a message and recovers on restore. Resize and DPR changes are handled. | Playwright (`WEBGL_lose_context`, visibility emulation), plus manual checks |
| G-12 | Keyboard and mouse with rebinding. Standard-mapping gamepads (Xbox and PlayStation) handle move, look, fire, use, jump, weapon switch, pause and menus. Settings persist. | Unit tests with a mocked Gamepad API, plus manual tests with two controllers on Chrome, Firefox and Safari |
| G-13 | Main menu, pause, settings (sensitivity, invert Y, FOV, volumes, quality, head bob, shake, reduce flashing, show FPS) and credits. Settings persist across reloads, and corrupt storage falls back to defaults without an error. | Playwright |
| G-14 | Campaign progress (level and carried stats) survives a reload, and Continue resumes it. A corrupt save is ignored. | Playwright |
| G-15 | A recorded input file produces the same sim hash sequence in the editor playtest and in the exported game | Playwright running the recording in both, after Phase 4 |
| G-16 | Every export contains `CREDITS.txt` (title, author, license and source URL for each bundled asset's pack), `THIRD_PARTY_NOTICES.txt` and `LICENSE-runtime.txt`. The in-game Credits screen shows the same data. | Unit test comparing manifest assets to credit entries, plus Playwright |
| G-17 | Rebindable controls, sensitivity, invert Y, FOV 60 to 110, head bob and shake toggles, and a reduce-flashing toggle that disables strobe and flicker effects and dims the muzzle flash. The minimap is readable without color. A photosensitivity notice appears when a level uses strobe or flicker. | Unit tests on settings effects, plus a manual check |
| G-18 | Without WebGL2, or on a touch-only device, the game shows a clear message instead of a blank page | Playwright with WebGL disabled |
| G-19 | With the single-HTML option chosen, one click produces one self-contained `.html` with every campaign level, the credits and the notices inside. It plays when opened from disk and when served from any static host, makes no network request, and is byte-identical across runs. The exporter warns above 50 MB. | Playwright opening the file over `file://` and over HTTP |

### C. Multiplayer, when a creator enables it

| ID | Criterion | Test |
|---|---|---|
| M-01 | New projects have multiplayer off. Turning it on requires the Multiplayer tab, the Enable action, a confirmation, and valid required settings. Only then does the project store `multiplayer.enabled: true`. | Schema unit tests, plus a Playwright flow |
| M-02 | With multiplayer on, export is still one click and produces one zip containing `game/` and `server/` | Playwright |
| M-03 | The same project with multiplayer off exports a single-player zip with no `server/` folder, and its bundle passes G-05 | Playwright |
| M-04 | `node server/server.mjs` on Node 24 (no install step), or `docker compose up` in `server/`, starts a server whose `/healthz` reports ready within 5 s | Playwright, plus manual on a fresh VM |
| M-05 | 8 players at a 30 Hz tick, with p95 tick time of at most 8 ms and RSS of at most 256 MB on the reference server | Bot load test |
| M-06 | At 150 ms round trip with 30 ms jitter: own movement stays responsive and remote players move smoothly. Corrections over 0.5 m happen less than once per minute per client. Shots at targets under the crosshair at the client's render time register within a 200 ms compensation window. | Bot test through a latency proxy, plus a two-person play test |
| M-07 | With 8 players, at most 32 KB/s down and 4 KB/s up per client | Bot load-test metrics |
| M-08 | A client that drops for up to 30 s rejoins its slot automatically with health, ammo, inventory and score intact. After 30 s the slot frees. | Playwright through a proxy that cuts the socket |
| M-09 | Malformed, oversized or flooding messages disconnect only the sender. A 24 h soak with 8 bots shows no crash and less than 10% memory growth. | Fuzz tests, plus the soak run |
| M-10 | A client with a different protocol version or game content hash sees a clear "version mismatch" screen | Playwright |
| M-11 | Players never upload anything. The protocol has no file or blob messages, inputs are capped at 64 bytes and control messages at 1 KB, and the server writes nothing but logs. | Protocol unit tests, plus a review checklist |
| M-12 | The server decides movement, hits, damage and pickups. It enforces fire rate, range-checks inputs, checks origins against an allowlist, and limits connections per IP. | Integration tests with forged inputs |

### D. Shared: security, licensing, documentation, versioning

| ID | Criterion | Test |
|---|---|---|
| S-01 | CSP on the editor and on exports. No `innerHTML` or `dangerouslySetInnerHTML` with non-constant data. Zero high or critical advisories in shipped dependencies at release. Secret scanning on, Actions pinned to commit SHAs, and a `SECURITY.md` with private reporting. | CI gates, plus repository settings |
| S-02 | 10,000 mutated documents never crash the project validator or pollute prototypes, and every rejection names a path | Vitest fuzz test |
| S-03 | The repo has a LICENSE. Dependency licenses stay within an allowlist (MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD, Zlib, "MIT AND Zlib", and MPL-2.0 for build and test tools only). The editor ships third-party notices. Exports meet G-16. | CI license script |
| S-04 | Every library asset maps to a pack with a license and source URL. Export refuses assets without license data, and uploads require a license choice. | Unit tests on the index and the exporter |
| S-05 | A tester new to the project follows "Getting started" and "Publishing" through to a live itch.io page without help. The multiplayer guide gets a fresh VM to a running server. | Manual, recorded in `docs/qa/` |
| S-06 | Releases use SemVer tags with a CHANGELOG entry each. Project files carry `schemaVersion`, exported manifests carry `manifestSchemaVersion` and `runtimeVersion`, and multiplayer carries `protocolVersion`. A file from a newer editor is refused, not corrupted. | Unit tests, plus the release checklist |
| S-07 | `npm ci && npm run build` on a clean checkout of a release tag reproduces the release's runtime bundle hashes | CI rebuild job |

---

## Step 3: The plan

### 3.1 Key decisions

| ID | Decision | Choice and reason | Rejected and why |
|---|---|---|---|
| D1 | Export packaging | A prebuilt runtime bundle, the project manifest and the collected assets, zipped in a Web Worker in the browser. Creators need no build tools. The runtime code is identical for every game, so building per export adds nothing. Output is fast and deterministic, and each export pins its runtime version. The zip is the default one-click export. Single-player projects can pick the single-HTML format instead (Q7), built by the same worker from the same files. | Bundling with esbuild-wasm at export time: about 10 MB of wasm, slower, more failure modes, no benefit for data-driven games. A source project that needs Node (today): not one click. |
| D2 | Zip library | fflate in the export worker. It is small and fast. Being pure JavaScript, it produces the same bytes in every browser, and it accepts a fixed timestamp per entry. | JSZip (today): larger, runs on the main thread by default, needs extra care for determinism. Native `CompressionStream`: output can differ between browsers. |
| D3 | Runtime bundle format | A minified ES module with a content-hashed name, built by esbuild in CI. The game resolves every file relative to `document.baseURI`, so it runs under any subpath. Hashed names make host caching safe. The single-HTML option builds the same entry as a classic script, because browsers block module scripts and `fetch` on pages opened from disk. | IIFE committed to git (today): absolute fetch paths, editor code inside, stale-artifact risk |
| D4 | Asset library hosting | The assets repo publishes to its own GitHub Pages site in immutable versioned folders. An index carries a SHA-256 and a pack license for every file. It is free and CDN-backed with open CORS. Old projects keep working, and exports verify integrity. | `raw.githubusercontent.com` on `main` (today): unpinned, rate-limited, no hashes. jsDelivr: per-repo size limits are a poor fit for a large asset repo. Cloudflare Pages stays as the free fallback if Pages bandwidth (100 GB a month, soft limit) runs out. |
| D5 | Project file | One JSON document (schema v4) with user assets embedded as base64 plus SHA-256, and autosave in IndexedDB. This is the simplest portable format, and it is validated the same way as levels. | A zip-based project archive: a second parser and zip-bomb handling for little gain under the 64 MB cap |
| D6 | Editor state | One immutable project document in an external store (a reducer read through `useSyncExternalStore`). History keeps references to earlier documents. Undo becomes complete, memory grows only with what changed, and App's 46 `useState`s go away, with no new library. | Many `useState`s plus deep-copy snapshots (today): incomplete undo, high memory. Redux or Zustand: an extra dependency without extra capability here. |
| D7 | Module boundaries | Folders (`sim`, `shared`, `runtime`, `net`, `server`, `export`, `editor`) in one package, with per-area tsconfig files, Oxlint import rules and a boundary script. This mechanically enforces "the sim has no DOM", "the runtime has no React" and "single-player has no networking". | npm workspaces: more configuration for a one-person project. Project references: build mode under TypeScript 7.0.2 is not relied on. |
| D8 | Lint | Oxlint. The `typescript-eslint` parser needs TypeScript's classic compiler API, which the TypeScript 7.0.2 package does not ship (verified). Oxlint parses TypeScript itself and comes from the same toolchain as Vite 8. | ESLint with a second, older TypeScript installed beside TS 7: two compilers to keep aligned |
| D9 | Test tools | Vitest for logic and in-process integration tests, Playwright for editor, export and multiplayer flows, `vitest bench` for sim cost. Vitest reuses the existing Vite pipeline. Playwright drives Chromium, Firefox and WebKit, and can unzip and serve exports. | Node's built-in runner (today): no coverage thresholds or watch mode tied to Vite |
| D10 | Editor fonts | System font stack. No Google request and no font license to ship. | Self-hosted Inter and JetBrains Mono (OFL): fine if the look matters, at about 200 KB plus a license notice |
| D11 | Netcode | A server-authoritative simulation, snapshot interpolation for remote players and enemies, client prediction and reconciliation for the local player, and server-side lag compensation for hitscan. This is the standard model for fast shooters. It reuses the deterministic integer sim on both ends, tolerates jitter and slow clients, and server authority is the base of anti-cheat. | Deterministic lockstep: input delay equals the worst round trip, one slow client stalls everyone, a desync ends the match, every client sees everything. Rollback: re-simulating several ticks per frame from full state is expensive and gets complex with many players and AI enemies. |
| D12 | Transport | WebSocket over TLS (`ws` on Node 24) behind a transport interface. It works in every target browser and runs on any Node host behind standard HTTPS proxies or tunnels, with no UDP ports, ICE or TURN. Head-of-line blocking is tolerable for small 30 Hz messages with 8 players, and adaptive interpolation softens it. | WebRTC data channels: need a native server stack and STUN, and TURN relays cost bandwidth. WebTransport: browsers now support it (Safari reportedly shipped it in 26.4), but a Node server needs native HTTP/3 libraries, real certificates and UDP ingress, which many hosts lack. Revisit later behind the same interface. |
| D13 | Content Security Policy | A `<meta>` CSP in the editor and in every export (section 3.6). GitHub Pages and itch.io do not let you set response headers, so a meta tag is the only option. | No CSP (today) |
| D14 | Server packaging | One prebuilt `server.mjs` (esbuild, with `ws` bundled), plus a Dockerfile and a compose file with optional Caddy for automatic HTTPS, all inside the multiplayer export. It runs with `node server.mjs` and no install step. | Shipping source plus `npm install`: a build step for creators. A hosted service run by you: against Q11, and it costs money. |
| D15 | Releases | SemVer; integer schema, manifest and protocol versions; a `git-cliff` changelog from conventional commits; tag-driven GitHub Releases with checksums and provenance; Pages deploys from tags | Deploy on every push (today): users get unreleased changes |
| D16 | Licenses | MIT for the GCS (Q2). Exports ship the runtime under its MIT notice. Creators own their levels and uploads and pick their own content license. CC0 packs are credited in every export. MIT matches three.js and puts no obligations on creators' games. | A copyleft license on the runtime would bind every exported game |

### 3.2 Stack changes

The core stack stays: TypeScript 7, React 19, Tailwind 4, Three.js 0.186, Vite 8, esbuild, and tsx for scripts. These are the only changes.

| Change | Problem it solves | Cost |
|---|---|---|
| Vitest replaces `tsx --test` | Requested. Coverage thresholds and watch mode inside the Vite pipeline. | Mechanical edit of 17 test files (P0.3) |
| Add Playwright, plus axe-core for accessibility checks | No end-to-end tests today, and export has to be proven by unzipping and running it | Dev dependencies and CI minutes (P0.4) |
| Add Oxlint | No linter today, and typescript-eslint cannot run against TypeScript 7.0.2 | Configuration and fixes (P0.6) |
| fflate replaces JSZip | Main-thread zipping and weak control over determinism | None extra: the module is being rewritten anyway (P3.3) |
| CI-built runtime bundles (a hashed ES module, plus a classic script for the single-HTML option) replace the committed IIFE file | A committed 940 KB artifact, absolute fetch paths, editor code in the bundle | A new build script (P3.2) |
| System fonts replace Google Fonts | A Google request on every editor visit | A small visual change (P0.5) |
| Add `ws`, server only | Node has no built-in WebSocket server | One small MIT dependency, bundled into `server.mjs` (P9.2) |
| Add `es-module-lexer`, dev only | Parsing imports for the boundary check | Tiny (P1.5) |
| Remove `@google/genai`, `express`, `dotenv`, `motion`, `autoprefixer`, `jszip`, `@types/express`, `@types/jszip`, and `bun.lock` | Unused, Google, or replaced | None (P0.2, P3.6) |

### 3.3 Target module layout

```
src/
  sim/          deterministic simulation and level validation (no DOM, no three, no node:)
  shared/       project schema v4, migrations, canonical JSON, asset ID rules, versions (no DOM)
  runtime/      Three.js renderer, HUD, menus, input, audio (DOM and three; no React)
    entries/sp.ts   single-player entry; never imports src/net
    entries/mp.ts   multiplayer entry; the only importer of src/net/client
  net/
    protocol/   message types and codecs shared by client and server (no DOM)
    client/     transport, clock sync, interpolation, prediction (DOM; no React)
  server/       Node authoritative server (node: and ws; no DOM)
  export/       in-browser export pipeline, runs in a Web Worker (no React)
  editor/       React editor: App, components, store, persistence, playtest adapter
  main.tsx      editor entry
e2e/            Playwright specs
samples/        sample projects and input recordings
tools/          multiplayer bots and latency proxy (Node)
scripts/        build, check and report scripts
```

### 3.4 Export design

**Single-player zip.** Every file sits at the zip root. itch.io needs `index.html` at the top, and file names are case sensitive.

```
<slug>-<version>.zip
  index.html                 template with the meta CSP and <meta name="gcs:manifest">
  game.<hash>.js             single-player runtime (ES module)
  data/game.<hash>.json      levels, campaign, game data, asset map, versions
  assets/<sha256-16>.<ext>   one copy of each unique texture, model or audio file
  draco/                     only when a model needs it
  CREDITS.txt  THIRD_PARTY_NOTICES.txt  LICENSE-runtime.txt  README.txt
```

**Boot sequence:**

1. `index.html` loads `game.<hash>.js`.
2. The runtime reads the manifest path from the meta tag and fetches it relative to `document.baseURI`.
3. It validates the schema and runtime versions.
4. It loads assets with a progress display.
5. It shows the main menu.

There are no absolute URLs and no third-party origins anywhere in this path.

**Determinism rules:**

- canonical JSON with sorted keys
- content-hashed file names
- zip entries sorted by path
- fixed entry timestamp (1980-01-01 00:00:00)
- fixed compression level
- fflate pinned to an exact version
- no export date or random value in any generated file

**Single-HTML option (single-player only).** When a project's export format is set to "Single HTML file", the same worker writes one `<slug>-<version>.html` instead of the zip:

- the runtime is inlined as a classic script
- the manifest, assets and any Draco decoder are inlined as non-executed JSON data blocks, with every `<` escaped
- the runtime turns inlined assets into `blob:` URLs, so its asset-loading code is the same as in the zip
- credits and notices sit in an HTML comment at the top and on the in-game Credits screen, so the file stays compliant when shared on its own
- the same determinism rules apply

The file plays when opened from disk or served from any host. Base64 makes it about a third larger than the zip, and the whole file loads before play starts, so the exporter warns above 50 MB.

### 3.5 Multiplayer design

**Enable flow.** It lives in the editor's settings, never inside the export.

1. **Location.** File > Project Settings > Multiplayer. Nothing about multiplayer appears in the main toolbar.
2. **Default state.** The tab reads "Multiplayer is off. Exported games are single-player." and shows an **Enable multiplayer** button.
3. **Confirmation dialog.** It states five things:
   - You host a game server.
   - Players' browsers connect to it and upload nothing.
   - The export will contain a `game/` folder and a `server/` folder.
   - Hosting needs a machine that stays on and an HTTPS address. Costs may apply, and the guide lists free options.
   - Turning multiplayer off later returns to single-player exports.

   The dialog requires a checked box, "I will host a server for this game", before it enables anything.
4. **Required settings.** Export is blocked until all of these are valid:
   - mode: co-op or deathmatch
   - maximum players: 2 to 8
   - server address: a `wss://` URL, with `ws://` allowed only for `localhost` and `127.0.0.1`
   - allowed page origins: the `https://` origins where the game will be hosted
   - mode options. Co-op: friendly fire, respawn delay. Deathmatch: frag limit, time limit, respawn delay.
   - "Allow single-player from the menu", on by default
5. **Level checks.** These go to the Problems list:
   - enough numbered spawn points per level (the maximum player count for co-op, at least 4 for deathmatch)
   - an exit in every co-op level
   - enemy count within the multiplayer limit
6. **What gets stored.** The project document holds:

   ```json
   "multiplayer": {
     "enabled": true,
     "mode": "coop",
     "maxPlayers": 4,
     "serverUrl": "wss://play.example.org/game",
     "allowedOrigins": ["https://<where-the-game-is-hosted>"],
     "allowSinglePlayer": true,
     "coop": { "friendlyFire": false, "respawnSeconds": 5 },
     "deathmatch": { "fragLimit": 20, "timeLimitMinutes": 10, "respawnSeconds": 3 }
   }
   ```

   Multiplayer is on only when `enabled` is the literal `true`. If the object is missing, or `enabled` has any other value, the game is single-player.
7. **Export.** The button reads "Export (multiplayer)" and still takes one click. The zip layout:

   ```
   <slug>-<version>-multiplayer.zip
     README.txt              which folder goes where; link to the multiplayer guide
     game/                   upload to any static host
       index.html  game.<hash>.js (multiplayer runtime)  config.json (server address, editable later)
       data/  assets/  draco/  CREDITS.txt  THIRD_PARTY_NOTICES.txt  LICENSE-runtime.txt
     server/                 run on a machine you control
       server.mjs            prebuilt; Node 24 or newer; no install step
       game.<hash>.json      the same game data the client loads
       server.config.json    port, max players, allowed origins, mode settings, limits
       Dockerfile  compose.yaml  Caddyfile.example  README-server.txt  notices
   ```
8. **Turning it off.** One click on "Turn off multiplayer" sets `enabled: false` and keeps the other settings. The next export is single-player, with no `server/` folder and no networking code.

**Netcode parameters**

| Parameter | Value | Note |
|---|---|---|
| Sim tick | 30 Hz | Same as single-player |
| Client input | Every tick, sequence-numbered, about 12 bytes | Button bits, move axes, yaw and pitch deltas in BAM |
| Snapshot rate | 30 Hz by default, 15 Hz as an option | Integer positions straight from the sim. Delta encoding is added only if M-07 fails. |
| Interpolation delay | Two snapshot intervals plus twice the measured jitter, clamped to 50 to 200 ms | Adaptive |
| Prediction | Local player movement only | Doors, movers and enemies are never predicted |
| Lag compensation | Rewind up to 200 ms | Older shots are clamped |
| Reconnect | Token, slot held for 30 s | Full snapshot on rejoin |
| Limits | Input 64 bytes, control 1 KB, any frame 4 KB, 2 connections per IP, 5 new connections per IP per minute | Set in `server.config.json` |
| Heartbeat | Ping every 2 s, drop after 10 s of silence | |

**Anti-cheat**, sized to a small retro shooter:

- Server authority over movement, hits, damage and pickups.
- Range checks on every input field, fire rate enforced on the server, and a cap on lag compensation.
- Player names limited to 1 to 16 letters, digits, spaces, underscores or hyphens, and always rendered as text.
- An origin allowlist. This stops other websites from pointing a client at the server; it is not authentication.
- Per-IP limits, plus kick and ban by IP from the server console.
- Logs of rejected messages.

Out of scope for v1: hiding players who are out of sight, aim-assist detection, and accounts.

**Hosting options** (the costs are approximate; recheck them in P10.5):

| Option | Cost | Notes |
|---|---|---|
| Your own PC plus a Cloudflare Tunnel | Free | No open ports, but the PC must stay on. A permanent named tunnel needs a domain on Cloudflare. Quick tunnels give a temporary address, which `config.json` can be edited to follow. |
| Free-tier cloud VM (Oracle Cloud Always Free, for example) | Free; sign-up may require a card | Terms change, so check before relying on it |
| Low-cost VPS | Paid, typically a few US dollars a month | Most predictable |
| HTTPS address for Caddy | A domain is typically about 10 US dollars a year. Free dynamic-DNS subdomains also work with Caddy. | Not needed with a tunnel |

### 3.6 Content Security Policies

These go in `<meta http-equiv="Content-Security-Policy">`. A meta policy cannot set `frame-ancestors`, `report-to` or `sandbox`, and GitHub Pages cannot add headers, so those protections are unavailable. P7.1 tries `style-src 'self'` and keeps `'unsafe-inline'` only if violations remain.

| Page | Policy |
|---|---|
| Editor (GitHub Pages) | `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: <asset-host>; connect-src 'self' <asset-host> https://api.github.com https://raw.githubusercontent.com; font-src 'self'; worker-src 'self' blob:; media-src 'self' data: blob:; object-src 'none'; base-uri 'self'; form-action 'none'; manifest-src 'self'` (the two GitHub hosts stay only if custom GitHub asset repos stay, per Q9) |
| Exported game, single-player | `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' data: blob:; worker-src 'self' blob:; media-src 'self' data: blob:; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'` |
| Exported game, single-HTML option | `default-src 'none'; script-src 'sha256-<hash of the inlined runtime>' 'wasm-unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:; connect-src data: blob:; worker-src blob:; media-src data: blob:; object-src 'none'; base-uri 'none'; form-action 'none'`. The hash is computed at export time. |
| Exported game, multiplayer | As single-player, plus `wss:` in `connect-src`. That lets a creator change the server address in `config.json` after export without also editing the policy. |

`'wasm-unsafe-eval'` is there for the Draco WebAssembly decoder. `blob:` in `worker-src` and `connect-src` covers the decoder worker and three.js's blob-based texture loading.

### 3.7 Testing strategy

| Layer | Tool | What it covers | Where it runs |
|---|---|---|---|
| Logic | Vitest | Sim scenarios and determinism replays, validators and migrations (fixtures, fuzzing), export worker (golden zip hash), protocol codecs, server (in-process clients), settings and save models | Every push. Coverage thresholds: 80% lines for `sim`, `shared`, `export`, `net` and `server`; 50% for `runtime` and `editor`. |
| Performance | `vitest bench`, Playwright probes | Sim tick p95, long tasks while editing and playing, memory across Edit and Play cycles, bundle budgets | Every push (budgets), nightly (probes) |
| Flows | Playwright | Smoke, editor tour, undo and redo, autosave recovery, portability, single-player export (unzip, serve under a subpath, boot, network log, determinism), single-HTML export opened from disk, runtime behavior (context loss, visibility, settings, saves), accessibility (axe), multiplayer export (server plus two clients plus reconnect) | Chromium on every push. Firefox, WebKit and the multiplayer soak nightly. |
| Manual | `docs/qa-checklist.md` | Sections: A editor, B export and hosts, C runtime and input including gamepads, D accessibility, E multiplayer, F performance on the reference hardware | Before every release, recorded in `docs/qa/results-<version>.md` |
| Regression target | Sample game "Proving Grounds" | v1 in P2.8. v2 in P7.5 uses every trigger, condition and action type, every cell type, vertical features, every weapon, enemy and pickup, campaign carry-over and multiplayer spawns. It is backed by an action-coverage test, a golden export hash, and one input recording per level. | Vitest and Playwright |

### 3.8 Distribution channels and launch checklist

| Channel | Used for | Requirements | Cost |
|---|---|---|---|
| GitHub Pages, this repo | The editor, deployed from release tags | Static files, a site cap of 1 GB, about 100 GB a month of bandwidth (soft limit), HTTPS, a 10-minute deploy limit, no custom headers (meta CSP only), base path `/Retro_FPS_GCS/` | Free for public repos |
| GitHub Pages, assets repo | The asset library (D4) | The same limits, plus versioned folders | Free |
| GitHub Releases | Offline editor zip, runtime bundles, sample game zips, server bundle, `SHA256SUMS.txt`, provenance | Per-file size limits apply | Free |
| itch.io | Sample games (HTML5) and a landing page for the editor | A zip with `index.html`; case-sensitive names; limits commonly cited as about 1,000 files, 500 MB extracted and 200 MB per file (recheck on itch.io's HTML5 docs); set the viewport size and enable the fullscreen button. Link the editor page to GitHub Pages rather than embedding the editor, because browsers partition iframe storage and autosave could be lost. | Free (revenue share is optional) |
| Direct sharing (single-HTML option) | Single-player games passed around as one file | Players open the `.html` in a browser, online or offline. itch.io's HTML5 docs also accept a single self-contained `.html` upload. Some email and chat services block `.html` attachments. | Free |
| Other static hosts (Cloudflare Pages, Netlify, Codeberg Pages and similar) | Wherever creators publish | Upload the unzipped folder. Each host has its own per-file and file-count limits, and `README.txt` tells creators to check them. | Free tiers |
| Newgrounds, Game Jolt (optional) | More reach for the sample games | HTML5 zip uploads with their own limits; check each | Free |

**Minimum launch checklist** (P8.6 turns this into `docs/launch-checklist.md`):

- [ ] Phase 7 gate passed, and QA results recorded for the release version
- [ ] `v1.0.0` tagged; release artifacts carry checksums and provenance; Pages deployed from the tag; About shows the right versions
- [ ] LICENSE, editor third-party notices, and export credits and notices correct; per-pack license check recorded
- [ ] README, creator docs, publishing guide, SECURITY.md, CONTRIBUTING and CODE_OF_CONDUCT live
- [ ] Sample games live on itch.io and GitHub Pages, and checked in Chrome, Firefox and Safari; the single-HTML sample opens from disk in all three
- [ ] itch.io pages carry screenshots, description, controls, a photosensitivity note when it applies, and a link to the editor
- [ ] Issue templates and labels set; private vulnerability reporting on
- [ ] Network evidence shows zero requests to Google domains from the editor or the games
- [ ] Rollback tested: redeploying the previous tag to Pages works

### 3.9 Phase overview

```
P0 -> P1 -> P2 -> P3 -> P5 -> P6 -> P7 -> P8        single-player v1.0
       |                       ^
       +-> P4 -----------------+    (P6.3 needs P4.4)
            |
            +-> P9 -> P10                            multiplayer v1.1 (P10 also needs P6.2 and P8.1)
```

P4 touches only `src/sim` and `src/runtime`. It can run on a separate branch alongside P2 and P3.

| Phase | Objective | Depends on | Tasks | Sessions | Gate in one line |
|---|---|---|---|---|---|
| P0 | Hygiene and safety net | none | 7 | 6 to 8 | CI green with tests and e2e; no leftovers; lockfile |
| P1 | Architecture boundaries and hot-path cleanup | P0 | 8 | 8 to 10 | Boundaries enforced; sim cost flat; no rebuild during play |
| P2 | Project format v4, editor store, persistence | P1 | 8 | 9 to 11 | Lossless, portable, autosaved projects with complete undo |
| P3 | One-click export, single-player | P2 | 9 | 9 to 11 | One click gives a zip that runs on three hosts, byte-identical every time; the single-HTML option plays from disk |
| P4 | One simulation: combat and AI move into the sim | P1 | 7 | 8 to 10 | Live play equals replay; four-player scenarios pass |
| P5 | Game runtime completeness | P3 (P4 for weapons) | 7 | 7 to 9 | Menus, settings, input, saves and browser behavior meet G-11 to G-18 |
| P6 | Editor completeness and UX | P2, P4 | 8 | 8 to 10 | Editor criteria pass; game data drives exports |
| P7 | Hardening and QA | P5, P6 | 7 | 7 to 8 | Every E, G and S criterion measured and passing |
| P8 | Release pipeline, licensing, docs, launch | P7 | 6 | 6 to 8 | v1.0.0 live with docs and sample games |
| P9 | Multiplayer core | P4, P3 | 9 | 10 to 13 | M-05 to M-12 pass in the harness |
| P10 | Multiplayer product | P9, P6.2, P8.1 | 7 | 6 to 8 | Enable flow, packaging and guide verified; v1.1.0 |

---

### Phase 0: Hygiene and safety net

**Objective.** Stop publishing files that should not be public. Remove leftovers and Google calls. Make installs reproducible. Put tests, e2e checks and CI gates in front of every later change.

**Why first.** The refactors in Phase 1 need a safety net. CI needs a lockfile to be reproducible. The leaked files are live on the public site today.

| ID | Task | Files | Depends on | Acceptance criteria | Verify |
|---|---|---|---|---|---|
| P0.1 | Remove leaked and leftover files. Delete `public/assets/aistudio/`, `metadata.json` and `.env.example`. Remove the AI Studio block from `vite.config.ts`, the Apache SPDX header from `App.tsx`, and the AI Studio text from the asset READMEs. Rename presets that use third-party trademarks ("Wolf3D", "Doom"). Set the package name and version 0.1.0. Add `public/assets/aistudio/` to `.git/info/exclude`. Delete the untracked `New folder/`. History purge per Q1. | `public/assets/aistudio/*`, `metadata.json`, `.env.example`, `vite.config.ts`, `src/App.tsx`, `src/assets/models/README.md`, `src/assets/textures/README.md`, `src/types/engine.ts` (`MAP_PRESETS` names), `package.json`, `.git/info/exclude` | none | `git ls-files` lists none of the removed paths. A production build contains no `aistudio` path. Tracked files mention AI Studio or Gemini only in the two plan documents. No preset name uses a third-party mark. | `git ls-files \| grep -i aistudio`; `npm run build`, then search `dist` for `aistudio`; `git grep -n -i -e "ai studio" -e gemini` |
| P0.2 | Dependency cleanup and reproducible installs. Remove the unused packages. Move build tools to `devDependencies`. Add `engines.node` and `.nvmrc` (Node 24 LTS). Commit `package-lock.json` and delete `bun.lock`. Switch CI to `npm ci`. Fix the `clean` script. | `package.json`, `package-lock.json` (new), `bun.lock` (delete), `.nvmrc` (new), `.github/workflows/deploy.yml` | P0.1 | `npm ci` succeeds on a clean clone. `npm ls` finds none of the removed packages. `npm audit --omit=dev` runs and reports 0 high or critical. Tests and build pass. | Commands in a fresh clone |
| P0.3 | Move tests to Vitest. Add `vitest` (the major that lists Vite 8 as a peer) and `@vitest/coverage-v8`. Add `vitest.config.ts`. Switch `node:test` imports to `vitest`, keeping the `node:assert/strict` calls to limit churn. `npm test` runs `vitest run`. Add `test:watch` and `test:coverage` scripts. | `package.json`, `vitest.config.ts` (new), `src/engine/__tests__/*.test.ts` (17 files) | P0.2 | The same 174 tests pass with unchanged determinism baselines. A coverage report is produced. No `node:test` import remains. | `npm test` shows 174 passed; `git grep "node:test"` is empty |
| P0.4 | Playwright smoke harness. `playwright.config.ts` serves the production build under `/Retro_FPS_GCS/` with `vite preview`: Chromium on every push, Firefox and WebKit nightly. Shared fixtures fail a test on any console error, page error, CSP violation, or request to an origin outside an allowlist. When a debug flag is set, the runtime dispatches a `gcs:first-frame` DOM event and the editor dispatches `gcs:editor-ready` once it is interactive. Specs: the editor loads, a preset opens, Test Play renders a first frame, the export dialog opens. | `package.json`, `playwright.config.ts` (new), `e2e/fixtures.ts`, `e2e/smoke.spec.ts` (new), `src/runtime/startGame.ts` (first-frame event), `src/main.tsx` (editor-ready event), `.gitignore` | P0.3 | Passes locally and in CI in under 3 minutes on headless Chromium. A planted `console.error` makes it fail. | `npx playwright test`; plant check |
| P0.5 | Remove Google calls and base-path bugs. Replace Google Fonts with a system font stack (Q14). Set the Draco decoder path to `import.meta.env.BASE_URL + 'draco/'` before any model loads, and remove the gstatic default and its regex workaround. Make the three absolute fetches base-relative. This is an interim fix; P3 replaces those exporters. Fix `public/manifest.json` (`start_url: "./"`; a real icon or none). Bind `npm run dev` to localhost, with an opt-in `dev:lan` script. | `index.html`, `src/index.css`, `src/runtime/EntityLoader.ts`, `src/engine/export/singleHtmlExporter.ts`, `src/runtime/assetBundler.ts`, `src/engine/AssetFolderLoader.ts`, `src/editor3d/EditorScene.ts`, `src/components/Viewport3D.tsx`, `public/manifest.json`, `package.json` | P0.4 | Smoke e2e records zero requests to Google domains. Single-HTML export succeeds from the `/Retro_FPS_GCS/` preview. A Draco test model loads its decoder from `/Retro_FPS_GCS/draco/`. Built JavaScript has no fetch of a path starting with `/`. | e2e; search `dist/assets/*.js` |
| P0.6 | CI pipeline and lint. Add `ci.yml` for pull requests and `main`: `npm ci`, typecheck, Oxlint, Vitest, build, Playwright smoke, and artifacts (dist and reports). `deploy.yml` runs only after a green `ci.yml` on `main` (P8.1 moves it to tags). Pin actions to commit SHAs and keep `permissions` minimal. Add Oxlint with the correctness and suspicious categories and the react-hooks rules. Rename the current `lint` script (which runs `tsc`) to `typecheck`. | `.github/workflows/ci.yml` (new), `.github/workflows/deploy.yml`, `.oxlintrc.json` (new), `package.json` | P0.4 | On a throwaway PR, a type error, a lint error, a failing unit test and a failing e2e each turn CI red at the right step; with none of them CI is green. Pages deploys only from a green run. | Throwaway PR, then close it |
| P0.7 | Baseline metrics, LICENSE and README stub. `scripts/report-metrics.ts` prints editor and runtime sizes (raw and gzip), test counts, error counts under the extra strict flags, and dependency counts. Record the results in `docs/metrics-baseline.md`. Add `LICENSE` (Q2) and a short `README.md`: what it is, its status, how to run it, and a link to this plan. | `scripts/report-metrics.ts` (new), `docs/metrics-baseline.md` (new), `LICENSE` (new), `README.md` (new), `package.json` | P0.6 | Script output matches section 1.1 within 1%. LICENSE and README render on GitHub. | `npm run metrics` |

**Risks and fallbacks**
- Headless WebGL in CI may be slow or disabled. Fallback: launch Chromium with SwiftShader (`--enable-unsafe-swiftshader`), assert on the `gcs:first-frame` event rather than pixels, and keep pixel checks for local runs.
- Removing a package may break a hidden import. Fallback: build and tests catch it, and the one package gets restored.
- Oxlint may lack a needed rule. Fallback: a small grep-based check script for that rule.

**Gate.** CI is green with typecheck, lint, 174 unit tests, build and the e2e smoke. The lockfile is committed. The tree and the build contain no Google request and no AI Studio file. The baseline is recorded.

---

### Phase 1: Architecture boundaries and hot-path cleanup

**Objective.** Make the editor, runtime, sim and future networking separable, and make that separation enforced by tools. Fix the structural problems that hurt every later phase: sim cost that grows over time, world rebuilds during playtest, and WebGL leaks.

**Why now.** Export (P3), the one-simulation work (P4) and multiplayer (P9) all build on these boundaries. Moving files later would conflict with feature work.

| ID | Task | Files | Depends on | Acceptance criteria | Verify |
|---|---|---|---|---|---|
| P1.1 | Explicit compiler settings. Set `strict: true` and add `noUnusedLocals`, `noUnusedParameters`, `noImplicitReturns`, `noFallthroughCasesInSwitch` and `noImplicitOverride`. Remove `allowJs`, `experimentalDecorators` and `useDefineForClassFields: false` after confirming no decorators exist. Limit `include` to `src`, `scripts` and `e2e`. Delete the dead code behind the 30 unused-code errors. Replace the `@ts-ignore` at `projectExporter.ts:51` with typed code, and give the eslint-disable at `Viewport3D.tsx:180` a stated reason. | `tsconfig.json`, the files with unused-code errors (`src/runtime/sim/executor.ts`, `src/runtime/assetBundler.ts`, `src/App.tsx`, `src/components/EventTriggerEditorModal.tsx`, `src/runtime/WorldBuilder.ts`, `src/hooks/useCampaignManager.ts` and four others) | P0.6 | Typecheck passes with the new flags. No `@ts-ignore` remains. `allowJs` is gone. Tests pass. | `npm run typecheck`; `npm test` |
| P1.2 | Restructure the folders (section 3.3). Move `src/runtime/sim` to `src/sim`. Create `src/shared` (asset ID rules, FNV hash, canonical JSON, constants) and split `runtime/AssetRegistry.ts` so the sim depends only on `src/shared`. Move editor code to `src/editor/` and `src/engine/export` to `src/export`. Add per-area tsconfigs: `sim` and `shared` with `lib: ["ES2022"]` and `types: []`; `runtime` with DOM and no JSX; `editor` with DOM and JSX; `node` for scripts and the server. `npm run typecheck` runs each with `tsc -p`. Renames only, in their own commit. | All of `src/**` (moves), `vite.config.ts`, `vitest.config.ts`, `tsconfig.*.json` (new), `scripts/build-single-html-runtime.ts` | P1.1 | Git detects the renames. Every area config passes, and the sim config has no DOM library. Determinism baselines are unchanged. Build and e2e pass. | `npm run typecheck && npm test && npm run build && npx playwright test` |
| P1.3 | Move authoring code out of the runtime. `assetBundler.ts` becomes `src/export/collect.ts` with no Node `fs` code (tests inject bytes). The v1 and v2 editor-format migrations and `serializeLevel` move to `src/shared/project/legacy.ts`. The runtime keeps `loadGameManifest(json: unknown): GameManifest` with validation. `startGame` accepts only `GameManifest` (the editor converts first), which removes the four-shape union and its `as any`. | `src/runtime/assetBundler.ts`, `src/runtime/LevelSerializer.ts`, `src/runtime/manifest.ts`, `src/runtime/startGame.ts`, `src/runtime/index.ts`, `src/export/*`, `src/shared/project/legacy.ts` (new), editor call sites, tests | P1.2 | No `node:` import in `src/runtime`, `src/sim`, `src/shared` or `src/editor`. Legacy exporter tests inject their inputs through the existing options, and the exporters' remaining Node fallbacks go with them in P3.6 and P3.9. The runtime bundle no longer contains "Invalid level JSON" or "Migrated level failed". The bundle size is recorded. Tests pass. | Search the bundle; `npm run metrics` |
| P1.4 | Split `startGame` into a runtime core and an editor playtest adapter. Core under `src/runtime/core/`: `GameRuntime.ts` (loop, stepping, campaign), `RenderSystem.ts` (renderer, lights, resize), `WorldView.ts` (world build, doors, pushwalls, lifts), `InputController.ts`, `HudController.ts`. Editor-only controls (wireframe, noclip, `syncEditorLevel`, `setSimState`) move to `src/editor/playtest/PlaytestSession.ts` behind a `DebugControls` interface that the single-player entry never imports. Keep `startGame.ts` as a thin facade until P3.9, because the legacy single-HTML exporter still calls it. Move one subsystem per commit. | `src/runtime/startGame.ts`, `src/runtime/core/*` (new), `src/editor/playtest/PlaytestSession.ts` (new), `src/editor/components/Viewport3D.tsx` | P1.3 | No file under `src/runtime` exceeds 600 lines. Playtest e2e and determinism tests pass. The runtime bundle has no `syncEditorLevel`. | `wc -l`; e2e; search the bundle |
| P1.5 | Enforce the boundaries. Oxlint `no-restricted-imports` rules per area: `sim`, `shared` and `net/protocol` may not import `three`, `react`, DOM-only modules or `node:*`. `runtime` may not import `react`, `lucide-react`, `editor` or `export`. `export` may not import `react`. `editor` reaches the runtime only through `src/runtime/index.ts`. Only `src/runtime/entries/mp.ts` may import `src/net/client`. `scripts/check-boundaries.ts` (using `es-module-lexer`) is a second gate with a readable report. | `.oxlintrc.json`, `scripts/check-boundaries.ts` (new), `package.json`, `.github/workflows/ci.yml` | P1.2 | A planted forbidden import in each area fails CI with a message that names the rule. The current tree passes. | Throwaway commits |
| P1.6 | Fix the sim hot path. Separate immutable level definitions (event, region and static geometry definitions) from per-tick state. Copy only the matrix rows that actions change. Replace the growing `logs`, `messages` and `soundsPlayed` arrays with a per-tick output buffer (64 entries maximum) that the runtime drains. Compute the state hash only when a hash callback or recorder is attached. Add `vitest bench` over a 3,000-tick replay of the heaviest fixture. Before re-baselining hashes, compare per-tick projections (players, entities, movers, flags, counters, grids) between old and new code on every determinism fixture. | `src/sim/executor.ts`, `types.ts`, `hash.ts`, `actionExecutor.ts`, `moverSim.ts`, `entitySim.ts`, `simLog.ts`, `src/runtime/core/GameRuntime.ts`, `src/runtime/hud/CombatHUD.ts`, determinism tests and baseline, `src/sim/__bench__/tick.bench.ts` (new) | P1.4 | Projections are identical on all fixtures. p95 tick time is at least 3 times lower than the P0.7 baseline. Tick time at tick 50,000 is within 10% of tick 1,000. The new baseline is committed with an explanation in the commit body. | `npx vitest bench`; the projection test |
| P1.7 | Decouple playtest from editor state. Playtest starts from an immutable snapshot of the document, and sim changes never flow back into document state. Player position, HUD and status reach the editor through a small external store, read with `useSyncExternalStore` by a memoized overlay. Memoize `MapEditor2D`, the inspector and the asset panels. Rebuild the world only on document edits. | `src/editor/App.tsx`, `src/editor/components/Viewport3D.tsx`, `src/editor/components/MapEditor2D.tsx`, `src/editor/hooks/useCampaignManager.ts`, `src/editor/playtest/playtestStore.ts` (new), `src/editor/playtest/PlaytestSession.ts` | P1.4 | An e2e script on the sample level opens a door, takes a key and walks for 10 s. The runtime world-build counter stays at 1. App commits during the walk are 5 or fewer (a React Profiler counter in debug builds). No task exceeds 100 ms. | e2e with debug counters |
| P1.8 | Disposal and WebGL context hygiene. Dispose `PointerLockControls`, the PMREM environment target, the door and skybox textures, and the textures the world group owns. Track ownership so shared cached textures survive. Create the door texture once per scene. On dispose, call `renderer.forceContextLoss()` and remove the canvas, in both the runtime and `EditorScene`. | `src/runtime/core/*`, `src/runtime/WorldBuilder.ts`, `src/editor/editor3d/EditorScene.ts` | P1.4 | e2e runs 10 Edit, Play, Edit cycles. No "Too many active WebGL contexts" warning appears. `renderer.info.memory.textures` returns to its starting value, plus or minus 2. JS heap growth stays under 30 MB (read after GC through the Chrome DevTools Protocol). | e2e |

**Risks and fallbacks**
- The restructure produces a huge diff that conflicts with other work. Fallback: do it in one session with no parallel branches, renames only, in a separate commit.
- The hot-path change could alter sim behavior. Fallback: the projection comparison catches it, and the offending structure reverts to per-field cloning.
- Splitting `startGame` could break subtle playtest behavior (pointer lock, campaign changes). Fallback: keep the facade, move one subsystem per commit, and run e2e after each.

**Gate.** CI enforces the boundaries. The sim compiles without DOM types. No runtime file exceeds 600 lines. The single-player path imports no editor code. Sim cost stays flat over time. Playtest never rebuilds the world on sim changes. Ten Edit and Play cycles produce no context warnings.

---

### Phase 2: Project format v4, editor store and persistence

**Objective.** One versioned, validated and portable project document. Make every edit undoable, and make sure work survives a crash.

**Why now.** Export (P3) reads this document, the multiplayer opt-in (P10) lives in it, and every editor feature (P6) writes to it. Lossless saving must exist before the public uses the editor.

| ID | Task | Files | Depends on | Acceptance criteria | Verify |
|---|---|---|---|---|---|
| P2.1 | Project schema v4. Write types and a hand-written validator in the existing level-validator style: path-specific errors, unknown fields rejected, forbidden keys, caps. `ProjectDocV4` contains: `schemaVersion: 4`; `id`; `meta` (title, author, description, version, created and updated times, editor version, content license); `assetLibrary` (id and version); `levels` (level data plus `id`, `title` and `cellTags`); `campaign`; `gameData` (player, weapons, enemies and pickups, with defaults that reproduce today's behavior); `userAssets` (id, name, MIME type, SHA-256, size, license, attribution); `export` (slug); and an optional `multiplayer` object (section 3.5). Add a canonical serializer with sorted keys. | `src/shared/project/schema.ts`, `validate.ts`, `canonical.ts`, `defaults.ts` (new); `src/sim/validator.ts` (reused for levels); `tests/fixtures/*` | P1.3 | Accepts the default and sample documents. Rejects every file in `tests/fixtures/malicious/` with a path-specific error and never throws. Multiplayer counts as on only when `enabled` is literally `true`. Canonical output is byte-stable. | `npm test` |
| P2.2 | Migrations to v4. Detect v1 (a bare grid array), v2 (`version: "2.0"`), v3 (a `formatVersion: 3` level or manifest) and v4, and chain migrations. Keep cell tags, events and campaign settings. Turn legacy custom textures into `userAssets` with SHA-256. Refuse newer schemas with a message that names the version. Add fixtures for every legacy version, taken from git history and the presets. | `src/shared/project/migrate.ts` (new), `src/shared/project/legacy.ts`, `tests/fixtures/legacy/*` (new) | P2.1 | Every legacy fixture becomes a valid v4 document with grids, textures, entities, events and campaign fields kept. `migrate(v4)` returns an equal document. Save, load, save gives identical canonical JSON. | `npm test` |
| P2.3 | Document store and complete undo. Hold one immutable `ProjectDocV4` in an external store, with a reducer and `useSyncExternalStore` and no new library. Every edit is an action. History keeps references to earlier documents, so unchanged rows are shared, not copied. It merges drag strokes and holds 200 steps. Keyboard shortcuts move into the store. Delete `HistoryManager`. | `src/editor/state/projectStore.ts`, `actions.ts`, `history.ts`, `selectors.ts` (new); `src/editor/engine/HistoryManager.ts` (delete); tests | P2.1 | A test applies every action type, undoes it and redoes it, comparing canonical documents each time. 200 paint strokes on a 128x128 level with 8 layers keep history under 50 MB, counted by retained row arrays. | `npm test` |
| P2.4 | Move App onto the store. Replace App's document `useState`s with selectors and dispatches, one domain per commit (map, entities, events, world, campaign). The four hooks become thin wrappers or disappear. App drops below 800 lines, and the playtest snapshot (P1.7) reads from the store. | `src/editor/App.tsx`, `src/editor/hooks/*`, component call sites | P2.3 | No `useState` in App holds document data. App is under 800 lines. A new e2e test, "edit, undo and redo across map, events, world settings and campaign", passes, and so do the existing ones. | `wc -l`; e2e |
| P2.5 | Local persistence and project management. IndexedDB stores projects, autosaves and user asset blobs. Autosave runs 5 s after the last change, every 30 s during continuous editing, and on `visibilitychange`, keeping the last 5. A recovery prompt appears on load. The File menu gets New (blank or sample), Open file, Open recent, Save (Ctrl+S, to browser storage), Download project file and Close. Request `navigator.storage.persist()` and warn when quota runs low. A second tab on the same project opens read-only (Web Locks API). | `src/editor/persistence/db.ts`, `autosave.ts`, `recovery.ts` (new); `src/editor/components/ide/TopMenuBar.tsx`; `src/editor/components/dialogs/RecoveryDialog.tsx` (new) | P2.4 | e2e makes edits, closes the page without unload, and reopens. Recovery restores the last autosave, with at most 15 s of edits missing. A second tab is read-only. A warning appears when estimated quota use passes 80%. | e2e |
| P2.6 | Portable user assets and import hardening. Uploads become IndexedDB blobs keyed by SHA-256 and are embedded as base64 in the downloaded project file, with the SHA-256 checked on import. Caps: 16 MB per asset, 64 MB per project file, textures at most 2048 px per side (downscaled in a worker). Allowed types: PNG, JPEG, WebP and GLB. A license choice is required at upload: made by me, CC0, CC-BY with attribution text, or other. Custom textures copy an explicit field list, accept only `data:image/(png\|jpeg\|webp)` or library-host URLs, and cannot replace built-in or library IDs. Remove URL import (Q8). | `src/editor/components/inspector/AssetLibraryTab.tsx`, `src/editor/library/*`, `src/shared/project/validate.ts`, `src/runtime/AssetRegistry.ts`, `src/shared/project/legacy.ts` | P2.5 | A project with an uploaded texture and model, downloaded in browser profile A, opens in a fresh profile B with no stand-ins. Oversized or wrong-type uploads are refused with a message. Malicious fixtures (bad schemes, ID collisions) are rejected. | e2e with two contexts; `npm test` |
| P2.7 | Pin and describe the asset library (D4). **In the assets repo:** a CI workflow writes `index.json` (path, SHA-256, size, pack) and `packs.json` (title, author, SPDX license, source URL, license file per pack), makes 128 px thumbnails, and publishes to that repo's Pages under an immutable `/v<major>.<minor>/` folder. **In this repo:** the editor loads the pinned index as a lazy chunk instead of the baked JSON, browses with thumbnails, checks SHA-256 when it fetches an asset for export, and stores `assetLibrary.version` in the project. Custom GitHub repos (Q9) need a `packs.json` before their assets can be exported. | Assets repo: `.github/workflows/publish.yml`, `scripts/build-index.mjs`, `packs.json` (new). This repo: `src/editor/library/libraryIndex.ts` (new), `src/editor/engine/AssetFolderLoader.ts`, `src/editor/engine/bundledGitHubAssetsIndex.json` (delete), `src/export/collect.ts` | P2.6 | A push to the assets repo's `main` changes nothing until the editor's pinned version changes. A tampered asset fails export with an integrity message. Opening the texture browser makes at most 60 requests before scrolling. The main editor chunk loses the 138 KB index. | e2e request count; unit tests |
| P2.8 | Sample project v1, "Proving Grounds". An original three-level campaign built from the library's CC0 assets. It uses doors, keys, secrets, pushwalls, lifts, holes, every enemy type and most event actions. Save it as `samples/proving-grounds.gcs.json` (v4) and offer it under New > From sample. Include an input recording that reaches the level 1 exit, and an action-coverage report script. | `samples/proving-grounds.gcs.json`, `samples/recordings/level1.json`, `src/editor/components/dialogs/NewProjectDialog.tsx`, `scripts/action-coverage.ts` (all new) | P2.7 | Loads without warnings. The recording reaches the exit in a headless sim run. The coverage report lists unused action types (P7.5 takes this to 100%). | `npm test`; `npm run coverage:actions` |

**Risks and fallbacks**
- Moving a 2,450-line App onto a store invites regressions. Fallback: migrate one domain per commit with e2e after each, and keep the old hooks as adapters until the end.
- IndexedDB may be unavailable (some private modes) or the quota tiny. Fallback: detect it, show "autosave unavailable, download your project", and keep manual download working.
- The assets repo may exceed the 1 GB Pages limit (Q5). Fallback: split packs across several Pages repos, or use Cloudflare Pages (free). As a last resort, pin raw URLs to a tag.

**Gate.** The v4 schema, validator and migrations are merged. App runs on the store with complete undo. Autosave and recovery are verified. Projects carry across browser profiles. The library is pinned, with hashes and pack licenses. Sample v1 is committed.

---

### Phase 3: One-click export, single-player

**Objective.** One click produces a deterministic zip that runs unchanged on any static host, with credits and notices, using a prebuilt runtime and no networking code. Single-player projects can pick a single-HTML file instead (Q7).

**Why now.** This is the core promise of the product. It depends on the v4 document (P2) and the clean runtime entry (P1). Phase 5 runtime work then lands inside an export path that already works.

| ID | Task | Files | Depends on | Acceptance criteria | Verify |
|---|---|---|---|---|---|
| P3.1 | Single-player entry. `src/runtime/entries/sp.ts` reads `<meta name="gcs:manifest">` and resolves every URL against `document.baseURI`. It loads the manifest and validates its schema and runtime versions. It shows a boot screen with byte and asset progress, and an error screen built with `textContent`. When Draco files are present, it sets the Draco path relative to the base. `src/export/templates/index.html` carries the single-player CSP (section 3.6) and a `<noscript>` message. | `src/runtime/entries/sp.ts`, `src/runtime/boot/*`, `src/export/templates/index.html` (new) | P1.4, P2.1 | Unit tests resolve URLs correctly for pages at `/`, `/a/b/` and `/a/b/index.html`. `src/runtime` has no absolute fetch. A manifest with a newer schema shows the error screen. | `npm test`; search the code |
| P3.2 | Prebuilt runtime bundles. `scripts/build-runtime.ts` builds `entries/sp.ts` with esbuild (ESM, minified, `es2022`, content-hashed name, `runtimeVersion` defined) into `public/runtime/` (gitignored). It writes `runtime-manifest.json` (version, file names, SHA-256, sizes) and copies the Draco decoder files into the runtime output. `npm run dev` builds once and then watches. `public/draco` stays until P3.6 and the legacy single-HTML runtime until P3.9, so the old exports keep working in between. CI checks G-10 and scans the bundle for the G-05 identifiers. | `scripts/build-runtime.ts`, `scripts/check-runtime-bundle.ts` (new); `package.json`; `.gitignore`; `.github/workflows/ci.yml` | P3.1 | `npm run build` emits hashed runtime files that are listed in `runtime-manifest.json` and served under the base path. The budget and network scans pass. | CI; `npm run metrics` |
| P3.3 | Export worker. `src/export/worker.ts` takes the document, the runtime manifest and the options, then: (1) collects referenced assets; (2) fetches library assets six at a time with a 30 s timeout and 2 retries, checking each SHA-256 against the index; (3) reads user blobs; (4) hashes with `crypto.subtle` and dedupes; (5) names files `assets/<first 16 hex of SHA-256>.<ext>`; (6) builds the game manifest as canonical JSON and renders the templates; (7) zips with fflate under the determinism rules (section 3.4). It posts progress (stage, done, total), supports cancel, and returns typed errors. Remove JSZip. | `src/export/worker.ts`, `collect.ts`, `hash.ts`, `zip.ts`, `manifestBuilder.ts`, `errors.ts` (new); `package.json`; tests | P3.2, P2.7 | A golden test gets a fixed SHA-256 for a fixture project's zip. Duplicates are stored once. Tampered library bytes fail with an integrity error. Cancel ends without a blob. No main-thread task exceeds 50 ms while exporting the sample. | `npm test`; e2e long-task check |
| P3.4 | One-click export UX. The Export menu item starts at once. A minimal Project Settings dialog (title, author, description, slug), which P6.2 later extends, supplies the metadata, so there is no format dialog. Pre-export validation opens a problems list only when errors exist (missing spawn, asset without a license, missing asset, package limits), and then nothing downloads. A progress toast shows stages and Cancel. A success panel shows file name, size, file count, runtime version, SHA-256, and a "How to publish" link. Errors appear in plain text with "Copy details". | `src/editor/components/ide/TopMenuBar.tsx`, `src/editor/export/useExport.ts`, `src/editor/components/export/ExportProgress.tsx`, `ExportProblems.tsx`, `src/editor/components/settings/ProjectSettingsDialog.tsx` (new); `src/editor/components/ide/ExportModal.tsx` (delete) | P3.3 | e2e: one click exports the sample with no further input. A project with an unlicensed upload shows the problems list and downloads nothing. | e2e |
| P3.5 | Credits, notices and license files. Export writes four files. `CREDITS.txt`: each library pack used (title, author, license, source URL) and each upload (name, license, attribution). `THIRD_PARTY_NOTICES.txt`: three.js MIT, Draco Apache-2.0 only when Draco ships, and runtime MIT. `LICENSE-runtime.txt`. `README.txt`: contents, publishing to itch.io, GitHub Pages and other static hosts, and testing locally with any static file server. The runtime reads the same credits data for its Credits screen (P5.1). | `src/export/credits.ts`, `notices.ts`, `src/export/templates/README.txt`, `src/export/templates/notices/*` (new) | P3.3 | Unit tests: every manifest asset appears in `CREDITS.txt`. The Draco notice is present exactly when Draco files are. An asset without license data fails the export. | `npm test` |
| P3.6 | Retire the source-project exporter. Delete `projectExporter.ts`, the eager `?raw` glob and that exporter's Node fallbacks. Move `public/draco` into the runtime output and point the editor's Draco path there. Keep a generic secret scan over the text files in the new pipeline. The single-HTML exporter stays until P3.9 replaces it. | `src/export/projectExporter.ts` (delete); `public/draco/*` (move); `src/export/safetyScanner.ts`; tests | P3.4 | The editor's main chunk is at least 150 KB gzip smaller than the P0.7 baseline. The build emits each Draco file once. Tests are updated and pass. | `npm run metrics`; build log |
| P3.7 | Export end-to-end tests. Playwright opens the sample, clicks Export, captures the download and unzips it to a temp folder. It serves the folder under `/games/proving-grounds/` on one port and at the root of a second origin, opens each, and waits for `gcs:first-frame`. It asserts no console errors, no CSP violations, only same-origin requests, and three campaign levels (via the level 1 recording). Then it exports again and compares SHA-256. Chromium runs in CI; Firefox and WebKit run nightly. | `e2e/export-sp.spec.ts`, `e2e/helpers/static-server.ts`, `unzip.ts` (new) | P3.4, P3.5 | Green in CI, with the nightly matrix green as well | CI |
| P3.8 | Host compatibility. The exporter warns about host limits: 1,000 files, 200 MB per file and 500 MB in total by default for itch.io (recheck these on itch.io's HTML5 docs before release), and 100 MB per file for GitHub Pages. Upload the unchanged sample zip by hand to a draft itch.io project, a GitHub Pages test repo, and one more free static host, and record the results. | `src/export/hostLimits.ts`, `docs/qa/host-compat.md` (new) | P3.7 | The unchanged zip runs on all three hosts, recorded with screenshots | Manual, recorded |
| P3.9 | Single-HTML export option (Q7, section 3.4). Build `entries/sp.ts` a second time as a classic script. Add a packager to the export worker that writes one `<slug>-<version>.html` from the same manifest, assets, Draco decoder and credits as the zip. Add the format choice to Project Settings for single-player projects ("Web package (zip)" by default, or "Single HTML file"); Export stays one click. Then delete the old single-HTML exporter and launcher, `public/single-html-runtime.js` with its build script and staleness test, and the `startGame` facade. | `scripts/build-runtime.ts`, `src/export/singleHtml.ts` (new), `src/export/worker.ts`, `src/runtime/boot/*`, `src/editor/components/settings/ProjectSettingsDialog.tsx`; `src/export/singleHtmlExporter.ts`, `singleHtmlRuntimeBuild.ts`, `src/runtime/singleHtmlLauncher.ts`, `src/runtime/startGame.ts`, `public/single-html-runtime.js`, `scripts/build-single-html-runtime.ts` (delete) | P3.5, P3.7 | G-19 passes. Playwright opens the exported file from disk and from a static server: every campaign level is present, a Draco model loads, and no network request or CSP violation occurs. Exporting twice gives identical bytes. The classic-script runtime passes the G-05 scan and the G-10 budget. `vite build` prints no `node:` externalization warnings. | e2e over `file://` and HTTP; CI scans |

**Risks and fallbacks**
- An fflate upgrade could change zip bytes. Fallback: pin fflate exactly, and update the golden hash deliberately when upgrading.
- itch.io may change its limits or iframe behavior. Fallback: the thresholds are configuration values, and `README.txt` tells creators where to check.
- Library fetches may be rate-limited during export. Fallback: retry with backoff, and cache fetched library assets in the Cache API so repeat exports skip the network.

**Gate.** One click produces a zip. The zip runs unchanged on three hosts and under a subpath, and is byte-identical across runs and browsers. Credits, notices and README are present and correct. The single-player bundles pass the network scan. The single-HTML option plays from disk with every campaign level. The old exporters are gone, and the e2e suite runs in CI.

---

### Phase 4: One simulation

**Objective.** Move weapons, hit tests, enemy AI and pickups into the deterministic sim, and make the Three.js layer a pure view.

**Why now.** A multiplayer server cannot run Three.js-side combat and AI (section 1.5). The editor's weapon and enemy setup (P6.3) needs data-driven weapons in the sim. The live-versus-replay divergence is a bug class of its own. This phase can run in parallel with P2 and P3 because it touches only `src/sim` and `src/runtime`.

| ID | Task | Files | Depends on | Acceptance criteria | Verify |
|---|---|---|---|---|---|
| P4.1 | Weapons and hitscan in the sim. Weapons come from `gameData.weapons`: damage, cooldown in ticks, ammo type and cost, spread in BAM, range, pellets. The default weapon reproduces today's damage of 25 and 0.2 s cooldown (6 ticks). Hitscan uses integers: DDA through the grid and closed doors, then the nearest hit among entity cylinders and solid static-model boxes. Spread comes from the sim RNG. There is no free reload; ammo comes from pickups. Fire is a `PlayerTickInput` flag. | `src/sim/combat.ts` (new), `src/sim/types.ts`, `src/sim/executor.ts`, `src/sim/raycast.ts`, `src/shared/project/defaults.ts`, tests | P1.6, P2.1 | Scenario tests: shots hit entities in view, stop at walls and closed doors, and follow vertical-level rules. Cooldown and ammo are enforced. The same inputs give the same hashes on every run. | `npm test` |
| P4.2 | Enemy AI in the sim, part 1. Port the behavior of `EnemyAISystem` to `src/sim/ai/`: the idle, patrol, chase, attack, pain and dead states; sight by DDA within range; a memory timer; waking on sight, damage and alerts; integer movement with circle collision against the grid, doors, footprints and other entities. | `src/sim/ai/*.ts` (new), `src/sim/entitySim.ts`, tests | P4.1 | Scenario tests: an enemy that sees the player chases it around a corner, stops at closed doors, loses track after the memory timeout, and does not overlap other enemies. AI for 64 enemies stays under 0.5 ms p95 per tick. | `npm test`; `npx vitest bench` |
| P4.3 | Enemy AI, part 2. Melee and ranged attacks with cooldowns and damage from `gameData.enemies`. Ambush and patrol flags. Vertical-level rules (step heights, no attacks across floors). Target choice among several players: nearest visible, held for a short time. Deterministic loot drops. | `src/sim/ai/*`, `src/sim/types.ts`, tests | P4.2 | Scenario tests cover each attack type, ambush, patrol and the vertical rules. A parity checklist against the old AI (reaches the player; attack cadence within 10%) is signed off. | `npm test`; manual checklist |
| P4.4 | Pickups and player state in the sim. Health, ammo, weapon and key pickups become sim entities with a pickup radius. Each player has an inventory and a current weapon. Pickups can respawn (deathmatch uses this later). The HUD reads its data from sim state. | `src/sim/pickups.ts` (new), `src/sim/types.ts`, `src/sim/executor.ts`, tests | P4.1 | Pickups apply once and respect maximum values. Keys still open doors. Existing key and door tests pass unchanged. | `npm test` |
| P4.5 | Runtime as a view. Replace the logic in `EnemyAISystem` and `CombatSystem` with view systems. `EntityView` interpolates transforms from the sim, picks animations by state, and draws hit flashes and health bars. `WeaponView` draws muzzle flashes and tracers and plays sounds from sim outputs. Delete the post-step collision patch and the agent-to-sim copy. Cache door and key lookups instead of calling `getObjectByName` every frame. | `src/runtime/EnemyAISystem.ts`, `CombatSystem.ts` (replaced); `src/runtime/view/EntityView.ts`, `WeaponView.ts` (new); `src/runtime/core/GameRuntime.ts`; e2e | P4.3, P4.4 | e2e records a 60 s live session and replays its inputs headless, getting an identical hash sequence (this is G-15). No Three.js code decides damage, hits or positions (review, plus a search for `damageEntity` in `src/runtime`). | e2e; search |
| P4.6 | Multi-player semantics in the sim. Numbered spawn points in level data. Joining and leaving mid-game. Per-player inventory and stats. Triggers with player activators handle several players. In co-op, the level ends when any player reaches an exit; deathmatch match rules arrive in P9.7. | `src/sim/players.ts` (new), `src/sim/actionExecutor.ts`, `src/sim/types.ts`, `src/shared/project/schema.ts` (spawn points), tests | P4.5 | Four-player scripted scenarios run deterministically. A join or leave does not change other players' outcomes. Single-player fixtures behave as before. | `npm test` |
| P4.7 | Re-baseline and feel review. Regenerate the determinism baselines with a written note. Update the sample recordings. Record before-and-after video of the same route, then tune constants until you accept the feel. Confirm G-09. | `src/sim/__tests__/*`, `samples/recordings/*`, `docs/qa/feel-review.md` (new) | P4.6 | You sign off the feel review. G-09 is met and all tests are green. | Manual review; bench |

**Risks and fallbacks**
- The new AI may feel worse than the old one. Fallback: every constant is data-driven and tunable; the old AI stays in git history for side-by-side comparison; the feel review is a gate.
- Integer hit tests may miss on oddly shaped models. Fallback: per-model hit-box overrides in game data.
- 64 enemies may exceed the sim budget. Fallback: stagger sight checks (each enemy every 2nd or 4th tick) and add a spatial hash for collisions.

**Gate.** Live play equals replay, and the renderer decides nothing. The four-player scenarios pass. G-09 is met. You have accepted the feel.

---

### Phase 5: Game runtime completeness

**Objective.** Give exported games what players expect from a shipped browser game: menus, settings, rebindable controls and gamepads, saves, audio controls, quality presets, and correct behavior when the browser takes away focus, pointer lock or the GPU context.

**Why now.** Single-player export already works (P3), so every runtime improvement is verified inside a real export. Weapon-related HUD and menus read sim state, which P4 provides. The HUD reads player data through a `PlayerViewState` interface, so this phase can also start before P4 finishes.

| ID | Task | Files | Depends on | Acceptance criteria | Verify |
|---|---|---|---|---|---|
| P5.1 | Game shell and a CSP-safe HUD. Main menu (Play, Continue, Settings, Credits), a pause menu on Esc, settings and credits screens, and level-complete and defeat screens. Build everything with DOM APIs and a stylesheet: no `innerHTML`, no inline style attributes in markup. Theme tokens (colors and labels) come from project settings. Remove the editor-style buttons from the HUD. | `src/runtime/shell/*`, `src/runtime/styles/game.css` (new); `src/runtime/hud/CombatHUD.ts`; `src/runtime/hud/MinimapHUD.ts` | P3.1 | e2e reaches every menu by keyboard alone. `src/runtime` contains no `innerHTML`. The exported page runs under `style-src 'self'` with no violations. | e2e; search the code |
| P5.2 | Settings. A versioned settings model stored in `localStorage` under the game's ID, wrapped in try/catch so any error gives defaults. Settings: mouse sensitivity, invert Y, FOV (60 to 110), master, effects and music volume, quality preset, head bob, screen shake, reduce flashing, crosshair, show FPS. All apply live. | `src/runtime/settings/*` (new), `src/runtime/shell/SettingsScreen.ts` | P5.1 | Unit tests cover load, save, migration and corrupt input. e2e changes settings, reloads, and finds them kept; corrupt storage gives defaults with no error. | `npm test`; e2e |
| P5.3 | Input actions, rebinding and gamepads. One action map (move, look, fire, use, jump, crouch, sprint, next and previous weapon, map, pause) serves keyboard, mouse and Gamepad API standard mapping, with dead zones, look acceleration and trigger thresholds. A rebinding screen detects conflicts. Menus work by gamepad. Pointer lock uses `unadjustedMovement` where supported and falls back to drag-look. | `src/runtime/input/*`, `src/runtime/shell/ControlsScreen.ts` (new); `src/runtime/core/InputController.ts` | P5.1 | Unit tests pass with a mocked Gamepad API. Manual tests with an Xbox and a PlayStation controller on Chrome, Firefox and Safari pass the input section of the QA checklist (G-12). | `npm test`; manual |
| P5.4 | Browser behavior. A fullscreen toggle in the menus and on a key. Pause and audio suspend when the tab hides or the window loses focus. On `webglcontextlost`: prevent the default, pause, and show a message. On `webglcontextrestored`: rebuild GPU resources and resume. Handle DPR changes and resizes. Show a clear message when WebGL2 is missing or the device is touch-only (Q12). | `src/runtime/core/RenderSystem.ts`, `src/runtime/shell/*`, `src/runtime/boot/capabilities.ts` (new) | P5.1 | e2e forces a context loss through `WEBGL_lose_context`: the message appears and the game recovers to a rendered frame. The tick count does not move while the tab is hidden. A launch with WebGL disabled shows the unsupported message (G-11, G-18). | e2e |
| P5.5 | Audio. Master, effects and music buses with volume settings. Spatial effects through `PannerNode` for doors and enemies. Unlock on first input, and suspend while hidden. Optional per-level music from an uploaded OGG or MP3 that carries a license (P2.6 rules). Replaces `SoundEffects.ts`. | `src/runtime/audio/*` (new), `src/shared/project/schema.ts` (music field) | P5.2 | Unit tests for bus gains. Manual check: sounds pan with direction and stop when the tab is hidden. | `npm test`; manual |
| P5.6 | Save data. A per-game save in `localStorage`, keyed by game ID and major version, holding the reached level and carried stats. Continue on the main menu. A corrupt save is ignored (G-14). | `src/runtime/save/*` (new), `src/runtime/shell/MainMenu.ts` | P5.1 | e2e finishes level 1 and reloads; Continue starts level 2 with the carried stats. A corrupt save gives a fresh start with no error. Whether saves persist for the single-HTML file opened from disk is checked in each browser and recorded. | e2e; manual |
| P5.7 | Rendering quality and frame budget. Quality presets: Low (pixel ratio 1, no shadows, no antialiasing), Medium (pixel ratio up to 1.5, no shadows), High (pixel ratio up to 2, shadows). Instance repeated static models (one `InstancedMesh` per model mesh). Draw the minimap on a canvas. Add a debug overlay (`renderer.info` and sim tick time) and a benchmark mode (`?benchmark=1`) that plays a recorded route and prints FPS average and 1% low. | `src/runtime/core/RenderSystem.ts`, `src/runtime/WorldBuilder.ts`, `src/runtime/EntityLoader.ts`, `src/runtime/hud/MinimapHUD.ts`, `src/runtime/debug/*` (new) | P5.1 | Benchmark results for the reference PC and the low-end floor, recorded in `docs/qa/perf.md`, meet G-08. The heaviest sample level stays at or under 400 draw calls on Medium (`renderer.info.render.calls`). The minimap no longer uses `innerHTML`. | Manual benchmark |

**Risks and fallbacks**
- A context restore may leave black textures. Fallback: on restore, rebuild the world and re-upload textures from cached bytes.
- Safari's gamepad mapping may differ. Fallback: a per-browser mapping table plus a calibration screen.
- Some browsers do not support `unadjustedMovement`. Fallback: feature-detect it and request pointer lock without it.

**Gate.** G-11 to G-14, G-17 and G-18 pass. The benchmark meets G-08, or you accept a written exception.

---

### Phase 6: Editor completeness and UX

**Objective.** Make the editor a dependable public tool: contained errors, full project settings, game data editors for enemies, weapons and pickups, the missing level tools, live validation, a better playtest, a usable asset browser, onboarding and accessibility.

**Why now.** These build on the store (P2) and on data-driven weapons and enemies (P4). Doing them earlier would mean writing them twice.

| ID | Task | Files | Depends on | Acceptance criteria | Verify |
|---|---|---|---|---|---|
| P6.1 | Error containment. React error boundaries around the map, viewport, inspector and dialogs, plus a top-level fallback. Global `error` and `unhandledrejection` handlers feed a Problems panel and the status bar. The fallback offers "Download recovery file". No error data is sent anywhere. | `src/editor/components/errors/*` (new), `src/editor/App.tsx`, `src/main.tsx` | P2.5 | e2e throws a render error through a test-only fault flag. The fallback appears, the document survives, and the recovery file loads (E-08). | e2e |
| P6.2 | Project Settings dialog with five tabs, extending the minimal dialog from P3.4. General: title, author, description, version, content license. Game: player start stats, difficulty multipliers. Controls: default bindings. Export: slug and a file name preview. Multiplayer: hidden until P10.1. Settings are stored in the document and are undoable. | `src/editor/components/settings/*`, `src/shared/project/schema.ts` | P2.4, P3.4 | e2e changes settings, undoes and redoes them, and exports. The zip name and README use the new title. | e2e |
| P6.3 | Game data editors. List-and-form editors for enemies (model, health, speed, damage, attack type and range, sight range, drops), weapons (name, damage, cooldown, ammo, spread, range, pickup model, sound) and pickups. Placed entities reference an archetype, with optional per-instance overrides. Validation messages appear inline. | `src/editor/components/gamedata/*` (new), `src/editor/state/actions.ts`, `src/shared/project/schema.ts` | P4.4, P6.2 | e2e changes a weapon's damage and exports. In the exported game, a recording kills a test enemy in the new number of shots. Invalid values are blocked with a message. | e2e |
| P6.4 | Level editing gaps. A cell tag editor for doors and movers. Multiple numbered spawn points. Rectangle select, fill, copy and paste. Delete, duplicate and reorder for campaign levels. The renamed presets (P0.1) become templates. | `src/editor/components/MapEditor2D.tsx`, `src/editor/components/inspector/CellInspectorTab.tsx`, `src/editor/components/campaign/*` (new), `src/editor/state/actions.ts` | P2.4 | e2e covers each operation, including undo. A unit test confirms tags survive save and load. | e2e; `npm test` |
| P6.5 | Validation and playtest. A Problems list that updates as you edit: no spawn, no exit, exit unreachable from the spawn (ignoring keys), missing assets, unlicensed uploads, too many entities, and later the multiplayer spawn counts. "Play from here". Play the level or the whole campaign. A playtest overlay with FPS, tick time and entity count. The 3D editor rebuilds only changed chunks, replacing the full stringify and rebuild. | `src/editor/validation/*` (new), `src/editor/playtest/*`, `src/editor/editor3d/EditorScene.ts` | P2.4, P1.7 | e2e makes each problem type appear and link to its cell. Play from here spawns at the selected cell. Painting a 64x64 level keeps each 3D update under 16 ms (debug timer). | e2e |
| P6.6 | Asset browser. A virtualized grid with thumbnails (P2.7), search, filters by pack and license, license badges, the upload license prompt, and a missing-assets report. Split `AssetLibraryTab.tsx` (1,169 lines). | `src/editor/components/inspector/AssetLibraryTab.tsx`, `src/editor/components/assets/*` (new) | P2.7 | e2e scrolls the full texture list; requests stay proportional to the visible items. The missing-assets report lists every stand-in in the open project. | e2e |
| P6.7 | Onboarding and help. A welcome screen (New, Open, Sample, Recent), a keyboard shortcuts panel, a Help menu linking to the docs, and an About dialog with versions (E-17). Plain menu names: "Visual Triggers" becomes "Events". Review every tooltip. | `src/editor/components/welcome/*`, `help/*` (new); `src/editor/components/ide/TopMenuBar.tsx` | P2.5 | e2e: the first visit shows the welcome screen, and About shows the editor, runtime and schema versions. | e2e |
| P6.8 | Editor accessibility. Accessible names on every icon button, a sensible focus order, focus traps in dialogs, keyboard-operable menus, and contrast fixes for muted text. axe checks run in e2e on the main views. | `src/editor/components/**`, `src/editor/index.css`, `e2e/a11y.spec.ts` (new) | P6.7 | axe reports 0 serious or critical issues on the welcome screen, the editor, settings and the export flow. The keyboard-only section of the QA checklist passes (E-13, E-14). | e2e; manual |

**Risks and fallbacks**
- The game data editors may grow large. Fallback: ship enemies and weapons first, and keep fixed pickup types until later.
- Incremental 3D rebuilds may get complicated. Fallback: debounce full rebuilds to 150 ms after the last edit, and replace the stringify key with a version counter.

**Gate.** E-01 to E-09, E-13, E-14 and E-17 pass. The game data e2e (P6.3) shows that editor data drives exported games.

---

### Phase 7: Hardening and QA

**Objective.** Measure and pass every release criterion: security, performance, accessibility, and full feature coverage through the sample game.

**Why now.** All the features exist. Hardening earlier would chase moving code. The sample game can only exercise every feature once every feature exists.

| ID | Task | Files | Depends on | Acceptance criteria | Verify |
|---|---|---|---|---|---|
| P7.1 | Editor CSP. A Vite plugin adds the editor policy (section 3.6) to production builds only, along with a referrer-policy meta tag. Every e2e test listens for `securitypolicyviolation` and fails on any. Try `style-src 'self'`, and keep `'unsafe-inline'` only if violations remain. Restrict custom asset repos to GitHub hosts. | `vite.config.ts`, `scripts/vite-plugin-csp.ts` (new), `e2e/fixtures.ts` | P6.8 | The production editor carries the meta CSP. The full e2e suite triggers zero violations (E-15, E-16). | e2e |
| P7.2 | Import hardening and fuzzing. A glTF and GLB sanitizer rejects external URIs and oversized buffers before loading. Images decode in a worker with dimension caps. A fuzz test runs 10,000 mutated sample documents through validation and migration: no throws, no prototype pollution, and every rejection names a path. Complete the malicious fixture suite. | `src/editor/library/gltfSanitizer.ts`, `src/editor/library/imageDecode.worker.ts`, `src/shared/project/__tests__/fuzz.test.ts` (new); `tests/fixtures/malicious/*` | P2.6 | S-02 passes. A glTF that references `https://example.com/x.png` is refused with a message, and no request goes out. | `npm test`; e2e network check |
| P7.3 | Supply chain gates. In CI: `npm audit --omit=dev --audit-level=high`, a license allowlist script (an offline walk of the lockfile tree, with S-03's allowlist), and build provenance attestations for release artifacts. Turn on GitHub secret scanning with push protection (free for public repos). Add Dependabot with grouped weekly updates. | `.github/workflows/ci.yml`, `scripts/check-licenses.ts`, `.github/dependabot.yml` (new) | P0.6 | Each gate fails on a planted violation and passes on the clean tree (S-01, S-03). | Throwaway PR |
| P7.4 | Performance budgets. Split the editor so the 3D editor, export worker, event editor and game data editors load on demand. Enforce E-10 and G-10 budgets in CI. Add Playwright long-task checks for editing and playtest (E-11) and the 10-cycle memory soak (E-09). Record reference-hardware results. | `vite.config.ts`, `src/editor/**` (lazy imports), `scripts/check-budgets.ts`, `e2e/perf.spec.ts` (new), `docs/qa/perf.md` | P6.5, P5.7 | E-09, E-10, E-11, G-07, G-08 and G-10 pass, or you accept a written exception | CI; manual |
| P7.5 | Sample game complete. "Proving Grounds" v2 uses every trigger, condition and action type, every cell type, vertical features, every weapon, enemy and pickup, campaign carry-over, light effects with the photosensitivity notice, and numbered spawns. A test fails when an action type exists that the sample does not use. Record a golden export SHA-256. | `samples/proving-grounds.gcs.json`, `scripts/action-coverage.ts`, `src/shared/__tests__/sampleCoverage.test.ts` (new) | P6.3, P6.4 | Coverage is 100%. Every level can be completed by its recording. The golden hash test passes. | `npm test` |
| P7.6 | Manual QA and cross-browser pass. Write `docs/qa-checklist.md` (section 3.7). Run it on Chrome, Edge, Firefox and Safari, with two controllers, on itch.io and GitHub Pages, and with the single-HTML export opened from disk. File and triage bugs, then fix or defer every release blocker. | `docs/qa-checklist.md`, `docs/qa/results-<version>.md` (new) | P7.4, P7.5 | The checklist has been run on four browsers, with zero open release blockers | Manual, recorded |
| P7.7 | Threat model and security policy. `docs/security/threat-model.md` covers the editor, project files, export, runtime and a stub for the server. `SECURITY.md` describes GitHub private vulnerability reporting, which gets turned on. Link both from the README. | `docs/security/threat-model.md`, `SECURITY.md` (new) | P7.2 | Both documents reviewed, and reporting turned on in the repo settings | Manual |

**Risks and fallbacks**
- The CSP may break something only in Safari. Fallback: WebKit runs in the nightly e2e; widen the policy for that one source, with a comment explaining why.
- Fuzzing may find crashes deep in migrations. Fallback: a top-level guard turns exceptions into validation errors, then fix the root causes.

**Gate.** Every E, G and S criterion is measured and passing. The QA checklist has been run, and no release blocker is open.

---

### Phase 8: Release pipeline, licensing, documentation and single-player launch

**Objective.** Ship v1.0.0: a reproducible release, correct licenses, complete docs, and sample games on the distribution channels.

**Why now.** Release automation, docs and screenshots are wasted effort until the product has stabilized (P7 gate).

| ID | Task | Files | Depends on | Acceptance criteria | Verify |
|---|---|---|---|---|---|
| P8.1 | Versioning and release automation. One version in `package.json`. `runtimeVersion`, `PROJECT_SCHEMA_VERSION`, `MANIFEST_SCHEMA_VERSION` and `PROTOCOL_VERSION` live in `src/shared/versions.ts`. `git-cliff` generates `CHANGELOG.md` from conventional commits. A tag workflow builds the editor, the runtime bundles and the sample exports; attaches them to a GitHub Release with `SHA256SUMS.txt` and provenance; and deploys Pages from the tag (Q15). A rebuild job checks S-07. | `src/shared/versions.ts`, `.github/workflows/release.yml`, `cliff.toml`, `CHANGELOG.md` (new); `.github/workflows/deploy.yml`; `package.json` | P7.3 | A test tag `v0.9.0-rc.1` produces a release with artifacts and checksums and deploys Pages, and the rebuild job matches the runtime hashes | Test tag |
| P8.2 | Licensing final. Confirm Q2 and Q3. Ship the editor's `THIRD_PARTY_NOTICES.md` (React, React DOM and scheduler MIT; lucide-react ISC; fflate MIT; three.js MIT; Tailwind's generated CSS MIT) and show it on an in-editor licenses page. Check each assets-repo pack against its license file and record the sign-off in `packs.json` (Q4). Run a name and trademark check on the chosen product name. | `LICENSE`, `THIRD_PARTY_NOTICES.md`, `src/editor/components/help/LicensesPage.tsx` (new); assets repo `packs.json` | P8.1 | S-03 and S-04 pass. Every pack has a recorded license check. | CI license script; manual |
| P8.3 | Creator docs, part 1: `docs/creators/getting-started.md`, `editor-tour.md`, `levels.md`, `enemies-weapons-pickups.md` and `playtesting.md`, with screenshots from the sample. | `docs/creators/*` (new) | P7.6 | A first-time tester builds and playtests a one-room level from the docs alone (recorded) | Manual |
| P8.4 | Creator docs, part 2. `events-reference.md` is generated from the sim's action and condition types by a script, so it cannot drift. Also `exporting-and-publishing.md` (one-click export; the single-HTML option; itch.io settings; GitHub Pages; other static hosts; local testing), `assets-and-licenses.md`, `troubleshooting.md` and `faq.md`. | `docs/creators/*`, `scripts/gen-events-reference.ts` (new) | P8.3 | CI fails when the generated reference is stale. A tester publishes the sample to itch.io from the docs alone (S-05). | CI; manual |
| P8.5 | Contributor docs and repo templates. A full `README.md`, `CONTRIBUTING.md`, `docs/architecture.md` (boundaries, data flow, how to add an action type), `docs/testing.md`, `CODE_OF_CONDUCT.md` (Contributor Covenant), and issue and PR templates. | The files listed (new) | P8.1 | A new contributor runs the app and the tests from the README alone (recorded) | Manual |
| P8.6 | Distribution and launch (section 3.8). Publish the sample games to itch.io and GitHub Pages. Make an itch.io page for the editor that links to the Pages editor and offers the offline editor zip from the release. Add screenshots and a short GIF. Run the launch checklist and tag `v1.0.0`. | `docs/launch-checklist.md` (new); release | P8.2, P8.4, P8.5 | Every launch checklist item is checked, v1.0.0 is released, and the editor is live from the tag | Checklist |

**Risks and fallbacks**
- A pack's license may turn out not to be CC0. Fallback: drop the pack from the index (a new library version) and replace its assets in the sample.
- The chosen name may clash with an existing product. Fallback: settle the name before P8.2 starts; a rename touches only UI strings, the README and the package name.

**Gate.** v1.0.0 is tagged and released. The editor is live on Pages from the tag. The sample games are live on itch.io and Pages. The docs are complete, and every launch checklist item is checked.

---

### Phase 9: Multiplayer core

**Objective.** An authoritative TypeScript server that runs the same sim as the client, plus the netcode, protocol and game modes, all proven by bots and latency tests before any creator sees the feature.

**Why now.** It needs one simulation (P4) and prebuilt runtime bundles (P3). Single-player v1.0 can ship before this starts.

| ID | Task | Files | Depends on | Acceptance criteria | Verify |
|---|---|---|---|---|---|
| P9.1 | Protocol. `src/net/protocol` defines message type IDs. Binary codecs (`DataView`) cover input (sequence, tick, button bits, move axes, yaw and pitch deltas in BAM) and snapshots (tick, last processed input per player, players and entities with integer positions, yaw, state and health, door and mover progress, events). JSON control messages (hello, welcome, reject, ping, pong, bye) have validators. Includes `PROTOCOL_VERSION` and size limits. There are no file or blob messages. | `src/net/protocol/*` (new), tests | P4.6 | Every message round-trips. 100,000 random byte buffers each decode to a typed error, never a throw. Size caps are enforced (M-11). | `npm test` |
| P9.2 | Server core. `src/server/main.ts` runs an HTTP server with `/healthz`. A `ws` WebSocket server on one path uses a 4 KB `maxPayload` and turns off per-message compression. On every connection it checks the origin allowlist, the per-IP cap and the connection rate, then the version and content hash in `hello`. One room per process runs the sim at 30 Hz on a monotonic clock, with a per-player input queue and a small jitter buffer. It sends snapshots every tick (configurable to every 2 ticks), uses heartbeats and a 10 s timeout, and writes JSON-line logs. Config comes from `server.config.json` and flags, and the server shuts down cleanly. | `src/server/*` (new), `tsconfig.node.json`, `package.json` (add `ws`), tests | P9.1 | In-process integration tests: two clients join, move and see each other. Forged and oversized messages disconnect only the sender. A wrong origin is refused. `/healthz` reports ready. | `npm test` |
| P9.3 | Client networking and join screen. `src/net/client` provides a WebSocket transport with backoff, a clock offset from ping and pong, and sequence-numbered input. A snapshot buffer uses the adaptive interpolation delay (section 3.5) to render remote players and entities. `src/runtime/entries/mp.ts` adds a join screen (name, connect, status, errors) and, when the creator allows it, an offline single-player option. | `src/net/client/*`, `src/runtime/entries/mp.ts`, `src/runtime/shell/JoinScreen.ts` (new) | P9.2 | e2e with an in-process server: two browser contexts join and see each other move smoothly at 0 ms and at 150 ms simulated round trip | e2e |
| P9.4 | Prediction and reconciliation. Extract the sim's player movement into a pure function (`src/sim/movement.ts`) that the client runs every frame for the local player. On each snapshot, the client resets to the server state at the last acknowledged input and replays the rest. Errors are smoothed over 100 ms when small and snapped when large. | `src/net/client/prediction.ts` (new), `src/sim/movement.ts` (extracted) | P9.3 | Bot test at 150 ms round trip and 30 ms jitter: corrections over 0.5 m occur less than once per minute per client (part of M-06) | Bot harness |
| P9.5 | Lag-compensated hitscan. The server keeps one second of per-tick positions. A fire input carries the render tick the client saw. The server rewinds targets to that tick when it is within 200 ms, clamps older ticks, and runs the sim's hit test. Hit confirmations drive client hit markers. The server enforces fire rate. | `src/server/lagComp.ts` (new), `src/sim/combat.ts`, `src/net/protocol/*` | P9.4 | A target under the crosshair at the client's render tick is hit at 150 ms round trip. Shots older than 200 ms are clamped. Forged high fire rates are ignored (M-12). | `npm test`; bot harness |
| P9.6 | Co-op rules. Shared world and enemies. Each player spawns at a numbered spawn and respawns at a checkpoint after a delay. Any player at the exit moves everyone to the next level with per-player carry-over. Enemies target the nearest visible player. Friendly fire is a setting. | `src/sim/modes/coop.ts` (new), `src/server/room.ts` | P9.5 | A two-bot scripted co-op run completes level 1 of the sample, and respawn and level change work for both bots | Bot harness |
| P9.7 | Deathmatch rules. Player-versus-player damage, frag counting, respawn with 1 s of protection, frag and time limits, a scoreboard, and pickup respawn timers. Enemies are off by mode. | `src/sim/modes/deathmatch.ts`, `src/runtime/shell/Scoreboard.ts` (new) | P9.5 | A bot match reaches the frag limit and ends, and the scoreboard matches server state | Bot harness |
| P9.8 | Reconnect and resilience. A random 128-bit reconnect token is issued at join and kept in `sessionStorage`. The server holds the slot for 30 s while the client retries with backoff, and sends a full snapshot on rejoin. Clear screens cover version mismatch, server full, server restarted and connection lost. | `src/net/client/reconnect.ts`, `src/server/sessions.ts` (new) | P9.3 | e2e cuts the socket for 10 s; the client returns to the same slot with its stats intact. After 35 s the slot is free (M-08). A wrong protocol version shows the mismatch screen (M-10). | e2e |
| P9.9 | Bots, load and latency testing. Headless Node bots send scripted inputs. A TCP proxy adds delay and jitter. Metrics cover tick time p95, bandwidth per client and memory. CI runs a nightly 1 h soak with 8 bots, and a 24 h soak on the reference server is documented. | `tools/bots/*`, `tools/latency-proxy/*`, `.github/workflows/nightly.yml`, `docs/qa/mp-load.md` (new) | P9.6, P9.7 | M-05, M-06, M-07 and M-09 pass and are recorded | Nightly CI; manual soak |

**Risks and fallbacks**
- TCP head-of-line stalls may cause visible hitches under real packet loss. Fallback: a larger adaptive buffer, extrapolation up to 100 ms, and later WebTransport behind the transport interface (D12).
- The server tick may exceed budget with 8 players and 64 enemies. Fallback: cap enemies per level in multiplayer projects, and stagger AI sight checks.
- Prediction may diverge around movers and doors. Fallback: predict only the player's own movement against the doors in the latest snapshot. Never predict door state.

**Gate.** M-05 to M-12 pass in the harness, and the protocol fuzz is clean. Two people on separate machines play co-op and deathmatch over the internet against a TLS server.

---

### Phase 10: Multiplayer product

**Objective.** Make multiplayer a creator feature. Creators reach it through a deliberate enable flow, it still exports in one click, its server package runs with one command, and a guide covers hosting.

**Why now.** Phase 9 proved the netcode. This phase adds the editor flow, the packaging, the guide and the release.

| ID | Task | Files | Depends on | Acceptance criteria | Verify |
|---|---|---|---|---|---|
| P10.1 | Enable flow (section 3.5): the Enable button, a confirmation dialog with a required checkbox, required fields with validation, and spawn checks in the Problems list. `multiplayer.enabled: true` is written only on confirmation. Disabling takes one click and keeps the settings. The Export label shows "Export (multiplayer)". | `src/editor/components/settings/MultiplayerTab.tsx` (new), `src/shared/project/schema.ts`, `src/editor/validation/*` | P9.8, P6.2 | e2e: the flow cannot finish without the confirmation, an invalid server address blocks export, and disabling returns exports to single-player (M-01) | e2e |
| P10.2 | Server package. `scripts/build-server.ts` bundles `src/server/main.ts` with esbuild into one `server.mjs`, targeting Node 24, with `ws` included and optional native add-ons excluded. `scripts/build-runtime.ts` also builds the multiplayer runtime (`entries/mp.ts`). When multiplayer is on, export writes `server/` and `game/` (section 3.5). `server/` gets a Dockerfile (Node 24 Alpine, non-root, health check) and a `compose.yaml` with an optional Caddy service for automatic HTTPS. `game/` gets a `config.json` for the server address. | `scripts/build-server.ts`, `src/export/templates/server/*` (new); `src/export/worker.ts`; `scripts/build-runtime.ts` | P10.1 | One click gives one zip (M-02). On a fresh machine, `node server/server.mjs` and `docker compose up` both start a healthy server with no install step (M-04). | e2e; manual on a fresh VM |
| P10.3 | Multiplayer export end to end. Playwright exports the sample with multiplayer on, unzips it, and starts `node server/server.mjs` on a free port. It serves `game/` statically and opens two contexts that join and see each other. It runs a deathmatch shot and a co-op enemy kill, then cuts and restores one connection. It then exports the same project with multiplayer off and asserts there is no `server/`, the single-player bundle is used, and the network scan passes (M-03). | `e2e/export-mp.spec.ts` (new) | P10.2 | Green in CI | CI |
| P10.4 | In-editor multiplayer preview (optional). Run the server room in a Web Worker, with two client views connected through `MessageChannel` behind the same transport interface. Creators can then try multiplayer without a server. | `src/editor/playtest/mpPreview/*`, `src/net/client/transports/messageChannel.ts` (new) | P10.3 | Two views in the editor play co-op on the sample with no network requests | e2e |
| P10.5 | Multiplayer guide in `docs/multiplayer/`: enabling; hosting with Node and with Docker; HTTPS with Caddy; a Cloudflare Tunnel with no open ports; free and paid hosting options with costs flagged (section 3.5); setting allowed origins for itch.io and GitHub Pages; local testing; kick and ban; troubleshooting. Follow it on a fresh VM and record the result. | `docs/multiplayer/*` (new) | P10.2 | The multiplayer part of S-05 passes on a fresh VM | Manual, recorded |
| P10.6 | Multiplayer security review. Update the threat model for the server. Fuzz a running server with malformed frames and floods through the bot harness. Verify rate limits, origin checks and timeouts. Harden Docker: non-root user, read-only file system, no added capabilities, a memory limit in compose. Audit the server bundle's dependencies. | `docs/security/threat-model.md`, `tools/bots/fuzz.ts` (new), `src/export/templates/server/*` | P10.3 | M-09, M-11 and M-12 pass. Each finding is fixed or accepted in writing. | Harness; review |
| P10.7 | Multiplayer release. Add multiplayer artifacts to the release workflow: the sample multiplayer zip and server bundle checksums. Write the release notes. A public demo server is optional and only happens if you choose to host or pay for one (Q11). | `.github/workflows/release.yml`, `CHANGELOG.md` | P10.5, P10.6 | v1.1.0 is released with the multiplayer artifacts | Release |

**Risks and fallbacks**
- Creators may struggle with TLS and origins. Fallback: the compose file's Caddy service does HTTPS automatically once given a domain; the tunnel option needs no ports; client error screens state the exact cause (origin refused versus no server).
- The iframe origin a host uses may change. Fallback: allowed origins are a config value, and the guide shows how to read the refused origin from the server log.

**Gate.** M-01 to M-12 pass, the guide works on a fresh VM, and v1.1.0 is published.

---

## Step 4: Summary

### Critical path

- **Single-player v1.0:** P0 > P1 > P2 > P3 > P5 > P6 > P7 > P8. P4 runs in parallel after P1 on its own branch, and must finish before P6.3 (game data editors). The longest tasks on the path are P2.3 and P2.4 (moving App onto the store), P3.3 (export worker), P4.2 and P4.3 (AI port), and P7.6 (QA fixes).
- **Multiplayer v1.1:** P4 > P9 > P10, plus P6.2 (settings dialog) and P8.1 (release pipeline).
- If you work strictly one session at a time, the order of phases in this document is a valid order.

### Top five risks

| # | Risk | Likelihood and impact | Mitigation |
|---|---|---|---|
| 1 | Moving combat and AI into the sim (P4) changes the game's feel or runs long | Medium likelihood, high impact (blocks weapon editing and multiplayer) | Scenario tests, data-driven constants, a feel-review gate. The beta below ships without it. |
| 2 | Moving App onto one store (P2.3, P2.4) causes regressions across the editor | Medium, medium | One domain per commit, e2e after each, old hooks kept as adapters until the end |
| 3 | Asset hosting and license data fail: rate limits, the 1 GB Pages cap (Q5), or a pack that is not CC0 (Q4) | Medium, high (export and licensing both depend on it) | Versioned Pages site with thumbnails and the Cache API; Cloudflare Pages as fallback; per-pack license sign-off; export refuses assets without license data |
| 4 | Headless WebGL makes CI end-to-end tests flaky, so the gates stop being trusted | Medium, medium | SwiftShader flags; readiness events instead of pixel checks; at most one retry; a separate nightly matrix; flaky tests quarantined with an owner |
| 5 | Multiplayer over real networks feels poor, or creators cannot host it (TCP stalls, TLS, origins) | Medium, medium (an optional feature) | Adaptive interpolation, a bot and latency harness, compose with Caddy, a tunnel option, precise error screens, and WebTransport later behind the transport interface |

### Smallest version that could ship first: public beta 0.9, single-player

**Contents:** all of P0 and P1; P2.1, P2.2, P2.5, P2.6, P2.7, P2.8; all of P3; P5.1, P5.2, P5.4; P6.1, P6.7; P7.1, P7.3, P7.6 (QA limited to the beta scope); P8.1, P8.2, P8.4 (a short getting-started section plus the export and publishing guide), and P8.6 as a beta launch.

**Dependency exceptions in the beta:**
- Autosave (P2.5) serializes the current editor state through the legacy serializer and the P2.2 migration, because the store (P2.3, P2.4) is deferred.
- P7.1 runs after P6.7 instead of P6.8.
- P8.6 skips P8.5.

**What it delivers:**
- One-click export that runs unchanged on any static host, with correct CC0 credits
- No Google calls, and no networking code in exports
- Autosave and crash recovery
- Hardened project import and a CSP
- Pause, settings and correct browser behavior in exported games
- A reproducible, tagged release
- The single-HTML option for single-player games

**What it defers, and what that costs the beta:**

| Deferred | Effect in the beta |
|---|---|
| P2.3, P2.4 (store and complete undo) | Undo stays as it is today and misses events, world settings and campaign operations (E-02 not met; known limitation) |
| P4 (one simulation) | Combat and AI stay hybrid. No weapon editing (P6.3). G-15 not met. |
| P5.3 (gamepads and rebinding) | Keyboard and mouse only (G-12 not met) |
| P5.5, P5.6, P5.7 | Today's audio, no saved progress (G-14 not met), no quality presets (G-08 measured but not enforced) |
| P6.2 to P6.6, P6.8 | Today's settings UI, level tools, asset browser and partial accessibility |
| P7.2, P7.4, P7.5, P7.7 | No fuzzing, partial budgets, sample v1 only, no threat model document |
| P8.3, P8.5 | Partial creator docs, no contributor docs |
| P9, P10 | No multiplayer |

**Effort:** about 42 to 49 sessions.

### Effort by phase, in agent sessions

The low end assumes one session per task. The high end adds a second session for the tasks most likely to overflow (P1.4, P1.6, P2.4, P2.7, P3.3, P4.2, P4.3, P9.2, P9.4, P9.5) and a fix-up session after some gates.

| Phase | Tasks | Sessions | Running total (high) |
|---|---|---|---|
| P0 Hygiene and safety net | 7 | 6 to 8 | 8 |
| P1 Architecture boundaries | 8 | 8 to 10 | 18 |
| P2 Project format, store, persistence | 8 | 9 to 11 | 29 |
| P3 One-click export | 9 | 9 to 11 | 40 |
| P4 One simulation | 7 | 8 to 10 | 50 |
| P5 Game runtime | 7 | 7 to 9 | 59 |
| P6 Editor completeness | 8 | 8 to 10 | 69 |
| P7 Hardening and QA | 7 | 7 to 8 | 77 |
| P8 Release and launch | 6 | 6 to 8 | 85 |
| **Single-player v1.0 subtotal** | **67** | **68 to 85** | |
| P9 Multiplayer core | 9 | 10 to 13 | 98 |
| P10 Multiplayer product | 7 (1 optional) | 6 to 8 | 106 |
| **Multiplayer subtotal** | **16** | **16 to 21** | |
| **Total** | **83** | **84 to 106** | |
| Public beta 0.9 (subset) | 42 | 42 to 49 | |

---

## Appendix A: Evidence log (2026-11-12, commit `cf7bd9e`)

| Check | Result |
|---|---|
| `npm test` | 174 passed, 21 suites, 0 failed, 5.3 s |
| `npx tsc --noEmit -p tsconfig.json` | 0 errors |
| Same with `--strict` / `--strict false` | 0 errors / 1 error (`src/runtime/sim/validator.ts:868`) |
| Probe file with `--ignoreConfig` | Implicit `any`, `null` to `string` and optional-to-required all reported, so TypeScript 7 defaults to strict |
| Extra flags | `noUncheckedIndexedAccess` plus `noImplicitReturns`, `noFallthroughCasesInSwitch`, `noImplicitOverride`: 611 errors (355 outside tests). `noUnusedLocals` plus `noUnusedParameters`: 32 (30 outside tests). `exactOptionalPropertyTypes`: 40. |
| `require('typescript')` on 7.0.2 | Exposes only `version`; the exports map lists `./unstable/*` |
| `vite build --base=/Retro_FPS_GCS/` | `index-*.js` 2,353.38 kB (gzip 607.12 kB); CSS 40.92 kB (gzip 8.31 kB); Draco decoders emitted twice; `node:fs` and `node:path` externalized for three export modules |
| Built editor JavaScript | Contains `` fetch(`/single-html-runtime.js`) ``, `` fetch(`/assets/manifest.json`) ``, `` fetch(`/draco/${n}`) `` and the gstatic Draco URL. The built `index.html` loads Google Fonts. |
| `public/single-html-runtime.js` | 939,788 bytes; 249,935 bytes with `gzip -9`. Contains `syncEditorLevel`, "Invalid level JSON", "Migrated level failed v3 validation" and 29 Tailwind class strings. No React, lucide or WebSocket. |
| `npm audit --omit=dev` | `ENOLOCK`: no npm lockfile |
| License walk of the production tree | 155 packages: MIT 124, BSD-3-Clause 13, Apache-2.0 8 (Google packages and others), ISC 5, BSD-2-Clause 1, MIT OR GPL-3.0-or-later 1 (jszip), MIT AND Zlib 1 (pako), 0BSD 1, MPL-2.0 1 (lightningcss, build only) |
| Search of `public/assets/aistudio` for keys, tokens, email addresses and local paths | No matches |
| Baked asset index | 1,703 paths: 1,077 `.webp`, 608 `.glb`, 16 license `.txt`, 2 READMEs; 608 model sizes; branch `main`; no commit pin |
| External facts | Checked 2026-11-12. itch.io requires `index.html` in the zip, but its numeric limits were not confirmed from itch.io's own page, so recheck before release. GitHub Pages: 1 GB site, 100 GB a month soft bandwidth, 10-minute deploy timeout. Node 24 is LTS until April 2028, and Node 26 is due to become LTS in late October 2026. WebTransport reportedly shipped in Safari 26.4 (secondary sources). |

Sources for the external facts: [itch.io HTML5 creator docs](https://itch.io/docs/creators/html5), [GitHub Pages limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits), [Node.js release schedule announcement](https://nodejs.org/en/blog/announcements/evolving-the-nodejs-release-schedule), [endoflife.date: Node.js](https://endoflife.date/node), [WebTransport baseline report (webrtc.ventures)](https://webrtc.ventures/2026/04/webtransport-is-now-baseline-what-it-means-for-real-time-media/), [caniuse: WebTransport](https://caniuse.com/webtransport).

## Appendix B: Import graph (non-test source, commit `cf7bd9e`)

Counts are import statements from one area to another. Edges into the root area through `../../runtime` are imports of `src/runtime/index.ts`.

```
cross-area edges                              external packages
  components -> runtime            9            runtime -> three             13
  components -> types              7            runtime -> node:fs/path       4  (assetBundler fallbacks)
  components -> components/insp.   7            editor3d -> three              3
  components/inspector -> types   14            engine/export -> jszip         1
  components/inspector -> engine/modelLibrary 12  engine/export -> esbuild     1  (Node only)
  editor3d -> runtime              7            engine/export -> node:fs/path  5
  engine -> runtime                5            components* -> react, lucide-react
  hooks -> runtime                 7            root -> react, react-dom
  root (App) -> components        7
  runtime -> runtime/sim           8
  runtime/sim -> runtime           1  (validator.ts imports AssetRegistry; no three, no DOM)
  types -> runtime, runtime/sim    3
  (no edge from runtime or runtime/sim to components, hooks, editor3d, engine or react)
```

## Appendix C: Progress tracker

- [x] P0.1 Remove leaked and leftover files (history purged 2026-11-13)
- [x] P0.2 Dependency cleanup and reproducible installs
- [x] P0.3 Move tests to Vitest
- [x] P0.4 Playwright smoke harness
- [x] P0.5 Remove Google calls and base-path bugs
- [x] P0.6 CI pipeline and lint
- [ ] P0.7 Baseline metrics, LICENSE, README stub (metrics and README done; LICENSE waits for Q2)
- [x] P1.1 Explicit compiler settings
- [x] P1.2 Restructure folders
- [x] P1.3 Move authoring code out of the runtime (legacy formats went to src/editor/project/legacy.ts, not src/shared: the migration registers assets in the runtime AssetRegistry)
- [x] P1.4 Split startGame into core and playtest adapter (editor controls live in src/runtime/debug/editorControls.ts, not src/editor: they need the runtime core)
- [x] P1.5 Enforce boundaries
- [x] P1.6 Sim hot path (runtime hashing fixed: p95 27x lower; sim state-shape items moved to P4, see commit)
- [x] P1.7 Decouple playtest from editor state (long-task budget deferred to P7.4: SwiftShader frames take ~100 ms)
- [x] P1.8 Disposal and WebGL context hygiene
- [x] P2.1 Project schema v4
- [x] P2.2 Migrations to v4
- [x] P2.3 Document store and complete undo (HistoryManager is deleted when App moves onto the store in P2.4)
- [x] P2.4 Move App onto the store (App is 706 lines. All domains moved in one commit, not one per domain, because undo cannot be split across two history systems; the new e2e spec covers each domain. Uploaded textures stay in the texture catalog until P2.6 makes them user assets, and save files keep the editor format until P2.5.)
- [x] P2.5 Local persistence and project management (New from Sample opens the first preset until P2.8 adds Proving Grounds. Until P2.6, stored and downloaded projects embed the uploaded textures they use as base64 user assets, and the asset blob store is created but unused. Save JSON and Load JSON are gone: Download Project File writes v4, and Open File reads every format.)
- [x] P2.6 Portable user assets and import hardening (The custom-texture rules live in `src/editor/project/legacy.ts`, where the legacy converter moved in P1.3, and the validator refuses user assets with built-in ids; AssetRegistry is unchanged. Uploaded models also stay in the model library's own browser store, as before.)
- [ ] P2.7 Pin and describe the asset library
- [ ] P2.8 Sample project v1
- [x] P3.1 Single-player entry (The manifest format lives in `src/shared/project/gameManifest.ts`, because checking its levels needs the sim. The boot sequence is in `src/runtime/boot/bootGame.ts`, with the browser parts passed in so it is unit tested without a DOM.)
- [x] P3.2 Prebuilt runtime bundles (The dev watcher is a Vite plugin in `vite.config.ts`; the build logic is shared in `scripts/runtimeBundle.ts`. The bundle is 256 KB gzip.)
- [ ] P3.3 Export worker
- [ ] P3.4 One-click export UX
- [ ] P3.5 Credits, notices and license files
- [ ] P3.6 Retire legacy exporters
- [ ] P3.7 Export end-to-end tests
- [ ] P3.8 Host compatibility
- [ ] P3.9 Single-HTML export option
- [ ] P4.1 Weapons and hitscan in the sim
- [ ] P4.2 Enemy AI in the sim, part 1
- [ ] P4.3 Enemy AI, part 2
- [ ] P4.4 Pickups and player state in the sim
- [ ] P4.5 Runtime as a view
- [ ] P4.6 Multi-player semantics in the sim
- [ ] P4.7 Re-baseline and feel review
- [ ] P5.1 Game shell and CSP-safe HUD
- [ ] P5.2 Settings
- [ ] P5.3 Input actions, rebinding and gamepads
- [ ] P5.4 Browser behavior
- [ ] P5.5 Audio
- [ ] P5.6 Save data
- [ ] P5.7 Rendering quality and frame budget
- [x] P6.1 Error containment (Done ahead of Phase 3's later tasks, which wait on P2.7.)
- [ ] P6.2 Project Settings dialog
- [ ] P6.3 Game data editors
- [ ] P6.4 Level editing gaps
- [ ] P6.5 Validation and playtest
- [ ] P6.6 Asset browser
- [x] P6.7 Onboarding and help (Documentation links to the README until P8.4. Open sample opens the first preset until P2.8.)
- [ ] P6.8 Editor accessibility
- [ ] P7.1 Editor CSP
- [x] P7.2 Import hardening and fuzzing (The fuzz test is `src/__tests__/projectFuzz.test.ts`: tests in `src/shared` may not import node modules. It runs in about 4 s.)
- [ ] P7.3 Supply chain gates
- [ ] P7.4 Performance budgets
- [ ] P7.5 Sample game complete
- [ ] P7.6 Manual QA and cross-browser pass
- [ ] P7.7 Threat model and security policy
- [ ] P8.1 Versioning and release automation
- [ ] P8.2 Licensing final
- [ ] P8.3 Creator docs, part 1
- [ ] P8.4 Creator docs, part 2
- [ ] P8.5 Contributor docs and repo templates
- [ ] P8.6 Distribution and launch
- [ ] P9.1 Protocol
- [ ] P9.2 Server core
- [ ] P9.3 Client networking and join screen
- [ ] P9.4 Prediction and reconciliation
- [ ] P9.5 Lag-compensated hitscan
- [ ] P9.6 Co-op rules
- [ ] P9.7 Deathmatch rules
- [ ] P9.8 Reconnect and resilience
- [ ] P9.9 Bots, load and latency testing
- [ ] P10.1 Multiplayer enable flow
- [ ] P10.2 Server package
- [ ] P10.3 Multiplayer export end to end
- [ ] P10.4 In-editor multiplayer preview (optional)
- [ ] P10.5 Multiplayer guide
- [ ] P10.6 Multiplayer security review
- [ ] P10.7 Multiplayer release
