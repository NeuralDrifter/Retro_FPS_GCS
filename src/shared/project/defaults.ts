/**
 * Default content for new v4 project documents.
 *
 * createDefaultGameData() restates the engine's built-in rules (runtime/types.ts ENGINE_CONFIG and
 * ENTITY_ARCHETYPES). A unit test compares the two, so a project created with these defaults plays
 * exactly like the engine does today.
 */
import { SIM_CONFIG, SimCellType } from '../../sim';
import type { LevelDataV3 } from '../../sim';
import { PROJECT_SCHEMA_VERSION } from './schema';
import type { GameData, ProjectDocV4 } from './schema';

export function createDefaultGameData(): GameData {
  return {
    player: { maxHealth: 100, startAmmo: 32, maxAmmo: 99 },
    weapons: [
      {
        id: 'plasma-repeater',
        name: 'Plasma Repeater',
        damage: 25,
        fireCooldownMs: 200,
        ammoPerShot: 1,
        reloadAmount: 24,
      },
    ],
    enemies: [
      {
        id: 'sentinel-bot',
        name: 'Cyber Sentinel Bot',
        health: 75,
        moveSpeed: 4.8,
        attackDamage: 12,
        attackRange: 2.35,
        attackCooldownMs: 950,
        sightRange: 22,
      },
      {
        id: 'turret-guardian',
        name: 'Heavy Mech Stalker',
        health: 100,
        moveSpeed: 3.4,
        attackDamage: 18,
        attackRange: 2.35,
        attackCooldownMs: 950,
        sightRange: 22,
      },
    ],
    pickups: [{ id: 'ammo-drop', kind: 'ammo', amount: 12 }],
  };
}

/** A walled, empty square level with the player in the north-west corner facing south */
export function createBlankLevelV3(size = 16, title = 'Level 1'): LevelDataV3 {
  const clamped = Math.max(SIM_CONFIG.MIN_GRID_SIZE, Math.min(SIM_CONFIG.MAX_GRID_SIZE, Math.trunc(size)));
  const matrix = <T,>(value: (row: number, col: number) => T) =>
    Array.from({ length: clamped }, (_, r) => Array.from({ length: clamped }, (__, c) => value(r, c)));
  const isEdge = (r: number, c: number) => r === 0 || c === 0 || r === clamped - 1 || c === clamped - 1;
  return {
    formatVersion: 3,
    gridSize: clamped,
    rngSeed: 1,
    nextEntityId: 1,
    spawn: { row: 1, col: 1, yawBam: 32768 },
    minimapEnabled: true,
    skybox: { theme: 'retro-nebula', seed: 1, showCeiling: true },
    grid: matrix((r, c) => (isEdge(r, c) ? SimCellType.WALL : SimCellType.EMPTY)),
    wallTextures: matrix(() => 'default-grid'),
    floorTextures: matrix(() => 'floor-obsidian'),
    ceilingTextures: matrix(() => 'ceiling-coffer'),
    entities: [],
    regions: [],
    variables: { flags: {}, counters: {}, timers: [] },
    events: [],
    metadata: { title },
  };
}

export interface NewProjectOptions {
  /** Unique project ID (callers use crypto.randomUUID() or similar) */
  id: string;
  title?: string;
  author?: string;
  /** ISO 8601 creation time */
  now: string;
  editorVersion: string;
}

/** A new single-level, single-player project */
export function createDefaultProject(options: NewProjectOptions): ProjectDocV4 {
  const title = options.title?.trim() || 'Untitled Game';
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: options.id,
    meta: {
      title,
      author: options.author?.trim() || 'Unknown',
      description: '',
      version: '0.1.0',
      createdAt: options.now,
      updatedAt: options.now,
      editorVersion: options.editorVersion,
      contentLicense: 'all-rights-reserved',
    },
    assetLibrary: { id: 'retro-fps-gcs-assets', version: 'unpinned' },
    levels: [{ id: 'level-1', title: 'Level 1', data: createBlankLevelV3(16, 'Level 1') }],
    campaign: { carryOverHealth: true, carryOverAmmo: true },
    gameData: createDefaultGameData(),
    userAssets: [],
    export: { slug: slugify(title) },
  };
}

/** Lowercase words joined by hyphens, at most 64 characters; "game" when nothing is left */
export function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    .normalize('NFKD')
    // NFKD splits accented letters into a base letter and a combining mark; drop the marks
    .replace(/\p{M}+/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/g, '');
  return slug || 'game';
}
