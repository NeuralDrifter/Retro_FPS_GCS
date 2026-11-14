import React, { useState } from 'react';
import {
  Sliders,
  Zap,
  Monitor,
  AlignCenterHorizontal,
  AlignCenterVertical,
  ArrowUpToLine,
  ArrowDownToLine,
  Trash2,
  Copy,
  Image as ImageIcon,
  Layers,
  Sparkles,
  Volume2,
} from 'lucide-react';
import {
  MenuPackSpec,
  MenuScreenSpec,
  MenuWidgetSpec,
  MenuButtonShape,
  MenuFontFamily,
  MenuAction,
  MenuActionType,
  MenuStatBindingSource,
  MenuSettingTarget,
  MenuOverlayHotkey,
  TextureAsset,
} from '../../types/engine';

interface MenuInspectorProps {
  menuPack: MenuPackSpec;
  activeScreen: MenuScreenSpec;
  selectedWidget: MenuWidgetSpec | null;
  textures: TextureAsset[];
  campaignLevelNames: string[];
  onUpdatePack: (updater: (prev: MenuPackSpec) => MenuPackSpec) => void;
  onUpdateScreen: (updater: (prev: MenuScreenSpec) => MenuScreenSpec) => void;
  onUpdateWidget: (widgetId: string, updater: (prev: MenuWidgetSpec) => MenuWidgetSpec) => void;
  onDuplicateWidget: (widgetId: string) => void;
  onDeleteWidget: (widgetId: string) => void;
}

type InspectorTab = 'style' | 'actions' | 'screen';

const BUILTIN_PROCEDURAL_TEXTURES: Array<{ id: string; name: string }> = [
  { id: 'cyber_grid', name: 'Cyber Grid (Procedural)' },
  { id: 'dark_metal', name: 'Dark Brushed Metal' },
  { id: 'hazard_stripes', name: 'Hazard Stripes' },
  { id: 'tech_panel', name: 'Tech Carbon Panel' },
];

