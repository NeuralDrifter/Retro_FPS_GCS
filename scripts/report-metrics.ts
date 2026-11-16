/**
 * Prints the project's size, test and strictness metrics as a Markdown table.
 *
 *   npm run metrics              # everything (builds into a temp folder, runs the unit tests)
 *   npm run metrics -- --quick   # skip the build and the test run
 *
 * Measures the same things, the same way, as section 1.1 of docs/release-plan.md,
 * so results can be compared with the audit baseline in docs/metrics-baseline.md.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const quick = process.argv.includes('--quick');

/** Local tools, run through Node directly (no shell, so arguments are passed as-is). */
const TOOLS = {
  tsc: 'node_modules/typescript/bin/tsc',
  vite: 'node_modules/vite/bin/vite.js',
  vitest: 'node_modules/vitest/vitest.mjs',
} as const;

type Row = [measure: string, value: string];
const rows: Row[] = [];

function run(command: string, args: string[]): string {
  return execFileSync(command, args, { cwd: root, encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 });
}

/** Runs a local tool that may exit non-zero and returns its combined output. */
function runTool(tool: keyof typeof TOOLS, args: string[]): string {
  const result = spawnSync(process.execPath, [TOOLS[tool], ...args], {
    cwd: root,
    encoding: 'utf-8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return `${result.stdout ?? ''}${result.stderr ?? ''}`;
}

// kB = 1,000 bytes, the unit Vite's build output and the audit use
const kb = (bytes: number) => `${(bytes / 1000).toLocaleString('en-US', { maximumFractionDigits: 0 })} kB`;
const gzipSize = (file: string) => zlib.gzipSync(fs.readFileSync(file), { level: 9 }).length;
const sizePair = (file: string) => `${kb(fs.statSync(file).size)} (${kb(gzipSize(file))} gzip)`;
const countLines = (file: string) => fs.readFileSync(file, 'utf-8').split('\n').length - 1;

// --- Files and source lines ---------------------------------------------------------
const tracked = run('git', ['ls-files']).split('\n').filter(Boolean);
rows.push(['Tracked files', tracked.length.toLocaleString('en-US')]);

const isTest = (file: string) => file.includes('__tests__/') || /\.test\.tsx?$/.test(file);
const sourceFiles = tracked.filter((file) => file.startsWith('src/') && /\.tsx?$/.test(file));
const nonTest = sourceFiles.filter((file) => !isTest(file));
// "Runtime" means everything a game ships: src/runtime, src/sim and src/shared (src/runtime/sim before P1.2)
const isGameCode = (file: string) => /^src\/(runtime|sim|shared)\//.test(file);
const runtimeLines = nonTest.filter(isGameCode).reduce((sum, file) => sum + countLines(file), 0);
const totalLines = nonTest.reduce((sum, file) => sum + countLines(file), 0);
const testLines = sourceFiles.filter(isTest).reduce((sum, file) => sum + countLines(file), 0);
rows.push([
  'TypeScript source (non-test)',
  `${totalLines.toLocaleString('en-US')} lines: runtime, sim and HUD ${runtimeLines.toLocaleString('en-US')}; editor ${(totalLines - runtimeLines).toLocaleString('en-US')}`,
]);

const explicitAny = nonTest.reduce(
  (sum, file) => sum + (fs.readFileSync(file, 'utf-8').match(/(:\s*any\b|\bas any\b|<any>|any\[\])/g)?.length ?? 0),
  0
);
rows.push(['Explicit `any` (non-test)', String(explicitAny)]);

// --- Tests ----------------------------------------------------------------------------
if (!quick) {
  const reportFile = path.join(os.tmpdir(), `gcs-vitest-${process.pid}.json`);
  runTool('vitest', ['run', '--reporter=json', `--outputFile=${reportFile}`]);
  const report = JSON.parse(fs.readFileSync(reportFile, 'utf-8')) as {
    numTotalTests: number;
    numPassedTests: number;
    numFailedTests: number;
    testResults: { startTime: number; endTime: number }[];
  };
  fs.rmSync(reportFile, { force: true });
  const seconds =
    (Math.max(...report.testResults.map((r) => r.endTime)) - Math.min(...report.testResults.map((r) => r.startTime))) / 1000;
  rows.push([
    'Unit tests',
    `${report.numPassedTests} passing, ${report.numFailedTests} failing, in ${report.testResults.length} files, ${seconds.toFixed(1)} s; ${testLines.toLocaleString('en-US')} lines`,
  ]);
} else {
  rows.push(['Unit tests', `skipped (--quick); ${testLines.toLocaleString('en-US')} lines of tests`]);
}

// --- Strictness -------------------------------------------------------------------------
const tscErrors = (flags: string[]) => {
  const output = runTool('tsc', ['--noEmit', ...flags]);
  const errors = output.split('\n').filter((line) => /error TS\d+/.test(line));
  return `${errors.filter((line) => !isTest(line.replace(/\\/g, '/'))).length}`;
};
rows.push(['Typecheck errors', tscErrors([])]);
rows.push(['Errors with `noUncheckedIndexedAccess` (non-test)', tscErrors(['--noUncheckedIndexedAccess'])]);
rows.push(['Errors with `noUnusedLocals` and `noUnusedParameters` (non-test)', tscErrors(['--noUnusedLocals', '--noUnusedParameters'])]);
rows.push(['Errors with `exactOptionalPropertyTypes` (non-test)', tscErrors(['--exactOptionalPropertyTypes'])]);

// --- Build sizes ------------------------------------------------------------------------
if (!quick) {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gcs-metrics-build-'));
  const buildOutput = runTool('vite', ['build', '--base=/Retro_FPS_GCS/', `--outDir=${outDir}`, '--emptyOutDir', '--logLevel=error']);
  const assetsDir = path.join(outDir, 'assets');
  if (!fs.existsSync(assetsDir)) throw new Error(`Editor build failed:
${buildOutput}`);
  const assets = fs.readdirSync(assetsDir).map((name) => path.join(assetsDir, name));
  const bytes = (files: string[]) => files.reduce((sum, file) => sum + fs.statSync(file).size, 0);
  const gzipBytes = (files: string[]) => files.reduce((sum, file) => sum + gzipSize(file), 0);
  const hashed = (prefix: string, ext: string) =>
    assets.filter((file) => path.basename(file).startsWith(prefix) && file.endsWith(ext));
  const editorJs = hashed('index-', '.js');
  const dracoFiles = assets.filter((file) => path.basename(file).startsWith('draco_'));
  const otherJs = assets.filter((file) => file.endsWith('.js') && !editorJs.includes(file) && !dracoFiles.includes(file));
  rows.push(['Editor JS (main chunk)', `${editorJs.length} file(s), ${kb(bytes(editorJs))} (${kb(gzipBytes(editorJs))} gzip)`]);
  rows.push(['Editor CSS', kb(bytes(hashed('index-', '.css')))]);
  rows.push([
    'Draco decoder copies bundled by Vite',
    `${dracoFiles.length} files, ${kb(bytes(dracoFiles))}: ${dracoFiles.filter((f) => f.endsWith('.wasm')).length} .wasm, ${dracoFiles.filter((f) => f.endsWith('.js')).length} .js`,
  ]);
  rows.push(['Other JS chunks', `${otherJs.length} file(s), ${kb(bytes(otherJs))}`]);
  fs.rmSync(outDir, { recursive: true, force: true });
}
// The game runtime an export ships (P3.2): the ES module for zips, the classic script for single HTML files (P3.9)
const runtimeManifestPath = path.join(root, 'public/runtime/runtime-manifest.json');
if (fs.existsSync(runtimeManifestPath)) {
  const runtime = JSON.parse(fs.readFileSync(runtimeManifestPath, 'utf-8')) as { entry: { file: string }; classic: { file: string } };
  rows.push(['Game runtime (`public/runtime/game.*.js`)', sizePair(path.join(root, 'public/runtime', runtime.entry.file))]);
  rows.push(['Game runtime, classic script (`game-classic.*.js`)', sizePair(path.join(root, 'public/runtime', runtime.classic.file))]);
} else {
  rows.push(['Game runtime', 'not built; run `npm run build:runtime`']);
}

// --- Dependencies -----------------------------------------------------------------------
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8')) as {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};
const productionTree = new Set<string>();
const visit = (name: string, fromDir: string) => {
  // Resolve like Node: the nearest node_modules walking up from the dependent package
  let dir = fromDir;
  for (;;) {
    const candidate = path.join(dir, 'node_modules', name, 'package.json');
    if (fs.existsSync(candidate)) {
      const key = path.dirname(candidate);
      if (productionTree.has(key)) return;
      productionTree.add(key);
      const manifest = JSON.parse(fs.readFileSync(candidate, 'utf-8')) as {
        dependencies?: Record<string, string>;
        optionalDependencies?: Record<string, string>;
      };
      for (const dep of Object.keys({ ...manifest.dependencies, ...manifest.optionalDependencies })) visit(dep, key);
      return;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return;
    dir = parent;
  }
};
for (const name of Object.keys(pkg.dependencies ?? {})) visit(name, root);
rows.push([
  'Dependencies',
  `${Object.keys(pkg.dependencies ?? {}).length} direct production, ${Object.keys(pkg.devDependencies ?? {}).length} direct dev; production tree ${productionTree.size} packages`,
]);
rows.push(['Node', process.version]);

// --- Output -----------------------------------------------------------------------------
const commit = run('git', ['rev-parse', '--short', 'HEAD']).trim();
console.log(`Metrics for commit \`${commit}\`, ${new Date().toISOString().slice(0, 10)}\n`);
console.log('| Measure | Value |\n|---|---|');
for (const [measure, value] of rows) console.log(`| ${measure} | ${value} |`);
