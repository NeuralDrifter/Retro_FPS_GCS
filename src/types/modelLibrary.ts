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

/** A folder in the model library tree; built-in category folders carry `categoryId` */
export interface LibraryFolder {
  id: string;
  name: string;
  parentId: string | null;
  categoryId?: ModelCategoryId;
}

/** Per-model library defaults (and the settings a placed copy may override) */
export interface ModelSettings {
  category?: ModelCategoryId;
  collision?: ModelCollision;
  footprintW?: number;
  footprintD?: number;
  footprintOverride?: boolean;
  scale?: number;
  isEnemy?: boolean;
  maxHealth?: number;
  moveSpeed?: number;
  attackDamage?: number;
  measuredFootprint?: { w: number; d: number };
}

export type ResolvedModelSettings = ModelSettings &
  Required<
    Pick<
      ModelSettings,
      | 'category'
      | 'collision'
      | 'footprintW'
      | 'footprintD'
      | 'scale'
      | 'isEnemy'
      | 'maxHealth'
      | 'moveSpeed'
      | 'attackDamage'
    >
  >;

/** Global model library organization, shared by every level */
export interface ModelLibraryState {
  version: 1;
  nextFolderId: number;
  folders: LibraryFolder[];
  modelFolder: Record<string, string>;
  modelTags: Record<string, string[]>;
  modelSettings: Record<string, ModelSettings>;
}

export interface ModelFilter {
  /** Folder whose subtree to show, or null for the whole library */
  folderId: string | null;
  search: string;
  /** Models must carry every listed tag */
  tags: string[];
  /** When set, only these model ids (the ones placed in the current level) */
  usedModelIds: Set<string> | null;
}

/** Placed copies of one model that share identical settings */
export interface PlacementVariant {
  key: string;
  modelAssetId: string;
  name: string;
  count: number;
  sampleEntityId: string;
  settings: ModelSettings;
}
