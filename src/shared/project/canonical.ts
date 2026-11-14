/**
 * Canonical JSON for project documents: keys sorted at every level, undefined fields dropped,
 * -0 written as 0, two-space indentation and a trailing newline. The same document always
 * serializes to the same bytes, so saved files diff cleanly and content hashes are stable.
 */
import { sortKeysDeep } from '../hash';

export function canonicalStringify(value: unknown): string {
  return `${JSON.stringify(sortKeysDeep(value), null, 2)}\n`;
}
