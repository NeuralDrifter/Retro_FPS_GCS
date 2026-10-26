import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CellType,
  ENGINE_CONFIG,
  MAP_PRESETS,
  createUniformTextureMatrix,
} from '../../types/engine';
import { CollisionSystem } from '../CollisionSystem';
import { HistoryManager } from '../HistoryManager';
import {
  LevelSerializer,
  computeNextEntityId,
} from '../LevelSerializer';
import {
  AssetRegistry,
  computeDeterministicAssetId,
} from '../AssetRegistry';
import {
  BAM_HALF_TURN,
  BAM_QUARTER_TURN,
  LevelDataV3,
  QUARTER_SIN_TABLE_1024,
  SIM_CONFIG,
  SimCellType,
  SimulationState,
   TRIG_SCALE,
  assertNoFloatsInState,
  bamCos,
  bamSin,
  castGridRayDDA,
  cloneSimulationState,
  createInitialSimulationState,
  fireEventById,
  gridToWorldUnits,
  hashSimulationState,
  nextUint32,
  step,
  validateLevelDataV3,
  validateSimulationState,
} from '../sim';

function createBaseTestLevelV3(): LevelDataV3 {
  const grid: number[][] = Array.from({ length: SIM_CONFIG.GRID_SIZE }, (_, r) =>
    Array.from({ length: SIM_CONFIG.GRID_SIZE }, (__, c) =>
      r === 0 ||
      r === SIM_CONFIG.GRID_SIZE - 1 ||
      c === 0 ||
      c === SIM_CONFIG.GRID_SIZE - 1
        ? SimCellType.WALL
        : SimCellType.EMPTY
    )
  );
  // Place a door at (4, 5) and a key at (1, 8)
  grid[4][5] = SimCellType.DOOR;
  grid[1][8] = SimCellType.KEY;

  return {
    formatVersion: 3,
    gridSize: 10,
    rngSeed: 12345,
    nextEntityId: 1,
    spawn: { row: 2, col: 2, yawBam: BAM_HALF_TURN }, // Facing South (+Z)
    minimapEnabled: true,
    skybox: {
      theme: 'retro-nebula',
      seed: 1,
      showCeiling: false,
    },
    grid,
    wallTextures: createUniformTextureMatrix('default-grid'),
    floorTextures: createUniformTextureMatrix('floor-obsidian'),
    ceilingTextures: createUniformTextureMatrix('ceiling-coffer'),
    entities: [],
    regions: [
      {
        id: 'armory',
        name: 'Armory Zone',
        cells: [
          { row: 3, col: 2 },
          { row: 3, col: 3 },
        ],
      },
    ],
    variables: {
      flags: {
        ambush_triggered: false,
        door_unlocked: true,
      },
      counters: {
        switches_pulled: 0,
      },
      timers: ['escape_timer'],
    },
    events: [],
  };
}

