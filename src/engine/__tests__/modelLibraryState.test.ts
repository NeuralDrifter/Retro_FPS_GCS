import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Model3DAsset, PlacedEntity } from '../../types/engine';
import {
  createEmptyLibraryState,
  createFolder,
  deleteFolder,
  ensureFolderPath,
  filterModels,
  getFolderCategory,
  mergeDiscoveredFolders,
  moveModelToFolder,
  renameFolder,
  resolveModelFolder,
  resolveModelSettings,
  setModelSettings,
  setModelTags,
} from '../modelLibrary/libraryState';
import { groupPlacementsIntoVariants } from '../modelLibrary/variants';
import {
  entitiesFittingGrid,
  findPlacementConflicts,
  getEntitiesCoveringCell,
} from '../modelLibrary/placement';
import { parseModelDiskPath } from '../modelLibrary/diskPaths';
import {
  LIBRARY_STORAGE_KEY,
  exportLibraryJson,
  importLibraryJson,
  loadLibraryState,
  saveLibraryState,
} from '../modelLibrary/libraryStorage';
import {
  deleteUploadedModel,
  getAllUploadedModels,
  putUploadedModel,
  uploadedModelId,
} from '../modelLibrary/uploadStore';

function asset(id: string, extra: Partial<Model3DAsset> = {}): Model3DAsset {
  return {
    id,
    blueprintId: 'custom-glb',
    name: id,
    sourceType: 'file',
    isEnemy: false,
    defaultHealth: 0,
    moveSpeed: 0,
    attackDamage: 0,
    accentHex: '#38bdf8',
    badgeText: 'GLB',
    ...extra,
  };
}

function placed(id: string, extra: Partial<PlacedEntity> = {}): PlacedEntity {
  return {
    id,
    row: 1,
    col: 1,
    blueprintId: 'custom-glb',
    modelAssetId: 'glb-tree',
    name: 'Tree',
    yaw: 0,
    scale: 1,
    category: 'decorations',
    collision: 'solid',
    footprintW: 1,
    footprintD: 1,
    ...extra,
  };
}

