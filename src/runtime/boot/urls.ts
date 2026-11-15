/**
 * Every file an exported game loads is its own, named by a path relative to the page
 * (release plan P3.1). Resolving against `document.baseURI` lets the same files play at a
 * site root, in a subfolder, or behind `index.html`. Absolute paths and other origins are
 * refused, so a game never reaches outside its folder.
 */

/** The manifest path from `<meta name="gcs:manifest" content="...">`, or null */
export function readManifestPath(doc: Pick<Document, 'querySelector'>): string | null {
  const content = doc.querySelector('meta[name="gcs:manifest"]')?.getAttribute('content');
  return content && content.trim() ? content.trim() : null;
}

/** Resolves one of the game's own relative paths against the page; throws for anything else */
export function resolveGameUrl(path: string, baseURI: string): string {
  if (
    !path ||
    /^[a-z][a-z0-9+.-]*:/i.test(path) || // a scheme: http:, data:, javascript:
    path.startsWith('/') ||
    path.startsWith('\\') ||
    path.split('/').includes('..')
  ) {
    throw new Error(`'${path}' is not a path inside the game's folder.`);
  }
  return new URL(path, baseURI).href;
}
