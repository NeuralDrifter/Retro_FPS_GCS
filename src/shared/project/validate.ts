/**
 * Validator for untrusted v4 project documents, in the style of the level validator
 * (src/sim/validator.ts): every problem is reported with its JSON path, unknown fields and
 * prototype-polluting keys are rejected, sizes are capped, and the function never throws.
 * Levels are checked by validateLevelDataV3.
 */
import { validateLevelDataV3 } from '../../sim';
import type { ValidationErrorItem, ValidationResult } from '../../sim';
import {
  PROJECT_ID_PATTERN,
  PROJECT_LIMITS,
  PROJECT_SCHEMA_VERSION,
  SHA256_PATTERN,
  SLUG_PATTERN,
  USER_ASSET_LICENSES,
  USER_ASSET_MIME_TYPES,
} from './schema';
import type { MultiplayerSettings, ProjectDocV4 } from './schema';
import { BUILTIN_MODEL_IDS, BUILTIN_TEXTURE_IDS, SAFE_ASSET_ID_REGEX } from '../assetIds';

/**
 * Accepts any well-formed asset ID. A project can reference library and uploaded assets the
 * validator cannot see, so here only the ID format is checked; export checks that each exists.
 */
class AnyWellFormedId extends Set<string> {
  override has(id: string): boolean {
    return SAFE_ASSET_ID_REGEX.test(id);
  }
}
const ANY_ASSET_ID = new AnyWellFormedId();

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/;
const VERSION = /^\d{1,5}\.\d{1,5}\.\d{1,5}([-+][0-9A-Za-z.-]{1,40})?$/;
const LIBRARY_ID = /^[a-z0-9][a-z0-9_.-]{0,63}$/;
const LIBRARY_VERSION = /^[0-9A-Za-z][0-9A-Za-z._-]{0,31}$/;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

type Json = Record<string, unknown>;

class Checker {
  readonly errors: ValidationErrorItem[] = [];
  readonly warnings: ValidationErrorItem[] = [];

  error(path: string, code: string, message: string): void {
    if (this.errors.length < 200) this.errors.push({ path, code, message });
  }

  object(value: unknown, path: string): value is Json {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      this.error(path, 'type', 'must be an object');
      return false;
    }
    return true;
  }

  /** Rejects keys outside `allowed` and reports required keys that are missing */
  keys(obj: Json, path: string, required: readonly string[], optional: readonly string[] = []): void {
    for (const key of Object.keys(obj)) {
      if (!required.includes(key) && !optional.includes(key)) {
        this.error(`${path}.${key}`, 'unknown_field', `unknown field '${key}'`);
      }
    }
    for (const key of required) {
      if (!(key in obj)) this.error(`${path}.${key}`, 'missing', `missing required field '${key}'`);
    }
  }

  string(value: unknown, path: string, maxChars: number, pattern?: RegExp, allowEmpty = true): value is string {
    if (typeof value !== 'string') {
      this.error(path, 'type', 'must be a string');
      return false;
    }
    if (!allowEmpty && value.trim().length === 0) {
      this.error(path, 'empty', 'must not be empty');
      return false;
    }
    if (value.length > maxChars) {
      this.error(path, 'too_long', `must be at most ${maxChars} characters`);
      return false;
    }
    if (pattern && !pattern.test(value)) {
      this.error(path, 'format', `has an invalid format`);
      return false;
    }
    return true;
  }

  boolean(value: unknown, path: string): value is boolean {
    if (typeof value !== 'boolean') {
      this.error(path, 'type', 'must be true or false');
      return false;
    }
    return true;
  }

  number(value: unknown, path: string, min: number, max: number, integer = false): value is number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      this.error(path, 'type', 'must be a finite number');
      return false;
    }
    if (integer && !Number.isInteger(value)) {
      this.error(path, 'type', 'must be an integer');
      return false;
    }
    if (value < min || value > max) {
      this.error(path, 'range', `must be between ${min} and ${max}`);
      return false;
    }
    return true;
  }

  array(value: unknown, path: string, min: number, max: number): value is unknown[] {
    if (!Array.isArray(value)) {
      this.error(path, 'type', 'must be an array');
      return false;
    }
    if (value.length < min || value.length > max) {
      this.error(path, 'length', `must hold between ${min} and ${max} items`);
      return false;
    }
    return true;
  }

  oneOf<T extends string>(value: unknown, path: string, options: readonly T[]): value is T {
    if (typeof value !== 'string' || !(options as readonly string[]).includes(value)) {
      this.error(path, 'enum', `must be one of: ${options.join(', ')}`);
      return false;
    }
    return true;
  }

  uniqueIds(items: unknown[], path: string): void {
    const seen = new Set<string>();
    items.forEach((item, i) => {
      const id = item && typeof item === 'object' ? (item as Json).id : undefined;
      if (typeof id !== 'string') return;
      if (seen.has(id)) this.error(`${path}[${i}].id`, 'duplicate', `duplicate id '${id}'`);
      seen.add(id);
    });
  }
}

