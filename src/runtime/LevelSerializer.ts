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
  PlacedEntity,
  SkyboxThemeId,
  TextureAsset,
  VerticalLevelData,
  resizeSquareMatrix,
} from './types';
import {
  verticalPlacementFromV3,
  verticalPlacementToV3,
  verticalToLevelV3Fields,
} from './verticalLevelData';
import {
  EventDefinition,
  LevelDataV3,
  RegionDefinition,
  SIM_CONFIG,
  SimPlacedEntityV3,
  VariableRegistrySpec,
  bamToRadians,
  isVerticalLevel,
  radiansToBam,
  validateLevelDataV3,
} from '../sim';
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
export function pickPlacementFields(src: {
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
    ...verticalPlacementFromV3(e),
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
    vertical?: VerticalLevelData;
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
        ...verticalPlacementToV3(ent),
      };
    });

    const nextEntityId = computeNextEntityId(v3Entities, params.nextEntityId);

    const level: LevelDataV3 = {
      formatVersion: 3,
      gridSize,
      rngSeed:
        (Math.trunc(params.rngSeed ?? params.skyboxSeed ?? 1) >>> 0) || 1,
      nextEntityId,
      spawn: {
        row: Math.max(0, Math.min(maxIdx, Math.trunc(params.spawn.row))),
        col: Math.max(0, Math.min(maxIdx, Math.trunc(params.spawn.col))),
        yawBam: radiansToBam(params.spawn.yaw || 0),
        ...(params.vertical && params.vertical.spawnLayer > 0
          ? { layer: Math.trunc(params.vertical.spawnLayer) }
          : {}),
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
      // Vertical data overrides the explicit height matrices above when both are given
      ...verticalToLevelV3Fields(params.vertical, gridSize),
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
    // Measured model heights only matter on vertical levels; flat levels save as before
    if (!isVerticalLevel(level)) {
      for (const e of level.entities) {
        delete e.modelBottomUnits;
        delete e.modelTopUnits;
      }
    }
    return level;
  }

  /** True when `parsed` is a bare LevelDataV3 document (`formatVersion: 3`, no v2 `version` field). */
  public static isLevelDataV3(parsed: unknown): parsed is LevelDataV3 {
    return (
      parsed !== null &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed) &&
      (parsed as Record<string, unknown>).formatVersion === 3 &&
      !('version' in (parsed as Record<string, unknown>))
    );
  }

  /**
   * Validates an untrusted LevelDataV3 document and returns it typed.
   * Older editor formats (v1, v2) are converted by the editor before they reach the runtime
   * (src/editor/project/legacy.ts).
   */
  public static validateLevelV3(parsed: unknown, rawJsonString?: string): LevelDataV3 {
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
      const layerMatrices = Array.isArray(candidate.layers)
        ? candidate.layers.flatMap((layer) =>
            layer && typeof layer === 'object'
              ? [layer.wallTextures, layer.floorTextures, layer.ceilingTextures]
              : []
          )
        : [];
      for (const mat of [
        candidate.wallTextures,
        candidate.floorTextures,
        candidate.ceilingTextures,
        ...layerMatrices,
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
      let targetV3: unknown = parsed;
      if (
        !rawJsonString &&
        parsed &&
        typeof parsed === 'object' &&
        ('levels' in (parsed as Record<string, unknown>) ||
          'campaign' in (parsed as Record<string, unknown>) ||
          'activeLevelIndex' in (parsed as Record<string, unknown>))
      ) {
        const {
          levels: _l,
          campaign: _c,
          activeLevelIndex: _a,
          ...rest
        } = parsed as Record<string, unknown>;
        targetV3 = rest;
      }
      const validation = validateLevelDataV3(
        targetV3,
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
      return targetV3 as LevelDataV3;
    }

    throw new Error('Invalid LevelDataV3: expected a level document with formatVersion 3');
  }
}
