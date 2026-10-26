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
  moveModelToFolder,
  renameFolder,
  resolveModelFolder,
  resolveModelSettings,
  setModelSettings,
  setModelTags,
} from '../modelLibrary/libraryState';
import { groupPlacementsIntoVariants } from '../modelLibrary/variants';

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
});
