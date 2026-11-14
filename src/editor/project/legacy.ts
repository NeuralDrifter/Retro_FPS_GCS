/**
 * Older editor save formats: v1 (a bare grid array) and v2 (`version: "2.0"` LevelStateData),
 * plus the editor's save-file serializer. The game runtime only accepts LevelDataV3 inside a
 * GameManifest; the editor converts with these before playtest and export.
 *
 * Moved out of src/runtime/LevelSerializer.ts in P1.3. It stays in the editor rather than
 * src/shared because the migration registers textures and models in the runtime's AssetRegistry.
 */
/**
 * ============================================================================
 * GRIDFORGE 3D RUNTIME LEVEL SERIALIZER & V1/V2->V3 MIGRATOR (`/src/runtime/LevelSerializer.ts`)
 * ============================================================================
 * Runtime serialization, strict v1/v2-to-v3 migration, `nextEntityId`
 * monotonic allocation, `AssetRegistry` content-hash registration, and
 * `validateLevelDataV3` verification on load.
 */

import {
  CampaignSettings,
  ENGINE_CONFIG,
  EntityArchetypeId,
  GameManifest,
  GameManifestAssets,
  GameManifestMeta,
  LevelStateData,
  PlacedEntity,
  CellType,
  SkyboxThemeId,
  TextureAsset,
  VerticalLevelData,
  createUniformTextureMatrix,
} from '../../runtime';
import { buildGameManifest, createGameManifest } from '../../runtime';
import {
  pickEditorVerticalPlacement,
  readEditorVerticalData,
  verticalFromLevelV3,
} from '../../runtime';
import {
  EventDefinition,
  LevelDataV3,
  RegionDefinition,
  VariableRegistrySpec,
  bamToRadians,
  validateLevelDataV3,
} from '../../sim';
import { AssetRegistry } from '../../runtime';

/**
 * Computes the next safe monotonic integer `nextEntityId` (>= 1) that is strictly
 * greater than any numeric suffix in existing entity IDs (`ent-1`, `ent-starter-4`, etc.).
 */
import {
  RuntimeLevelSerializer,
  computeNextEntityId,
  pickPlacementFields,
  placedEntitiesFromLevelV3,
} from '../../runtime';

