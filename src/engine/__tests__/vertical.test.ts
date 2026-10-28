import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  LevelDataV3,
  LevelLayerV3,
  PlayerTickInput,
  SIM_CONFIG,
  SimCellType,
  SimulationState,
  WALK_SURFACE_EMPTY,
  assertNoFloatsInState,
  createInitialSimulationState,
  gridToWorldUnits,
  isVerticalLevel,
  openSpansAt,
  step,
  tileColumnSpans,
  validateLevelDataV3,
} from '../../runtime/sim';
import { createUniformTextureMatrix } from '../../types/engine';
import { createBaseTestLevelV3 } from './testLevels';

const SIZE = 10;
const fill = (v: number) => Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => v));

const idle: PlayerTickInput = {
  moveForward: 0,
  moveRight: 0,
  sprint: false,
  yawDeltaBam: 0,
  pitchDeltaBam: 0,
  use: false,
  shoot: false,
};
const forward: PlayerTickInput = { ...idle, moveForward: 1 };

function run(state: SimulationState, input: PlayerTickInput, ticks: number): SimulationState {
  let s = state;
  for (let i = 0; i < ticks; i++) s = step(s, { 0: input });
  return s;
}

/** The base test level with the door and key removed (spawn (2, 2) faces south, +row) */
function verticalLevel(edit: (level: LevelDataV3) => void): LevelDataV3 {
  const level = createBaseTestLevelV3();
  level.grid[4][5] = SimCellType.EMPTY;
  level.grid[1][8] = SimCellType.EMPTY;
  level.floorHeights = fill(0);
  level.ceilingHeights = fill(SIM_CONFIG.DEFAULT_CEILING_HEIGHT_UNITS);
  edit(level);
  return level;
}

/** A layer above the ground floor: solid everywhere except the given open cells */
function upperLayer(open: [number, number][], cell = SimCellType.EMPTY): LevelLayerV3 {
  const grid = fill(SimCellType.WALL);
  for (const [r, c] of open) grid[r][c] = cell;
  return {
    grid,
    wallTextures: createUniformTextureMatrix('default-grid', SIZE),
    floorTextures: createUniformTextureMatrix('floor-obsidian', SIZE),
    ceilingTextures: createUniformTextureMatrix('ceiling-coffer', SIZE),
  };
}

const feet = (s: SimulationState) => s.players[0].feetUnits as number;
const row = (s: SimulationState) => s.players[0].gridRow;

