/**
 * Which assets a project uses (release plan P3.3, step 1). Pure data: no DOM and no asset
 * registry, so the export worker and the editor run the same scan.
 */
import type { ActionSpec, LevelDataV3 } from '../sim';
import { BUILTIN_MODEL_IDS, BUILTIN_TEXTURE_IDS } from '../shared/assetIds';
import type { ProjectDocV4 } from '../shared/project';
import { collectMenuTextureIds } from '../runtime/menu/types';
import type { MenuPackSpec } from '../runtime/menu/types';

/** Textures the runtime draws in code, so an export never ships a file for them */
export const BUILTIN_PROCEDURAL_TEXTURE_IDS = new Set<string>([
  ...BUILTIN_TEXTURE_IDS,
  'stone-dungeon',
  'brick',
  'metal',
  'stone',
  'scifi',
  'wood',
  'grid-floor',
  'door',
  'retro-nebula',
  'starry-void',
  'crimson-dusk',
  'emerald-grid',
]);

/** Models the runtime builds in code; `custom-glb` is the blueprint of every uploaded or library model */
export const BUILTIN_PROCEDURAL_MODEL_IDS = new Set<string>(BUILTIN_MODEL_IDS);

export function isBuiltInTexture(id: string): boolean {
  return !id || BUILTIN_PROCEDURAL_TEXTURE_IDS.has(id.toLowerCase());
}

export function isBuiltInModel(id: string): boolean {
  return !id || BUILTIN_PROCEDURAL_MODEL_IDS.has(id.toLowerCase());
}

/** Visits every action, including the ones nested in if_then_else and random_branch */
export function walkActions(actions: readonly ActionSpec[] | undefined, visitor: (action: ActionSpec) => void): void {
  if (!Array.isArray(actions)) return;
  for (const act of actions) {
    if (!act || typeof act !== 'object') continue;
    visitor(act);
    if (act.type === 'if_then_else') {
      walkActions(act.then_actions, visitor);
      walkActions(act.else_actions, visitor);
    } else if (act.type === 'random_branch' && Array.isArray(act.branches)) {
      for (const branch of act.branches) walkActions(branch.actions, visitor);
    }
  }
}

export interface UsedAssets {
  /** Texture ids that need a file, sorted */
  textures: string[];
  /** Model ids that need a file, sorted */
  models: string[];
}

/** The textures and models a level uses: cells, stacked layers, entities and event actions */
export function addLevelAssets(level: LevelDataV3, textures: Set<string>, models: Set<string>): void {
  const addMatrix = (m: readonly (readonly string[])[] | undefined) => {
    if (!Array.isArray(m)) return;
    for (const row of m) if (Array.isArray(row)) for (const id of row) if (id) textures.add(id);
  };
  addMatrix(level.wallTextures);
  addMatrix(level.floorTextures);
  addMatrix(level.ceilingTextures);
  for (const layer of level.layers ?? []) {
    addMatrix(layer?.wallTextures);
    addMatrix(layer?.floorTextures);
    addMatrix(layer?.ceilingTextures);
  }
  for (const event of level.events ?? []) {
    walkActions(event.actions, (action) => {
      if (action.type === 'set_wall_texture' || action.type === 'set_floor_texture' || action.type === 'set_ceiling_texture') {
        if (action.texture_id) textures.add(action.texture_id);
      } else if (action.type === 'spawn_entity') {
        const id = (action as { modelAssetId?: string }).modelAssetId || action.blueprintId;
        if (id) models.add(id);
      }
    });
  }
  for (const entity of level.entities ?? []) {
    const id = entity.modelAssetId || entity.blueprintId;
    if (id) models.add(id);
  }
}

/** Every texture and model file a project's export needs: built-ins are left out */
export function projectAssetIds(doc: ProjectDocV4): UsedAssets {
  const textures = new Set<string>();
  const models = new Set<string>();
  for (const level of doc.levels) addLevelAssets(level.data, textures, models);
  for (const id of collectMenuTextureIds(doc.campaign.menus as unknown as MenuPackSpec | undefined)) if (id) textures.add(id);
  return {
    textures: [...textures].filter((id) => !isBuiltInTexture(id)).sort(),
    models: [...models].filter((id) => !isBuiltInModel(id)).sort(),
  };
}
