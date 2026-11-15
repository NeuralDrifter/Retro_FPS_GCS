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

export default defineConfig({
  plugins: [react(), tailwindcss(), runtimeWatcher()],
});
