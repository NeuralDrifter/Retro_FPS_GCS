# Event and Trigger System Plan (Pie3D Retro GCS)

Status: draft for review. Replace any section that conflicts with the current codebase; the structure is the point.

## 1. Goal

Let authors build the interactive parts of an early-90s FPS without writing code. The target is the range of mechanics found in Wolfenstein 3D, Doom, Duke Nukem 3D, and Shadow Warrior: doors, keys, secrets, switches, lifts, teleporters, ambushes, monster closets, crushers, timed traps, boss arenas, scripted sequences, and level flow.

The system is data. An event is a record the engine interprets; no author text is executed. Lua or any other script VM is out of scope for this plan and can be added later as one optional action type (section 14).

Non-goals for v1. Arbitrary author code, cutscene camera rails, true room-over-room geometry, networked custom assets.

## 2. What the classics did, and what we take from each

This table is a design summary from general familiarity with these engines. Verify specific mechanics against each engine's map-format documentation before copying behavior exactly.

| Source | Mechanism | What we adopt |
|---|---|---|
| Wolfenstein 3D | Tile-based map; doors and locked doors by key; push walls (secret passages) that slide a fixed distance; elevator switch to end the level; patrol direction tiles; ambush flag on guards; secret and normal exits | Cell-based triggers, push walls, key doors, patrol markers, ambush flag, exits, secret counter |
| Doom | Linedef specials with a tag linking a trigger line to target sectors; activation types (walk over, use switch, shoot, push); once or repeatable; doors, lifts, floor and ceiling movers, crushers, stair builders, light effects, teleporters, exits, secret sectors, damage floors; monster flags (ambush, skill levels, multiplayer only) | The tag model, activation types, once or repeat, mover family, light effects, damage floors, thing flags |
| Duke Nukem 3D and Shadow Warrior (Build engine) | Sector and sprite tags; special "effector" and "activator" sprites that run behaviors; touchplates; switches and multi-switches; locks and unlocks; sector effects (rotating, earthquake, random lights); teleporters; water sectors; sound effect emitters; moving sector objects and tracks (SW) | Effector entities, activators with lock state, touchplates, sound emitters, tracks for moving platforms, earthquake and light effects |

Design rule. Copy the author-facing concept (tag, activator, switch, lock, mover), not the numeric encodings.

## 3. Core model

Four things exist in the data.