/** Walks the raw value once: rejects prototype-polluting keys and nesting deeper than MAX_DEPTH */
function scanStructure(value: unknown, c: Checker): boolean {
  const stack: { value: unknown; path: string; depth: number }[] = [{ value, path: '$', depth: 0 }];
  let ok = true;
  while (stack.length > 0) {
    const { value: node, path, depth } = stack.pop()!;
    if (node === null || typeof node !== 'object') continue;
    if (depth > PROJECT_LIMITS.MAX_DEPTH) {
      c.error(path, 'too_deep', `nesting deeper than ${PROJECT_LIMITS.MAX_DEPTH} levels`);
      return false;
    }
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) stack.push({ value: node[i], path: `${path}[${i}]`, depth: depth + 1 });
      continue;
    }
    for (const key of Object.keys(node)) {
      if (FORBIDDEN_KEYS.has(key)) {
        c.error(`${path}.${key}`, 'forbidden_key', `forbidden key '${key}'`);
        ok = false;
        continue;
      }
      stack.push({ value: (node as Json)[key], path: `${path}.${key}`, depth: depth + 1 });
    }
  }
  return ok;
}

function checkMeta(value: unknown, c: Checker): void {
  const path = '$.meta';
  if (!c.object(value, path)) return;
  c.keys(value, path, ['title', 'author', 'description', 'version', 'createdAt', 'updatedAt', 'editorVersion', 'contentLicense']);
  c.string(value.title, `${path}.title`, PROJECT_LIMITS.MAX_TITLE_CHARS, undefined, false);
  c.string(value.author, `${path}.author`, PROJECT_LIMITS.MAX_SHORT_TEXT_CHARS);
  c.string(value.description, `${path}.description`, PROJECT_LIMITS.MAX_DESCRIPTION_CHARS);
  c.string(value.version, `${path}.version`, 64, VERSION);
  c.string(value.createdAt, `${path}.createdAt`, 40, ISO_TIME);
  c.string(value.updatedAt, `${path}.updatedAt`, 40, ISO_TIME);
  c.string(value.editorVersion, `${path}.editorVersion`, 64, VERSION);
  c.string(value.contentLicense, `${path}.contentLicense`, 64, /^[A-Za-z0-9.+-]+$/, false);
}

function checkLevels(value: unknown, c: Checker): void {
  const path = '$.levels';
  if (!c.array(value, path, 1, PROJECT_LIMITS.MAX_LEVELS)) return;
  c.uniqueIds(value, path);
  value.forEach((level, i) => {
    const p = `${path}[${i}]`;
    if (!c.object(level, p)) return;
    c.keys(level, p, ['id', 'title', 'data']);
    c.string(level.id, `${p}.id`, 64, PROJECT_ID_PATTERN);
    c.string(level.title, `${p}.title`, PROJECT_LIMITS.MAX_TITLE_CHARS, undefined, false);
    if (!c.object(level.data, `${p}.data`)) return;
    const result = validateLevelDataV3(level.data, {
      allowedTextureIds: ANY_ASSET_ID,
      allowedModelIds: ANY_ASSET_ID,
      allowedSoundIds: ANY_ASSET_ID,
    });
    for (const e of result.errors) {
      c.error(`${p}.data${e.path.replace(/^\$/, '')}`, e.code, e.message);
    }
  });
}

