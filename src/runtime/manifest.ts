/**
 * ============================================================================
 * GAME MANIFEST SCHEMA & MIGRATION HOOKS (`/src/runtime/manifest.ts`)
 * ============================================================================
 * Phase 2 GameManifest wrapping LevelDataV3 with export metadata and asset lists.
 * Provides creation, serialization, validation, and schemaVersion migration.
 * Zero React or editor-only dependencies.
 */

import {
  CampaignSettings,
  GameManifest,
  GameManifestAssets,
  GameManifestMeta,
  LevelStateData,
  ManifestModelAsset,
  ManifestTextureAsset,
  TextureAsset,
} from './types';
import { LevelDataV3, validateLevelDataV3 } from './sim';
import { RuntimeLevelSerializer } from './LevelSerializer';
import { AssetRegistry } from './AssetRegistry';

export const CURRENT_MANIFEST_SCHEMA_VERSION = 1;
export const DEFAULT_ENGINE_VERSION = '2.0.0';

/**
 * Creates a compliant GameManifest wrapping a LevelDataV3 or LevelStateData
 * (and optional multi-level campaign levels + carry-over settings).
 */
export function createGameManifest(
  levelInput: LevelDataV3 | LevelStateData,
  meta?: Partial<GameManifestMeta>,
  assets?: Partial<GameManifestAssets>,
  campaignOptions?: {
    levels?: (LevelDataV3 | LevelStateData)[];
    campaign?: CampaignSettings;
  }
): GameManifest {
  const { levelV3, customTextures } = RuntimeLevelSerializer.migrateToV3(levelInput);

  const rawLevelsList =
    campaignOptions?.levels ??
    ('levels' in levelInput && Array.isArray(levelInput.levels)
      ? levelInput.levels
      : undefined);

  let migratedLevels: LevelDataV3[] | undefined;
  const allCustomTexturesMap = new Map<string, TextureAsset>();
  for (const t of customTextures) {
    allCustomTexturesMap.set(t.id, t);
  }

  if (rawLevelsList && rawLevelsList.length > 0) {
    migratedLevels = rawLevelsList.map((lvl) => {
      const migrated = RuntimeLevelSerializer.migrateToV3(lvl);
      for (const t of migrated.customTextures) {
        allCustomTexturesMap.set(t.id, t);
      }
      return migrated.levelV3;
    });
  }

  const primaryLevelV3 =
    migratedLevels && migratedLevels.length > 0 ? migratedLevels[0] : levelV3;

  const rawCampaign =
    campaignOptions?.campaign ??
    ('campaign' in levelInput && levelInput.campaign
      ? levelInput.campaign
      : undefined);

  const finalCampaign: CampaignSettings | undefined = rawCampaign
    ? {
        carryOverHealth: rawCampaign.carryOverHealth !== false,
        carryOverAmmo: rawCampaign.carryOverAmmo !== false,
      }
    : undefined;

  const finalMeta: GameManifestMeta = {
    title:
      meta?.title ||
      primaryLevelV3.metadata?.title ||
      levelV3.metadata?.title ||
      ('engine' in levelInput && typeof (levelInput as any).title === 'string'
        ? (levelInput as any).title
        : 'Untitled Game'),
    author: meta?.author || 'Creator',
    description: meta?.description || '',
    createdAt:
      meta?.createdAt ||
      primaryLevelV3.metadata?.exportedAt ||
      levelV3.metadata?.exportedAt ||
      ('timestamp' in levelInput && typeof (levelInput as any).timestamp === 'string'
        ? (levelInput as any).timestamp
        : new Date().toISOString()),
    engineVersion: meta?.engineVersion || DEFAULT_ENGINE_VERSION,
  };

  let textures: ManifestTextureAsset[] = assets?.textures ? [...assets.textures] : [];
  if (textures.length === 0 && allCustomTexturesMap.size > 0) {
    textures = [...allCustomTexturesMap.values()].map((t) => ({
      id: t.id,
      path: t.previewUrl || '',
      mimeType: 'image/png',
    }));
  }

  const finalAssets: GameManifestAssets = {
    textures,
    models: assets?.models ? [...assets.models] : [],
  };

  return {
    schemaVersion: CURRENT_MANIFEST_SCHEMA_VERSION,
    meta: finalMeta,
    level: primaryLevelV3,
    ...(migratedLevels && migratedLevels.length > 0
      ? { levels: migratedLevels }
      : {}),
    ...(finalCampaign ? { campaign: finalCampaign } : {}),
    assets: finalAssets,
  };
}

