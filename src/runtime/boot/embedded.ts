/**
 * Files a single-HTML game carries inside its page (release plan P3.9): each one is a
 * `<script type="application/octet-stream" data-gcs-file="<path>">` holding base64, which the
 * browser never runs. The runtime reads them instead of fetching, so the game makes no request
 * and plays when opened from disk.
 */
import { base64ToBytes } from '../../shared/bytes';
import { EMBEDDED_FILE_ATTRIBUTE } from '../../shared/project/gameManifest';

export interface EmbeddedFiles {
  /** The bytes of the file at `path` (relative to the page); throws when the page lacks it */
  read(path: string): Uint8Array;
}

/** The page's embedded files, or null for a page that has none (a zip's index.html) */
export function readEmbeddedFiles(doc: Document): EmbeddedFiles | null {
  const elements = new Map<string, Element>();
  for (const el of doc.querySelectorAll(`script[${EMBEDDED_FILE_ATTRIBUTE}]`)) {
    const path = el.getAttribute(EMBEDDED_FILE_ATTRIBUTE);
    if (path) elements.set(path, el);
  }
  if (elements.size === 0) return null;
  return {
    read(path) {
      const el = elements.get(path);
      if (!el) throw new Error(`the page has no file '${path}'`);
      const bytes = base64ToBytes((el.textContent ?? '').replace(/\s+/g, ''));
      if (!bytes) throw new Error(`the page's copy of '${path}' is damaged`);
      return bytes;
    },
  };
}

/** `url` relative to the folder of the page at `baseURI` */
export function pagePath(url: string, baseURI: string): string {
  const base = new URL('.', baseURI).href;
  return url.startsWith(base) ? url.slice(base.length) : url;
}
