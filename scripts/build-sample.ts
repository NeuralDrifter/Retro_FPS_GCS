/**
 * Builds the sample project "Proving Grounds" (release plan P2.8): an original three-level
 * campaign made from built-in content and the CC0 asset library, written to
 * samples/proving-grounds.gcs.json, plus an input recording that walks level 1 to its exit
 * (samples/recordings/level1.json). Run with `npm run build:sample`; the output is committed.
 *
 *   1  Intake Hall    classic movement: keycard, locked armory, automatic door, push-wall secret,
 *                     a dormant sentinel, the exit at the end of the main hall
 *   2  Pump Station   full 3D movement: a pit, a lift, stairs that build, floors that sink and
 *                     rise, a crusher, an acid hazard, flickering lights, a timer and a counter
 *   3  Command Core   every enemy type including library monsters, reinforcements on a timer,
 *                     branching and conditional events, a teleporter, an earthquake, and a door
 *                     that opens when the room is clear
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalStringify, createDefaultGameData, createDefaultProject, validateProjectV4 } from '../src/shared/project';
import type { ProjectDocV4 } from '../src/shared/project';
import { SIM_CONFIG, createInitialSimulationState, step } from '../src/sim';
import type { EventDefinition, LevelDataV3, PlayerTickInput, RegionDefinition, SimPlacedEntityV3 } from '../src/sim';
import { parseTextureDiskPath } from '../src/editor/engine/textureLibrary';
import { diskModelId } from '../src/editor/engine/modelLibrary/diskPaths';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SIZE = 16;
const EAST = 49152; // yawBam facing +col
const LIBRARY_VERSION = 'v1.0';

// ---------------------------------------------------------------------------
// Library assets (ids derive from their library paths, as the editor derives them)
// ---------------------------------------------------------------------------
const tex = (libraryPath: string) => parseTextureDiskPath(libraryPath.replace(/^textures\//, '')).id;
const model = (libraryPath: string) => diskModelId(libraryPath.replace(/^models\//, ''));

const T = {
  labWall: tex('textures/LAB/Walls/tile000.webp'),
  labWall2: tex('textures/LAB/Walls/tile050.webp'),
  brick: tex('textures/Horror/Brick/Horror_Brick_01.webp'),
  brick2: tex('textures/Horror/Brick/Horror_Brick_02.webp'),
  marble: tex('textures/Floor Tiles/Checker Tiles/BW_Marble_Tile_01.webp'),
  acid: tex('textures/Liquids/Liquid_Blue_01-512x512.webp'),
  metal: tex('textures/Tiny Pack 3/Metal/Metal_01.webp'),
  metal2: tex('textures/Tiny Pack 3/Metal/Metal_02.webp'),
  cracks: tex('textures/Terrain/adesert_cracks.webp'),
};
const M = {
  zombie: model('models/characters/Monsters/Zombie.glb'),
  glutton: model('models/characters/Monsters/Glutton Demon.glb'),
  grunt: model('models/characters/Monsters/Mutant Grunt.glb'),
  golem: model('models/characters/Robots/Golem Robot.glb'),
  barrel: model('models/decorations/Sci-Fi Essentials/Barrel1.glb'),
};

// ---------------------------------------------------------------------------
// Level builder
// ---------------------------------------------------------------------------
const CELL: Record<string, number> = { '#': 1, D: 2, K: 3, O: 4 };

interface LevelSpec {
  title: string;
  map: string[];
  wall: string;
  floor: string;
  ceiling: string;
  /** Per-cell texture overrides, keyed "row,col" */
  walls?: Record<string, string>;
  floors?: Record<string, string>;
  spawn: { row: number; col: number; yawBam: number };
  skybox: LevelDataV3['skybox'];
  tags?: Record<number, [number, number][]>;
  entities: SimPlacedEntityV3[];
  regions: RegionDefinition[];
  events: EventDefinition[];
  variables?: LevelDataV3['variables'];
  classic?: boolean;
  floorHeights?: Record<string, number>;
  seed: number;
}

