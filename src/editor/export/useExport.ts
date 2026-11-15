/**
 * One-click export (release plan P3.4). `start` checks the project, and either lists the problems
 * (nothing downloads) or runs the export worker, shows its progress, and downloads the zip.
 */
import { useCallback, useRef, useState } from 'react';
import { ExportError } from '../../export/errors';
import type { ExportErrorInfo } from '../../export/errors';
import type { ExportProgress, ExportResult } from '../../export/exportGame';
import type { ProjectDocV4 } from '../../shared/project';
import { downloadBlob } from '../persistence/download';
import { buildExportRequest, runExport } from './exportClient';
import type { RunningExport } from './exportClient';
import { checkBeforeExport } from './preExportChecks';
import type { ExportProblem } from './preExportChecks';

export type ExportSummary = Omit<ExportResult, 'bytes'>;

export type ExportState =
  | { phase: 'idle' }
  | { phase: 'checking' }
  | { phase: 'problems'; problems: ExportProblem[] }
  | { phase: 'running'; progress: ExportProgress | null }
  | { phase: 'done'; summary: ExportSummary }
  | { phase: 'failed'; error: ExportErrorInfo };

export interface ExportController {
  state: ExportState;
  start(): void;
  cancel(): void;
  dismiss(): void;
}

export function useExport(getDoc: () => ProjectDocV4, log: (message: string) => void): ExportController {
  const [state, setState] = useState<ExportState>({ phase: 'idle' });
  const busy = useRef(false);
  const running = useRef<RunningExport | null>(null);

  const start = useCallback(() => {
    if (busy.current) return;
    busy.current = true;
    setState({ phase: 'checking' });
    void (async () => {
      try {
        const doc = getDoc();
        const request = await buildExportRequest(doc);
        const problems = checkBeforeExport(doc, request);
        if (problems.length > 0) {
          setState({ phase: 'problems', problems });
          log(`Export: ${problems.length} problem${problems.length === 1 ? '' : 's'} to fix first; nothing was exported.`);
          return;
        }
        setState({ phase: 'running', progress: null });
        const run = runExport(request, (progress) => setState({ phase: 'running', progress }));
        running.current = run;
        const { bytes, ...summary } = await run.result;
        downloadBlob(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/zip' }), summary.fileName);
        setState({ phase: 'done', summary });
        log(`Export: downloaded '${summary.fileName}' (${summary.fileCount} files).`);
      } catch (err) {
        const error = err instanceof ExportError ? err.toInfo() : { code: 'invalid-project' as const, message: 'The export stopped because of an unexpected error.', detail: String(err) };
        if (error.code === 'cancelled') {
          setState({ phase: 'idle' });
          log('Export: cancelled.');
        } else {
          setState({ phase: 'failed', error });
          log(`Export failed: ${error.message}`);
        }
      } finally {
        running.current = null;
        busy.current = false;
      }
    })();
  }, [getDoc, log]);

  const cancel = useCallback(() => running.current?.cancel(), []);
  const dismiss = useCallback(() => {
    if (!busy.current) setState({ phase: 'idle' });
  }, []);

  return { state, start, cancel, dismiss };
}