/**
 * Validates and migrates an untrusted or serialized object into a typed GameManifest.
 * Contains the schemaVersion migration hook for future version bumps.
 */
export function migrateGameManifest(raw: unknown): GameManifest {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Invalid manifest: root value must be an object');
  }

  const record = raw as Record<string, unknown>;

  // If raw is already a naked LevelDataV3 or LevelStateData without a manifest wrapper
  if (!('level' in record) && ('grid' in record || 'spawn' in record)) {
    return createGameManifest(raw as LevelDataV3 | LevelStateData);
  }

  const rawSchemaVersion = record.schemaVersion;
  const schemaVersion =
    typeof rawSchemaVersion === 'number' && Number.isInteger(rawSchemaVersion)
      ? rawSchemaVersion
      : 1;

  // Schema version migration hook:
  // Sequential migrations from older versions (v1 -> v2 -> v3) execute here.
  // Currently empty for v1 as v1 is the baseline.
  switch (schemaVersion) {
    case 1:
      // Current active schema version
      break;
    default:
      throw new Error(
        `Unsupported GameManifest schemaVersion: ${schemaVersion}. Highest supported is ${CURRENT_MANIFEST_SCHEMA_VERSION}.`
      );
  }

  if (!record.level || typeof record.level !== 'object') {
    throw new Error('Invalid manifest: missing or invalid "level" field');
  }

  // Load level through existing LevelSerializer migration path (V1/V2 -> V3)
  // This already validates against the dynamic allowlist in AssetRegistry.
  const { levelV3 } = RuntimeLevelSerializer.migrateToV3(
    record.level as LevelDataV3 | LevelStateData
  );

  let migratedLevels: LevelDataV3[] | undefined;
  if (Array.isArray(record.levels) && record.levels.length > 0) {
    migratedLevels = record.levels.map(
      (lvl) =>
        RuntimeLevelSerializer.migrateToV3(
          lvl as LevelDataV3 | LevelStateData
        ).levelV3
    );
  }

  let campaign: CampaignSettings | undefined;
  if (record.campaign && typeof record.campaign === 'object' && !Array.isArray(record.campaign)) {
    const rawCamp = record.campaign as Record<string, unknown>;
    campaign = {
      carryOverHealth: rawCamp.carryOverHealth !== false,
      carryOverAmmo: rawCamp.carryOverAmmo !== false,
    };
  }

  const rawMeta =
    typeof record.meta === 'object' && record.meta && !Array.isArray(record.meta)
      ? (record.meta as Record<string, unknown>)
      : {};

  const meta: GameManifestMeta = {
    title: typeof rawMeta.title === 'string' && rawMeta.title ? rawMeta.title : 'Untitled Game',
    author: typeof rawMeta.author === 'string' && rawMeta.author ? rawMeta.author : 'Creator',
    description: typeof rawMeta.description === 'string' ? rawMeta.description : '',
    createdAt:
      typeof rawMeta.createdAt === 'string' && rawMeta.createdAt
        ? rawMeta.createdAt
        : new Date().toISOString(),
    engineVersion:
      typeof rawMeta.engineVersion === 'string' && rawMeta.engineVersion
        ? rawMeta.engineVersion
        : DEFAULT_ENGINE_VERSION,
  };

  const rawAssets =
    typeof record.assets === 'object' && record.assets && !Array.isArray(record.assets)
      ? (record.assets as Record<string, unknown>)
      : {};

  const rawTextures = Array.isArray(rawAssets.textures) ? rawAssets.textures : [];
  const textures: ManifestTextureAsset[] = rawTextures
    .filter(
      (item): item is Record<string, unknown> =>
        Boolean(item) && typeof item === 'object' && !Array.isArray(item)
    )
    .map((item) => ({
      id: String(item.id ?? ''),
      path: String(item.path ?? ''),
      mimeType: String(item.mimeType ?? 'image/png'),
      ...(typeof item.license === 'string' ? { license: item.license } : {}),
      ...(typeof item.source === 'string' ? { source: item.source } : {}),
    }));

  const rawModels = Array.isArray(rawAssets.models) ? rawAssets.models : [];
  const models: ManifestModelAsset[] = rawModels
    .filter(
      (item): item is Record<string, unknown> =>
        Boolean(item) && typeof item === 'object' && !Array.isArray(item)
    )
    .map((item) => ({
      id: String(item.id ?? ''),
      path: String(item.path ?? ''),
      draco: Boolean(item.draco),
      ...(typeof item.license === 'string' ? { license: item.license } : {}),
      ...(typeof item.source === 'string' ? { source: item.source } : {}),
    }));

  return {
    schemaVersion: 1,
    meta,
    level: levelV3,
    ...(migratedLevels && migratedLevels.length > 0
      ? { levels: migratedLevels }
      : {}),
    ...(campaign ? { campaign } : {}),
    assets: {
      textures,
      models,
    },
  };
}