describe('Vertical levels', () => {
  it('leaves flat levels on the original code path', () => {
    const flat = createBaseTestLevelV3();
    assert.equal(isVerticalLevel(flat), false);
    const state = createInitialSimulationState(flat, [0]);
    assert.equal(state.vertical, undefined);
    assert.equal(state.players[0].feetUnits, undefined);
  });

  it('climbs a step no higher than the step height', () => {
    const level = verticalLevel((l) => {
      l.floorHeights![4][2] = 100;
    });
    const s = run(createInitialSimulationState(level, [0]), forward, 20);
    assert.ok(row(s) >= 4, `player should pass the step, reached row ${row(s)}`);
    assert.ok(feet(s) === 100 || row(s) > 4);
  });

  it('is blocked by a ledge higher than the step height', () => {
    const level = verticalLevel((l) => {
      l.floorHeights![4][2] = 400;
    });
    const s = run(createInitialSimulationState(level, [0]), forward, 30);
    assert.equal(row(s), 3);
    assert.equal(feet(s), 0);
  });

  it('falls off a ledge and lands on the floor below', () => {
    const level = verticalLevel((l) => {
      // A 400-unit ledge leaves 600 units of head room under the 1000-unit ceiling
      for (let r = 1; r <= 3; r++) l.floorHeights![r][2] = 400;
    });
    let s = createInitialSimulationState(level, [0]);
    assert.equal(feet(s), 400);
    s = run(s, forward, 20);
    s = run(s, idle, 40);
    assert.equal(feet(s), 0);
    assert.equal(s.players[0].onGround, true);
    assert.equal(s.players[0].health, 100, 'no fall damage unless turned on');
  });

  it('takes fall damage only when the setting is on', () => {
    const level = verticalLevel((l) => {
      l.movement = { jump: false, crouch: false, stepUnits: 125, fallDamage: true, aim: 'free' };
      l.layers = [upperLayer([[1, 2], [2, 2], [3, 2]])];
      l.layers[0].grid[4][2] = SimCellType.HOLE;
      l.spawn.layer = 1;
    });
    let s = createInitialSimulationState(level, [0]);
    assert.equal(feet(s), 1000);
    s = run(s, forward, 20);
    s = run(s, idle, 40);
    assert.equal(feet(s), 0);
    assert.ok(s.players[0].health < 100, 'a full-layer drop hurts');
  });

  it('starts on the spawn layer and drops through a hole to the room below', () => {
    const level = verticalLevel((l) => {
      l.layers = [upperLayer([[2, 2], [3, 2]])];
      l.layers[0].grid[4][2] = SimCellType.HOLE;
      l.spawn.layer = 1;
    });
    let s = createInitialSimulationState(level, [0]);
    assert.equal(feet(s), 1000);
    assert.equal(s.players[0].yUnits, 1000 + SIM_CONFIG.PLAYER_EYE_HEIGHT_UNITS);
    s = run(s, forward, 20);
    s = run(s, idle, 45);
    assert.equal(feet(s), 0);
  });

  it('opens one tall space where a hole removes the floor between layers', () => {
    const level = verticalLevel((l) => {
      l.layers = [upperLayer([[5, 5]], SimCellType.HOLE)];
    });
    const s = createInitialSimulationState(level, [0]);
    const heights = (r: number, c: number) => {
      const p = gridToWorldUnits(r, c, SIZE);
      return openSpansAt(s, p.xUnits, p.zUnits).map((sp) => [sp.floorUnits, sp.ceilingUnits]);
    };
    assert.deepEqual(heights(5, 5), [[0, 2000]]);
    assert.deepEqual(heights(5, 4), [[0, 1000]]);
  });

  it('walks up a slope gradually', () => {
    const level = verticalLevel((l) => {
      // Facing south, so a tile rising toward the south climbs as the player walks
      l.slopes = [{ row: 4, col: 2, dir: 'S', riseUnits: 120 }];
      for (let r = 5; r <= 8; r++) l.floorHeights![r][2] = 120;
    });
    let s = createInitialSimulationState(level, [0]);
    const heights: number[] = [];
    for (let i = 0; i < 40; i++) {
      s = run(s, forward, 1);
      heights.push(feet(s));
    }
    const midSlope = heights.filter((h) => h > 0 && h < 120);
    assert.ok(midSlope.length >= 3, `expected gradual heights, got ${heights.join(',')}`);
    assert.equal(heights[heights.length - 1], 120);
  });

  it('jumps only when jumping is turned on', () => {
    const jump: PlayerTickInput = { ...idle, jump: true };
    const off = verticalLevel((l) => {
      l.movement = { jump: false, crouch: false, stepUnits: 125, fallDamage: false, aim: 'free' };
      l.floorHeights![8][8] = 50; // A raised tile away from the player makes the level vertical
    });
    let s = run(createInitialSimulationState(off, [0]), jump, 8);
    assert.equal(feet(s), 0);

    const on = verticalLevel((l) => {
      l.movement = { jump: true, crouch: false, stepUnits: 125, fallDamage: false, aim: 'free' };
    });
    s = createInitialSimulationState(on, [0]);
    let peak = 0;
    for (let i = 0; i < 40; i++) {
      s = step(s, { 0: i === 0 ? jump : idle });
      peak = Math.max(peak, feet(s));
    }
    assert.ok(peak > 250 && peak < 330, `jump peak ${peak}`);
    assert.equal(feet(s), 0);
  });

  it('jumps onto a ledge it could not step onto', () => {
    const level = verticalLevel((l) => {
      l.floorHeights![4][2] = 250;
      l.movement = { jump: true, crouch: false, stepUnits: 125, fallDamage: false, aim: 'free' };
    });
    let s = run(createInitialSimulationState(level, [0]), forward, 20);
    assert.equal(row(s), 3);
    s = step(s, { 0: { ...forward, jump: true } });
    s = run(s, forward, 20);
    assert.ok(row(s) >= 4);
    assert.ok(feet(s) >= 250 || row(s) > 4);
  });

  it('crouches under a low ceiling only when crouching is turned on', () => {
    const lowCeiling = (crouch: boolean) =>
      verticalLevel((l) => {
        for (let r = 4; r <= 6; r++) l.ceilingHeights![r][2] = 350;
        l.movement = { jump: false, crouch, stepUnits: 125, fallDamage: false, aim: 'free' };
      });
    const crouchForward: PlayerTickInput = { ...forward, crouch: true };
    const blocked = run(createInitialSimulationState(lowCeiling(false), [0]), crouchForward, 40);
    assert.equal(row(blocked), 3);
    const passed = run(createInitialSimulationState(lowCeiling(true), [0]), crouchForward, 90);
    assert.ok(row(passed) >= 6, `crouching player reached row ${row(passed)}`);
    assert.equal(passed.players[0].crouching, true);
    assert.equal(
      passed.players[0].yUnits,
      feet(passed) + SIM_CONFIG.PLAYER_CROUCH_EYE_HEIGHT_UNITS
    );
  });

  it('stands on the baked top surface of a walkable model', () => {
    const level = verticalLevel((l) => {
      const at = gridToWorldUnits(4, 2, SIZE);
      // A 1-cell box 100 units high centered on (4, 2), sampled every 125 units
      const cols = 9;
      const top = Array.from({ length: cols * cols }, () => 100);
      const bottom = Array.from({ length: cols * cols }, () => 0);
      l.entities = [
        {
          id: 'ent-1',
          row: 4,
          col: 2,
          blueprintId: 'custom-glb',
          category: 'decorations',
          collision: 'solid',
          walkable: true,
          walkSurface: {
            originXUnits: at.xUnits - 500,
            originZUnits: at.zUnits - 500,
            spacingUnits: 125,
            cols,
            rows: cols,
            top,
            bottom,
          },
        },
      ];
    });
    let s = createInitialSimulationState(level, [0]);
    s = run(s, forward, 20);
    assert.equal(row(s), 4);
    assert.equal(feet(s), 100);
    assertNoFloatsInState(s);
  });

  it('does not treat empty walk surface samples as solid', () => {
    const level = verticalLevel((l) => {
      const at = gridToWorldUnits(4, 2, SIZE);
      l.entities = [
        {
          id: 'ent-1',
          row: 4,
          col: 2,
          blueprintId: 'custom-glb',
          category: 'decorations',
          collision: 'solid',
          walkable: true,
          walkSurface: {
            originXUnits: at.xUnits - 500,
            originZUnits: at.zUnits - 500,
            spacingUnits: 500,
            cols: 3,
            rows: 3,
            top: Array.from({ length: 9 }, () => WALK_SURFACE_EMPTY),
            bottom: Array.from({ length: 9 }, () => WALK_SURFACE_EMPTY),
          },
        },
      ];
    });
    const s = run(createInitialSimulationState(level, [0]), forward, 30);
    assert.ok(row(s) >= 5);
    assert.equal(feet(s), 0);
  });

  it('keeps every vertical state value an integer', () => {
    const level = verticalLevel((l) => {
      l.slopes = [{ row: 4, col: 2, dir: 'S', riseUnits: 333 }];
      l.floorHeights![5][2] = 333;
      l.movement = { jump: true, crouch: true, stepUnits: 125, fallDamage: true, aim: 'auto' };
    });
    let s = createInitialSimulationState(level, [0]);
    for (let i = 0; i < 90; i++) {
      s = step(s, { 0: { ...forward, jump: i % 17 === 0, crouch: i % 23 < 5, yawDeltaBam: i % 7 } });
      assertNoFloatsInState(s);
    }
  });

  it('validates layers, slopes, heights and 3D placement fields', () => {
    const level = verticalLevel((l) => {
      l.layers = [upperLayer([[2, 2]])];
      l.slopes = [{ row: 4, col: 2, dir: 'S', riseUnits: 200 }];
      l.movement = { jump: true, crouch: true, stepUnits: 125, fallDamage: false, aim: 'auto' };
      l.spawn.layer = 0;
      l.entities = [
        {
          id: 'ent-1',
          row: 3,
          col: 3,
          blueprintId: 'supply-crate',
          yawBam: 0,
          scalePct: 100,
          layer: 1,
          offsetXUnits: 120,
          offsetZUnits: -40,
          elevationUnits: 300,
          pitchBam: 16384,
          rollBam: 0,
        },
      ];
    });
    const ok = validateLevelDataV3(level);
    assert.deepEqual(ok.errors, []);

    const bad = verticalLevel((l) => {
      l.layers = [upperLayer([[2, 2]])];
      l.layers[0].grid[3][3] = 9;
      l.slopes = [{ row: 4, col: 2, dir: 'X' as never, riseUnits: 5000 }];
      l.movement = { jump: true, crouch: true, stepUnits: -5, fallDamage: false, aim: 'free' };
    });
    const codes = validateLevelDataV3(bad).errors.map((e) => e.code);
    assert.ok(codes.includes('INVALID_CELL_TYPE'));
    assert.ok(codes.includes('INVALID_SLOPE'));
    assert.ok(codes.includes('INVALID_MOVEMENT'));
  });
});

