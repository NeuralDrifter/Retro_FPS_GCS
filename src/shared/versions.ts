/**
 * Versions an exported game carries (release plan P3.1). The editor writes RUNTIME_VERSION into
 * each game manifest; the runtime refuses a manifest whose schema is newer than it knows, or
 * whose runtime major version differs from its own. P3.2 defines the runtime version at build
 * time from package.json; this constant is the fallback for unbuilt code (tests, the editor).
 */

declare const __GCS_RUNTIME_VERSION__: string | undefined;

export const RUNTIME_VERSION: string =
  typeof __GCS_RUNTIME_VERSION__ === 'string' ? __GCS_RUNTIME_VERSION__ : '0.1.0';

/** Major version of a semantic version string, or NaN when it is not one */
export function majorVersion(version: string): number {
  const match = /^(\d+)\.\d+\.\d+(?:[-+].*)?$/.exec(version);
  return match ? Number(match[1]) : Number.NaN;
}
