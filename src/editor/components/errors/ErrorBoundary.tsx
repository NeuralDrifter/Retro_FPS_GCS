/**
 * Error boundaries (release plan P6.1). A crash in one panel shows a recoverable view in that
 * panel while the rest of the editor, and the project, keep working. A crash of the whole editor
 * shows a page that can still download the project.
 */
import React from 'react';
import { addProblem } from './problems';
import { downloadRecoveryFile, hasRecoverySource } from './recovery';

declare global {
  interface Window {
    /** Debug runs only: the panel named here throws while rendering (e2e fault injection) */
    __gcsFault?: string;
  }
}

/** Throws during render when a debug run asks this area to fail */
function FaultPoint({ area }: { area: string }): null {
  if (typeof window !== 'undefined' && window.__GCS_DEBUG__ === true && window.__gcsFault === area) {
    throw new Error(`E2E fault injected into ${area}`);
  }
  return null;
}

interface BoundaryState {
  error: Error | null;
}

const button = 'ide-btn !h-[22px] !px-2';

interface PanelProps {
  area: string;
  children: React.ReactNode;
  /** Dialogs: show the error view centered over the editor, with a Close button */
  onClose?: () => void;
  /** Class for the error view's container, so it takes the panel's place in the layout */
  fallbackClassName?: string;
}

export class PanelErrorBoundary extends React.Component<PanelProps, BoundaryState> {
  override state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error): void {
    addProblem(this.props.area, error);
  }

  override render() {
    const { area, children, onClose, fallbackClassName } = this.props;
    if (!this.state.error) {
      return (
        <>
          <FaultPoint area={area} />
          {children}
        </>
      );
    }
    const view = (
      <div role="alert" className="h-full w-full flex flex-col items-center justify-center gap-2 p-4 bg-[#1e1e1e] text-center text-[12px] text-[#d4d4d4]">
        <strong className="text-[#f87171]">The {area} stopped working.</strong>
        <span className="text-[#a0a0a0]">Your project is safe. The error is listed under Problems in the status bar.</span>
        <div className="flex gap-2">
          <button type="button" className={button} onClick={() => this.setState({ error: null })}>
            Try again
          </button>
          <button type="button" className={button} onClick={() => void downloadRecoveryFile()}>
            Download recovery file
          </button>
          {onClose && (
            <button type="button" className={button} onClick={onClose}>
              Close
            </button>
          )}
        </div>
      </div>
    );
    if (!onClose) return fallbackClassName ? <div className={fallbackClassName}>{view}</div> : view;
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
        <div className="w-full max-w-md h-48 border border-[#3e3e42]">{view}</div>
      </div>
    );
  }
}

/** The last line of defense around the whole editor */
export class AppErrorBoundary extends React.Component<{ children: React.ReactNode }, BoundaryState> {
  override state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error): void {
    addProblem('Editor', error);
  }

  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" className="fixed inset-0 flex flex-col items-center justify-center gap-3 p-6 bg-[#1e1e1e] text-center text-[13px] text-[#d4d4d4]">
        <strong className="text-[16px] text-[#f87171]">The editor stopped working.</strong>
        <span className="max-w-md text-[#a0a0a0]">
          {hasRecoverySource()
            ? 'Download a recovery file of your project, then reload. Open it again with File > Open File.'
            : 'Reload the page. Your last autosave is offered for recovery when the editor starts.'}
        </span>
        <code className="max-w-md break-words text-[11px] text-[#858585]">{this.state.error.message}</code>
        <div className="flex gap-2">
          {hasRecoverySource() && (
            <button type="button" className={button} onClick={() => void downloadRecoveryFile()}>
              Download recovery file
            </button>
          )}
          <button type="button" className={button} onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      </div>
    );
  }
}