function checkCampaign(value: unknown, c: Checker): void {
  const path = '$.campaign';
  if (!c.object(value, path)) return;
  c.keys(value, path, ['carryOverHealth', 'carryOverAmmo'], ['menus']);
  c.boolean(value.carryOverHealth, `${path}.carryOverHealth`);
  c.boolean(value.carryOverAmmo, `${path}.carryOverAmmo`);
  if ('menus' in value && c.object(value.menus, `${path}.menus`)) {
    if (JSON.stringify(value.menus).length > PROJECT_LIMITS.MAX_MENU_JSON_CHARS) {
      c.error(`${path}.menus`, 'too_large', `must be at most ${PROJECT_LIMITS.MAX_MENU_JSON_CHARS} characters of JSON`);
    }
  }
}

function checkGameData(value: unknown, c: Checker): void {
  const path = '$.gameData';
  if (!c.object(value, path)) return;
  c.keys(value, path, ['player', 'weapons', 'enemies', 'pickups']);
  const max = PROJECT_LIMITS.MAX_GAME_DATA_ENTRIES;
  if (c.object(value.player, `${path}.player`)) {
    const p = value.player;
    c.keys(p, `${path}.player`, ['maxHealth', 'startAmmo', 'maxAmmo']);
    c.number(p.maxHealth, `${path}.player.maxHealth`, 1, 10000, true);
    c.number(p.startAmmo, `${path}.player.startAmmo`, 0, 10000, true);
    c.number(p.maxAmmo, `${path}.player.maxAmmo`, 0, 10000, true);
    if (typeof p.startAmmo === 'number' && typeof p.maxAmmo === 'number' && p.startAmmo > p.maxAmmo) {
      c.error(`${path}.player.startAmmo`, 'range', 'must not exceed maxAmmo');
    }
  }
  if (c.array(value.weapons, `${path}.weapons`, 1, max)) {
    c.uniqueIds(value.weapons, `${path}.weapons`);
    value.weapons.forEach((w, i) => {
      const p = `${path}.weapons[${i}]`;
      if (!c.object(w, p)) return;
      c.keys(w, p, ['id', 'name', 'damage', 'fireCooldownMs', 'ammoPerShot', 'reloadAmount']);
      c.string(w.id, `${p}.id`, 64, PROJECT_ID_PATTERN);
      c.string(w.name, `${p}.name`, PROJECT_LIMITS.MAX_TITLE_CHARS, undefined, false);
      c.number(w.damage, `${p}.damage`, 0, 10000);
      c.number(w.fireCooldownMs, `${p}.fireCooldownMs`, 16, 60000);
      c.number(w.ammoPerShot, `${p}.ammoPerShot`, 0, 100, true);
      c.number(w.reloadAmount, `${p}.reloadAmount`, 0, 10000, true);
    });
  }
  if (c.array(value.enemies, `${path}.enemies`, 0, max)) {
    c.uniqueIds(value.enemies, `${path}.enemies`);
    value.enemies.forEach((e, i) => {
      const p = `${path}.enemies[${i}]`;
      if (!c.object(e, p)) return;
      c.keys(e, p, ['id', 'name', 'health', 'moveSpeed', 'attackDamage', 'attackRange', 'attackCooldownMs', 'sightRange']);
      c.string(e.id, `${p}.id`, 64, PROJECT_ID_PATTERN);
      c.string(e.name, `${p}.name`, PROJECT_LIMITS.MAX_TITLE_CHARS, undefined, false);
      c.number(e.health, `${p}.health`, 1, 100000);
      c.number(e.moveSpeed, `${p}.moveSpeed`, 0, 100);
      c.number(e.attackDamage, `${p}.attackDamage`, 0, 10000);
      c.number(e.attackRange, `${p}.attackRange`, 0, 1000);
      c.number(e.attackCooldownMs, `${p}.attackCooldownMs`, 0, 60000);
      c.number(e.sightRange, `${p}.sightRange`, 0, 1000);
    });
  }
  if (c.array(value.pickups, `${path}.pickups`, 0, max)) {
    c.uniqueIds(value.pickups, `${path}.pickups`);
    value.pickups.forEach((k, i) => {
      const p = `${path}.pickups[${i}]`;
      if (!c.object(k, p)) return;
      c.keys(k, p, ['id', 'kind', 'amount']);
      c.string(k.id, `${p}.id`, 64, PROJECT_ID_PATTERN);
      c.oneOf(k.kind, `${p}.kind`, ['ammo', 'health'] as const);
      c.number(k.amount, `${p}.amount`, 0, 10000, true);
    });
  }
}