describe('Vertical level saving and loading', () => {
  it('round-trips layers, heights, slopes, movement and 3D placement through a save file', async () => {
    const { LevelSerializer } = await import('../LevelSerializer');
    const { createDefaultVerticalData, createSolidLayer } = await import('../../runtime/types');
    const base = createBaseTestLevelV3();
    const vertical = createDefaultVerticalData(SIZE);
    vertical.floorHeights[3][3] = 250;
    vertical.slopes = [{ row: 4, col: 4, dir: 'E', riseUnits: 300 }];
    const layer = createSolidLayer(SIZE, { wall: 'default-grid', floor: 'grate-alpha', ceiling: 'ceiling-coffer' });
    layer.grid[2][2] = SimCellType.EMPTY;
    layer.grid[2][3] = SimCellType.HOLE;
    vertical.layers = [layer];
    vertical.movement = { jump: true, crouch: false, stepUnits: 150, fallDamage: true, aim: 'auto' };
    vertical.spawnLayer = 1;

    const saved = LevelSerializer.serializeLevel({
      grid: base.grid,
      wallTextures: base.wallTextures,
      floorTextures: base.floorTextures,
      ceilingTextures: base.ceilingTextures,
      customTextures: [],
      entities: [
        {
          id: 'ent-1',
          row: 2,
          col: 2,
          blueprintId: 'supply-crate',
          name: 'Pipe',
          yaw: Math.PI / 2,
          scale: 1,
          layer: 1,
          offsetX: 0.123,
          offsetZ: -1.25,
          elevation: 2.001,
          pitch: Math.PI / 2,
          roll: 0,
        },
      ],
      spawn: { row: 2, col: 2, yaw: 0 },
      skyboxTheme: 'retro-nebula',
      skyboxSeed: 1,
      showCeiling: true,
      minimapEnabled: true,
      vertical,
    });
    const loaded = LevelSerializer.parseLevelJson(JSON.stringify(saved));
    assert.deepEqual(loaded.vertical, vertical);
    const ent = loaded.entities[0];
    assert.equal(ent.layer, 1);
    // Positions come back exactly (to well under a millimeter), not rounded to 4 mm units
    assert.ok(Math.abs((ent.offsetX ?? 0) - 0.123) < 1e-6);
    assert.ok(Math.abs((ent.offsetZ ?? 0) + 1.25) < 1e-6);
    assert.ok(Math.abs((ent.elevation ?? 0) - 2.001) < 1e-6);
    assert.ok(Math.abs((ent.pitch ?? 0) - Math.PI / 2) < 1e-3);
  });

  it('writes no vertical fields for a flat level', async () => {
    const { LevelSerializer } = await import('../LevelSerializer');
    const { createDefaultVerticalData } = await import('../../runtime/types');
    const base = createBaseTestLevelV3();
    const v3 = LevelSerializer.serializeLevelV3({
      grid: base.grid,
      wallTextures: base.wallTextures,
      floorTextures: base.floorTextures,
      ceilingTextures: base.ceilingTextures,
      entities: [],
      spawn: { row: 2, col: 2, yaw: 0 },
      skyboxTheme: 'retro-nebula',
      skyboxSeed: 1,
      showCeiling: false,
      minimapEnabled: true,
      vertical: createDefaultVerticalData(SIZE),
    });
    for (const key of ['floorHeights', 'ceilingHeights', 'slopes', 'layers', 'movement']) {
      assert.equal(key in v3, false, `${key} should be left out`);
    }
    assert.equal('layer' in v3.spawn, false);
  });
});