export class LegacyLevelSerializer extends RuntimeLevelSerializer {
  /**
   * Strict Migrator: Upgrades untrusted v1 (square grid array) or v2 (`version: "2.0"`)
   * or validates v3 (`formatVersion: 3`) into a validated `LevelDataV3`.
   */
  public static migrateToV3(
    parsed: unknown,
    rawJsonString?: string
  ): { levelV3: LevelDataV3; customTextures: TextureAsset[] } {
    if (RuntimeLevelSerializer.isLevelDataV3(parsed)) {
      return { levelV3: this.validateLevelV3(parsed, rawJsonString), customTextures: [] };
    }

    // Case B: Legacy v1 array or v2 object
    const obj = (
      Array.isArray(parsed) ? { grid: parsed } : parsed
    ) as Record<string, unknown> | null;

    const rawGrid = obj?.grid;
    const gridSize = Array.isArray(rawGrid) ? rawGrid.length : 0;
    if (
      !Array.isArray(rawGrid) ||
      gridSize < ENGINE_CONFIG.MIN_GRID_SIZE ||
      gridSize > ENGINE_CONFIG.MAX_GRID_SIZE ||
      !rawGrid.every(
        (r: unknown) =>
          Array.isArray(r) &&
          r.length === gridSize &&
          r.every(
            (cell) =>
              typeof cell === 'number' &&
              Number.isInteger(cell) &&
              cell >= 0 &&
              cell <= CellType.HOLE
          )
      )
    ) {
      throw new Error(
        `Invalid level JSON: 'grid' must be a square 2D integer array (values 0..4) from ${ENGINE_CONFIG.MIN_GRID_SIZE}x${ENGINE_CONFIG.MIN_GRID_SIZE} to ${ENGINE_CONFIG.MAX_GRID_SIZE}x${ENGINE_CONFIG.MAX_GRID_SIZE}.`
      );
    }

    const isValidStringMatrix = (m: unknown): m is string[][] =>
      Array.isArray(m) &&
      m.length === gridSize &&
      m.every(
        (r: unknown) =>
          Array.isArray(r) &&
          r.length === gridSize &&
          r.every((tid) => typeof tid === 'string' && tid.length > 0)
      );

    const wallTextures = isValidStringMatrix(obj?.wallTextures)
      ? obj.wallTextures.map((r) => [...r])
      : createUniformTextureMatrix('default-grid', gridSize);

    const floorTextures = isValidStringMatrix(obj?.floorTextures)
      ? obj.floorTextures.map((r) => [...r])
      : createUniformTextureMatrix('floor-obsidian', gridSize);

    const ceilingTextures = isValidStringMatrix(obj?.ceilingTextures)
      ? obj.ceilingTextures.map((r) => [...r])
      : createUniformTextureMatrix('ceiling-coffer', gridSize);

    const idRemap = new Map<string, string>();
    const customTextures: TextureAsset[] = [];
    if (Array.isArray(obj?.customTextures)) {
      for (const rawTex of obj.customTextures) {
        if (
          rawTex &&
          typeof rawTex === 'object' &&
          typeof (rawTex as TextureAsset).id === 'string' &&
          typeof (rawTex as TextureAsset).previewUrl === 'string'
        ) {
          const texAsset = rawTex as TextureAsset;
          const registered = AssetRegistry.registerTexture(texAsset);
          idRemap.set(texAsset.id, registered.id);
          customTextures.push(registered);
        }
      }
    }

    const referencedTexIds = new Set<string>();
    const remapMatrix = (mat: string[][]) => {
      for (let r = 0; r < gridSize; r++) {
        for (let c = 0; c < gridSize; c++) {
          const orig = mat[r][c];
          const mapped = idRemap.get(orig) || orig;
          mat[r][c] = mapped;
          referencedTexIds.add(mapped);
        }
      }
    };
    remapMatrix(wallTextures);
    remapMatrix(floorTextures);
    remapMatrix(ceilingTextures);

    // Stacked layers of an editor save use the same texture ids
    const editorVertical = readEditorVerticalData(obj?.vertical, gridSize);
    for (const layer of editorVertical?.layers ?? []) {
      for (const mat of [layer.wallTextures, layer.floorTextures, layer.ceilingTextures]) {
        if (isValidStringMatrix(mat)) remapMatrix(mat);
      }
    }

    const rawEntities = Array.isArray(obj?.entities) ? obj.entities : [];
    const migratedEntities: PlacedEntity[] = rawEntities.map(
      (rawEnt: unknown, idx: number) => {
        const e = (rawEnt || {}) as Partial<PlacedEntity>;
        return {
          id:
            typeof e.id === 'string' && /^[a-z0-9_-]+$/i.test(e.id)
              ? e.id
              : `ent-${idx + 1}`,
          row:
            typeof e.row === 'number'
              ? Math.max(0, Math.min(gridSize - 1, Math.trunc(e.row)))
              : 1,
          col:
            typeof e.col === 'number'
              ? Math.max(0, Math.min(gridSize - 1, Math.trunc(e.col)))
              : 1,
          blueprintId: (e.blueprintId as EntityArchetypeId) || 'sentinel-bot',
          modelAssetId: e.modelAssetId,
          name: typeof e.name === 'string' ? e.name : 'Entity',
          yaw: typeof e.yaw === 'number' && Number.isFinite(e.yaw) ? e.yaw : 0,
          scale:
            typeof e.scale === 'number' && Number.isFinite(e.scale)
              ? e.scale
              : 1,
          customGlbUrl:
            typeof e.customGlbUrl === 'string' ? e.customGlbUrl : undefined,
          isEnemy: e.isEnemy !== false,
          maxHealth: typeof e.maxHealth === 'number' ? e.maxHealth : 75,
          moveSpeed: typeof e.moveSpeed === 'number' ? e.moveSpeed : 4.5,
          attackDamage:
            typeof e.attackDamage === 'number' ? e.attackDamage : 12,
          ...(typeof e.tag === 'number' ? { tag: Math.trunc(e.tag) } : {}),
          ...(typeof e.patrol === 'boolean' ? { patrol: e.patrol } : {}),
          ...(typeof e.ambush === 'boolean' ? { ambush: e.ambush } : {}),
          ...pickPlacementFields(e),
          ...pickEditorVerticalPlacement(e),
        };
      }
    );

    const rawSpawn = obj?.spawn as
      | { row?: unknown; col?: unknown; yaw?: unknown }
      | undefined;
    const spawn =
      rawSpawn &&
      typeof rawSpawn.row === 'number' &&
      typeof rawSpawn.col === 'number'
        ? {
            row: Math.max(0, Math.min(gridSize - 1, Math.trunc(rawSpawn.row))),
            col: Math.max(0, Math.min(gridSize - 1, Math.trunc(rawSpawn.col))),
            yaw: Number(rawSpawn.yaw) || 0,
          }
        : { row: 1, col: 1, yaw: Math.PI };

    const rawSkybox = obj?.skybox as
      | { theme?: unknown; seed?: unknown; showCeiling?: unknown }
      | undefined;
    const skyboxTheme =
      (rawSkybox?.theme as SkyboxThemeId) || 'retro-nebula';
    const skyboxSeed = Math.trunc(Number(rawSkybox?.seed) || 1);
    const showCeiling = Boolean(rawSkybox?.showCeiling);
    const minimapEnabled =
      typeof obj?.minimapEnabled === 'boolean' ? obj.minimapEnabled : true;
    const nextEntityId = computeNextEntityId(
      migratedEntities,
      typeof obj?.nextEntityId === 'number' ? obj.nextEntityId : undefined
    );

    const levelV3 = this.serializeLevelV3({
      grid: rawGrid as number[][],
      wallTextures,
      floorTextures,
      ceilingTextures,
      customTextures,
      entities: migratedEntities,
      nextEntityId,
      spawn,
      skyboxTheme,
      skyboxSeed,
      showCeiling,
      minimapEnabled,
      events: Array.isArray(obj?.events)
        ? (obj.events as EventDefinition[])
        : undefined,
      regions: Array.isArray(obj?.regions)
        ? (obj.regions as RegionDefinition[])
        : undefined,
      variables:
        obj?.variables && typeof obj.variables === 'object'
          ? (obj.variables as VariableRegistrySpec)
          : undefined,
      exportedAt:
        typeof obj?.timestamp === 'string' ? obj.timestamp : undefined,
      title:
        typeof obj?.title === 'string' && obj.title.trim().length > 0
          ? obj.title.trim()
          : typeof (obj?.metadata as Record<string, unknown> | undefined)?.title ===
              'string'
          ? String((obj?.metadata as Record<string, unknown> | undefined)?.title)
          : undefined,
      vertical: editorVertical,
    });

    const allowlist = AssetRegistry.createAllowlist({
      textureIds: referencedTexIds,
    });
    const validation = validateLevelDataV3(
      levelV3,
      {
        allowedTextureIds: allowlist.textureIds,
        allowedModelIds: allowlist.modelIds,
        allowedSoundIds: allowlist.soundIds,
      },
      rawJsonString
    );
    if (!validation.valid) {
      throw new Error(
        `Migrated level failed v3 validation: ${validation.errors
          .map((e) => `${e.path} (${e.code}): ${e.message}`)
          .join('; ')}`
      );
    }

    return { levelV3, customTextures };
  }

