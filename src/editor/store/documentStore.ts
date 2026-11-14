/**
 * The editor's project document store (release plan P2.3, decision D6): one immutable
 * ProjectDocV4 behind a reducer, read from React with useSyncExternalStore.
 *
 * Undo history keeps references to earlier documents. Because the reducer shares every object
 * it does not change, 200 steps cost little more than the rows the edits touched. Consecutive
 * actions with the same `stroke` (one drag of the paint tool, one gizmo drag) form one step.
 */
import { useSyncExternalStore } from 'react';
import type { ProjectDocV4 } from '../../shared/project';
import { reduceDocument } from './documentActions';
import type { DocumentAction } from './documentActions';

export const HISTORY_LIMIT = 200;

export interface HistoryStep {
  /** The document before this step */
  doc: ProjectDocV4;
  label: string;
}

export interface DocumentState {
  doc: ProjectDocV4;
  past: readonly HistoryStep[];
  /** Steps undone and available to redo, most recent first */
  future: readonly HistoryStep[];
}

export interface DocumentStore {
  getState(): DocumentState;
  subscribe(listener: () => void): () => void;
  /** Applies an edit; `label` names it in the undo menu */
  dispatch(action: DocumentAction, label?: string): void;
  undo(): boolean;
  redo(): boolean;
  /** Replaces the whole document (open, new, recover) and clears history */
  replace(doc: ProjectDocV4): void;
}

const STROKE_ACTIONS = new Set(['cells/set', 'entity/update']);
const strokeOf = (action: DocumentAction): string | undefined =>
  STROKE_ACTIONS.has(action.type) ? (action as { stroke?: string }).stroke : undefined;

export function createDocumentStore(initial: ProjectDocV4): DocumentStore {
  let state: DocumentState = { doc: initial, past: [], future: [] };
  let lastStroke: string | undefined;
  const listeners = new Set<() => void>();
  const publish = (next: DocumentState) => {
    state = next;
    for (const listener of listeners) listener();
  };

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispatch(action, label = action.type) {
      const doc = reduceDocument(state.doc, action);
      if (doc === state.doc) return;
      const stroke = strokeOf(action);
      // The rest of a stroke changes the document but not the undo step its first action opened
      if (stroke !== undefined && stroke === lastStroke && state.past.length > 0) {
        publish({ doc, past: state.past, future: [] });
        return;
      }
      lastStroke = stroke;
      const past = [...state.past, { doc: state.doc, label }];
      if (past.length > HISTORY_LIMIT) past.splice(0, past.length - HISTORY_LIMIT);
      publish({ doc, past, future: [] });
    },
    undo() {
      const step = state.past[state.past.length - 1];
      if (!step) return false;
      lastStroke = undefined;
      publish({
        doc: step.doc,
        past: state.past.slice(0, -1),
        future: [{ doc: state.doc, label: step.label }, ...state.future],
      });
      return true;
    },
    redo() {
      const step = state.future[0];
      if (!step) return false;
      lastStroke = undefined;
      publish({
        doc: step.doc,
        past: [...state.past, { doc: state.doc, label: step.label }],
        future: state.future.slice(1),
      });
      return true;
    },
    replace(doc) {
      lastStroke = undefined;
      publish({ doc, past: [], future: [] });
    },
  };
}

/** Reads a slice of the store; the component re-renders only when the selected value changes */
export function useDocumentSelector<T>(store: DocumentStore, select: (state: DocumentState) => T): T {
  return useSyncExternalStore(store.subscribe, () => select(store.getState()));
}

/**
 * Ctrl+Z undoes, Ctrl+Y and Ctrl+Shift+Z redo (Cmd on macOS), except while typing in a field.
 * Returns a function that removes the listener.
 */
export function bindHistoryShortcuts(store: DocumentStore, target: Window = window): () => void {
  const onKeyDown = (e: KeyboardEvent) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    const el = e.target as HTMLElement | null;
    if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
    const key = e.key.toLowerCase();
    if (key === 'z' && !e.shiftKey) {
      if (store.undo()) e.preventDefault();
    } else if (key === 'y' || (key === 'z' && e.shiftKey)) {
      if (store.redo()) e.preventDefault();
    }
  };
  target.addEventListener('keydown', onKeyDown);
  return () => target.removeEventListener('keydown', onKeyDown);
}
