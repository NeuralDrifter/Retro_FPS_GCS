import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { TextureAsset } from '../../types/engine';
import {
  buildTextureFolderTree,
  filterTextures,
  parseTextureDiskPath,
} from '../textureLibrary';
import {
  buildAssetsFromRepoPaths,
  buildGitHubRawUrl,
  parseGitHubRepoSpec,
} from '../gitHubAssets';
import { diskModelId } from '../modelLibrary/diskPaths';

function tex(id: string, extra: Partial<TextureAsset> = {}): TextureAsset {
  return { id, name: id, sourceType: 'file', previewUrl: `/${id}.webp`, recommendedSurface: 'any', ...extra };
}

describe('Texture library folders', () => {
  it('parseTextureDiskPath keeps root ids unchanged and adds the folder path to nested ids', () => {
    assert.deepEqual(parseTextureDiskPath('/src/assets/textures/dungeon_wall.png'), {
      id: 'folder-tex-dungeon-wall',
      name: 'Dungeon Wall',
      folderPath: null,
    });
    assert.deepEqual(parseTextureDiskPath('/src/assets/textures/Horror/Brick/Horror_Brick_01.webp'), {
      id: 'folder-tex-horror-brick-horror-brick-01',
      name: 'Horror Brick 01',
      folderPath: 'Horror/Brick',
    });
    assert.notEqual(
      parseTextureDiskPath('/src/assets/textures/Tiny Pack 1/Wood/Wood 1.webp').id,
      parseTextureDiskPath('/src/assets/textures/Tiny Pack 2/Wood/Wood 1.webp').id
    );
  });

  it('buildTextureFolderTree lists folders depth-first with counts that include subfolders', () => {
    const textures = [
      tex('a', { folderPath: 'Horror/Brick' }),
      tex('b', { folderPath: 'Horror/Brick' }),
      tex('c', { folderPath: 'Horror/Metal' }),
      tex('d', { folderPath: 'LAB/Doors' }),
      tex('e', { sourceType: 'procedural' }),
    ];
    assert.deepEqual(
      buildTextureFolderTree(textures).map((n) => [n.path, n.name, n.depth, n.count]),
      [
        ['Horror', 'Horror', 0, 3],
        ['Horror/Brick', 'Brick', 1, 2],
        ['Horror/Metal', 'Metal', 1, 1],
        ['LAB', 'LAB', 0, 1],
        ['LAB/Doors', 'Doors', 1, 1],
      ]
    );
  });

  it('filterTextures picks built-in, uploaded, a folder with its subfolders, and searches by name', () => {
    const textures = [
      tex('std', { sourceType: 'procedural' }),
      tex('up', { sourceType: 'url' }),
      tex('loose', { fromProject: true }),
      tex('brick', { fromProject: true, folderPath: 'Horror/Brick', name: 'Horror Brick 01' }),
      tex('metal', { fromProject: true, folderPath: 'Horror/Metal', name: 'Horror Metal 01' }),
      tex('horrorish', { fromProject: true, folderPath: 'Horrors', name: 'Other' }),
    ];
    const ids = (folder: string, search = '') => filterTextures(textures, folder, search).map((t) => t.id);
    assert.deepEqual(ids('all'), ['std', 'up', 'loose', 'brick', 'metal', 'horrorish']);
    assert.deepEqual(ids('builtin'), ['std']);
    assert.deepEqual(ids('uploaded'), ['up']);
    assert.deepEqual(ids('Horror'), ['brick', 'metal']);
    assert.deepEqual(ids('Horror/Brick'), ['brick']);
    assert.deepEqual(ids('all', 'metal'), ['metal']);
  });

  it('parseGitHubRepoSpec parses full GitHub URLs and owner/repo shorthands', () => {
    assert.deepEqual(
      parseGitHubRepoSpec('https://github.com/NeuralDrifter/Retro_FPS_GCS-assets'),
      { owner: 'NeuralDrifter', repo: 'Retro_FPS_GCS-assets', branch: 'main' }
    );
    assert.deepEqual(
      parseGitHubRepoSpec('https://github.com/NeuralDrifter/Retro_FPS_GCS-assets/tree/dev/'),
      { owner: 'NeuralDrifter', repo: 'Retro_FPS_GCS-assets', branch: 'dev' }
    );
    assert.deepEqual(
      parseGitHubRepoSpec('NeuralDrifter/Retro_FPS_GCS-assets@v1'),
      { owner: 'NeuralDrifter', repo: 'Retro_FPS_GCS-assets', branch: 'v1' }
    );
    assert.equal(parseGitHubRepoSpec('not-a-repo'), null);
  });

  it('buildAssetsFromRepoPaths matches /src/assets/ ids, folders, categories, and model-sizes.json', () => {
    const spec = { owner: 'NeuralDrifter', repo: 'Retro_FPS_GCS-assets', branch: 'main' };
    const built = buildAssetsFromRepoPaths({
      spec,
      paths: [
        'README.md',
        'textures/Floor Tiles/Checker Tiles/BW_Marble_Tile_01.webp',
        'models/model-sizes.json',
        'models/buildings/Town/1Story GableRoof.glb',
        'models/characters/Monsters/Glutton Demon.glb',
      ],
      modelSizes: {
        'buildings/Town/1Story GableRoof.glb': { width: 5.05, depth: 5.71 },
      },
    });

    assert.equal(built.textures.length, 1);
    assert.equal(
      built.textures[0].id,
      parseTextureDiskPath('/src/assets/textures/Floor Tiles/Checker Tiles/BW_Marble_Tile_01.webp').id
    );
    assert.equal(built.textures[0].folderPath, 'Floor Tiles/Checker Tiles');
    assert.equal(
      built.textures[0].previewUrl,
      buildGitHubRawUrl(spec, 'textures/Floor Tiles/Checker Tiles/BW_Marble_Tile_01.webp')
    );
    assert.match(built.textures[0].previewUrl, /Floor%20Tiles\/Checker%20Tiles/);

    assert.equal(built.models.length, 2);
    const house = built.models[0];
    assert.equal(house.id, diskModelId('/src/assets/models/buildings/Town/1Story GableRoof.glb'));
    assert.equal(house.category, 'buildings');
    assert.equal(house.folderPath, 'Town');
    assert.equal(house.isEnemy, false);
    assert.deepEqual(house.measuredSizeMeters, { width: 5.05, depth: 5.71 });

    const demon = built.models[1];
    assert.equal(demon.id, diskModelId('/src/assets/models/characters/Monsters/Glutton Demon.glb'));
    assert.equal(demon.category, 'characters');
    assert.equal(demon.folderPath, 'Monsters');
    assert.equal(demon.isEnemy, true);
  });

  it('TextureGenerator.resolveTextureById disposes placeholder storage and swaps Source when a 64x64 Lab texture loads', async () => {
    const THREE = await import('three');
    const { TextureGenerator } = await import('../../runtime/TextureGenerator');

    // Provide minimal document stub for placeholder canvas creation in Node test runner
    const prevDoc = (globalThis as any).document;
    (globalThis as any).document = {
      createElement: () => ({
        width: 256,
        height: 256,
        getContext: () => ({
          save: () => {},
          restore: () => {},
          scale: () => {},
          fillRect: () => {},
          strokeRect: () => {},
          clearRect: () => {},
          beginPath: () => {},
          moveTo: () => {},
          lineTo: () => {},
          stroke: () => {},
          arc: () => {},
          fill: () => {},
          clip: () => {},
          rect: () => {},
          fillText: () => {},
        }),
      }),
    };

    const origLoad = THREE.TextureLoader.prototype.load;
    let capturedOnLoad: ((t: any) => void) | undefined;
    THREE.TextureLoader.prototype.load = function (_url: string, onLoad?: (t: any) => void) {
      capturedOnLoad = onLoad;
      return new THREE.Texture();
    } as any;

    try {
      TextureGenerator.clearCache();
      const labAsset: TextureAsset = {
        id: 'folder-tex-lab-walls-tile106',
        name: 'Tile106',
        sourceType: 'file',
        previewUrl: 'https://raw.githubusercontent.com/NeuralDrifter/Retro_FPS_GCS-assets/main/textures/LAB/Walls/Tile106.png',
        recommendedSurface: 'any',
        fromProject: true,
        folderPath: 'LAB/Walls',
      };

      const resolvedTex = TextureGenerator.resolveTextureById(labAsset.id, [labAsset], 4);
      const placeholderSource = resolvedTex.source;
      assert.equal((resolvedTex.image as { width: number; height: number }).width, 256);
      assert.equal((resolvedTex.image as { width: number; height: number }).height, 256);

      let disposedCount = 0;
      resolvedTex.addEventListener('dispose', () => {
        disposedCount++;
      });

      // Simulate async completion of a 64x64 Lab tile image
      const loadedImage = { width: 64, height: 64, complete: true };
      const loadedTex = new THREE.Texture(loadedImage as any);
      assert.ok(capturedOnLoad, 'Expected TextureLoader.load callback to be registered');
      capturedOnLoad!(loadedTex);

      assert.equal(
        disposedCount,
        1,
        'Expected placeholder WebGLTexture allocation to be disposed before swapping Source'
      );
      assert.notEqual(
        resolvedTex.source,
        placeholderSource,
        'Expected Texture.source to be replaced so WebGL allocates 64x64 texStorage2D instead of texSubImage2D into 256x256'
      );
      assert.equal(resolvedTex.source, loadedTex.source);
      assert.equal((resolvedTex.image as { width: number; height: number }).width, 64);
      assert.equal((resolvedTex.image as { width: number; height: number }).height, 64);

      // Verify a late load after clearCache() is ignored and does not fire onAsyncLoad
      TextureGenerator.clearCache();
      let asyncCalled = 0;
      const staleTex = TextureGenerator.resolveTextureById(labAsset.id, [labAsset], 4, () => {
        asyncCalled++;
      });
      const stalePlaceholderSource = staleTex.source;
      TextureGenerator.clearCache(); // disposes staleTex and clears cache while load is in-flight

      capturedOnLoad!(new THREE.Texture(loadedImage as any));
      assert.equal(asyncCalled, 0, 'Expected onAsyncLoad not to fire for a cleared texture');
      assert.equal(staleTex.source, stalePlaceholderSource, 'Expected cleared texture Source not to be swapped');
    } finally {
      THREE.TextureLoader.prototype.load = origLoad;
      TextureGenerator.clearCache();
      (globalThis as any).document = prevDoc;
    }
  });
});