const matrix = <V,>(fill: V) => Array.from({ length: SIZE }, () => new Array<V>(SIZE).fill(fill));
const box = (r0: number, c0: number, r1: number, c1: number) => {
  const cells: { row: number; col: number }[] = [];
  for (let row = r0; row <= r1; row++) for (let col = c0; col <= c1; col++) cells.push({ row, col });
  return cells;
};

function buildLevel(spec: LevelSpec): LevelDataV3 {
  if (spec.map.length !== SIZE || spec.map.some((r) => r.length !== SIZE)) throw new Error(`${spec.title}: the map must be ${SIZE}x${SIZE}`);
  const grid = spec.map.map((r) => [...r].map((ch) => CELL[ch] ?? 0));
  const wallTextures = matrix(spec.wall);
  const floorTextures = matrix(spec.floor);
  const ceilingTextures = matrix(spec.ceiling);
  for (const [key, id] of Object.entries(spec.walls ?? {})) {
    const [r, c] = key.split(',').map(Number);
    wallTextures[r][c] = id;
  }
  for (const [key, id] of Object.entries(spec.floors ?? {})) {
    const [r, c] = key.split(',').map(Number);
    floorTextures[r][c] = id;
  }
  const cellTags = matrix(0);
  for (const [tag, cells] of Object.entries(spec.tags ?? {})) for (const [r, c] of cells) cellTags[r][c] = Number(tag);
  const level: LevelDataV3 = {
    formatVersion: 3,
    gridSize: SIZE,
    rngSeed: spec.seed,
    nextEntityId: 1 + Math.max(0, ...spec.entities.map((e) => Number(/(\d+)$/.exec(e.id)?.[1] ?? 0))),
    spawn: spec.spawn,
    minimapEnabled: true,
    skybox: spec.skybox,
    grid,
    wallTextures,
    floorTextures,
    ceilingTextures,
    cellTags,
    entities: spec.entities,
    regions: spec.regions,
    variables: spec.variables ?? { flags: {}, counters: {}, timers: [] },
    events: spec.events,
    metadata: { title: spec.title },
    ...(spec.classic ? { classicMovement: true } : {}),
  };
  if (spec.floorHeights) {
    level.floorHeights = matrix(0);
    for (const [key, h] of Object.entries(spec.floorHeights)) {
      const [r, c] = key.split(',').map(Number);
      level.floorHeights[r][c] = h;
    }
  }
  return level;
}

let entitySeq = 0;
const enemy = (row: number, col: number, kind: 'sentinel-bot' | 'turret-guardian', extra: Partial<SimPlacedEntityV3> = {}): SimPlacedEntityV3 => ({
  id: `ent-${++entitySeq}`,
  row,
  col,
  blueprintId: kind,
  name: kind === 'sentinel-bot' ? 'Sentinel' : 'Turret Guardian',
  yawBam: 0,
  scalePct: 100,
  isEnemy: true,
  maxHealth: kind === 'sentinel-bot' ? 75 : 120,
  moveSpeedUnitsPerTick: kind === 'sentinel-bot' ? 32 : 0,
  attackDamage: kind === 'sentinel-bot' ? 12 : 18,
  ...extra,
});
const monster = (row: number, col: number, modelId: string, name: string, extra: Partial<SimPlacedEntityV3> = {}): SimPlacedEntityV3 => ({
  id: `ent-${++entitySeq}`,
  row,
  col,
  blueprintId: 'custom-glb',
  modelAssetId: modelId,
  name,
  yawBam: 0,
  scalePct: 100,
  isEnemy: true,
  maxHealth: 90,
  moveSpeedUnitsPerTick: 28,
  attackDamage: 14,
  category: 'characters',
  collision: 'solid',
  ...extra,
});
const prop = (row: number, col: number, extra: Partial<SimPlacedEntityV3> = {}): SimPlacedEntityV3 => ({
  id: `ent-${++entitySeq}`,
  row,
  col,
  blueprintId: 'supply-crate',
  name: 'Supply Crate',
  yawBam: 0,
  scalePct: 100,
  isEnemy: false,
  maxHealth: 50,
  moveSpeedUnitsPerTick: 0,
  attackDamage: 0,
  ...extra,
});
const decoration = (row: number, col: number, modelId: string, name: string): SimPlacedEntityV3 => ({
  id: `ent-${++entitySeq}`,
  row,
  col,
  blueprintId: 'custom-glb',
  modelAssetId: modelId,
  name,
  yawBam: 0,
  scalePct: 100,
  isEnemy: false,
  maxHealth: 50,
  moveSpeedUnitsPerTick: 0,
  attackDamage: 0,
  category: 'decorations',
  collision: 'solid',
});

