/**
 * ============================================================================
 * PIE3D MODEL LIBRARY TYPES (CATEGORIES, COLLISION & SIZING)
 * ============================================================================
 * Shared vocabulary for organizing 3D models into world-building categories
 * and for how a placed model sizes itself and collides.
 */

export type ModelCategoryId =
  | 'characters'
  | 'decorations'
  | 'items'
  | 'buildings'
  | 'vehicles';

/** 'solid' blocks movement like a wall; 'nonSolid' can be walked through */
export type ModelCollision = 'solid' | 'nonSolid';

/** 'normalized' scales to a fixed character height; 'real' keeps the model's own size */
export type ModelSizing = 'normalized' | 'real';

export interface ModelCategoryInfo {
  id: ModelCategoryId;
  label: string;
  defaultCollision: ModelCollision;
  sizing: ModelSizing;
  runsAI: boolean;
}
