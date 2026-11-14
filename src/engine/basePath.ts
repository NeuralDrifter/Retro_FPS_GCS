/**
 * The path the editor is served from: `/` locally, `/Retro_FPS_GCS/` on GitHub Pages.
 * Every editor fetch of a file in `public/` goes through these helpers so it works
 * under any base path.
 *
 * Falls back to `/` where Vite's `import.meta.env` does not exist (plain Node scripts).
 */
export function editorBaseUrl(): string {
  return import.meta.env?.BASE_URL ?? '/';
}

/**
 * Resolves a path to a file in `public/` against the editor's base path.
 * `assets/x.svg` and `/assets/x.svg` both mean `public/assets/x.svg`.
 * Full URLs (`https:`, `data:`, `blob:`) are returned unchanged.
 */
export function publicFileUrl(file: string): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(file)) return file;
  return `${editorBaseUrl()}${file.replace(/^\/+/, '')}`;
}
