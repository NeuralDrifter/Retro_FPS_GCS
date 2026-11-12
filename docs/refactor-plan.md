# Refactor Plan: Retro FPS Game Creation System (Monolith Decompositions)
Status: Phase 1 & 2 Complete, Entering Phase 3 & 4 | Started: 2026-11-12

## Survey & Responsibility Map

### Target 1: `src/runtime/sim/executor.ts` (3,413 lines)
- Lines 89-220: State cloning & sim log utility
- Lines 221-465: `createInitialSimulationState`
- Lines 466-638: Units collision & depenetration (`checkCircleCollisionUnits`, `depenetrateCircleUnits`)
- Lines 639-1148: Main simulation tick loop `step()` & player use command
- Lines 1149-1544: Mover tick updates (`updateMoversForTick`)
- Lines 1545-1702: Pending continuations & trigger matching
- Lines 1703-2004: Event evaluation & action loop (`fireEventById`, `evaluateConditions`, `executeEventActionsFromIndex`)
- Lines 2005-2334: Mover actions (`openDoorMoverAtCell`, `closeDoorMoverAtCell`, `toggleDoorMoverAtCell`, `applyFloorMoverAction`, `toggleLiftMover`, `stopCrusherMover`, `buildStairsMover`)
- Lines 2335-2696: Entity lifecycle & AI tick (`wakeEntitiesInSim`, `spawnEntityInSim`, `removeEntityInSim`, `damageEntityInSim`, `recordEntityKilledInSim`, `checkAllDeadTriggers`, `updateEntitiesForTick`)
- Lines 2697-3389: Action dispatch (`executeSingleAction`, `getTargetPlayers`)
- Lines 3390-3413: State query helpers (`getOpenDoorsSetFromSim`, `getCollectedKeysSetFromSim`)

### Target 2: `src/App.tsx` (3,077 lines)
- Lines 1-111: Imports and external contracts
- Lines 112-219: Primary grid state, layers, editor mode & slope/height settings
- Lines 220-405: Texture & model assets state + GitHub sync
- Lines 406-442: IDE layout & selection state
- Lines 443-491: Simulation state & status log
- Lines 492-614: Campaign state & model library hooks
- Lines 615-804: Global history management (undo/redo stacks, live ref, keyboard shortcuts)
- Lines 805-875: Resizable split pane drag handler
- Lines 876-1132: Texture & model drop/placement handlers
- Lines 1133-1673: Cell interact, erase, draw, entity update & removal
- Lines 1674-1939: Campaign level management (select, rename, add, duplicate, delete, move, settings, exit)
- Lines 1940-2287: Preset & level file loading, saving, resizing, clearing, wall border
- Lines 2288-2530: Layer & vertical editing (add, remove, reorder, slope, height)
- Lines 2531-2749: Modals state & confirmation dialogs
- Lines 2750-3077: IDE layout JSX

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
  collisionUnits.ts   — pure circle collision & depenetration in integer units
  moverSim.ts         — mover tick updates and mover actions (doors, lifts, crushers, stairs, floors)
  entitySim.ts        — sim entity lifecycle (wake, spawn, damage, remove, kill, tick update)
  actionExecutor.ts   — condition evaluation, action execution, continuations, triggers
  executor.ts         — thin coordinator: cloneState, createInitialState, step(), queries
  index.ts            — re-exports public API (100% backward-compatible)
```

### `src/hooks/` / `src/editor/`
```
src/hooks/
  useCampaignManager.ts  — campaign levels CRUD, active level selection, campaign settings, exit placement
  useEditorHistory.ts    — undo/redo history stacks, snapshot management, keyboard listener
  useLayerManager.ts     — vertical layers CRUD, layer reordering, active layer, slope & height settings
  useLevelPersistence.ts — level saving/loading, preset loading, grid resizing, clearing, border walls
```

---

## Move Checklist

### Campaign 1: `src/runtime/sim/executor.ts`
- [x] Move 1: extract-leaf-module: circle collision & depenetration -> `src/runtime/sim/collisionUnits.ts`
- [x] Move 2: extract-pure-core: mover actions & tick updates -> `src/runtime/sim/moverSim.ts`
- [x] Move 3: extract-pure-core: entity lifecycle & tick updates -> `src/runtime/sim/entitySim.ts`
- [x] Move 4: thin-entry-point: update `src/runtime/sim/executor.ts` & re-export from `src/runtime/sim/index.ts`
- [x] Verify: `npm run lint`, `npm run build:runtime`, `npm test` (all 174 determinism tests pass)

### Campaign 2: `src/App.tsx`
- [x] Move 5: extract-leaf-module: campaign management hook -> `src/hooks/useCampaignManager.ts`
- [ ] Move 6: extract-leaf-module: history management hook -> `src/hooks/useEditorHistory.ts`
- [ ] Move 7: extract-leaf-module: layer & vertical state hook -> `src/hooks/useLayerManager.ts`
- [ ] Move 8: extract-leaf-module: level persistence & grid actions hook -> `src/hooks/useLevelPersistence.ts`
- [ ] Move 9: thin-entry-point: wire hooks into `src/App.tsx`, verify clean layout
- [ ] Verify: `npm run lint`, `npm run build:runtime`, `npm test`

### Campaign 3: Clean Code Pass
- [ ] Clean code audit across new and modified modules:
  - Check naming smells (`vague-name`, `magic-value`)
  - Check function smells (`long-function`, `deep-nesting`, `dead-code`)
  - Check comment smells (`narrating-comment`, `zombie-code`)
  - Check error handling & parameter objects
- [ ] Verify full test suite and type check

---

## Decisions & Discoveries
- 2026-11-12: Preserving 100% exact determinism and integer math semantics in `src/runtime/sim/`. Every move in `sim` is verified against 3000-tick replay tests and SHA-256 hash baselines.
- 2026-11-12: `build:runtime` bundles `src/runtime/` to `public/single-html-runtime.js`. Must rebuild runtime bundle after `src/runtime/` extractions.
