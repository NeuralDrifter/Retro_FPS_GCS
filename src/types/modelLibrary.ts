/**
 * ============================================================================
 * GRIDFORGE 3D MODEL LIBRARY TYPES (EDITOR FOLDERS, FILTERS & SETTINGS)
 * ============================================================================
 * Runtime category/collision/sizing types live in `src/runtime/types.ts` and
 * are re-exported here; editor-only library folder/filter/variant types stay here.
 */

import type {
  ModelCategoryId,
  ModelCategoryInfo,
  ModelCollision,
  ModelSizing,
} from '../runtime/types';

export type {
  ModelCategoryId,
  ModelCategoryInfo,
  ModelCollision,
  ModelSizing,
};

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
  /** Model's real size in meters at scale 1, so footprints can follow scale changes */
  measuredSizeMeters?: { width: number; depth: number };
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