describe('Model library state, filtering & variants', () => {
  it('createEmptyLibraryState has the five category folders', () => {
    const s = createEmptyLibraryState();
    assert.deepEqual(
      s.folders.map((f) => [f.id, f.categoryId, f.parentId]),
      [
        ['cat:characters', 'characters', null],
        ['cat:decorations', 'decorations', null],
        ['cat:items', 'items', null],
        ['cat:buildings', 'buildings', null],
        ['cat:vehicles', 'vehicles', null],
      ]
    );
  });

  it('createFolder and renameFolder trim names and refuse empty names and built-ins', () => {
    const { state, folderId } = createFolder(createEmptyLibraryState(), '  Trees ', 'cat:decorations');
    assert.equal(state.folders.find((f) => f.id === folderId)?.name, 'Trees');
    assert.throws(() => createFolder(state, '   ', null));
    assert.throws(() => renameFolder(state, 'cat:items', 'Loot'));
    assert.equal(
      renameFolder(state, folderId, 'Oaks').folders.find((f) => f.id === folderId)?.name,
      'Oaks'
    );
  });

  it('deleteFolder moves nested folders and models to the parent and refuses built-ins', () => {
    let s = createEmptyLibraryState();
    const a = createFolder(s, 'Town', 'cat:buildings');
    const b = createFolder(a.state, 'Shops', a.folderId);
    s = moveModelToFolder(b.state, 'glb-a', a.folderId);
    s = moveModelToFolder(s, 'glb-b', b.folderId);
    s = deleteFolder(s, a.folderId);
    assert.equal(s.folders.some((f) => f.id === a.folderId), false);
    assert.equal(s.folders.find((f) => f.id === b.folderId)?.parentId, 'cat:buildings');
    assert.equal(s.modelFolder['glb-a'], 'cat:buildings');
    assert.equal(s.modelFolder['glb-b'], b.folderId);
    assert.throws(() => deleteFolder(s, 'cat:vehicles'));

    const root = createFolder(s, 'Misc', null);
    const afterRoot = deleteFolder(moveModelToFolder(root.state, 'glb-c', root.folderId), root.folderId);
    assert.equal(afterRoot.modelFolder['glb-c'], 'cat:decorations');
  });

  it('ensureFolderPath reuses existing segments', () => {
    const first = ensureFolderPath(createEmptyLibraryState(), 'cat:vehicles', 'cars/sports');
    const second = ensureFolderPath(first.state, 'cat:vehicles', 'cars/sports');
    assert.equal(second.folderId, first.folderId);
    assert.equal(second.state.folders.length, first.state.folders.length);
    assert.equal(first.state.folders.length, 7);
  });

  it('setModelTags trims and dedupes case-insensitively', () => {
    const s = setModelTags(createEmptyLibraryState(), 'glb-tree', [' Tree', 'tree', '', 'Oak']);
    assert.deepEqual(s.modelTags['glb-tree'], ['Tree', 'Oak']);
  });

  it('getFolderCategory follows ancestors and falls back to decorations', () => {
    const a = createFolder(createEmptyLibraryState(), 'Cars', 'cat:vehicles');
    const b = createFolder(a.state, 'Sports', a.folderId);
    const root = createFolder(b.state, 'Misc', null);
    assert.equal(getFolderCategory(root.state, b.folderId), 'vehicles');
    assert.equal(getFolderCategory(root.state, root.folderId), 'decorations');
  });

  it('moveModelToFolder into a custom folder under Buildings sets category buildings', () => {
    const a = createFolder(createEmptyLibraryState(), 'Houses', 'cat:buildings');
    const s = moveModelToFolder(a.state, 'glb-house', a.folderId);
    assert.equal(s.modelSettings['glb-house']?.category, 'buildings');
    assert.equal(resolveModelFolder(s, asset('glb-house')), a.folderId);
  });

  it('resolveModelFolder falls back to the asset category, then the legacy category', () => {
    const s = createEmptyLibraryState();
    assert.equal(resolveModelFolder(s, asset('glb-car', { category: 'vehicles' })), 'cat:vehicles');
    assert.equal(resolveModelFolder(s, asset('glb-bot', { isEnemy: true })), 'cat:characters');
  });

  it('resolveModelSettings layers category defaults, asset values and stored overrides', () => {
    const car = asset('glb-car', { category: 'vehicles', measuredFootprint: { w: 3, d: 2 } });
    const base = resolveModelSettings(createEmptyLibraryState(), car);
    assert.equal(base.category, 'vehicles');
    assert.equal(base.collision, 'solid');
    assert.equal(base.footprintW, 3);
    assert.equal(base.footprintD, 2);

    const overridden = resolveModelSettings(
      setModelSettings(createEmptyLibraryState(), 'glb-car', {
        collision: 'nonSolid',
        footprintW: 5,
        footprintD: 1,
        footprintOverride: true,
      }),
      car
    );
    assert.equal(overridden.collision, 'nonSolid');
    assert.equal(overridden.footprintW, 5);
    assert.equal(overridden.footprintD, 1);

    const plain = resolveModelSettings(createEmptyLibraryState(), asset('glb-lamp', { category: 'decorations' }));
    assert.equal(plain.collision, 'nonSolid');
    assert.equal(plain.footprintW, 1);
    assert.equal(plain.footprintD, 1);
  });

  it('filterModels combines folder subtree, search, AND tags and used-in-level', () => {
    const cars = createFolder(createEmptyLibraryState(), 'Cars', 'cat:vehicles');
    let s = moveModelToFolder(cars.state, 'glb-truck', cars.folderId);
    s = setModelTags(s, 'glb-truck', ['red', 'big']);
    s = setModelTags(s, 'glb-van', ['red']);
    const assets = [
      asset('glb-truck', { name: 'Fire Truck', category: 'vehicles' }),
      asset('glb-van', { name: 'Delivery Van', category: 'vehicles' }),
      asset('glb-tree', { name: 'Oak Tree', category: 'decorations' }),
    ];
    const ids = (f: Parameters<typeof filterModels>[2]) => filterModels(assets, s, f).map((a) => a.id);
    const all = { folderId: null, search: '', tags: [], usedModelIds: null };
    assert.deepEqual(ids({ ...all, folderId: 'cat:vehicles' }), ['glb-truck', 'glb-van']);
    assert.deepEqual(ids({ ...all, folderId: cars.folderId }), ['glb-truck']);
    assert.deepEqual(ids({ ...all, search: 'TREE' }), ['glb-tree']);
    assert.deepEqual(ids({ ...all, search: 'big' }), ['glb-truck']);
    assert.deepEqual(ids({ ...all, tags: ['red', 'big'] }), ['glb-truck']);
    assert.deepEqual(ids({ ...all, usedModelIds: new Set(['glb-van']) }), ['glb-van']);
  });

  it('groupPlacementsIntoVariants counts identical placements and splits differing ones', () => {
    const variants = groupPlacementsIntoVariants([
      placed('ent-1'),
      placed('ent-2', { row: 4, col: 6, yaw: 1.2 }),
      placed('ent-3', { row: 7, col: 2 }),
      placed('ent-4', { yaw: 3 }),
      placed('ent-5', { collision: 'nonSolid' }),
    ]);
    assert.deepEqual(
      variants.map((v) => [v.count, v.settings.collision, v.sampleEntityId]),
      [
        [4, 'solid', 'ent-1'],
        [1, 'nonSolid', 'ent-5'],
      ]
    );
  });

  it('parseModelDiskPath classifies category folders, custom folders and legacy root files', () => {
    const p = (rel: string) => parseModelDiskPath(`/src/assets/models/${rel}`);
    assert.deepEqual(p('vehicles/cars/truck.glb'), { category: 'vehicles', folderPath: 'cars', atRoot: false });
    assert.deepEqual(p('buildings/house.glb'), { category: 'buildings', folderPath: null, atRoot: false });
    assert.deepEqual(p('props/lamps/lamp.glb'), { category: 'decorations', folderPath: 'props/lamps', atRoot: true });
    assert.deepEqual(p('decorations/props/lamp.glb'), { category: 'decorations', folderPath: 'props', atRoot: false });
    for (const file of ['prop_pillar.glb', 'crate_x.glb', 'static_x.glb', 'prop-x.glb']) {
      assert.deepEqual(p(file), { category: 'decorations', folderPath: null, atRoot: false }, file);
    }
    assert.deepEqual(p('zombie_guard.glb'), { category: 'characters', folderPath: null, atRoot: false });
  });

  it('loadLibraryState falls back to an empty library when storage throws, holds bad JSON or a wrong version', () => {
    const empty = createEmptyLibraryState();
    const storageReturning = (value: string | null) => ({ getItem: () => value });
    assert.deepEqual(loadLibraryState({ getItem: () => { throw new Error('SecurityError'); } }), empty);
    assert.deepEqual(loadLibraryState(storageReturning('{')), empty);
    assert.deepEqual(loadLibraryState(storageReturning('{"version":9}')), empty);
    assert.deepEqual(loadLibraryState(storageReturning(null)), empty);
    assert.deepEqual(loadLibraryState(null), empty);
  });

  it('saveLibraryState writes under the library key and returns false when setItem throws', () => {
    const written: Record<string, string> = {};
    const s = setModelTags(createEmptyLibraryState(), 'glb-tree', ['oak']);
    assert.equal(saveLibraryState({ setItem: (k, v) => { written[k] = v; } }, s), true);
    assert.deepEqual(loadLibraryState({ getItem: (k) => written[k] ?? null }), s);
    assert.ok(written[LIBRARY_STORAGE_KEY]);
    assert.equal(saveLibraryState({ setItem: () => { throw new Error('QuotaExceededError'); } }, s), false);
    assert.equal(saveLibraryState(null, s), false);
  });

  it('loadLibraryState restores missing built-in folders', () => {
    const s = createEmptyLibraryState();
    const stripped = { ...s, folders: s.folders.filter((f) => f.id !== 'cat:items') };
    const loaded = loadLibraryState({ getItem: () => JSON.stringify(stripped) });
    assert.ok(loaded.folders.some((f) => f.id === 'cat:items'));
  });

  it('export then import round-trips folders, tags and settings, and rejects other files', () => {
    let s = createFolder(createEmptyLibraryState(), 'Cars', 'cat:vehicles').state;
    s = setModelTags(s, 'glb-truck', ['red']);
    s = setModelSettings(s, 'glb-truck', { collision: 'nonSolid' });
    const json = exportLibraryJson(s, [{ id: 'glb-truck', name: 'Truck' }]);
    assert.deepEqual(JSON.parse(json).uploadedModels, [{ id: 'glb-truck', name: 'Truck' }]);
    assert.deepEqual(importLibraryJson(json), s);
    assert.throws(() => importLibraryJson('[]'), /Not a Pie3D library file/);
    assert.throws(() => importLibraryJson('not json'), /Not a Pie3D library file/);
  });

  it('the upload store degrades to no-ops when IndexedDB is unavailable', async () => {
    assert.equal(typeof indexedDB, 'undefined');
    assert.equal(
      await putUploadedModel({ id: 'glb-a', name: 'a.glb', blob: new Blob(['x']), meta: {} }),
      false
    );
    assert.deepEqual(await getAllUploadedModels(), []);
    assert.equal(await deleteUploadedModel('glb-a'), false);
  });

  it('uploadedModelId depends only on the file name and size, so it is stable across reloads', () => {
    const id = uploadedModelId('tower.glb', 2048);
    assert.match(id, /^glb-[0-9a-f]{16}$/);
    assert.equal(uploadedModelId('tower.glb', 2048), id);
    assert.notEqual(uploadedModelId('tower.glb', 2049), id);
  });

  it('mergeDiscoveredFolders files disk models into category or root folders without overriding user moves', () => {
    const assets = [
      asset('glb-truck', { category: 'vehicles', folderPath: 'cars' }),
      asset('glb-lamp', { category: 'decorations', folderPath: 'props/lamps', folderAtRoot: true }),
      asset('glb-moved', { category: 'buildings', folderPath: 'town' }),
      asset('glb-plain', { category: 'items' }),
    ];
    const start = moveModelToFolder(createEmptyLibraryState(), 'glb-moved', 'cat:vehicles');
    const s = mergeDiscoveredFolders(start, assets);
    const folder = (id: string) => s.folders.find((f) => f.id === s.modelFolder[id]);
    assert.equal(folder('glb-truck')?.name, 'cars');
    assert.equal(folder('glb-truck')?.parentId, 'cat:vehicles');
    const lamps = folder('glb-lamp');
    assert.equal(lamps?.name, 'lamps');
    const props = s.folders.find((f) => f.id === lamps?.parentId);
    assert.equal(props?.parentId, null);
    assert.equal(s.modelFolder['glb-moved'], 'cat:vehicles');
    assert.equal(s.modelFolder['glb-plain'], undefined);
    assert.deepEqual(mergeDiscoveredFolders(s, assets), s);
  });

  it('getEntitiesCoveringCell finds a 3x2 building from any covered cell', () => {
    const house = placed('ent-1', { row: 2, col: 3, footprintW: 3, footprintD: 2, category: 'buildings' });
    const lamp = placed('ent-2', { row: 3, col: 4 });
    const at = (r: number, c: number) => getEntitiesCoveringCell([house, lamp], r, c).map((e) => e.id);
    assert.deepEqual(at(2, 3), ['ent-1']);
    assert.deepEqual(at(3, 5), ['ent-1']);
    assert.deepEqual(at(3, 4), ['ent-1', 'ent-2']);
    assert.deepEqual(at(4, 3), []);
  });

  it('findPlacementConflicts reports walls, doors and other models, and the map edge', () => {
    const grid = Array.from({ length: 10 }, () => Array.from({ length: 10 }, () => 0));
    grid[2][4] = 1;
    grid[3][3] = 2;
    const tree = placed('ent-9', { row: 3, col: 5, name: 'Oak Tree' });
    const house = placed('ent-1', { row: 2, col: 3, footprintW: 3, footprintD: 2, name: 'House' });
    assert.deepEqual(findPlacementConflicts(grid, [tree], house), [
      'wall at [X:4, Z:2]',
      'door at [X:3, Z:3]',
      'overlaps Oak Tree',
    ]);
    assert.deepEqual(findPlacementConflicts(grid, [tree, house], house, 'ent-1'), [
      'wall at [X:4, Z:2]',
      'door at [X:3, Z:3]',
      'overlaps Oak Tree',
    ]);
    assert.deepEqual(
      findPlacementConflicts(grid, [], placed('ent-2', { row: 6, col: 8, footprintW: 3 })),
      ['off the map edge']
    );
    assert.deepEqual(findPlacementConflicts(grid, [], placed('ent-3', { row: 6, col: 6 })), []);
  });

  it('findPlacementConflicts refuses a rotation that leaves the map', () => {
    const grid = Array.from({ length: 10 }, () => Array.from({ length: 10 }, () => 0));
    const bench = placed('ent-1', { row: 8, col: 2, footprintW: 3, footprintD: 1 });
    assert.deepEqual(findPlacementConflicts(grid, [bench], bench, 'ent-1'), []);
    const rotated = { ...bench, yaw: Math.PI / 2 };
    assert.ok(findPlacementConflicts(grid, [bench], rotated, 'ent-1').includes('off the map edge'));
  });

  it('entitiesFittingGrid drops a model whose footprint crosses a shrunk edge', () => {
    const house = placed('ent-1', { row: 4, col: 8, footprintW: 3, footprintD: 2 });
    const lamp = placed('ent-2', { row: 9, col: 9 });
    const far = placed('ent-3', { row: 12, col: 1 });
    assert.deepEqual(entitiesFittingGrid([house, lamp, far], 10).map((e) => e.id), ['ent-2']);
  });
});
