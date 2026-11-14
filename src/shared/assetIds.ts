/**
 * Asset ID rules shared by the sim, the runtime and the editor.
 * Levels reference assets only by these IDs, never by URL or file path.
 */
import { fnv1a64Hex } from './hash';

export const BUILTIN_TEXTURE_IDS: readonly string[] = [
  'default-grid',
  'techbase-panel',
  'dungeon-stone',
  'labyrinth-check',
  'floor-obsidian',
  'ceiling-coffer',
  'grate-alpha',
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
