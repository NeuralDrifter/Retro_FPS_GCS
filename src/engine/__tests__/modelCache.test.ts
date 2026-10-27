import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ModelCache, modelCacheKey } from '../../runtime/modelCache';

describe('Model cache & model sources', () => {
  it('loads each key once and shares the result', async () => {
    let loads = 0;
    const cache = new ModelCache<string>(() => {});
    const load = async () => `model-${++loads}`;
    assert.equal(await cache.get('a', load), 'model-1');
    assert.equal(await cache.get('a', load), 'model-1');
    assert.equal(loads, 1);
  });

  it('retainOnly disposes models the level no longer uses and keeps pinned ones', async () => {
    const disposed: string[] = [];
    const cache = new ModelCache<string>((m) => disposed.push(m));
    await cache.get('file:a', async () => 'A');
    await cache.get('file:b', async () => 'B');
    await cache.get('builtin:sentinel-bot', async () => 'S');
    cache.retainOnly(new Set(['file:a']), (key) => key.startsWith('builtin:'));
    await Promise.resolve();
    assert.deepEqual(disposed, ['B']);
    assert.equal(cache.has('file:b'), false);
    assert.equal(cache.has('file:a'), true);
    assert.equal(cache.has('builtin:sentinel-bot'), true);
  });

  it('a model evicted while still loading is disposed once it arrives', async () => {
    const disposed: string[] = [];
    const cache = new ModelCache<string>((m) => disposed.push(m));
    let finish: (v: string) => void = () => {};
    const pending = cache.get('file:a', () => new Promise((r) => (finish = r)));
    cache.retainOnly(new Set());
    finish('A');
    assert.equal(await pending, 'A');
    await Promise.resolve();
    assert.deepEqual(disposed, ['A']);
  });

  it('a failed load is forgotten so the next request tries again', async () => {
    const cache = new ModelCache<string>(() => {});
    await assert.rejects(cache.get('url:x', async () => Promise.reject(new Error('404'))));
    assert.equal(cache.has('url:x'), false);
    assert.equal(await cache.get('url:x', async () => 'X'), 'X');
  });

  it('modelCacheKey prefers a stored file, then a permanent URL, and ignores dead blob links', () => {
    const files = new Set(['glb-file']);
    const urls: Record<string, string> = { 'glb-url': 'https://x.test/car.glb' };
    const lookups = {
      hasFile: (id: string) => files.has(id),
      urlFor: (id: string) => urls[id],
    };
    assert.deepEqual(
      modelCacheKey({ blueprintId: 'custom-glb', modelAssetId: 'glb-file' }, lookups),
      { key: 'file:glb-file', fileId: 'glb-file' }
    );
    assert.deepEqual(
      modelCacheKey({ blueprintId: 'custom-glb', modelAssetId: 'glb-url' }, lookups),
      { key: 'url:https://x.test/car.glb', url: 'https://x.test/car.glb' }
    );
    assert.deepEqual(
      modelCacheKey(
        { blueprintId: 'custom-glb', modelAssetId: 'glb-gone', customGlbUrl: 'blob:http://x/1', category: 'characters' },
        lookups
      ),
      { key: 'builtin:sentinel-bot', builtinId: 'sentinel-bot', missing: true }
    );
    assert.deepEqual(modelCacheKey({ blueprintId: 'sentinel-bot' }, lookups), {
      key: 'builtin:sentinel-bot',
      builtinId: 'sentinel-bot',
    });
  });

  it('a missing non-character model stands in as the supply crate, a missing character as the robot', () => {
    const none = { hasFile: () => false, urlFor: () => undefined };
    assert.deepEqual(
      modelCacheKey({ blueprintId: 'custom-glb', modelAssetId: 'glb-gone', category: 'buildings' }, none),
      { key: 'builtin:supply-crate', builtinId: 'supply-crate', missing: true }
    );
    assert.deepEqual(
      modelCacheKey({ blueprintId: 'custom-glb', modelAssetId: 'glb-gone', isEnemy: false }, none),
      { key: 'builtin:supply-crate', builtinId: 'supply-crate', missing: true }
    );
    assert.deepEqual(
      modelCacheKey({ blueprintId: 'custom-glb', modelAssetId: 'glb-gone' }, none),
      { key: 'builtin:sentinel-bot', builtinId: 'sentinel-bot', missing: true }
    );
  });
});
