import React, { useState, useMemo } from 'react';
import {
  MenuButtonShape,
  MenuPackSpec,
  MenuScreenSpec,
  MenuWidgetSpec,
  MenuWidgetType,
  TextureAsset,
  createMenuPackFromPreset,
  createNewMenuWidget,
  cloneMenuPackSpec,
} from '../../types/engine';
import { MenuWidgetPalette } from './MenuWidgetPalette';
import { MenuCanvasEditor } from './MenuCanvasEditor';
import { MenuInspector } from './MenuInspector';

interface MenuStudioWorkspaceProps {
  menuPack: MenuPackSpec;
  gameTitle: string;
  textures: TextureAsset[];
  campaignLevelNames: string[];
  onChangeMenuPack: (nextPack: MenuPackSpec) => void;
  onLaunch3DTestWithMainMenu: () => void;
}

const SHAPE_CYCLE_ORDER: MenuButtonShape[] = [
  'chamfered',
  'rounded',
  'rectangle',
  'pill',
  'underline',
];

export const MenuStudioWorkspace: React.FC<MenuStudioWorkspaceProps> = ({
  menuPack,
  gameTitle,
  textures,
  campaignLevelNames,
  onChangeMenuPack,
  onLaunch3DTestWithMainMenu,
}) => {
  const [activeScreenId, setActiveScreenId] = useState<string>(
    menuPack.entryMainMenuScreenId || menuPack.screens[0]?.id || 'screen-main-menu'
  );
  const [selectedWidgetId, setSelectedWidgetId] = useState<string | null>(null);

  const activeScreen: MenuScreenSpec = useMemo(() => {
    return (
      menuPack.screens.find((s) => s.id === activeScreenId) ||
      menuPack.screens[0]
    );
  }, [menuPack.screens, activeScreenId]);

  const selectedWidget: MenuWidgetSpec | null = useMemo(() => {
    if (!selectedWidgetId || !activeScreen) return null;
    return activeScreen.widgets.find((w) => w.id === selectedWidgetId) || null;
  }, [activeScreen, selectedWidgetId]);

  const updatePack = (updater: (prev: MenuPackSpec) => MenuPackSpec) => {
    const cloned = cloneMenuPackSpec(menuPack);
    onChangeMenuPack(updater(cloned));
  };

  const updateActiveScreen = (updater: (prev: MenuScreenSpec) => MenuScreenSpec) => {
    updatePack((prev) => ({
      ...prev,
      screens: prev.screens.map((s) => (s.id === activeScreen.id ? updater(s) : s)),
    }));
  };

  const updateWidget = (widgetId: string, updater: (prev: MenuWidgetSpec) => MenuWidgetSpec) => {
    updateActiveScreen((screen) => ({
      ...screen,
      widgets: screen.widgets.map((w) => (w.id === widgetId ? updater(w) : w)),
    }));
  };

  const handleApplyPreset = (presetId: string) => {
    const freshPack = createMenuPackFromPreset(presetId, gameTitle);
    onChangeMenuPack(freshPack);
    setActiveScreenId(freshPack.entryMainMenuScreenId);
    setSelectedWidgetId(null);
  };

  const handleAddWidget = (type: MenuWidgetType, dropPosition?: { xPct: number; yPct: number }) => {
    const newWidget = createNewMenuWidget(
      type,
      menuPack.theme,
      activeScreen.widgets.length,
      dropPosition
    );
    updateActiveScreen((screen) => ({
      ...screen,
      widgets: [...screen.widgets, newWidget],
    }));
    setSelectedWidgetId(newWidget.id);
  };

  const handleDuplicateWidget = (widgetId: string) => {
    const source = activeScreen.widgets.find((w) => w.id === widgetId);
    if (!source) return;
    const copy: MenuWidgetSpec = JSON.parse(JSON.stringify(source));
    copy.id = `${source.type}-${Date.now().toString(36).slice(-4)}`;
    copy.name = `${source.name} Copy`;
    copy.rect.xPct = Math.min(92, Math.round((source.rect.xPct + 2) * 10) / 10);
    copy.rect.yPct = Math.min(92, Math.round((source.rect.yPct + 3) * 10) / 10);
    copy.rect.zIndex = source.rect.zIndex + 1;

    updateActiveScreen((screen) => ({
      ...screen,
      widgets: [...screen.widgets, copy],
    }));
    setSelectedWidgetId(copy.id);
  };

  const handleDeleteWidget = (widgetId: string) => {
    updateActiveScreen((screen) => ({
      ...screen,
      widgets: screen.widgets.filter((w) => w.id !== widgetId),
    }));
    if (selectedWidgetId === widgetId) {
      setSelectedWidgetId(null);
    }
  };

  const handleToggleWidgetVisible = (widgetId: string) => {
    updateWidget(widgetId, (w) => ({
      ...w,
      visible: w.visible === false ? true : false,
    }));
  };

  const handleToggleWidgetLock = (widgetId: string) => {
    updateWidget(widgetId, (w) => ({
      ...w,
      locked: !w.locked,
    }));
  };

  const handleBringToFront = (widgetId: string) => {
    const maxZ = activeScreen.widgets.reduce(
      (max, w) => Math.max(max, w.rect.zIndex ?? 1),
      1
    );
    updateWidget(widgetId, (w) => ({
      ...w,
      rect: {
        ...w.rect,
        zIndex: maxZ + 2,
      },
    }));
  };

  const handleSendToBack = (widgetId: string) => {
    updateWidget(widgetId, (w) => ({
      ...w,
      rect: {
        ...w.rect,
        zIndex: Math.max(1, (w.rect.zIndex ?? 1) - 5),
      },
    }));
  };

  const handleCenterWidget = (widgetId: string, axis: 'x' | 'y' | 'both') => {
    updateWidget(widgetId, (w) => ({
      ...w,
      rect: {
        ...w.rect,
        xPct:
          axis === 'x' || axis === 'both'
            ? Math.round((50 - w.rect.widthPct / 2) * 10) / 10
            : w.rect.xPct,
        yPct:
          axis === 'y' || axis === 'both'
            ? Math.round((50 - w.rect.heightPct / 2) * 10) / 10
            : w.rect.yPct,
      },
    }));
  };

  const handleCycleWidgetShape = (widgetId: string) => {
    updateWidget(widgetId, (w) => {
      const idx = SHAPE_CYCLE_ORDER.indexOf(w.style.shape);
      const nextShape =
        SHAPE_CYCLE_ORDER[(idx + 1) % SHAPE_CYCLE_ORDER.length];
      return {
        ...w,
        style: {
          ...w.style,
          shape: nextShape,
        },
      };
    });
  };

  const handleClearScreenWidgets = () => {
    updateActiveScreen((screen) => ({
      ...screen,
      widgets: screen.widgets.filter((w) => w.locked),
    }));
    setSelectedWidgetId(null);
  };

  const handleAddScreen = (category: MenuScreenSpec['category']) => {
    const id = `screen-${Date.now().toString(36).slice(-4)}`;
    const isOverlay = category === 'in-game-overlay';
    const newScreen: MenuScreenSpec = {
      id,
      name: isOverlay ? 'Custom In-Game Overlay' : 'Custom Menu Screen',
      category,
      backgroundConfig: {
        type: '3d-scene',
        levelIndex: 0,
        cameraMode: 'orbit',
        cameraTarget: { row: 4, col: 4, elevationMeters: 1.5 },
        orbitRadiusMeters: 9,
        orbitSpeedRadPerSec: 0.2,
        fov: 65,
      },
      overlayConfig: isOverlay
        ? {
            pauseSimulation: true,
            dimOpacity: 0.72,
            dimColorHex: '#050608',
            backdropBlurPx: 6,
            scanlineEffect: true,
            triggerHotkey: 'Tab',
            hideCombatHud: false,
          }
        : undefined,
      widgets: [
        createNewMenuWidget('panel', menuPack.theme, 0, { xPct: 50, yPct: 50 }),
        createNewMenuWidget('title-text', menuPack.theme, 1, { xPct: 50, yPct: 26 }),
        createNewMenuWidget('button', menuPack.theme, 2, { xPct: 50, yPct: 55 }),
      ],
    };

    updatePack((prev) => ({
      ...prev,
      screens: [...prev.screens, newScreen],
    }));
    setActiveScreenId(id);
    setSelectedWidgetId(newScreen.widgets[2].id);
  };

  const handleDuplicateScreen = (screenId: string) => {
    const src = menuPack.screens.find((s) => s.id === screenId);
    if (!src) return;
    const copy: MenuScreenSpec = JSON.parse(JSON.stringify(src));
    copy.id = `screen-${Date.now().toString(36).slice(-4)}`;
    copy.name = `${src.name} Copy`;
    updatePack((prev) => ({
      ...prev,
      screens: [...prev.screens, copy],
    }));
    setActiveScreenId(copy.id);
    setSelectedWidgetId(null);
  };

  const handleDeleteScreen = (screenId: string) => {
    if (menuPack.screens.length <= 1) return;
    const remaining = menuPack.screens.filter((s) => s.id !== screenId);
    updatePack((prev) => ({
      ...prev,
      screens: remaining,
      entryMainMenuScreenId:
        prev.entryMainMenuScreenId === screenId ? remaining[0].id : prev.entryMainMenuScreenId,
      pauseOverlayScreenId:
        prev.pauseOverlayScreenId === screenId ? remaining[0].id : prev.pauseOverlayScreenId,
    }));
    if (activeScreenId === screenId) {
      setActiveScreenId(remaining[0].id);
      setSelectedWidgetId(null);
    }
  };

  return (
    <div className="flex-1 flex min-h-0 overflow-hidden bg-[#0b0c0e]">
      <MenuWidgetPalette
        menuPack={menuPack}
        activeScreen={activeScreen}
        selectedWidgetId={selectedWidgetId}
        onSelectWidget={setSelectedWidgetId}
        onAddWidget={(type) => handleAddWidget(type)}
        onDuplicateWidget={handleDuplicateWidget}
        onToggleWidgetVisible={handleToggleWidgetVisible}
        onToggleWidgetLock={handleToggleWidgetLock}
        onDeleteWidget={handleDeleteWidget}
        onApplyPreset={handleApplyPreset}
      />

      <MenuCanvasEditor
        menuPack={menuPack}
        activeScreen={activeScreen}
        selectedWidgetId={selectedWidgetId}
        customTextures={textures}
        levelTitles={campaignLevelNames}
        onSelectScreen={(id) => {
          setActiveScreenId(id);
          setSelectedWidgetId(null);
        }}
        onAddScreen={handleAddScreen}
        onDuplicateScreen={handleDuplicateScreen}
        onDeleteScreen={handleDeleteScreen}
        onSelectWidget={setSelectedWidgetId}
        onUpdateWidgetRect={(widgetId, nextRect) => {
          updateWidget(widgetId, (w) => ({
            ...w,
            rect: nextRect,
          }));
        }}
        onDropNewWidgetAt={(type, xPct, yPct) => handleAddWidget(type, { xPct, yPct })}
        onDuplicateWidget={handleDuplicateWidget}
        onDeleteWidget={handleDeleteWidget}
        onToggleWidgetLock={handleToggleWidgetLock}
        onToggleWidgetVisible={handleToggleWidgetVisible}
        onBringToFront={handleBringToFront}
        onSendToBack={handleSendToBack}
        onCenterWidget={handleCenterWidget}
        onCycleWidgetShape={handleCycleWidgetShape}
        onClearScreenWidgets={handleClearScreenWidgets}
        onLaunch3DTestPlayWithMenus={onLaunch3DTestWithMainMenu}
      />

      <MenuInspector
        menuPack={menuPack}
        activeScreen={activeScreen}
        selectedWidget={selectedWidget}
        textures={textures}
        campaignLevelNames={campaignLevelNames}
        onUpdatePack={updatePack}
        onUpdateScreen={updateActiveScreen}
        onUpdateWidget={updateWidget}
        onDuplicateWidget={handleDuplicateWidget}
        onDeleteWidget={handleDeleteWidget}
      />
    </div>
  );
};
