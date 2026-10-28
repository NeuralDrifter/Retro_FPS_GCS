/**
 * ============================================================================
 * GRIDFORGE 3D DESKTOP IDE — 3D LEVEL EDITOR VIEWPORT (CENTER PANE, EDIT MODE)
 * ============================================================================
 * Fly through the level, pick and move models with arrows and rotate rings,
 * drop models and textures from the asset library straight onto surfaces, and
 * switch to Test Play. The scene itself lives in `editor3d/EditorScene.ts`.
 */

import React, { useEffect, useRef, useState } from 'react';
import { EyeOff, Eye, Magnet, Move3d, Play, RotateCw } from 'lucide-react';
import { PlacedEntity } from '../types/engine';
import { WalkSurfaceSpec } from '../runtime/sim';
import { EditorLevelInput, EditorScene, ModelBounds, SurfaceHit } from '../editor3d/EditorScene';
import { VARIANT_DRAG_TYPE } from './inspector/modelLibrary/UsedInLevelList';

const MODEL_DRAG_TYPE = 'application/gridforge-model-id';
const TEXTURE_DRAG_TYPE = 'application/gridforge-texture-id';

export interface SurfaceDrop {
  hit: SurfaceHit;
  /** The hit point snapped to the editor grid (when snapping is on) */
  point: { x: number; y: number; z: number };
}

interface EditorViewport3DProps {
  level: EditorLevelInput;
  /** Classic retro levels: models move along the floor and turn only flat */
  classic?: boolean;
  activeLayer: number;
  selectedEntityId: string | null;
  selectedCell: { row: number; col: number };
  onSelectEntity: (entityId: string | null) => void;
  onSelectCell: (row: number, col: number, layer: number) => void;
  onCommitEntityTransform: (updated: PlacedEntity) => void;
  onDeleteEntity: (entityId: string) => void;
  onWalkSurfaceBaked: (entityId: string, surface: WalkSurfaceSpec) => void;
  onModelBoundsMeasured: (entityId: string, bounds: ModelBounds) => void;
  onDropModel: (modelAssetId: string, drop: SurfaceDrop) => void;
  onDropVariant: (sourceEntityId: string, drop: SurfaceDrop) => void;
  onDropTexture: (textureId: string, hit: SurfaceHit) => void;
  onEnterPlay: () => void;
}

