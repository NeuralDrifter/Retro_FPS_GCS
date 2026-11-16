import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { FullResult, Reporter, TestCase, TestResult } from '@playwright/test/reporter';

/**
 * Peak memory of the whole test process tree, by test file (`E2E_MEMORY_REPORT=1`).
 *
 * About once a second it sums the memory of every process under the Playwright runner: the
 * runner, its workers, each browser's processes and the preview server. Each sample counts
 * toward every test running at that moment, so with one worker the figures belong to one file.
 * After each test it also records the tree's memory, which shows whether memory builds up from
 * test to test. The report goes to the console and to test-results/memory-report.md.
 *
 * Windows reports private bytes (memory each process alone holds), so shared pages are not
 * counted twice; Linux and macOS report resident memory from `ps`, which counts shared pages
 * once per process and so reads higher. Compare runs on the same system only.
 */

interface Proc {
  pid: number;
  ppid: number;
  bytes: number;
  /** The command line, to tell the browser's GPU, renderer and utility processes apart */
  cmd: string;
}

/** Marks the reporter's own sampling command, which is left out of every total */
const SAMPLER_MARK = 'gcs-memory-sampler';

function listProcesses(): Promise<Proc[]> {
  return new Promise((resolve) => {
    if (process.platform === 'win32') {
      const script = `# ${SAMPLER_MARK}
Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId) $($_.ParentProcessId) $($_.PrivatePageCount) $($_.Name) $($_.CommandLine)" }`;
      execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { maxBuffer: 16 * 1024 * 1024, windowsHide: true }, (err, out) => {
        if (err) return resolve([]);
        resolve(parse(out, 1));
      });
    } else {
      execFile('ps', ['-A', '-o', 'pid=,ppid=,rss=,args='], { maxBuffer: 16 * 1024 * 1024 }, (err, out) => {
        if (err) return resolve([]);
        resolve(parse(out, 1024));
      });
    }
  });
}

function parse(out: string, unit: number): Proc[] {
  const procs: Proc[] = [];
  for (const line of out.split(/\r?\n/)) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s*(.*)$/.exec(line);
    if (!m) continue;
    if (m[4].includes(SAMPLER_MARK) || /\bps\s+-A\b/.test(m[4])) continue;
    procs.push({ pid: Number(m[1]), ppid: Number(m[2]), bytes: Number(m[3]) * unit, cmd: m[4] });
  }
  return procs;
}

/** What a process in the test tree is */
function category(p: Proc, runnerPid: number): string {
  if (p.pid === runnerPid) return 'runner';
  const type = /--type=([\w-]+)/.exec(p.cmd)?.[1];
  if (/chrom|headless_shell|firefox|webkit|minibrowser/i.test(p.cmd)) {
    if (!type) return 'browser main';
    if (type === 'gpu-process') return 'browser GPU';
    if (type === 'renderer') return 'browser renderers';
    return 'browser other';
  }
  if (/vite|serve-dist/i.test(p.cmd)) return 'preview server';
  if (/node/i.test(p.cmd)) return 'test workers';
  return 'other';
}

/** `root` and all its descendants */
function tree(procs: Proc[], root: number): Proc[] {
  const children = new Map<number, Proc[]>();
  for (const p of procs) children.set(p.ppid, [...(children.get(p.ppid) ?? []), p]);
  const found: Proc[] = [];
  const seen = new Set<number>();
  const stack = procs.filter((p) => p.pid === root);
  while (stack.length > 0) {
    const p = stack.pop()!;
    if (seen.has(p.pid)) continue;
    seen.add(p.pid);
    found.push(p);
    stack.push(...(children.get(p.pid) ?? []).filter((c) => c.pid !== p.pid));
  }
  return found;
}

const total = (procs: Proc[]) => procs.reduce((sum, p) => sum + p.bytes, 0);

/** Memory by process category */
function breakdown(procs: Proc[], runnerPid: number): Map<string, number> {
  const out = new Map<string, number>();
  for (const p of procs) out.set(category(p, runnerPid), (out.get(category(p, runnerPid)) ?? 0) + p.bytes);
  return out;
}

const mb = (bytes: number) => Math.round(bytes / (1024 * 1024));

interface TestStats {
  title: string;
  file: string;
  peak: number;
  /** Memory by process category at this test's peak */
  peakBreakdown: Map<string, number>;
  durationMs: number;
}

