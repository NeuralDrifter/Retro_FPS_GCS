import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getDetailedCellPx } from '../../components/MapEditor2D';

describe('2D Map Editor Zoom Level & View Mode Controls', () => {
  it('calculates ergonomic detailed cell size on small grids (e.g. 10x10)', () => {
    // On a small 10x10 grid with fitCellPx ~ 36px, detailed should scale up to ~54px
    const detailed = getDetailedCellPx(36);
    assert.strictEqual(detailed, 54);
    assert.ok(detailed > 36, 'Detailed view should be larger than overview fit');
  });

  it('caps detailed cell size at MAX_CELL_PX (56px) on tiny grids', () => {
    // On a tiny grid where fit is already 45px, detailed shouldn't exceed 56px
    const detailed = getDetailedCellPx(45);
    assert.strictEqual(detailed, 56);
  });

  it('provides comfortable >= 38px cell target on large grids (32x32, 64x64, 128x128)', () => {
    // 32x32 grid: overview fit is ~14px
    const detailed32 = getDetailedCellPx(14);
    assert.strictEqual(detailed32, 38);

    // 64x64 grid: overview fit is ~7px
    const detailed64 = getDetailedCellPx(7);
    assert.strictEqual(detailed64, 38);

    // 128x128 grid: overview fit is ~4px (MIN_CELL_PX)
    const detailed128 = getDetailedCellPx(4);
    assert.strictEqual(detailed128, 38);
  });

  it('guarantees detailed view is significantly larger than overview fit on larger grids', () => {
    const testFits = [4, 6, 8, 12, 16, 20, 24];
    for (const fit of testFits) {
      const detailed = getDetailedCellPx(fit);
      assert.ok(detailed >= 38, `Detailed cell px (${detailed}) should be at least 38px`);
      assert.ok(
        detailed >= fit * 1.5,
        `Detailed cell px (${detailed}) should be at least 1.5x fit (${fit})`
      );
    }
  });
});