/** A static solid model on the ground layer at (4, 2), optionally with a measured height */
function solidModelAt42(bottom?: number, top?: number): LevelDataV3['entities'][number] {
  return {
    id: 'ent-1',
    row: 4,
    col: 2,
    blueprintId: 'custom-glb',
    category: 'decorations',
    collision: 'solid',
    ...(bottom !== undefined && top !== undefined
      ? { modelBottomUnits: bottom, modelTopUnits: top }
      : {}),
  };
}

const jumpOn = { jump: true, crouch: false, stepUnits: 125, fallDamage: false, aim: 'free' as const };

describe('Doors and keycards on stacked layers', () => {
  /** Layer 1 has a corridor down column 2 with a door at (4, 2); spawn on `spawnLayer` */
  const doorLevel = (spawnLayer: number) =>
    verticalLevel((l) => {
      l.layers = [upperLayer([1, 2, 3, 4, 5, 6].map((r) => [r, 2] as [number, number]))];
      l.layers[0].grid[4][2] = SimCellType.DOOR;
      l.spawn.layer = spawnLayer;
    });

  it('blocks the corridor until a player on that layer opens it', () => {
    let s = createInitialSimulationState(doorLevel(1), [0]);
    assert.equal(feet(s), 1000);
    assert.ok(s.movers['door:L1:4,2'], 'layer 1 door has its own mover');
    s = run(s, forward, 30);
    assert.equal(row(s), 3, 'closed door blocks');
    s = run(s, { ...idle, use: true }, 1);
    s = run(s, idle, 40);
    assert.equal(s.movers['door:L1:4,2'].state, 'open');
    s = run(s, forward, 30);
    assert.ok(row(s) >= 5, `walked through the open door, reached row ${row(s)}`);
    assert.equal(feet(s), 1000);
    assertNoFloatsInState(s);
  });

  it('cannot be opened from the layer below', () => {
    let s = createInitialSimulationState(doorLevel(0), [0]);
    s = run(s, forward, 6);
    s = run(s, { ...idle, use: true }, 1);
    s = run(s, idle, 40);
    assert.equal(s.movers['door:L1:4,2'].state, 'closed');
    // The ground layer under the door is open, so this player walks on underneath it
    s = run(s, forward, 30);
    assert.ok(row(s) >= 5);
  });

  it('picks up a keycard only on its own layer', () => {
    const keyLevel = (spawnLayer: number) =>
      verticalLevel((l) => {
        l.layers = [upperLayer([1, 2, 3, 4, 5, 6].map((r) => [r, 2] as [number, number]))];
        l.layers[0].grid[4][2] = SimCellType.KEY;
        l.spawn.layer = spawnLayer;
      });
    const below = run(createInitialSimulationState(keyLevel(0), [0]), forward, 30);
    assert.deepEqual(below.collectedKeys, []);
    const above = run(createInitialSimulationState(keyLevel(1), [0]), forward, 30);
    assert.deepEqual(above.collectedKeys, ['L1:4,2']);
    assert.ok(above.players[0].items.includes('keycard'));
  });
});

