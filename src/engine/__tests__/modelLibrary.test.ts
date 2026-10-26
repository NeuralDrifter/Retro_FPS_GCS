import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  MODEL_CATEGORIES,
  isStaticModel,
  resolveEntityCategory,
} from '../modelLibrary/categories';
import { measuredFootprintFromSize } from '../modelLibrary/footprint';
import {
  buildSolidFootprintGrid,
  getFootprintRect,
  quarterTurnsFromBam,
  rotatedFootprint,
} from '../sim';

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
});
