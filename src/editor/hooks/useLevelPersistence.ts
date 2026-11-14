/**
 * Presets, save files, and the level's events: loading a preset into the level, saving and
 * opening editor save files, the Visual Triggers editor's save, and the level exit shortcut.
 * Works on the project store (release plan P2.4). Save files keep the editor save format
 * (LevelStateData) until P2.5 adds project files.
 */
import { useCallback } from 'react';
import { CellType, LevelStateData, MAP_PRESETS, TextureAsset, collectMenuTextureIds } from '../types/engine';
import type { EventDefinition, RegionDefinition, VariableRegistrySpec } from '../../sim';
import { LevelSerializer } from '../engine/LevelSerializer';
import type { ProjectDocV4, ProjectLevel } from '../../shared/project';
import { levelStateOf, levelView, storedLevelFromState } from '../store/levelView';
import { campaignMenus, presetLevelData } from '../store/useEditorDocument';
import type { DocContext } from '../store/useEditorDocument';

export interface UseLevelPersistenceProps {
  ctx: DocContext;
  customTextures: TextureAsset[];
  addCustomTextures: (textures: TextureAsset[]) => void;
  setActiveLevelId: (id: string) => void;
  selectedCell: { row: number; col: number };
  activeLayer: number;
  /** Resets per-level editor state (layer, selection, playtest) after the level was replaced */
  onLevelReplaced: () => void;
  onEventsSaved: () => void;
}

/** Every texture id the project's levels and menus use */
function usedTextureIds(doc: ProjectDocV4): Set<string> {
  const ids = new Set<string>();
  const add = (m: string[][]) => {
    for (const row of m) for (const id of row) ids.add(id);
  };
  for (const level of doc.levels) {
    const d = level.data;
    add(d.wallTextures);
    add(d.floorTextures);
    add(d.ceilingTextures);
    for (const layer of d.layers ?? []) {
      add(layer.wallTextures);
      add(layer.floorTextures);
      add(layer.ceilingTextures);
    }
  }
  const menus = campaignMenus(doc);
  if (menus) for (const id of collectMenuTextureIds(menus)) ids.add(id);
  return ids;
}

/** The whole project in the editor save format: the active level at the root, every level in `levels` */
export function buildSaveState(doc: ProjectDocV4, activeIndex: number, customTextures: TextureAsset[]): LevelStateData {
  const used = usedTextureIds(doc);
  const textures = customTextures.filter((t) => !t.fromProject || used.has(t.id));
  const levels = doc.levels.map((level) => levelStateOf(level, textures));
  const active = levels[activeIndex] ?? levels[0];
  const menus = campaignMenus(doc);
  return {
    ...active,
    customTextures: textures,
    levels,
    activeLevelIndex: activeIndex,
    campaign: {
      carryOverHealth: doc.campaign.carryOverHealth,
      carryOverAmmo: doc.campaign.carryOverAmmo,
      ...(menus ? { menus } : {}),
    },
  };
}