describe('Sloped ceilings', () => {
  it('slopes the head room across the tile and stays inside its layer', () => {
    const level = verticalLevel((l) => {
      l.ceilingHeights![4][2] = 500;
      l.ceilingHeights![4][3] = 900;
      l.slopes = [
        { row: 4, col: 2, dir: 'S', riseUnits: 400, surface: 'ceiling' },
        { row: 4, col: 3, dir: 'S', riseUnits: 400, surface: 'ceiling' },
      ];
    });
    assert.deepEqual(validateLevelDataV3(level).errors, []);
    const s = createInitialSimulationState(level, [0]);
    const at = (r: number, c: number) => gridToWorldUnits(r, c, SIZE);
    const ceilingAt = (r: number, c: number, dz: number) =>
      tileColumnSpans(s, r, c, at(r, c).xUnits, at(r, c).zUnits + dz)[0].ceilingUnits;
    assert.equal(ceilingAt(4, 2, -500), 500, 'low edge');
    assert.equal(ceilingAt(4, 2, 0), 700, 'middle');
    assert.equal(ceilingAt(4, 2, 499), 899);
    assert.equal(ceilingAt(4, 3, 400), 1000, 'clamped to the top of the layer');
    // The floor of a tile with only a ceiling slope stays flat
    assert.equal(tileColumnSpans(s, 4, 2, at(4, 2).xUnits, at(4, 2).zUnits)[0].floorUnits, 0);
  });

  it('keeps a floor slope and a ceiling slope on the same tile apart', () => {
    const level = verticalLevel((l) => {
      l.slopes = [
        { row: 4, col: 2, dir: 'S', riseUnits: 200 },
        { row: 4, col: 2, dir: 'N', riseUnits: -200, surface: 'ceiling' },
      ];
    });
    const s = createInitialSimulationState(level, [0]);
    const at = gridToWorldUnits(4, 2, SIZE);
    const south = tileColumnSpans(s, 4, 2, at.xUnits, at.zUnits + 500)[0];
    assert.equal(south.floorUnits, 200);
    assert.equal(south.ceilingUnits, 1000);
    const north = tileColumnSpans(s, 4, 2, at.xUnits, at.zUnits - 500)[0];
    assert.equal(north.floorUnits, 0);
    assert.equal(north.ceilingUnits, 800);
  });

  it('rejects an unknown slope surface', () => {
    const level = verticalLevel((l) => {
      l.slopes = [{ row: 4, col: 2, dir: 'S', riseUnits: 200, surface: 'wall' as never }];
    });
    assert.ok(validateLevelDataV3(level).errors.some((e) => e.code === 'INVALID_SLOPE'));
  });
});

