/**
 * Project document, schema version 4 (release plan P2.1, decision D5).
 *
 * One JSON document holds a whole game: metadata, every level, campaign settings, the game's
 * tunable data, user-supplied assets and export and multiplayer settings. The editor keeps it
 * in memory and in IndexedDB; "Download project" writes it as canonical JSON (canonical.ts).
 * validate.ts checks untrusted documents against these types; defaults.ts builds new ones.
 *
 * No DOM, no Node and no Three.js: the editor, export, server and tests all load it.
 */
import type { LevelDataV3 } from '../../sim';

export const PROJECT_SCHEMA_VERSION = 4;

/** Upper bounds the validator enforces, so a hostile file cannot exhaust memory or time */
export const PROJECT_LIMITS = {
  MAX_LEVELS: 64,
  MAX_USER_ASSETS: 512,
  /** Bytes per user asset (P2.6) */
  MAX_ASSET_BYTES: 16 * 1024 * 1024,
  /** Characters of base64 for one embedded asset: 4/3 of MAX_ASSET_BYTES, rounded up */
  MAX_ASSET_BASE64_CHARS: Math.ceil((16 * 1024 * 1024) / 3) * 4,
  MAX_TITLE_CHARS: 120,
  MAX_DESCRIPTION_CHARS: 4000,
  MAX_SHORT_TEXT_CHARS: 200,
  MAX_ATTRIBUTION_CHARS: 1000,
  MAX_GAME_DATA_ENTRIES: 64,
  MAX_ALLOWED_ORIGINS: 16,
  MAX_MENU_JSON_CHARS: 512 * 1024,
  /** Object and array nesting deeper than this is rejected before any other check */
  MAX_DEPTH: 64,
} as const;

/** Project and level IDs: lowercase letters, digits, - and _ */
export const PROJECT_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{2,63}$/;
/** Export slug: lowercase words joined by single hyphens */
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const SHA256_PATTERN = /^[0-9a-f]{64}$/;

export interface ProjectDocV4 {
  schemaVersion: 4;
  /** Stable project ID, never shown to players */
  id: string;
  meta: ProjectMeta;
  /** The asset library the project's library IDs refer to (pinned in P2.7) */
  assetLibrary: { id: string; version: string };
  /** At least one level; campaign order is array order */
  levels: ProjectLevel[];
  campaign: ProjectCampaign;
  gameData: GameData;
  /** Textures and models the creator uploaded */
  userAssets: UserAsset[];
  export: { slug: string };
  /** Present and `enabled: true` only for multiplayer games (section 3.5) */
  multiplayer?: MultiplayerSettings;
}

export interface ProjectMeta {
  title: string;
  author: string;
  description: string;
  /** The game's own version, shown in exports, e.g. "1.0.0" */
  version: string;
  /** ISO 8601 timestamps */
  createdAt: string;
  updatedAt: string;
  /** Version of the editor that last saved the document */
  editorVersion: string;
  /** License of the creator's content, e.g. "CC-BY-4.0", or "all-rights-reserved" */
  contentLicense: string;
}

export interface ProjectLevel {
  id: string;
  title: string;
  /** The level itself; cell tags travel in `data.cellTags` */
  data: LevelDataV3;
}

export interface ProjectCampaign {
  carryOverHealth: boolean;
  carryOverAmmo: boolean;
  /** Menu Studio pack. Checked structurally here; its full schema arrives with the game shell (P5.1) */
  menus?: Record<string, unknown>;
}

/** Tunable game rules. The defaults (defaults.ts) reproduce the engine's built-in behavior. */
export interface GameData {
  player: PlayerData;
  weapons: WeaponData[];
  enemies: EnemyData[];
  pickups: PickupData[];
}

export interface PlayerData {
  maxHealth: number;
  startAmmo: number;
  maxAmmo: number;
}

export interface WeaponData {
  id: string;
  name: string;
  /** Health removed per hit */
  damage: number;
  /** Milliseconds between shots */
  fireCooldownMs: number;
  ammoPerShot: number;
  /** Ammo added by one reload */
  reloadAmount: number;
}

export interface EnemyData {
  /** Archetype or model ID this entry applies to */
  id: string;
  name: string;
  health: number;
  /** Meters per second */
  moveSpeed: number;
  attackDamage: number;
  /** Meters */
  attackRange: number;
  attackCooldownMs: number;
  /** Meters within which the enemy can see the player */
  sightRange: number;
}

export type PickupKind = 'ammo' | 'health';

export interface PickupData {
  id: string;
  kind: PickupKind;
  amount: number;
}

export type UserAssetMimeType = 'image/png' | 'image/jpeg' | 'image/webp' | 'model/gltf-binary';
export const USER_ASSET_MIME_TYPES: readonly UserAssetMimeType[] = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'model/gltf-binary',
];

export type UserAssetLicense = 'own-work' | 'CC0-1.0' | 'CC-BY-4.0' | 'other';
export const USER_ASSET_LICENSES: readonly UserAssetLicense[] = ['own-work', 'CC0-1.0', 'CC-BY-4.0', 'other'];

/**
 * The attribution recorded for textures uploaded before the editor asked for a license (P2.6).
 * Their license is unknown, so the export refuses them until they are uploaded again (P3.4).
 */
export const LICENSE_NOT_RECORDED = 'Uploaded before the editor recorded licenses.';

export interface UserAsset {
  id: string;
  name: string;
  mimeType: UserAssetMimeType;
  /** Lowercase hex SHA-256 of the bytes */
  sha256: string;
  /** Byte length */
  size: number;
  license: UserAssetLicense;
  /** Required for CC-BY-4.0 and other */
  attribution?: string;
  /** Base64 bytes, present only in downloaded project files (IndexedDB stores blobs separately) */
  data?: string;
}

export type MultiplayerMode = 'coop' | 'deathmatch';

export interface MultiplayerSettings {
  /** Multiplayer is on only when this is the literal `true` */
  enabled: boolean;
  mode: MultiplayerMode;
  /** 2 to 8 */
  maxPlayers: number;
  /** wss:// URL; ws:// only for localhost and 127.0.0.1 */
  serverUrl: string;
  /** https:// origins the game will be hosted on */
  allowedOrigins: string[];
  allowSinglePlayer: boolean;
  coop: { friendlyFire: boolean; respawnSeconds: number };
  deathmatch: { fragLimit: number; timeLimitMinutes: number; respawnSeconds: number };
}
