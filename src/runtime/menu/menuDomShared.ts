/** Types and helpers shared by the menu renderer and its widget builders (split out in P1.4) */
import { AssetRegistry } from '../AssetRegistry';
import { TextureGenerator } from '../TextureGenerator';
import { PlayerCombatState, TextureAsset } from '../types';
import { SimulationState } from '../../sim';
import {
  MenuAction,
  MenuIconId,
  MenuRuntimeSettings,
  MenuSaveSlotSummary,
  MenuSettingTarget,
  MenuWidgetSpec,
} from './types';

export interface MenuRenderRuntimeContext {
  combatState?: PlayerCombatState;
  simState?: SimulationState;
  currentLevelIndex?: number;
  totalLevels?: number;
  currentLevelTitle?: string;
  elapsedSeconds?: number;
  settings?: MenuRuntimeSettings;
  saveSlots?: MenuSaveSlotSummary[];
  customTextures?: TextureAsset[];
  statusToast?: string | null;
}

export interface MenuDOMRendererCallbacks {
  onTriggerAction?: (action: MenuAction, widget: MenuWidgetSpec) => void;
  onChangeSetting?: (target: MenuSettingTarget, value: number | boolean) => void;
  onSaveSlot?: (slotIndex: number) => void;
  onLoadSlot?: (slotIndex: number) => void;
  onPlaySound?: (soundId: string) => void;
  /** Editor-only hook when clicking a widget in Menu Studio */
  onSelectWidgetInEditor?: (widgetId: string, e: MouseEvent) => void;
}

export const MENU_SVG_ICONS: Record<MenuIconId, string> = {
  none: '',
  play: '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="6 4 20 12 6 20 6 4"/></svg>',
  resume: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>',
  settings: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.604.852.997 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
  save: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>',
  load: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>',
  restart: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>',
  quit: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>',
  skull: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>',
  exit: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>',
  back: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>',
  key: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21 2-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>',
  shield: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
  crosshair: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="22" y1="12" x2="18" y2="12"/><line x1="6" y1="12" x2="2" y2="12"/><line x1="12" y1="6" x2="12" y2="2"/><line x1="12" y1="22" x2="12" y2="18"/></svg>',
  backpack: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="7" width="16" height="14" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="12" y1="12" x2="12" y2="16"/><line x1="10" y1="14" x2="14" y2="14"/></svg>',
};

let cachedBuiltInPreviewMap: Map<string, string> | null = null;

export function resolveMenuTexturePreviewUrl(
  textureId: string | undefined,
  customTextures?: TextureAsset[]
): string | null {
  if (!textureId) return null;
  if (customTextures) {
    const found = customTextures.find((t) => t.id === textureId);
    if (found?.previewUrl) return found.previewUrl;
  }
  const reg = AssetRegistry.getTexture(textureId);
  if (reg?.previewUrl) return reg.previewUrl;

  if (typeof document !== 'undefined') {
    if (!cachedBuiltInPreviewMap) {
      cachedBuiltInPreviewMap = new Map();
      try {
        const builtIns = TextureGenerator.getBuiltInTextureAssets();
        for (const b of builtIns) {
          if (b.previewUrl) cachedBuiltInPreviewMap.set(b.id, b.previewUrl);
        }
      } catch {
        // Ignore in headless environments without 2D canvas
      }
    }
    const builtInUrl = cachedBuiltInPreviewMap.get(textureId);
    if (builtInUrl) return builtInUrl;
  }
  return null;
}

export function formatStatReadoutText(
  widget: MenuWidgetSpec,
  ctx: MenuRenderRuntimeContext
): string {
  const health = Math.round(ctx.combatState?.health ?? 100);
  const maxHealth = Math.round(ctx.combatState?.maxHealth ?? 100);
  const ammo = Math.round(ctx.combatState?.ammo ?? 32);
  const kills = Math.round(ctx.combatState?.kills ?? 0);
  const totalEnemies = Math.round(ctx.combatState?.totalEnemies ?? 0);
  const secrets = Math.round(ctx.simState?.secretsFound ?? 0);
  const levelTitle =
    ctx.currentLevelTitle ||
    `Level ${(ctx.currentLevelIndex ?? 0) + 1}`;
  const secs = Math.floor(
    ctx.elapsedSeconds ??
      (ctx.simState ? ctx.simState.tick / 35 : 0)
  );
  const mm = String(Math.floor(secs / 60)).padStart(2, '0');
  const ss = String(secs % 60).padStart(2, '0');
  const timeStr = `${mm}:${ss}`;

  const binding = widget.statBinding;
  if (!binding) return widget.text || '';

  let rawValue = '';
  switch (binding.source) {
    case 'health':
      rawValue = `${health}/${maxHealth}`;
      break;
    case 'ammo':
      rawValue = `${ammo}`;
      break;
    case 'kills':
      rawValue = `${kills}/${totalEnemies}`;
      break;
    case 'secrets':
      rawValue = `${secrets}`;
      break;
    case 'level-title':
      rawValue = levelTitle;
      break;
    case 'time':
      rawValue = timeStr;
      break;
    case 'sim-flag': {
      const k = binding.variableKey || '';
      const flagVal = ctx.simState?.flags?.[k] ?? false;
      rawValue = flagVal ? 'ACTIVE' : 'INACTIVE';
      break;
    }
    case 'sim-counter': {
      const k = binding.variableKey || '';
      const countVal = ctx.simState?.counters?.[k] ?? 0;
      rawValue = String(countVal);
      break;
    }
  }

  if (binding.formatTemplate && binding.formatTemplate.trim()) {
    return binding.formatTemplate
      .replace(/\{value\}/gi, rawValue)
      .replace(/\{health\}/gi, String(health))
      .replace(/\{maxHealth\}/gi, String(maxHealth))
      .replace(/\{ammo\}/gi, String(ammo))
      .replace(/\{kills\}/gi, `${kills}/${totalEnemies}`)
      .replace(/\{secrets\}/gi, String(secrets))
      .replace(/\{level\}/gi, levelTitle)
      .replace(/\{time\}/gi, timeStr);
  }

  return `${widget.text ? `${widget.text}: ` : ''}${rawValue}`;
}