function checkUserAssets(value: unknown, c: Checker): void {
  const path = '$.userAssets';
  if (!c.array(value, path, 0, PROJECT_LIMITS.MAX_USER_ASSETS)) return;
  c.uniqueIds(value, path);
  value.forEach((a, i) => {
    const p = `${path}[${i}]`;
    if (!c.object(a, p)) return;
    c.keys(a, p, ['id', 'name', 'mimeType', 'sha256', 'size', 'license'], ['attribution', 'data']);
    if (c.string(a.id, `${p}.id`, 64, PROJECT_ID_PATTERN) && (BUILTIN_TEXTURE_IDS.includes(a.id) || BUILTIN_MODEL_IDS.includes(a.id))) {
      // An upload may not take over a built-in texture or model (audit ED-2)
      c.error(`${p}.id`, 'reserved', `'${a.id}' is a built-in asset id`);
    }
    c.string(a.name, `${p}.name`, PROJECT_LIMITS.MAX_SHORT_TEXT_CHARS, undefined, false);
    c.oneOf(a.mimeType, `${p}.mimeType`, USER_ASSET_MIME_TYPES);
    c.string(a.sha256, `${p}.sha256`, 64, SHA256_PATTERN);
    c.number(a.size, `${p}.size`, 1, PROJECT_LIMITS.MAX_ASSET_BYTES, true);
    const licensed = c.oneOf(a.license, `${p}.license`, USER_ASSET_LICENSES);
    if ('attribution' in a) c.string(a.attribution, `${p}.attribution`, PROJECT_LIMITS.MAX_ATTRIBUTION_CHARS);
    if (licensed && (a.license === 'CC-BY-4.0' || a.license === 'other')) {
      if (typeof a.attribution !== 'string' || a.attribution.trim().length === 0) {
        c.error(`${p}.attribution`, 'missing', `required when the license is ${a.license}`);
      }
    }
    if ('data' in a && c.string(a.data, `${p}.data`, PROJECT_LIMITS.MAX_ASSET_BASE64_CHARS, BASE64)) {
      const bytes = Math.floor((a.data.length * 3) / 4) - (a.data.endsWith('==') ? 2 : a.data.endsWith('=') ? 1 : 0);
      if (typeof a.size === 'number' && bytes !== a.size) {
        c.error(`${p}.data`, 'size_mismatch', `holds ${bytes} bytes but size says ${a.size}`);
      }
    }
  });
}

/** wss://host[:port][/path]; ws:// only for localhost and 127.0.0.1. No credentials, query or fragment. */
const SERVER_URL = /^(wss:\/\/[a-z0-9.-]+|ws:\/\/(localhost|127\.0\.0\.1))(:\d{1,5})?(\/[A-Za-z0-9._~/-]*)?$/i;
/** https://host[:port] with nothing after it */
const HTTPS_ORIGIN = /^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)*(:\d{1,5})?$/;

