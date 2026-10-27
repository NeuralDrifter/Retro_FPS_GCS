/**
 * Canonical Test Levels & 3000-Tick Deterministic Input Recordings for Plan v2
 *
 * Test Level 1 (`createMinimalArenaTestLevel`):
 *  - 10x10 arena using only built-in procedural textures (`techbase-panel`,
 *    `floor-obsidian`, `ceiling-coffer`, `default-grid`), built-in archetypes
 *    (`sentinel-bot`, `turret-guardian`, `supply-crate`), one skybox
 *    (`retro-nebula`), and `events: []`.
 *
 * Test Level 2 (`createFullTestLevel`):
 *  - Uses a custom uploaded texture (`custom-tex-upload-hazard`, data URL PNG),
 *    a GitHub texture (`folder-tex-floor-tiles-checker-tiles-bw-marble-tile-01`),
 *    an uploaded `.glb` (`custom-glb-draco-pillar`, with KHR_draco_mesh_compression),
 *    a GitHub `.glb` (`folder-glb-characters-robots-turret`), doors, keys,
 *    pushwalls (`slide_wall`), a lift (`toggle_lift`), regions, flags, counters,
 *    timers, nested `if_then_else` and `random_branch`, `spawn_entity`,
 *    `set_wall_texture`, `set_floor_texture`, `set_ceiling_texture`, and
 *    `play_sound` cues.
 */

import {
  BAM_HALF_TURN,
  BAM_QUARTER_TURN,
  LevelDataV3,
  PlayerTickInput,
  SimCellType,
} from '../../runtime/sim';

export const TEST_CUSTOM_UPLOAD_TEXTURE_ID = 'custom-tex-upload-hazard';
export const TEST_GITHUB_TEXTURE_ID =
  'folder-tex-floor-tiles-checker-tiles-bw-marble-tile-01';
export const TEST_CUSTOM_UPLOAD_DRACO_MODEL_ID = 'custom-glb-draco-pillar';
export const TEST_GITHUB_MODEL_ID = 'folder-glb-characters-robots-turret';

/**
 * 1x1 8-bit RGBA PNG data URL for the custom uploaded texture fixture.
 */
export const TEST_CUSTOM_UPLOAD_TEXTURE_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function createMatrix<T>(size: number, val: T): T[][] {
  return Array.from({ length: size }, () =>
    Array.from({ length: size }, () => val)
  );
}

/**
 * Test Level 1: Minimal 10x10 Arena (Procedural-only, zero events)
 */
export function createMinimalArenaTestLevel(): LevelDataV3 {
  const size = 10;
  const grid: number[][] = Array.from({ length: size }, (_, r) =>
    Array.from({ length: size }, (__, c) =>
      r === 0 || r === size - 1 || c === 0 || c === size - 1
        ? SimCellType.WALL
        : SimCellType.EMPTY
    )
  );

  // Interior pillar, door, and keycard
  grid[4][4] = SimCellType.WALL;
  grid[4][5] = SimCellType.DOOR;
  grid[2][7] = SimCellType.KEY;

  const wallTextures = createMatrix(size, 'techbase-panel');
  wallTextures[4][4] = 'default-grid';
  const floorTextures = createMatrix(size, 'floor-obsidian');
  const ceilingTextures = createMatrix(size, 'ceiling-coffer');

  return {
    formatVersion: 3,
    gridSize: size,
    rngSeed: 10101,
    nextEntityId: 4,
    spawn: {
      row: 2,
      col: 2,
      yawBam: BAM_HALF_TURN,
    },
    minimapEnabled: true,
    skybox: {
      theme: 'retro-nebula',
      seed: 1,
      showCeiling: false,
    },
    grid,
    wallTextures,
    floorTextures,
    ceilingTextures,
    entities: [
      {
        id: 'ent-1',
        row: 7,
        col: 2,
        blueprintId: 'sentinel-bot',
        name: 'Cyber Sentinel Bot',
        yawBam: 0,
        scalePct: 100,
        isEnemy: true,
        maxHealth: 75,
        moveSpeedUnitsPerTick: 40,
        attackDamage: 10,
        patrol: true,
      },
      {
        id: 'ent-2',
        row: 7,
        col: 7,
        blueprintId: 'turret-guardian',
        name: 'Heavy Mech Stalker',
        yawBam: BAM_QUARTER_TURN,
        scalePct: 100,
        isEnemy: true,
        maxHealth: 90,
        moveSpeedUnitsPerTick: 35,
        attackDamage: 12,
        ambush: true,
      },
      {
        id: 'ent-3',
        row: 3,
        col: 7,
        blueprintId: 'supply-crate',
        name: 'Supply Crate',
        yawBam: 0,
        scalePct: 100,
        isEnemy: false,
        maxHealth: 50,
      },
    ],
    regions: [],
    variables: {
      flags: {},
      counters: {},
      timers: [],
    },
    events: [],
    metadata: {
      title: 'Minimal Arena Test Level',
      author: 'GridForge Test Suite',
    },
  };
}

