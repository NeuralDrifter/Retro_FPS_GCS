/**
 * Fails when any dependency's license is outside the S-03 allowlist (release plan P7.3).
 * Reads package-lock.json only, so it runs offline and checks exactly what `npm ci` installs.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { licenseViolations } from './licenseRules';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf-8'));
const violations = licenseViolations(lock);
const total = Object.keys(lock.packages ?? {}).length - 1;

if (violations.length > 0) {
  console.error(`License check failed: ${violations.length} of ${total} packages are outside the allowlist (scripts/licenseRules.ts):`);
  for (const v of violations) console.error(`  ${v}`);
  process.exit(1);
}
console.log(`Licenses OK: ${total} packages within the allowlist`);
