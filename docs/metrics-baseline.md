# Metrics baseline

Recorded 2026-11-14 with `npm run metrics` (`scripts/report-metrics.ts`). Rerun it to compare: later phases set budgets against these numbers (Step 2 and P7.4 of the release plan).

Units: kB is 1,000 bytes, as in Vite's build output. Gzip sizes use level 9.

## Audit commit compared with today

"Audit" is commit `cf7bd9e`, the state the release plan describes (it was `a5f61d2` before the history rewrite). Running the script there reproduces section 1.1 of the plan, which checks the script.

| Measure | Audit (`cf7bd9e`) | Now (`9a0b1c0`, after P0.1 to P0.6) | Why it changed |
|---|---|---|---|
| Tracked files | 134 (section 1.1 says 144: ten purged `aistudio` files are gone from history) | 157 | UI Menu Studio, e2e suite, CI and config files |
| TypeScript source (non-test) | 36,605 lines: runtime 21,058; editor 15,547 | 43,307 lines: runtime 24,278; editor 19,029 | UI Menu Studio (commit before the plan was committed) |
| Explicit `any` (non-test) | 33 | 33 | |
| Unit tests | 174 passing (Node runner) | 178 passing in 15 files, 3.8 s; 6,304 lines | 4 Menu Studio tests; Vitest since P0.3 |
| Typecheck errors | 0 | 0 | |
| `noUncheckedIndexedAccess` errors (non-test) | 355 | 367 | New Menu Studio code |
| `noUnusedLocals` + `noUnusedParameters` errors (non-test) | 30 | 2 | P0.6 lint fixes removed unused code |
| `exactOptionalPropertyTypes` errors (non-test) | 39 (section 1.1 says 40) | 53 | New Menu Studio code |
| Editor JS, main chunk | 2,353 kB (601 kB gzip) | 2,581 kB (651 kB gzip) | Menu Studio |
| Editor CSS | 40 kB | 49 kB | Menu Studio |
| Draco decoder copies Vite bundles into `assets/` | 5 files, 1,315 kB (2 `.wasm`, 3 `.js`) | same | Unchanged; P3.2 removes the duplicates |
| Prebuilt runtime `public/single-html-runtime.js` | 940 kB (252 kB gzip) | 973 kB (260 kB gzip) | Menu runtime; the budget in Step 2 is 300 kB gzip |
| Production dependency tree | 155 packages | 19 packages (5 direct) | P0.2 removed unused packages |
| Node | 24 locally, 22 in CI | 24 locally and in CI | P0.2 |

## Coverage

`npm run test:coverage` on 2026-11-14: 32.0% of lines, 36.3% of branches, 27.6% of functions, 31.4% of statements across `src/` (React components included).

## Full output, 2026-11-14

```
| Measure | Value |
|---|---|
| Tracked files | 157 |
| TypeScript source (non-test) | 43,307 lines: runtime, sim and HUD 24,278; editor 19,029 |
| Explicit `any` (non-test) | 33 |
| Unit tests | 178 passing, 0 failing, in 15 files, 3.8 s; 6,304 lines |
| Typecheck errors | 0 |
| Errors with `noUncheckedIndexedAccess` (non-test) | 367 |
| Errors with `noUnusedLocals` and `noUnusedParameters` (non-test) | 2 |
| Errors with `exactOptionalPropertyTypes` (non-test) | 53 |
| Editor JS (main chunk) | 1 file(s), 2,581 kB (651 kB gzip) |
| Editor CSS | 49 kB |
| Draco decoder copies bundled by Vite | 5 files, 1,315 kB: 2 .wasm, 3 .js |
| Other JS chunks | 2 file(s), 1 kB |
| Prebuilt runtime (`public/single-html-runtime.js`) | 973 kB (260 kB gzip) |
| Dependencies | 5 direct production, 15 direct dev; production tree 19 packages |
| Node | v24.14.0 |
```
