import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { canonicalStringify, createBlankLevelV3, createDefaultGameData, createDefaultProject } from '../shared/project';
import type { ProjectDocV4 } from '../shared/project';
import { HISTORY_LIMIT, createDocumentStore } from '../editor/store/documentStore';
import { mapAllEntities } from '../editor/store/useEditorDocument';
import { reduceDocument } from '../editor/store/documentActions';
import type { DocumentAction, DocumentActionType } from '../editor/store/documentActions';
import type { LevelLayerV3 } from '../sim';

const project = (): ProjectDocV4 =>
  createDefaultProject({ id: 'store-test', title: 'Store Test', now: '2026-11-14T10:00:00Z', editorVersion: '0.1.0' });

/** One example of every action type; the Record type makes the compiler demand a new entry for each new type */
function exampleActions(doc: ProjectDocV4): Record<DocumentActionType, DocumentAction> {
  const levelId = doc.levels[0].id;
  const second = { id: 'level-2', title: 'Second', data: createBlankLevelV3(12, 'Second') };
  return {
    'meta/update': { type: 'meta/update', patch: { title: 'Renamed Game', description: 'New text' } },
    'level/add': { type: 'level/add', level: second },
    'level/remove': { type: 'level/remove', levelId: 'level-2' },
    'level/move': { type: 'level/move', levelId: 'level-2', toIndex: 0 },
    'level/rename': { type: 'level/rename', levelId, title: 'Entrance' },
    'level/setData': { type: 'level/setData', levelId, data: createBlankLevelV3(20, 'Bigger'), title: 'Bigger' },
    'cells/set': { type: 'cells/set', levelId, changes: [{ row: 3, col: 3, cell: 1, wall: 'techbase-panel' }] },
    'cellTags/set': { type: 'cellTags/set', levelId, changes: [{ row: 2, col: 2, tag: 7 }] },
    'spawn/set': { type: 'spawn/set', levelId, spawn: { row: 4, col: 5, yawBam: 16384 } },
    'entity/add': { type: 'entity/add', levelId, entity: { id: 'e1', row: 5, col: 5, blueprintId: 'supply-crate' } },
    'entity/update': { type: 'entity/update', levelId, entityId: 'e1', patch: { row: 6 } },
    'entity/set': { type: 'entity/set', levelId, entity: { id: 'e1', row: 7, col: 2, blueprintId: 'sentinel-bot' } },
    'entity/remove': { type: 'entity/remove', levelId, entityId: 'e1' },
    'events/set': {
      type: 'events/set',
      levelId,
      events: [{ id: 'ev1', name: 'Hello', enabled: true, trigger: { type: 'level_start' }, conditions: [], actions: [{ type: 'show_message', text: 'Hi' }] }],
    },
    'regions/set': { type: 'regions/set', levelId, regions: [{ id: 'r1', name: 'Hall', cells: [{ row: 2, col: 2 }] }] },
    'variables/set': { type: 'variables/set', levelId, variables: { flags: { door: false }, counters: { kills: 0 }, timers: [] } },
    'world/update': { type: 'world/update', levelId, patch: { minimapEnabled: false, skybox: { theme: 'crimson-dusk', seed: 9, showCeiling: false } } },
    'vertical/set': {
      type: 'vertical/set',
      levelId,
      vertical: { floorHeights: Array.from({ length: 16 }, () => new Array<number>(16).fill(0)) },
    },
    'campaign/update': { type: 'campaign/update', patch: { carryOverAmmo: false } },
    'gameData/set': { type: 'gameData/set', gameData: { ...createDefaultGameData(), player: { maxHealth: 150, startAmmo: 20, maxAmmo: 80 } } },
    'userAsset/add': {
      type: 'userAsset/add',
      asset: { id: 'tex-a', name: 'A', mimeType: 'image/png', sha256: 'b'.repeat(64), size: 3, license: 'own-work' },
    },
    'userAsset/remove': { type: 'userAsset/remove', assetId: 'tex-a' },
    'export/setSlug': { type: 'export/setSlug', slug: 'store-test-2' },
    'export/setFormat': { type: 'export/setFormat', format: 'single-html' },
    batch: {
      type: 'batch',
      actions: [
        { type: 'level/rename', levelId, title: 'Batched' },
        { type: 'cells/set', levelId, changes: [{ row: 4, col: 4, cell: 2 }] },
      ],
    },
    'multiplayer/set': {
      type: 'multiplayer/set',
      multiplayer: {
        enabled: true,
        mode: 'deathmatch',
        maxPlayers: 6,
        serverUrl: 'wss://example.org/game',
        allowedOrigins: [],
        allowSinglePlayer: true,
        coop: { friendlyFire: false, respawnSeconds: 5 },
        deathmatch: { fragLimit: 15, timeLimitMinutes: 8, respawnSeconds: 3 },
      },
    },
  };
}

