/**
 * What the pinned asset library promises about each file (release plan P2.7): its SHA-256, size
 * and pack. The editor records every library file here when it loads the library index, and the
 * exporter checks each library file it downloads against it, so a changed or tampered file stops
 * the export instead of shipping.
 */

export interface LibraryFileRecord {
  sha256: string;
  size: number;
  /** The asset's path in the library, for messages */
  path: string;
  pack: { title: string; author: string; license: string; source: string };
}

const byUrl = new Map<string, LibraryFileRecord>();

export function recordLibraryFile(url: string, record: LibraryFileRecord): void {
  byUrl.set(url, record);
}

export function libraryFileRecord(url: string): LibraryFileRecord | undefined {
  return byUrl.get(url);
}

export class LibraryIntegrityError extends Error {
  constructor(record: LibraryFileRecord) {
    super(
      `Integrity check failed for '${record.path}': the downloaded file does not match the asset library's published SHA-256, so the export stopped. Check your connection and try again.`
    );
    this.name = 'LibraryIntegrityError';
  }
}
