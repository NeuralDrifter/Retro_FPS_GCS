/**
 * Shared level fixtures for the engine and model library test files.
 */
import { ENGINE_CONFIG, createUniformTextureMatrix } from '../../types/engine';
import { BAM_HALF_TURN, LevelDataV3, SIM_CONFIG, SimCellType } from '../../runtime/sim';

export function createBaseTestLevelV3(): LevelDataV3 {
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
    wallTextures: createUniformTextureMatrix('default-grid', ENGINE_CONFIG.GRID_SIZE),
    floorTextures: createUniformTextureMatrix('floor-obsidian', ENGINE_CONFIG.GRID_SIZE),
    ceilingTextures: createUniformTextureMatrix('ceiling-coffer', ENGINE_CONFIG.GRID_SIZE),
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

/** A walled square level of any size with the player spawned at `spawn` */
export function createSizedTestLevelV3(
  size: number,
  spawn: { row: number; col: number }
): LevelDataV3 {
  const base = createBaseTestLevelV3();
  const grid = Array.from({ length: size }, (_, r) =>
    Array.from({ length: size }, (__, c) =>
      r === 0 || r === size - 1 || c === 0 || c === size - 1
        ? SimCellType.WALL
        : SimCellType.EMPTY
    )
  );
  return {
    ...base,
    gridSize: size,
    spawn: { ...base.spawn, ...spawn },
    grid,
    wallTextures: createUniformTextureMatrix('default-grid', size),
    floorTextures: createUniformTextureMatrix('floor-obsidian', size),
    ceilingTextures: createUniformTextureMatrix('ceiling-coffer', size),
    regions: [],
  };
}
