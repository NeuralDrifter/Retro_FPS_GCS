import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  scanStringForSecrets,
  scanExportPayload,
  assertExportPayloadIsSafe,
} from '../export/safetyScanner';
import { exportSingleHtml } from '../export/singleHtmlExporter';
import { exportProjectZip } from '../export/projectExporter';
import { createMinimalArenaTestLevel } from './determinismFixtures';

describe('Phase 6 Acceptance: Export Safety Scanner & Credential Leak Prevention', () => {
  it('passes completely clean files without false positives', () => {
    const cleanFiles = {
      'index.html': '<html><head><title>My Game</title></head><body><h1>Play</h1></body></html>',
      'package.json': JSON.stringify({ name: 'my-game', dependencies: { three: '^0.186.0' } }),
      'manifest.json': JSON.stringify({ schemaVersion: 1, meta: { title: 'Level 1' } }),
    };

    const result = scanExportPayload(cleanFiles);
    assert.equal(result.safe, true);
    assert.equal(result.violations.length, 0);
    assert.doesNotThrow(() => assertExportPayloadIsSafe(cleanFiles));
  });

  it('detects and intercepts Google API Key (AIza...) patterns', () => {
    const fakeKey = 'AIzaSyA1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6';
    const violations = scanStringForSecrets(
      `const config = { key: "${fakeKey}" };`,
      'src/config.js'
    );

    assert.equal(violations.length, 1);
    assert.equal(violations[0].pattern, 'Google Cloud / AI Studio API Key (AIza...)');
    assert.equal(violations[0].file, 'src/config.js');
  });

  it('detects and intercepts generic apiKey and secret token assignments', () => {
    const code = 'const apiKey = "sec_live_9876543210abcdef";';
    const violations = scanStringForSecrets(code, 'src/main.js');
    assert.equal(violations.length, 1);
    assert.equal(violations[0].pattern, 'Hardcoded API Key / Secret Token Assignment');
  });

  it('detects and intercepts bearer sk- token patterns', () => {
    const code = 'const token = "sk-abcdef1234567890abcdef123456";';
    const violations = scanStringForSecrets(code, 'env.js');
    assert.equal(violations.length, 1);
    assert.equal(violations[0].pattern, 'Secret Key Token (sk-...)');
  });

  it('ACCEPTANCE: exportSingleHtml aborts and throws when an API key is injected into game metadata', async () => {
    const level = createMinimalArenaTestLevel();
    // Inject a fake API key into level title
    const compromisedLevel = {
      ...level,
      metadata: {
        ...level.metadata,
        title: 'Compromised AIzaSyA1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6 Level',
      },
    };

    await assert.rejects(
      async () => {
        await exportSingleHtml(compromisedLevel);
      },
      /Security Violation: Export aborted!/
    );
  });

  it('ACCEPTANCE: exportProjectZip aborts and throws when an API key is injected into game metadata', async () => {
    const level = createMinimalArenaTestLevel();
    const compromisedLevel = {
      ...level,
      metadata: {
        ...level.metadata,
        title: 'Secret Key AIzaSyA1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6 Level',
      },
    };

    await assert.rejects(
      async () => {
        await exportProjectZip(compromisedLevel);
      },
      /Security Violation: Export aborted!/
    );
  });
});
