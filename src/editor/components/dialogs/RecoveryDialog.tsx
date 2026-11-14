/**
 * Offered on load when an autosave holds changes that were never saved (release plan P2.5).
 */
import React from 'react';

export interface RecoveryDialogProps {
  title: string;
  savedAt: number;
  onRecover: () => void;
  onDiscard: () => void;
}

export const RecoveryDialog: React.FC<RecoveryDialogProps> = ({ title, savedAt, onRecover, onDiscard }) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="recovery-title"
      className="w-full max-w-md bg-[#252526] border border-[#3e3e42] shadow-2xl"
    >
      <div className="ide-panel-header">
        <h2 id="recovery-title" className="text-[12px] font-semibold text-white">
          Recover unsaved work?
        </h2>
      </div>
      <div className="p-4 space-y-3 text-[12px] text-[#d4d4d4]">
        <p>
          <strong className="text-white">{title}</strong> has changes from {new Date(savedAt).toLocaleString()} that were
          autosaved but never saved.
        </p>
        <p className="text-[#a0a0a0]">
          Recover opens that copy. Discard deletes its autosaves; a version you saved yourself stays in Open Recent.
        </p>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="ide-btn" onClick={onDiscard}>
            Discard
          </button>
          <button type="button" className="ide-btn ide-btn--primary" onClick={onRecover} autoFocus>
            Recover
          </button>
        </div>
      </div>
    </div>
  </div>
);
