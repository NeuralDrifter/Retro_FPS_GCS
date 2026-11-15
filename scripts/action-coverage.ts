/**
 * Which event actions, triggers and conditions the sample project uses (release plan P2.8).
 * P7.5 takes the sample to every action type; until then this lists what is still unused.
 * Run with `npm run coverage:actions`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ActionSpec, ConditionSpec, EventDefinition, TriggerSpec } from '../src/sim';
import type { ProjectDocV4 } from '../src/shared/project';

/** Every action type; the check below fails to compile when the sim gains one this list lacks */
export const ALL_ACTION_TYPES = [
  'open_door', 'close_door', 'toggle_door', 'lock_door', 'unlock_door', 'slide_wall',
  'lower_floor', 'raise_floor', 'toggle_lift', 'start_crusher', 'stop_crusher', 'build_stairs',
  'wake_entities', 'spawn_entity', 'remove_entity', 'damage_entity',
  'set_cell', 'set_wall_texture', 'set_floor_texture', 'set_ceiling_texture',
  'mark_secret_found', 'give_item', 'take_item', 'heal_player', 'damage_player', 'teleport_player',
  'set_flag', 'toggle_flag', 'set_counter', 'add_counter', 'start_timer', 'stop_timer', 'delay',
  'fire_event', 'trigger_event', 'enable_event', 'disable_event', 'reset_event_once',
  'show_message', 'play_sound', 'exit_level', 'earthquake',
  'set_light_effect', 'stop_light_effect', 'set_hazard_region', 'clear_hazard_region',
  'if_then_else', 'random_branch', 'move_along_track',
] as const satisfies readonly ActionSpec['type'][];
type MissingAction = Exclude<ActionSpec['type'], (typeof ALL_ACTION_TYPES)[number]>;
const actionListComplete: [MissingAction] extends [never] ? true : MissingAction = true;
void actionListComplete;

export interface Coverage {
  actions: { used: string[]; unused: string[] };
  triggers: string[];
  conditions: string[];
}

/** Collects the action, trigger and condition types a project uses, nested actions included */
export function actionCoverage(doc: ProjectDocV4): Coverage {
  const actions = new Set<string>();
  const triggers = new Set<string>();
  const conditions = new Set<string>();
  const visitCondition = (c: ConditionSpec) => conditions.add(c.type);
  const visit = (a: ActionSpec) => {
    actions.add(a.type);
    if (a.type === 'if_then_else') {
      visitCondition(a.condition);
      a.then_actions.forEach(visit);
      a.else_actions?.forEach(visit);
    } else if (a.type === 'random_branch') {
      for (const b of a.branches) b.actions.forEach(visit);
    }
  };
  for (const level of doc.levels) {
    for (const e of level.data.events as EventDefinition[]) {
      triggers.add((e.trigger as TriggerSpec).type);
      e.conditions.forEach(visitCondition);
      e.actions.forEach(visit);
    }
  }
  return {
    actions: {
      used: ALL_ACTION_TYPES.filter((t) => actions.has(t)),
      unused: ALL_ACTION_TYPES.filter((t) => !actions.has(t)),
    },
    triggers: [...triggers].sort(),
    conditions: [...conditions].sort(),
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const doc = JSON.parse(fs.readFileSync(path.join(root, 'samples/proving-grounds.gcs.json'), 'utf-8')) as ProjectDocV4;
  const c = actionCoverage(doc);
  console.log(`Actions: ${c.actions.used.length} of ${ALL_ACTION_TYPES.length} used by the sample.`);
  console.log(`Unused (P7.5 covers these): ${c.actions.unused.join(', ') || 'none'}`);
  console.log(`Triggers used: ${c.triggers.join(', ')}`);
  console.log(`Conditions used: ${c.conditions.join(', ')}`);
}