/**
 * Test Level 2: Full Feature Level (Custom + GitHub Textures & Models, Draco, Events, Movers)
 */
export function createFullTestLevel(): LevelDataV3 {
  const size = 10;
  const grid: number[][] = Array.from({ length: size }, (_, r) =>
    Array.from({ length: size }, (__, c) =>
      r === 0 || r === size - 1 || c === 0 || c === size - 1
        ? SimCellType.WALL
        : SimCellType.EMPTY
    )
  );

  // Door at (4, 5), keycard at (2, 3), pushwall at (5, 2)
  grid[4][5] = SimCellType.DOOR;
  grid[2][3] = SimCellType.KEY;
  grid[5][2] = SimCellType.WALL;

  const wallTextures = createMatrix(size, 'techbase-panel');
  wallTextures[0][2] = TEST_CUSTOM_UPLOAD_TEXTURE_ID;
  wallTextures[5][2] = 'stone-dungeon';

  const floorTextures = createMatrix(size, 'floor-obsidian');
  floorTextures[2][2] = TEST_GITHUB_TEXTURE_ID;
  floorTextures[2][3] = TEST_GITHUB_TEXTURE_ID;

  const ceilingTextures = createMatrix(size, 'ceiling-coffer');

  const cellTags = createMatrix(size, 0);
  cellTags[4][5] = 10; // Door tag
  cellTags[5][2] = 20; // Pushwall tag
  cellTags[6][6] = 30; // Lift tag

  const floorHeights = createMatrix(size, 0);
  const ceilingHeights = createMatrix(size, 1000);

  return {
    formatVersion: 3,
    gridSize: size,
    rngSeed: 424242,
    nextEntityId: 5,
    spawn: {
      row: 2,
      col: 2,
      yawBam: BAM_HALF_TURN,
    },
    minimapEnabled: true,
    skybox: {
      theme: 'crimson-dusk',
      seed: 7,
      showCeiling: true,
    },
    grid,
    wallTextures,
    floorTextures,
    ceilingTextures,
    cellTags,
    floorHeights,
    ceilingHeights,
    entities: [
      {
        id: 'ent-1',
        row: 7,
        col: 3,
        blueprintId: 'sentinel-bot',
        name: 'Arena Sentinel',
        yawBam: 0,
        scalePct: 100,
        isEnemy: true,
        maxHealth: 70,
        moveSpeedUnitsPerTick: 40,
        attackDamage: 8,
        tag: 100,
      },
      {
        id: 'ent-2',
        row: 7,
        col: 7,
        blueprintId: 'custom-glb',
        modelAssetId: TEST_GITHUB_MODEL_ID,
        name: 'GitHub Turret Unit',
        yawBam: BAM_QUARTER_TURN,
        scalePct: 100,
        isEnemy: true,
        maxHealth: 80,
        moveSpeedUnitsPerTick: 30,
        attackDamage: 10,
        tag: 101,
        category: 'characters',
        collision: 'solid',
        footprintW: 1,
        footprintD: 1,
      },
      {
        id: 'ent-3',
        row: 3,
        col: 7,
        blueprintId: 'custom-glb',
        modelAssetId: TEST_CUSTOM_UPLOAD_DRACO_MODEL_ID,
        name: 'Uploaded Draco Pillar',
        yawBam: 0,
        scalePct: 100,
        isEnemy: false,
        maxHealth: 100,
        tag: 102,
        category: 'decorations',
        collision: 'solid',
        footprintW: 1,
        footprintD: 1,
      },
    ],
    regions: [
      {
        id: 'reg-key-hall',
        name: 'Key Hallway',
        cells: [
          { row: 2, col: 3 },
          { row: 3, col: 3 },
        ],
      },
      {
        id: 'reg-south-sector',
        name: 'South Sector',
        cells: [
          { row: 6, col: 5 },
          { row: 6, col: 6 },
        ],
      },
    ],
    variables: {
      flags: {
        hall_visited: false,
        lift_activated: false,
        secret_opened: false,
      },
      counters: {
        steps_taken: 0,
        combat_wave: 0,
      },
      timers: ['wave_timer'],
    },
    events: [
      {
        id: 'evt-01-level-start',
        name: 'Initialize Level Timer',
        enabled: true,
        trigger: { type: 'level_start' },
        conditions: [],
        actions: [
          {
            type: 'start_timer',
            timer: 'wave_timer',
            duration_ticks: 60,
          },
          {
            type: 'play_sound',
            sound_id: 'level_start_chime',
            row: 2,
            col: 2,
          },
        ],
        options: { once: true },
      },
      {
        id: 'evt-02-enter-hall',
        name: 'Enter Key Hallway',
        enabled: true,
        trigger: {
          type: 'enter_region',
          region: 'reg-key-hall',
          who: 'player',
        },
        conditions: [
          {
            type: 'flag',
            name: 'hall_visited',
            is: false,
          },
        ],
        actions: [
          {
            type: 'set_flag',
            name: 'hall_visited',
            value: true,
          },
          {
            type: 'add_counter',
            name: 'steps_taken',
            delta: 1,
          },
          {
            type: 'slide_wall',
            row: 5,
            col: 2,
            direction: 'E',
            distance_cells: 2,
            speed_per_tick: 500,
          },
          {
            type: 'open_door',
            row: 4,
            col: 5,
            speed_per_tick: 500,
          },
          {
            type: 'set_wall_texture',
            row: 0,
            col: 3,
            texture_id: TEST_CUSTOM_UPLOAD_TEXTURE_ID,
          },
          {
            type: 'set_floor_texture',
            row: 3,
            col: 3,
            texture_id: TEST_GITHUB_TEXTURE_ID,
          },
          {
            type: 'set_ceiling_texture',
            row: 3,
            col: 3,
            texture_id: 'industrial-rust',
          },
        ],
        options: { once: true },
      },
      {
        id: 'evt-03-wave-timer',
        name: 'Wave Timer Branches',
        enabled: true,
        trigger: {
          type: 'timer_fired',
          timer: 'wave_timer',
        },
        conditions: [],
        actions: [
          {
            type: 'add_counter',
            name: 'combat_wave',
            delta: 1,
          },
          {
            type: 'if_then_else',
            condition: {
              type: 'flag',
              name: 'hall_visited',
              is: true,
            },
            then_actions: [
              {
                type: 'toggle_lift',
                row: 6,
                col: 6,
                lower_height_units: 0,
                upper_height_units: 250,
                speed_per_tick: 500,
                wait_ticks: 30,
              },
              {
                type: 'random_branch',
                branches: [
                  {
                    weight: 50,
                    actions: [
                      {
                        type: 'spawn_entity',
                        blueprintId: 'sentinel-bot',
                        row: 8,
                        col: 2,
                        yaw_bam: 0,
                        isEnemy: true,
                        maxHealth: 60,
                      },
                    ],
                  },
                  {
                    weight: 50,
                    actions: [
                      {
                        type: 'spawn_entity',
                        blueprintId: 'supply-crate',
                        row: 8,
                        col: 4,
                        yaw_bam: 0,
                        isEnemy: false,
                        maxHealth: 40,
                      },
                    ],
                  },
                ],
              },
            ],
            else_actions: [
              {
                type: 'set_flag',
                name: 'lift_activated',
                value: true,
              },
              {
                type: 'toggle_lift',
                row: 6,
                col: 6,
                lower_height_units: 0,
                upper_height_units: 200,
                speed_per_tick: 500,
                wait_ticks: 20,
              },
            ],
          },
        ],
        options: { once: true },
      },
    ],
    metadata: {
      title: 'Full Export Test Level',
      author: 'GridForge Test Suite',
    },
  };
}