describe('Solid models block only their measured height', () => {
  it('blocks a whole layer when the model was never measured', () => {
    const level = verticalLevel((l) => {
      l.movement = jumpOn;
      l.entities = [solidModelAt42()];
    });
    const s = run(createInitialSimulationState(level, [0]), forward, 30);
    assert.equal(row(s), 3);
  });

  it('lets you step onto a low model', () => {
    const level = verticalLevel((l) => {
      l.movement = jumpOn;
      l.entities = [solidModelAt42(0, 100)];
    });
    let s = createInitialSimulationState(level, [0]);
    for (let i = 0; i < 40 && row(s) < 4; i++) s = run(s, forward, 1);
    assert.equal(row(s), 4);
    assert.equal(feet(s), 100, 'standing on top of the model');
  });

  it('lets you walk under a hanging model', () => {
    const level = verticalLevel((l) => {
      l.movement = jumpOn;
      l.entities = [solidModelAt42(600, 900)];
    });
    const s = run(createInitialSimulationState(level, [0]), forward, 30);
    assert.ok(row(s) >= 5, `walked under it, reached row ${row(s)}`);
    assert.equal(feet(s), 0);
  });

  it('validates the measured height', () => {
    const bad = verticalLevel((l) => {
      l.entities = [solidModelAt42(300, 100)];
    });
    assert.ok(validateLevelDataV3(bad).errors.some((e) => e.code === 'INVALID_PLACEMENT'));
  });
});

