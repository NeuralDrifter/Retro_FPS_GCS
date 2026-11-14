import { afterEach, beforeEach, describe, it, vi } from 'vitest';
import assert from 'node:assert/strict';
import { createAutosaver, pickRecoverable } from '../editor/persistence/autosave';
import { embedUploadedTextures, texturesFromUserAssets, usedTextureIds } from '../editor/persistence/projectAssets';
import { createInitialProject } from '../editor/store/useEditorDocument';
import { sha256Hex } from '../shared/bytes';
import { validateProjectV4 } from '../shared/project';
import type { TextureAsset } from '../runtime';

describe('autosave schedule (P2.5)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const setup = () => {
    let saves = 0;
    const autosaver = createAutosaver({
      save: async () => {
        saves++;
      },
      now: () => Date.now(),
    });
    return { autosaver, saves: () => saves };
  };

  it('saves 5 s after the last change', async () => {
    const { autosaver, saves } = setup();
    autosaver.changed();
    await vi.advanceTimersByTimeAsync(4_900);
    assert.equal(saves(), 0);
    await vi.advanceTimersByTimeAsync(200);
    assert.equal(saves(), 1);
    assert.equal(autosaver.isDirty(), false);
  });

  it('saves at least every 30 s while changes keep coming', async () => {
    const { autosaver, saves } = setup();
    for (let t = 0; t < 31; t++) {
      autosaver.changed();
      await vi.advanceTimersByTimeAsync(1_000);
    }
    assert.equal(saves(), 1, 'one save inside the first 31 s of nonstop editing');
  });

  it('flushes at once, and does nothing when nothing changed', async () => {
    const { autosaver, saves } = setup();
    await autosaver.flush();
    assert.equal(saves(), 0);
    autosaver.changed();
    await autosaver.flush();
    assert.equal(saves(), 1);
    await vi.advanceTimersByTimeAsync(10_000);
    assert.equal(saves(), 1, 'the pending timer does not save again');
  });

  it('forgets pending changes when marked clean', async () => {
    const { autosaver, saves } = setup();
    autosaver.changed();
    autosaver.markClean();
    await vi.advanceTimersByTimeAsync(10_000);
    assert.equal(saves(), 0);
  });
});

describe('recovery choice (P2.5)', () => {
  const autosave = (projectId: string, savedAt: number) => ({ projectId, title: projectId, savedAt });

  it('offers the newest autosave newer than its saved project', () => {
    const picked = pickRecoverable(
      [autosave('a', 100), autosave('a', 300), autosave('b', 200)],
      [{ id: 'a', savedAt: 50 }]
    );
    assert.equal(picked?.projectId, 'a');
    assert.equal(picked?.savedAt, 300);
  });

  it('offers nothing when every autosave is older than a save', () => {
    assert.equal(pickRecoverable([autosave('a', 100)], [{ id: 'a', savedAt: 100 }]), null);
    assert.equal(pickRecoverable([], []), null);
  });

  it('offers autosaves of projects that were never saved', () => {
    assert.equal(pickRecoverable([autosave('new', 10)], [])?.projectId, 'new');
  });
});

describe('uploaded textures travel with the project (P2.5)', () => {
  // A 1x1 PNG
  const PNG_BASE64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const upload = (id: string): TextureAsset => ({
    id,
    name: 'My Bricks',
    sourceType: 'file',
    previewUrl: `data:image/png;base64,${PNG_BASE64}`,
    recommendedSurface: 'wall',
  });

  it('embeds the uploaded textures the project uses, and only those', () => {
    const doc = createInitialProject();
    const level = doc.levels[0];
    const walls = level.data.wallTextures.map((row) => [...row]);
    walls[1][1] = 'tex-0123456789abcdef';
    doc.levels = [{ ...level, data: { ...level.data, wallTextures: walls } }];
    assert.ok(usedTextureIds(doc).has('tex-0123456789abcdef'));

    const catalog = [upload('tex-0123456789abcdef'), upload('tex-unused00000000'), { ...upload('tex-library0000000'), fromProject: true }];
    const saved = embedUploadedTextures(doc, catalog);
    assert.deepEqual(
      saved.userAssets.map((a) => a.id),
      ['tex-0123456789abcdef']
    );
    const bytes = Uint8Array.from(Buffer.from(PNG_BASE64, 'base64'));
    assert.equal(saved.userAssets[0].sha256, sha256Hex(bytes));
    assert.equal(saved.userAssets[0].size, bytes.length);
    const result = validateProjectV4(saved);
    assert.equal(result.valid, true, JSON.stringify(result.valid ? [] : result.errors.slice(0, 3)));

    const back = texturesFromUserAssets(saved);
    assert.equal(back[0].previewUrl, upload('x').previewUrl);
    assert.equal(embedUploadedTextures(saved, catalog), saved, 'nothing new to embed');
  });
});
