/**
 * Typed export failures (release plan P3.3). The worker sends `ExportErrorInfo` to the editor,
 * which shows the message in plain text and offers the detail for "Copy details" (P3.4).
 */

export type ExportErrorCode =
  /** The creator cancelled; no file is produced */
  | 'cancelled'
  /** A referenced asset has no bytes the editor can find */
  | 'missing-asset'
  /** A referenced asset has no license the export can credit */
  | 'unlicensed-asset'
  /** A downloaded file does not match its published SHA-256 */
  | 'integrity'
  /** A download failed after its retries */
  | 'network'
  /** The editor's prebuilt runtime is missing or does not match its manifest */
  | 'runtime'
  /** The project would build a game file the runtime refuses */
  | 'invalid-project';

export interface ExportErrorInfo {
  code: ExportErrorCode;
  message: string;
  detail?: string;
}

export class ExportError extends Error {
  readonly code: ExportErrorCode;
  readonly detail?: string;

  constructor(code: ExportErrorCode, message: string, detail?: string) {
    super(message);
    this.name = 'ExportError';
    this.code = code;
    this.detail = detail;
  }

  toInfo(): ExportErrorInfo {
    return { code: this.code, message: this.message, ...(this.detail ? { detail: this.detail } : {}) };
  }
}

/** Any thrown value as an `ExportErrorInfo`; unexpected errors keep their message as detail */
export function toExportErrorInfo(err: unknown): ExportErrorInfo {
  if (err instanceof ExportError) return err.toInfo();
  const detail = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  return { code: 'invalid-project', message: 'The export stopped because of an unexpected error.', detail };
}