const event = (id: string, name: string, trigger: EventDefinition['trigger'], actions: EventDefinition['actions'], extra: Partial<EventDefinition> = {}): EventDefinition => ({
  id,
  name,
  enabled: true,
  trigger,
  conditions: [],
  actions,
  ...extra,
});
const once = { options: { once: true } } as const;

// ---------------------------------------------------------------------------
// Level 1: Intake Hall
// ---------------------------------------------------------------------------
function intakeHall(): LevelDataV3 {
  entitySeq = 0;
  return buildLevel({
    title: 'Intake Hall',
    classic: true,
    seed: 101,
    wall: T.labWall,
    floor: T.marble,
    ceiling: T.metal,
    walls: { '5,12': T.labWall2, '11,11': T.brick },
    map: [
      '################',
      '#......#.......#',
      '#..K...#.......#',
      '#......#.......#',
      '#......#.......#',
      '###.########D###',
      '#......#.......#',
      '#......#.......#',
      '#......D.......#',
      '#......#.......#',
      '#......#.......#',
      '####.###########', // the wall at column 11 is the push wall
      '#......#.......#',
      '#......#.......#',
      '#......#.......#',
      '################',
    ],
    spawn: { row: 8, col: 1, yawBam: EAST },
    skybox: { theme: 'starry-void', seed: 7, showCeiling: true },
    entities: [
      enemy(13, 3, 'sentinel-bot', { tag: 10, ambush: true }),
      prop(2, 10),
      prop(3, 13),
      decoration(6, 1, M.barrel, 'Barrel'),
      decoration(10, 13, M.barrel, 'Barrel'),
    ],
    regions: [
      { id: 'reg_armory', name: 'Armory', cells: box(1, 8, 4, 14) },
      { id: 'reg_south_west', name: 'Storage', cells: box(12, 1, 14, 6) },
      { id: 'reg_cache', name: 'Hidden cache', cells: box(12, 8, 14, 14) },
    ],
    variables: { flags: {}, counters: { secrets: 0 }, timers: [] },
    events: [
      event('l1-start', 'Briefing', { type: 'level_start' }, [
        { type: 'lock_door', row: 5, col: 12, required_key: 'keycard' },
        { type: 'show_message', text: 'Proving Grounds, level 1. Walk east to the exit. The armory needs the keycard from the north-west room.' },
      ], once),
      event('l1-auto-door', 'Hall door opens as you approach', { type: 'enter_cell', row: 8, col: 4 }, [
        { type: 'open_door', row: 8, col: 7, wait_ticks: 150 },
        { type: 'play_sound', sound_id: 'door_open', row: 8, col: 7 },
      ]),
      event('l1-keycard', 'Keycard picked up', { type: 'pickup_item', item: 'keycard' }, [
        { type: 'unlock_door', row: 5, col: 12 },
        { type: 'play_sound', sound_id: 'key_pickup' },
        { type: 'show_message', text: 'Keycard acquired. The armory door is unlocked.' },
      ], once),
      event('l1-armory', 'Armory supplies', { type: 'enter_region', region: 'reg_armory' }, [
        { type: 'give_item', item: 'armory_pass' },
        { type: 'heal_player', amount: 25 },
        { type: 'show_message', text: 'Armory: you patch yourself up.' },
      ], once),
      event('l1-storage', 'Something stirs in storage', { type: 'enter_region', region: 'reg_south_west' }, [
        { type: 'wake_entities', tag: 10 },
        { type: 'play_sound', sound_id: 'alarm' },
        { type: 'show_message', text: 'A sentinel wakes up!' },
      ], once),
      event('l1-pushwall', 'Push wall to the hidden cache', { type: 'use', row: 11, col: 11 }, [
        { type: 'slide_wall', row: 11, col: 11, direction: 'S', distance_cells: 1 },
        { type: 'mark_secret_found', secret_id: 'intake_cache' },
        { type: 'add_counter', name: 'secrets', delta: 1 },
        { type: 'play_sound', sound_id: 'secret_found', row: 11, col: 11 },
        { type: 'show_message', text: 'Secret found: a hidden cache!' },
      ], once),
      event('l1-exit', 'Exit', { type: 'enter_cell', row: 8, col: 14, who: 'player' }, [
        { type: 'play_sound', sound_id: 'level_exit', row: 8, col: 14 },
        { type: 'exit_level' },
      ], once),
    ],
  });
}

