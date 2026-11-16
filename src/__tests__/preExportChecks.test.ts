import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { IMPORTED_LICENSE_NOT_RECORDED, LICENSE_NOT_RECORDED, createDefaultProject } from '../shared/project';
import type { ProjectDocV4 } from '../shared/project';
import { SimCellType } from '../sim';
import type { ExportRequest } from '../export/exportGame';
import { checkBeforeExport } from '../editor/export/preExportChecks';

// Pre-export checks (release plan P3.4): problems stop the export before anything downloads

const SHA = 'a'.repeat(64);
const PACK = { title: 'Walls', author: 'Someone', license: 'CC0-1.0', source: 'https://example.test/walls' };

function project(): ProjectDocV4 {
  const doc = createDefaultProject({ id: 'checks', title: 'Checks', now: '2026-11-15T00:00:00Z', editorVersion: '0.1.0' });
  doc.levels[0].data.floorTextures[2][2] = 'tex-0123456789abcdef';
  doc.levels[0].data.wallTextures[0][0] = 'folder-tex-wall';
  doc.userAssets = [{ id: 'tex-0123456789abcdef', name: 'Floor', mimeType: 'image/png', sha256: SHA, size: 10, license: 'own-work' }];
  return doc;
}

function request(doc: ProjectDocV4): ExportRequest {
  return {
    doc,
    runtimeBaseUrl: 'https://editor.test/runtime/',
    sources: {
      'tex-0123456789abcdef': { type: 'user', name: 'Floor', mimeType: 'image/png', sha256: SHA, size: 10, base64: 'AAAA', license: 'own-work' },
      'folder-tex-wall': { type: 'library', url: 'https://library.test/files/0123456789abcdef.webp', sha256: SHA, size: 10, path: 'textures/wall.webp', pack: PACK },
    },
  };
}

describe('pre-export checks (P3.4)', () => {
  it('passes a project with a player start, licensed uploads and library assets', () => {
    const doc = project();
    assert.deepEqual(checkBeforeExport(doc, request(doc)), []);
  });

  it('refuses a player start in a wall or outside the map', () => {
    const doc = project();
    doc.levels[0].data.grid[1][1] = SimCellType.WALL;
    assert.match(checkBeforeExport(doc, request(doc))[0].message, /inside a wall/);
    doc.levels[0].data.spawn = { row: 99, col: 1, yawBam: 0 };
    assert.match(checkBeforeExport(doc, request(doc))[0].message, /no player start inside the map/);
  });

  it('refuses an upload whose license was never recorded', () => {
    const doc = project();
    doc.userAssets[0] = { ...doc.userAssets[0], license: 'other', attribution: LICENSE_NOT_RECORDED };
    const problems = checkBeforeExport(doc, request(doc));
    assert.equal(problems.length, 1);
    assert.equal(problems[0].where, 'Floor');
    assert.match(problems[0].message, /before the editor asked for a license/);
  });

  it('refuses missing files and assets from a repository without a license list', () => {
    const doc = project();
    const req = request(doc);
    delete req.sources['tex-0123456789abcdef'];
    req.sources['folder-tex-wall'] = { type: 'unlicensed', name: 'Wall', url: 'https://raw.githubusercontent.com/x/y/main/wall.png' };
    const messages = checkBeforeExport(doc, req).map((p) => p.message);
    assert.equal(messages.length, 2);
    assert.ok(messages.some((m) => /no file for this texture/.test(m)));
    assert.ok(messages.some((m) => /publishes no license list/.test(m)));
  });

  it('refuses an upload imported from a version 3 file, and a library file outside every pack (P3.5)', () => {
    const doc = project();
    doc.userAssets[0] = { ...doc.userAssets[0], license: 'other', attribution: IMPORTED_LICENSE_NOT_RECORDED };
    const req = request(doc);
    delete (req.sources['folder-tex-wall'] as { pack?: unknown }).pack;
    const problems = checkBeforeExport(doc, req);
    assert.equal(problems.length, 2);
    assert.match(problems.find((p) => p.where === 'Floor')!.message, /before the editor asked for a license/);
    assert.match(problems.find((p) => p.where === 'textures/wall.webp')!.message, /no pack in the asset library's license list/);
  });

  it('refuses an embedded texture with no license record (P3.5)', () => {
    const doc = project();
    doc.userAssets = [];
    const req = request(doc);
    delete (req.sources['tex-0123456789abcdef'] as { license?: unknown }).license;
    const problems = checkBeforeExport(doc, req);
    assert.equal(problems.length, 1);
    assert.match(problems[0].message, /no recorded license/);
  });
});
