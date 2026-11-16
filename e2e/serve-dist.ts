/**
 * Serves the Pages build (`dist/`, from `npm run build:pages`) under /Retro_FPS_GCS/ on port
 * 4173 for the e2e suite. It replaces `vite preview`, which loads the whole Vite toolchain (about
 * 220 MB) to serve static files; this server takes a fraction of that. Run with Node 24, which
 * strips the types: `node e2e/serve-dist.ts`.
 */
import path from 'node:path';
import { serveFolder } from './helpers/static-server.ts';

const PORT = 4173;
const BASE_PATH = '/Retro_FPS_GCS/';

const server = await serveFolder(path.resolve('dist'), BASE_PATH, { port: PORT });
console.log(`Serving dist/ at ${server.url}`);

const stop = () => void server.close().then(() => process.exit(0));
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
