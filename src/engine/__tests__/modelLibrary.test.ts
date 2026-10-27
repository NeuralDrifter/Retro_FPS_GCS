import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  MODEL_CATEGORIES,
  isStaticModel,
  resolveEntityCategory,
} from '../modelLibrary/categories';
import { measuredFootprintFromSize } from '../modelLibrary/footprint';
import {
  LevelDataV3,
  SimPlacedEntityV3,
  SimulationState,
  assertNoFloatsInState,
  buildSolidFootprintGrid,
  castGridRayDDA,
  cloneSimulationState,
  gridToWorldUnits,
  createInitialSimulationState,
  step,
  validateSimulationState,
  getFootprintRect,
  quarterTurnsFromBam,
  rotatedFootprint,
  validateLevelDataV3,
} from '../../runtime/sim';
import { LevelSerializer } from '../LevelSerializer';
import { CollisionSystem } from '../../runtime/CollisionSystem';
import { ENGINE_CONFIG } from '../../types/engine';
import { createSizedTestLevelV3 } from './testLevels';

function staticModel(
  id: string,
  row: number,
  col: number,
  extra: Partial<SimPlacedEntityV3> = {}
): SimPlacedEntityV3 {
  return {
    id,
    row,
    col,
    blueprintId: 'custom-glb',
    yawBam: 0,
    scalePct: 100,
    category: 'buildings',
    collision: 'solid',
    footprintW: 1,
    footprintD: 1,
    ...extra,
  };
}

/** 16x16 walled level with the player at row 8 col 2 facing East (+X) */
function walkingLevel(entities: SimPlacedEntityV3[]): LevelDataV3 {
  const level = createSizedTestLevelV3(16, { row: 8, col: 2 });
  level.spawn.yawBam = 49152;
  level.entities = entities;
  return level;
}

