/**
 * The editor's open project (release plan P2.4): the document store, the level being edited,
 * and the helpers every edit command uses. App and its command hooks read the project only
 * through this hook, so no React state outside the store holds document data.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createDefaultMenuPack } from '../../runtime';
import type { MenuPackSpec } from '../../runtime';
import { createDefaultProject } from '../../shared/project';
import type { ProjectDocV4, ProjectLevel } from '../../shared/project';
import { MAP_PRESETS } from '../types/engine';
import type { MapPreset } from '../types/engine';
import { bindHistoryShortcuts, createDocumentStore } from './documentStore';
import type { DispatchOptions, DocumentStore } from './documentStore';
import type { DocumentAction } from './documentActions';
import { levelView, storedLevelFrom } from './levelView';
import type { EditorLevelView } from './levelView';

export const EDITOR_VERSION = '0.1.0';

/** Skybox and HUD settings a preset takes from the level it replaces */
export interface LevelLook {
  skyboxTheme: EditorLevelView['skyboxTheme'];
  skyboxSeed: number;
  showCeiling: boolean;
  minimapEnabled: boolean;
}

export const DEFAULT_LOOK: LevelLook = {
  skyboxTheme: 'retro-nebula',
  skyboxSeed: 1,
  showCeiling: false,
  minimapEnabled: true,
};

/** Stored level data for a built-in preset map */
export function presetLevelData(preset: MapPreset, look: LevelLook, nextEntityId = 1) {
  const size = preset.grid.length;
  const uniform = (id: string) => Array.from({ length: size }, () => new Array<string>(size).fill(id));
  const entities = preset.entities ? preset.entities.map((e) => ({ ...e })) : [];
  return storedLevelFrom({
    title: preset.name,
    grid: preset.grid.map((row) => [...row]),
    wallTextures: uniform(preset.defaultWallTex || 'default-grid'),
    floorTextures: uniform('floor-obsidian'),
    ceilingTextures: uniform('ceiling-coffer'),
    entities,
    nextEntityId: Math.max(nextEntityId, preset.nextEntityId ?? 1),
    spawn: { ...preset.spawn },
    skyboxTheme: look.skyboxTheme,
    skyboxSeed: look.skyboxSeed,
    showCeiling: look.showCeiling,
    minimapEnabled: look.minimapEnabled,
    cellTags: preset.cellTags,
    events: preset.events,
    regions: preset.regions,
    variables: preset.variables,
  });
}

