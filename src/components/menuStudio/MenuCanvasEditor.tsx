import React, { useEffect, useRef, useState } from 'react';
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  ArrowDownToLine,
  ArrowUpToLine,
  Copy,
  Eye,
  EyeOff,
  Grid,
  Lock,
  MonitorPlay,
  Pencil,
  Plus,
  Shapes,
  Sparkles,
  Trash2,
  Unlock,
  XCircle,
} from 'lucide-react';
import {
  DEFAULT_MENU_RUNTIME_SETTINGS,
  MenuDOMRenderer,
  MenuPackSpec,
  MenuRuntimeSettings,
  MenuScreenCategory,
  MenuScreenSpec,
  MenuWidgetRect,
  MenuWidgetSpec,
  MenuWidgetType,
  TextureAsset,
} from '../../types/engine';
import { SoundEffects } from '../../runtime/SoundEffects';

interface MenuCanvasEditorProps {
  menuPack: MenuPackSpec;
  activeScreen: MenuScreenSpec;
  selectedWidgetId: string | null;
  customTextures: TextureAsset[];
  levelTitles: string[];
  onSelectScreen: (screenId: string) => void;
  onAddScreen: (category: MenuScreenCategory) => void;
  onDuplicateScreen: (screenId: string) => void;
  onDeleteScreen: (screenId: string) => void;
  onSelectWidget: (widgetId: string | null) => void;
  onUpdateWidgetRect: (widgetId: string, nextRect: MenuWidgetRect) => void;
  onDropNewWidgetAt: (
    type: MenuWidgetType,
    xPct: number,
    yPct: number
  ) => void;
  onDuplicateWidget: (widgetId: string) => void;
  onDeleteWidget: (widgetId: string) => void;
  onToggleWidgetLock: (widgetId: string) => void;
  onToggleWidgetVisible: (widgetId: string) => void;
  onBringToFront: (widgetId: string) => void;
  onSendToBack: (widgetId: string) => void;
  onCenterWidget: (widgetId: string, axis: 'x' | 'y' | 'both') => void;
  onCycleWidgetShape: (widgetId: string) => void;
  onClearScreenWidgets: () => void;
  onLaunch3DTestPlayWithMenus: () => void;
}

type ResizeHandleDir = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

interface DragInteractionState {
  mode: 'move' | 'resize';
  widgetId: string;
  handle?: ResizeHandleDir;
  startClientX: number;
  startClientY: number;
  initialRect: MenuWidgetRect;
}

interface ContextMenuState {
  clientX: number;
  clientY: number;
  stageXPct: number;
  stageYPct: number;
  targetWidgetId: string | null;
}

