/**
 * Re-exports runtime AssetRegistry from `src/runtime/AssetRegistry.ts`.
 */
export {
  BUILTIN_TEXTURE_IDS,
  BUILTIN_MODEL_IDS,
  BUILTIN_SOUND_IDS,
  SAFE_ASSET_ID_REGEX,
  computeDeterministicAssetId,
  AssetRegistry,
} from '../runtime/AssetRegistry';
export type { AssetAllowlist } from '../runtime/AssetRegistry';
