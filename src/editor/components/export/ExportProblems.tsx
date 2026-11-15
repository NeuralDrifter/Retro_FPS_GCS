/**
 * Problems that stop an export (release plan P3.4). Shown instead of exporting; nothing downloads.
 */
import React from 'react';
import type { ExportProblem } from '../../export/preExportChecks';

export const ExportProblems: React.FC<{ problems: ExportProblem[]; onClose: () => void }> = ({ problems, onClose }) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
    <div role="dialog" aria-modal="true" aria-labelledby="export-problems-title" className="w-full max-w-lg bg-[#252526] border border-[#3e3e42] shadow-2xl">
      <div className="ide-panel-header">
        <h2 id="export-problems-title" className="text-[12px] font-semibold text-white">
          Fix these before exporting
        </h2>
      </div>
      <div className="p-4 space-y-3 text-[12px] text-[#d4d4d4]">
        <p className="text-[#a0a0a0]">
          {problems.length === 1 ? 'One problem stops' : `${problems.length} problems stop`} the export. Nothing was downloaded.
        </p>
        <ul aria-label="Export problems" className="max-h-[50vh] overflow-y-auto space-y-2">
          {problems.map((p, i) => (
            <li key={i} className="border-l-2 border-[#f87171] pl-2">
              <div className="font-semibold text-white">{p.where}</div>
              <div>{p.message}</div>
            </li>
          ))}
        </ul>
        <div className="flex justify-end">
          <button type="button" className="ide-btn ide-btn--primary" onClick={onClose} autoFocus>
            Close
          </button>
        </div>
      </div>
    </div>
  </div>
);