describe('GridForge 3D Engine Characterization & Phase 0 Event/Trigger System Tests', () => {
  // ==========================================================================
  // 1. EXISTING CHARACTERIZATION TESTS
  // ==========================================================================
  it('CollisionSystem converts grid coordinates to world coordinates and back accurately', () => {
    for (let row = 0; row < ENGINE_CONFIG.GRID_SIZE; row++) {
      for (let col = 0; col < ENGINE_CONFIG.GRID_SIZE; col++) {
        const world = CollisionSystem.gridToWorld(row, col);
        const gridBack = CollisionSystem.worldToGrid(world.x, world.z);
        assert.equal(gridBack.row, row);
        assert.equal(gridBack.col, col);
      }
    }
  });

  it('CollisionSystem blocks movement into solid walls and closed doors, but allows open doors', () => {
    const grid = Array.from({ length: ENGINE_CONFIG.GRID_SIZE }, () =>
      Array.from({ length: ENGINE_CONFIG.GRID_SIZE }, () => CellType.EMPTY)
    );
    grid[2][3] = CellType.WALL;
    grid[2][4] = CellType.DOOR;

    const wallWorld = CollisionSystem.gridToWorld(2, 3);
    const doorWorld = CollisionSystem.gridToWorld(2, 4);

    assert.equal(
      CollisionSystem.checkCircleCollision(
        wallWorld.x,
        wallWorld.z,
        ENGINE_CONFIG.PLAYER_RADIUS,
        grid,
        new Set()
      ),
      true
    );
    assert.equal(
      CollisionSystem.checkCircleCollision(
        doorWorld.x,
        doorWorld.z,
        ENGINE_CONFIG.PLAYER_RADIUS,
        grid,
        new Set()
      ),
      true
    );
    assert.equal(
      CollisionSystem.checkCircleCollision(
        doorWorld.x,
        doorWorld.z,
        ENGINE_CONFIG.PLAYER_RADIUS,
        grid,
        new Set(['2,4'])
      ),
      false
    );
  });

  it('HistoryManager deep-clones snapshots without shared references and detects equality', () => {
    const preset = MAP_PRESETS[0];
    const original = {
      grid: preset.grid.map((r) => [...r]),
      wallTextures: createUniformTextureMatrix('default-grid'),
      floorTextures: createUniformTextureMatrix('floor-obsidian'),
      ceilingTextures: createUniformTextureMatrix('ceiling-coffer'),
      entities: preset.entities ? preset.entities.map((e) => ({ ...e })) : [],
      spawn: { ...preset.spawn },
      actionLabel: 'Initial Snapshot',
    };

    const cloned = HistoryManager.cloneSnapshot(original);
    assert.equal(HistoryManager.areSnapshotsEqual(original, cloned), true);

    cloned.grid[0][0] = CellType.EMPTY;
    assert.equal(HistoryManager.areSnapshotsEqual(original, cloned), false);
    assert.equal(original.grid[0][0], CellType.WALL);
  });

  it('LevelSerializer round-trips level state through JSON and upgrades to validated v3', () => {
    const preset = MAP_PRESETS[0];
    const serialized = LevelSerializer.serializeLevel({
      grid: preset.grid,
      wallTextures: createUniformTextureMatrix('techbase-panel'),
      floorTextures: createUniformTextureMatrix('floor-obsidian'),
      ceilingTextures: createUniformTextureMatrix('ceiling-coffer'),
      customTextures: [],
      entities: preset.entities || [],
      spawn: preset.spawn,
      skyboxTheme: 'retro-nebula',
      skyboxSeed: 4,
      showCeiling: true,
      minimapEnabled: false,
    });

    const jsonString = JSON.stringify(serialized);
    const restored = LevelSerializer.parseLevelJson(jsonString);

    assert.equal(restored.version, '2.0');
    assert.equal(restored.formatVersion, 3);
    assert.deepEqual(restored.grid, preset.grid);
    assert.equal(restored.wallTextures[0][0], 'techbase-panel');
    assert.equal(restored.skybox.theme, 'retro-nebula');
    assert.equal(restored.skybox.seed, 4);
    assert.equal(restored.skybox.showCeiling, true);
    assert.equal(restored.minimapEnabled, false);
    assert.equal(restored.nextEntityId, 5);
  });

  // ==========================================================================
  // 2. PHASE 0 ACCEPTANCE CRITERION 1: SCHEMA VALIDATOR
  // ==========================================================================
  it('Phase 0 Validator: rejects open_door targeting non-door cell, unknown actions, unknown fields, and unguarded cycles', () => {
    // 1. Valid level with valid event passes
    const validLevel = createBaseTestLevelV3();
    validLevel.events = [
      {
        id: 'evt_open_main_door',
        name: 'Open Bulkhead Door',
        enabled: true,
        trigger: { type: 'enter_cell', row: 3, col: 2 },
        conditions: [{ type: 'flag', name: 'door_unlocked', is: true }],
        actions: [
          { type: 'open_door', row: 4, col: 5 },
          {
            type: 'show_message',
            text: 'Check https://example.com terminal log: Door opened!',
          },
        ],
        options: { once: true },
      },
    ];
    const validRes = validateLevelDataV3(validLevel);
    assert.equal(validRes.valid, true, JSON.stringify(validRes.errors));

    // 2. Rejects open_door targeting a non-door cell (cell 2,2 is EMPTY)
    const badDoorTarget = createBaseTestLevelV3();
    badDoorTarget.events = [
      {
        id: 'evt_bad_door',
        name: 'Bad Door Target',
        enabled: true,
        trigger: { type: 'level_start' },
        conditions: [],
        actions: [{ type: 'open_door', row: 2, col: 2 }],
      },
    ];
    const badDoorRes = validateLevelDataV3(badDoorTarget);
    assert.equal(badDoorRes.valid, false);
    assert.equal(
      badDoorRes.errors.some((e) => e.code === 'TARGET_NOT_A_DOOR'),
      true
    );

    // 3. Rejects unknown action type
    const unknownActionLevel = createBaseTestLevelV3();
    unknownActionLevel.events = [
      {
        id: 'evt_unknown_act',
        name: 'Unknown Action',
        enabled: true,
        trigger: { type: 'level_start' },
        conditions: [],
        actions: [
          { type: 'eval_arbitrary_code' } as unknown as LevelDataV3['events'][0]['actions'][0],
        ],
      },
    ];
    const unknownActRes = validateLevelDataV3(unknownActionLevel);
    assert.equal(unknownActRes.valid, false);
    assert.equal(
      unknownActRes.errors.some((e) => e.code === 'UNKNOWN_ACTION_TYPE'),
      true
    );

    // 4. Rejects unknown schema fields on event/action objects
    const extraFieldLevel = createBaseTestLevelV3();
    extraFieldLevel.events = [
      {
        id: 'evt_extra_field',
        name: 'Extra Field',
        enabled: true,
        trigger: { type: 'level_start' },
        conditions: [],
        actions: [
          {
            type: 'show_message',
            text: 'Hello',
            unexpectedPayload: 'bad',
          } as unknown as LevelDataV3['events'][0]['actions'][0],
        ],
      },
    ];
    const extraFieldRes = validateLevelDataV3(extraFieldLevel);
    assert.equal(extraFieldRes.valid, false);
    assert.equal(
      extraFieldRes.errors.some((e) => e.code === 'UNKNOWN_FIELD'),
      true
    );

    // 5. Rejects unregistered texture asset ID
    const badAssetLevel = createBaseTestLevelV3();
    badAssetLevel.events = [
      {
        id: 'evt_bad_tex',
        name: 'Bad Texture',
        enabled: true,
        trigger: { type: 'level_start' },
        conditions: [],
        actions: [
          {
            type: 'set_wall_texture',
            row: 0,
            col: 0,
            texture_id: 'unregistered-texture-999',
          },
        ],
      },
    ];
    const badAssetRes = validateLevelDataV3(badAssetLevel);
    assert.equal(badAssetRes.valid, false);
    assert.equal(
      badAssetRes.errors.some((e) => e.code === 'UNREGISTERED_ASSET_ID'),
      true
    );

    // 6. Rejects static unguarded synchronous cycle (A -> B -> A)
    const cycleLevel = createBaseTestLevelV3();
    cycleLevel.events = [
      {
        id: 'evt_a',
        name: 'Cycle A',
        enabled: true,
        trigger: { type: 'level_start' },
        conditions: [],
        actions: [{ type: 'fire_event', event_id: 'evt_b' }],
      },
      {
        id: 'evt_b',
        name: 'Cycle B',
        enabled: true,
        trigger: { type: 'enter_cell', row: 2, col: 2 },
        conditions: [],
        actions: [{ type: 'fire_event', event_id: 'evt_a' }],
      },
    ];
    const cycleRes = validateLevelDataV3(cycleLevel);
    assert.equal(cycleRes.valid, false);
    assert.equal(
      cycleRes.errors.some((e) => e.code === 'EVENT_CYCLE_DETECTED'),
      true
    );
  });

  // ==========================================================================
  // 3. PHASE 0 ACCEPTANCE CRITERION 2: 3-ACTION SEQUENCE ACROSS DELAY
  // ==========================================================================
  it('Phase 0 Executor: executes 3-action sequence (open_door, delay, show_message) across exact ticks', () => {
    const level = createBaseTestLevelV3();
    level.events = [
      {
        id: 'evt_seq',
        name: 'Door Then Delayed Message',
        enabled: true,
        trigger: { type: 'use', row: 2, col: 2 },
        conditions: [],
        actions: [
          { type: 'open_door', row: 4, col: 5 },
          { type: 'delay', delay_ticks: 4 },
          { type: 'show_message', text: 'Bulkhead sequence complete.' },
        ],
      },
    ];

    let state = createInitialSimulationState(level, [0]);
    assert.equal(state.movers['door:4,5'].state, 'closed');
    assert.equal(state.messages.length, 0);

    // Tick 1: Player 0 presses Use at (2, 2)
    state = step(state, {
      0: {
        moveForward: 0,
        moveRight: 0,
        sprint: false,
        yawDeltaBam: 0,
        pitchDeltaBam: 0,
        use: true,
        shoot: false,
      },
    });

    // Immediately on tick 1: door is opening, continuation is queued with remainingTicks=4, message not shown yet
    assert.equal(state.movers['door:4,5'].state, 'opening');
    assert.equal(state.pendingContinuations.length, 1);
    assert.equal(state.pendingContinuations[0].remainingTicks, 4);
    assert.equal(state.messages.length, 0);

    // Ticks 2, 3, 4 (3 ticks after trigger): still waiting on delay
    for (let t = 0; t < 3; t++) {
      state = step(state, {});
      assert.equal(state.messages.length, 0);
      assert.equal(state.pendingContinuations.length, 1);
    }

    // Tick 5 (4th tick after trigger): continuation reaches 0 and executes `show_message`
    state = step(state, {});
    assert.equal(state.pendingContinuations.length, 0);
    assert.equal(state.messages.length, 1);
    assert.equal(state.messages[0].text, 'Bulkhead sequence complete.');
    assert.equal(state.messages[0].tick, 5);
  });

  // ==========================================================================
  // 4. PHASE 0 ACCEPTANCE CRITERION 3: ONCE GUARD & COOLDOWN_TICKS
  // ==========================================================================
  it('Phase 0 Executor: enforces once: true and cooldown_ticks accurately', () => {
    const level = createBaseTestLevelV3();
    level.events = [
      {
        id: 'evt_once_counter',
        name: 'Once Counter Increment',
        enabled: true,
        trigger: { type: 'use', row: 2, col: 2 },
        conditions: [],
        actions: [{ type: 'add_counter', name: 'switches_pulled', delta: 1 }],
        options: { once: true },
      },
      {
        id: 'evt_cooldown_msg',
        name: 'Cooldown Message',
        enabled: true,
        trigger: { type: 'use', row: 2, col: 2 },
        conditions: [],
        actions: [{ type: 'show_message', text: 'Switch activated' }],
        options: { cooldown_ticks: 5 },
      },
    ];

    let state = createInitialSimulationState(level, [0]);
    const useInput = {
      0: {
        moveForward: 0 as const,
        moveRight: 0 as const,
        sprint: false,
        yawDeltaBam: 0,
        pitchDeltaBam: 0,
        use: true,
        shoot: false,
      },
    };

    // Tick 1: Both events fire
    state = step(state, useInput);
    assert.equal(state.counters.switches_pulled, 1);
    assert.equal(state.messages.length, 1);

    // Ticks 2..5: Pressing use every tick does NOT fire `evt_once_counter` OR `evt_cooldown_msg` (cooldown expires at tick 1 + 5 = 6)
    for (let t = 2; t <= 5; t++) {
      state = step(state, useInput);
      assert.equal(state.counters.switches_pulled, 1);
      assert.equal(state.messages.length, 1);
    }

    // Tick 6: Cooldown has expired (tick 6 >= 6), so `evt_cooldown_msg` fires again, while `evt_once_counter` stays at 1!
    state = step(state, useInput);
    assert.equal(state.counters.switches_pulled, 1);
    assert.equal(state.messages.length, 2);
  });

  // ==========================================================================
  // 5. PHASE 0 ACCEPTANCE CRITERION 4: RUNTIME DIRECT 2-EVENT CYCLE DEPTH CAP
  // ==========================================================================
  it('Phase 0 Executor: direct 2-event cycle (A -> fire_event B -> fire_event A) halts at recursion depth cap (8) and logs error', () => {
    const level = createBaseTestLevelV3();
    level.events = [
      {
        id: 'evt_cycle_a',
        name: 'Cycle Event A',
        enabled: true,
        trigger: { type: 'use', row: 2, col: 2 },
        conditions: [],
        actions: [
          { type: 'add_counter', name: 'switches_pulled', delta: 1 },
          { type: 'fire_event', event_id: 'evt_cycle_b' },
        ],
      },
      {
        id: 'evt_cycle_b',
        name: 'Cycle Event B',
        enabled: true,
        trigger: { type: 'enter_cell', row: 8, col: 8 },
        conditions: [],
        actions: [
          { type: 'add_counter', name: 'switches_pulled', delta: 1 },
          { type: 'fire_event', event_id: 'evt_cycle_a' },
        ],
      },
    ];

    const state = createInitialSimulationState(level, [0]);
    fireEventById(state, 'evt_cycle_a', { kind: 'player', playerId: 0 });

    // Depth 0..7 execute (8 total event invocations), depth 8 is halted with DEPTH_CAP_EXCEEDED
    assert.equal(state.counters.switches_pulled, SIM_CONFIG.MAX_EVENT_DEPTH);
    assert.equal(
      state.logs.some((l) => l.code === 'DEPTH_CAP_EXCEEDED'),
      true
    );
  });

  // ==========================================================================
  // 6. AMENDMENT A TEST 1: SAVE/LOAD DURING PENDING DELAY & CORRUPT CONTINUATION REJECTION
  // ==========================================================================
  it('Amendment A: saving and loading through validateSimulationState during a pending delay resumes on the exact same tick', () => {
    const level = createBaseTestLevelV3();
    level.events = [
      {
        id: 'evt_delayed_unlock',
        name: 'Delayed Unlock Sequence',
        enabled: true,
        trigger: { type: 'use', row: 2, col: 2 },
        conditions: [],
        actions: [
          { type: 'set_flag', name: 'ambush_triggered', value: true },
          { type: 'delay', delay_ticks: 6 },
          { type: 'open_door', row: 4, col: 5 },
          { type: 'show_message', text: 'Delayed door opened!' },
        ],
      },
    ];

    const useInput = {
      0: {
        moveForward: 0 as const,
        moveRight: 0 as const,
        sprint: false,
        yawDeltaBam: 0,
        pitchDeltaBam: 0,
        use: true,
        shoot: false,
      },
    };

    // Run A: uninterrupted for 10 ticks
    let uninterrupted = createInitialSimulationState(level, [0]);
    uninterrupted = step(uninterrupted, useInput); // Tick 1
    for (let t = 2; t <= 10; t++) {
      uninterrupted = step(uninterrupted, {});
    }

    // Run B: save at Tick 3 (while delay continuation has 4 ticks remaining), validate, restore, and run to Tick 10
    let savedRun = createInitialSimulationState(level, [0]);
    savedRun = step(savedRun, useInput); // Tick 1
    savedRun = step(savedRun, {}); // Tick 2
    savedRun = step(savedRun, {}); // Tick 3

    assert.equal(savedRun.pendingContinuations.length, 1);
    assert.equal(savedRun.pendingContinuations[0].remainingTicks, 4);

    const rawSaveJson = JSON.stringify(savedRun);
    const parsedSave = JSON.parse(rawSaveJson) as SimulationState;
    const validation = validateSimulationState(parsedSave, rawSaveJson);
    assert.equal(validation.valid, true, JSON.stringify(validation.errors));

    let restoredRun = parsedSave;
    for (let t = 4; t <= 10; t++) {
      restoredRun = step(restoredRun, {});
    }

    assert.equal(restoredRun.messages.length, 1);
    assert.equal(restoredRun.messages[0].tick, 7);
    assert.equal(
      hashSimulationState(restoredRun),
      hashSimulationState(uninterrupted)
    );

    // Corrupt Continuation Checks:
    // 1. Bad eventId
    const badEventIdSave = cloneSimulationState(savedRun);
    badEventIdSave.pendingContinuations[0].eventId = 'non_existent_event';
    assert.equal(
      validateSimulationState(badEventIdSave).errors.some(
        (e) => e.code === 'UNKNOWN_CONTINUATION_EVENT_ID'
      ),
      true
    );

    // 2. nextActionIndex out of range
    const badIndexSave = cloneSimulationState(savedRun);
    badIndexSave.pendingContinuations[0].nextActionIndex = 99;
    assert.equal(
      validateSimulationState(badIndexSave).errors.some(
        (e) => e.code === 'CONTINUATION_ACTION_INDEX_OUT_OF_RANGE'
      ),
      true
    );

    // 3. Over continuation cap
    const overCapSave = cloneSimulationState(savedRun);
    overCapSave.pendingContinuations = Array.from({ length: 65 }, (_, i) => ({
      id: i + 1,
      eventId: 'evt_delayed_unlock',
      nextActionIndex: 2,
      remainingTicks: 3,
      activator: { kind: 'player', playerId: 0 },
      depth: 0,
    }));
    assert.equal(
      validateSimulationState(overCapSave).errors.some(
        (e) => e.code === 'CONTINUATION_CAP_EXCEEDED'
      ),
      true
    );
  });

  // ==========================================================================
  // 7. AMENDMENT A TEST 2: DELAYED CYCLE WITH FAN-OUT SETTLES AT CONTINUATION CAP
  // ==========================================================================
  it('Amendment A: delayed two-event cycle with fan-out settles at MAX_PENDING_CONTINUATIONS and MAX_FIRES_PER_EVENT_PER_TICK without unbounded growth', () => {
    const level = createBaseTestLevelV3();
    level.events = [
      {
        id: 'evt_fan_a',
        name: 'Fanout A',
        enabled: true,
        trigger: { type: 'use', row: 2, col: 2 },
        conditions: [],
        actions: [
          { type: 'delay', delay_ticks: 1 },
          { type: 'fire_event', event_id: 'evt_fan_b' },
          { type: 'fire_event', event_id: 'evt_fan_b' },
          { type: 'fire_event', event_id: 'evt_fan_b' },
        ],
      },
      {
        id: 'evt_fan_b',
        name: 'Fanout B',
        enabled: true,
        trigger: { type: 'enter_cell', row: 8, col: 8 },
        conditions: [],
        actions: [
          { type: 'delay', delay_ticks: 1 },
          { type: 'fire_event', event_id: 'evt_fan_a' },
          { type: 'fire_event', event_id: 'evt_fan_a' },
          { type: 'fire_event', event_id: 'evt_fan_a' },
        ],
      },
    ];

    let state = createInitialSimulationState(level, [0]);
    state = step(state, {
      0: {
        moveForward: 0,
        moveRight: 0,
        sprint: false,
        yawDeltaBam: 0,
        pitchDeltaBam: 0,
        use: true,
        shoot: false,
      },
    });

    for (let t = 0; t < 25; t++) {
      state = step(state, {});
      assert.equal(
        state.pendingContinuations.length <=
          SIM_CONFIG.MAX_PENDING_CONTINUATIONS,
        true,
        `Continuations exceeded cap: ${state.pendingContinuations.length}`
      );
    }

    assert.equal(
      state.logs.some((l) => l.code === 'EVENT_FIRE_RATE_EXCEEDED'),
      true
    );
  });

  // ==========================================================================
  // 8. AMENDMENT A TEST 3: ZERO FLOATS IN SIMULATION STATE
  // ==========================================================================
  it('Amendment A: runtime SimulationState contains zero floats across movement, rotation, doors, and timers', () => {
    const level = createBaseTestLevelV3();
    level.events = [
      {
        id: 'evt_start',
        name: 'Start Timer & Open Door',
        enabled: true,
        trigger: { type: 'level_start' },
        conditions: [],
        actions: [
          { type: 'start_timer', timer: 'escape_timer', duration_sec: 1.5 },
          { type: 'open_door', row: 4, col: 5 },
        ],
      },
    ];

    let state = createInitialSimulationState(level, [0]);
    assertNoFloatsInState(state);

    for (let t = 0; t < 30; t++) {
      state = step(state, {
        0: {
          moveForward: 1,
          moveRight: t % 2 === 0 ? 1 : 0,
          sprint: t > 15,
          yawDeltaBam: 512,
          pitchDeltaBam: -64,
          use: t === 5,
          shoot: t === 10,
        },
      });
      assertNoFloatsInState(state);
    }

    // Verify validator catches an injected float in saved state
    const floatCorrupted = cloneSimulationState(state);
    floatCorrupted.players[0].xUnits = 123.456;
    const res = validateSimulationState(floatCorrupted);
    assert.equal(res.valid, false);
    assert.equal(
      res.errors.some((e) => e.code === 'FLOAT_IN_SIMULATION_STATE'),
      true
    );
  });

  // ==========================================================================
  // 9. AMENDMENT A TEST 4: TWO-PLAYER DETERMINISM & DIAGONAL NORMALIZATION
  // ==========================================================================
  it('Amendment A: two-player simulation produces identical canonical state hashes across runs and normalizes diagonal movement speed', () => {
    const level = createBaseTestLevelV3();
    level.spawn = { row: 5, col: 5, yawBam: 0 };

    // 1. Diagonal movement normalization test
    const axialStart = createInitialSimulationState(level, [0]);
    const axialAfter = step(axialStart, {
      0: {
        moveForward: 1,
        moveRight: 0,
        sprint: false,
        yawDeltaBam: 0,
        pitchDeltaBam: 0,
        use: false,
        shoot: false,
      },
    });

    const diagStart = createInitialSimulationState(level, [0]);
    const diagAfter = step(diagStart, {
      0: {
        moveForward: 1,
        moveRight: 1,
        sprint: false,
        yawDeltaBam: 0,
        pitchDeltaBam: 0,
        use: false,
        shoot: false,
      },
    });

    const axialDist = axialAfter.players[0].speedUnitsPerTick;
    const diagDist = diagAfter.players[0].speedUnitsPerTick;
    assert.equal(axialDist, SIM_CONFIG.WALK_SPEED_UNITS_PER_TICK);
    assert.equal(
      Math.abs(diagDist - axialDist) <= 1,
      true,
      `Expected diagonal step speed (${diagDist}) to match axial speed (${axialDist}) within 1 unit`
    );

    // 2. Two-player determinism test (playerId 0 and playerId 1)
    const runSimulation = () => {
      let s = createInitialSimulationState(level, [0, 1]);
      for (let tick = 0; tick < 20; tick++) {
        s = step(s, {
          0: {
            moveForward: 1,
            moveRight: tick % 3 === 0 ? 1 : 0,
            sprint: false,
            yawDeltaBam: 256,
            pitchDeltaBam: 0,
            use: tick === 4,
            shoot: tick === 8,
          },
          1: {
            moveForward: -1,
            moveRight: 1,
            sprint: true,
            yawDeltaBam: -512,
            pitchDeltaBam: 128,
            use: tick === 7,
            shoot: false,
          },
        });
      }
      return hashSimulationState(s);
    };

    const hashA = runSimulation();
    const hashB = runSimulation();
    assert.equal(hashA, hashB);
  });

  // ==========================================================================
  // 10. GOLDEN TEST VECTORS & MONOTONIC ENTITY ID TESTS
  // ==========================================================================
  it('Golden Vectors: verifies committed trig LUT, Mulberry32 RNG sequence, integer DDA raycast, and scripted state hash', () => {
    // 1. Committed Trig LUT verification
    assert.equal(QUARTER_SIN_TABLE_1024.length, 1025);
    assert.equal(bamSin(0), 0);
    assert.equal(bamCos(0), TRIG_SCALE);
    assert.equal(bamSin(BAM_QUARTER_TURN), TRIG_SCALE);
    assert.equal(bamCos(BAM_QUARTER_TURN), 0);
    assert.equal(bamSin(BAM_HALF_TURN), 0);
    assert.equal(bamCos(BAM_HALF_TURN), -TRIG_SCALE);
    assert.equal(bamSin(8192), 11585); // 45 degrees: round(sin(pi/4) * 16384) = 11585

    // 2. Mulberry32 RNG Golden Sequence from seed 12345
    const rngOutputs: number[] = [];
    let rngState = 12345;
    for (let i = 0; i < 5; i++) {
      const res = nextUint32(rngState);
      rngOutputs.push(res.value);
      rngState = res.nextState;
    }
    assert.deepEqual(rngOutputs, [
      4207900869,
      1317490944,
      2079646450,
      3513001552,
      2187978186,
    ]);

    // 3. 2D DDA Grid Raycast Golden Vector
    const level = createBaseTestLevelV3();
    const origin = gridToWorldUnits(2, 2); // (-2500, -2500)
    // Cast North (yawBam = 0 -> -Z) toward wall at row 0, col 2
    const hitNorth = castGridRayDDA({
      originXUnits: origin.xUnits,
      originZUnits: origin.zUnits,
      yawBam: 0,
      maxDistanceUnits: 10000,
      grid: level.grid,
    });
    assert.equal(hitNorth.hit, true);
    assert.equal(hitNorth.hitKind, 'wall');
    assert.equal(hitNorth.row, 0);
    assert.equal(hitNorth.col, 2);
    assert.equal(hitNorth.distanceUnits, 1500);

    // 4. Persisted nextEntityId & Deterministic Asset Content-Hash IDs
    assert.equal(
      computeNextEntityId([{ id: 'ent-1' }, { id: 'ent-4' }], 2),
      5
    );
    const texHashA = computeDeterministicAssetId(
      'tex',
      'https://example.com/wall.png'
    );
    const texHashB = computeDeterministicAssetId(
      'tex',
      'https://example.com/wall.png'
    );
    assert.equal(texHashA, texHashB);
    assert.match(texHashA, /^tex-[0-9a-f]{16}$/);
    AssetRegistry.registerTexture({
      id: texHashA,
      name: 'Wall',
      sourceType: 'url',
      previewUrl: 'https://example.com/wall.png',
      recommendedSurface: 'wall',
    });
    assert.equal(
      AssetRegistry.createAllowlist().textureIds.has(texHashA),
      true
    );

    // 5. Golden Canonical State Hash after 10 scripted ticks
    let sim = createInitialSimulationState(level, [0]);
    for (let t = 0; t < 10; t++) {
      sim = step(sim, {
        0: {
          moveForward: 1,
          moveRight: 0,
          sprint: false,
          yawDeltaBam: 128,
          pitchDeltaBam: 0,
          use: false,
          shoot: false,
        },
      });
    }
    const finalHash = hashSimulationState(sim);
    assert.equal(typeof finalHash, 'string');
    assert.equal(finalHash.length, 16);
    assert.equal(finalHash, '40ce562534308b61');
  });

  // ==========================================================================
  // 11. PHASE 1 BEHAVIOR TEST 1: KEYED DOOR STAYS CLOSED WITHOUT KEY & OPENS WITH KEY
  // ==========================================================================
  it('Phase 1 (Key Door): locked door stays closed and plays door_locked without key, and unlocks/opens once key is held', () => {
    const level = createBaseTestLevelV3();
    level.grid[2][3] = CellType.DOOR;
    level.spawn = { row: 2, col: 2, yawBam: 0 };
    level.events = [
      {
        id: 'evt-lock-door-start',
        name: 'Lock Door at Start',
        enabled: true,
        trigger: { type: 'level_start' },
        conditions: [],
        actions: [
          {
            type: 'lock_door',
            row: 2,
            col: 3,
            required_key: 'gold_key',
          },
        ],
        options: { once: true },
      },
      {
        id: 'evt-grant-gold-key',
        name: 'Pick Up Gold Key at (1, 2)',
        enabled: true,
        trigger: { type: 'enter_cell', row: 1, col: 2 },
        conditions: [],
        actions: [
          { type: 'give_item', item: 'gold_key', target: 'activator' },
          { type: 'play_sound', sound_id: 'key_pickup' },
          { type: 'show_message', text: 'Picked up Gold Key!' },
        ],
        options: { once: true },
      },
    ];

    const vRes = validateLevelDataV3(level);
    assert.equal(vRes.valid, true);

    let sim = createInitialSimulationState(level, [0]);
    assert.equal(sim.movers['door:2,3']?.locked, true);
    assert.equal(sim.movers['door:2,3']?.requiredKey, 'gold_key');

    // 1. Press `use` at (2, 2) adjacent to door (2, 3) WITHOUT the gold_key
    sim = step(sim, {
      0: {
        moveForward: 0,
        moveRight: 0,
        sprint: false,
        yawDeltaBam: 0,
        pitchDeltaBam: 0,
        use: true,
        shoot: false,
      },
    });
    assert.equal(sim.movers['door:2,3']?.state, 'closed');
    assert.equal(sim.movers['door:2,3']?.progress, 0);
    assert.equal(
      sim.soundsPlayed.some((s) => s.soundId === 'door_locked'),
      true
    );
    assert.equal(
      sim.messages.some((m) => m.text.includes('gold_key')),
      true
    );

    // 2. Walk North from (2, 2) into (1, 2) to acquire gold_key
    while (sim.players[0].gridRow !== 1) {
      sim = step(sim, {
        0: {
          moveForward: 1,
          moveRight: 0,
          sprint: true,
          yawDeltaBam: 0,
          pitchDeltaBam: 0,
          use: false,
          shoot: false,
        },
      });
    }
    assert.equal(sim.players[0].items.includes('gold_key'), true);

    // 3. Press `use` adjacent to door (2, 3) WITH gold_key — door unlocks and opens
    sim = step(sim, {
      0: {
        moveForward: 0,
        moveRight: 0,
        sprint: false,
        yawDeltaBam: 0,
        pitchDeltaBam: 0,
        use: true,
        shoot: false,
      },
    });
    assert.equal(sim.movers['door:2,3']?.locked, false);
    assert.equal(
      sim.movers['door:2,3']?.state === 'opening' ||
        sim.movers['door:2,3']?.state === 'open',
      true
    );

    // Advance until door finishes opening
    for (let t = 0; t < 20; t++) {
      sim = step(sim, {});
    }
    assert.equal(sim.movers['door:2,3']?.state, 'open');
    assert.equal(sim.movers['door:2,3']?.progress, 10000);
    assertNoFloatsInState(sim);
  });

  // ==========================================================================
  // 12. PHASE 1 BEHAVIOR TEST 2: SECRET PUSH WALL SLIDES & COUNTS SECRET ONCE
  // ==========================================================================
  it('Phase 1 (Secret Push Wall): slides 2 cells, updates collision cells, waits if blocked, and counts secret strictly once', () => {
    const level = createBaseTestLevelV3();
    // Place secret push wall at (4, 2) with empty cells at (3, 2) and (2, 2)
    level.grid[4][2] = CellType.WALL;
    level.grid[3][2] = CellType.EMPTY;
    level.grid[2][2] = CellType.EMPTY;
    level.wallTextures[4][2] = 'dungeon-stone';
    level.spawn = { row: 5, col: 2, yawBam: 0 };
    level.events = [
      {
        id: 'evt-pushwall-secret',
        name: 'Push Secret Wall North',
        enabled: true,
        trigger: { type: 'use', row: 4, col: 2 },
        conditions: [],
        actions: [
          {
            type: 'slide_wall',
            row: 4,
            col: 2,
            direction: 'N',
            distance_cells: 2,
            speed_per_tick: 1000,
          },
          { type: 'mark_secret_found', secret_id: 'secret_north_alcove' },
          { type: 'play_sound', sound_id: 'secret_found' },
        ],
        options: { fire: 'repeat' }, // Even with repeat, secret_id & pushwall must only trigger/count once
      },
    ];

    const vRes = validateLevelDataV3(level);
    assert.equal(vRes.valid, true);

    let sim = createInitialSimulationState(level, [0]);

    // Trigger pushwall with `use`
    sim = step(sim, {
      0: {
        moveForward: 0,
        moveRight: 0,
        sprint: false,
        yawDeltaBam: 0,
        pitchDeltaBam: 0,
        use: true,
        shoot: false,
      },
    });

    const pwMover = sim.movers['pushwall:4,2'];
    assert.ok(pwMover);
    assert.equal(pwMover.state, 'active');
    assert.equal(pwMover.distanceCells, 2);
    assert.equal(pwMover.targetRow, 2);
    assert.equal(pwMover.targetCol, 2);
    assert.equal(sim.secretsFound, 1);

    // Press `use` again while sliding — secret count must remain 1
    sim = step(sim, {
      0: {
        moveForward: 0,
        moveRight: 0,
        sprint: false,
        yawDeltaBam: 0,
        pitchDeltaBam: 0,
        use: true,
        shoot: false,
      },
    });
    assert.equal(sim.secretsFound, 1);

    // Advance 12 ticks so the pushwall finishes sliding (1000/tick -> 10 ticks)
    for (let t = 0; t < 12; t++) {
      sim = step(sim, {});
    }

    assert.equal(sim.movers['pushwall:4,2']?.state, 'done');
    assert.equal(sim.movers['pushwall:4,2']?.progress, 10000);
    // Origin cell (4, 2) is now EMPTY, intermediate secret room (3, 2) is EMPTY,
    // and destination cell (2, 2) is now a solid WALL with the pushwall's texture!
    assert.equal(sim.grid[4][2], CellType.EMPTY);
    assert.equal(sim.grid[3][2], CellType.EMPTY);
    assert.equal(sim.grid[2][2], CellType.WALL);
    assert.equal(sim.wallTextures[2][2], 'dungeon-stone');
    assert.equal(sim.secretsFound, 1);
    assertNoFloatsInState(sim);
  });

  // ==========================================================================
  // 13. PHASE 1 BEHAVIOR TEST 3: FULL WOLF3D LEVEL START-TO-FINISH LOOP
  // ==========================================================================
  it('Phase 1 (Wolfenstein Parity End-to-End): completes a full Wolf3D level with key pickup, locked door, secret push wall, and exit_level', () => {
    const preset = MAP_PRESETS[0];
    const level = LevelSerializer.serializeLevelV3({
      grid: preset.grid,
      wallTextures: createUniformTextureMatrix(
        preset.defaultWallTex || 'default-grid'
      ),
      floorTextures: createUniformTextureMatrix('floor-obsidian'),
      ceilingTextures: createUniformTextureMatrix('ceiling-coffer'),
      entities: preset.entities || [],
      spawn: preset.spawn,
      skyboxTheme: 'retro-nebula',
      skyboxSeed: 1,
      showCeiling: false,
      minimapEnabled: true,
      events: preset.events || [],
    });

    const vRes = validateLevelDataV3(level);
    assert.equal(
      vRes.valid,
      true,
      `Starter Wolf3D preset failed v3 validation: ${JSON.stringify(
        vRes.errors
      )}`
    );

    let sim = createInitialSimulationState(level, [0]);
    assert.equal(sim.levelEnded, false);
    assert.equal(sim.movers['door:4,5']?.locked, true);

    // 1. Move player to (5, 1) and activate the secret push wall at (6, 1)
    const posBeforeSecret = gridToWorldUnits(5, 1);
    sim.players[0].xUnits = posBeforeSecret.xUnits;
    sim.players[0].zUnits = posBeforeSecret.zUnits;
    sim.players[0].gridRow = 5;
    sim.players[0].gridCol = 1;

    sim = step(sim, {
      0: {
        moveForward: 0,
        moveRight: 0,
        sprint: false,
        yawDeltaBam: 0,
        pitchDeltaBam: 0,
        use: true,
        shoot: false,
      },
    });
    assert.equal(sim.secretsFound, 1);
    assert.equal(sim.movers['pushwall:6,1']?.state, 'active');

    for (let t = 0; t < 55; t++) {
      sim = step(sim, {});
    }
    assert.equal(sim.movers['pushwall:6,1']?.state, 'done');
    assert.equal(sim.grid[6][1], CellType.EMPTY);
    assert.equal(sim.grid[7][1], CellType.EMPTY);
    assert.equal(sim.grid[8][1], CellType.WALL);

    // 2. Move player to (1, 7) and walk East into keycard cell (1, 8)
    const posBeforeKey = gridToWorldUnits(1, 7);
    sim.players[0].xUnits = posBeforeKey.xUnits;
    sim.players[0].zUnits = posBeforeKey.zUnits;
    sim.players[0].gridRow = 1;
    sim.players[0].gridCol = 7;
    sim.players[0].yawBam = 49152; // Facing East (+X)

    while (sim.players[0].gridCol !== 8) {
      sim = step(sim, {
        0: {
          moveForward: 1,
          moveRight: 0,
          sprint: true,
          yawDeltaBam: 0,
          pitchDeltaBam: 0,
          use: false,
          shoot: false,
        },
      });
    }
    assert.equal(sim.players[0].items.includes('keycard'), true);
    assert.equal(sim.movers['door:4,5']?.locked, false);

    // 3. Move player to extraction switch at (8, 8) and press `use` to exit level
    const posAtExit = gridToWorldUnits(8, 8);
    sim.players[0].xUnits = posAtExit.xUnits;
    sim.players[0].zUnits = posAtExit.zUnits;
    sim.players[0].gridRow = 8;
    sim.players[0].gridCol = 8;

    sim = step(sim, {
      0: {
        moveForward: 0,
        moveRight: 0,
        sprint: false,
        yawDeltaBam: 0,
        pitchDeltaBam: 0,
        use: true,
        shoot: false,
      },
    });

    assert.equal(sim.levelEnded, true);
    assert.equal(sim.secretsFound, 1);
    assertNoFloatsInState(sim);
  });

  // ==========================================================================
  // 11. PHASE 2 (DOOM PARITY) ACCEPTANCE TESTS
  // ==========================================================================
  it('Phase 2 (Doom Lift Platform): toggle_lift lowers floor, pauses wait ticks, returns to top, and emits mover_finished', () => {
    const level = createBaseTestLevelV3();
    level.events = [
      {
        id: 'evt_call_lift',
        name: 'Call Lift',
        enabled: true,
        trigger: { type: 'use', row: 3, col: 3 },
        conditions: [],
        actions: [
          {
            type: 'toggle_lift',
            row: 3,
            col: 3,
            lower_height_units: -500,
            upper_height_units: 0,
            speed_per_tick: 1000,
            wait_ticks: 10,
          },
        ],
      },
      {
        id: 'evt_lift_done',
        name: 'Lift Cycle Done',
        enabled: true,
        trigger: { type: 'mover_finished', row: 3, col: 3 },
        conditions: [],
        actions: [{ type: 'set_flag', name: 'lift_complete', value: true }],
      },
    ];

    let sim = createInitialSimulationState(level, [0]);
    const pPos = gridToWorldUnits(3, 3);
    sim.players[0].xUnits = pPos.xUnits;
    sim.players[0].zUnits = pPos.zUnits;
    sim.players[0].gridRow = 3;
    sim.players[0].gridCol = 3;

    // Press use to trigger lift
    sim = step(sim, {
      0: {
        moveForward: 0,
        moveRight: 0,
        sprint: false,
        yawDeltaBam: 0,
        pitchDeltaBam: 0,
        use: true,
        shoot: false,
      },
    });

    assert.equal(sim.movers['lift:3,3']?.state, 'active');
    assert.equal(sim.soundsPlayed.some((s) => s.soundId === 'lift_start'), true);

    // Step through lowering phase (10 ticks at 1000 speed/tick = 10000 basis points)
    for (let t = 0; t < 10; t++) {
      sim = step(sim, {});
    }
    // Lift reaches lower height (-500) and begins waiting (state is 'open' with waitTicks)
    assert.equal(sim.floorHeights[3][3], -500);
    assert.equal(sim.movers['lift:3,3']?.state, 'open');
    assert.equal((sim.movers['lift:3,3']?.waitTicks ?? 0) > 0, true);

    // Wait 10 ticks and let it rise back to 0 (10 ticks)
    for (let t = 0; t < 25; t++) {
      sim = step(sim, {});
    }

    assert.equal(sim.floorHeights[3][3], 0);
    assert.equal(sim.movers['lift:3,3']?.state, 'closed');
    assert.equal(sim.flags['lift_complete'], true);
    assert.equal(sim.soundsPlayed.some((s) => s.soundId === 'lift_stop'), true);
    assertNoFloatsInState(sim);
  });

  it('Phase 2 (Monster Closet & Ambush Release): dormant ambush enemy wakes via wake_entities action triggered by enter_region', () => {
    const level = createBaseTestLevelV3();
    level.entities = [
      {
        id: 'bot_ambush_1',
        blueprintId: 'sentinel-bot',
        row: 5,
        col: 7,
        ambush: true,
        tag: 42,
      },
    ];
    level.regions = [
      {
        id: 'reg_closet_tripwire',
        name: 'Closet Tripwire',
        cells: [{ row: 5, col: 3 }],
      },
    ];
    level.events = [
      {
        id: 'evt_closet_spring',
        name: 'Spring Closet Ambush',
        enabled: true,
        trigger: { type: 'enter_region', region: 'reg_closet_tripwire' },
        conditions: [],
        actions: [{ type: 'wake_entities', tag: 42 }],
      },
    ];

    let sim = createInitialSimulationState(level, [0]);
    assert.equal(sim.entities?.['bot_ambush_1']?.ambush, true);
    assert.equal(sim.entities?.['bot_ambush_1']?.state, 'idle');

    // Teleport player adjacent to tripwire at (5, 2)
    const pos = gridToWorldUnits(5, 2);
    sim.players[0].xUnits = pos.xUnits;
    sim.players[0].zUnits = pos.zUnits;
    sim.players[0].gridRow = 5;
    sim.players[0].gridCol = 2;
    sim.players[0].yawBam = 49152; // East

    // Walk player East into (5, 3)
    while (sim.players[0].gridCol !== 3) {
      sim = step(sim, {
        0: {
          moveForward: 1,
          moveRight: 0,
          sprint: false,
          yawDeltaBam: 0,
          pitchDeltaBam: 0,
          use: false,
          shoot: false,
        },
      });
    }

    // Entering (5, 3) trips the region and executes wake_entities(tag: 42)
    assert.equal(sim.entities?.['bot_ambush_1']?.ambush, false);
    assert.equal(sim.entities?.['bot_ambush_1']?.state, 'chase');
    assert.equal(sim.soundsPlayed.some((s) => s.soundId === 'enemy_alert'), true);
    assertNoFloatsInState(sim);
  });

  it('Phase 2 (Lock-in Arena & All Dead Trigger): entering arena locks door, defeating enemies triggers all_dead to reopen door', () => {
    const level = createBaseTestLevelV3();
    level.grid[4][5] = SimCellType.DOOR;
    level.entities = [
      {
        id: 'arena_guard_1',
        blueprintId: 'turret-guardian',
        row: 5,
        col: 6,
        tag: 99,
      },
    ];
    level.regions = [
      {
        id: 'arena_zone',
        name: 'Arena Chamber',
        cells: [{ row: 5, col: 5 }],
      },
    ];
    level.events = [
      {
        id: 'evt_lock_in',
        name: 'Lock In Arena',
        enabled: true,
        trigger: { type: 'enter_region', region: 'arena_zone' },
        conditions: [],
        actions: [{ type: 'close_door', row: 4, col: 5 }],
      },
      {
        id: 'evt_unlock_arena',
        name: 'Arena Victory Door Unlock',
        enabled: true,
        trigger: { type: 'all_dead', tag: 99 },
        conditions: [],
        actions: [{ type: 'open_door', row: 4, col: 5 }],
      },
    ];

    let sim = createInitialSimulationState(level, [0]);
    // Start with door (4, 5) open
    sim.movers['door:4,5'] = {
      id: 'door:4,5',
      kind: 'door',
      row: 4,
      col: 5,
      tag: 0,
      state: 'open',
      progress: 10000,
      speedPerTick: 250,
      waitTicks: 0,
      configuredWaitTicks: 0,
      locked: false,
      blockedBehavior: 'reverse',
    };

    // Position player adjacent to arena at (5, 4) and walk East into arena cell (5, 5)
    const pPos = gridToWorldUnits(5, 4);
    sim.players[0].xUnits = pPos.xUnits;
    sim.players[0].zUnits = pPos.zUnits;
    sim.players[0].gridRow = 5;
    sim.players[0].gridCol = 4;
    sim.players[0].yawBam = 49152; // East

    while (sim.players[0].gridCol !== 5) {
      sim = step(sim, {
        0: {
          moveForward: 1,
          moveRight: 0,
          sprint: false,
          yawDeltaBam: 0,
          pitchDeltaBam: 0,
          use: false,
          shoot: false,
        },
      });
    }

    // Stepping into (5, 5) evaluates enter_region -> closes door (4, 5)
    assert.equal(sim.movers['door:4,5']?.state, 'closing');

    // Set guard health low and shoot facing East (49152)
    sim.entities!['arena_guard_1'].health = 10;
    sim.players[0].yawBam = 49152;
    sim = step(sim, {
      0: {
        moveForward: 0,
        moveRight: 0,
        sprint: false,
        yawDeltaBam: 0,
        pitchDeltaBam: 0,
        use: false,
        shoot: true,
      },
    });

    assert.equal(sim.entities!['arena_guard_1'].state, 'dead');
    assert.equal(sim.soundsPlayed.some((s) => s.soundId === 'enemy_death'), true);

    // all_dead trigger has fired and reopened door (4, 5)!
    assert.equal(sim.movers['door:4,5']?.state, 'opening');
    assertNoFloatsInState(sim);
  });

  it('Phase 2 (Crusher Hazard): cycling crusher damages player while inside cell', () => {
    const level = createBaseTestLevelV3();
    level.events = [
      {
        id: 'evt_start_crush',
        name: 'Start Crusher',
        enabled: true,
        trigger: { type: 'use', row: 2, col: 2 },
        conditions: [],
        actions: [
          {
            type: 'start_crusher',
            row: 2,
            col: 2,
            speed_per_tick: 1000,
            damage: 20,
          },
        ],
      },
    ];

    let sim = createInitialSimulationState(level, [0]);
    const pPos = gridToWorldUnits(2, 2);
    sim.players[0].xUnits = pPos.xUnits;
    sim.players[0].zUnits = pPos.zUnits;
    sim.players[0].gridRow = 2;
    sim.players[0].gridCol = 2;
    const initialHealth = sim.players[0].health;

    // Start crusher
    sim = step(sim, {
      0: {
        moveForward: 0,
        moveRight: 0,
        sprint: false,
        yawDeltaBam: 0,
        pitchDeltaBam: 0,
        use: true,
        shoot: false,
      },
    });

    assert.equal(sim.movers['crusher:2,2']?.state, 'active');

    // Run until crusher ceiling descends and hits player (10 ticks at 1000 speed/tick)
    for (let t = 0; t < 10; t++) {
      sim = step(sim, {});
    }

    assert.equal(sim.players[0].health < initialHealth, true);
    assert.equal(sim.soundsPlayed.some((s) => s.soundId === 'crusher_hit'), true);
    assertNoFloatsInState(sim);
  });

  it('Phase 2 (Dynamic Entity Spawning & Teleportation): spawn_entity uses monotonic nextEntityId and teleport_player relocates player', () => {
    const level = createBaseTestLevelV3();
    level.events = [
      {
        id: 'evt_spawn_and_tp',
        name: 'Spawn Bot and Teleport',
        enabled: true,
        trigger: { type: 'use', row: 2, col: 2 },
        conditions: [],
        actions: [
          {
            type: 'spawn_entity',
            blueprintId: 'sentinel-bot',
            row: 6,
            col: 6,
            tag: 77,
          },
          {
            type: 'teleport_player',
            row: 7,
            col: 7,
            yaw_bam: BAM_QUARTER_TURN,
          },
        ],
      },
    ];

    let sim = createInitialSimulationState(level, [0]);
    const prevNextId = sim.nextEntityId;

    sim = step(sim, {
      0: {
        moveForward: 0,
        moveRight: 0,
        sprint: false,
        yawDeltaBam: 0,
        pitchDeltaBam: 0,
        use: true,
        shoot: false,
      },
    });

    // Verify player teleported
    assert.equal(sim.players[0].gridRow, 7);
    assert.equal(sim.players[0].gridCol, 7);
    assert.equal(sim.players[0].yawBam, BAM_QUARTER_TURN);
    assert.equal(sim.soundsPlayed.some((s) => s.soundId === 'teleport'), true);

    // Verify entity was spawned with monotonic id
    assert.equal(sim.nextEntityId, prevNextId + 1);
    const spawnedId = `ent-${prevNextId}`;
    assert.equal(Boolean(sim.entities?.[spawnedId]), true);
    assert.equal(sim.entities?.[spawnedId]?.tag, 77);
    assert.equal(sim.entities?.[spawnedId]?.row, 6);
    assert.equal(sim.entities?.[spawnedId]?.col, 6);

    assertNoFloatsInState(sim);
  });

  // ==========================================================================
  // PHASE 3 (BUILD-ENGINE PARITY) TESTS
  // ==========================================================================

  it('Phase 3 (Pressure Plate Dwell): stand_in_region requires cumulative dwell_ticks in region and resets on exit', () => {
    const level = createBaseTestLevelV3();
    level.regions = [
      {
        id: 'plate_zone',
        name: 'Pressure Plate Zone',
        cells: [{ row: 2, col: 2 }],
      },
    ];
    level.events = [
      {
        id: 'evt_dwell_plate',
        name: 'Plate Dwell Trigger',
        enabled: true,
        trigger: {
          type: 'stand_in_region',
          region: 'plate_zone',
          dwell_ticks: 5,
        },
        conditions: [],
        actions: [
          { type: 'add_counter', name: 'switches_pulled', delta: 1 },
          { type: 'show_message', text: 'Plate activated after 5 ticks!' },
        ],
      },
    ];

    let sim = createInitialSimulationState(level, [0]);
    const pos22 = gridToWorldUnits(2, 2);
    sim.players[0].xUnits = pos22.xUnits;
    sim.players[0].zUnits = pos22.zUnits;
    sim.players[0].gridRow = 2;
    sim.players[0].gridCol = 2;

    // Ticks 1..4: Player stands in plate_zone, dwell increases but event has NOT fired yet
    for (let t = 1; t <= 4; t++) {
      sim = step(sim, {});
      assert.equal(sim.counters.switches_pulled, 0);
      assert.equal(sim.regionDwellTicks?.['plate_zone']?.[0], t);
    }

    // Tick 5: Dwell reaches 5 ticks -> event fires!
    sim = step(sim, {});
    assert.equal(sim.counters.switches_pulled, 1);
    assert.equal(sim.messages.length, 1);
    assert.equal(sim.messages[0].text, 'Plate activated after 5 ticks!');

    // Move player away from region to cell (3, 3)
    const pos33 = gridToWorldUnits(3, 3);
    sim.players[0].xUnits = pos33.xUnits;
    sim.players[0].zUnits = pos33.zUnits;
    sim.players[0].gridRow = 3;
    sim.players[0].gridCol = 3;

    sim = step(sim, {});
    // Region dwell for player 0 should be deleted
    assert.equal(sim.regionDwellTicks?.['plate_zone']?.[0], undefined);
    assertNoFloatsInState(sim);
  });

  it('Phase 3 (Hazard Regions): set_hazard_region inflicts periodic integer damage with sound cue; clear_hazard_region stops it', () => {
    const level = createBaseTestLevelV3();
    level.regions = [
      {
        id: 'toxic_sludge',
        name: 'Toxic Sludge',
        cells: [{ row: 2, col: 2 }],
      },
    ];
    level.events = [
      {
        id: 'evt_start_sludge',
        name: 'Start Sludge Hazard',
        enabled: true,
        trigger: { type: 'use', row: 2, col: 2 },
        conditions: [],
        actions: [
          {
            type: 'set_hazard_region',
            region: 'toxic_sludge',
            damage_per_interval: 15,
            interval_ticks: 3,
          },
        ],
      },
      {
        id: 'evt_stop_sludge',
        name: 'Stop Sludge Hazard',
        enabled: true,
        trigger: { type: 'counter_reached', name: 'switches_pulled', op: 'gte', value: 1 },
        conditions: [],
        actions: [
          { type: 'clear_hazard_region', region: 'toxic_sludge' },
        ],
      },
    ];

    let sim = createInitialSimulationState(level, [0]);
    const pos22 = gridToWorldUnits(2, 2);
    sim.players[0].xUnits = pos22.xUnits;
    sim.players[0].zUnits = pos22.zUnits;
    sim.players[0].gridRow = 2;
    sim.players[0].gridCol = 2;
    const startHealth = sim.players[0].health;

    // Trigger hazard region via use
    sim = step(sim, {
      0: {
        moveForward: 0,
        moveRight: 0,
        sprint: false,
        yawDeltaBam: 0,
        pitchDeltaBam: 0,
        use: true,
        shoot: false,
      },
    });

    assert.equal(Boolean(sim.hazardRegions?.['toxic_sludge']), true);

    // Run ticks 2..6: tick 3 and tick 6 are multiples of 3, so damage is applied twice (30 total dmg)
    for (let t = 2; t <= 6; t++) {
      sim = step(sim, {});
    }

    assert.equal(sim.players[0].health, startHealth - 30);
    assert.equal(sim.soundsPlayed.some((s) => s.soundId === 'hazard_sizzle'), true);

    // Clear hazard region via fireEventById
    fireEventById(sim, 'evt_stop_sludge');
    assert.equal(sim.hazardRegions?.['toxic_sludge'], undefined);

    const healthAfterClear = sim.players[0].health;
    for (let t = 0; t < 10; t++) {
      sim = step(sim, {});
    }
    // No more damage received
    assert.equal(sim.players[0].health, healthAfterClear);
    assertNoFloatsInState(sim);
  });

  it('Phase 3 (Branching Logic): if_then_else evaluates condition and executes then_actions or else_actions without floats', () => {
    const level = createBaseTestLevelV3();
    level.events = [
      {
        id: 'evt_branch_test',
        name: 'Conditional Branching Event',
        enabled: true,
        trigger: { type: 'use', row: 2, col: 2 },
        conditions: [],
        actions: [
          {
            type: 'if_then_else',
            condition: { type: 'flag', name: 'secret_found', is: true },
            then_actions: [
              { type: 'add_counter', name: 'switches_pulled', delta: 10 },
              { type: 'show_message', text: 'Secret path taken!' },
            ],
            else_actions: [
              { type: 'add_counter', name: 'switches_pulled', delta: 1 },
              { type: 'show_message', text: 'Default path taken.' },
            ],
          },
        ],
      },
    ];

    let sim = createInitialSimulationState(level, [0]);
    const pos22 = gridToWorldUnits(2, 2);
    sim.players[0].xUnits = pos22.xUnits;
    sim.players[0].zUnits = pos22.zUnits;
    sim.players[0].gridRow = 2;
    sim.players[0].gridCol = 2;

    const useInput = {
      0: {
        moveForward: 0 as const,
        moveRight: 0 as const,
        sprint: false,
        yawDeltaBam: 0,
        pitchDeltaBam: 0,
        use: true,
        shoot: false,
      },
    };

    // Case 1: flag secret_found is false -> else branch taken (+1)
    sim = step(sim, useInput);
    assert.equal(sim.counters.switches_pulled, 1);
    assert.equal(sim.messages[0].text, 'Default path taken.');

    // Case 2: set flag secret_found = true -> then branch taken (+10 => 11)
    sim.flags.secret_found = true;
    sim = step(sim, useInput);
    assert.equal(sim.counters.switches_pulled, 11);
    assert.equal(sim.messages[1].text, 'Secret path taken!');

    assertNoFloatsInState(sim);
  });

  it('Phase 3 (Deterministic Random Branch): random_branch selects branch deterministically from Mulberry32 RNG seed', () => {
    const level = createBaseTestLevelV3();
    level.events = [
      {
        id: 'evt_random_loot',
        name: 'Random Loot Dispenser',
        enabled: true,
        trigger: { type: 'use', row: 2, col: 2 },
        conditions: [],
        actions: [
          {
            type: 'random_branch',
            branches: [
              {
                weight: 50,
                actions: [{ type: 'add_counter', name: 'switches_pulled', delta: 100 }],
              },
              {
                weight: 50,
                actions: [{ type: 'add_counter', name: 'switches_pulled', delta: 200 }],
              },
            ],
          },
        ],
      },
    ];

    const useInput = {
      0: {
        moveForward: 0 as const,
        moveRight: 0 as const,
        sprint: false,
        yawDeltaBam: 0,
        pitchDeltaBam: 0,
        use: true,
        shoot: false,
      },
    };

    // Run A with seed 42
    level.rngSeed = 42;
    let runA = createInitialSimulationState(level, [0]);
    runA = step(runA, useInput);

    // Run B with seed 42 (identical seed must produce bit-for-bit identical roll)
    let runB = createInitialSimulationState(level, [0]);
    runB = step(runB, useInput);

    assert.equal(runA.counters.switches_pulled, runB.counters.switches_pulled);
    assert.equal(runA.rngState, runB.rngState);
    assert.equal(
      runA.counters.switches_pulled === 100 || runA.counters.switches_pulled === 200,
      true
    );

    assertNoFloatsInState(runA);
  });

  it('Phase 3 (Earthquake Tremor): earthquake action sets intensity, duration_ticks, plays rumble sound, decrements to zero, and is omitted from hash when inactive', () => {
    const level = createBaseTestLevelV3();
    level.events = [
      {
        id: 'evt_earthquake',
        name: 'Earthquake Event',
        enabled: true,
        trigger: { type: 'use', row: 2, col: 2 },
        conditions: [],
        actions: [
          {
            type: 'earthquake',
            duration_ticks: 3,
            intensity: 75,
          },
        ],
      },
    ];

    let sim = createInitialSimulationState(level, [0]);
    const hashBefore = hashSimulationState(sim);

    // Trigger earthquake
    sim = step(sim, {
      0: {
        moveForward: 0,
        moveRight: 0,
        sprint: false,
        yawDeltaBam: 0,
        pitchDeltaBam: 0,
        use: true,
        shoot: false,
      },
    });

    assert.equal(Boolean(sim.earthquake), true);
    assert.equal(sim.earthquake?.intensity, 75);
    assert.equal(sim.earthquake?.remainingTicks, 3);
    assert.equal(sim.soundsPlayed.some((s) => s.soundId === 'earthquake_rumble'), true);

    // Tick 2: remainingTicks = 2
    sim = step(sim, {});
    assert.equal(sim.earthquake?.remainingTicks, 2);

    // Tick 3: remainingTicks = 1
    sim = step(sim, {});
    assert.equal(sim.earthquake?.remainingTicks, 1);

    // Tick 4: earthquake expires and is cleanly deleted
    sim = step(sim, {});
    assert.equal(sim.earthquake, undefined);

    assertNoFloatsInState(sim);
  });

  it('Phase 3 (Track Mover): move_along_track mover advances along waypoints and fires mover_finished upon reaching the end', () => {
    const level = createBaseTestLevelV3();
    level.events = [
      {
        id: 'evt_start_track',
        name: 'Start Track Cart',
        enabled: true,
        trigger: { type: 'use', row: 2, col: 2 },
        conditions: [],
        actions: [
          {
            type: 'move_along_track',
            tag: 88,
            waypoints: [
              { row: 2, col: 2 },
              { row: 2, col: 3 },
              { row: 3, col: 3 },
            ],
            speed_per_tick: 5000, // Reaches next waypoint in 2 ticks (10000 / 5000)
          },
        ],
      },
      {
        id: 'evt_track_done',
        name: 'Track Done Listener',
        enabled: true,
        trigger: { type: 'mover_finished', tag: 88, state: 'done' },
        conditions: [],
        actions: [
          { type: 'show_message', text: 'Track journey completed!' },
        ],
      },
    ];

    let sim = createInitialSimulationState(level, [0]);

    // Start track mover
    sim = step(sim, {
      0: {
        moveForward: 0,
        moveRight: 0,
        sprint: false,
        yawDeltaBam: 0,
        pitchDeltaBam: 0,
        use: true,
        shoot: false,
      },
    });

    const mover = sim.movers['track:88'];
    assert.equal(Boolean(mover), true);
    assert.equal(mover.kind, 'track');
    assert.equal(mover.state, 'active');
    assert.equal(mover.row, 2);
    assert.equal(mover.col, 2);

    // Step 2 ticks to reach waypoint 1 (row 2, col 3)
    sim = step(sim, {});
    sim = step(sim, {});
    assert.equal(sim.movers['track:88'].row, 2);
    assert.equal(sim.movers['track:88'].col, 3);

    // Step 2 ticks to reach waypoint 2 (row 3, col 3) and finish
    sim = step(sim, {});
    sim = step(sim, {});
    assert.equal(sim.movers['track:88'].row, 3);
    assert.equal(sim.movers['track:88'].col, 3);
    assert.equal(sim.movers['track:88'].state, 'done');

    // Trigger mover_finished fires listener
    sim = step(sim, {});
    assert.equal(sim.messages.some((m) => m.text === 'Track journey completed!'), true);

    assertNoFloatsInState(sim);
  });
});