export default class MemoryReporter implements Reporter {
  private running = new Map<TestCase, TestStats>();
  private finished: TestStats[] = [];
  private afterEach: { title: string; bytes: number; byCategory: Map<string, number> }[] = [];
  private timer: NodeJS.Timeout | null = null;
  private sampling = false;
  private suitePeak = 0;

  onBegin(): void {
    this.timer = setInterval(() => void this.sample(), 1000);
  }

  private async sample(): Promise<number> {
    if (this.sampling) return 0;
    this.sampling = true;
    try {
      const procs = tree(await listProcesses(), process.pid);
      const bytes = total(procs);
      this.suitePeak = Math.max(this.suitePeak, bytes);
      for (const stats of this.running.values()) {
        if (bytes > stats.peak) {
          stats.peak = bytes;
          stats.peakBreakdown = breakdown(procs, process.pid);
        }
      }
      return bytes;
    } finally {
      this.sampling = false;
    }
  }

  onTestBegin(test: TestCase): void {
    this.running.set(test, {
      title: test.titlePath().slice(3).join(' > '),
      file: path.basename(test.location.file),
      peak: 0,
      peakBreakdown: new Map(),
      durationMs: 0,
    });
  }

  async onTestEnd(test: TestCase, result: TestResult): Promise<void> {
    const stats = this.running.get(test);
    this.running.delete(test);
    if (!stats) return;
    stats.durationMs = result.duration;
    this.finished.push(stats);
    const procs = tree(await listProcesses(), process.pid);
    this.afterEach.push({ title: `${stats.file}: ${stats.title}`, bytes: total(procs), byCategory: breakdown(procs, process.pid) });
  }

  async onEnd(_result: FullResult): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    const byFile = new Map<string, { peak: number; tests: number; ms: number }>();
    for (const t of this.finished) {
      const f = byFile.get(t.file) ?? { peak: 0, tests: 0, ms: 0 };
      f.peak = Math.max(f.peak, t.peak);
      f.tests++;
      f.ms += t.durationMs;
      byFile.set(t.file, f);
    }
    const categories = [...new Set(this.afterEach.flatMap((e) => [...e.byCategory.keys()]))].sort();
    const split = (m: Map<string, number>) =>
      [...m.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `${k} ${mb(v)}`)
        .join(', ');
    const lines = [
      '# E2E memory report',
      '',
      `Process tree peak: ${mb(this.suitePeak)} MB (${process.platform === 'win32' ? 'private bytes' : 'resident memory'}), ${this.finished.length} tests.`,
      '',
      '| Test file | Peak MB | Tests | Time (s) |',
      '|---|---:|---:|---:|',
      ...[...byFile.entries()]
        .sort((a, b) => b[1].peak - a[1].peak)
        .map(([file, f]) => `| ${file} | ${mb(f.peak)} | ${f.tests} | ${Math.round(f.ms / 1000)} |`),
      '',
      '## Heaviest tests',
      '',
      '| Test | Peak MB | Time (s) | At the peak (MB) |',
      '|---|---:|---:|---|',
      ...[...this.finished]
        .sort((a, b) => b.peak - a.peak)
        .slice(0, 10)
        .map((t) => `| ${t.file}: ${t.title} | ${mb(t.peak)} | ${Math.round(t.durationMs / 1000)} | ${split(t.peakBreakdown)} |`),
      '',
      '## Memory after each test, in run order',
      '',
      'Growth from start to end, with every context closed, points at resources the browser or the preview server keeps.',
      '',
      `| # | Test | MB | ${categories.join(' | ')} |`,
      `|---:|---|---:|${categories.map(() => '---:').join('|')}|`,
      ...this.afterEach.map((e, i) => `| ${i + 1} | ${e.title} | ${mb(e.bytes)} | ${categories.map((c) => mb(e.byCategory.get(c) ?? 0)).join(' | ')} |`),
      '',
    ];
    const report = lines.join('\n');
    fs.mkdirSync('test-results', { recursive: true });
    fs.writeFileSync(path.join('test-results', 'memory-report.md'), report);
    console.log(`\n${lines.slice(0, 7 + byFile.size).join('\n')}\n(full report: test-results/memory-report.md)`);
  }

  printsToStdio(): boolean {
    return false;
  }
}