describe('Fine model placement', () => {
  it('accepts positions with up to three decimals of a unit and rounds them in the game', () => {
    const level = verticalLevel((l) => {
      l.entities = [
        {
          id: 'ent-1',
          row: 5,
          col: 5,
          blueprintId: 'sentinel-bot',
          yawBam: 0,
          scalePct: 100,
          offsetXUnits: 62.5,
          offsetZUnits: -0.25,
          elevationUnits: 12.125,
        },
      ];
    });
    assert.deepEqual(validateLevelDataV3(level).errors, []);
    const s = createInitialSimulationState(level, [0]);
    assertNoFloatsInState(s);
    const center = gridToWorldUnits(5, 5, SIZE);
    assert.equal(s.entities!['ent-1'].xUnits, center.xUnits + 63);

    const tooFine = verticalLevel((l) => {
      l.entities = [{ id: 'ent-1', row: 5, col: 5, blueprintId: 'sentinel-bot', offsetXUnits: 1.0001 }];
    });
    assert.ok(validateLevelDataV3(tooFine).errors.some((e) => e.code === 'INVALID_PLACEMENT'));
  });

  it('saves measured model heights only on vertical levels', async () => {
    const { LevelSerializer } = await import('../LevelSerializer');
    const { createDefaultVerticalData } = await import('../../runtime/types');
    const base = createBaseTestLevelV3();
    const save = (vertical: ReturnType<typeof createDefaultVerticalData>) =>
      LevelSerializer.serializeLevelV3({
        grid: base.grid,
        wallTextures: base.wallTextures,
        floorTextures: base.floorTextures,
        ceilingTextures: base.ceilingTextures,
        entities: [
          {
            id: 'ent-1',
            row: 3,
            col: 3,
            blueprintId: 'custom-glb',
            name: 'Crate',
            yaw: 0,
            scale: 1,
            modelBottomUnits: 0,
            modelTopUnits: 180,
          },
        ],
        spawn: { row: 2, col: 2, yaw: 0 },
        skyboxTheme: 'retro-nebula',
        skyboxSeed: 1,
        showCeiling: false,
        minimapEnabled: true,
        vertical,
      });
    const flat = save(createDefaultVerticalData(SIZE));
    assert.equal('modelTopUnits' in flat.entities[0], false);
    const tall = createDefaultVerticalData(SIZE);
    tall.floorHeights[3][3] = 100;
    const vertical = save(tall);
    assert.equal(vertical.entities[0].modelTopUnits, 180);
    assert.equal(vertical.entities[0].modelBottomUnits, 0);
  });
});