// ---------------------------------------------------------------------------
// Level 2: Pump Station
// ---------------------------------------------------------------------------
function pumpStation(): LevelDataV3 {
  entitySeq = 0;
  const acid = box(12, 2, 13, 5);
  return buildLevel({
    title: 'Pump Station',
    seed: 202,
    wall: T.metal,
    floor: T.metal2,
    ceiling: T.metal,
    walls: { '6,13': T.labWall2, '11,14': T.labWall2 },
    floors: Object.fromEntries(acid.map((c) => [`${c.row},${c.col}`, T.acid])),
    map: [
      '################',
      '#......#.......#',
      '#......#.......#',
      '#......#.......#',
      '#......D.......#',
      '#......#.......#',
      '###.#########.##',
      '#...OOOO.......#',
      '#...OOOO.......#',
      '#...OOOO.......#',
      '#..............#',
      '######.#########',
      '#..............#',
      '#..............#',
      '#..............#',
      '################',
    ],
    spawn: { row: 8, col: 1, yawBam: EAST },
    skybox: { theme: 'emerald-grid', seed: 12, showCeiling: true },
    tags: {
      30: [[3, 10], [3, 11], [3, 12]], // crusher
      40: [[12, 8], [12, 9], [12, 10], [12, 11]], // stairs
      41: [[2, 2], [2, 3]], // sinking floor
      42: [[2, 4], [2, 5]], // rising floor
      43: [[13, 12]], // lift
    },
    entities: [
      enemy(2, 12, 'sentinel-bot', { tag: 20, patrol: true }),
      enemy(13, 9, 'sentinel-bot', { tag: 20 }),
      decoration(10, 13, M.barrel, 'Barrel'),
      prop(1, 1),
    ],
    regions: [
      { id: 'reg_acid', name: 'Acid pool', cells: acid },
      { id: 'reg_pumps', name: 'Pump room', cells: box(1, 8, 5, 14) },
      { id: 'reg_lower', name: 'Lower hall', cells: box(12, 1, 14, 14) },
    ],
    variables: { flags: { pumps_on: true }, counters: { valves: 0 }, timers: ['purge'] },
    events: [
      event('l2-start', 'Briefing', { type: 'level_start' }, [
        { type: 'set_hazard_region', region: 'reg_acid', damage_per_interval: 5, interval_ticks: 30 },
        { type: 'set_light_effect', region: 'reg_pumps', effect: 'flicker', speed_ticks: 8 },
        { type: 'start_crusher', tag: 30, lower_height_units: 1200, speed_per_tick: 60, damage: 15 },
        { type: 'show_message', text: 'Pump Station. Mind the pit and the acid. Turn the two valves to drain the pool.' },
      ], once),
      event('l2-door', 'Pump room door', { type: 'use', row: 4, col: 7 }, [{ type: 'toggle_door', row: 4, col: 7 }]),
      event('l2-valve-a', 'Valve A', { type: 'use', row: 6, col: 13 }, [
        { type: 'add_counter', name: 'valves', delta: 1 },
        { type: 'lower_floor', tag: 41, target_height_units: -250, speed_per_tick: 50, wait_ticks: 120, return_height_units: 0 },
        { type: 'play_sound', sound_id: 'switch_click', row: 6, col: 13 },
      ], once),
      event('l2-valve-b', 'Valve B', { type: 'use', row: 11, col: 14 }, [
        { type: 'add_counter', name: 'valves', delta: 1 },
        { type: 'raise_floor', tag: 42, target_height_units: 250, speed_per_tick: 50 },
        { type: 'play_sound', sound_id: 'switch_click', row: 11, col: 14 },
      ], once),
      event('l2-drained', 'Both valves turned', { type: 'counter_reached', name: 'valves', op: 'gte', value: 2 }, [
        { type: 'clear_hazard_region', region: 'reg_acid' },
        { type: 'stop_crusher', tag: 30 },
        { type: 'stop_light_effect', region: 'reg_pumps' },
        { type: 'set_flag', name: 'pumps_on', value: false },
        { type: 'build_stairs', tag: 40, step_height_units: 125, speed_per_tick: 40 },
        { type: 'start_timer', timer: 'purge', duration_sec: 5 },
        { type: 'show_message', text: 'Pool drained. Stairs are rising in the lower hall.' },
      ], once),
      event('l2-purge', 'Purge cycle finished', { type: 'timer_fired', timer: 'purge' }, [
        { type: 'earthquake', duration_sec: 2, intensity: 3 },
        { type: 'show_message', text: 'The station shudders. Take the lift by the exit.' },
      ], once),
      event('l2-lift', 'Freight lift', { type: 'use', row: 13, col: 12 }, [
        { type: 'toggle_lift', tag: 43, lower_height_units: -500, upper_height_units: 0, speed_per_tick: 200, wait_ticks: 90 },
      ]),
      event('l2-lift-done', 'Lift arrived', { type: 'mover_finished', tag: 43 }, [{ type: 'show_message', text: 'Lift arrived.' }]),
      event('l2-pit', 'Pit warning', { type: 'enter_cell', row: 8, col: 3 }, [{ type: 'show_message', text: 'Careful: the pit has no bottom.' }], once),
      event('l2-exit', 'Exit', { type: 'enter_cell', row: 14, col: 14, who: 'player' }, [
        { type: 'play_sound', sound_id: 'level_exit' },
        { type: 'exit_level' },
      ], once),
    ],
  });
}