export const EditorViewport3D: React.FC<EditorViewport3DProps> = ({
  level,
  classic = false,
  activeLayer,
  selectedEntityId,
  selectedCell,
  onSelectEntity,
  onSelectCell,
  onCommitEntityTransform,
  onDeleteEntity,
  onWalkSurfaceBaked,
  onModelBoundsMeasured,
  onDropModel,
  onDropVariant,
  onDropTexture,
  onEnterPlay,
}) => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<EditorScene | null>(null);
  const [gizmoMode, setGizmoMode] = useState<'translate' | 'rotate'>('translate');
  const [snap, setSnap] = useState(true);
  // On by default: a new layer starts solid and would otherwise roof over the one below
  const [hideAbove, setHideAbove] = useState(true);
  const [dropHint, setDropHint] = useState<string | null>(null);

  // The scene calls back through refs so it always reaches the latest handlers
  const callbacksRef = useRef({
    onSelectEntity,
    onSelectCell,
    onCommitEntityTransform,
    onDeleteEntity,
    onWalkSurfaceBaked,
    onModelBoundsMeasured,
  });
  callbacksRef.current = {
    onSelectEntity,
    onSelectCell,
    onCommitEntityTransform,
    onDeleteEntity,
    onWalkSurfaceBaked,
    onModelBoundsMeasured,
  };

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const scene = new EditorScene(mount, {
      onSelectEntity: (id) => callbacksRef.current.onSelectEntity(id),
      onSelectCell: (r, c, l) => callbacksRef.current.onSelectCell(r, c, l),
      onCommitEntityTransform: (e) => callbacksRef.current.onCommitEntityTransform(e),
      onDeleteEntity: (id) => callbacksRef.current.onDeleteEntity(id),
      onWalkSurfaceBaked: (id, s) => callbacksRef.current.onWalkSurfaceBaked(id, s),
      onModelBoundsMeasured: (id, b) => callbacksRef.current.onModelBoundsMeasured(id, b),
    });
    sceneRef.current = scene;
    return () => {
      scene.dispose();
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => {
    sceneRef.current?.setLevel(level);
  }, [level]);

  useEffect(() => {
    sceneRef.current?.setActiveLayer(activeLayer, hideAbove);
  }, [activeLayer, hideAbove]);

  useEffect(() => {
    sceneRef.current?.select(selectedEntityId, false);
  }, [selectedEntityId]);

  useEffect(() => {
    sceneRef.current?.highlightCell(
      selectedEntityId ? null : { ...selectedCell, layer: activeLayer }
    );
  }, [selectedCell, activeLayer, selectedEntityId]);

  useEffect(() => {
    sceneRef.current?.setGizmoMode(gizmoMode);
  }, [gizmoMode]);

  useEffect(() => {
    sceneRef.current?.setClassic(classic);
  }, [classic]);

  useEffect(() => {
    sceneRef.current?.setSnap(snap);
  }, [snap]);

  const dropTypes = (e: React.DragEvent) => {
    const t = e.dataTransfer.types;
    return {
      model: t.includes(MODEL_DRAG_TYPE),
      variant: t.includes(VARIANT_DRAG_TYPE),
      texture: t.includes(TEXTURE_DRAG_TYPE),
    };
  };

  const handleDragOver = (e: React.DragEvent) => {
    const types = dropTypes(e);
    if (!types.model && !types.variant && !types.texture) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    const hit = sceneRef.current?.pickSurface(e.clientX, e.clientY);
    setDropHint(
      hit
        ? `${types.texture ? 'Paint' : 'Place on'} ${hit.surface} · tile X${hit.col} Z${hit.row} · layer ${hit.layer}`
        : 'Point at a floor, wall or ceiling'
    );
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDropHint(null);
    const scene = sceneRef.current;
    const hit = scene?.pickSurface(e.clientX, e.clientY);
    if (!scene || !hit) return;
    const drop: SurfaceDrop = { hit, point: scene.snapPoint(hit) };
    const variantId = e.dataTransfer.getData(VARIANT_DRAG_TYPE);
    if (variantId) {
      onDropVariant(variantId, drop);
      return;
    }
    const modelId = e.dataTransfer.getData(MODEL_DRAG_TYPE);
    if (modelId) {
      onDropModel(modelId, drop);
      return;
    }
    const texId = e.dataTransfer.getData(TEXTURE_DRAG_TYPE);
    if (texId) onDropTexture(texId, hit);
  };

  const toolButton = (active: boolean) =>
    `flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded transition-colors ${
      active ? 'bg-[#478cbf] text-white' : 'text-[#9d9d9d] hover:text-white hover:bg-[#2d2d30]'
    }`;

  return (
    <section
      aria-label="3D Level Editor"
      className="flex flex-col w-full h-full bg-[#1e1e1e] overflow-hidden"
    >
      <div className="ide-panel-header !h-auto min-h-[26px] py-0.5 flex items-center justify-between gap-2 overflow-x-auto no-scrollbar">
        <div className="flex items-center gap-2 shrink-0">
          <span className="font-semibold text-white">3D Editor</span>
          <span className="font-mono text-[#478cbf]">Layer {activeLayer}</span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            className={toolButton(gizmoMode === 'translate')}
            onClick={() => setGizmoMode('translate')}
            title="Move arrows (G)"
          >
            <Move3d className="w-3 h-3" /> Move
          </button>
          <button
            type="button"
            className={toolButton(gizmoMode === 'rotate')}
            onClick={() => setGizmoMode('rotate')}
            title="Rotate rings (R)"
          >
            <RotateCw className="w-3 h-3" /> Rotate
          </button>
          <button
            type="button"
            className={toolButton(snap)}
            onClick={() => setSnap((s) => !s)}
            title="Snap moves to 0.25 m and turns to 15°"
          >
            <Magnet className="w-3 h-3" /> Snap
          </button>
          <button
            type="button"
            className={toolButton(hideAbove)}
            onClick={() => setHideAbove((h) => !h)}
            title="Hide everything above the layer you are editing"
          >
            {hideAbove ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />} Layers above
          </button>
          <button
            type="button"
            onClick={onEnterPlay}
            className="flex items-center gap-1 ml-1 px-2 py-0.5 text-[10px] font-semibold rounded bg-[#2e7d32] hover:bg-[#388e3c] text-white"
            title="Play the level in this pane"
          >
            <Play className="w-3 h-3" /> Test Play
          </button>
        </div>
      </div>

      <div
        ref={mountRef}
        className="relative flex-1 min-h-0"
        onDragOver={handleDragOver}
        onDragLeave={() => setDropHint(null)}
        onDrop={handleDrop}
      >
        {dropHint && (
          <div className="absolute top-2 left-1/2 -translate-x-1/2 z-10 px-2 py-1 rounded bg-black/70 text-[11px] text-white pointer-events-none">
            {dropHint}
          </div>
        )}
        <div className="absolute bottom-1.5 left-2 z-10 text-[10px] text-[#9d9d9d] bg-black/50 px-1.5 py-0.5 rounded pointer-events-none">
          Hold right mouse: look, W/A/S/D/Q/E fly (Shift faster, wheel sets speed) · Wheel: forward/back ·
          Click: select · G move · R rotate · F focus · Del delete
        </div>
      </div>
    </section>
  );
};
