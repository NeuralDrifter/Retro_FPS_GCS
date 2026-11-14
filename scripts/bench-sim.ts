/**
 * Sim tick cost benchmark (npm run bench). Prints per-tick median and p95 in milliseconds.
 *
 * - 3,000-tick replays of the deterministic input script on the determinism fixture and a 64x64 level
 * - the same 64x64 replay plus the full-state hash live play computed every tick before P1.6
 * - drift: tick cost around tick 1,000 versus tick 50,000 on the 64x64 level
 */
import { createFullTestLevel, generateDeterministic3000TickInputs } from '../src/__tests__/determinismFixtures';
import { createSizedTestLevelV3 } from '../src/__tests__/testLevels';
import { createInitialSimulationState, hashSimulationState, step } from '../src/sim';
import type { LevelDataV3 } from '../src/sim';

const inputs = generateDeterministic3000TickInputs(3000);
const quantile = (values: number[], q: number) => [...values].sort((a, b) => a - b)[Math.floor(values.length * q)];
const fmt = (ms: number) => ms.toFixed(4);

function replay(level: LevelDataV3, ticks: number, hashEachTick: boolean): number[] {
  let state = createInitialSimulationState(level, [0]);
  const times: number[] = [];
  for (let t = 0; t < ticks; t++) {
    const start = performance.now();
    state = step(state, { 0: inputs[t % inputs.length] });
    if (hashEachTick) hashSimulationState(state);
    times.push(performance.now() - start);
  }
  return times;
}

const full = createFullTestLevel();
const large = createSizedTestLevelV3(64, { row: 2, col: 2 });
replay(large, 3000, true); // warm up the JIT

const cases: [string, number[]][] = [
  ['determinism fixture, 3,000 ticks', replay(full, 3000, false)],
  ['64x64 level, 3,000 ticks', replay(large, 3000, false)],
  ['64x64 level, 3,000 ticks, hash every tick', replay(large, 3000, true)],
];
console.log('| Case | median ms/tick | p95 ms/tick |\n|---|---|---|');
for (const [name, times] of cases) console.log(`| ${name} | ${fmt(quantile(times, 0.5))} | ${fmt(quantile(times, 0.95))} |`);

const long = replay(large, 50_000, false);
const around = (tick: number) => long.slice(tick - 500, tick + 500);
const early = quantile(around(1000), 0.5);
const late = quantile(around(49_000), 0.5);
console.log(`\nDrift on 64x64: median ${fmt(early)} ms near tick 1,000, ${fmt(late)} ms near tick 49,000 (${(((late - early) / early) * 100).toFixed(1)}%)`);