export const MenuCanvasEditor: React.FC<MenuCanvasEditorProps> = ({
  menuPack,
  activeScreen,
  selectedWidgetId,
  customTextures,
  levelTitles,
  onSelectScreen,
  onAddScreen,
  onDuplicateScreen,
  onDeleteScreen,
  onSelectWidget,
  onUpdateWidgetRect,
  onDropNewWidgetAt,
  onDuplicateWidget,
  onDeleteWidget,
  onToggleWidgetLock,
  onToggleWidgetVisible,
  onBringToFront,
  onSendToBack,
  onCenterWidget,
  onCycleWidgetShape,
  onClearScreenWidgets,
  onLaunch3DTestPlayWithMenus,
}) => {
  const stageContainerRef = useRef<HTMLDivElement | null>(null);
  const domMountRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<MenuDOMRenderer | null>(null);

  const [snapToGrid, setSnapToGrid] = useState<boolean>(true);
  const [isInteractivePreview, setIsInteractivePreview] =
    useState<boolean>(false);
  const [previewSettings, setPreviewSettings] = useState<MenuRuntimeSettings>({
    ...DEFAULT_MENU_RUNTIME_SETTINGS,
  });
  const [previewToast, setPreviewToast] = useState<string | null>(null);
  const [dragState, setDragState] = useState<DragInteractionState | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  const snapPct = (val: number): number => {
    const clamped = Math.max(0, Math.min(100, val));
    if (!snapToGrid) return Math.round(clamped * 10) / 10;
    return Math.round(clamped * 2) / 2; // 0.5% snap grid
  };

  // Close context menu on any outside click or Escape key, and handle Delete / Ctrl+D shortcuts
  useEffect(() => {
    const handleGlobalClick = () => {
      setContextMenu(null);
    };

    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setContextMenu(null);
      }

      if (isInteractivePreview) return;

      // Ignore keyboard shortcuts if user is typing in an input/textarea/select
      const activeEl = document.activeElement;
      if (
        activeEl instanceof HTMLInputElement ||
        activeEl instanceof HTMLTextAreaElement ||
        activeEl instanceof HTMLSelectElement ||
        (activeEl as HTMLElement | null)?.isContentEditable
      ) {
        return;
      }

      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedWidgetId) {
        e.preventDefault();
        setContextMenu(null);
        onDeleteWidget(selectedWidgetId);
      } else if (
        (e.ctrlKey || e.metaKey) &&
        e.key.toLowerCase() === 'd' &&
        selectedWidgetId
      ) {
        e.preventDefault();
        setContextMenu(null);
        onDuplicateWidget(selectedWidgetId);
      }
    };

    window.addEventListener('click', handleGlobalClick);
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => {
      window.removeEventListener('click', handleGlobalClick);
      window.removeEventListener('keydown', handleGlobalKeyDown);
    };
  }, [
    isInteractivePreview,
    selectedWidgetId,
    onDeleteWidget,
    onDuplicateWidget,
  ]);

  // Mount and update Vanilla DOM Menu Renderer for 1:1 visual parity
  useEffect(() => {
    const mountEl = domMountRef.current;
    if (!mountEl) return;

    const renderer = new MenuDOMRenderer(
      mountEl,
      {
        onSelectWidgetInEditor: (widgetId, e) => {
          if (isInteractivePreview) return;
          e.stopPropagation();
          onSelectWidget(widgetId);
        },
        onPlaySound: (soundId) => SoundEffects.playById(soundId),
        onChangeSetting: (target, val) => {
          setPreviewSettings((prev) => ({ ...prev, [target]: val }));
        },
        onSaveSlot: (slotIdx) => {
          SoundEffects.playById('key_pickup');
          setPreviewToast(`Preview: Saved to Slot ${slotIdx}`);
          window.setTimeout(() => setPreviewToast(null), 2000);
        },
        onLoadSlot: (slotIdx) => {
          SoundEffects.playById('level_exit');
          setPreviewToast(`Preview: Loaded Slot ${slotIdx}`);
          window.setTimeout(() => setPreviewToast(null), 2000);
        },
        onTriggerAction: (action) => {
          if (action.type === 'OPEN_MENU_SCREEN') {
            onSelectScreen(action.screenId);
          } else if (action.type === 'BACK_MENU_SCREEN') {
            onSelectScreen(menuPack.entryMainMenuScreenId);
          } else if (action.type === 'START_NEW_GAME') {
            onLaunch3DTestPlayWithMenus();
          } else {
            setPreviewToast(`Triggered Action: ${action.type}`);
            window.setTimeout(() => setPreviewToast(null), 1800);
          }
        },
      },
      { editorMode: !isInteractivePreview }
    );

    rendererRef.current = renderer;
    return () => {
      renderer.dispose();
      rendererRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isInteractivePreview]);

  useEffect(() => {
    rendererRef.current?.render(activeScreen, {
      customTextures,
      settings: previewSettings,
      currentLevelIndex: 0,
      totalLevels: Math.max(1, levelTitles.length),
      currentLevelTitle: levelTitles[0] || 'Level 1',
      statusToast: previewToast,
    });
  }, [
    activeScreen,
    customTextures,
    previewSettings,
    levelTitles,
    previewToast,
    isInteractivePreview,
  ]);

  // Pointer drag / resize handling
  useEffect(() => {
    if (!dragState) return;

    const handleMouseMove = (e: MouseEvent) => {
      const stageEl = stageContainerRef.current;
      if (!stageEl) return;
      const bounds = stageEl.getBoundingClientRect();
      if (bounds.width <= 0 || bounds.height <= 0) return;

      const dxPct = ((e.clientX - dragState.startClientX) / bounds.width) * 100;
      const dyPct =
        ((e.clientY - dragState.startClientY) / bounds.height) * 100;

      const init = dragState.initialRect;
      if (dragState.mode === 'move') {
        const nextX = Math.max(
          0,
          Math.min(100 - init.widthPct, snapPct(init.xPct + dxPct))
        );
        const nextY = Math.max(
          0,
          Math.min(100 - init.heightPct, snapPct(init.yPct + dyPct))
        );
        onUpdateWidgetRect(dragState.widgetId, {
          ...init,
          xPct: nextX,
          yPct: nextY,
        });
      } else if (dragState.mode === 'resize' && dragState.handle) {
        let { xPct, yPct, widthPct, heightPct } = init;
        const h = dragState.handle;
        if (h.includes('e')) {
          widthPct = Math.max(
            4,
            Math.min(100 - xPct, snapPct(init.widthPct + dxPct))
          );
        }
        if (h.includes('s')) {
          heightPct = Math.max(
            4,
            Math.min(100 - yPct, snapPct(init.heightPct + dyPct))
          );
        }
        if (h.includes('w')) {
          const maxDelta = init.widthPct - 4;
          const clampedDx = Math.max(-init.xPct, Math.min(maxDelta, dxPct));
          xPct = snapPct(init.xPct + clampedDx);
          widthPct = snapPct(init.widthPct - clampedDx);
        }
        if (h.includes('n')) {
          const maxDelta = init.heightPct - 4;
          const clampedDy = Math.max(-init.yPct, Math.min(maxDelta, dyPct));
          yPct = snapPct(init.yPct + clampedDy);
          heightPct = snapPct(init.heightPct - clampedDy);
        }
        onUpdateWidgetRect(dragState.widgetId, {
          ...init,
          xPct,
          yPct,
          widthPct,
          heightPct,
        });
      }
    };

    const handleMouseUp = () => {
      setDragState(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragState, snapToGrid]);

  const selectedWidget: MenuWidgetSpec | null =
    activeScreen.widgets.find((w) => w.id === selectedWidgetId) ?? null;

  const contextTargetWidget: MenuWidgetSpec | null =
    contextMenu?.targetWidgetId
      ? activeScreen.widgets.find((w) => w.id === contextMenu.targetWidgetId) ??
        null
      : null;

  const outOfGameScreens = menuPack.screens.filter(
    (s) => s.category !== 'in-game-overlay'
  );
  const inGameOverlays = menuPack.screens.filter(
    (s) => s.category === 'in-game-overlay'
  );

  const openStageContextMenu = (
    e: React.MouseEvent,
    targetWidgetId: string | null
  ) => {
    if (isInteractivePreview) return;
    e.preventDefault();
    e.stopPropagation();

    if (targetWidgetId) {
      onSelectWidget(targetWidgetId);
    }

    let stageXPct = 50;
    let stageYPct = 50;
    if (stageContainerRef.current) {
      const rect = stageContainerRef.current.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        stageXPct = snapPct(
          Math.max(4, Math.min(92, ((e.clientX - rect.left) / rect.width) * 100))
        );
        stageYPct = snapPct(
          Math.max(4, Math.min(92, ((e.clientY - rect.top) / rect.height) * 100))
        );
      }
    }

    const menuWidth = 228;
    const menuHeight = targetWidgetId ? 330 : 310;
    const clampedX = Math.max(
      8,
      Math.min(window.innerWidth - menuWidth - 8, e.clientX)
    );
    const clampedY = Math.max(
      8,
      Math.min(window.innerHeight - menuHeight - 8, e.clientY)
    );

    setContextMenu({
      clientX: clampedX,
      clientY: clampedY,
      stageXPct,
      stageYPct,
      targetWidgetId,
    });
  };

  return (
    <section className="flex-1 h-full flex flex-col bg-[#141414] overflow-hidden select-none relative">
      {/* Top Studio Bar: Screen Selector Tabs & Interactive Preview Controls */}
      <div className="bg-[#252526] border-b border-[#3e3e42] px-2.5 py-1.5 flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[10px] font-mono uppercase text-[#858585] pr-1">
            Out-of-Game:
          </span>
          {outOfGameScreens.map((scr) => (
            <button
              key={scr.id}
              type="button"
              onClick={() => onSelectScreen(scr.id)}
              className={`ide-btn !h-[22px] !px-2 ${
                scr.id === activeScreen.id ? 'ide-btn--active' : ''
              }`}
            >
              <span>{scr.name}</span>
            </button>
          ))}
          <button
            type="button"
            onClick={() => onAddScreen('sub-menu')}
            className="ide-btn !h-[22px] !px-1.5 text-[#38bdf8]"
            title="Add a new Out-of-Game Sub-Menu Screen"
          >
            <Plus className="w-3 h-3" />
          </button>

          <span className="mx-1 h-4 w-[1px] bg-[#3e3e42]" />

          <span className="text-[10px] font-mono uppercase text-[#858585] pr-1">
            In-Game Overlays:
          </span>
          {inGameOverlays.map((scr) => (
            <button
              key={scr.id}
              type="button"
              onClick={() => onSelectScreen(scr.id)}
              className={`ide-btn !h-[22px] !px-2 ${
                scr.id === activeScreen.id ? 'ide-btn--active' : ''
              }`}
            >
              <span>{scr.name}</span>
            </button>
          ))}
          <button
            type="button"
            onClick={() => onAddScreen('in-game-overlay')}
            className="ide-btn !h-[22px] !px-1.5 text-[#4ec9b0]"
            title="Add a new In-Game Overlay Screen (Pause, Inventory, Terminal)"
          >
            <Plus className="w-3 h-3" />
          </button>
        </div>

        <div className="flex items-center gap-1.5">
          {selectedWidget && !isInteractivePreview && (
            <>
              <button
                type="button"
                onClick={() => onDuplicateWidget(selectedWidget.id)}
                className="ide-btn !h-[22px] text-[#38bdf8]"
                title="Duplicate Selected UI Element (Ctrl+D)"
              >
                <Copy className="w-3 h-3" />
                <span>Duplicate</span>
              </button>
              <button
                type="button"
                onClick={() => onDeleteWidget(selectedWidget.id)}
                className="ide-btn !h-[22px] !border-red-500/50 !bg-red-950/40 text-red-300 hover:!bg-red-900/60 hover:text-white"
                title="Delete Selected UI Element (Delete / Backspace)"
              >
                <Trash2 className="w-3 h-3" />
                <span>Delete Element</span>
              </button>
              <span className="mx-0.5 h-4 w-[1px] bg-[#3e3e42]" />
            </>
          )}

          <button
            type="button"
            onClick={() => setSnapToGrid((prev) => !prev)}
            className={`ide-btn !h-[22px] ${
              snapToGrid ? 'ide-btn--active' : ''
            }`}
            title="Toggle 0.5% Coordinate Grid Snapping"
          >
            <Grid className="w-3 h-3" />
            <span>Snap</span>
          </button>

          <button
            type="button"
            onClick={() => onDuplicateScreen(activeScreen.id)}
            className="ide-btn !h-[22px]"
            title="Duplicate Active Menu Screen"
          >
            <Copy className="w-3 h-3" />
            <span>Clone Screen</span>
          </button>

          {activeScreen.widgets.length > 0 && !isInteractivePreview && (
            <button
              type="button"
              onClick={onClearScreenWidgets}
              className="ide-btn !h-[22px] text-zinc-400 hover:text-red-400"
              title="Clear All Unlocked UI Elements on This Screen"
            >
              <XCircle className="w-3 h-3" />
              <span>Clear UI</span>
            </button>
          )}

          {menuPack.screens.length > 1 && (
            <button
              type="button"
              onClick={() => onDeleteScreen(activeScreen.id)}
              className="ide-btn !h-[22px] hover:text-[#f87171]"
              title="Delete Active Menu Screen"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          )}

          <button
            type="button"
            onClick={() => setIsInteractivePreview((prev) => !prev)}
            className={`ide-btn !h-[22px] ${
              isInteractivePreview ? 'ide-btn--active' : ''
            }`}
            title="Toggle between Drag-and-Drop Authoring Mode and Live Clickable Menu Preview"
          >
            {isInteractivePreview ? (
              <>
                <Pencil className="w-3 h-3 text-[#38bdf8]" />
                <span>Edit Layout</span>
              </>
            ) : (
              <>
                <Eye className="w-3 h-3 text-[#4ec9b0]" />
                <span>Interactive Preview</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={onLaunch3DTestPlayWithMenus}
            className="ide-btn !h-[22px] bg-[#0e639c] border-[#1177bb] text-white"
            title="Launch Full 3D Runtime starting from the Custom Main Menu"
          >
            <MonitorPlay className="w-3 h-3" />
            <span>Test in 3D Engine</span>
          </button>
        </div>
      </div>

      {/* Center 16:9 Stage Viewport Container */}
      <div
        onClick={() => {
          setContextMenu(null);
          if (!isInteractivePreview) onSelectWidget(null);
        }}
        onContextMenu={(e) => openStageContextMenu(e, null)}
        className="flex-1 w-full min-h-0 flex items-center justify-center p-5 overflow-hidden relative bg-[#111318]"
      >
        <div
          ref={stageContainerRef}
          onContextMenu={(e) => openStageContextMenu(e, null)}
          onDragOver={(e) => {
            if (isInteractivePreview) return;
            if (
              e.dataTransfer.types.includes(
                'application/x-gridforge-menu-widget'
              )
            ) {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'copy';
            }
          }}
          onDrop={(e) => {
            if (isInteractivePreview) return;
            const rawType = e.dataTransfer.getData(
              'application/x-gridforge-menu-widget'
            ) as MenuWidgetType;
            if (!rawType || !stageContainerRef.current) return;
            e.preventDefault();
            const rect = stageContainerRef.current.getBoundingClientRect();
            const xPct = snapPct(
              Math.max(
                2,
                Math.min(88, ((e.clientX - rect.left) / rect.width) * 100)
              )
            );
            const yPct = snapPct(
              Math.max(
                2,
                Math.min(88, ((e.clientY - rect.top) / rect.height) * 100)
              )
            );
            onDropNewWidgetAt(rawType, xPct, yPct);
          }}
          className="relative w-full max-w-[1040px] aspect-video bg-[#090d16] border border-[#3e3e42] shadow-2xl overflow-hidden"
        >
          {/* Simulated 3D Scene Preview Backdrop when viewing a 3D Diorama or In-Game Overlay */}
          {(activeScreen.category === 'in-game-overlay' ||
            activeScreen.backgroundConfig.type === '3d-scene') && (
            <div
              aria-hidden="true"
              className="absolute inset-0 pointer-events-none flex flex-col justify-between p-4"
              style={{
                background:
                  'radial-gradient(circle at 62% 42%, rgba(56, 189, 248, 0.22) 0%, rgba(15, 23, 42, 0.92) 60%, #050811 100%)',
              }}
            >
              <div
                className="absolute inset-0 opacity-25"
                style={{
                  backgroundImage:
                    'linear-gradient(rgba(78, 201, 176, 0.28) 1px, transparent 1px), linear-gradient(90deg, rgba(78, 201, 176, 0.28) 1px, transparent 1px)',
                  backgroundSize: '48px 48px',
                  transform: 'perspective(500px) rotateX(55deg) scale(1.6)',
                  transformOrigin: 'center bottom',
                }}
              />
              <div className="relative z-10 flex items-center justify-between text-[10px] font-mono text-[#94a3b8]">
                <span>
                  {activeScreen.category === 'in-game-overlay'
                    ? `LIVE 3D GAMEPLAY VIEWPORT (${
                        activeScreen.overlayConfig?.pauseSimulation !== false
                          ? 'SIMULATION PAUSED'
                          : 'REAL-TIME OVERLAY'
                      })`
                    : `3D DIORAMA CAMERA (${
                        activeScreen.backgroundConfig.type === '3d-scene'
                          ? activeScreen.backgroundConfig.cameraMode.toUpperCase()
                          : ''
                      })`}
                </span>
                <span>16:9 Normalized Reference Stage · Right-Click for Context Menu</span>
              </div>
            </div>
          )}

          {/* Subtle Authoring Grid & Center Crosshair Guides */}
          {!isInteractivePreview && snapToGrid && (
            <div
              aria-hidden="true"
              className="absolute inset-0 pointer-events-none z-40"
              style={{
                backgroundImage:
                  'linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)',
                backgroundSize: '5% 5%',
              }}
            >
              <div className="absolute left-1/2 top-0 bottom-0 w-[1px] bg-[#38bdf8]/20" />
              <div className="absolute top-1/2 left-0 right-0 h-[1px] bg-[#38bdf8]/20" />
            </div>
          )}

          {/* Runtime Vanilla DOM Renderer Mount */}
          <div ref={domMountRef} className="absolute inset-0 z-10" />

          {/* Interactive Drag, Quick-Delete & Resize Gizmo Layer (Authoring Mode Only) */}
          {!isInteractivePreview && (
            <div className="absolute inset-0 z-50 pointer-events-none">
              {activeScreen.widgets
                .filter((w) => w.visible !== false)
                .map((widget) => {
                  const isSelected = widget.id === selectedWidgetId;
                  return (
                    <div
                      key={widget.id}
                      onContextMenu={(e) => openStageContextMenu(e, widget.id)}
                      onMouseDown={(e) => {
                        if (e.button !== 0) return;
                        e.stopPropagation();
                        setContextMenu(null);
                        onSelectWidget(widget.id);
                        if (widget.locked) return;
                        setDragState({
                          mode: 'move',
                          widgetId: widget.id,
                          startClientX: e.clientX,
                          startClientY: e.clientY,
                          initialRect: { ...widget.rect },
                        });
                      }}
                      style={{
                        left: `${widget.rect.xPct}%`,
                        top: `${widget.rect.yPct}%`,
                        width: `${widget.rect.widthPct}%`,
                        height: `${widget.rect.heightPct}%`,
                        zIndex: (widget.rect.zIndex ?? 1) + 10,
                      }}
                      className={`group absolute pointer-events-auto box-border transition-shadow ${
                        widget.locked ? 'cursor-not-allowed' : 'cursor-move'
                      } ${
                        isSelected
                          ? 'ring-2 ring-[#38bdf8] bg-[#38bdf8]/5'
                          : 'hover:ring-1 hover:ring-[#4ec9b0]/70'
                      }`}
                    >
                      {/* Hover Quick-Delete Pill on Unselected Widgets */}
                      {!isSelected && (
                        <button
                          type="button"
                          onMouseDown={(e) => e.stopPropagation()}
                          onClick={(e) => {
                            e.stopPropagation();
                            onDeleteWidget(widget.id);
                          }}
                          title={`Delete ${widget.name}`}
                          className="opacity-0 group-hover:opacity-100 transition-opacity absolute -top-2.5 -right-2.5 w-5 h-5 rounded-full bg-red-600 hover:bg-red-500 text-white flex items-center justify-center shadow-lg border border-red-300/60 cursor-pointer z-30"
                        >
                          <Trash2 className="w-2.5 h-2.5" />
                        </button>
                      )}

                      {isSelected && (
                        <>
                          {/* Top Coordinate Readout + Floating Action Pill (Duplicate, Lock, Delete) */}
                          <div
                            onMouseDown={(e) => e.stopPropagation()}
                            className="absolute -top-6 left-0 flex items-center gap-1 bg-[#094771] border border-[#38bdf8]/60 text-white text-[9px] font-mono px-1.5 py-0.5 whitespace-nowrap rounded shadow-lg pointer-events-auto z-40"
                          >
                            <span>
                              {widget.name} · X:{widget.rect.xPct}% Y:
                              {widget.rect.yPct}%
                            </span>
                            <span className="mx-0.5 text-[#38bdf8]/60">|</span>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onDuplicateWidget(widget.id);
                              }}
                              title="Duplicate Element (Ctrl+D)"
                              className="p-0.5 hover:bg-white/15 rounded text-sky-200 hover:text-white cursor-pointer"
                            >
                              <Copy className="w-2.5 h-2.5" />
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onToggleWidgetLock(widget.id);
                              }}
                              title={
                                widget.locked
                                  ? 'Unlock Element Position'
                                  : 'Lock Element Position'
                              }
                              className="p-0.5 hover:bg-white/15 rounded text-amber-300 hover:text-white cursor-pointer"
                            >
                              {widget.locked ? (
                                <Lock className="w-2.5 h-2.5" />
                              ) : (
                                <Unlock className="w-2.5 h-2.5" />
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onDeleteWidget(widget.id);
                              }}
                              title="Delete Element (Delete / Backspace)"
                              className="p-0.5 bg-red-600/80 hover:bg-red-500 rounded text-white cursor-pointer ml-0.5"
                            >
                              <Trash2 className="w-2.5 h-2.5" />
                            </button>
                          </div>

                          {/* 8-Point Resize Handles */}
                          {!widget.locked &&
                            (
                              [
                                'nw',
                                'n',
                                'ne',
                                'e',
                                'se',
                                's',
                                'sw',
                                'w',
                              ] as ResizeHandleDir[]
                            ).map((dir) => {
                              const posStyles: Record<
                                ResizeHandleDir,
                                React.CSSProperties
                              > = {
                                nw: { top: -4, left: -4, cursor: 'nwse-resize' },
                                n: {
                                  top: -4,
                                  left: 'calc(50% - 4px)',
                                  cursor: 'ns-resize',
                                },
                                ne: {
                                  top: -4,
                                  right: -4,
                                  cursor: 'nesw-resize',
                                },
                                e: {
                                  top: 'calc(50% - 4px)',
                                  right: -4,
                                  cursor: 'ew-resize',
                                },
                                se: {
                                  bottom: -4,
                                  right: -4,
                                  cursor: 'nwse-resize',
                                },
                                s: {
                                  bottom: -4,
                                  left: 'calc(50% - 4px)',
                                  cursor: 'ns-resize',
                                },
                                sw: {
                                  bottom: -4,
                                  left: -4,
                                  cursor: 'nesw-resize',
                                },
                                w: {
                                  top: 'calc(50% - 4px)',
                                  left: -4,
                                  cursor: 'ew-resize',
                                },
                              };
                              return (
                                <div
                                  key={dir}
                                  onMouseDown={(e) => {
                                    if (e.button !== 0) return;
                                    e.stopPropagation();
                                    setDragState({
                                      mode: 'resize',
                                      widgetId: widget.id,
                                      handle: dir,
                                      startClientX: e.clientX,
                                      startClientY: e.clientY,
                                      initialRect: { ...widget.rect },
                                    });
                                  }}
                                  style={posStyles[dir]}
                                  className="absolute w-2 h-2 bg-white border border-[#0284c7] shadow"
                                />
                              );
                            })}
                        </>
                      )}
                    </div>
                  );
                })}
            </div>
          )}
        </div>
      </div>

      {/* Right-Click Context Menu Popup */}
      {contextMenu && (
        <div
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
          style={{
            left: `${contextMenu.clientX}px`,
            top: `${contextMenu.clientY}px`,
          }}
          className="fixed z-[100] w-[228px] bg-[#1e1f24] border border-[#3e3e42] rounded shadow-2xl py-1 text-xs text-zinc-200 select-none"
        >
          {contextTargetWidget ? (
            <>
              <div className="px-2.5 py-1.5 border-b border-[#333338] flex items-center justify-between gap-2 bg-[#16171b]">
                <span className="font-semibold text-white truncate">
                  {contextTargetWidget.name}
                </span>
                <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30 shrink-0">
                  {contextTargetWidget.type}
                </span>
              </div>

              <button
                type="button"
                onClick={() => {
                  onDuplicateWidget(contextTargetWidget.id);
                  setContextMenu(null);
                }}
                className="w-full px-2.5 py-1.5 flex items-center justify-between hover:bg-[#094771] hover:text-white transition-colors cursor-pointer"
              >
                <span className="flex items-center gap-2">
                  <Copy className="w-3.5 h-3.5 text-[#38bdf8]" />
                  <span>Duplicate Element</span>
                </span>
                <span className="text-[10px] font-mono text-zinc-400">
                  Ctrl+D
                </span>
              </button>

              <button
                type="button"
                onClick={() => {
                  onCenterWidget(contextTargetWidget.id, 'x');
                  setContextMenu(null);
                }}
                className="w-full px-2.5 py-1.5 flex items-center justify-between hover:bg-[#094771] hover:text-white transition-colors cursor-pointer"
              >
                <span className="flex items-center gap-2">
                  <AlignCenterHorizontal className="w-3.5 h-3.5 text-zinc-400" />
                  <span>Center Horizontally (X)</span>
                </span>
              </button>

              <button
                type="button"
                onClick={() => {
                  onCenterWidget(contextTargetWidget.id, 'y');
                  setContextMenu(null);
                }}
                className="w-full px-2.5 py-1.5 flex items-center justify-between hover:bg-[#094771] hover:text-white transition-colors cursor-pointer"
              >
                <span className="flex items-center gap-2">
                  <AlignCenterVertical className="w-3.5 h-3.5 text-zinc-400" />
                  <span>Center Vertically (Y)</span>
                </span>
              </button>

              <div className="my-1 border-t border-[#333338]" />

              <button
                type="button"
                onClick={() => {
                  onBringToFront(contextTargetWidget.id);
                  setContextMenu(null);
                }}
                className="w-full px-2.5 py-1.5 flex items-center justify-between hover:bg-[#094771] hover:text-white transition-colors cursor-pointer"
              >
                <span className="flex items-center gap-2">
                  <ArrowUpToLine className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Bring to Front</span>
                </span>
                <span className="text-[10px] font-mono text-zinc-400">
                  z{contextTargetWidget.rect.zIndex}
                </span>
              </button>

              <button
                type="button"
                onClick={() => {
                  onSendToBack(contextTargetWidget.id);
                  setContextMenu(null);
                }}
                className="w-full px-2.5 py-1.5 flex items-center justify-between hover:bg-[#094771] hover:text-white transition-colors cursor-pointer"
              >
                <span className="flex items-center gap-2">
                  <ArrowDownToLine className="w-3.5 h-3.5 text-zinc-400" />
                  <span>Send to Back</span>
                </span>
              </button>

              <button
                type="button"
                onClick={() => {
                  onCycleWidgetShape(contextTargetWidget.id);
                  setContextMenu(null);
                }}
                className="w-full px-2.5 py-1.5 flex items-center justify-between hover:bg-[#094771] hover:text-white transition-colors cursor-pointer"
              >
                <span className="flex items-center gap-2">
                  <Shapes className="w-3.5 h-3.5 text-amber-400" />
                  <span>Cycle Shape Style</span>
                </span>
                <span className="text-[10px] font-mono text-zinc-400">
                  {contextTargetWidget.style.shape}
                </span>
              </button>

              <div className="my-1 border-t border-[#333338]" />

              <button
                type="button"
                onClick={() => {
                  onToggleWidgetLock(contextTargetWidget.id);
                  setContextMenu(null);
                }}
                className="w-full px-2.5 py-1.5 flex items-center justify-between hover:bg-[#094771] hover:text-white transition-colors cursor-pointer"
              >
                <span className="flex items-center gap-2">
                  {contextTargetWidget.locked ? (
                    <Unlock className="w-3.5 h-3.5 text-amber-400" />
                  ) : (
                    <Lock className="w-3.5 h-3.5 text-zinc-400" />
                  )}
                  <span>
                    {contextTargetWidget.locked
                      ? 'Unlock Position'
                      : 'Lock Position'}
                  </span>
                </span>
              </button>

              <button
                type="button"
                onClick={() => {
                  onToggleWidgetVisible(contextTargetWidget.id);
                  setContextMenu(null);
                }}
                className="w-full px-2.5 py-1.5 flex items-center justify-between hover:bg-[#094771] hover:text-white transition-colors cursor-pointer"
              >
                <span className="flex items-center gap-2">
                  <EyeOff className="w-3.5 h-3.5 text-zinc-400" />
                  <span>Hide Element</span>
                </span>
              </button>

              <div className="my-1 border-t border-[#333338]" />

              <button
                type="button"
                onClick={() => {
                  onDeleteWidget(contextTargetWidget.id);
                  setContextMenu(null);
                }}
                className="w-full px-2.5 py-1.5 flex items-center justify-between text-red-400 hover:bg-red-600 hover:text-white transition-colors cursor-pointer font-medium"
              >
                <span className="flex items-center gap-2">
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Delete Element</span>
                </span>
                <span className="text-[10px] font-mono opacity-80">Del</span>
              </button>
            </>
          ) : (
            <>
              <div className="px-2.5 py-1.5 border-b border-[#333338] flex items-center justify-between bg-[#16171b]">
                <span className="font-semibold text-zinc-200 flex items-center gap-1.5">
                  <Sparkles className="w-3 h-3 text-amber-400" />
                  Canvas Quick-Insert
                </span>
                <span className="text-[9px] font-mono text-zinc-400">
                  X:{contextMenu.stageXPct}% Y:{contextMenu.stageYPct}%
                </span>
              </div>

              {(
                [
                  { type: 'button', label: 'Add Action Button Here' },
                  { type: 'title-text', label: 'Add Title / Text Block Here' },
                  { type: 'panel', label: 'Add Frame / Panel Here' },
                  { type: 'image', label: 'Add Image / Insignia Here' },
                  { type: 'stat-readout', label: 'Add Live Stat Readout Here' },
                  {
                    type: 'inventory-grid',
                    label: 'Add Inventory Grid Here',
                  },
                  { type: 'slider-setting', label: 'Add Setting Slider Here' },
                  { type: 'save-slot-list', label: 'Add Save / Load Slots Here' },
                ] as { type: MenuWidgetType; label: string }[]
              ).map((item) => (
                <button
                  key={item.type}
                  type="button"
                  onClick={() => {
                    onDropNewWidgetAt(
                      item.type,
                      contextMenu.stageXPct,
                      contextMenu.stageYPct
                    );
                    setContextMenu(null);
                  }}
                  className="w-full px-2.5 py-1.5 flex items-center gap-2 hover:bg-[#094771] hover:text-white transition-colors cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5 text-[#4ec9b0]" />
                  <span>{item.label}</span>
                </button>
              ))}

              <div className="my-1 border-t border-[#333338]" />

              <button
                type="button"
                onClick={() => {
                  setSnapToGrid((prev) => !prev);
                  setContextMenu(null);
                }}
                className="w-full px-2.5 py-1.5 flex items-center justify-between hover:bg-[#094771] hover:text-white transition-colors cursor-pointer"
              >
                <span className="flex items-center gap-2">
                  <Grid className="w-3.5 h-3.5 text-[#38bdf8]" />
                  <span>Snap to Grid</span>
                </span>
                <span className="text-[10px] font-mono text-zinc-400">
                  {snapToGrid ? 'ON' : 'OFF'}
                </span>
              </button>

              {activeScreen.widgets.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    onClearScreenWidgets();
                    setContextMenu(null);
                  }}
                  className="w-full px-2.5 py-1.5 flex items-center gap-2 text-red-400 hover:bg-red-600 hover:text-white transition-colors cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Clear All Unlocked Elements</span>
                </button>
              )}
            </>
          )}
        </div>
      )}

      {/* Studio Bottom Helper Bar */}
      <div className="h-[26px] bg-[#1e1e1e] border-t border-[#3e3e42] px-3 flex items-center justify-between text-[10px] font-mono text-[#858585]">
        <span>
          Screen: <strong className="text-[#cccccc]">{activeScreen.name}</strong> (
          {activeScreen.category === 'in-game-overlay'
            ? `Overlay · Hotkey: ${activeScreen.overlayConfig?.triggerHotkey || 'Escape'}`
            : `Out-of-Game · BG: ${activeScreen.backgroundConfig.type.toUpperCase()}`}
          )
        </span>
        <span>
          {selectedWidget
            ? `Selected: ${selectedWidget.name} [${selectedWidget.type}] — Press Del to delete or Right-Click for actions`
            : 'Click or Right-Click any UI element on the 16:9 canvas to customize or delete'}
        </span>
      </div>
    </section>
  );
};
