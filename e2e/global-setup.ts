import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * One e2e run at a time. Two runs side by side double the browsers rendering in software and
 * share the preview server, which can exhaust a desktop's memory. The lock names the runner
 * process; a lock left by a run that was killed is replaced.
 */

const LOCK = path.join(os.tmpdir(), 'retro-fps-gcs-e2e.lock');

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export default function globalSetup(): () => void {
  let holder = NaN;
  try {
    holder = Number(fs.readFileSync(LOCK, 'utf-8').trim());
  } catch {
    // No lock: no other run
  }
  if (Number.isInteger(holder) && holder !== process.pid && isRunning(holder)) {
    throw new Error(
      `Another e2e run (process ${holder}) is still active. Wait for it to finish or stop it; overlapping runs double the browsers in memory. Lock file: ${LOCK}`
    );
  }
  fs.writeFileSync(LOCK, String(process.pid));
  return () => {
    try {
      if (fs.readFileSync(LOCK, 'utf-8').trim() === String(process.pid)) fs.rmSync(LOCK);
    } catch {
      // Already gone
    }
  };
}