/** Some actions only change something after another (removing what was added, moving a second level) */
const PREREQUISITES: Partial<Record<DocumentActionType, DocumentActionType[]>> = {
  'level/remove': ['level/add'],
  'level/move': ['level/add'],
  'entity/update': ['entity/add'],
  'entity/set': ['entity/add'],
  'entity/remove': ['entity/add'],
  'userAsset/remove': ['userAsset/add'],
};

describe('document store and undo (P2.3)', () => {
  it('applies, undoes and redoes every action type exactly', () => {
    const examples = exampleActions(project());
    for (const type of Object.keys(examples) as DocumentActionType[]) {
      const store = createDocumentStore(project());
      for (const pre of PREREQUISITES[type] ?? []) store.dispatch(examples[pre]);
      const before = canonicalStringify(store.getState().doc);
      store.dispatch(examples[type]);
      const after = canonicalStringify(store.getState().doc);
      assert.notEqual(after, before, `${type} changes the document`);
      assert.equal(store.undo(), true);
      assert.equal(canonicalStringify(store.getState().doc), before, `${type} undo`);
      assert.equal(store.redo(), true);
      assert.equal(canonicalStringify(store.getState().doc), after, `${type} redo`);
    }
  });

  it('never mutates the document it was given', () => {
    const doc = project();
    const frozen = canonicalStringify(doc);
    const examples = exampleActions(doc);
    let current = doc;
    for (const action of Object.values(examples)) current = reduceDocument(current, action);
    assert.equal(canonicalStringify(doc), frozen);
  });

  it('records nothing for edits that change nothing', () => {
    const store = createDocumentStore(project());
    store.dispatch({ type: 'cells/set', levelId: 'level-1', changes: [{ row: 0, col: 0, cell: 1 }] });
    assert.equal(store.getState().past.length, 0);
  });

  it('merges one drag stroke into one undo step', () => {
    const store = createDocumentStore(project());
    const before = canonicalStringify(store.getState().doc);
    for (let col = 2; col < 10; col++) {
      store.dispatch({ type: 'cells/set', levelId: 'level-1', changes: [{ row: 5, col, cell: 1 }], stroke: 's1' }, 'Paint');
    }
    assert.equal(store.getState().past.length, 1);
    store.undo();
    assert.equal(canonicalStringify(store.getState().doc), before);
  });

  it(`keeps at most ${HISTORY_LIMIT} steps`, () => {
    const store = createDocumentStore(project());
    for (let i = 0; i < HISTORY_LIMIT + 50; i++) {
      store.dispatch({ type: 'meta/update', patch: { description: `edit ${i}` } });
    }
    assert.equal(store.getState().past.length, HISTORY_LIMIT);
  });

  it('200 paint strokes on a 128x128 level with 8 layers keep history under 50 MB', () => {
    const size = 128;
    const doc = project();
    const level = createBlankLevelV3(size, 'Big');
    const filled = <T,>(v: T) => Array.from({ length: size }, () => new Array<T>(size).fill(v));
    const layer = (): LevelLayerV3 => ({
      grid: filled(0),
      wallTextures: filled('default-grid'),
      floorTextures: filled('floor-obsidian'),
      ceilingTextures: filled('ceiling-coffer'),
      floorHeights: filled(0),
      ceilingHeights: filled(4000),
    });
    level.floorHeights = filled(0);
    level.ceilingHeights = filled(4000);
    level.layers = Array.from({ length: 7 }, layer); // ground + 7 = 8 layers
    doc.levels = [{ id: 'big', title: 'Big', data: level }];
    const store = createDocumentStore(doc);

    let seed = 1;
    const rand = (n: number) => {
      seed = (seed * 1103515245 + 12345) >>> 0;
      return seed % n;
    };
    for (let stroke = 0; stroke < 200; stroke++) {
      const layerIndex = rand(8);
      const row = 1 + rand(size - 10);
      for (let step = 0; step < 6; step++) {
        store.dispatch(
          {
            type: 'cells/set',
            levelId: 'big',
            layer: layerIndex,
            changes: [{ row: row + rand(4), col: 1 + rand(size - 2), cell: 1, wall: `paint-${stroke}` }],
            stroke: `s${stroke}`,
          },
          'Paint'
        );
      }
    }
    const state = store.getState();
    assert.equal(state.past.length, 200);

    // Count every distinct row array the history and the current document keep alive
    const rows = new Set<unknown[]>();
    const addMatrix = (m?: unknown[][]) => m?.forEach((row) => rows.add(row));
    for (const d of [state.doc, ...state.past.map((s) => s.doc)]) {
      for (const lvl of d.levels) {
        const data = lvl.data;
        for (const m of [data.grid, data.wallTextures, data.floorTextures, data.ceilingTextures, data.floorHeights, data.ceilingHeights, data.cellTags]) addMatrix(m);
        for (const l of data.layers ?? []) {
          for (const m of [l.grid, l.wallTextures, l.floorTextures, l.ceilingTextures, l.floorHeights, l.ceilingHeights]) addMatrix(m);
        }
      }
    }
    let cells = 0;
    for (const row of rows) cells += row.length;
    const bytes = cells * 8; // one pointer or number per cell
    const fullCopy = 8 * 6 * size * size * 8; // 8 layers x 6 matrices x cells x 8 bytes
    assert.ok(bytes < 50 * 1024 * 1024, `history retains ${(bytes / 1024 / 1024).toFixed(1)} MB`);
    assert.ok(bytes < fullCopy * 3, `rows are shared: ${(bytes / 1024 / 1024).toFixed(1)} MB vs ${((fullCopy * 200) / 1024 / 1024).toFixed(0)} MB copied`);
  });

  it('joins dispatches with the same stroke option into one step, whatever their type', () => {
    const store = createDocumentStore(project());
    store.dispatch({ type: 'cells/set', levelId: 'level-1', changes: [{ row: 4, col: 4, cell: 1 }] }, 'Spawn tool', { stroke: 'k' });
    store.dispatch({ type: 'spawn/set', levelId: 'level-1', spawn: { row: 4, col: 4, yawBam: 0 } }, 'Spawn tool', { stroke: 'k' });
    assert.equal(store.getState().past.length, 1);
    assert.equal(store.getState().past[0].label, 'Spawn tool');
  });

  it('applies edits made with record: false without an undo step, keeping redo', () => {
    const store = createDocumentStore(project());
    store.dispatch({ type: 'entity/add', levelId: 'level-1', entity: { id: 'ent-1', row: 5, col: 5, blueprintId: 'supply-crate' } });
    store.dispatch({ type: 'meta/update', patch: { description: 'x' } });
    store.undo();
    store.dispatch(
      { type: 'entity/set', levelId: 'level-1', entity: { id: 'ent-1', row: 5, col: 5, blueprintId: 'supply-crate', modelTopUnits: 900, modelBottomUnits: 0 } },
      'Measure',
      { record: false }
    );
    const state = store.getState();
    assert.equal(state.past.length, 1);
    assert.equal(state.future.length, 1);
    assert.equal(state.doc.levels[0].data.entities[0].modelTopUnits, 900);
  });

  it('keeps the entity id counter past every added id', () => {
    const store = createDocumentStore(project());
    store.dispatch({ type: 'entity/add', levelId: 'level-1', entity: { id: 'ent-41', row: 5, col: 5, blueprintId: 'supply-crate' } });
    assert.equal(store.getState().doc.levels[0].data.nextEntityId, 42);
  });

  it('removes fields that world and vertical edits set to undefined, and ignores repeats', () => {
    const store = createDocumentStore(project());
    store.dispatch({ type: 'world/update', levelId: 'level-1', patch: { classicMovement: true } });
    assert.equal(store.getState().doc.levels[0].data.classicMovement, true);
    store.dispatch({ type: 'world/update', levelId: 'level-1', patch: { classicMovement: true } });
    assert.equal(store.getState().past.length, 1, 'a repeated setting adds no step');
    store.dispatch({ type: 'world/update', levelId: 'level-1', patch: { classicMovement: undefined } });
    assert.equal('classicMovement' in store.getState().doc.levels[0].data, false);
  });

  it('rewrites the document and every history step with rewriteAll', () => {
    const store = createDocumentStore(project());
    const crate = (id: string) => ({ id, row: 5, col: 5, blueprintId: 'custom-glb' as const, modelAssetId: 'model-x' });
    store.dispatch({ type: 'entity/add', levelId: 'level-1', entity: crate('ent-1') });
    store.dispatch({ type: 'entity/add', levelId: 'level-1', entity: crate('ent-2') });
    store.undo();
    store.rewriteAll((d) => mapAllEntities(d, (list) => list.filter((e) => e.modelAssetId !== 'model-x')));
    const state = store.getState();
    for (const d of [state.doc, ...state.past.map((p) => p.doc), ...state.future.map((f) => f.doc)]) {
      assert.equal(d.levels[0].data.entities.length, 0);
    }
  });
});
