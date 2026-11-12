import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  DesignStateSnapshot,
  HistoryManager,
  MAX_HISTORY_DEPTH,
} from '../engine/HistoryManager';
import { PlacedEntity } from '../types/engine';
import { VerticalLevelData } from '../runtime/types';

export interface SpawnPoint {
  row: number;
  col: number;
  yaw: number;
}

export interface UseEditorHistoryProps {
  grid: number[][];
  setGrid: React.Dispatch<React.SetStateAction<number[][]>>;
  wallTextures: string[][];
  setWallTextures: React.Dispatch<React.SetStateAction<string[][]>>;
  floorTextures: string[][];
  setFloorTextures: React.Dispatch<React.SetStateAction<string[][]>>;
  ceilingTextures: string[][];
  setCeilingTextures: React.Dispatch<React.SetStateAction<string[][]>>;
  entities: PlacedEntity[];
  setEntities: React.Dispatch<React.SetStateAction<PlacedEntity[]>>;
  spawn: SpawnPoint;
  setSpawn: React.Dispatch<React.SetStateAction<SpawnPoint>>;
  vertical: VerticalLevelData;
  setVertical: React.Dispatch<React.SetStateAction<VerticalLevelData>>;
  setEngineLog: (msg: string) => void;
}

export function useEditorHistory({
  grid,
  setGrid,
  wallTextures,
  setWallTextures,
  floorTextures,
  setFloorTextures,
  ceilingTextures,
  setCeilingTextures,
  entities,
  setEntities,
  spawn,
  setSpawn,
  vertical,
  setVertical,
  setEngineLog,
}: UseEditorHistoryProps) {
  const [pastHistory, setPastHistory] = useState<DesignStateSnapshot[]>([]);
  const [futureHistory, setFutureHistory] = useState<DesignStateSnapshot[]>([]);

  const pastHistoryRef = useRef<DesignStateSnapshot[]>(pastHistory);
  pastHistoryRef.current = pastHistory;

  const futureHistoryRef = useRef<DesignStateSnapshot[]>(futureHistory);
  futureHistoryRef.current = futureHistory;

  // Live ref to the current design state so history snapshots are always synchronous
  const currentDesignRef = useRef<DesignStateSnapshot>({
    grid,
    wallTextures,
    floorTextures,
    ceilingTextures,
    entities,
    spawn,
    vertical,
    actionLabel: 'Initial State',
  });
  currentDesignRef.current = {
    grid,
    wallTextures,
    floorTextures,
    ceilingTextures,
    entities,
    spawn,
    vertical,
    actionLabel: 'Current State',
  };

  /**
   * Records a deep-cloned snapshot of the current map state onto the Undo stack
   * before a mutation is applied, and clears the Redo stack.
   */
  const recordHistorySnapshot = useCallback((actionLabel: string) => {
    const snapshot = HistoryManager.cloneSnapshot({
      ...currentDesignRef.current,
      actionLabel,
    });

    setPastHistory((prev) => {
      if (
        prev.length > 0 &&
        HistoryManager.areSnapshotsEqual(prev[prev.length - 1], snapshot)
      ) {
        const updated = [...prev];
        updated[updated.length - 1] = snapshot;
        return updated;
      }
      const next = [...prev, snapshot];
      return next.length > MAX_HISTORY_DEPTH
        ? next.slice(next.length - MAX_HISTORY_DEPTH)
        : next;
    });

    setFutureHistory([]);
  }, []);

  /**
   * Reverts the map design to the previous snapshot on the Undo stack (Ctrl+Z).
   */
  const handleUndo = useCallback(() => {
    const prevPast = pastHistoryRef.current;
    if (prevPast.length === 0) {
      setEngineLog('History: Nothing to undo.');
      return;
    }

    const targetSnapshot = prevPast[prevPast.length - 1];
    const remainingPast = prevPast.slice(0, -1);

    // Push current state onto Redo stack
    const currentSnap = HistoryManager.cloneSnapshot({
      ...currentDesignRef.current,
      actionLabel: targetSnapshot.actionLabel,
    });

    setPastHistory(remainingPast);
    setFutureHistory((prevFuture) => [...prevFuture, currentSnap]);

    // Restore state from targetSnapshot
    const restored = HistoryManager.cloneSnapshot(targetSnapshot);
    setGrid(restored.grid);
    setWallTextures(restored.wallTextures);
    setFloorTextures(restored.floorTextures);
    setCeilingTextures(restored.ceilingTextures);
    setEntities(restored.entities);
    setSpawn(restored.spawn);
    if (restored.vertical) setVertical(restored.vertical);

    setEngineLog(
      `Undo (Ctrl+Z): Reverted '${targetSnapshot.actionLabel}' (${remainingPast.length} steps left).`
    );
  }, [
    setGrid,
    setWallTextures,
    setFloorTextures,
    setCeilingTextures,
    setEntities,
    setSpawn,
    setVertical,
    setEngineLog,
  ]);

  /**
   * Re-applies a previously undone map design step from the Redo stack (Ctrl+Y / Ctrl+Shift+Z).
   */
  const handleRedo = useCallback(() => {
    const prevFuture = futureHistoryRef.current;
    if (prevFuture.length === 0) {
      setEngineLog('History: Nothing to redo.');
      return;
    }

    const targetSnapshot = prevFuture[prevFuture.length - 1];
    const remainingFuture = prevFuture.slice(0, -1);

    // Push current state back onto Undo stack
    const currentSnap = HistoryManager.cloneSnapshot({
      ...currentDesignRef.current,
      actionLabel: targetSnapshot.actionLabel,
    });

    setFutureHistory(remainingFuture);
    setPastHistory((prevPast) => [...prevPast, currentSnap]);

    // Restore state from targetSnapshot
    const restored = HistoryManager.cloneSnapshot(targetSnapshot);
    setGrid(restored.grid);
    setWallTextures(restored.wallTextures);
    setFloorTextures(restored.floorTextures);
    setCeilingTextures(restored.ceilingTextures);
    setEntities(restored.entities);
    setSpawn(restored.spawn);
    if (restored.vertical) setVertical(restored.vertical);

    setEngineLog(
      `Redo (Ctrl+Y): Restored '${targetSnapshot.actionLabel}' (${remainingFuture.length} steps left).`
    );
  }, [
    setGrid,
    setWallTextures,
    setFloorTextures,
    setCeilingTextures,
    setEntities,
    setSpawn,
    setVertical,
    setEngineLog,
  ]);

  // Global Keyboard Listener for Ctrl+Z (Undo) and Ctrl+Y / Ctrl+Shift+Z (Redo)
  useEffect(() => {
    const onGlobalKeyDown = (e: KeyboardEvent) => {
      // Allow native undo/redo inside text inputs and textareas
      if (
        document.activeElement instanceof HTMLInputElement ||
        document.activeElement instanceof HTMLTextAreaElement
      ) {
        return;
      }

      const isMod = e.ctrlKey || e.metaKey;
      if (!isMod) return;

      if (e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          handleRedo();
        } else {
          handleUndo();
        }
      } else if (e.key.toLowerCase() === 'y') {
        e.preventDefault();
        handleRedo();
      }
    };

    window.addEventListener('keydown', onGlobalKeyDown);
    return () => window.removeEventListener('keydown', onGlobalKeyDown);
  }, [handleUndo, handleRedo]);

  return {
    pastHistory,
    setPastHistory,
    futureHistory,
    setFutureHistory,
    currentDesignRef,
    recordHistorySnapshot,
    handleUndo,
    handleRedo,
  };
}
