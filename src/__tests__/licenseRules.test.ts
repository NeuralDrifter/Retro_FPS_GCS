import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { licenseAllowed, licenseViolations } from '../../scripts/licenseRules';

describe('dependency license allowlist (P7.3, S-03)', () => {
  it('reads simple SPDX expressions', () => {
    assert.equal(licenseAllowed('MIT', false), true);
    assert.equal(licenseAllowed('(MIT OR GPL-3.0-or-later)', false), true, 'one acceptable choice is enough');
    assert.equal(licenseAllowed('(MIT AND Zlib)', false), true);
    assert.equal(licenseAllowed('(MIT AND GPL-3.0-only)', false), false, 'every part of an AND must be allowed');
    assert.equal(licenseAllowed('GPL-3.0-only', true), false);
    assert.equal(licenseAllowed(undefined, false), false);
  });

  it('allows MPL-2.0 for build and test tools only', () => {
    assert.equal(licenseAllowed('MPL-2.0', true), true);
    assert.equal(licenseAllowed('MPL-2.0', false), false);
  });

  it('fails on a planted violation and passes on the real lockfile', () => {
    const lock = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package-lock.json'), 'utf-8'));
    assert.deepEqual(licenseViolations(lock), []);
    lock.packages['node_modules/planted-gpl'] = { version: '1.0.0', license: 'GPL-3.0-only' };
    lock.packages['node_modules/planted-mpl'] = { version: '1.0.0', license: 'MPL-2.0' };
    lock.packages['node_modules/planted-unlicensed'] = { version: '1.0.0' };
    assert.deepEqual(licenseViolations(lock), [
      'planted-gpl: GPL-3.0-only',
      'planted-mpl: MPL-2.0',
      'planted-unlicensed: no license recorded',
    ]);
  });
});
