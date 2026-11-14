import { it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { base64ToBytes, sha256Hex, utf8Bytes } from '../shared/bytes';
it('SHA-256, base64 and UTF-8 helpers match Node crypto and Buffer', () => {
  expect(sha256Hex(utf8Bytes(''))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  expect(sha256Hex(utf8Bytes('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  for (const n of [55, 56, 63, 64, 65, 1000, 100000]) {
    const bytes = new Uint8Array(n).map((_, i) => (i * 31 + 7) & 255);
    expect(sha256Hex(bytes)).toBe(createHash('sha256').update(bytes).digest('hex'));
    const b64 = Buffer.from(bytes).toString('base64');
    expect(Buffer.from(base64ToBytes(b64)!).equals(Buffer.from(bytes))).toBe(true);
  }
  expect(sha256Hex(utf8Bytes('héllo 🌍'))).toBe(createHash('sha256').update('héllo 🌍', 'utf8').digest('hex'));
  expect(base64ToBytes('@@@@')).toBeNull();
});
