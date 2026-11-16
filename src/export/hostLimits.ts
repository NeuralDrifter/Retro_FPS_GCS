/**
 * Limits of the hosts the export guide names (release plan P3.8). After an export the editor
 * warns about any limit the game passes, so a creator learns before the upload fails.
 *
 * Sizes are in decimal megabytes (1 MB = 1,000,000 bytes), the stricter reading of the hosts'
 * published numbers. Recheck them against the hosts' documentation before each release:
 * itch.io's HTML5 upload rules and GitHub's Pages limits.
 */

const MB = 1_000_000;

export interface HostLimit {
  host: string;
  /** Most files the unzipped game may have */
  maxFiles?: number;
  /** Largest single file */
  maxFileBytes?: number;
  /** Largest total of all files, unzipped */
  maxTotalBytes?: number;
}

export const HOST_LIMITS: readonly HostLimit[] = [
  { host: 'itch.io', maxFiles: 1000, maxFileBytes: 200 * MB, maxTotalBytes: 500 * MB },
  { host: 'GitHub Pages', maxFileBytes: 100 * MB, maxTotalBytes: 1000 * MB },
];

const mb = (bytes: number) => `${(bytes / MB).toFixed(bytes < 10 * MB ? 1 : 0)} MB`;

/** Above this, a single HTML file loads slowly and strains the browser (G-19) */
export const SINGLE_HTML_WARNING_BYTES = 50 * MB;

/** Every warning about an exported game: host limits, and the size of a single HTML file */
export function exportWarnings(result: { format: 'zip' | 'single-html'; size: number; files: readonly { path: string; size: number }[] }): string[] {
  const warnings = hostLimitWarnings(result.files);
  if (result.format === 'single-html' && result.size > SINGLE_HTML_WARNING_BYTES) {
    warnings.push(
      `The HTML file is ${mb(result.size)}. Files above ${mb(SINGLE_HTML_WARNING_BYTES)} load slowly and can run out of memory on phones; the web package (zip) format suits large games better.`
    );
  }
  return warnings;
}

/** One plain sentence per limit the game's files pass; empty when every host takes it */
export function hostLimitWarnings(files: readonly { path: string; size: number }[], limits: readonly HostLimit[] = HOST_LIMITS): string[] {
  const warnings: string[] = [];
  const total = files.reduce((sum, f) => sum + f.size, 0);
  const largest = files.reduce<{ path: string; size: number } | null>((max, f) => (!max || f.size > max.size ? f : max), null);
  for (const limit of limits) {
    if (limit.maxFiles !== undefined && files.length > limit.maxFiles) {
      warnings.push(`${limit.host} accepts at most ${limit.maxFiles} files; this game has ${files.length}.`);
    }
    if (limit.maxFileBytes !== undefined && largest && largest.size > limit.maxFileBytes) {
      const over = files.filter((f) => f.size > limit.maxFileBytes!).length;
      warnings.push(
        `${limit.host} accepts files up to ${mb(limit.maxFileBytes)}; ${largest.path} is ${mb(largest.size)}` +
          (over > 1 ? `, and ${over - 1} more ${over - 1 === 1 ? 'file is' : 'files are'} too large.` : '.')
      );
    }
    if (limit.maxTotalBytes !== undefined && total > limit.maxTotalBytes) {
      warnings.push(`${limit.host} accepts games up to ${mb(limit.maxTotalBytes)} in total; this one is ${mb(total)} unzipped.`);
    }
  }
  return warnings;
}
