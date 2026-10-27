/**
 * ============================================================================
 * GRIDFORGE 3D RUNTIME LEVEL SERIALIZER & V1/V2->V3 MIGRATOR (`/src/runtime/LevelSerializer.ts`)
 * ============================================================================
 * Runtime serialization, strict v1/v2-to-v3 migration, `nextEntityId`
 * monotonic allocation, `AssetRegistry` content-hash registration, and
 * `validateLevelDataV3` verification on load.
 */

import {
  ENGINE_CONFIG,
  EntityArchetypeId,
  GameManifest,
  GameManifestAssets,
  GameManifestMeta,
  LevelStateData,
  PlacedEntity,
  SkyboxThemeId,
  TextureAsset,
  createUniformTextureMatrix,
  resizeSquareMatrix,
} from './types';
import { createGameManifest } from './manifest';
import {
  EventDefinition,
  LevelDataV3,
  RegionDefinition,
  SIM_CONFIG,
  SimPlacedEntityV3,
  VariableRegistrySpec,
  bamToRadians,
  radiansToBam,
  validateLevelDataV3,
} from './sim';
import { AssetRegistry } from './AssetRegistry';

/**
 * Computes the next safe monotonic integer `nextEntityId` (>= 1) that is strictly
 * greater than any numeric suffix in existing entity IDs (`ent-1`, `ent-starter-4`, etc.).
 */
export function computeNextEntityId(
  entities: readonly { id: string }[],
  explicitNextId?: number
): number {
  let maxSeen = 0;
  for (const ent of entities) {
    const match = /(\d+)$/.exec(ent.id);
    if (match) {
      const parsed = Number.parseInt(match[1], 10);
      if (Number.isFinite(parsed) && parsed > maxSeen) {
        maxSeen = parsed;
      }
    }
  }
  const candidate = maxSeen + 1;
  if (
    typeof explicitNextId === 'number' &&
    Number.isInteger(explicitNextId) &&
    explicitNextId > maxSeen
  ) {
    return Math.max(1, explicitNextId);
  }
  return Math.max(1, candidate);
}

/** Copies the optional placement fields that are present, leaving absent ones absent */
function pickPlacementFields(src: {
  category?: unknown;
  collision?: unknown;
  footprintW?: unknown;
  footprintD?: unknown;
  footprintOverride?: unknown;
}): Pick<
  PlacedEntity,
  'category' | 'collision' | 'footprintW' | 'footprintD' | 'footprintOverride'
> {
  return {
    ...(src.category !== undefined
      ? { category: src.category as PlacedEntity['category'] }
      : {}),
    ...(src.collision !== undefined
      ? { collision: src.collision as PlacedEntity['collision'] }
      : {}),
    ...(typeof src.footprintW === 'number'
      ? { footprintW: Math.trunc(src.footprintW) }
      : {}),
    ...(typeof src.footprintD === 'number'
      ? { footprintD: Math.trunc(src.footprintD) }
      : {}),
    ...(typeof src.footprintOverride === 'boolean'
      ? { footprintOverride: src.footprintOverride }
      : {}),
  };
}

/**
 * Converts a validated `LevelDataV3` back into runtime `PlacedEntity[]` for 3D rendering.
 */
export function placedEntitiesFromLevelV3(levelV3: LevelDataV3): PlacedEntity[] {
  return levelV3.entities.map((e) => ({
    id: e.id,
    row: e.row,
    col: e.col,
    blueprintId: e.blueprintId,
    modelAssetId: e.modelAssetId,
    name:
      e.name ||
      (e.blueprintId === 'sentinel-bot'
        ? 'Cyber Sentinel Bot'
        : e.blueprintId === 'turret-guardian'
        ? 'Heavy Mech Stalker'
        : 'Supply Crate'),
    yaw: bamToRadians(e.yawBam ?? 0),
    scale: (e.scalePct ?? 100) / 100,
    customGlbUrl: AssetRegistry.getCustomGlbUrlForModelId(e.modelAssetId),
    isEnemy: e.isEnemy !== false && e.blueprintId !== 'supply-crate',
    maxHealth: e.maxHealth ?? 75,
    moveSpeed: Number(
      (
        ((e.moveSpeedUnitsPerTick ?? 40) *
          SIM_CONFIG.TICKS_PER_SECOND *
          ENGINE_CONFIG.CELL_SIZE) /
        SIM_CONFIG.CELL_UNITS
      ).toFixed(2)
    ),
    attackDamage: e.attackDamage ?? 12,
    tag: e.tag,
    patrol: e.patrol,
    ambush: e.ambush,
    ...pickPlacementFields(e),
  }));
}