export function randomProjectId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return `project-${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

/** The project the editor opens with: the first preset map as level 1 */
export function createInitialProject(): ProjectDocV4 {
  const preset = MAP_PRESETS[0];
  const doc = createDefaultProject({
    id: randomProjectId(),
    title: preset.name,
    now: new Date().toISOString(),
    editorVersion: EDITOR_VERSION,
  });
  return {
    ...doc,
    levels: [{ id: 'level-1', title: preset.name, data: presetLevelData(preset, DEFAULT_LOOK) }],
    campaign: {
      carryOverHealth: true,
      carryOverAmmo: true,
      menus: createDefaultMenuPack(preset.name) as unknown as Record<string, unknown>,
    },
  };
}

/** An id no level of `doc` uses */
export function newLevelId(doc: ProjectDocV4): string {
  const used = new Set(doc.levels.map((l) => l.id));
  let n = doc.levels.length + 1;
  while (used.has(`level-${n}`)) n++;
  return `level-${n}`;
}

export function campaignMenus(doc: ProjectDocV4): MenuPackSpec | undefined {
  return doc.campaign.menus as unknown as MenuPackSpec | undefined;
}

/** What every edit command needs: the store, the active level at call time, and the dispatch */
export interface DocContext {
  store: DocumentStore;
  /** The active level, read from the store when called */
  level(): ProjectLevel;
  view(): EditorLevelView;
  /** Applies an edit to the project; `label` names it in the undo menu */
  edit(action: DocumentAction, label: string, options?: DispatchOptions): void;
  /** Starts a drag or click of a map tool; edits made with `strokeOptions()` join one undo step */
  beginStroke(label: string): void;
  strokeOptions(): DispatchOptions;
  strokeLabel(fallback: string): string;
  log(message: string): void;
}

export function useEditorDocument(log: (message: string) => void) {
  const [store] = useState(createDocumentStoreForEditor);
  const state = useSyncExternalStore(store.subscribe, store.getState);
  const doc = state.doc;

  const [activeLevelId, setActiveLevelId] = useState(() => doc.levels[0].id);
  // When undo removes the active level (an undone "add level"), stay at the same position
  const lastIndexRef = useRef(0);
  let activeIndex = doc.levels.findIndex((l) => l.id === activeLevelId);
  if (activeIndex < 0) activeIndex = Math.min(lastIndexRef.current, doc.levels.length - 1);
  lastIndexRef.current = activeIndex;
  const level = doc.levels[activeIndex];
  const view = levelView(level);
  useEffect(() => {
    if (level.id !== activeLevelId) setActiveLevelId(level.id);
  }, [level.id, activeLevelId]);

  const levelIdRef = useRef(level.id);
  levelIdRef.current = level.id;
  const logRef = useRef(log);
  logRef.current = log;
  const strokeRef = useRef<{ id: string; label: string } | null>(null);
  // Another tab edits this project: edits and undo are refused (release plan P2.5)
  const readOnlyRef = useRef(false);
  const setReadOnly = useCallback((readOnly: boolean) => {
    readOnlyRef.current = readOnly;
  }, []);
  const refuse = () => logRef.current('Read-only: this project is open for editing in another tab.');
  const strokeCounter = useRef(0);

  const ctx = useMemo<DocContext>(() => {
    const currentLevel = () => {
      const levels = store.getState().doc.levels;
      return levels.find((l) => l.id === levelIdRef.current) ?? levels[0];
    };
    return {
      store,
      level: currentLevel,
      view: () => levelView(currentLevel()),
      edit: (action, label, options) => {
        if (readOnlyRef.current) refuse();
        else store.dispatch(action, label, options);
      },
      beginStroke: (label) => {
        strokeCounter.current += 1;
        strokeRef.current = { id: `stroke-${strokeCounter.current}`, label };
      },
      strokeOptions: () => (strokeRef.current ? { stroke: strokeRef.current.id } : {}),
      strokeLabel: (fallback) => strokeRef.current?.label ?? fallback,
      log: (message) => logRef.current(message),
    };
  }, [store]);

  /**
   * Undo and redo. When the step changed another level and not this one, the editor switches
   * to that level so the change is visible.
   */
  const stepHistory = useCallback(
    (direction: 'undo' | 'redo'): boolean => {
      if (readOnlyRef.current) {
        refuse();
        return false;
      }
      const before = store.getState();
      const step = direction === 'undo' ? before.past[before.past.length - 1] : before.future[0];
      if (!step) {
        logRef.current(`History: Nothing to ${direction}.`);
        return false;
      }
      if (direction === 'undo') store.undo();
      else store.redo();
      const after = store.getState();
      const id = levelIdRef.current;
      const was = before.doc.levels.find((l) => l.id === id);
      const now = after.doc.levels.find((l) => l.id === id);
      if (was === now) {
        const changed = after.doc.levels.find((l) => !before.doc.levels.includes(l));
        if (changed) setActiveLevelId(changed.id);
      }
      const left = direction === 'undo' ? after.past.length : after.future.length;
      logRef.current(
        direction === 'undo'
          ? `Undo (Ctrl+Z): Reverted '${step.label}' (${left} steps left).`
          : `Redo (Ctrl+Y): Restored '${step.label}' (${left} steps left).`
      );
      return true;
    },
    [store]
  );
  const undo = useCallback(() => stepHistory('undo'), [stepHistory]);
  const redo = useCallback(() => stepHistory('redo'), [stepHistory]);
  useEffect(() => bindHistoryShortcuts({ undo, redo }), [undo, redo]);

  return {
    store,
    doc,
    past: state.past,
    future: state.future,
    level,
    view,
    activeIndex,
    setActiveLevelId,
    ctx,
    undo,
    redo,
    setReadOnly,
  };
}

function createDocumentStoreForEditor() {
  return createDocumentStore(createInitialProject());
}

/** Applies `fn` to every level's entity list; returns `doc` itself when no list changes */
export function mapAllEntities(
  doc: ProjectDocV4,
  fn: (entities: ProjectLevel['data']['entities']) => ProjectLevel['data']['entities']
): ProjectDocV4 {
  let changed = false;
  const levels = doc.levels.map((level) => {
    const entities = fn(level.data.entities);
    if (entities === level.data.entities) return level;
    changed = true;
    return { ...level, data: { ...level.data, entities } };
  });
  return changed ? { ...doc, levels } : doc;
}