function walkEast(sim: SimulationState, ticks: number): SimulationState {
  let next = sim;
  for (let t = 0; t < ticks; t++) {
    next = step(next, {
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
  return next;
}

function errorCodes(level: unknown): string[] {
  return validateLevelDataV3(level).errors.map((e) => e.code);
}

describe('Model library & multi-cell placement', () => {
  // ==========================================================================
  // CATEGORIES
  // ==========================================================================
  it('MODEL_CATEGORIES defines the five categories with spec defaults', () => {
    assert.deepEqual(
      MODEL_CATEGORIES.map((c) => [c.id, c.defaultCollision, c.sizing, c.runsAI]),
      [
        ['characters', 'solid', 'normalized', true],
        ['decorations', 'nonSolid', 'real', false],
        ['items', 'nonSolid', 'real', false],
        ['buildings', 'solid', 'real', false],
        ['vehicles', 'solid', 'real', false],
      ]
    );
  });

  it('resolveEntityCategory maps legacy entities by isEnemy', () => {
    assert.equal(resolveEntityCategory({}), 'characters');
    assert.equal(resolveEntityCategory({ isEnemy: false }), 'decorations');
    assert.equal(
      resolveEntityCategory({ category: 'vehicles', isEnemy: true }),
      'vehicles'
    );
  });

  it('resolveEntityCategory puts the uncategorized supply crate in Items', () => {
    assert.equal(
      resolveEntityCategory({ blueprintId: 'supply-crate', isEnemy: false }),
      'items'
    );
    assert.equal(
      resolveEntityCategory({ blueprintId: 'supply-crate', category: 'buildings' }),
      'buildings'
    );
  });

  it('a character with a 3x2 footprint starts at the footprint center, where the 3D view draws it', () => {
    const level = walkingLevel([
      staticModel('ent-1', 3, 4, {
        category: 'characters',
        isEnemy: true,
        footprintW: 3,
        footprintD: 2,
      }),
    ]);
    const ent = createInitialSimulationState(level, [0]).entities?.['ent-1'];
    const anchor = gridToWorldUnits(3, 4, 16);
    assert.equal(ent?.xUnits, anchor.xUnits + 1000);
    assert.equal(ent?.zUnits, anchor.zUnits + 500);
    assert.equal(ent?.row, 3);
    assert.equal(ent?.col, 5);
    assertNoFloatsInState(createInitialSimulationState(level, [0]));
  });

  it('isStaticModel is false for legacy, characters and the supply crate', () => {
    assert.equal(isStaticModel({ blueprintId: 'custom-glb' }), false);
    assert.equal(
      isStaticModel({ category: 'characters', blueprintId: 'custom-glb' }),
      false
    );
    assert.equal(
      isStaticModel({ category: 'items', blueprintId: 'supply-crate' }),
      false
    );
    assert.equal(
      isStaticModel({ category: 'buildings', blueprintId: 'custom-glb' }),
      true
    );
  });

  // ==========================================================================
  // FOOTPRINT MATH & SOLID OCCUPANCY GRID
  // ==========================================================================
  it('quarterTurnsFromBam rounds to the nearest quarter turn', () => {
    assert.deepEqual(
      [0, 16000, 16384, 40000, 65000].map(quarterTurnsFromBam),
      [0, 1, 1, 2, 0]
    );
  });

  it('rotatedFootprint swaps w and d on odd quarter turns', () => {
    assert.deepEqual(rotatedFootprint(3, 2, 1), { w: 2, d: 3 });
    assert.deepEqual(rotatedFootprint(3, 2, 2), { w: 3, d: 2 });
  });

  it('getFootprintRect anchors at row/col and extends right and down, rotated', () => {
    assert.deepEqual(
      getFootprintRect({ row: 4, col: 5, footprintW: 3, footprintD: 2, blueprintId: 'custom-glb' }),
      { row0: 4, col0: 5, row1: 5, col1: 7 }
    );
    assert.deepEqual(
      getFootprintRect({ row: 4, col: 5, footprintW: 3, footprintD: 2, yawBam: 16384, blueprintId: 'custom-glb' }),
      { row0: 4, col0: 5, row1: 6, col1: 6 }
    );
  });

  it('buildSolidFootprintGrid counts overlapping static solids and ignores non-solid, characters and legacy', () => {
    const g = buildSolidFootprintGrid(
      [
        { row: 1, col: 1, footprintW: 2, footprintD: 2, category: 'buildings', collision: 'solid', blueprintId: 'custom-glb' },
        { row: 2, col: 2, category: 'vehicles', collision: 'solid', blueprintId: 'custom-glb' },
        { row: 5, col: 5, category: 'decorations', collision: 'nonSolid', blueprintId: 'custom-glb' },
        { row: 6, col: 6, category: 'characters', collision: 'solid', blueprintId: 'custom-glb' },
        { row: 7, col: 7, blueprintId: 'custom-glb' },
      ],
      10
    )!;
    assert.equal(g[1][1], 1);
    assert.equal(g[2][2], 2);
    assert.equal(g[5][5], 0);
    assert.equal(g[6][6], 0);
    assert.equal(g[7][7], 0);
    assert.equal(
      buildSolidFootprintGrid([{ row: 0, col: 0, blueprintId: 'custom-glb' }], 10),
      undefined
    );
  });

  it('measuredFootprintFromSize ceils to cells and clamps degenerate or huge sizes to 1..16', () => {
    assert.deepEqual(measuredFootprintFromSize(9, 4.1), { w: 3, d: 2 });
    assert.deepEqual(measuredFootprintFromSize(0, Number.NaN), { w: 1, d: 1 });
    assert.deepEqual(measuredFootprintFromSize(1600, 1), { w: 16, d: 1 });
  });

  // ==========================================================================
  // LEVEL FORMAT, VALIDATOR & SERIALIZER
  // ==========================================================================
  it('validator accepts a solid 3x2 building and 600 static decorations', () => {
    const level = createSizedTestLevelV3(64, { row: 2, col: 2 });
    level.entities = [staticModel('ent-1', 10, 10, { footprintW: 3, footprintD: 2 })];
    for (let i = 0; i < 600; i++) {
      level.entities.push(
        staticModel(`ent-${i + 2}`, 20 + Math.floor(i / 40), 5 + (i % 40), {
          category: 'decorations',
          collision: 'nonSolid',
        })
      );
    }
    const res = validateLevelDataV3(level);
    assert.equal(res.valid, true, JSON.stringify(res.errors.slice(0, 3)));
  });

  it('validator rejects bad category, collision, footprint size and footprint past the edge', () => {
    const withEntity = (e: SimPlacedEntityV3) => {
      const level = createSizedTestLevelV3(10, { row: 2, col: 2 });
      level.entities = [e];
      return level;
    };
    assert.ok(errorCodes(withEntity(staticModel('ent-1', 4, 4, { category: 'tank' as never }))).includes('INVALID_CATEGORY'));
    assert.ok(errorCodes(withEntity(staticModel('ent-1', 4, 4, { collision: 'ghost' as never }))).includes('INVALID_COLLISION'));
    assert.ok(errorCodes(withEntity(staticModel('ent-1', 4, 4, { footprintW: 17 }))).includes('INVALID_FOOTPRINT'));
    assert.ok(errorCodes(withEntity(staticModel('ent-1', 4, 9, { footprintW: 3 }))).includes('OUT_OF_RANGE_FOOTPRINT'));
  });

  it('validator caps characters at MAX_ENTITIES separately from static models', () => {
    const level = createSizedTestLevelV3(64, { row: 2, col: 2 });
    level.entities = Array.from({ length: 513 }, (_, i) =>
      staticModel(`ent-${i + 1}`, 3 + Math.floor(i / 50), 3 + (i % 50), {
        category: 'characters',
      })
    );
    assert.ok(errorCodes(level).includes('BUDGET_EXCEEDED'));
  });

  it('serializer round-trips placement fields and leaves legacy entities without them', () => {
    const level = createSizedTestLevelV3(16, { row: 2, col: 2 });
    const serialized = LevelSerializer.serializeLevel({
      grid: level.grid,
      wallTextures: level.wallTextures,
      floorTextures: level.floorTextures,
      ceilingTextures: level.ceilingTextures,
      customTextures: [],
      entities: [
        {
          id: 'ent-1', row: 5, col: 5, blueprintId: 'custom-glb', name: 'House', yaw: 0, scale: 1,
          category: 'buildings', collision: 'solid', footprintW: 3, footprintD: 2, footprintOverride: true,
        },
        { id: 'ent-2', row: 9, col: 9, blueprintId: 'sentinel-bot', name: 'Bot', yaw: 0, scale: 1 },
      ],
      spawn: { row: 2, col: 2, yaw: 0 },
      skyboxTheme: 'retro-nebula',
      skyboxSeed: 1,
      showCeiling: false,
      minimapEnabled: true,
    });
    const restored = LevelSerializer.parseLevelJson(JSON.stringify(serialized));
    const house = restored.entities.find((e) => e.id === 'ent-1')!;
    assert.equal(house.category, 'buildings');
    assert.equal(house.collision, 'solid');
    assert.equal(house.footprintW, 3);
    assert.equal(house.footprintD, 2);
    assert.equal(house.footprintOverride, true);
    const bot = restored.entities.find((e) => e.id === 'ent-2')!;
    assert.equal(bot.category, undefined);
    assert.equal(bot.collision, undefined);
    assert.equal(bot.footprintW, undefined);
  });

  it('parseLevelJson loads a level with a missing model, keeps its copies and warns', () => {
    const level = createSizedTestLevelV3(10, { row: 2, col: 2 });
    level.entities = [
      staticModel('ent-1', 4, 4, { modelAssetId: 'glb-0000000000000000', name: 'Old Mill' }),
    ];
    const restored = LevelSerializer.parseLevelJson(JSON.stringify(level));
    assert.equal(restored.entities[0].modelAssetId, 'glb-0000000000000000');
    assert.equal(restored.missingModelWarnings?.length, 1);
    assert.match(restored.missingModelWarnings![0], /glb-0000000000000000/);
    assert.match(restored.missingModelWarnings![0], /'Old Mill'/);
    assert.equal(validateLevelDataV3(level).valid, true);
  });

  it('a malformed model id is still rejected', () => {
    const level = createSizedTestLevelV3(10, { row: 2, col: 2 });
    level.entities = [staticModel('ent-1', 4, 4, { modelAssetId: 'Bad Id!' })];
    assert.ok(errorCodes(level).includes('UNREGISTERED_ASSET_ID'));
  });

  // ==========================================================================
  // SIMULATION COLLISION AGAINST SOLID FOOTPRINTS
  // ==========================================================================
  it('player walking east stops before a solid 2x2 building', () => {
    const house = staticModel('ent-1', 7, 6, { footprintW: 2, footprintD: 2 });
    const sim = walkEast(createInitialSimulationState(walkingLevel([house]), [0]), 120);
    assert.ok(sim.players[0].gridCol <= 5, `reached col ${sim.players[0].gridCol}`);
    assertNoFloatsInState(sim);
  });

  it('player walks through a non-solid footprint', () => {
    const arch = staticModel('ent-1', 7, 6, { footprintW: 2, footprintD: 2, collision: 'nonSolid' });
    const sim = walkEast(createInitialSimulationState(walkingLevel([arch]), [0]), 120);
    assert.ok(sim.players[0].gridCol >= 8, `stopped at col ${sim.players[0].gridCol}`);
    assertNoFloatsInState(sim);
  });

  it('static models are not sim entities and the grid is omitted when none are solid', () => {
    const level = walkingLevel([
      staticModel('ent-1', 3, 3, { category: 'decorations', collision: 'nonSolid' }),
      staticModel('ent-2', 4, 4, { category: 'characters', collision: 'solid', isEnemy: true }),
    ]);
    const sim = createInitialSimulationState(level, [0]);
    assert.equal(sim.entities?.['ent-1'], undefined);
    assert.ok(sim.entities?.['ent-2']);
    assert.equal(sim.solidFootprint, undefined);
    assertNoFloatsInState(sim);
  });

  it('solidFootprint survives clone and passes state validation', () => {
    const sim = createInitialSimulationState(
      walkingLevel([staticModel('ent-1', 7, 6, { footprintW: 2, footprintD: 2 })]),
      [0]
    );
    assert.equal(sim.solidFootprint?.[7][6], 1);
    const clone = cloneSimulationState(sim);
    assert.deepEqual(clone.solidFootprint, sim.solidFootprint);
    assert.notEqual(clone.solidFootprint, sim.solidFootprint);
    const res = validateSimulationState(clone);
    assert.equal(res.valid, true, JSON.stringify(res.errors));
    assertNoFloatsInState(clone);
  });

  it('a ray stops at a solid model footprint and passes when there is none', () => {
    const level = walkingLevel([]);
    const footprint = buildSolidFootprintGrid(
      [staticModel('ent-1', 8, 6)],
      16
    );
    const origin = gridToWorldUnits(8, 2, 16);
    const cast = (solid?: number[][]) =>
      castGridRayDDA({
        originXUnits: origin.xUnits,
        originZUnits: origin.zUnits,
        yawBam: 49152,
        maxDistanceUnits: 16000,
        grid: level.grid,
        solidFootprint: solid,
      });
    assert.equal(cast(footprint).col, 6);
    assert.equal(cast(undefined).col, 15);
  });

  it('a chasing sim enemy cannot walk through a solid model', () => {
    const level = walkingLevel([
      staticModel('ent-1', 8, 5),
      staticModel('ent-2', 8, 7, {
        category: 'characters',
        isEnemy: true,
        maxHealth: 50,
        moveSpeedUnitsPerTick: 40,
        attackDamage: 5,
      }),
    ]);
    let sim = createInitialSimulationState(level, [0]);
    for (let t = 0; t < 200; t++) sim = step(sim, {});
    assert.ok((sim.entities?.['ent-2'].col ?? 0) >= 6, `enemy reached col ${sim.entities?.['ent-2'].col}`);
    assertNoFloatsInState(sim);
  });

  // ==========================================================================
  // RUNTIME (THREE.JS SIDE) COLLISION
  // ==========================================================================
  it('CollisionSystem treats solid footprint cells as walls', () => {
    const grid = Array.from({ length: 10 }, () => Array.from({ length: 10 }, () => 0));
    const solid = Array.from({ length: 10 }, () => Array.from({ length: 10 }, () => 0));
    solid[2][3] = 1;
    const at = CollisionSystem.gridToWorld(2, 3, 10);
    const r = ENGINE_CONFIG.PLAYER_RADIUS;
    assert.equal(CollisionSystem.checkCircleCollision(at.x, at.z, r, grid, new Set(), solid), true);
    assert.equal(CollisionSystem.checkCircleCollision(at.x, at.z, r, grid, new Set()), false);
    assert.equal(CollisionSystem.isCellSolid(grid, 2, 3, new Set(), solid), true);
  });

  it('validator accepts a 1% scale so centimeter-unit models can be fixed', () => {
    const level = createSizedTestLevelV3(10, { row: 2, col: 2 });
    level.entities = [staticModel('ent-1', 4, 4, { scalePct: 1 })];
    const res = validateLevelDataV3(level);
    assert.equal(res.valid, true, JSON.stringify(res.errors));
  });
});