  /**
   * Packages the current state into a `LevelStateData` object.
   */
  public static serializeLevel(params: {
    title?: string;
    grid: number[][];
    wallTextures: string[][];
    floorTextures: string[][];
    ceilingTextures: string[][];
    customTextures: TextureAsset[];
    entities: PlacedEntity[];
    nextEntityId?: number;
    spawn: { row: number; col: number; yaw: number };
    skyboxTheme: SkyboxThemeId;
    skyboxSeed: number;
    showCeiling: boolean;
    minimapEnabled: boolean;
    events?: EventDefinition[];
    regions?: RegionDefinition[];
    variables?: VariableRegistrySpec;
    vertical?: VerticalLevelData;
    levels?: LevelStateData[];
    activeLevelIndex?: number;
    campaign?: CampaignSettings;
  }): LevelStateData {
    const nextEntityId = computeNextEntityId(
      params.entities,
      params.nextEntityId
    );
    return {
      engine: 'GridForge 3D Game Creation System',
      version: '2.0',
      formatVersion: 3,
      timestamp: new Date().toISOString(),
      ...(params.title ? { title: params.title } : {}),
      gridSize: params.grid.length,
      nextEntityId,
      spawn: { ...params.spawn },
      minimapEnabled: params.minimapEnabled,
      skybox: {
        theme: params.skyboxTheme,
        seed: params.skyboxSeed,
        showCeiling: params.showCeiling,
      },
      grid: params.grid.map((row) => [...row]),
      wallTextures: params.wallTextures.map((row) => [...row]),
      floorTextures: params.floorTextures.map((row) => [...row]),
      ceilingTextures: params.ceilingTextures.map((row) => [...row]),
      customTextures: [...params.customTextures],
      entities: params.entities.map((ent) => ({ ...ent })),
      ...(params.events ? { events: params.events.map((e) => ({ ...e })) } : {}),
      ...(params.regions
        ? { regions: params.regions.map((r) => ({ ...r })) }
        : {}),
      ...(params.variables ? { variables: { ...params.variables } } : {}),
      ...(params.vertical ? { vertical: params.vertical } : {}),
      ...(params.levels && params.levels.length > 0
        ? { levels: params.levels }
        : {}),
      ...(typeof params.activeLevelIndex === 'number'
        ? { activeLevelIndex: params.activeLevelIndex }
        : {}),
      ...(params.campaign ? { campaign: { ...params.campaign } } : {}),
    };
  }