function checkMultiplayer(value: unknown, c: Checker): void {
  const path = '$.multiplayer';
  if (!c.object(value, path)) return;
  c.keys(value, path, ['enabled', 'mode', 'maxPlayers', 'serverUrl', 'allowedOrigins', 'allowSinglePlayer', 'coop', 'deathmatch']);
  c.boolean(value.enabled, `${path}.enabled`);
  c.oneOf(value.mode, `${path}.mode`, ['coop', 'deathmatch'] as const);
  c.number(value.maxPlayers, `${path}.maxPlayers`, 2, 8, true);
  if (c.string(value.serverUrl, `${path}.serverUrl`, 512) && !SERVER_URL.test(value.serverUrl)) {
    c.error(`${path}.serverUrl`, 'format', 'must be a wss:// URL (ws:// only for localhost and 127.0.0.1)');
  }
  if (c.array(value.allowedOrigins, `${path}.allowedOrigins`, 0, PROJECT_LIMITS.MAX_ALLOWED_ORIGINS)) {
    value.allowedOrigins.forEach((origin, i) => {
      const p = `${path}.allowedOrigins[${i}]`;
      if (c.string(origin, p, 256) && !HTTPS_ORIGIN.test(origin)) {
        c.error(p, 'format', 'must be an https:// origin with no path, e.g. https://example.org');
      }
    });
  }
  c.boolean(value.allowSinglePlayer, `${path}.allowSinglePlayer`);
  if (c.object(value.coop, `${path}.coop`)) {
    c.keys(value.coop, `${path}.coop`, ['friendlyFire', 'respawnSeconds']);
    c.boolean(value.coop.friendlyFire, `${path}.coop.friendlyFire`);
    c.number(value.coop.respawnSeconds, `${path}.coop.respawnSeconds`, 0, 120, true);
  }
  if (c.object(value.deathmatch, `${path}.deathmatch`)) {
    c.keys(value.deathmatch, `${path}.deathmatch`, ['fragLimit', 'timeLimitMinutes', 'respawnSeconds']);
    c.number(value.deathmatch.fragLimit, `${path}.deathmatch.fragLimit`, 1, 1000, true);
    c.number(value.deathmatch.timeLimitMinutes, `${path}.deathmatch.timeLimitMinutes`, 1, 240, true);
    c.number(value.deathmatch.respawnSeconds, `${path}.deathmatch.respawnSeconds`, 0, 120, true);
  }
}

function validate(input: unknown, c: Checker): void {
  if (!c.object(input, '$')) return;
  if (!scanStructure(input, c)) return;
  if (input.schemaVersion !== PROJECT_SCHEMA_VERSION) {
    const found = typeof input.schemaVersion === 'number' ? String(input.schemaVersion) : 'missing';
    c.error('$.schemaVersion', 'version', `must be ${PROJECT_SCHEMA_VERSION} (found ${found})`);
    return;
  }
  c.keys(input, '$', ['schemaVersion', 'id', 'meta', 'assetLibrary', 'levels', 'campaign', 'gameData', 'userAssets', 'export'], ['multiplayer']);
  c.string(input.id, '$.id', 64, PROJECT_ID_PATTERN);
  checkMeta(input.meta, c);
  if (c.object(input.assetLibrary, '$.assetLibrary')) {
    c.keys(input.assetLibrary, '$.assetLibrary', ['id', 'version']);
    c.string(input.assetLibrary.id, '$.assetLibrary.id', 64, LIBRARY_ID);
    c.string(input.assetLibrary.version, '$.assetLibrary.version', 32, LIBRARY_VERSION);
  }
  checkLevels(input.levels, c);
  checkCampaign(input.campaign, c);
  checkGameData(input.gameData, c);
  checkUserAssets(input.userAssets, c);
  if (c.object(input.export, '$.export')) {
    c.keys(input.export, '$.export', ['slug']);
    c.string(input.export.slug, '$.export.slug', 64, SLUG_PATTERN);
  }
  if ('multiplayer' in input) checkMultiplayer(input.multiplayer, c);
}

/** Validates an untrusted value as a v4 project document. Never throws. */
export function validateProjectV4(input: unknown): ValidationResult {
  const c = new Checker();
  try {
    validate(input, c);
  } catch (err) {
    c.error('$', 'internal', `validation stopped: ${err instanceof Error ? err.message : String(err)}`);
  }
  return { valid: c.errors.length === 0, errors: c.errors, warnings: c.warnings };
}

/** Type guard for validated documents */
export function isProjectV4(input: unknown): input is ProjectDocV4 {
  return validateProjectV4(input).valid;
}

/** Multiplayer counts as on only when `enabled` is the literal `true` */
export function isMultiplayerEnabled(doc: { multiplayer?: Partial<MultiplayerSettings> | unknown }): boolean {
  const mp = doc.multiplayer;
  return Boolean(mp) && typeof mp === 'object' && (mp as { enabled?: unknown }).enabled === true;
}
