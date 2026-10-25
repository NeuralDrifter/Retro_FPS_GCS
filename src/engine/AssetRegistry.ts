/**
 * ============================================================================
 * DETERMINISTIC ASSET REGISTRY & CONTENT-HASH ID RESOLVER
 * ============================================================================
 * Satisfies Constraint 6 of Amendment A:
 *  - Assets (textures, 3D .glb models, sounds) are referenced strictly by ID
 *    (`^[a-z0-9_-]+$`) from a registry.
 *  - Level v3 data and events never contain URLs or file paths.
 *  - Custom uploaded/URL assets receive deterministic content-hash IDs
 *    (`tex-<hash>` / `glb-<hash>`) instead of `Date.now()` or `Math.random()`.
 */

import { fnv1a64Hex } from './sim/hash';
import { Model3DAsset, TextureAsset } from '../types/engine';

export const BUILTIN_TEXTURE_IDS: readonly string[] = [
  'default-grid',
  'techbase-panel',
  'dungeon-stone',
  'labyrinth-check',
  'floor-obsidian',
  'ceiling-coffer',
];

export const BUILTIN_MODEL_IDS: readonly string[] = [
  'sentinel-bot',
  'turret-guardian',
  'supply-crate',
  'custom-glb',
];

export const BUILTIN_SOUND_IDS: readonly string[] = [
  'door_open',
  'door_close',
  'door_locked',
  'key_pickup',
  'secret_found',
  'switch_click',
  'alarm',
  'weapon_fire',
  'enemy_hit',
  'enemy_death',
  'player_hurt',
  'level_exit',
];

export const SAFE_ASSET_ID_REGEX = /^[a-z0-9_-]+$/;

export interface AssetAllowlist {
  textureIds: Set<string>;
  modelIds: Set<string>;
  soundIds: Set<string>;
}

/**
 * Generates a deterministic content-hash ID (`tex-<16hex>`, `glb-<16hex>`, `snd-<16hex>`)
 * from the asset's payload or source string. Never uses `Date.now()` or `Math.random()`.
 */
export function computeDeterministicAssetId(
  prefix: 'tex' | 'glb' | 'snd',
  content: string
): string {
  const hash = fnv1a64Hex(content.trim());
  return `${prefix}-${hash}`;
}

export class AssetRegistry {
  private static texturesById = new Map<string, TextureAsset>();
  private static modelsById = new Map<string, Model3DAsset>();
  private static extraSoundIds = new Set<string>();

  /**
   * Registers a texture asset into the runtime registry and returns its canonical ID.
   */
  public static registerTexture(asset: TextureAsset): TextureAsset {
    const id = SAFE_ASSET_ID_REGEX.test(asset.id)
      ? asset.id
      : computeDeterministicAssetId('tex', asset.previewUrl || asset.name);
    const normalized: TextureAsset = {
      ...asset,
      id,
    };
    this.texturesById.set(id, normalized);
    return normalized;
  }

  /**
   * Registers a 3D model asset into the runtime registry and returns its canonical ID.
   */
  public static registerModel(asset: Model3DAsset): Model3DAsset {
    const id = SAFE_ASSET_ID_REGEX.test(asset.id)
      ? asset.id
      : computeDeterministicAssetId(
          'glb',
          asset.customGlbUrl || asset.name || asset.id
        );
    const normalized: Model3DAsset = {
      ...asset,
      id,
    };
    this.modelsById.set(id, normalized);
    return normalized;
  }

  /**
   * Registers an arbitrary custom `.glb` URL and returns its deterministic `modelAssetId`.
   */
  public static registerCustomGlbUrl(
    customGlbUrl: string,
    name = 'Custom .glb Model',
    isEnemy = true
  ): string {
    const id = computeDeterministicAssetId('glb', customGlbUrl);
    if (!this.modelsById.has(id)) {
      this.modelsById.set(id, {
        id,
        blueprintId: 'custom-glb',
        name,
        sourceType: customGlbUrl.startsWith('data:') ? 'file' : 'url',
        isEnemy,
        defaultHealth: isEnemy ? 85 : 50,
        moveSpeed: isEnemy ? 4.5 : 0,
        attackDamage: isEnemy ? 14 : 0,
        accentHex: isEnemy ? '#10B981' : '#38BDF8',
        badgeText: 'GLB',
        customGlbUrl,
      });
    }
    return id;
  }

  public static getTexture(id: string): TextureAsset | undefined {
    return this.texturesById.get(id);
  }

  public static getModel(id: string): Model3DAsset | undefined {
    return this.modelsById.get(id);
  }

  public static getCustomGlbUrlForModelId(
    modelAssetId?: string
  ): string | undefined {
    if (!modelAssetId) return undefined;
    return this.modelsById.get(modelAssetId)?.customGlbUrl;
  }

  /**
   * Builds an `AssetAllowlist` combining built-in IDs, currently registered
   * runtime assets, and any additional explicit IDs.
   */
  public static createAllowlist(extra?: {
    textureIds?: Iterable<string>;
    modelIds?: Iterable<string>;
    soundIds?: Iterable<string>;
  }): AssetAllowlist {
    const textureIds = new Set<string>(BUILTIN_TEXTURE_IDS);
    const modelIds = new Set<string>(BUILTIN_MODEL_IDS);
    const soundIds = new Set<string>(BUILTIN_SOUND_IDS);

    for (const id of this.texturesById.keys()) textureIds.add(id);
    for (const id of this.modelsById.keys()) modelIds.add(id);
    for (const id of this.extraSoundIds) soundIds.add(id);

    if (extra?.textureIds) {
      for (const id of extra.textureIds) textureIds.add(id);
    }
    if (extra?.modelIds) {
      for (const id of extra.modelIds) modelIds.add(id);
    }
    if (extra?.soundIds) {
      for (const id of extra.soundIds) soundIds.add(id);
    }

    return { textureIds, modelIds, soundIds };
  }
}