// ---------------------------------------------------------------------------
// Level 3: Command Core
// ---------------------------------------------------------------------------
function commandCore(): LevelDataV3 {
  entitySeq = 0;
  return buildLevel({
    title: 'Command Core',
    seed: 303,
    wall: T.brick,
    floor: T.cracks,
    ceiling: T.metal,
    walls: { '8,15': T.brick2 },
    map: [
      '################',
      '#......#.......#',
      '#......#.......#',
      '#......D.......#',
      '#......#.......#',
      '##.#########.###',
      '#..............#',
      '#..............#',
      '#..............#',
      '#..............#',
      '#..............#',
      '#######D########',
      '#..............#',
      '#..............#',
      '#..............#',
      '################',
    ],
    spawn: { row: 8, col: 1, yawBam: EAST },
    skybox: { theme: 'crimson-dusk', seed: 33, showCeiling: false },
    tags: { 60: [[3, 7]], 61: [[11, 7]] },
    entities: [
      enemy(2, 2, 'sentinel-bot', { tag: 70 }),
      enemy(7, 3, 'turret-guardian', { tag: 70 }),
      enemy(7, 12, 'turret-guardian', { tag: 70 }),
      monster(2, 12, M.glutton, 'Glutton Demon', { tag: 70, maxHealth: 150 }),
      monster(10, 7, M.zombie, 'Zombie', { tag: 70 }),
      monster(9, 12, M.grunt, 'Mutant Grunt', { tag: 70, patrol: true }),
      monster(1, 13, M.golem, 'Golem Robot', { tag: 70, ambush: true }),
      prop(13, 2, { tag: 80 }),
    ],
    regions: [
      { id: 'reg_core', name: 'Core floor', cells: box(6, 1, 10, 14) },
      { id: 'reg_vault', name: 'Vault', cells: box(12, 1, 14, 14) },
    ],
    variables: { flags: { core_online: false, alarm: false }, counters: { waves: 0 }, timers: ['reinforce', 'wave'] },
    events: [
      event('l3-start', 'Briefing', { type: 'level_start' }, [
        { type: 'set_flag', name: 'core_online', value: true },
        { type: 'lock_door', tag: 61 },
        { type: 'start_timer', timer: 'reinforce', duration_sec: 20 },
        { type: 'show_message', text: 'Command Core. Clear the core floor to open the vault.' },
      ], once),
      event('l3-alarm', 'Alarm', { type: 'enter_region', region: 'reg_core' }, [
        { type: 'toggle_flag', name: 'alarm' },
        { type: 'wake_entities', region: 'reg_core' },
        { type: 'set_light_effect', region: 'reg_core', effect: 'strobe', speed_ticks: 6 },
      ], once),
      event('l3-alarm-flag', 'Alarm raised', { type: 'flag_changed', name: 'alarm', is: true }, [
        { type: 'play_sound', sound_id: 'alarm' },
        { type: 'fire_event', event_id: 'l3-wave' },
      ], once),
      event('l3-reinforce', 'Reinforcements', { type: 'timer_fired', timer: 'reinforce' }, [
        { type: 'trigger_event', event_id: 'l3-wave' },
        { type: 'reset_event_once', event_id: 'l3-wave' },
      ]),
      // Only ever started by other events (fire_event, trigger_event)
      event('l3-wave', 'Reinforcement wave', { type: 'timer_fired', timer: 'wave' }, [
        { type: 'add_counter', name: 'waves', delta: 1 },
        {
          type: 'random_branch',
          branches: [
            { weight: 2, actions: [{ type: 'spawn_entity', blueprintId: 'sentinel-bot', row: 6, col: 7, tag: 70, isEnemy: true }] },
            { weight: 1, actions: [{ type: 'spawn_entity', blueprintId: 'turret-guardian', row: 9, col: 9, tag: 70, isEnemy: true, maxHealth: 100 }] },
          ],
        },
        { type: 'show_message', text: 'More defenders arrive!' },
      ], { enabled: false, options: { once: true } }),
      event('l3-wave-arm', 'Arm the wave event', { type: 'level_start' }, [{ type: 'enable_event', event_id: 'l3-wave' }], once),
      event('l3-clear', 'Core floor clear', { type: 'all_dead', tag: 70 }, [
        { type: 'stop_timer', timer: 'reinforce' },
        { type: 'disable_event', event_id: 'l3-reinforce' },
        { type: 'stop_light_effect', region: 'reg_core' },
        { type: 'unlock_door', tag: 61 },
        { type: 'open_door', tag: 61 },
        { type: 'show_message', text: 'Core floor clear. The vault is open.' },
      ], once),
      event('l3-console', 'Security console', { type: 'use', row: 8, col: 15 }, [
        {
          type: 'if_then_else',
          condition: { type: 'player_health', op: 'lt', value: 50 },
          then_actions: [{ type: 'heal_player', amount: 40 }, { type: 'show_message', text: 'Medical override: health restored.' }],
          else_actions: [{ type: 'give_item', item: 'core_key' }, { type: 'show_message', text: 'Console: vault key issued.' }],
        },
        { type: 'set_wall_texture', row: 8, col: 15, texture_id: T.labWall2 },
        { type: 'delay', delay_ticks: 30 },
        { type: 'play_sound', sound_id: 'switch_click', row: 8, col: 15 },
      ]),
      event('l3-teleporter', 'Teleporter pad', { type: 'enter_cell', row: 2, col: 5 }, [
        { type: 'teleport_player', row: 8, col: 2, yaw_bam: EAST },
        { type: 'set_floor_texture', row: 2, col: 5, texture_id: T.acid },
        { type: 'damage_player', amount: 5 },
      ]),
      event('l3-north-door', 'North door', { type: 'use', row: 3, col: 7 }, [{ type: 'toggle_door', tag: 60 }]),
      event('l3-vault', 'Vault', { type: 'enter_region', region: 'reg_vault' }, [
        { type: 'set_cell', row: 13, col: 7, cell_type: 0 },
        { type: 'set_ceiling_texture', row: 13, col: 7, texture_id: T.metal2 },
        { type: 'move_along_track', tag: 80, waypoints: [{ row: 13, col: 2 }, { row: 13, col: 6 }], speed_per_tick: 100, ping_pong: true },
        { type: 'earthquake', duration_ticks: 45, intensity: 2 },
        {
          type: 'if_then_else',
          condition: { type: 'has_item', item: 'core_key' },
          then_actions: [{ type: 'take_item', item: 'core_key' }, { type: 'show_message', text: 'The vault key opens the way out.' }],
          else_actions: [{ type: 'show_message', text: 'The vault exit is at the far east wall.' }],
        },
      ], once),
      event('l3-exit', 'Exit', { type: 'enter_cell', row: 13, col: 14, who: 'player' }, [
        { type: 'play_sound', sound_id: 'level_exit' },
        { type: 'exit_level' },
      ], once),
    ],
  });
}