  /**
   * Packages the current level state directly into a GameManifest wrapping LevelDataV3.
   */
  public static serializeGameManifest(params: {
    grid: number[][];
    wallTextures: string[][];
    floorTextures: string[][];
    ceilingTextures: string[][];
    customTextures?: TextureAsset[];
    entities: PlacedEntity[];
    nextEntityId?: number;
    rngSeed?: number;
    spawn: { row: number; col: number; yaw: number };
    skyboxTheme: SkyboxThemeId;
    skyboxSeed: number;
    showCeiling: boolean;
    minimapEnabled: boolean;
    cellTags?: number[][];
    floorHeights?: number[][];
    ceilingHeights?: number[][];
    events?: EventDefinition[];
    regions?: RegionDefinition[];
    variables?: VariableRegistrySpec;
    meta?: Partial<GameManifestMeta>;
    assets?: Partial<GameManifestAssets>;
    vertical?: VerticalLevelData;
  }): GameManifest {
    const levelV3 = this.serializeLevelV3(params);
    return createGameManifest(levelV3, params.meta, params.assets);
  }

  private static parseSingleLevelObject(
    parsedObj: unknown,
    rawJsonString?: string
  ): LevelStateData {
    const { levelV3, customTextures } = this.migrateToV3(
      parsedObj,
      rawJsonString
    );

    const knownModels = AssetRegistry.createAllowlist().modelIds;
    const missingNames = new Map<string, string[]>();
    for (const e of levelV3.entities) {
      if (!e.modelAssetId || knownModels.has(e.modelAssetId)) continue;
      const names = missingNames.get(e.modelAssetId) ?? [];
      names.push(e.name || e.id);
      missingNames.set(e.modelAssetId, names);
    }
    const missingModelWarnings = [...missingNames].map(
      ([id, names]) =>
        `Model '${id}' used by ${names.map((n) => `'${n}'`).join(', ')} is not in this library; ` +
        `those copies show a stand-in until you add the model back.`
    );

    const entities = placedEntitiesFromLevelV3(levelV3);
    const vertical = verticalFromLevelV3(levelV3);
    const rawTitle =
      levelV3.metadata?.title ||
      (parsedObj &&
      typeof parsedObj === 'object' &&
      !Array.isArray(parsedObj) &&
      typeof (parsedObj as Record<string, unknown>).title === 'string'
        ? String((parsedObj as Record<string, unknown>).title)
        : undefined);

    return {
      engine: 'GridForge 3D Game Creation System',
      version: '2.0',
      formatVersion: 3,
      timestamp: levelV3.metadata?.exportedAt || new Date().toISOString(),
      ...(rawTitle ? { title: rawTitle } : {}),
      gridSize: levelV3.gridSize,
      nextEntityId: levelV3.nextEntityId,
      rngSeed: levelV3.rngSeed,
      spawn: {
        row: levelV3.spawn.row,
        col: levelV3.spawn.col,
        yaw:
          parsedObj &&
          typeof parsedObj === 'object' &&
          !Array.isArray(parsedObj) &&
          typeof (parsedObj as any).spawn?.yaw === 'number'
            ? (parsedObj as any).spawn.yaw
            : bamToRadians(levelV3.spawn.yawBam),
      },
      minimapEnabled: levelV3.minimapEnabled,
      skybox: {
        theme: levelV3.skybox.theme,
        seed: levelV3.skybox.seed,
        showCeiling: levelV3.skybox.showCeiling,
      },
      grid: levelV3.grid.map((r) => [...r]),
      wallTextures: levelV3.wallTextures.map((r) => [...r]),
      floorTextures: levelV3.floorTextures.map((r) => [...r]),
      ceilingTextures: levelV3.ceilingTextures.map((r) => [...r]),
      customTextures,
      ...(missingModelWarnings.length > 0 ? { missingModelWarnings } : {}),
      entities,
      events: levelV3.events,
      regions: levelV3.regions,
      variables: levelV3.variables,
      ...(vertical ? { vertical } : {}),
    };
  }

