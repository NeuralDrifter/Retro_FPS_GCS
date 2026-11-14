import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { MAP_PRESETS } from '../editor/types/engine';
import { LevelSerializer } from '../editor/engine/LevelSerializer';
import { createDocumentStore } from '../editor/store/documentStore';
import {
  buildRuntimeLevel,
  entityToStored,
  levelStateOf,
  levelView,
  spawnToStored,
  storedLevelFromState,
  verticalToStored,
} from '../editor/store/levelView';
import { DEFAULT_LOOK, createInitialProject, presetLevelData } from '../editor/store/useEditorDocument';
import { buildSaveState } from '../editor/hooks/useLevelPersistence';
import { createDefaultVerticalData, createSolidLayer } from '../runtime';
import { canonicalStringify, validateProjectV4 } from '../shared/project';

const firstLevel = () => createInitialProject().levels[0];

describe('editor level views over the project store (P2.4)', () => {
  it('opens with a valid project holding the first preset', () => {
    const doc = createInitialProject();
    const result = validateProjectV4(doc);
    assert.equal(result.valid, true, JSON.stringify(result.valid ? [] : result.errors.slice(0, 3)));
    assert.equal(doc.levels[0].title, MAP_PRESETS[0].name);
  });

  it('gives the runtime the same level the editor built before the store', () => {
    const preset = MAP_PRESETS[0];
    const size = preset.grid.length;
    const uniform = (id: string) => Array.from({ length: size }, () => new Array<string>(size).fill(id));
    // How App built the playtest level from its own state before P2.4
    const before = LevelSerializer.serializeLevelV3({
      title: preset.name,
      grid: preset.grid,
      wallTextures: uniform(preset.defaultWallTex || 'default-grid'),
      floorTextures: uniform('floor-obsidian'),
      ceilingTextures: uniform('ceiling-coffer'),
      entities: preset.entities ?? [],
      spawn: preset.spawn,
      skyboxTheme: 'retro-nebula',
      skyboxSeed: 1,
      showCeiling: false,
      minimapEnabled: true,
      cellTags: preset.cellTags,
      events: preset.events ?? [],
      regions: preset.regions ?? [],
      variables: preset.variables,
    });
    const after = buildRuntimeLevel(firstLevel());
    assert.equal(canonicalStringify(after), canonicalStringify({ ...before, nextEntityId: after.nextEntityId }));
  });

  it('keeps every preset unchanged through the editor save format and back', () => {
    for (const preset of MAP_PRESETS) {
      const data = presetLevelData(preset, DEFAULT_LOOK);
      const level = { id: 'level-1', title: preset.name, data };
      const again = storedLevelFromState(levelStateOf(level, []));
      assert.equal(canonicalStringify(again), canonicalStringify(data), preset.id);
    }
  });

  it('keeps view objects for parts of the level an edit did not touch', () => {
    const store = createDocumentStore(createInitialProject());
    const before = levelView(store.getState().doc.levels[0]);
    assert.equal(levelView(store.getState().doc.levels[0]), before, 'same level, same view');
    const flipped = before.grid[2][2] === 1 ? 0 : 1;
    store.dispatch({ type: 'cells/set', levelId: 'level-1', changes: [{ row: 2, col: 2, cell: flipped }] });
    const after = levelView(store.getState().doc.levels[0]);
    assert.notEqual(after.grid, before.grid);
    assert.equal(after.entities, before.entities);
    assert.equal(after.vertical, before.vertical);
    assert.equal(after.spawn, before.spawn);
    assert.equal(after.floorTextures, before.floorTextures);
  });

  it('round-trips editor entities, spawn and vertical data through the stored format', () => {
    const view = levelView(firstLevel());
    for (const entity of view.entities) {
      const stored = entityToStored(entity, view.gridSize);
      const back = levelView({ ...firstLevel(), data: { ...firstLevel().data, entities: [stored] } }).entities[0];
      assert.equal(canonicalStringify(entityToStored(back, view.gridSize)), canonicalStringify(stored), entity.id);
    }
    const spawn = spawnToStored({ row: 3, col: 4, yaw: Math.PI }, 2);
    assert.deepEqual(spawn, { row: 3, col: 4, yawBam: 32768, layer: 2 });

    const flat = createDefaultVerticalData(16);
    assert.deepEqual(verticalToStored(flat), { floorHeights: undefined, ceilingHeights: undefined, slopes: undefined, layers: undefined });
    const layered = { ...flat, layers: [createSolidLayer(16, { wall: 'a', floor: 'b', ceiling: 'c' })] };
    assert.equal(verticalToStored(layered).layers, layered.layers);
  });

  it('saves the whole campaign with cell tags in the editor save format', () => {
    const doc = createInitialProject();
    const tags = Array.from({ length: doc.levels[0].data.gridSize }, () => new Array<number>(doc.levels[0].data.gridSize).fill(0));
    tags[1][1] = 7;
    doc.levels = [
      { ...doc.levels[0], data: { ...doc.levels[0].data, cellTags: tags } },
      { id: 'level-2', title: 'Second', data: presetLevelData(MAP_PRESETS[1], DEFAULT_LOOK) },
    ];
    const save = buildSaveState(doc, 1, []);
    assert.equal(save.levels?.length, 2);
    assert.equal(save.activeLevelIndex, 1);
    assert.equal(save.title, 'Second');
    assert.equal(save.levels?.[0].cellTags?.[1][1], 7);
    const reopened = LevelSerializer.parseLevelJson(JSON.stringify(save));
    assert.equal(reopened.levels?.length, 2);
    assert.equal(storedLevelFromState(reopened.levels![0]).cellTags?.[1][1], 7);
  });
});