// ---------------------------------------------------------------------------
// Assemble, check, record
// ---------------------------------------------------------------------------
export function buildProject(): ProjectDocV4 {
  const doc = createDefaultProject({ id: 'proving-grounds', title: 'Proving Grounds', author: 'Retro FPS GCS', now: '2026-11-15T00:00:00Z', editorVersion: '0.1.0' });
  doc.meta.description = 'The sample campaign: three short levels that show doors and keys, secrets, lifts, hazards, scripted events and every enemy type.';
  doc.meta.version = '1.0.0';
  doc.meta.contentLicense = 'CC0-1.0';
  doc.assetLibrary = { id: 'retro-fps-gcs-assets', version: LIBRARY_VERSION };
  doc.levels = [
    { id: 'level-1', title: 'Intake Hall', data: intakeHall() },
    { id: 'level-2', title: 'Pump Station', data: pumpStation() },
    { id: 'level-3', title: 'Command Core', data: commandCore() },
  ];
  doc.campaign = { carryOverHealth: true, carryOverAmmo: true };
  doc.gameData = createDefaultGameData();
  doc.export = { slug: 'proving-grounds' };
  return doc;
}

export interface InputRecording {
  level: string;
  /** Run-length encoded inputs: hold `input` for `ticks` ticks */
  segments: { ticks: number; input: PlayerTickInput }[];
}