export class RuntimeLevelSerializer {
  /**
   * Packages the current level state into a complete `LevelDataV3` object
   * (strict integer-only, zero URLs, asset IDs resolved via `AssetRegistry`).
   */
  public static serializeLevelV3(params: {
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
    exportedAt?: string;
    title?: string;
  }): LevelDataV3 {
    if (params.customTextures) {
      for (const tex of params.customTextures) {
        AssetRegistry.registerTexture(tex);
      }
    }

    const gridSize = params.grid.length;
    const maxIdx = gridSize - 1;

    const v3Entities: SimPlacedEntityV3[] = params.entities.map((ent) => {
      let modelAssetId = ent.modelAssetId;
      if (!modelAssetId && ent.customGlbUrl) {
        modelAssetId = AssetRegistry.registerCustomGlbUrl(
          ent.customGlbUrl,
          ent.name,
          ent.isEnemy !== false
        );
      }

      const speedMetersPerSec =
        ent.moveSpeed ?? (ent.isEnemy !== false ? 4.5 : 0);
      const speedUnitsPerTick = Math.max(
        0,
        Math.round(
          (speedMetersPerSec / ENGINE_CONFIG.CELL_SIZE) *
            (SIM_CONFIG.CELL_UNITS / SIM_CONFIG.TICKS_PER_SECOND)
        )
      );

      return {
        id: ent.id,
        row: Math.max(0, Math.min(maxIdx, Math.trunc(ent.row))),
        col: Math.max(0, Math.min(maxIdx, Math.trunc(ent.col))),
        blueprintId: ent.blueprintId,
        ...(modelAssetId ? { modelAssetId } : {}),
        name: ent.name,
        yawBam: radiansToBam(ent.yaw || 0),
        scalePct: Math.max(
          1,
          Math.min(500, Math.round((ent.scale || 1) * 100))
        ),
        isEnemy: ent.isEnemy !== false,
        maxHealth: Math.max(1, Math.trunc(ent.maxHealth ?? 75)),
        moveSpeedUnitsPerTick: speedUnitsPerTick,
        attackDamage: Math.max(0, Math.trunc(ent.attackDamage ?? 12)),
        ...(ent.tag !== undefined ? { tag: Math.trunc(ent.tag) } : {}),
        ...(ent.patrol !== undefined ? { patrol: Boolean(ent.patrol) } : {}),
        ...(ent.ambush !== undefined ? { ambush: Boolean(ent.ambush) } : {}),
        ...pickPlacementFields(ent),
      };
    });

    const nextEntityId = computeNextEntityId(v3Entities, params.nextEntityId);

    return {
      formatVersion: 3,
      gridSize,
      rngSeed:
        (Math.trunc(params.rngSeed ?? params.skyboxSeed ?? 1) >>> 0) || 1,
      nextEntityId,
      spawn: {
        row: Math.max(0, Math.min(maxIdx, Math.trunc(params.spawn.row))),
        col: Math.max(0, Math.min(maxIdx, Math.trunc(params.spawn.col))),
        yawBam: radiansToBam(params.spawn.yaw || 0),
      },
      minimapEnabled: Boolean(params.minimapEnabled),
      skybox: {
        theme: params.skyboxTheme,
        seed: Math.trunc(params.skyboxSeed) || 1,
        showCeiling: Boolean(params.showCeiling),
      },
      grid: params.grid.map((row) => row.map((c) => Math.trunc(c))),
      wallTextures: params.wallTextures.map((row) => [...row]),
      floorTextures: params.floorTextures.map((row) => [...row]),
      ceilingTextures: params.ceilingTextures.map((row) => [...row]),
      ...(params.cellTags
        ? {
            cellTags: resizeSquareMatrix(params.cellTags, gridSize, 0).map(
              (row) => row.map((t) => Math.trunc(t))
            ),
          }
        : {}),
      ...(params.floorHeights
        ? {
            floorHeights: resizeSquareMatrix(
              params.floorHeights,
              gridSize,
              0
            ).map((row) => row.map((h) => Math.trunc(h))),
          }
        : {}),
      ...(params.ceilingHeights
        ? {
            ceilingHeights: resizeSquareMatrix(
              params.ceilingHeights,
              gridSize,
              SIM_CONFIG.DEFAULT_CEILING_HEIGHT_UNITS
            ).map((row) => row.map((h) => Math.trunc(h))),
          }
        : {}),
      entities: v3Entities,
      regions: params.regions ? params.regions.map((r) => ({ ...r })) : [],
      variables: params.variables
        ? {
            flags: { ...params.variables.flags },
            counters: { ...params.variables.counters },
            timers: params.variables.timers ? [...params.variables.timers] : [],
          }
        : { flags: {}, counters: {}, timers: [] },
      events: params.events ? params.events.map((e) => ({ ...e })) : [],
      ...(params.exportedAt || params.title
        ? {
            metadata: {
              ...(params.title ? { title: params.title } : {}),
              ...(params.exportedAt ? { exportedAt: params.exportedAt } : {}),
            },
          }
        : {}),
    };
  }