1. **Tags.** An integer or short name attached to any cell, region, door, wall, light zone, or entity. Actions target tags, so one trigger can drive many targets (Doom's model). Tag `0` means none.
2. **Regions.** A named set of cells (rectangle or painted). Used for "player is in this area", "all enemies in this area are dead", and area-wide effects (lights, damage floor, earthquake).
3. **Events.** One record each: trigger, conditions, actions, and options.
4. **Variables.** Bounded flags (boolean), counters (integer), and timers, each declared in a registry.

A fifth concept, **movers**, is engine-side. Doors, push walls, lifts, crushers, and similar moving geometry are simulated objects with speed, wait time, and blocked behavior. An action starts or controls a mover. A mover emits events when it finishes, so chains like "door finished opening, then spawn monsters" work without polling.

### Event record

```json
{
  "id": "evt_017",
  "name": "Armory ambush",
  "enabled": true,
  "trigger": { "type": "enter_region", "region": "armory", "who": "player" },
  "conditions": [
    { "type": "flag", "name": "armory_unlocked", "is": true },
    { "type": "has_item", "item": "key_red" }
  ],
  "actions": [
    { "type": "close_door", "tag": 12 },
    { "type": "spawn_wave", "wave": "ambush_a" },
    { "type": "play_sound", "sound": "alarm", "at": { "region": "armory" } },
    { "type": "set_flag", "name": "armory_sealed", "value": true }
  ],
  "options": {
    "fire": "once",
    "cooldown_ms": 0,
    "modes": ["single", "coop", "deathmatch"],
    "skill": ["easy", "normal", "hard"]
  }
}
```

`activator` is a context value available to actions and conditions. It is the player or entity that fired the trigger, and it lets one event serve any player in multiplayer ("heal the activator", "teleport the activator").

## 4. Triggers

Grouped by what fires them. Each trigger names its target by coordinate, tag, region, or entity.

**Player position and movement**
- `enter_cell`, `leave_cell` (Wolf3D tile triggers, Duke touchplates)
- `enter_region`, `leave_region`
- `walk_over_line` for any wall edge or cell boundary marked as a line trigger (Doom "W" lines)
- `stand_in_region` with a minimum dwell time

**Player action**
- `use` on a wall, switch, door, or entity (Doom "S" and "use" lines, Duke switches)
- `shoot` on a wall, switch, or entity (Doom gun-activated lines)
- `pickup_item` by item type or tag
- `use_item` (key used on a lock, inventory item used)

**Entity lifecycle**
- `entity_spawned`, `entity_killed` by type, tag, or specific id
- `all_dead` for a tag or region (clear the room)
- `count_killed` reaching N for a type or tag
- `entity_alerted` (a guard noticed the player)
- `entity_damaged` below a health threshold (boss phases)

**World**
- `mover_finished` (opened, closed, reached top, reached bottom) by tag
- `light_state_changed`
- `explosion_in_region`
- `timer_fired` for a declared timer
- `flag_changed`, `counter_reached` for a declared variable

**Level**
- `level_start`, `level_end_requested`
- `player_died`, `player_respawned`

**Multiplayer**
- `player_joined`, `player_left`, `score_reached`, `match_time_remaining`

Trigger options. Fire mode `once`, `repeat`, or `repeat_with_cooldown`. Edge-fired by default (fires on entering the condition, not every tick it holds). `who` filter: player, enemy, any, specific tag.

## 5. Conditions

All conditions on an event must be true (AND). Use separate events with different conditions for OR. Keeping conditions to AND makes validation and the editor simple.

- Flag is true or false; counter compare (equal, less, greater)
- Player has item, key color, weapon, minimum ammo, minimum or maximum health or armor
- Entities alive in tag or region compare to N
- Mover is in state (door open, door closed, lift at top)
- Skill level, game mode (single, coop, deathmatch)
- Random chance, as a percentage rolled from the level's seeded RNG
- Time since level start or since a timer compare
- Activator is player, is enemy, has tag

## 6. Actions

Actions run in order inside one event. Each action has typed parameters validated at load time and again at execution time.

### 6.1 Movers and world geometry
- Doors: `open_door`, `close_door`, `toggle_door`, `lock_door`, `unlock_door`, `set_door_key` (none, red, blue, yellow, or custom), `set_door_speed`, `set_door_wait` (open, wait N, close)
- Push walls: `slide_wall` (direction, distance in cells, speed), the Wolf3D secret passage
- Lifts and platforms: `raise_floor`, `lower_floor`, `raise_ceiling`, `lower_ceiling`, `toggle_lift`, `move_along_track` (Shadow Warrior style tracks), with speed and blocked behavior
- Crushers: `start_crusher`, `stop_crusher`, with damage and blocked behavior
- Stair builders: `build_stairs` (step count, height, speed), raising a sequence of cells in order
- Conveyor and scroll: `scroll_texture`, `set_conveyor` (push entities along a direction)
- Cell edits: `set_cell` type, `set_wall_texture`, `set_floor_texture`, `set_ceiling_texture`, `swap_texture_set` for a tag
- Secrets: `mark_secret_found` for secret counters

Mover blocked behavior is an option on every mover. Choices are `reverse`, `wait`, `crush_damage`, and `ignore` (Doom door versus crusher semantics).

### 6.2 Lights and atmosphere
- `set_light` on a region (level 0 to max), `light_effect` (flicker, strobe, pulse, random), `stop_light_effect`
- `set_fog`, `set_sky`, `palette_flash` (damage red, pickup yellow), `fade_screen` (to black, from black, to color)
- `earthquake` (duration, strength) on the whole view or a region
- `set_ambient_sound_zone`

### 6.3 Entities and enemies
- `spawn_entity` (blueprint, cell, facing), `spawn_wave` (a declared list with per-wave caps), `remove_entity`
- `wake_entities` for a tag (monster closet release, break ambush state), `set_ambush` on or off
- `set_ai_state` (idle, patrol, chase, flee, hold position), `set_patrol_route`
- `damage_entity`, `heal_entity`, `set_entity_flag`
- `move_entity` to a cell, `teleport_entity` with optional telefrag rule
- `set_entity_tag`, `set_entity_team`
- Boss helpers: `set_boss_phase`, `set_invulnerable`

### 6.4 Player
- `give_item` (health, armor, ammo, weapon, key, inventory), `take_item`
- `damage_player`, `heal_player` (the activator, or all players)
- `teleport_player` to a cell or tag with facing
- `lock_player_controls` and `unlock_player_controls` for a bounded duration
- `set_weapon`, `show_pickup_message`

### 6.5 Flow control
- `set_flag`, `toggle_flag`, `set_counter`, `add_counter`
- `start_timer`, `stop_timer`, `delay` (run following actions after N ms)
- `enable_event`, `disable_event`, `trigger_event` (chain), `reset_event_once`
- `random_branch` (pick one of several action lists with weights)
- `if_then_else` with one level of nesting maximum, using the same condition types as section 5
- `repeat_n` with a small cap, for effects like multiple spawns with spacing

### 6.6 Presentation
- `show_message` (author text, shown as plain text), `show_objective`
- `play_sound` (at a cell or global), `play_music`, `stop_music`
- `show_intermission_text`, `fade_screen`

### 6.7 Level flow
- `exit_level`, `exit_secret_level`, `end_game`
- `set_level_stat` (par time, kill target, secret target)
- `carry_over` options (keep inventory, reset inventory, as Wolf3D and Duke)

### 6.8 Multiplayer
- `award_score`, `set_team_score`, `respawn_player`, `set_respawn_point`, `end_match`

## 7. Engine behavior

### 7.1 Simulation and ordering
- Fixed timestep simulation (for example 30 Hz). Rendering interpolates. Events never read wall-clock time.
- Per tick order: input, movers update, entity AI, collect fired triggers, evaluate conditions in ascending event id, queue actions, execute queued actions, emit mover and entity lifecycle events for the next tick.
- A single seeded RNG per level. Same seed and same inputs produce the same outcomes, which makes multiplayer, demo recording, and tests possible.
- Events fired in a tick execute in id order. Chained events run next tick, not recursively.

### 7.2 Budgets (starting values, adjust after profiling)

| Limit | Value | Reason |
|---|---|---|
| Events per level | 512 | Bounds load and editor cost |
| Conditions per event | 8 | Readable, bounded |
| Actions per event | 16 | Readable, bounded |
| Chain depth per original trigger | 8 | Stops runaway cycles |
| Actions executed per tick | 64 | Hard frame budget |
| Spawns per second | 4 | Stops amplification |
| Live entities | 128 | Render and AI budget |
| Active movers | 64 | Simulation budget |
| Flags | 256 | Registry size |
| Counters | 64 | Registry size |
| Timers | 64 | Registry size |
| Counter range | -1,000,000 to 1,000,000 | Prevents overflow tricks |
| Message length | 120 characters | HUD sink and layout |
| Messages per second | 2 | HUD flooding |

When a budget is hit, the engine drops the excess action, writes one line to the event log, and continues. It never loops and never blocks the frame.

### 7.3 Edge firing and cooldowns
A trigger fires when its condition becomes true, not while it stays true. Repeating triggers also respect a per-event cooldown. Region triggers fire per entity entering, not per tick inside.

### 7.4 Save, load, and state sync
Runtime state to serialize: flags, counters, timers, which `once` events have fired, mover positions and states, event enabled state, RNG state, entity list. The same serialization feeds save games, level transitions with carry-over, and multiplayer join snapshots.

## 8. Validation

Run at editor save, at export, and at load. The same validator runs in all three places.

- Every event, trigger, condition, and action matches its schema; unknown types and unknown fields are rejected.
- Every referenced tag, region, flag, counter, timer, sound, blueprint, texture, and item exists.
- Coordinates are integers inside the grid. Amounts are finite and clamped to the allowed range.
- Static cycle check. Build a graph from `trigger_event`, `enable_event`, and `mover_finished` links; report cycles that have no delay or no `once` guard as errors.
- Reachability warnings. Warn on events whose trigger can never fire, doors with a key that does not exist in the level, and exits that no path reaches.
- Budget checks against the limits in section 7.2.

## 9. Editor experience

The author builds events in a panel next to the map view.

- **Event list** with name, trigger summary, and an enabled toggle. Select an event to highlight its trigger cells and target tags on the map, with lines drawn from trigger to targets (Doom editor style).
- **Event form** with three blocks (When, Only if, Then) and dropdowns populated from the level's registries. No free-form text fields except message text.
- **Link tool.** Click a switch or trigger cell, then click a door or region, and the editor creates or assigns a tag and an event for you.
- **Tag and region manager.** Paint regions, name them, list their members.
- **Variable registry panel** for flags, counters, and timers.
- **Presets** (section 10) that expand into a prefilled event.
- **Test play with event log.** A live panel showing each event as it fires, which conditions passed, and which actions ran or were dropped for budget reasons. Include a step button and a "set flag" debug control.
- **Validation panel** listing errors and warnings from section 8, click to jump to the cause.

## 10. Presets for classic mechanics

Each preset creates the tags, regions, and events a veteran mapper would expect.

| Preset | Classic origin | Built from |
|---|---|---|
| Key door (red, blue, yellow) | Doom, Duke, Wolf3D | `use` trigger, `has_item` condition, `open_door` |
| Secret push wall | Wolf3D | `use` trigger, `slide_wall`, `mark_secret_found` |
| Switch toggles door | Doom | `use` on wall, `toggle_door` on tag |
| Walk-over door trap | Doom | `enter_region`, `close_door`, `spawn_wave` |
| Monster closet | Doom | Hidden cells, `enter_region`, `open_door` or `slide_wall`, `wake_entities` |
| Teleporter pair | Doom, Duke | `enter_cell`, `teleport_player`, `play_sound`, `palette_flash` |
| Lock-in arena | Doom, Duke | `enter_region`, `close_door` all, `spawn_wave`, `all_dead`, `open_door` |
| Elevator | Duke | `use` or `enter_region`, `toggle_lift`, `mover_finished` |
| Crusher hallway | Doom, SW | Timer, `start_crusher`, `crush_damage` |
| Keycard bank | Duke | Several `use` switches, counter, `counter_reached`, `open_door` |
| Alarm | Duke | `entity_alerted`, `light_effect`, `play_sound`, `spawn_wave` |
| Earthquake and collapse | Duke | `enter_region`, `earthquake`, `slide_wall`, `set_cell` |
| Boss arena | Doom, Duke | `enter_region`, `set_boss_phase`, `entity_damaged` thresholds, `exit_level` |
| Timed escape | Duke | `start_timer`, `show_objective`, `timer_fired`, `damage_player` or `end_game` |
| Secret area counter | All | `mark_secret_found`, stat display at exit |

## 11. Multiplayer rules

- The server evaluates events. Clients send inputs (move, use, shoot) and receive validated results (door states, spawned entities, flag changes). A client never reports that a trigger fired.
- The event state in section 7.4 is the join snapshot.
- Events have `modes` and `skill` filters. Coop and deathmatch can use different event sets from the same map.
- `activator` identifies which player fired a trigger, so per-player and global effects are explicit (`heal_player: activator` versus `all`).
- Switch and door state conflicts (two players use the same switch the same tick) resolve by event id order and tick order on the server.
- Rate limits on `use` and `shoot` come from the netcode layer and apply before triggers are evaluated.
- Message and sound actions are rate-limited per player to avoid spamming the HUD.

## 12. Security alignment

This plan follows `web-security-3d-engine.md`, section "Event / Trigger System". The points that matter during implementation.

- Event data goes through the project schema validator before anything else reads it.
- Every action is applied through the same command layer that any other game logic uses, with the same bounds checks.
- `show_message` and any author string reach the DOM through `textContent` only.
- Flag, counter, timer, and tag names come from a registry; they are never used as object property names on host objects.
- Budgets in section 7.2 are enforced in the executor, not only in the editor.
- No action type accepts a URL, HTML, or code. Asset references are ids from the project's asset registry.
- Tests assert rejection of malformed events, unknown types, out-of-range values, cycles, and budget overflow (section 13).

## 13. Implementation phases

Each phase ends with something playable and a test suite.

**Phase 0. Foundations**
- Fixed timestep loop, seeded RNG, serialization of runtime state, event log.
- Schema and validator skeleton with the first three action types.
- Done when: a hand-written event file loads, validates, and rejects a malformed copy.

**Phase 1. Wolfenstein parity**
- Triggers: `enter_cell`, `use`, `level_start`. Actions: `open_door`, `close_door`, `slide_wall`, `give_item`, `show_message`, `play_sound`, `exit_level`, `mark_secret_found`.
- Movers for doors and push walls, with blocked behavior.
- Key doors, secret counter, patrol and ambush flags on enemies.
- Done when: a Wolf3D-style level with keys, a secret push wall, and an exit works start to finish.

**Phase 2. Doom parity**
- Tags and regions. Triggers: `enter_region`, `shoot`, `all_dead`, `entity_killed`, `mover_finished`. Actions: lifts, floors, ceilings, crushers, stairs, light effects, `spawn_wave`, `wake_entities`, `teleport_player`, flags and counters.
- Once and repeat fire modes, cooldowns, edge firing.
- Done when: a monster closet, a lock-in arena, a lift, a teleporter pair, and a crusher hallway all work from presets.

**Phase 3. Build-engine parity**
- Effector-style entities (sound emitters, earthquake, random lights), activators with lock and unlock, touchplates, multi-switch banks, `move_along_track`, water or damage regions, `random_branch`, `if_then_else`.
- Done when: an elevator ride, a keycard bank, and an earthquake collapse work from presets.

**Phase 4. Editor and validation**
- Link tool, event form, tag and region manager, variable registry, presets, test-play log, validation panel with cycle and reachability checks.
- Done when: a new author builds a Phase 2 level without opening JSON.

**Phase 5. Multiplayer**
- Server-side evaluation, join snapshots, mode and skill filters, activator semantics, rate limits.
- Done when: two clients play a coop level with a lock-in arena, and a late joiner sees the correct state.

**Phase 6. Optional extensions**
- Cutscene sequences, camera shots, boss phase library, procedural `repeat_n` effects.
- `run_script` action (Lua or similar) only after the security rules for the script VM in the skill file are implemented and tested.

## 14. Test plan

Unit tests
- Schema accepts every valid example and rejects each invalid one (unknown action, extra field, NaN, out-of-range coordinate, missing tag).
- Budget tests. An event with 20 actions, a chain of 12 events, 10,000 spawn requests in one tick, a doubling flag loop. Each ends in dropped actions and a log line, never a hang.
- Cycle detection catches A to B to A with no delay and passes the same cycle with a `once` guard.
- Determinism. Same seed and same input sequence produce identical state after N ticks, compared by hashing serialized state.

Behavior tests per preset (section 10)
- Key door stays closed without the key and opens with it.
- Push wall slides the right distance and counts a secret once.
- Lock-in arena closes, spawns, and reopens only after all enemies in the region are dead.
- Crusher damages, reverses, or waits according to its blocked option.
- Teleporter keeps momentum rules consistent and does not retrigger on arrival.

Security tests (from the skill file)
- Message text containing markup renders as text.
- Event data containing `__proto__` or `constructor` keys is rejected.
- A flag named like a host property does not touch the host object.
- A client message claiming a trigger fired is ignored and logged.

Multiplayer tests
- Late joiner state matches server state after a lock-in arena begins.
- Two players use the same switch in one tick; the result is deterministic.

## 15. Open decisions

1. Grid only, or allow sloped and varying floor and ceiling heights per cell (needed for Doom-style lifts and stairs to look right). This changes the renderer and the mover system.
2. How many classic sector-effect types to include at v1 versus later (water, damage floors, conveyors, wind).
3. Whether tags are integers (classic), names (friendlier), or both. Recommendation is names in the editor stored as integers.
4. Whether authors can define new variables in events or must declare them first. Recommendation is declare first, for the registry and the validator.
5. How to present "AND only" conditions to authors who expect OR.
6. Sound and music asset limits (count, duration, bytes) for the export pipeline.
7. Whether exports include the event debugger (recommended off in release builds).

## 16. Guidance for the coding agent

When implementing from this plan.
- Build the validator and the executor before the editor. The editor is a front end over the same schema.
- Add one action type at a time with its schema, its executor, its test, and its preset use.
- Keep the executor free of editor imports so the dedicated server can run it unchanged.
- Never read wall-clock time or `Math.random` inside event execution; use the tick counter and the level RNG.
- When a limit is hit, drop and log; do not throw.
- If a requested feature needs author code, stop and ask for a decision; do not add `eval`, `Function`, or a script runner.