describe('Layered surfaces', () => {
  it('draws a sloped ceiling and can draw only some tiles', async () => {
    const { buildLayeredSurfaces } = await import('../../runtime/LayeredSurfaces');
    const { createDefaultVerticalData } = await import('../../runtime/types');
    const base = createBaseTestLevelV3();
    base.grid[4][5] = SimCellType.EMPTY;
    base.grid[1][8] = SimCellType.EMPTY;
    const vertical = createDefaultVerticalData(SIZE);
    vertical.ceilingHeights[4][2] = 500;
    vertical.slopes = [{ row: 4, col: 2, dir: 'S', riseUnits: 500, surface: 'ceiling' }];
    const input = {
      grid: base.grid,
      wallTextures: base.wallTextures,
      floorTextures: base.floorTextures,
      ceilingTextures: base.ceilingTextures,
      vertical,
      showCeiling: true,
    };
    const only42 = buildLayeredSurfaces({ ...input, includeTile: (r, c) => r === 4 && c === 2 });
    const ceiling = only42.find((b) => b.kind === 'ceiling')!;
    const ys = new Set<number>();
    for (let i = 1; i < ceiling.positions.length; i += 3) ys.add(Math.round(ceiling.positions[i] * 1000));
    assert.deepEqual([...ys].sort((a, b) => a - b), [2000, 4000], 'ceiling runs from 2 m up to 4 m');
    const all = buildLayeredSurfaces(input);
    const count = (batches: typeof all) => batches.reduce((n, b) => n + b.positions.length, 0);
    assert.ok(count(only42) < count(all));
  });
});

describe('Classic retro movement', () => {
  it('runs a classic level on the flat movement code', () => {
    const level = createBaseTestLevelV3();
    level.classicMovement = true;
    assert.deepEqual(validateLevelDataV3(level).errors, []);
    const state = createInitialSimulationState(level, [0]);
    assert.equal(state.vertical, undefined);
  });

  it('rejects a classic level that uses vertical features, naming them', () => {
    const level = verticalLevel((l) => {
      l.classicMovement = true;
      l.layers = [upperLayer([[2, 2]])];
      l.slopes = [{ row: 4, col: 2, dir: 'S', riseUnits: 200 }];
    });
    const error = validateLevelDataV3(level).errors.find((e) => e.path === '$.classicMovement');
    assert.ok(error, 'classic level with layers is rejected');
    assert.match(error!.message, /layers, slopes/);
  });

  it('saves and loads the switch, and lists what blocks it in the editor', async () => {
    const { LevelSerializer } = await import('../LevelSerializer');
    const { editorVerticalFeatures } = await import('../../runtime/verticalLevelData');
    const { createDefaultVerticalData } = await import('../../runtime/types');
    const base = createBaseTestLevelV3();
    const vertical = { ...createDefaultVerticalData(SIZE), classic: true };
    const params = {
      grid: base.grid,
      wallTextures: base.wallTextures,
      floorTextures: base.floorTextures,
      ceilingTextures: base.ceilingTextures,
      customTextures: [],
      entities: [],
      spawn: { row: 2, col: 2, yaw: 0 },
      skyboxTheme: 'retro-nebula' as const,
      skyboxSeed: 1,
      showCeiling: false,
      minimapEnabled: true,
      vertical,
    };
    const v3 = LevelSerializer.serializeLevelV3(params);
    assert.equal(v3.classicMovement, true);
    assert.equal('movement' in v3, false);
    const loaded = LevelSerializer.parseLevelJson(JSON.stringify(LevelSerializer.serializeLevel(params)));
    assert.equal(loaded.vertical?.classic, true);

    assert.deepEqual(editorVerticalFeatures(base.grid, createDefaultVerticalData(SIZE), []), []);
    const tall = createDefaultVerticalData(SIZE);
    tall.floorHeights[3][3] = 100;
    const placed = [
      { id: 'ent-1', row: 3, col: 3, blueprintId: 'supply-crate' as const, name: 'Crate', yaw: 0, scale: 1, elevation: 1 },
    ];
    assert.deepEqual(editorVerticalFeatures(base.grid, tall, placed), ['tile heights', 'models placed in 3D']);
  });
});
