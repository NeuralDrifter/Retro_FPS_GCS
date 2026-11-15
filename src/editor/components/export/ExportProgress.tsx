/**
 * The export's progress, result and errors (release plan P3.4): a panel in the lower right that
 * shows the current stage with Cancel, then the finished file's details, or the error in plain
 * text with "Copy details".
 */
import React, { useState } from 'react';
import type { ExportStage } from '../../../export/exportGame';
import type { ExportController } from '../../export/useExport';

const STAGE_LABELS: Record<ExportStage, string> = {
  collect: 'Finding the assets the game uses',
  download: 'Gathering textures and models',
  runtime: 'Adding the game runtime',
  package: 'Writing the game data',
  zip: 'Zipping',
};

const formatSize = (bytes: number) =>
  bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

const PUBLISH_STEPS = [
  'itch.io: create an HTML project, upload the zip as is, and tick "This file will be played in the browser".',
  'GitHub Pages or any static host: unzip it and upload the files; index.html must stay at the top.',
  'To test it on your computer, serve the unzipped folder with any static file server. Opening index.html directly from a folder does not work in most browsers.',
];

const Row: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="flex gap-2">
    <dt className="w-24 shrink-0 text-[#858585]">{label}</dt>
    <dd className="min-w-0 break-all text-[#d4d4d4]">{children}</dd>
  </div>
);

export const ExportProgress: React.FC<{ exporter: ExportController }> = ({ exporter }) => {
  const { state } = exporter;
  const [showPublish, setShowPublish] = useState(false);
  const [copied, setCopied] = useState(false);
  if (state.phase !== 'checking' && state.phase !== 'running' && state.phase !== 'done' && state.phase !== 'failed') return null;

  const panel = 'fixed bottom-8 right-4 z-50 w-[360px] bg-[#252526] border border-[#3e3e42] shadow-2xl text-[11px]';

  if (state.phase === 'checking' || state.phase === 'running') {
    const progress = state.phase === 'running' ? state.progress : null;
    const label = progress ? STAGE_LABELS[progress.stage] : 'Checking the project';
    const fraction = progress && progress.total > 0 ? progress.done / progress.total : null;
    return (
      <div role="status" aria-label="Export progress" className={panel}>
        <div className="p-3 space-y-2">
          <div className="flex justify-between gap-2 text-[#d4d4d4]">
            <span>
              {label}
              {progress && progress.stage === 'download' ? ` (${progress.done} of ${progress.total})` : ''}…
            </span>
            {state.phase === 'running' && (
              <button type="button" className="ide-btn !h-[20px]" onClick={exporter.cancel}>
                Cancel
              </button>
            )}
          </div>
          <div className="h-1 bg-[#3e3e42]">
            <div className="h-1 bg-[#38bdf8] transition-all" style={{ width: `${Math.round((fraction ?? 0) * 100)}%` }} />
          </div>
        </div>
      </div>
    );
  }

  if (state.phase === 'failed') {
    const { error } = state;
    const details = `Export failed (${error.code}): ${error.message}${error.detail ? `\n${error.detail}` : ''}`;
    return (
      <div role="alertdialog" aria-labelledby="export-failed-title" className={panel}>
        <div className="ide-panel-header">
          <h2 id="export-failed-title" className="text-[12px] font-semibold text-[#f87171]">
            Export failed
          </h2>
        </div>
        <div className="p-3 space-y-3">
          <p className="text-[#d4d4d4]">{error.message}</p>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="ide-btn"
              onClick={() => {
                void navigator.clipboard?.writeText(details).then(() => setCopied(true), () => setCopied(false));
              }}
            >
              {copied ? 'Copied' : 'Copy details'}
            </button>
            <button type="button" className="ide-btn ide-btn--primary" onClick={exporter.dismiss}>
              Close
            </button>
          </div>
        </div>
      </div>
    );
  }

  const { summary } = state;
  return (
    <div role="dialog" aria-labelledby="export-done-title" className={panel}>
      <div className="ide-panel-header">
        <h2 id="export-done-title" className="text-[12px] font-semibold text-white">
          Game exported
        </h2>
      </div>
      <div className="p-3 space-y-3">
        <dl className="space-y-1">
          <Row label="File">{summary.fileName}</Row>
          <Row label="Size">{formatSize(summary.size)}</Row>
          <Row label="Files">{summary.fileCount}</Row>
          <Row label="Runtime">{summary.runtimeVersion}</Row>
          <Row label="SHA-256">
            <code className="text-[10px]">{summary.sha256}</code>
          </Row>
        </dl>
        {showPublish && (
          <ul className="list-disc pl-4 space-y-1 text-[#d4d4d4]">
            {PUBLISH_STEPS.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ul>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className="ide-btn" aria-expanded={showPublish} onClick={() => setShowPublish((v) => !v)}>
            How to publish
          </button>
          <button type="button" className="ide-btn ide-btn--primary" onClick={exporter.dismiss}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
