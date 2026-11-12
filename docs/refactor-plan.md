# Refactor Plan: Retro FPS Game Creation System (Monolith Decompositions)
Status: Complete — All 3 Campaigns Verified | Started: 2026-11-12

## Survey & Responsibility Map

### Target 1: `src/runtime/sim/executor.ts` (3,413 lines -> 1,106 lines, 67.6% reduction)
- Lines 89-220: State cloning & sim log utility -> `src/runtime/sim/simLog.ts`
- Lines 221-465: `createInitialSimulationState` (thin coordinator)
- Lines 466-638: Units collision & depenetration -> `src/runtime/sim/collisionUnits.ts`
- Lines 639-1148: Main simulation tick loop `step()` & player use command (thin coordinator)
- Lines 1149-1544: Mover tick updates & mover actions -> `src/runtime/sim/moverSim.ts`
- Lines 1545-1702: Pending continuations & trigger matching -> `src/runtime/sim/actionExecutor.ts`
- Lines 1703-2004: Event evaluation & conditions -> `src/runtime/sim/actionExecutor.ts`
- Lines 2005-2334: Mover actions -> `src/runtime/sim/moverSim.ts`
- Lines 2335-2696: Entity lifecycle & AI tick -> `src/runtime/sim/entitySim.ts`
- Lines 2697-3389: Action dispatch -> `src/runtime/sim/actionExecutor.ts`
- Lines 3390-3413: State query helpers (`getOpenDoorsSetFromSim`, `getCollectedKeysSetFromSim`)

### Target 2: `src/App.tsx` (3,077 lines -> 2,444 lines, 633 lines reduction)
- Campaign level management -> `src/hooks/useCampaignManager.ts`
- Global history & snapshot undo/redo -> `src/hooks/useEditorHistory.ts`
- Layer & vertical movement features -> `src/hooks/useLayerManager.ts`
- Level persistence & grid resize/clear/border -> `src/hooks/useLevelPersistence.ts`
- IDE layout, 2D/3D workspace interaction, split pane, and texture/model inspector interactions

---

## Safety Net
- Build & Lint: `npm run lint` (`tsc --noEmit`)
- Runtime Bundle: `npm run build:runtime`
- Tests: `npm test` (`tsx --test "src/**/__tests__/*.test.ts"`) -> 174 tests, 21 suites, 100% pass including 3,000-tick determinism replays.
- Baseline git branch: `refactor/clean-monoliths` on commit `c2d3663`.

---

## Target Structure

### `src/runtime/sim/`
```
src/runtime/sim/
  collisionUnits.ts   — pure circle collision & depenetration in integer units (184 lines)
  simLog.ts           — structured simulation event logging (23 lines)
  moverSim.ts         — mover tick updates and mover actions (721 lines)
  entitySim.ts        — sim entity lifecycle (wake, spawn, damage, remove, kill, tick update) (345 lines)
  actionExecutor.ts   — condition evaluation, action execution, continuations, triggers (709 lines)
  executor.ts         — thin coordinator: cloneState, createInitialState, step(), queries (1,106 lines)
  index.ts            — re-exports public API (100% backward-compatible)
```

### `src/hooks/`
```
src/hooks/
  useCampaignManager.ts  — campaign levels CRUD, active level selection, campaign settings, exit placement (254 lines)
  useEditorHistory.ts    — undo/redo history stacks, snapshot management, keyboard listener (243 lines)
  useLayerManager.ts     — vertical layers CRUD, layer reordering, active layer, slope & height settings (128 lines)
  useLevelPersistence.ts — level saving/loading, preset loading, grid resizing, clearing, border walls (474 lines)
```

---

## Move Checklist

### Campaign 1: `src/runtime/sim/executor.ts`
- [x] Move 1: extract-leaf-module: circle collision & depenetration -> `src/runtime/sim/collisionUnits.ts`
- [x] Move 2: extract-pure-core: mover actions & tick updates -> `src/runtime/sim/moverSim.ts` + `simLog.ts`
- [x] Move 3: extract-pure-core: entity lifecycle & tick updates -> `src/runtime/sim/entitySim.ts`
- [x] Move 4: extract-pure-core: action & event executor -> `src/runtime/sim/actionExecutor.ts`
- [x] Move 5: thin-entry-point: update `src/runtime/sim/executor.ts` & re-export from `src/runtime/sim/index.ts`
- [x] Verify: `npm run lint`, `npm run build:runtime`, `npm test` (all 174 determinism tests pass)

### Campaign 2: `src/App.tsx`
- [x] Move 6: extract-leaf-module: campaign management hook -> `src/hooks/useCampaignManager.ts`
- [x] Move 7: extract-leaf-module: history management hook -> `src/hooks/useEditorHistory.ts`
- [x] Move 8: extract-leaf-module: layer & vertical state hook -> `src/hooks/useLayerManager.ts`
- [x] Move 9: extract-leaf-module: level persistence & grid actions hook -> `src/hooks/useLevelPersistence.ts`
- [x] Move 10: thin-entry-point: wire hooks into `src/App.tsx`, verify clean layout
- [x] Verify: `npm run lint`, `npm run build:runtime`, `npm test`

### Campaign 3: Clean Code Pass
- [x] Clean code audit across new and modified modules:
  - Extracted magic numbers (e.g. `DEFAULT_LEVEL_GRID_SIZE = 16` in `useCampaignManager.ts`)
  - Removed unused imports and parameters (`createSolidLayer`, `editorVerticalFeatures`, `MovementSettingsSpec`, `HistoryManager`, `MAX_HISTORY_DEPTH`, `entitiesFittingGrid`, `activeLayerRef`)
  - Enforced strict parameter typing and return types across all custom hooks
  - Rebuilt offline runtime bundle `public/single-html-runtime.js`
- [x] Verify full test suite, bundle integrity, and type check (174/174 tests passing, zero errors)

---

## Decisions & Discoveries
- 2026-11-12: Preserving 100% exact determinism and integer math semantics in `src/runtime/sim/`. Every move in `sim` is verified against 3000-tick replay tests and SHA-256 hash baselines.
- 2026-11-12: `build:runtime` bundles `src/runtime/` to `public/single-html-runtime.js`. Must rebuild runtime bundle after `src/runtime/` extractions.
- 2026-11-12: `DesignStateSnapshot.spawn` uses `{ row: number; col: number; yaw: number }` distinct from `PlayerTransform`. Fixed type contracts in `useEditorHistory.ts`.