  /**
   * Parses, migrates to v3, and validates an uploaded JSON string into a normalized
   * `LevelStateData` structure (including multi-level campaign data if present).
   */
  public static parseLevelJson(rawJson: string): LevelStateData {
    const parsed = JSON.parse(rawJson);
    const rootState = this.parseSingleLevelObject(parsed, rawJson);

    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const rec = parsed as Record<string, unknown>;
      if (Array.isArray(rec.levels) && rec.levels.length > 0) {
        const parsedLevels = rec.levels.map((lvl, idx) => {
          const single = this.parseSingleLevelObject(lvl);
          if (!single.title) {
            single.title = `Level ${idx + 1}`;
          }
          return single;
        });
        rootState.levels = parsedLevels;
        if (typeof rec.activeLevelIndex === 'number') {
          rootState.activeLevelIndex = Math.max(
            0,
            Math.min(parsedLevels.length - 1, Math.trunc(rec.activeLevelIndex))
          );
        }
      }
      if (rec.campaign && typeof rec.campaign === 'object') {
        const camp = rec.campaign as Record<string, unknown>;
        rootState.campaign = {
          carryOverHealth: camp.carryOverHealth !== false,
          carryOverAmmo: camp.carryOverAmmo !== false,
          ...(camp.menus && typeof camp.menus === 'object' && !Array.isArray(camp.menus)
            ? { menus: camp.menus as CampaignSettings['menus'] }
            : {}),
        };
      }
    }

    return rootState;
  }
}

/**
 * Builds a GameManifest from editor save data (LevelStateData, v1 or v2) or LevelDataV3,
 * migrating each level to LevelDataV3 first. This is the editor's path into playtest and export.
 */
export function createGameManifestFromEditor(
  levelInput: LevelDataV3 | LevelStateData,
  meta?: Partial<GameManifestMeta>,
  assets?: Partial<GameManifestAssets>,
  campaignOptions?: { levels?: (LevelDataV3 | LevelStateData)[]; campaign?: CampaignSettings }
): GameManifest {
  return buildGameManifest(levelInput, meta, assets, campaignOptions, (level) =>
    LegacyLevelSerializer.migrateToV3(level)
  );
}