/**
 * Generates a deterministic 3000-tick `PlayerTickInput[]` sequence exercising
 * movement, strafing, turning, sprinting, use (doors/switches), and shooting.
 */
export function generateDeterministic3000TickInputs(
  numTicks = 3000
): PlayerTickInput[] {
  const inputs: PlayerTickInput[] = [];
  for (let t = 0; t < numTicks; t++) {
    const phase = t % 300;
    let moveForward: -1 | 0 | 1 = 0;
    let moveRight: -1 | 0 | 1 = 0;
    let turnLeft = false;
    let turnRight = false;
    let sprint = false;
    let yawDeltaBam = 0;
    let pitchDeltaBam = 0;
    let use = false;
    let shoot = false;

    if (phase < 60) {
      // Walk forward and strafe right toward (2, 3) & hallway
      moveForward = 1;
      moveRight = phase < 30 ? 1 : 0;
      sprint = phase >= 20 && phase < 45;
    } else if (phase < 100) {
      // Turn and use doors/pushwalls
      turnLeft = phase < 80;
      yawDeltaBam = phase % 2 === 0 ? 120 : -60;
      use = phase === 65 || phase === 85;
    } else if (phase < 160) {
      // Advance and fire shots
      moveForward = 1;
      moveRight = phase % 40 < 20 ? -1 : 1;
      shoot = phase === 110 || phase === 130 || phase === 150;
    } else if (phase < 220) {
      // Backpedal and turn right
      moveForward = -1;
      turnRight = phase < 190;
      pitchDeltaBam = phase < 190 ? 25 : -25;
      use = phase === 180 || phase === 210;
    } else {
      // Circle strafe + periodic fire
      moveForward = phase < 260 ? 1 : -1;
      moveRight = phase < 250 ? 1 : -1;
      sprint = true;
      yawDeltaBam = 180;
      shoot = phase === 240 || phase === 280;
    }

    inputs.push({
      moveForward,
      moveRight,
      turnLeft,
      turnRight,
      sprint,
      yawDeltaBam,
      pitchDeltaBam,
      use,
      shoot,
    });
  }
  return inputs;
}
