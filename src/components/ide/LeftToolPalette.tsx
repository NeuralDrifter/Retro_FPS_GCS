import React from 'react';
import { EditorToolMode } from '../../types/engine';
import {
  ArrowUpFromLine,
  Bot,
  CircleDashed,
  DoorClosed,
  Eraser,
  KeyRound,
  MousePointerClick,
  Navigation,
  Paintbrush,
  Redo2,
  Square,
  Triangle,
  Undo2,
} from 'lucide-react';

interface LeftToolPaletteProps {
  toolMode: EditorToolMode;
  onSelectTool: (mode: EditorToolMode) => void;
  pastHistoryCount: number;
  futureHistoryCount: number;
  nextUndoLabel: string | null;
  nextRedoLabel: string | null;
  onUndo: () => void;
  onRedo: () => void;
  /** Tools that are switched off (classic retro levels have no heights, slopes or holes) */
  disabledModes?: EditorToolMode[];
}

const TOOL_ITEMS: {
  mode: EditorToolMode;
  label: string;
  icon: React.ReactNode;
}[] = [
  {
    mode: 'toggle',
    label: 'Toggle Wall / Empty Space (Click/Drag)',
    icon: <MousePointerClick className="w-4 h-4" />,
  },
  {
    mode: 'wall',
    label: 'Draw Solid Wall Block',
    icon: <Square className="w-4 h-4" />,
  },
  {
    mode: 'empty',
    label: 'Eraser (Clear Wall & Entity)',
    icon: <Eraser className="w-4 h-4" />,
  },
  {
    mode: 'paint',
    label: 'Paint Surface Material Texture',
    icon: <Paintbrush className="w-4 h-4" />,
  },
  {
    mode: 'entity',
    label: 'Place / Remove 3D .glb Entity & Enemy AI',
    icon: <Bot className="w-4 h-4" />,
  },
  {
    mode: 'door',
    label: 'Place Interactive Bulkhead Door',
    icon: <DoorClosed className="w-4 h-4" />,
  },
  {
    mode: 'key',
    label: 'Place Collectible Keycard',
    icon: <KeyRound className="w-4 h-4" />,
  },
  {
    mode: 'spawn',
    label: 'Set First-Person Player Spawn Point',
    icon: <Navigation className="w-4 h-4" />,
  },
  {
    mode: 'height',
    label: 'Raise / Lower Floor or Ceiling (settings above the map)',
    icon: <ArrowUpFromLine className="w-4 h-4" />,
  },
  {
    mode: 'slope',
    label: 'Slope a Floor or Ceiling (click to turn it N, E, S, W, flat)',
    icon: <Triangle className="w-4 h-4" />,
  },
  {
    mode: 'hole',
    label: 'Cut a Hole in the Floor (open to the layer below)',
    icon: <CircleDashed className="w-4 h-4" />,
  },
];

export const LeftToolPalette: React.FC<LeftToolPaletteProps> = ({
  toolMode,
  onSelectTool,
  pastHistoryCount,
  futureHistoryCount,
  nextUndoLabel,
  nextRedoLabel,
  onUndo,
  onRedo,
  disabledModes = [],
}) => {
  return (
    <nav className="ide-toolbar" aria-label="Editor Tool Palette">
      {TOOL_ITEMS.map((item) => (
        <button
          key={item.mode}
          type="button"
          onClick={() => onSelectTool(item.mode)}
          disabled={disabledModes.includes(item.mode)}
          title={
            disabledModes.includes(item.mode)
              ? `${item.label} (off: the level uses classic retro movement)`
              : item.label
          }
          aria-label={item.label}
          className={`ide-tool-btn disabled:opacity-30 disabled:cursor-not-allowed ${
            toolMode === item.mode ? 'ide-tool-btn--active' : ''
          }`}
        >
          {item.icon}
        </button>
      ))}

      <div className="w-6 h-[1px] bg-[#3e3e42] my-1" />

      <button
        type="button"
        onClick={onUndo}
        disabled={pastHistoryCount === 0}
        title={
          nextUndoLabel
            ? `Undo: ${nextUndoLabel} (Ctrl+Z)`
            : 'Nothing to Undo (Ctrl+Z)'
        }
        aria-label="Undo Map Step (Ctrl+Z)"
        className="ide-tool-btn disabled:opacity-30 disabled:cursor-not-allowed"
      >
        <Undo2 className="w-4 h-4" />
      </button>

      <button
        type="button"
        onClick={onRedo}
        disabled={futureHistoryCount === 0}
        title={
          nextRedoLabel
            ? `Redo: ${nextRedoLabel} (Ctrl+Y)`
            : 'Nothing to Redo (Ctrl+Y)'
        }
        aria-label="Redo Map Step (Ctrl+Y)"
        className="ide-tool-btn disabled:opacity-30 disabled:cursor-not-allowed"
      >
        <Redo2 className="w-4 h-4" />
      </button>
    </nav>
  );
};
