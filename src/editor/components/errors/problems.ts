/**
 * Errors the editor ran into (release plan P6.1): panels that crashed, and errors nothing else
 * caught. Shown in the Problems panel and counted in the status bar. They stay in this tab; no
 * error data is sent anywhere.
 */
import { useSyncExternalStore } from 'react';

export interface Problem {
  id: number;
  time: number;
  /** Where it happened: a panel name, or "Page" for uncaught errors */
  source: string;
  message: string;
}

const MAX_PROBLEMS = 50;
let problems: readonly Problem[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

export function addProblem(source: string, error: unknown): void {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : 'Unknown error';
  problems = [{ id: nextId++, time: Date.now(), source, message: message.slice(0, 500) }, ...problems].slice(0, MAX_PROBLEMS);
  notify();
}

export function clearProblems(): void {
  problems = [];
  notify();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export function useProblems(): readonly Problem[] {
  return useSyncExternalStore(subscribe, () => problems);
}

/** Records uncaught errors and rejected promises; returns a function that stops */
export function installGlobalErrorHandlers(target: Window = window): () => void {
  const onError = (e: ErrorEvent) => addProblem('Page', e.error ?? e.message);
  const onRejection = (e: PromiseRejectionEvent) => addProblem('Page', e.reason);
  target.addEventListener('error', onError);
  target.addEventListener('unhandledrejection', onRejection);
  return () => {
    target.removeEventListener('error', onError);
    target.removeEventListener('unhandledrejection', onRejection);
  };
}