  /**
   * Strict Migrator: Upgrades untrusted v1 (square grid array) or v2 (`version: "2.0"`)
   * or validates v3 (`formatVersion: 3`) into a validated `LevelDataV3`.
   */
  public static migrateToV3(
    parsed: unknown,
    rawJsonString?: string
  ): { levelV3: LevelDataV3; customTextures: TextureAsset[] } {
    // Case A: Already a pure LevelDataV3 document (not a v2 LevelStateData wrapper)
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed) &&
      (parsed as Record<string, unknown>).formatVersion === 3 &&
      !('version' in (parsed as Record<string, unknown>))
    ) {
      const candidate = parsed as LevelDataV3;
      const extraTexIds = new Set<string>();
      const extraModelIds = new Set<string>();
      const extraSoundIds = new Set<string>();
      for (const mat of [
        candidate.wallTextures,
        candidate.floorTextures,
        candidate.ceilingTextures,
      ]) {
        if (Array.isArray(mat)) {
          for (const row of mat) {
            if (Array.isArray(row)) {
              for (const tid of row) {
                if (typeof tid === 'string' && tid.trim().length > 0) {
                  extraTexIds.add(tid);
                }
              }
            }
          }
        }
      }
      if (Array.isArray(candidate.entities)) {
        for (const ent of candidate.entities) {
          if (ent && typeof ent === 'object') {
            if (typeof ent.blueprintId === 'string' && ent.blueprintId.trim().length > 0) {
              extraModelIds.add(ent.blueprintId);
            }
            if (typeof ent.modelAssetId === 'string' && ent.modelAssetId.trim().length > 0) {
              extraModelIds.add(ent.modelAssetId);
            }
          }
        }
      }
      const collectActionAssets = (actions: unknown) => {
        if (!Array.isArray(actions)) return;
        for (const act of actions) {
          if (!act || typeof act !== 'object') continue;
          const a = act as Record<string, unknown>;
          if (
            (a.type === 'set_wall_texture' ||
              a.type === 'set_floor_texture' ||
              a.type === 'set_ceiling_texture') &&
            typeof a.texture_id === 'string' &&
            a.texture_id.trim().length > 0
          ) {
            extraTexIds.add(a.texture_id);
          } else if (a.type === 'spawn_entity') {
            if (typeof a.blueprintId === 'string' && a.blueprintId.trim().length > 0) {
              extraModelIds.add(a.blueprintId);
            }
            if (typeof a.modelAssetId === 'string' && a.modelAssetId.trim().length > 0) {
              extraModelIds.add(a.modelAssetId);
            }
          } else if (
            a.type === 'play_sound' &&
            typeof a.sound_id === 'string' &&
            a.sound_id.trim().length > 0
          ) {
            extraSoundIds.add(a.sound_id);
          } else if (a.type === 'if_then_else') {
            collectActionAssets(a.then_actions);
            collectActionAssets(a.else_actions);
          } else if (a.type === 'random_branch' && Array.isArray(a.branches)) {
            for (const br of a.branches) {
              if (br && typeof br === 'object') {
                collectActionAssets((br as Record<string, unknown>).actions);
              }
            }
          }
        }
      };
      if (Array.isArray(candidate.events)) {
        for (const ev of candidate.events) {
          if (ev && typeof ev === 'object') {
            collectActionAssets(ev.actions);
          }
        }
      }
      const allowlist = AssetRegistry.createAllowlist({
        textureIds: extraTexIds,
        modelIds: extraModelIds,
        soundIds: extraSoundIds,
      });
      const validation = validateLevelDataV3(
        parsed,
        {
          allowedTextureIds: allowlist.textureIds,
          allowedModelIds: allowlist.modelIds,
          allowedSoundIds: allowlist.soundIds,
        },
        rawJsonString
      );
      if (!validation.valid) {
        throw new Error(
          `Invalid LevelDataV3: ${validation.errors
            .map((e) => `${e.path} (${e.code}): ${e.message}`)
            .join('; ')}`
        );
      }
      return {
        levelV3: parsed as LevelDataV3,
        customTextures: [],
      };
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
              cell <= 3
          )
      )
    ) {
      throw new Error(
        `Invalid level JSON: 'grid' must be a square 2D integer array (values 0..3) from ${ENGINE_CONFIG.MIN_GRID_SIZE}x${ENGINE_CONFIG.MIN_GRID_SIZE} to ${ENGINE_CONFIG.MAX_GRID_SIZE}x${ENGINE_CONFIG.MAX_GRID_SIZE}.`
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
  }): GameManifest {
    const levelV3 = this.serializeLevelV3(params);
    return createGameManifest(levelV3, params.meta, params.assets);
  }

  /**
   * Parses, migrates to v3, and validates an uploaded JSON string into a normalized
   * `LevelStateData` structure.
   */
  public static parseLevelJson(rawJson: string): LevelStateData {
    const parsed = JSON.parse(rawJson);
    const { levelV3, customTextures } = this.migrateToV3(parsed, rawJson);

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

    return {
      engine: 'GridForge 3D Game Creation System',
      version: '2.0',
      formatVersion: 3,
      timestamp: levelV3.metadata?.exportedAt || new Date().toISOString(),
      gridSize: levelV3.gridSize,
      nextEntityId: levelV3.nextEntityId,
      rngSeed: levelV3.rngSeed,
      spawn: {
        row: levelV3.spawn.row,
        col: levelV3.spawn.col,
        yaw:
          parsed &&
          typeof parsed === 'object' &&
          !Array.isArray(parsed) &&
          typeof parsed.spawn?.yaw === 'number'
            ? parsed.spawn.yaw
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
    };
  }
}
