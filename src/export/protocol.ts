/**
 * Messages between the editor and the export worker (release plan P3.3).
 */
import type { ExportErrorInfo } from './errors';
import type { ExportProgress, ExportRequest, ExportResult } from './exportGame';

export type ExportWorkerRequest = { type: 'start'; request: ExportRequest } | { type: 'cancel' };

export type ExportWorkerMessage =
  | { type: 'progress'; progress: ExportProgress }
  | { type: 'done'; result: ExportResult }
  | { type: 'error'; error: ExportErrorInfo };
