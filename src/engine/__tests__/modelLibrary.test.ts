import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  MODEL_CATEGORIES,
  isStaticModel,
  resolveEntityCategory,
} from '../modelLibrary/categories';

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
});
