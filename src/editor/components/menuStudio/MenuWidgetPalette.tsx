import React from 'react';
import {
  Copy,
  Eye,
  EyeOff,
  Image as ImageIcon,
  LayoutGrid,
  Layers,
  ListChecks,
  Lock,
  MousePointerClick,
  Plus,
  Sliders,
  Sparkles,
  Square,
  ToggleLeft,
  Trash2,
  Type,
  Unlock,
  Activity,
} from 'lucide-react';
import {
  MENU_STUDIO_PRESETS,
  MenuPackSpec,
  MenuScreenSpec,
  MenuWidgetSpec,
  MenuWidgetType,
} from '../../types/engine';

interface MenuWidgetPaletteProps {
  menuPack: MenuPackSpec;
  activeScreen: MenuScreenSpec;
  selectedWidgetId: string | null;
  onSelectWidget: (widgetId: string | null) => void;
  onAddWidget: (type: MenuWidgetType) => void;
  onDuplicateWidget: (widgetId: string) => void;
  onToggleWidgetVisible: (widgetId: string) => void;
  onToggleWidgetLock: (widgetId: string) => void;
  onDeleteWidget: (widgetId: string) => void;
  onApplyPreset: (presetId: string) => void;
}

const WIDGET_PALETTE_ITEMS: {
  type: MenuWidgetType;
  label: string;
  sub: string;
  icon: React.ReactNode;
  badgeColor: string;
}[] = [
  {
    type: 'button',
    label: 'Action Button',
    sub: 'Start, Resume, Nav, Sim Trigger',
    icon: <MousePointerClick className="w-3.5 h-3.5 text-[#4ec9b0]" />,
    badgeColor: '#4ec9b0',
  },
  {
    type: 'title-text',
    label: 'Title / Text Block',
    sub: 'Header, Subtitle, Instructions',
    icon: <Type className="w-3.5 h-3.5 text-[#38bdf8]" />,
    badgeColor: '#38bdf8',
  },
  {
    type: 'panel',
    label: 'Frame / Panel',
    sub: 'Chamfered or Textured Surface',
    icon: <Square className="w-3.5 h-3.5 text-[#94a3b8]" />,
    badgeColor: '#94a3b8',
  },
  {
    type: 'image',
    label: 'Image / Insignia',
    sub: 'Custom Texture or Banner Graphic',
    icon: <ImageIcon className="w-3.5 h-3.5 text-[#f59e0b]" />,
    badgeColor: '#f59e0b',
  },
  {
    type: 'stat-readout',
    label: 'Live Stat Readout',
    sub: 'HP, Ammo, Kills, Sim Variables',
    icon: <Activity className="w-3.5 h-3.5 text-[#f43f5e]" />,
    badgeColor: '#f43f5e',
  },
  {
    type: 'inventory-grid',
    label: 'Inventory & Keycards',
    sub: 'Clearance Keys & Equipped Gear',
    icon: <LayoutGrid className="w-3.5 h-3.5 text-[#eab308]" />,
    badgeColor: '#eab308',
  },
  {
    type: 'slider-setting',
    label: 'Setting Slider',
    sub: 'Volume, Mouse Sens, Camera FOV',
    icon: <Sliders className="w-3.5 h-3.5 text-[#a855f7]" />,
    badgeColor: '#a855f7',
  },
  {
    type: 'toggle-setting',
    label: 'Setting Toggle',
    sub: 'Minimap Radar, Invert Y-Axis',
    icon: <ToggleLeft className="w-3.5 h-3.5 text-[#22c55e]" />,
    badgeColor: '#22c55e',
  },
  {
    type: 'save-slot-list',
    label: 'Save / Load Slots',
    sub: '3-Slot Persistent Checkpoints',
    icon: <ListChecks className="w-3.5 h-3.5 text-[#38bdf8]" />,
    badgeColor: '#38bdf8',
  },
];

