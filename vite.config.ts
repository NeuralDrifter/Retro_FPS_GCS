import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import {defineConfig, type Plugin} from 'vite';
import {watchRuntime} from './scripts/runtimeBundle';

/** While `npm run dev` runs, rebuilds the exported games' runtime when its sources change (P3.2) */
function runtimeWatcher(): Plugin {
  let stop: (() => Promise<void>) | null = null;
  return {
    name: 'gcs-runtime-watch',
    apply: 'serve',
    async configureServer(server) {
      stop = await watchRuntime(server.config.root, (manifest) =>
        server.config.logger.info(`runtime rebuilt: public/runtime/${manifest.entry.file}`)
      );
      server.httpServer?.once('close', () => void stop?.());
    },
  };
}

/**
 * three's DRACOLoader points at its own copies of the Draco decoder through
 * `new URL('../libs/draco/...', import.meta.url)`, so Vite would emit five more decoder files.
 * The editor and every game always call `setDecoderPath`, so those defaults are never used: the
 * editor loads the runtime's copy in `runtime/draco/` (P3.6). This blanks them so the build emits
 * each Draco file once, and fails if a three upgrade changes that code.
 */
function noDefaultDracoUrls(): Plugin {
  const DRACO_LOADER = /[\\/]three[\\/]examples[\\/]jsm[\\/]loaders[\\/]DRACOLoader\.js$/;
  const DEFAULT_URL = /new URL\(\s*'\.\.\/libs\/draco\/[^']+',\s*import\.meta\.url\s*\)\.toString\(\)/g;
  return {
    name: 'gcs-no-default-draco-urls',
    enforce: 'pre',
    transform(code, id) {
      if (!DRACO_LOADER.test(id.split('?')[0])) return null;
      const count = code.match(DEFAULT_URL)?.length ?? 0;
      if (count !== 5) this.error(`DRACOLoader has ${count} default decoder URLs, expected 5; check vite.config.ts after a three upgrade`);
      return { code: code.replace(DEFAULT_URL, "''"), map: null };
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), runtimeWatcher(), noDefaultDracoUrls()],
});
