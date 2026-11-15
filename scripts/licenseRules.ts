/**
 * The dependency license allowlist (release plan S-03, P7.3). Licenses the editor and exported
 * games may ship, plus MPL-2.0 for build and test tools only.
 */

export const ALLOWED_LICENSES = new Set(['MIT', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0', '0BSD', 'Zlib']);
export const DEV_ONLY_LICENSES = new Set(['MPL-2.0']);

/**
 * True when an SPDX expression is acceptable: for `A OR B` one side must be, for `A AND B`
 * both. Parentheses are ignored, which is enough for the simple expressions npm records.
 */
export function licenseAllowed(expression: string | undefined, devOnly: boolean): boolean {
  if (!expression || !expression.trim()) return false;
  const allowed = (id: string) => ALLOWED_LICENSES.has(id) || (devOnly && DEV_ONLY_LICENSES.has(id));
  const flat = expression.replace(/[()]/g, ' ').trim();
  return flat
    .split(/\s+OR\s+/)
    .some((alternative) => alternative.split(/\s+AND\s+/).every((id) => allowed(id.trim())));
}

export interface LockPackage {
  license?: string;
  dev?: boolean;
  /** Set on packages only some tools need (a dev tool's optional binary is still dev) */
  devOptional?: boolean;
  link?: boolean;
}

/** Every package in a package-lock.json (v2 or v3) whose license is outside the allowlist */
export function licenseViolations(lock: { packages?: Record<string, LockPackage> }): string[] {
  const out: string[] = [];
  for (const [location, pkg] of Object.entries(lock.packages ?? {})) {
    if (location === '' || pkg.link) continue; // the project itself, or a workspace link
    const name = location.replace(/^.*node_modules\//, '');
    const devOnly = Boolean(pkg.dev || pkg.devOptional);
    if (!licenseAllowed(pkg.license, devOnly)) {
      out.push(`${name}: ${pkg.license ?? 'no license recorded'}${devOnly ? ' (dev)' : ''}`);
    }
  }
  return out.sort();
}