export const MenuWidgetPalette: React.FC<MenuWidgetPaletteProps> = ({
  menuPack,
  activeScreen,
  selectedWidgetId,
  onSelectWidget,
  onAddWidget,
  onDuplicateWidget,
  onToggleWidgetVisible,
  onToggleWidgetLock,
  onDeleteWidget,
  onApplyPreset,
}) => {
  const sortedWidgets = [...activeScreen.widgets].sort(
    (a, b) => (b.rect.zIndex ?? 1) - (a.rect.zIndex ?? 1)
  );

  return (
    <aside className="w-[248px] shrink-0 h-full bg-[#252526] border-r border-[#3e3e42] flex flex-col select-none overflow-hidden">
      <div className="ide-panel-header">
        <span>UI Widget Palette</span>
        <span className="font-mono text-[10px] text-[#858585]">Drag / +</span>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-3">
        {/* 1. Starter Menu Theme Presets */}
        <div className="bg-[#1e1e1e] border border-[#3e3e42] p-2 space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[#cccccc] flex items-center gap-1">
              <Sparkles className="w-3 h-3 text-[#4ec9b0]" />
              Menu Studio Theme Preset
            </span>
          </div>
          <select
            aria-label="Select Menu Theme Preset"
            value={menuPack.presetId || 'tactical-gridforge'}
            onChange={(e) => onApplyPreset(e.target.value)}
            className="ide-select w-full !h-[24px]"
          >
            {MENU_STUDIO_PRESETS.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.name}
              </option>
            ))}
          </select>
          <p className="text-[10px] text-[#858585] leading-tight">
            {MENU_STUDIO_PRESETS.find((p) => p.id === menuPack.presetId)
              ?.description ||
              'Complete Main Menu, Options, Checkpoints, Pause & Inventory pack.'}
          </p>
        </div>

        {/* 2. Draggable UI Primitives & Contextual Elements */}
        <div className="space-y-1">
          <div className="flex items-center justify-between px-0.5">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[#cccccc]">
              Add / Drag UI Elements
            </span>
            <span className="text-[9px] font-mono text-[#858585]">9 Types</span>
          </div>

          <div className="space-y-1">
            {WIDGET_PALETTE_ITEMS.map((item) => (
              <div
                key={item.type}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData(
                    'application/x-gridforge-menu-widget',
                    item.type
                  );
                  e.dataTransfer.effectAllowed = 'copy';
                }}
                onClick={() => onAddWidget(item.type)}
                className="group flex items-center justify-between gap-2 px-2 py-1.5 bg-[#1e1e1e] hover:bg-[#2a2d2e] border border-[#3e3e42] hover:border-[#4ec9b0] cursor-grab active:cursor-grabbing transition-colors"
                title={`Drag '${item.label}' onto the canvas or click to add`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-6 h-6 rounded bg-[#252526] border border-[#3e3e42] flex items-center justify-center shrink-0">
                    {item.icon}
                  </div>
                  <div className="min-w-0">
                    <div className="text-[11px] font-medium text-[#e5e5e5] truncate">
                      {item.label}
                    </div>
                    <div className="text-[9px] text-[#858585] truncate">
                      {item.sub}
                    </div>
                  </div>
                </div>
                <span className="p-1 text-[#858585] group-hover:text-[#4ec9b0] shrink-0">
                  <Plus className="w-3.5 h-3.5" />
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* 3. Active Screen Hierarchy Layer Tree */}
        <div className="space-y-1 pt-1 border-t border-[#3e3e42]">
          <div className="flex items-center justify-between px-0.5">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[#cccccc] flex items-center gap-1">
              <Layers className="w-3 h-3 text-[#38bdf8]" />
              Screen Hierarchy
            </span>
            <span className="text-[9px] font-mono text-[#858585]">
              {activeScreen.widgets.length} items
            </span>
          </div>

          <div className="space-y-1 max-h-[260px] overflow-y-auto pr-0.5">
            {sortedWidgets.map((w: MenuWidgetSpec) => {
              const isSelected = w.id === selectedWidgetId;
              return (
                <div
                  key={w.id}
                  onClick={() => onSelectWidget(w.id)}
                  className={`flex items-center justify-between gap-1 px-2 py-1 border text-[11px] cursor-pointer transition-colors ${
                    isSelected
                      ? 'bg-[#094771] border-[#38bdf8] text-white'
                      : 'bg-[#1e1e1e] border-[#3e3e42] text-[#cccccc] hover:bg-[#2a2d2e]'
                  }`}
                >
                  <div className="flex items-center gap-1.5 min-w-0 flex-1">
                    <span className="font-mono text-[9px] text-[#858585] shrink-0">
                      z{w.rect.zIndex}
                    </span>
                    <span className="truncate font-medium">
                      {w.name || w.text || w.type}
                    </span>
                  </div>

                  <div className="flex items-center gap-0.5 shrink-0">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDuplicateWidget(w.id);
                      }}
                      className="p-0.5 hover:text-[#38bdf8] text-[#94a3b8] cursor-pointer"
                      title="Duplicate Widget (Ctrl+D)"
                    >
                      <Copy className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleWidgetVisible(w.id);
                      }}
                      className="p-0.5 hover:text-white text-[#94a3b8] cursor-pointer"
                      title={w.visible !== false ? 'Hide Widget' : 'Show Widget'}
                    >
                      {w.visible !== false ? (
                        <Eye className="w-3 h-3" />
                      ) : (
                        <EyeOff className="w-3 h-3 text-[#d14d41]" />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleWidgetLock(w.id);
                      }}
                      className="p-0.5 hover:text-white text-[#94a3b8] cursor-pointer"
                      title={w.locked ? 'Unlock Widget' : 'Lock Position'}
                    >
                      {w.locked ? (
                        <Lock className="w-3 h-3 text-[#f59e0b]" />
                      ) : (
                        <Unlock className="w-3 h-3 opacity-50" />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteWidget(w.id);
                      }}
                      className="p-0.5 hover:text-[#f87171] text-[#94a3b8] cursor-pointer"
                      title="Delete Widget (Del)"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </aside>
  );
};