const IDLE: PlayerTickInput = { moveForward: 0, moveRight: 0, sprint: false, yawDeltaBam: 0, pitchDeltaBam: 0, use: false, shoot: false };

/** Walks level 1 east until the level ends; returns the recording, or throws if it never does */
export function recordLevel1(level: LevelDataV3): InputRecording {
  let state = createInitialSimulationState(level, [0]);
  const forward = { ...IDLE, moveForward: 1 as const };
  const maxTicks = SIM_CONFIG.TICKS_PER_SECOND * 60;
  let ticks = 0;
  while (!state.levelEnded && ticks < maxTicks) {
    state = step(state, { 0: forward });
    ticks++;
  }
  if (!state.levelEnded) throw new Error('Level 1: walking east never reached the exit.');
  return { level: 'level-1', segments: [{ ticks, input: forward }] };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const doc = buildProject();
  const result = validateProjectV4(doc);
  if (!result.valid) {
    console.error(result.errors.slice(0, 20).map((e) => `${e.path}: ${e.message}`).join('\n'));
    process.exit(1);
  }
  const recording = recordLevel1(doc.levels[0].data);
  fs.mkdirSync(path.join(root, 'samples/recordings'), { recursive: true });
  fs.writeFileSync(path.join(root, 'samples/proving-grounds.gcs.json'), `${canonicalStringify(doc)}\n`);
  fs.writeFileSync(path.join(root, 'samples/recordings/level1.json'), `${JSON.stringify(recording, null, 2)}\n`);
  console.log(`samples/proving-grounds.gcs.json: ${doc.levels.length} levels; level 1 recording reaches the exit in ${recording.segments[0].ticks} ticks`);
}
