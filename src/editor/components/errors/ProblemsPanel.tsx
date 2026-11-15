/**
 * The Problems list (release plan P6.1): errors this tab ran into, newest first. P6.5 adds
 * level problems (no spawn, no exit, missing assets) to the same panel.
 */
import React from 'react';
import { clearProblems } from './problems';
import type { Problem } from './problems';

export const ProblemsPanel: React.FC<{ problems: readonly Problem[]; onClose: () => void }> = ({ problems, onClose }) => (
  <div
    role="dialog"
    aria-label="Problems"
    className="fixed right-2 bottom-8 z-50 w-[360px] max-h-[50vh] flex flex-col bg-[#252526] border border-[#3e3e42] shadow-2xl text-[11px]"
  >
    <div className="ide-panel-header">
      <span>Problems ({problems.length})</span>
      <div className="flex gap-1">
        <button type="button" className="ide-btn !h-[18px] !px-1.5 !text-[10px]" onClick={clearProblems} disabled={problems.length === 0}>
          Clear
        </button>
        <button type="button" className="ide-btn !h-[18px] !px-1.5 !text-[10px]" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
    <ul className="overflow-auto divide-y divide-[#3e3e42]">
      {problems.length === 0 && <li className="p-2 text-[#858585]">No problems.</li>}
      {problems.map((p) => (
        <li key={p.id} className="p-2">
          <div className="flex justify-between text-[#858585]">
            <span>{p.source}</span>
            <span>{new Date(p.time).toLocaleTimeString()}</span>
          </div>
          <div className="text-[#d4d4d4] break-words">{p.message}</div>
        </li>
      ))}
    </ul>
  </div>
);
