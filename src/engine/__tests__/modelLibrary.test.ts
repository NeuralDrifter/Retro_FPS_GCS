import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  MODEL_CATEGORIES,
  isStaticModel,
  resolveEntityCategory,
} from '../modelLibrary/categories';
import { measuredFootprintFromSize } from '../modelLibrary/footprint';
import {
  SimPlacedEntityV3,
  buildSolidFootprintGrid,
  getFootprintRect,
  quarterTurnsFromBam,
  rotatedFootprint,
  validateLevelDataV3,
} from '../sim';
import { LevelSerializer } from '../LevelSerializer';
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

  it('parseLevelJson names a missing model asset in its error', () => {
    const level = createSizedTestLevelV3(10, { row: 2, col: 2 });
    level.entities = [staticModel('ent-1', 4, 4, { modelAssetId: 'glb-0000000000000000' })];
    assert.throws(
      () => LevelSerializer.parseLevelJson(JSON.stringify(level)),
      /glb-0000000000000000/
    );
  });
});