export function useLevelPersistence({
  ctx,
  customTextures,
  addCustomTextures,
  setActiveLevelId,
  selectedCell,
  activeLayer,
  onLevelReplaced,
  onEventsSaved,
}: UseLevelPersistenceProps) {
  const { log } = ctx;

  const handleLoadPreset = useCallback(
    (presetId: string) => {
      const found = MAP_PRESETS.find((p) => p.id === presetId);
      if (!found) return;
      const level = ctx.level();
      const view = levelView(level);
      const data = presetLevelData(found, view, view.nextEntityId);
      ctx.edit({ type: 'level/setData', levelId: level.id, data, title: found.name }, `Load Preset '${found.name}'`);
      onLevelReplaced();
      const index = ctx.store.getState().doc.levels.findIndex((l) => l.id === level.id);
      log(`Preset: Loaded '${found.name}' into Level ${index + 1}.`);
    },
    [ctx, onLevelReplaced, log]
  );

  /** Opens an editor save file (one level, or a campaign): replaces the project's levels and clears history */
  const handleRestoreLevelState = useCallback(
    (state: LevelStateData) => {
      const isCampaign = Array.isArray(state.levels) && state.levels.length > 0;
      const sources = isCampaign ? state.levels! : [{ ...state, title: state.title || 'Level 1' }];
      const levels: ProjectLevel[] = sources.map((source, i) => ({
        id: `level-${i + 1}`,
        title: source.title || `Level ${i + 1}`,
        data: storedLevelFromState(source),
      }));
      addCustomTextures([...state.customTextures, ...sources.flatMap((s) => s.customTextures ?? [])]);
      const doc = ctx.store.getState().doc;
      const campaign = state.campaign
        ? {
            carryOverHealth: state.campaign.carryOverHealth !== false,
            carryOverAmmo: state.campaign.carryOverAmmo !== false,
            ...(state.campaign.menus ? { menus: state.campaign.menus as unknown as Record<string, unknown> } : {}),
          }
        : doc.campaign;
      ctx.store.replace({ ...doc, levels, campaign });
      const target =
        typeof state.activeLevelIndex === 'number' && state.activeLevelIndex >= 0 && state.activeLevelIndex < levels.length
          ? state.activeLevelIndex
          : 0;
      setActiveLevelId(levels[target].id);
      onLevelReplaced();
      if (isCampaign) {
        log(`File: Loaded Campaign JSON (${levels.length} Gameplay Levels, active Level ${target + 1}).`);
      } else {
        log(
          state.missingModelWarnings?.length
            ? `Warning: ${state.missingModelWarnings.join(' ')}`
            : `File: Loaded Level JSON (${state.entities.length} Entities, ${state.customTextures.length} Custom Textures).`
        );
      }
    },
    [ctx, addCustomTextures, setActiveLevelId, onLevelReplaced, log]
  );

  const handleSaveLevelDataFromEditor = useCallback(
    (updated: { events: EventDefinition[]; regions: RegionDefinition[]; variables: VariableRegistrySpec }) => {
      const levelId = ctx.level().id;
      ctx.edit(
        {
          type: 'batch',
          actions: [
            { type: 'events/set', levelId, events: updated.events },
            { type: 'regions/set', levelId, regions: updated.regions },
            { type: 'variables/set', levelId, variables: updated.variables },
          ],
        },
        'Edit Visual Triggers & Events'
      );
      onEventsSaved();
      log(`Visual Triggers: Updated ${updated.events.length} events, ${updated.regions.length} regions.`);
    },
    [ctx, onEventsSaved, log]
  );

  const buildCurrentLevelState = useCallback(() => {
    const doc = ctx.store.getState().doc;
    const index = Math.max(0, doc.levels.findIndex((l) => l.id === ctx.level().id));
    return buildSaveState(doc, index, customTextures);
  }, [ctx, customTextures]);

  const handleSaveMap = useCallback(() => {
    LevelSerializer.downloadLevelJson(buildCurrentLevelState());
    log('File: Exported level state to downloadable .json file.');
  }, [buildCurrentLevelState, log]);

  const handleLoadMapFile = useCallback(
    (file: File) => {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result !== 'string') return;
        try {
          handleRestoreLevelState(LevelSerializer.parseLevelJson(reader.result));
        } catch (err) {
          log(err instanceof Error ? `Error: ${err.message}` : 'Error: Failed to parse uploaded JSON map file.');
        }
      };
      reader.readAsText(file);
    },
    [handleRestoreLevelState, log]
  );

  /** Makes the selected cell the level exit: an event that ends the level when the player steps on it */
  const handlePlaceExitOnSelectedCell = useCallback(() => {
    const { row, col } = selectedCell;
    const level = ctx.level();
    const exitEventId = `evt_exit_${row}_${col}`;
    const exitEvent: EventDefinition = {
      id: exitEventId,
      name: `Level Exit at [X:${col}, Z:${row}]`,
      enabled: true,
      trigger: { type: 'enter_cell', row, col, who: 'player' },
      conditions: [],
      actions: [{ type: 'exit_level' }],
      options: { once: true, fire: 'once' },
    };
    const others = level.data.events.filter(
      (ev) =>
        ev.id !== exitEventId &&
        !(
          ev.trigger.type === 'enter_cell' &&
          ev.trigger.row === row &&
          ev.trigger.col === col &&
          ev.actions.some((a) => a.type === 'exit_level')
        )
    );
    ctx.edit(
      {
        type: 'batch',
        actions: [
          // The exit tile must be walkable
          { type: 'cells/set', levelId: level.id, layer: activeLayer, changes: [{ row, col, cell: CellType.EMPTY }] },
          { type: 'events/set', levelId: level.id, events: [...others, exitEvent] },
        ],
      },
      `Set Level Exit at [X:${col}, Z:${row}]`
    );
    const index = ctx.store.getState().doc.levels.findIndex((l) => l.id === level.id);
    log(`Campaign Exit: Added 'exit_level' trigger on cell [X:${col}, Z:${row}]. Stepping on this cell finishes Level ${index + 1}.`);
  }, [ctx, selectedCell, activeLayer, log]);

  return {
    handleLoadPreset,
    handleRestoreLevelState,
    handleSaveLevelDataFromEditor,
    buildCurrentLevelState,
    handleSaveMap,
    handleLoadMapFile,
    handlePlaceExitOnSelectedCell,
  };
}
