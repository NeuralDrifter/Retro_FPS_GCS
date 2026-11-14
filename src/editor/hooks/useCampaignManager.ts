/**
 * Campaign levels (add, duplicate, delete, reorder, rename, switch) and carry-over settings.
 * The levels are the project document's `levels`; switching levels only changes which one the
 * editor shows, so undo history spans the whole campaign (release plan P2.4).
 */
import { useCallback } from 'react';
import { CampaignSettings, CellType } from '../types/engine';
import type { ProjectDocV4 } from '../../shared/project';
import { storedLevelFrom } from '../store/levelView';
import { newLevelId } from '../store/useEditorDocument';
import type { DocContext } from '../store/useEditorDocument';

const DEFAULT_LEVEL_GRID_SIZE = 16;

const titleAt = (levels: ProjectDocV4['levels'], index: number) => levels[index]?.title || `Level ${index + 1}`;

export interface UseCampaignManagerOptions {
  ctx: DocContext;
  doc: ProjectDocV4;
  activeIndex: number;
  setActiveLevelId: (id: string) => void;
  /** Resets per-level editor state (layer, selection, playtest) after switching levels */
  onLevelSwitched: () => void;
}

export function useCampaignManager({ ctx, doc, activeIndex, setActiveLevelId, onLevelSwitched }: UseCampaignManagerOptions) {
  const { log } = ctx;
  const levels = doc.levels;

  const switchTo = useCallback(
    (id: string) => {
      setActiveLevelId(id);
      onLevelSwitched();
    },
    [setActiveLevelId, onLevelSwitched]
  );

  const handleSelectCampaignLevel = useCallback(
    (targetIndex: number) => {
      if (targetIndex < 0 || targetIndex >= levels.length || targetIndex === activeIndex) return;
      switchTo(levels[targetIndex].id);
      log(`Campaign: Switched editor to Level ${targetIndex + 1}/${levels.length} ('${titleAt(levels, targetIndex)}').`);
    },
    [levels, activeIndex, switchTo, log]
  );

  const handleRenameCampaignLevel = useCallback(
    (nextTitle: string) => {
      ctx.edit({ type: 'level/rename', levelId: ctx.level().id, title: nextTitle }, `Rename level to '${nextTitle}'`);
    },
    [ctx]
  );

  const handleAddCampaignLevel = useCallback(() => {
    const current = ctx.view();
    const document = ctx.store.getState().doc;
    const newIndex = document.levels.length;
    const title = `Level ${newIndex + 1}: Sector ${newIndex + 1}`;
    const size = DEFAULT_LEVEL_GRID_SIZE;
    const edge = (i: number) => i === 0 || i === size - 1;
    const uniform = (id: string) => Array.from({ length: size }, () => new Array<string>(size).fill(id));
    const id = newLevelId(document);
    const data = storedLevelFrom({
      title,
      grid: Array.from({ length: size }, (_, r) =>
        Array.from({ length: size }, (_cell, c) => (edge(r) || edge(c) ? CellType.WALL : CellType.EMPTY))
      ),
      wallTextures: uniform('default-grid'),
      floorTextures: uniform('floor-obsidian'),
      ceilingTextures: uniform('ceiling-coffer'),
      entities: [],
      nextEntityId: 1,
      spawn: { row: Math.floor(size / 2), col: Math.floor(size / 2), yaw: 0 },
      skyboxTheme: current.skyboxTheme,
      skyboxSeed: current.skyboxSeed + 1,
      showCeiling: false,
      minimapEnabled: true,
    });
    ctx.edit({ type: 'level/add', level: { id, title, data } }, `Add level '${title}'`);
    switchTo(id);
    log(`Campaign: Added Level ${newIndex + 1}/${newIndex + 1} ('${title}').`);
  }, [ctx, switchTo, log]);

  const handleDuplicateCampaignLevel = useCallback(() => {
    const source = ctx.level();
    const document = ctx.store.getState().doc;
    const title = `${source.title || `Level ${activeIndex + 1}`} (Copy)`;
    const id = newLevelId(document);
    const insertIndex = activeIndex + 1;
    // The document never changes in place, so the copy can share the original's data
    ctx.edit({ type: 'level/add', level: { id, title, data: source.data }, index: insertIndex }, `Duplicate level '${source.title}'`);
    switchTo(id);
    log(`Campaign: Duplicated into Level ${insertIndex + 1}/${document.levels.length + 1} ('${title}').`);
  }, [ctx, activeIndex, switchTo, log]);

  const handleDeleteCampaignLevel = useCallback(
    (deleteIndex: number) => {
      if (levels.length <= 1) {
        log('Campaign: A game must have at least 1 level.');
        return;
      }
      const target = levels[deleteIndex];
      if (!target) return;
      const remaining = levels.filter((_, i) => i !== deleteIndex);
      const nextActive = deleteIndex < activeIndex ? activeIndex - 1 : Math.min(activeIndex, remaining.length - 1);
      ctx.edit({ type: 'level/remove', levelId: target.id }, `Delete level '${titleAt(levels, deleteIndex)}'`);
      switchTo(remaining[nextActive].id);
      log(`Campaign: Deleted '${titleAt(levels, deleteIndex)}'. Active level is now ${nextActive + 1}/${remaining.length}.`);
    },
    [ctx, levels, activeIndex, switchTo, log]
  );

  const handleMoveCampaignLevel = useCallback(
    (index: number, direction: -1 | 1) => {
      const target = levels[index];
      const toIndex = index + direction;
      if (!target || toIndex < 0 || toIndex >= levels.length) return;
      ctx.edit({ type: 'level/move', levelId: target.id, toIndex }, `Move level '${titleAt(levels, index)}'`);
      log(`Campaign: Moved '${titleAt(levels, index)}' to position #${toIndex + 1}.`);
    },
    [ctx, levels, log]
  );

  const handleUpdateCampaignSettings = useCallback(
    (next: CampaignSettings) => {
      ctx.edit(
        {
          type: 'campaign/update',
          patch: {
            carryOverHealth: next.carryOverHealth,
            carryOverAmmo: next.carryOverAmmo,
            ...(next.menus ? { menus: next.menus as unknown as Record<string, unknown> } : {}),
          },
        },
        'Edit campaign settings'
      );
      log(`Campaign Carry-Over: Health=${next.carryOverHealth ? 'ON' : 'OFF'}, Ammo=${next.carryOverAmmo ? 'ON' : 'OFF'}.`);
    },
    [ctx, log]
  );

  return {
    handleSelectCampaignLevel,
    handleRenameCampaignLevel,
    handleAddCampaignLevel,
    handleDuplicateCampaignLevel,
    handleDeleteCampaignLevel,
    handleMoveCampaignLevel,
    handleUpdateCampaignSettings,
  };
}
