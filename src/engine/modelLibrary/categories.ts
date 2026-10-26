/**
 * ============================================================================
 * PIE3D MODEL CATEGORIES & DEFAULTS
 * ============================================================================
 * Built-in world-building categories and the defaults each one gives a model.
 * Entities saved before categories existed have no `category`; they resolve to
 * 'characters' (or 'decorations' when not an enemy) and keep legacy behavior.
 */

import type {
  ModelCategoryId,
  ModelCategoryInfo,
} from '../../types/modelLibrary';

export const MODEL_CATEGORIES: readonly ModelCategoryInfo[] = [
  {
    id: 'characters',
    label: 'Characters',
    defaultCollision: 'solid',
    sizing: 'normalized',
    runsAI: true,
  },
  {
    id: 'decorations',
    label: 'Decorations',
    defaultCollision: 'nonSolid',
    sizing: 'real',
    runsAI: false,
  },
  {
    id: 'items',
    label: 'Items',
    defaultCollision: 'nonSolid',
    sizing: 'real',
    runsAI: false,
  },
  {
    id: 'buildings',
    label: 'Buildings',
    defaultCollision: 'solid',
    sizing: 'real',
    runsAI: false,
  },
  {
    id: 'vehicles',
    label: 'Vehicles',
    defaultCollision: 'solid',
    sizing: 'real',
    runsAI: false,
  },
];

export function isModelCategoryId(value: unknown): value is ModelCategoryId {
  return MODEL_CATEGORIES.some((c) => c.id === value);
}

export function getCategoryInfo(id: ModelCategoryId): ModelCategoryInfo {
  return MODEL_CATEGORIES.find((c) => c.id === id) ?? MODEL_CATEGORIES[0];
}

/** Category of a placed entity, applying the legacy rule when none is stored */
export function resolveEntityCategory(e: {
  category?: ModelCategoryId;
  isEnemy?: boolean;
}): ModelCategoryId {
  if (e.category) return e.category;
  return e.isEnemy === false ? 'decorations' : 'characters';
}

/**
 * True for models that never move or fight: they are not simulation entities
 * and only affect the world through their footprint. Legacy entities (no
 * category), characters, and the destructible supply crate are not static.
 */
export function isStaticModel(e: {
  category?: ModelCategoryId;
  blueprintId: string;
}): boolean {
  return (
    e.category !== undefined &&
    e.category !== 'characters' &&
    e.blueprintId !== 'supply-crate'
  );
}