/**
 * Validates that an object satisfies the full GameManifest specification.
 */
export function validateGameManifest(manifest: unknown): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return { valid: false, errors: ['Manifest must be a non-null object'] };
  }

  const rec = manifest as Record<string, unknown>;

  if (rec.schemaVersion !== 1) {
    errors.push(`schemaVersion must be 1 (got ${rec.schemaVersion})`);
  }

  if (!rec.meta || typeof rec.meta !== 'object' || Array.isArray(rec.meta)) {
    errors.push('meta must be an object');
  } else {
    const meta = rec.meta as Record<string, unknown>;
    if (typeof meta.title !== 'string') errors.push('meta.title must be a string');
    if (typeof meta.author !== 'string') errors.push('meta.author must be a string');
    if (typeof meta.description !== 'string') errors.push('meta.description must be a string');
    if (typeof meta.createdAt !== 'string') errors.push('meta.createdAt must be a string');
    if (typeof meta.engineVersion !== 'string') errors.push('meta.engineVersion must be a string');
  }

  const texturesList = Array.isArray((rec.assets as any)?.textures)
    ? ((rec.assets as any).textures as ManifestTextureAsset[])
    : [];
  const modelsList = Array.isArray((rec.assets as any)?.models)
    ? ((rec.assets as any).models as ManifestModelAsset[])
    : [];

  const validateSingleLevel = (levelObj: LevelDataV3, label: string) => {
    const extraTexIds = new Set<string>([
      ...(Array.isArray(levelObj.wallTextures) ? levelObj.wallTextures.flat() : []),
      ...(Array.isArray(levelObj.floorTextures) ? levelObj.floorTextures.flat() : []),
      ...(Array.isArray(levelObj.ceilingTextures) ? levelObj.ceilingTextures.flat() : []),
      ...texturesList.map((t) => t.id),
    ]);
    const extraModelIds = new Set<string>([
      ...(Array.isArray(levelObj.entities)
        ? levelObj.entities.map((e) => (e.modelAssetId || e.blueprintId || '') as string)
        : []),
      ...modelsList.map((m) => m.id),
    ]);
    const extraSoundIds = new Set<string>();

    if (Array.isArray(levelObj.layers)) {
      for (const layer of levelObj.layers) {
        if (!layer || typeof layer !== 'object') continue;
        for (const mat of [layer.wallTextures, layer.floorTextures, layer.ceilingTextures]) {
          if (Array.isArray(mat)) {
            for (const id of mat.flat()) {
              if (typeof id === 'string' && id) extraTexIds.add(id);
            }
          }
        }
      }
    }

    const collectEventAssets = (actions: unknown) => {
      if (!Array.isArray(actions)) return;
      for (const act of actions) {
        if (!act || typeof act !== 'object') continue;
        const a = act as Record<string, unknown>;
        if (
          (a.type === 'set_wall_texture' ||
            a.type === 'set_floor_texture' ||
            a.type === 'set_ceiling_texture') &&
          typeof a.texture_id === 'string' &&
          a.texture_id
        ) {
          extraTexIds.add(a.texture_id);
        } else if (a.type === 'spawn_entity') {
          if (typeof a.blueprintId === 'string' && a.blueprintId) {
            extraModelIds.add(a.blueprintId);
          }
          if (typeof a.modelAssetId === 'string' && a.modelAssetId) {
            extraModelIds.add(a.modelAssetId);
          }
        } else if (a.type === 'play_sound' && typeof a.sound_id === 'string' && a.sound_id) {
          extraSoundIds.add(a.sound_id);
        } else if (a.type === 'if_then_else') {
          collectEventAssets(a.then_actions);
          collectEventAssets(a.else_actions);
        } else if (a.type === 'random_branch' && Array.isArray(a.branches)) {
          for (const br of a.branches) {
            if (br && typeof br === 'object') {
              collectEventAssets((br as Record<string, unknown>).actions);
            }
          }
        }
      }
    };

    if (Array.isArray(levelObj.events)) {
      for (const ev of levelObj.events) {
        if (ev && typeof ev === 'object') {
          collectEventAssets(ev.actions);
        }
      }
    }

    const allowlist = AssetRegistry.createAllowlist({
      textureIds: extraTexIds,
      modelIds: extraModelIds,
      soundIds: extraSoundIds,
    });
    const levelVal = validateLevelDataV3(levelObj, {
      allowedTextureIds: allowlist.textureIds,
      allowedModelIds: allowlist.modelIds,
      allowedSoundIds: allowlist.soundIds,
    });
    if (!levelVal.valid) {
      errors.push(
        ...levelVal.errors.map((e) => `${label}: ${e.path}: ${e.message} (${e.code})`)
      );
    }
  };

  if (!rec.level || typeof rec.level !== 'object') {
    errors.push('level must be an object');
  } else {
    validateSingleLevel(rec.level as LevelDataV3, 'level');
  }

  if (rec.levels !== undefined) {
    if (!Array.isArray(rec.levels) || rec.levels.length === 0) {
      errors.push('levels must be a non-empty array when provided');
    } else {
      rec.levels.forEach((lvl, idx) => {
        if (!lvl || typeof lvl !== 'object') {
          errors.push(`levels[${idx}] must be an object`);
        } else {
          validateSingleLevel(lvl as LevelDataV3, `levels[${idx}]`);
        }
      });
    }
  }

  if (rec.campaign !== undefined) {
    if (!rec.campaign || typeof rec.campaign !== 'object' || Array.isArray(rec.campaign)) {
      errors.push('campaign must be an object when provided');
    } else {
      const camp = rec.campaign as Record<string, unknown>;
      if (typeof camp.carryOverHealth !== 'boolean') {
        errors.push('campaign.carryOverHealth must be a boolean');
      }
      if (typeof camp.carryOverAmmo !== 'boolean') {
        errors.push('campaign.carryOverAmmo must be a boolean');
      }
    }
  }

  if (!rec.assets || typeof rec.assets !== 'object' || Array.isArray(rec.assets)) {
    errors.push('assets must be an object');
  } else {
    const assets = rec.assets as Record<string, unknown>;
    if (!Array.isArray(assets.textures)) {
      errors.push('assets.textures must be an array');
    }
    if (!Array.isArray(assets.models)) {
      errors.push('assets.models must be an array');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