export const MenuInspector: React.FC<MenuInspectorProps> = ({
  menuPack,
  activeScreen,
  selectedWidget,
  textures,
  campaignLevelNames,
  onUpdatePack,
  onUpdateScreen,
  onUpdateWidget,
  onDuplicateWidget,
  onDeleteWidget,
}) => {
  const [activeTab, setActiveTab] = useState<InspectorTab>('style');

  const allTextureChoices = [
    ...BUILTIN_PROCEDURAL_TEXTURES,
    ...textures.map((t) => ({ id: t.id, name: `${t.name} (Custom)` })),
  ];

  const handleActionTypeChange = (widget: MenuWidgetSpec, nextType: MenuActionType) => {
    let nextAction: MenuAction;
    switch (nextType) {
      case 'START_NEW_GAME':
        nextAction = { type: 'START_NEW_GAME', startLevelIndex: 0 };
        break;
      case 'RESUME_GAME':
        nextAction = { type: 'RESUME_GAME' };
        break;
      case 'OPEN_MENU_SCREEN':
        nextAction = {
          type: 'OPEN_MENU_SCREEN',
          screenId: menuPack.screens.find((s) => s.id !== activeScreen.id)?.id || activeScreen.id,
        };
        break;
      case 'BACK_MENU_SCREEN':
        nextAction = { type: 'BACK_MENU_SCREEN' };
        break;
      case 'RESTART_CURRENT_LEVEL':
        nextAction = { type: 'RESTART_CURRENT_LEVEL' };
        break;
      case 'SAVE_GAME_SLOT':
        nextAction = { type: 'SAVE_GAME_SLOT', slotIndex: 0 };
        break;
      case 'LOAD_GAME_SLOT':
        nextAction = { type: 'LOAD_GAME_SLOT', slotIndex: 0 };
        break;
      case 'FIRE_SIM_EVENT':
        nextAction = {
          type: 'FIRE_SIM_EVENT',
          flagName: 'custom_menu_event',
          flagValue: true,
        };
        break;
      case 'QUIT_TO_MAIN_MENU':
        nextAction = { type: 'QUIT_TO_MAIN_MENU' };
        break;
    }

    onUpdateWidget(widget.id, (prev) => ({
      ...prev,
      onClickAction: nextAction,
    }));
  };

  return (
    <aside className="w-[320px] ide-inspector flex flex-col select-none shrink-0 z-10 overflow-hidden">
      {/* Top Tab Bar */}
      <div className="h-9 border-b border-[#27272a] bg-[#141518] flex items-center px-1.5 gap-1 shrink-0">
        <button
          onClick={() => setActiveTab('style')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded text-[11px] font-medium transition-colors whitespace-nowrap ${
            activeTab === 'style'
              ? 'bg-amber-500/15 text-amber-300 border border-amber-500/40'
              : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60 border border-transparent'
          }`}
        >
          <Sliders size={12} /> Style & Skin
        </button>
        <button
          onClick={() => setActiveTab('actions')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded text-[11px] font-medium transition-colors whitespace-nowrap ${
            activeTab === 'actions'
              ? 'bg-amber-500/15 text-amber-300 border border-amber-500/40'
              : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60 border border-transparent'
          }`}
        >
          <Zap size={12} /> Logic & Data
        </button>
        <button
          onClick={() => setActiveTab('screen')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded text-[11px] font-medium transition-colors whitespace-nowrap ${
            activeTab === 'screen'
              ? 'bg-amber-500/15 text-amber-300 border border-amber-500/40'
              : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60 border border-transparent'
          }`}
        >
          <Monitor size={12} /> Screen / BG
        </button>
      </div>

      {/* Scrollable Inspector Body */}
      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {activeTab === 'style' && (
          <>
            {!selectedWidget ? (
              <div className="p-4 rounded border border-zinc-800 bg-zinc-900/40 text-center space-y-2">
                <Layers size={20} className="mx-auto text-zinc-500" />
                <p className="text-xs font-medium text-zinc-300">No Widget Selected</p>
                <p className="text-[11px] text-zinc-500">
                  Select any element on the 16:9 canvas or from the Screen Layers list to customize its shape, custom texture, and typography.
                </p>
                <button
                  onClick={() => setActiveTab('screen')}
                  className="mt-2 px-3 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-[11px] font-medium transition-colors"
                >
                  Configure Screen Background & Overlay
                </button>
              </div>
            ) : (
              <>
                {/* Widget Identity & Quick Actions */}
                <div className="space-y-2.5 pb-3 border-b border-zinc-800">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30">
                      {selectedWidget.type}
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => onDuplicateWidget(selectedWidget.id)}
                        className="p-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors"
                        title="Duplicate Widget"
                      >
                        <Copy size={12} />
                      </button>
                      <button
                        onClick={() => onDeleteWidget(selectedWidget.id)}
                        className="p-1 rounded bg-zinc-800 hover:bg-red-950/60 text-zinc-400 hover:text-red-400 transition-colors"
                        title="Delete Widget"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-[10px] text-zinc-400 mb-1">Layer Name</label>
                    <input
                      type="text"
                      value={selectedWidget.name}
                      onChange={(e) =>
                        onUpdateWidget(selectedWidget.id, (w) => ({ ...w, name: e.target.value }))
                      }
                      className="w-full ide-input text-xs"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] text-zinc-400 mb-1">Primary Label / Title Text</label>
                    <input
                      type="text"
                      value={selectedWidget.text || ''}
                      onChange={(e) =>
                        onUpdateWidget(selectedWidget.id, (w) => ({ ...w, text: e.target.value }))
                      }
                      placeholder="Label text..."
                      className="w-full ide-input text-xs"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] text-zinc-400 mb-1">Subtitle / Helper Text</label>
                    <input
                      type="text"
                      value={selectedWidget.subtitleText || ''}
                      onChange={(e) =>
                        onUpdateWidget(selectedWidget.id, (w) => ({
                          ...w,
                          subtitleText: e.target.value,
                        }))
                      }
                      placeholder="Optional subtitle or hint..."
                      className="w-full ide-input text-xs"
                    />
                  </div>

                  {selectedWidget.type === 'button' && (
                    <div>
                      <label className="block text-[10px] text-zinc-400 mb-1">Button Icon Badge</label>
                      <select
                        value={selectedWidget.iconId || 'none'}
                        onChange={(e) =>
                          onUpdateWidget(selectedWidget.id, (w) => ({
                            ...w,
                            iconId: e.target.value as MenuWidgetSpec['iconId'],
                          }))
                        }
                        className="w-full ide-input text-xs"
                      >
                        <option value="none">None</option>
                        <option value="play">Play Triangle (▶)</option>
                        <option value="resume">Resume (⏵)</option>
                        <option value="settings">Settings Gear (⚙)</option>
                        <option value="save">Save Diamond (◆)</option>
                        <option value="load">Load Diamond (◇)</option>
                        <option value="backpack">Inventory Grid (▦)</option>
                        <option value="skull">Skull / Quit (✕)</option>
                        <option value="exit">Return Arrow (↩)</option>
                      </select>
                    </div>
                  )}
                </div>

                {/* Normalized Rect & Alignment */}
                <div className="space-y-2.5 pb-3 border-b border-zinc-800">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-zinc-300">Canvas Rect (%)</span>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() =>
                          onUpdateWidget(selectedWidget.id, (w) => ({
                            ...w,
                            rect: {
                              ...w.rect,
                              xPct: Math.round((50 - w.rect.widthPct / 2) * 10) / 10,
                            },
                          }))
                        }
                        className="px-1.5 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-[10px] flex items-center gap-1"
                        title="Center Horizontally"
                      >
                        <AlignCenterHorizontal size={11} /> Center X
                      </button>
                      <button
                        onClick={() =>
                          onUpdateWidget(selectedWidget.id, (w) => ({
                            ...w,
                            rect: {
                              ...w.rect,
                              yPct: Math.round((50 - w.rect.heightPct / 2) * 10) / 10,
                            },
                          }))
                        }
                        className="px-1.5 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-[10px] flex items-center gap-1"
                        title="Center Vertically"
                      >
                        <AlignCenterVertical size={11} /> Center Y
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[10px] text-zinc-500 mb-0.5">X Position (%)</label>
                      <input
                        type="number"
                        step="0.5"
                        min={0}
                        max={98}
                        value={selectedWidget.rect.xPct}
                        onChange={(e) =>
                          onUpdateWidget(selectedWidget.id, (w) => ({
                            ...w,
                            rect: { ...w.rect, xPct: Number(e.target.value) || 0 },
                          }))
                        }
                        className="w-full ide-input text-xs font-mono tabular-nums"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-zinc-500 mb-0.5">Y Position (%)</label>
                      <input
                        type="number"
                        step="0.5"
                        min={0}
                        max={98}
                        value={selectedWidget.rect.yPct}
                        onChange={(e) =>
                          onUpdateWidget(selectedWidget.id, (w) => ({
                            ...w,
                            rect: { ...w.rect, yPct: Number(e.target.value) || 0 },
                          }))
                        }
                        className="w-full ide-input text-xs font-mono tabular-nums"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-zinc-500 mb-0.5">Width (%)</label>
                      <input
                        type="number"
                        step="0.5"
                        min={4}
                        max={100}
                        value={selectedWidget.rect.widthPct}
                        onChange={(e) =>
                          onUpdateWidget(selectedWidget.id, (w) => ({
                            ...w,
                            rect: { ...w.rect, widthPct: Math.max(4, Number(e.target.value) || 4) },
                          }))
                        }
                        className="w-full ide-input text-xs font-mono tabular-nums"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-zinc-500 mb-0.5">Height (%)</label>
                      <input
                        type="number"
                        step="0.5"
                        min={3}
                        max={100}
                        value={selectedWidget.rect.heightPct}
                        onChange={(e) =>
                          onUpdateWidget(selectedWidget.id, (w) => ({
                            ...w,
                            rect: { ...w.rect, heightPct: Math.max(3, Number(e.target.value) || 3) },
                          }))
                        }
                        className="w-full ide-input text-xs font-mono tabular-nums"
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] text-zinc-400">Z-Index:</span>
                      <input
                        type="number"
                        value={selectedWidget.rect.zIndex}
                        onChange={(e) =>
                          onUpdateWidget(selectedWidget.id, (w) => ({
                            ...w,
                            rect: { ...w.rect, zIndex: Number(e.target.value) || 1 },
                          }))
                        }
                        className="w-16 ide-input text-xs font-mono tabular-nums"
                      />
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() =>
                          onUpdateWidget(selectedWidget.id, (w) => ({
                            ...w,
                            rect: { ...w.rect, zIndex: w.rect.zIndex + 5 },
                          }))
                        }
                        className="px-1.5 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-[10px] flex items-center gap-1"
                        title="Bring Forward"
                      >
                        <ArrowUpToLine size={11} /> Front
                      </button>
                      <button
                        onClick={() =>
                          onUpdateWidget(selectedWidget.id, (w) => ({
                            ...w,
                            rect: { ...w.rect, zIndex: Math.max(1, w.rect.zIndex - 5) },
                          }))
                        }
                        className="px-1.5 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-[10px] flex items-center gap-1"
                        title="Send Backward"
                      >
                        <ArrowDownToLine size={11} /> Back
                      </button>
                    </div>
                  </div>
                </div>

                {/* Shape, Colors & Custom Texture Skin */}
                <div className="space-y-2.5 pb-3 border-b border-zinc-800">
                  <span className="text-[11px] font-semibold text-zinc-300 block">
                    Shape & Custom Texture Skin
                  </span>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[10px] text-zinc-400 mb-1">Button / Panel Shape</label>
                      <select
                        value={selectedWidget.style.shape}
                        onChange={(e) =>
                          onUpdateWidget(selectedWidget.id, (w) => ({
                            ...w,
                            style: { ...w.style, shape: e.target.value as MenuButtonShape },
                          }))
                        }
                        className="w-full ide-input text-xs"
                      >
                        <option value="chamfered">Chamfered (45° Cut)</option>
                        <option value="rounded">Rounded Corners</option>
                        <option value="rectangle">Sharp Rectangle</option>
                        <option value="pill">Capsule / Pill</option>
                        <option value="underline">Minimal Underline</option>
                      </select>
                    </div>

                    {selectedWidget.style.shape === 'chamfered' ? (
                      <div>
                        <label className="block text-[10px] text-zinc-400 mb-1">Chamfer Cut (px)</label>
                        <input
                          type="number"
                          min={2}
                          max={32}
                          value={selectedWidget.style.chamferSizePx}
                          onChange={(e) =>
                            onUpdateWidget(selectedWidget.id, (w) => ({
                              ...w,
                              style: {
                                ...w.style,
                                chamferSizePx: Math.max(2, Number(e.target.value) || 8),
                              },
                            }))
                          }
                          className="w-full ide-input text-xs font-mono tabular-nums"
                        />
                      </div>
                    ) : (
                      <div>
                        <label className="block text-[10px] text-zinc-400 mb-1">Corner Radius (px)</label>
                        <input
                          type="number"
                          min={0}
                          max={48}
                          value={selectedWidget.style.borderRadiusPx}
                          onChange={(e) =>
                            onUpdateWidget(selectedWidget.id, (w) => ({
                              ...w,
                              style: {
                                ...w.style,
                                borderRadiusPx: Math.max(0, Number(e.target.value) || 0),
                              },
                            }))
                          }
                          className="w-full ide-input text-xs font-mono tabular-nums"
                        />
                      </div>
                    )}
                  </div>

                  {/* Fill & Border Colors */}
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[10px] text-zinc-400 mb-1">Background Fill (CSS)</label>
                      <input
                        type="text"
                        value={selectedWidget.style.bgColorRgba}
                        onChange={(e) =>
                          onUpdateWidget(selectedWidget.id, (w) => ({
                            ...w,
                            style: { ...w.style, bgColorRgba: e.target.value },
                          }))
                        }
                        className="w-full ide-input text-xs font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-zinc-400 mb-1">Border Color</label>
                      <div className="flex items-center gap-1.5">
                        <input
                          type="color"
                          value={
                            selectedWidget.style.borderColorHex.startsWith('#')
                              ? selectedWidget.style.borderColorHex.slice(0, 7)
                              : '#f59e0b'
                          }
                          onChange={(e) =>
                            onUpdateWidget(selectedWidget.id, (w) => ({
                              ...w,
                              style: { ...w.style, borderColorHex: e.target.value },
                            }))
                          }
                          className="w-7 h-7 rounded bg-zinc-900 border border-zinc-700 cursor-pointer p-0.5"
                        />
                        <input
                          type="text"
                          value={selectedWidget.style.borderColorHex}
                          onChange={(e) =>
                            onUpdateWidget(selectedWidget.id, (w) => ({
                              ...w,
                              style: { ...w.style, borderColorHex: e.target.value },
                            }))
                          }
                          className="flex-1 ide-input text-xs font-mono"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Custom Texture Skin Selector */}
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[10px] text-zinc-400 mb-1">UI Surface Texture</label>
                      <select
                        value={selectedWidget.style.backgroundTextureId || ''}
                        onChange={(e) =>
                          onUpdateWidget(selectedWidget.id, (w) => ({
                            ...w,
                            style: {
                              ...w.style,
                              backgroundTextureId: e.target.value || undefined,
                            },
                          }))
                        }
                        className="w-full ide-input text-xs"
                      >
                        <option value="">None (Solid / Tint Only)</option>
                        {allTextureChoices.map((tex) => (
                          <option key={tex.id} value={tex.id}>
                            {tex.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10px] text-zinc-400 mb-1">Texture Mapping</label>
                      <select
                        value={selectedWidget.style.textureFit || 'stretch'}
                        onChange={(e) =>
                          onUpdateWidget(selectedWidget.id, (w) => ({
                            ...w,
                            style: {
                              ...w.style,
                              textureFit: e.target.value as 'stretch' | 'tile' | '9-slice',
                            },
                          }))
                        }
                        className="w-full ide-input text-xs"
                      >
                        <option value="stretch">Stretch Cover</option>
                        <option value="tile">Repeat Tile (64px)</option>
                        <option value="9-slice">9-Slice Frame</option>
                      </select>
                    </div>
                  </div>

                  {selectedWidget.type === 'image' && (
                    <div>
                      <label className="block text-[10px] text-zinc-400 mb-1 flex items-center gap-1">
                        <ImageIcon size={11} className="text-amber-400" /> Foreground Image / Emblem Texture
                      </label>
                      <select
                        value={selectedWidget.imageTextureId || ''}
                        onChange={(e) =>
                          onUpdateWidget(selectedWidget.id, (w) => ({
                            ...w,
                            imageTextureId: e.target.value || undefined,
                          }))
                        }
                        className="w-full ide-input text-xs"
                      >
                        <option value="">Default GridForge Vector Crest</option>
                        {allTextureChoices.map((tex) => (
                          <option key={tex.id} value={tex.id}>
                            {tex.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>

                {/* Typography Controls */}
                <div className="space-y-2.5">
                  <span className="text-[11px] font-semibold text-zinc-300 block">
                    Typography & Hover State
                  </span>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[10px] text-zinc-400 mb-1">Font Family</label>
                      <select
                        value={selectedWidget.style.fontFamily}
                        onChange={(e) =>
                          onUpdateWidget(selectedWidget.id, (w) => ({
                            ...w,
                            style: { ...w.style, fontFamily: e.target.value as MenuFontFamily },
                          }))
                        }
                        className="w-full ide-input text-xs"
                      >
                        <option value="display">Display Tactical</option>
                        <option value="mono">Monospace Telemetry</option>
                        <option value="sans">Clean Geometric Sans</option>
                        <option value="serif">Classic Retro Serif</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10px] text-zinc-400 mb-1">Font Size (px)</label>
                      <input
                        type="number"
                        min={10}
                        max={96}
                        value={selectedWidget.style.fontSizePx}
                        onChange={(e) =>
                          onUpdateWidget(selectedWidget.id, (w) => ({
                            ...w,
                            style: {
                              ...w.style,
                              fontSizePx: Math.max(10, Number(e.target.value) || 14),
                            },
                          }))
                        }
                        className="w-full ide-input text-xs font-mono tabular-nums"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[10px] text-zinc-400 mb-1">Text Color</label>
                      <div className="flex items-center gap-1.5">
                        <input
                          type="color"
                          value={
                            selectedWidget.style.textColorHex.startsWith('#')
                              ? selectedWidget.style.textColorHex.slice(0, 7)
                              : '#f4f4f5'
                          }
                          onChange={(e) =>
                            onUpdateWidget(selectedWidget.id, (w) => ({
                              ...w,
                              style: { ...w.style, textColorHex: e.target.value },
                            }))
                          }
                          className="w-7 h-7 rounded bg-zinc-900 border border-zinc-700 cursor-pointer p-0.5"
                        />
                        <input
                          type="text"
                          value={selectedWidget.style.textColorHex}
                          onChange={(e) =>
                            onUpdateWidget(selectedWidget.id, (w) => ({
                              ...w,
                              style: { ...w.style, textColorHex: e.target.value },
                            }))
                          }
                          className="flex-1 ide-input text-xs font-mono"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-[10px] text-zinc-400 mb-1">Alignment</label>
                      <select
                        value={selectedWidget.style.textAlign}
                        onChange={(e) =>
                          onUpdateWidget(selectedWidget.id, (w) => ({
                            ...w,
                            style: {
                              ...w.style,
                              textAlign: e.target.value as 'left' | 'center' | 'right',
                            },
                          }))
                        }
                        className="w-full ide-input text-xs"
                      >
                        <option value="left">Left</option>
                        <option value="center">Center</option>
                        <option value="right">Right</option>
                      </select>
                    </div>
                  </div>
                </div>
              </>
            )}
          </>
        )}

        {activeTab === 'actions' && (
          <>
            {!selectedWidget ? (
              <div className="p-4 rounded border border-zinc-800 bg-zinc-900/40 text-center space-y-2">
                <Zap size={20} className="mx-auto text-zinc-500" />
                <p className="text-xs font-medium text-zinc-300">Select a Widget to Bind Logic</p>
                <p className="text-[11px] text-zinc-500">
                  Buttons can dispatch game state transitions, checkpoint saves, or deterministic Sim Events. Stat readouts and settings controls bind directly to live engine variables.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="pb-2 border-b border-zinc-800">
                  <div className="text-xs font-semibold text-zinc-200">{selectedWidget.name}</div>
                  <div className="text-[10px] text-zinc-500 font-mono uppercase">
                    Widget Type: {selectedWidget.type}
                  </div>
                </div>

                {selectedWidget.type === 'button' && (
                  <div className="space-y-3">
                    <div>
                      <label className="block text-[10px] font-semibold uppercase tracking-wider text-amber-400 mb-1">
                        On-Click Engine Action
                      </label>
                      <select
                        value={selectedWidget.onClickAction?.type || 'START_NEW_GAME'}
                        onChange={(e) =>
                          handleActionTypeChange(selectedWidget, e.target.value as MenuActionType)
                        }
                        className="w-full ide-input text-xs"
                      >
                        <option value="START_NEW_GAME">Start Game / Launch Level</option>
                        <option value="RESUME_GAME">Resume Active Game (Close Overlay)</option>
                        <option value="OPEN_MENU_SCREEN">Navigate to Menu Screen</option>
                        <option value="BACK_MENU_SCREEN">Return to Previous Screen</option>
                        <option value="RESTART_CURRENT_LEVEL">Restart Current Level</option>
                        <option value="SAVE_GAME_SLOT">Save Checkpoint to Slot</option>
                        <option value="LOAD_GAME_SLOT">Load Checkpoint from Slot</option>
                        <option value="FIRE_SIM_EVENT">Fire Deterministic Sim Flag / Counter</option>
                        <option value="QUIT_TO_MAIN_MENU">Quit to Main Menu Screen</option>
                      </select>
                    </div>

                    {selectedWidget.onClickAction?.type === 'START_NEW_GAME' && (
                      <div>
                        <label className="block text-[10px] text-zinc-400 mb-1">
                          Starting Campaign Level
                        </label>
                        <select
                          value={selectedWidget.onClickAction.startLevelIndex ?? 0}
                          onChange={(e) =>
                            onUpdateWidget(selectedWidget.id, (w) => ({
                              ...w,
                              onClickAction: {
                                type: 'START_NEW_GAME',
                                startLevelIndex: Number(e.target.value) || 0,
                              },
                            }))
                          }
                          className="w-full ide-input text-xs"
                        >
                          {campaignLevelNames.map((name, idx) => (
                            <option key={idx} value={idx}>
                              Level {idx + 1}: {name}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    {selectedWidget.onClickAction?.type === 'OPEN_MENU_SCREEN' && (
                      <div>
                        <label className="block text-[10px] text-zinc-400 mb-1">
                          Target Menu Screen
                        </label>
                        <select
                          value={selectedWidget.onClickAction.screenId}
                          onChange={(e) =>
                            onUpdateWidget(selectedWidget.id, (w) => ({
                              ...w,
                              onClickAction: {
                                type: 'OPEN_MENU_SCREEN',
                                screenId: e.target.value,
                              },
                            }))
                          }
                          className="w-full ide-input text-xs"
                        >
                          {menuPack.screens.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name} ({s.category})
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    {(selectedWidget.onClickAction?.type === 'SAVE_GAME_SLOT' ||
                      selectedWidget.onClickAction?.type === 'LOAD_GAME_SLOT') && (
                      <div>
                        <label className="block text-[10px] text-zinc-400 mb-1">
                          Target Save Slot
                        </label>
                        <select
                          value={selectedWidget.onClickAction.slotIndex}
                          onChange={(e) => {
                            const slotIndex = Number(e.target.value) as 0 | 1 | 2;
                            const actionType = selectedWidget.onClickAction!.type as
                              | 'SAVE_GAME_SLOT'
                              | 'LOAD_GAME_SLOT';
                            onUpdateWidget(selectedWidget.id, (w) => ({
                              ...w,
                              onClickAction: { type: actionType, slotIndex },
                            }));
                          }}
                          className="w-full ide-input text-xs"
                        >
                          <option value={0}>Slot 01 (Quick Save)</option>
                          <option value={1}>Slot 02 (Checkpoint Alpha)</option>
                          <option value={2}>Slot 03 (Checkpoint Bravo)</option>
                        </select>
                      </div>
                    )}

                    {selectedWidget.onClickAction?.type === 'FIRE_SIM_EVENT' && (
                      <div className="space-y-2 p-2.5 rounded bg-zinc-900/70 border border-zinc-800">
                        <div>
                          <label className="block text-[10px] text-zinc-400 mb-1">
                            Simulation Flag Name
                          </label>
                          <input
                            type="text"
                            value={selectedWidget.onClickAction.flagName || ''}
                            onChange={(e) =>
                              onUpdateWidget(selectedWidget.id, (w) => ({
                                ...w,
                                onClickAction: {
                                  ...(w.onClickAction as Extract<
                                    MenuAction,
                                    { type: 'FIRE_SIM_EVENT' }
                                  >),
                                  flagName: e.target.value,
                                },
                              }))
                            }
                            placeholder="e.g. bridge_unlocked"
                            className="w-full ide-input text-xs font-mono"
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="block text-[10px] text-zinc-400 mb-1">
                              Counter Name (Optional)
                            </label>
                            <input
                              type="text"
                              value={selectedWidget.onClickAction.counterName || ''}
                              onChange={(e) =>
                                onUpdateWidget(selectedWidget.id, (w) => ({
                                  ...w,
                                  onClickAction: {
                                    ...(w.onClickAction as Extract<
                                      MenuAction,
                                      { type: 'FIRE_SIM_EVENT' }
                                    >),
                                    counterName: e.target.value || undefined,
                                  },
                                }))
                              }
                              placeholder="security_tokens"
                              className="w-full ide-input text-xs font-mono"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] text-zinc-400 mb-1">
                              Counter Delta
                            </label>
                            <input
                              type="number"
                              value={selectedWidget.onClickAction.counterDelta ?? 1}
                              onChange={(e) =>
                                onUpdateWidget(selectedWidget.id, (w) => ({
                                  ...w,
                                  onClickAction: {
                                    ...(w.onClickAction as Extract<
                                      MenuAction,
                                      { type: 'FIRE_SIM_EVENT' }
                                    >),
                                    counterDelta: Number(e.target.value) || 0,
                                  },
                                }))
                              }
                              className="w-full ide-input text-xs font-mono tabular-nums"
                            />
                          </div>
                        </div>
                      </div>
                    )}

                    {/* UI Audio Feedback */}
                    <div className="pt-2 border-t border-zinc-800 space-y-2">
                      <span className="text-[10px] font-semibold text-zinc-400 flex items-center gap-1">
                        <Volume2 size={11} /> Audio Feedback
                      </span>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-[10px] text-zinc-500 mb-0.5">Click Sound</label>
                          <select
                            value={selectedWidget.clickSoundId || 'ui-click'}
                            onChange={(e) =>
                              onUpdateWidget(selectedWidget.id, (w) => ({
                                ...w,
                                clickSoundId: e.target.value as MenuWidgetSpec['clickSoundId'],
                              }))
                            }
                            className="w-full ide-input text-xs"
                          >
                            <option value="ui-click">Tactical Click</option>
                            <option value="ui-confirm">Confirm Chime</option>
                            <option value="ui-back">Back Low Pulse</option>
                            <option value="none">Muted</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-[10px] text-zinc-500 mb-0.5">Hover Sound</label>
                          <select
                            value={selectedWidget.hoverSoundId || 'ui-hover'}
                            onChange={(e) =>
                              onUpdateWidget(selectedWidget.id, (w) => ({
                                ...w,
                                hoverSoundId: e.target.value as MenuWidgetSpec['hoverSoundId'],
                              }))
                            }
                            className="w-full ide-input text-xs"
                          >
                            <option value="ui-hover">Subtle Tick</option>
                            <option value="none">Muted</option>
                          </select>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {selectedWidget.type === 'stat-readout' && (
                  <div className="space-y-3">
                    <div>
                      <label className="block text-[10px] text-zinc-400 mb-1">
                        Live Telemetry Source
                      </label>
                      <select
                        value={selectedWidget.statBinding?.source || 'health'}
                        onChange={(e) =>
                          onUpdateWidget(selectedWidget.id, (w) => ({
                            ...w,
                            statBinding: {
                              source: e.target.value as MenuStatBindingSource,
                              formatTemplate: w.statBinding?.formatTemplate || '{value}',
                              variableKey: w.statBinding?.variableKey,
                            },
                          }))
                        }
                        className="w-full ide-input text-xs"
                      >
                        <option value="health">Player Health (HP)</option>
                        <option value="ammo">Current Ammo</option>
                        <option value="kills">Enemies Neutralized</option>
                        <option value="secrets">Secrets Discovered</option>
                        <option value="level-title">Active Sector / Level Title</option>
                        <option value="time">Mission Elapsed Time</option>
                        <option value="sim-flag">Deterministic Sim Flag</option>
                        <option value="sim-counter">Deterministic Sim Counter</option>
                      </select>
                    </div>

                    {(selectedWidget.statBinding?.source === 'sim-flag' ||
                      selectedWidget.statBinding?.source === 'sim-counter') && (
                      <div>
                        <label className="block text-[10px] text-zinc-400 mb-1">
                          Sim Variable Key
                        </label>
                        <input
                          type="text"
                          value={selectedWidget.statBinding?.variableKey || ''}
                          onChange={(e) =>
                            onUpdateWidget(selectedWidget.id, (w) => ({
                              ...w,
                              statBinding: {
                                ...(w.statBinding || {
                                  source: 'sim-counter',
                                  formatTemplate: '{value}',
                                }),
                                variableKey: e.target.value,
                              },
                            }))
                          }
                          placeholder="e.g. keycards_collected"
                          className="w-full ide-input text-xs font-mono"
                        />
                      </div>
                    )}

                    <div>
                      <label className="block text-[10px] text-zinc-400 mb-1">
                        Format Template (use {'{value}'})
                      </label>
                      <input
                        type="text"
                        value={selectedWidget.statBinding?.formatTemplate || '{value}'}
                        onChange={(e) =>
                          onUpdateWidget(selectedWidget.id, (w) => ({
                            ...w,
                            statBinding: {
                              ...(w.statBinding || { source: 'health', formatTemplate: '{value}' }),
                              formatTemplate: e.target.value,
                            },
                          }))
                        }
                        className="w-full ide-input text-xs font-mono"
                      />
                    </div>
                  </div>
                )}

                {(selectedWidget.type === 'slider-setting' ||
                  selectedWidget.type === 'toggle-setting') && (
                  <div className="space-y-3">
                    <div>
                      <label className="block text-[10px] text-zinc-400 mb-1">
                        Engine Setting Target
                      </label>
                      <select
                        value={
                          selectedWidget.settingBinding?.target ||
                          (selectedWidget.type === 'slider-setting'
                            ? 'masterVolume'
                            : 'minimapEnabled')
                        }
                        onChange={(e) => {
                          const target = e.target.value as MenuSettingTarget;
                          onUpdateWidget(selectedWidget.id, (w) => ({
                            ...w,
                            settingBinding: {
                              ...w.settingBinding,
                              target,
                            },
                          }));
                        }}
                        className="w-full ide-input text-xs"
                      >
                        {selectedWidget.type === 'slider-setting' ? (
                          <>
                            <option value="masterVolume">Master Audio Volume (%)</option>
                            <option value="mouseSensitivity">Mouse Look Sensitivity (%)</option>
                            <option value="fov">Camera Field of View (deg)</option>
                          </>
                        ) : (
                          <>
                            <option value="minimapEnabled">Tactical Minimap HUD</option>
                            <option value="invertY">Invert Y-Axis Look</option>
                          </>
                        )}
                      </select>
                    </div>
                  </div>
                )}

                {selectedWidget.type !== 'button' &&
                  selectedWidget.type !== 'stat-readout' &&
                  selectedWidget.type !== 'slider-setting' &&
                  selectedWidget.type !== 'toggle-setting' && (
                    <div className="p-3 rounded bg-zinc-900/60 border border-zinc-800 text-[11px] text-zinc-400">
                      This widget automatically renders dynamic game state (such as live inventory items or 3-slot checkpoint cards) when active in the runtime.
                    </div>
                  )}
              </div>
            )}
          </>
        )}

        {activeTab === 'screen' && (
          <div className="space-y-4">
            {/* Global Boot & Pause Overlay Settings */}
            <div className="space-y-2.5 pb-3 border-b border-zinc-800">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold text-amber-400">
                <Sparkles size={12} /> Global Menu State Machine
              </div>

              <label className="flex items-center justify-between text-xs text-zinc-300 cursor-pointer py-1">
                <span>Boot into Main Menu on Game Start</span>
                <input
                  type="checkbox"
                  checked={menuPack.enableMainMenuOnBoot}
                  onChange={(e) =>
                    onUpdatePack((prev) => ({
                      ...prev,
                      enableMainMenuOnBoot: e.target.checked,
                    }))
                  }
                  className="accent-amber-500"
                />
              </label>

              <label className="flex items-center justify-between text-xs text-zinc-300 cursor-pointer py-1">
                <span>Enable In-Game Overlays (ESC / Hotkeys)</span>
                <input
                  type="checkbox"
                  checked={menuPack.enablePauseOverlay}
                  onChange={(e) =>
                    onUpdatePack((prev) => ({
                      ...prev,
                      enablePauseOverlay: e.target.checked,
                    }))
                  }
                  className="accent-amber-500"
                />
              </label>
            </div>

            {/* Active Screen Identity */}
            <div className="space-y-2.5 pb-3 border-b border-zinc-800">
              <span className="text-[11px] font-semibold text-zinc-300 block">
                Active Screen Configuration
              </span>

              <div>
                <label className="block text-[10px] text-zinc-400 mb-1">Screen Title</label>
                <input
                  type="text"
                  value={activeScreen.name}
                  onChange={(e) =>
                    onUpdateScreen((s) => ({ ...s, name: e.target.value }))
                  }
                  className="w-full ide-input text-xs"
                />
              </div>

              <div>
                <label className="block text-[10px] text-zinc-400 mb-1">Screen Role / Mode</label>
                <select
                  value={activeScreen.category}
                  onChange={(e) => {
                    const nextCategory = e.target.value as MenuScreenSpec['category'];
                    onUpdateScreen((s) => ({
                      ...s,
                      category: nextCategory,
                      overlayConfig:
                        nextCategory === 'in-game-overlay'
                          ? s.overlayConfig || {
                              pauseSimulation: true,
                              dimOpacity: 0.72,
                              dimColorHex: '#050608',
                              backdropBlurPx: 6,
                              scanlineEffect: true,
                              triggerHotkey: 'Escape',
                              hideCombatHud: true,
                            }
                          : s.overlayConfig,
                    }));
                  }}
                  className="w-full ide-input text-xs"
                >
                  <option value="main-menu">Out-of-Game Main Menu</option>
                  <option value="sub-menu">Sub-Menu (Options / Saves)</option>
                  <option value="in-game-overlay">In-Game Overlay (Pause / Inventory Hub)</option>
                </select>
              </div>
            </div>

            {/* Conditional Background Studio OR In-Game Overlay Mechanics */}
            {activeScreen.category === 'in-game-overlay' && activeScreen.overlayConfig ? (
              <div className="space-y-3">
                <span className="text-[11px] font-semibold text-emerald-400 block">
                  In-Game Overlay Mechanics
                </span>

                <div>
                  <label className="block text-[10px] text-zinc-400 mb-1">
                    Toggle Hotkey During Gameplay
                  </label>
                  <select
                    value={activeScreen.overlayConfig.triggerHotkey}
                    onChange={(e) =>
                      onUpdateScreen((s) => ({
                        ...s,
                        overlayConfig: {
                          ...s.overlayConfig!,
                          triggerHotkey: e.target.value as MenuOverlayHotkey,
                        },
                      }))
                    }
                    className="w-full ide-input text-xs"
                  >
                    <option value="Escape">ESC (Pause Menu)</option>
                    <option value="KeyI">I Key (Inventory / Mission Hub)</option>
                    <option value="Tab">TAB Key (Tactical Overlay)</option>
                    <option value="KeyP">P Key (Pause Screen)</option>
                    <option value="KeyO">O Key (Objectives)</option>
                    <option value="None">No Hotkey (Opened via Button Action)</option>
                  </select>
                </div>

                <label className="flex items-center justify-between text-xs text-zinc-300 cursor-pointer py-1">
                  <span>Freeze 3D Simulation & AI Ticks</span>
                  <input
                    type="checkbox"
                    checked={activeScreen.overlayConfig.pauseSimulation}
                    onChange={(e) =>
                      onUpdateScreen((s) => ({
                        ...s,
                        overlayConfig: {
                          ...s.overlayConfig!,
                          pauseSimulation: e.target.checked,
                        },
                      }))
                    }
                    className="accent-emerald-500"
                  />
                </label>

                <label className="flex items-center justify-between text-xs text-zinc-300 cursor-pointer py-1">
                  <span>Hide Combat HUD While Open</span>
                  <input
                    type="checkbox"
                    checked={activeScreen.overlayConfig.hideCombatHud}
                    onChange={(e) =>
                      onUpdateScreen((s) => ({
                        ...s,
                        overlayConfig: {
                          ...s.overlayConfig!,
                          hideCombatHud: e.target.checked,
                        },
                      }))
                    }
                    className="accent-emerald-500"
                  />
                </label>

                <label className="flex items-center justify-between text-xs text-zinc-300 cursor-pointer py-1">
                  <span>CRT Scanline Overlay Filter</span>
                  <input
                    type="checkbox"
                    checked={activeScreen.overlayConfig.scanlineEffect}
                    onChange={(e) =>
                      onUpdateScreen((s) => ({
                        ...s,
                        overlayConfig: {
                          ...s.overlayConfig!,
                          scanlineEffect: e.target.checked,
                        },
                      }))
                    }
                    className="accent-emerald-500"
                  />
                </label>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] text-zinc-400 mb-1">
                      Dim Opacity (0 - 1)
                    </label>
                    <input
                      type="number"
                      step="0.05"
                      min={0}
                      max={0.95}
                      value={activeScreen.overlayConfig.dimOpacity}
                      onChange={(e) =>
                        onUpdateScreen((s) => ({
                          ...s,
                          overlayConfig: {
                            ...s.overlayConfig!,
                            dimOpacity: Math.max(0, Math.min(0.95, Number(e.target.value) || 0)),
                          },
                        }))
                      }
                      className="w-full ide-input text-xs font-mono tabular-nums"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-zinc-400 mb-1">
                      Backdrop Blur (px)
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={24}
                      value={activeScreen.overlayConfig.backdropBlurPx}
                      onChange={(e) =>
                        onUpdateScreen((s) => ({
                          ...s,
                          overlayConfig: {
                            ...s.overlayConfig!,
                            backdropBlurPx: Math.max(0, Number(e.target.value) || 0),
                          },
                        }))
                      }
                      className="w-full ide-input text-xs font-mono tabular-nums"
                    />
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <span className="text-[11px] font-semibold text-amber-400 block">
                  Out-of-Game Background Environment
                </span>

                <div>
                  <label className="block text-[10px] text-zinc-400 mb-1">Background Mode</label>
                  <select
                    value={activeScreen.backgroundConfig?.type || '3d-scene'}
                    onChange={(e) => {
                      const nextType = e.target.value as '3d-scene' | 'image' | 'solid';
                      onUpdateScreen((s) => {
                        if (nextType === '3d-scene') {
                          return {
                            ...s,
                            backgroundConfig: {
                              type: '3d-scene',
                              levelIndex: 0,
                              cameraMode: 'orbit',
                              cameraTarget: { row: 4, col: 4, elevationMeters: 1.5 },
                              orbitRadiusMeters: 9,
                              orbitSpeedRadPerSec: 0.22,
                              fov: 65,
                            },
                          };
                        }
                        if (nextType === 'image') {
                          return {
                            ...s,
                            backgroundConfig: {
                              type: 'image',
                              textureId: 'cyber_grid',
                              fitMode: 'tile',
                              tintHex: '#0f172a',
                              vignetteStrength: 0.65,
                            },
                          };
                        }
                        return {
                          ...s,
                          backgroundConfig: {
                            type: 'solid',
                            colorHex: '#090a0f',
                            gradientEndHex: '#18181b',
                            showCyberGrid: true,
                          },
                        };
                      });
                    }}
                    className="w-full ide-input text-xs"
                  >
                    <option value="3d-scene">Live 3D Level Diorama Camera</option>
                    <option value="image">Custom Texture / Key Art Backdrop</option>
                    <option value="solid">Solid / Cyber-Grid Gradient</option>
                  </select>
                </div>

                {activeScreen.backgroundConfig?.type === '3d-scene' && (
                  <div className="space-y-2.5 p-2.5 rounded bg-zinc-900/60 border border-zinc-800">
                    <div>
                      <label className="block text-[10px] text-zinc-400 mb-1">
                        3D Scene Camera Motion
                      </label>
                      <select
                        value={activeScreen.backgroundConfig.cameraMode}
                        onChange={(e) =>
                          onUpdateScreen((s) =>
                            s.backgroundConfig?.type === '3d-scene'
                              ? {
                                  ...s,
                                  backgroundConfig: {
                                    ...s.backgroundConfig,
                                    cameraMode: e.target.value as 'orbit' | 'fixed',
                                  },
                                }
                              : s
                          )
                        }
                        className="w-full ide-input text-xs"
                      >
                        <option value="orbit">Turntable Orbit Around Level</option>
                        <option value="fixed">Fixed Cinematic Angle</option>
                      </select>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[10px] text-zinc-400 mb-1">
                          Orbit Radius (m)
                        </label>
                        <input
                          type="number"
                          min={2}
                          max={30}
                          value={activeScreen.backgroundConfig.orbitRadiusMeters}
                          onChange={(e) =>
                            onUpdateScreen((s) =>
                              s.backgroundConfig?.type === '3d-scene'
                                ? {
                                    ...s,
                                    backgroundConfig: {
                                      ...s.backgroundConfig,
                                      orbitRadiusMeters: Number(e.target.value) || 8,
                                    },
                                  }
                                : s
                            )
                          }
                          className="w-full ide-input text-xs font-mono tabular-nums"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] text-zinc-400 mb-1">
                          Target Height (m)
                        </label>
                        <input
                          type="number"
                          step="0.5"
                          min={0.5}
                          max={25}
                          value={activeScreen.backgroundConfig.cameraTarget.elevationMeters}
                          onChange={(e) =>
                            onUpdateScreen((s) =>
                              s.backgroundConfig?.type === '3d-scene'
                                ? {
                                    ...s,
                                    backgroundConfig: {
                                      ...s.backgroundConfig,
                                      cameraTarget: {
                                        ...s.backgroundConfig.cameraTarget,
                                        elevationMeters: Number(e.target.value) || 1.5,
                                      },
                                    },
                                  }
                                : s
                            )
                          }
                          className="w-full ide-input text-xs font-mono tabular-nums"
                        />
                      </div>
                    </div>
                  </div>
                )}

                {activeScreen.backgroundConfig?.type === 'image' && (
                  <div className="space-y-2.5 p-2.5 rounded bg-zinc-900/60 border border-zinc-800">
                    <div>
                      <label className="block text-[10px] text-zinc-400 mb-1">
                        Background Texture Asset
                      </label>
                      <select
                        value={activeScreen.backgroundConfig.textureId}
                        onChange={(e) =>
                          onUpdateScreen((s) =>
                            s.backgroundConfig?.type === 'image'
                              ? {
                                  ...s,
                                  backgroundConfig: {
                                    ...s.backgroundConfig,
                                    textureId: e.target.value,
                                  },
                                }
                              : s
                          )
                        }
                        className="w-full ide-input text-xs"
                      >
                        {allTextureChoices.map((tex) => (
                          <option key={tex.id} value={tex.id}>
                            {tex.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10px] text-zinc-400 mb-1">Fit Mode</label>
                      <select
                        value={activeScreen.backgroundConfig.fitMode}
                        onChange={(e) =>
                          onUpdateScreen((s) =>
                            s.backgroundConfig?.type === 'image'
                              ? {
                                  ...s,
                                  backgroundConfig: {
                                    ...s.backgroundConfig,
                                    fitMode: e.target.value as 'cover' | 'contain' | 'tile',
                                  },
                                }
                              : s
                          )
                        }
                        className="w-full ide-input text-xs"
                      >
                        <option value="cover">Full Cover</option>
                        <option value="tile">Seamless Repeat Tile</option>
                        <option value="contain">Contain Centered</option>
                      </select>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  );
};
