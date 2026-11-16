import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import {defineConfig, type Plugin} from 'vite';
import {DRACO_LOADER_FILE, blankDefaultDracoUrls} from './scripts/dracoDefaults';
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

/** Blanks DRACOLoader's unused default decoder URLs, so the build emits each Draco file once (P3.6) */
function noDefaultDracoUrls(): Plugin {
  return {
    name: 'gcs-no-default-draco-urls',
    enforce: 'pre',
    transform(code, id) {
      if (!DRACO_LOADER_FILE.test(id.split('?')[0])) return null;
      return { code: blankDefaultDracoUrls(code), map: null };
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), runtimeWatcher(), noDefaultDracoUrls()],
});
