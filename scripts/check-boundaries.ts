/**
 * Checks that each source area imports only what it is allowed to (release plan P1.5).
 * It is the second gate next to the Oxlint `no-restricted-imports` overrides in .oxlintrc.json,
 * with a report grouped by rule.
 *
 *   npm run check:boundaries
 *
 * Type-only imports are checked too: esbuild strips TypeScript with verbatim module syntax,
 * which keeps every import statement except `import type`, so those are read from the source.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { transformSync } from 'esbuild';
import { init, parse } from 'es-module-lexer';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const P = path.posix;

type Area = 'sim' | 'shared' | 'net-protocol' | 'net-client' | 'runtime' | 'export' | 'editor';

function areaOf(file: string): Area | null {
  if (file.includes('/__tests__/')) return null;
  if (file.startsWith('src/sim/')) return 'sim';
  if (file.startsWith('src/shared/')) return 'shared';
  if (file.startsWith('src/net/protocol/')) return 'net-protocol';
  if (file.startsWith('src/net/client/')) return 'net-client';
  if (file.startsWith('src/runtime/')) return 'runtime';
  if (file.startsWith('src/export/')) return 'export';
  if (file.startsWith('src/editor/') || file === 'src/main.tsx') return 'editor';
  return null;
}

interface Rule {
  name: string;
  applies: (from: Area, file: string) => boolean;
  /** Returns true when the import breaks the rule. */
  breaks: (target: Target, file: string) => boolean;
  why: string;
}

type Target =
  | { kind: 'package'; name: string }
  | { kind: 'node' }
  | { kind: 'source'; file: string; area: Area | null };

const UI_PACKAGES = ['react', 'react-dom', 'lucide-react'];
const isPackage = (t: Target, names: string[]) => t.kind === 'package' && names.includes(t.name);
const isArea = (t: Target, areas: Area[]) => t.kind === 'source' && t.area !== null && areas.includes(t.area);
const PURE: Area[] = ['sim', 'shared', 'net-protocol'];

const RULES: Rule[] = [
  {
    name: 'pure-no-platform',
    applies: (from) => PURE.includes(from),
    breaks: (t) => t.kind === 'node' || isPackage(t, [...UI_PACKAGES, 'three', 'jszip']),
    why: 'sim, shared and net/protocol run anywhere: no Node, Three.js, React or UI packages',
  },
  {
    name: 'pure-no-app-areas',
    applies: (from) => PURE.includes(from),
    breaks: (t) => isArea(t, ['runtime', 'editor', 'export', 'net-client']),
    why: 'sim, shared and net/protocol must not import the runtime, editor, export or net/client',
  },
  {
    name: 'shared-is-the-base',
    applies: (from) => from === 'shared',
    breaks: (t) => isArea(t, ['sim', 'net-protocol']),
    why: 'shared is the bottom layer; the sim depends on it, not the other way round',
  },
  {
    name: 'runtime-no-react',
    applies: (from) => from === 'runtime',
    breaks: (t) => isPackage(t, UI_PACKAGES) || isArea(t, ['editor', 'export']),
    why: 'the game runtime has no React and never imports the editor or export pipeline',
  },
  {
    name: 'export-no-react',
    applies: (from) => from === 'export',
    breaks: (t) => isPackage(t, UI_PACKAGES),
    why: 'the export pipeline runs without React (it moves to a Web Worker in P3.3)',
  },
  {
    name: 'editor-uses-runtime-index',
    applies: (from) => from === 'editor',
    breaks: (t) => t.kind === 'source' && t.area === 'runtime' && t.file !== 'src/runtime/index.ts',
    why: 'the editor imports the runtime only through src/runtime/index.ts',
  },
  {
    name: 'net-client-only-from-mp-entry',
    applies: (_from, file) => file !== 'src/runtime/entries/mp.ts',
    breaks: (t) => isArea(t, ['net-client']),
    why: 'only src/runtime/entries/mp.ts may import src/net/client, so single-player builds carry no networking',
  },
];

const EXTENSIONS = ['', '.ts', '.tsx', '/index.ts', '/index.tsx'];
function resolveTarget(fromFile: string, spec: string, tracked: Set<string>): Target {
  if (spec.startsWith('node:')) return { kind: 'node' };
  if (!spec.startsWith('.') && !spec.startsWith('/')) {
    const parts = spec.split('/');
    return { kind: 'package', name: spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0] };
  }
  const base = P.normalize(P.join(P.dirname(fromFile), spec)).replace(/\?.*$/, '');
  const file = EXTENSIONS.map((ext) => base + ext).find((candidate) => tracked.has(candidate)) ?? base;
  return { kind: 'source', file, area: areaOf(file) };
}

/** Static, type-only and dynamic (string literal) import specifiers with their source line. */
function importsOf(file: string, source: string): { spec: string; line: number }[] {
  const lineOf = (spec: string) => {
    const at = source.search(new RegExp(`['"]${spec.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]`));
    return at < 0 ? 0 : source.slice(0, at).split('\n').length;
  };
  const { code } = transformSync(source, {
    loader: file.endsWith('.tsx') ? 'tsx' : 'ts',
    format: 'esm',
    jsx: 'automatic',
    tsconfigRaw: { compilerOptions: { verbatimModuleSyntax: true } },
  });
  const [imports] = parse(code);
  const specs = new Set<string>();
  for (const entry of imports) if (entry.specifier) specs.add(entry.specifier);
  for (const match of source.matchAll(/import\s+type\s[^'"]*?from\s*['"]([^'"]+)['"]/g)) specs.add(match[1]);
  return [...specs].map((spec) => ({ spec, line: lineOf(spec) }));
}

await init;
const tracked = new Set(
  execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', 'src'], { cwd: root, encoding: 'utf-8' })
    .split('\n')
    .filter(Boolean)
);
const violations = new Map<string, string[]>();
let checked = 0;
for (const file of tracked) {
  if (!/\.(ts|tsx)$/.test(file)) continue;
  const from = areaOf(file);
  if (!from) continue;
  checked++;
  const source = fs.readFileSync(path.join(root, file), 'utf-8');
  for (const { spec, line } of importsOf(file, source)) {
    const target = resolveTarget(file, spec, tracked);
    for (const rule of RULES) {
      if (rule.applies(from, file) && rule.breaks(target, file)) {
        const list = violations.get(rule.name) ?? [];
        list.push(`  ${file}:${line} imports '${spec}'`);
        violations.set(rule.name, list);
      }
    }
  }
}

if (violations.size === 0) {
  console.log(`Boundaries OK: ${checked} files checked against ${RULES.length} rules.`);
} else {
  let total = 0;
  for (const rule of RULES) {
    const list = violations.get(rule.name);
    if (!list) continue;
    total += list.length;
    console.error(`\n✗ ${rule.name}: ${rule.why}`);
    for (const entry of list) console.error(entry);
  }
  console.error(`\n${total} boundary violation(s) in ${checked} files. See docs/release-plan.md, P1.5.`);
  process.exitCode = 1;
}
