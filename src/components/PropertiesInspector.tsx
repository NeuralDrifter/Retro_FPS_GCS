import React, { useEffect, useState } from 'react';
import {
  CampaignSettings,
  CellType,
  Model3DAsset,
  PlacedEntity,
  SkyboxThemeId,
  SurfaceTarget,
  TextureAsset,
} from '../types/engine';
import { CellInspectorTab } from './inspector/CellInspectorTab';
import { AssetLibraryTab } from './inspector/AssetLibraryTab';
import {
  CampaignLevelSummary,
  WorldSettingsTab,
} from './inspector/WorldSettingsTab';
import { VerticalTileSection } from './inspector/VerticalTileSection';
import { MovementSettingsSection } from './inspector/MovementSettingsSection';
import { EditorLayerData } from '../runtime/types';
import { CardinalDirection, MovementSettingsSpec } from '../runtime/sim';
import type {
  ModelLibraryState,
  PlacementVariant,
  ResolvedModelSettings,
} from '../types/modelLibrary';
import { Globe, ImagePlus, Sliders } from 'lucide-react';

export interface PropertiesInspectorProps {
  selectedCell: { row: number; col: number };
  grid: number[][];
  wallTextures: string[][];
  floorTextures: string[][];
  ceilingTextures: string[][];
  textures: TextureAsset[];
  selectedTextureId: string;
  onSelectTexture: (id: string) => void;
  targetSurface: SurfaceTarget;
  onChangeTargetSurface: (surface: SurfaceTarget) => void;
  onAddCustomTexture: (asset: TextureAsset) => void;
  onAssignCellTexture: (
    row: number,
    col: number,
    surface: SurfaceTarget,
    texId: string
  ) => void;
  onFillSurfaceWithTexture: (surface: SurfaceTarget, textureId: string) => void;
  onSetCellType: (row: number, col: number, cellType: CellType) => void;
  spawn: { row: number; col: number; yaw: number };
  onSetSpawnCell: (row: number, col: number) => void;
  onRotateSpawn: () => void;
  entities: PlacedEntity[];
  model3DAssets: Model3DAsset[];
  selectedModelAssetId: string;
  onSelectModelAsset: (assetId: string) => void;
  onAddCustomModel3DAsset: (asset: Model3DAsset) => void;
  onUpdateEntity: (updated: PlacedEntity) => void;
  onPlaceEntityAtCell: (row: number, col: number) => void;
  onRemoveEntity: (entityId: string) => void;
  getLibrarySettings: (entity: PlacedEntity) => ResolvedModelSettings | null;
  skyboxTheme: SkyboxThemeId;
  onChangeSkyboxTheme: (theme: SkyboxThemeId) => void;
  skyboxSeed: number;
  onRegenerateSkybox: () => void;
  showCeiling: boolean;
  onToggleCeiling: () => void;
  minimapEnabled: boolean;
  onToggleMinimap: () => void;
  onBorderWalls: () => void;
  onClearGrid: () => void;
  onResizeMap: (size: number) => void;
  campaignLevels: CampaignLevelSummary[];
  activeLevelIndex: number;
  levelTitle: string;
  onSelectCampaignLevel: (index: number) => void;
  onRenameCampaignLevel: (title: string) => void;
  onAddCampaignLevel: () => void;
  onDuplicateCampaignLevel: () => void;
  onDeleteCampaignLevel: (index: number) => void;
  onMoveCampaignLevel: (index: number, direction: -1 | 1) => void;
  campaignSettings: CampaignSettings;
  onUpdateCampaignSettings: (settings: CampaignSettings) => void;
  onPlaceExitOnSelectedCell: () => void;
  libraryState: ModelLibraryState;
  onLibraryChange: React.Dispatch<React.SetStateAction<ModelLibraryState>>;
  selectedVariantKey: string | null;
  onPickVariant: (variant: PlacementVariant) => void;
  onModelAdded: (asset: Model3DAsset, file?: File) => void;
  onRemoveUploadedModel: (modelId: string) => void;
  onExportLibrary: () => void;
  onImportLibraryFile: (file: File) => void;
  gitHubRepoInput: string;
  isSyncingGitHubAssets: boolean;
  gitHubAssetsStats: {
    repoLabel: string;
    textures: number;
    models: number;
    error?: string;
  };
  onSyncGitHubAssets: (repoInput: string, forceRefresh?: boolean) => void;
  /** Vertical levels: the layer being edited and its heights */
  activeLayer: number;
  layerCount: number;
  layerData: EditorLayerData;
  onSetTileVertical: (
    row: number,
    col: number,
    values: {
      floor?: number;
      ceiling?: number;
      slope?: { dir: CardinalDirection; riseUnits: number } | null;
      ceilingSlope?: { dir: CardinalDirection; riseUnits: number } | null;
    }
  ) => void;
  movement: MovementSettingsSpec;
  onUpdateMovement: (movement: MovementSettingsSpec) => void;
  classic: boolean;
  onToggleClassic: (classic: boolean) => void;
  verticalFeatures: string[];
  /** The model selected in the 3D editor */
  selectedEntityId: string | null;
}

type InspectorTabId = 'inspector' | 'assets' | 'world';

const INSPECTOR_TABS: {
  id: InspectorTabId;
  label: string;
  icon: React.ReactNode;
}[] = [
  { id: 'inspector', label: 'Inspector', icon: <Sliders className="w-3 h-3" /> },
  {
    id: 'assets',
    label: 'Asset Library',
    icon: <ImagePlus className="w-3 h-3" />,
  },
  { id: 'world', label: 'World', icon: <Globe className="w-3 h-3" /> },
];

export const PropertiesInspector: React.FC<PropertiesInspectorProps> = React.memo((
  props
) => {
  const [activeTab, setActiveTab] = useState<InspectorTabId>('assets');
  // Picking a model in the 3D editor opens its settings
  useEffect(() => {
    if (props.selectedEntityId) setActiveTab('inspector');
  }, [props.selectedEntityId]);

  const activeModelAsset =
    props.model3DAssets.find((m) => m.id === props.selectedModelAssetId) ||
    props.model3DAssets[0];

  return (
    <aside className="ide-inspector" aria-label="Properties and Asset Library">
      <div className="ide-panel-header !px-1.5">
        <div className="flex items-center gap-0.5 w-full">
          {INSPECTOR_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`px-2 py-0.5 text-[10px] font-semibold uppercase rounded-[2px] flex items-center gap-1 cursor-pointer ${
                activeTab === tab.id
                  ? 'bg-[#478cbf] text-white'
                  : 'text-[#858585] hover:text-[#cccccc]'
              }`}
            >
              {tab.icon}
              <span>{tab.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto divide-y divide-[#333333]">
        {activeTab === 'inspector' && !props.classic && (
          <VerticalTileSection
            row={props.selectedCell.row}
            col={props.selectedCell.col}
            layer={props.activeLayer}
            layerData={props.layerData}
            onSetTileVertical={props.onSetTileVertical}
          />
        )}
        {activeTab === 'inspector' && (
          <CellInspectorTab
            preferredEntityId={props.selectedEntityId}
            layerCount={props.layerCount}
            classic={props.classic}
            selectedCell={props.selectedCell}
            grid={props.grid}
            wallTextures={props.wallTextures}
            floorTextures={props.floorTextures}
            ceilingTextures={props.ceilingTextures}
            textures={props.textures}
            onAssignCellTexture={props.onAssignCellTexture}
            onSetCellType={props.onSetCellType}
            spawn={props.spawn}
            onSetSpawnCell={props.onSetSpawnCell}
            onRotateSpawn={props.onRotateSpawn}
            entities={props.entities}
            activeModelAsset={activeModelAsset}
            onUpdateEntity={props.onUpdateEntity}
            onPlaceEntityAtCell={props.onPlaceEntityAtCell}
            onRemoveEntity={props.onRemoveEntity}
            getLibrarySettings={props.getLibrarySettings}
          />
        )}

        {activeTab === 'assets' && (
          <AssetLibraryTab
            textures={props.textures}
            selectedTextureId={props.selectedTextureId}
            onSelectTexture={props.onSelectTexture}
            targetSurface={props.targetSurface}
            onChangeTargetSurface={props.onChangeTargetSurface}
            onAddCustomTexture={props.onAddCustomTexture}
            onFillSurfaceWithTexture={props.onFillSurfaceWithTexture}
            model3DAssets={props.model3DAssets}
            selectedModelAssetId={props.selectedModelAssetId}
            onSelectModelAsset={props.onSelectModelAsset}
            onAddCustomModel3DAsset={props.onAddCustomModel3DAsset}
            libraryState={props.libraryState}
            onLibraryChange={props.onLibraryChange}
            placedEntities={props.entities}
            selectedVariantKey={props.selectedVariantKey}
            onPickVariant={props.onPickVariant}
            onModelAdded={props.onModelAdded}
            onRemoveUploadedModel={props.onRemoveUploadedModel}
            onExportLibrary={props.onExportLibrary}
            onImportLibraryFile={props.onImportLibraryFile}
            gitHubRepoInput={props.gitHubRepoInput}
            isSyncingGitHubAssets={props.isSyncingGitHubAssets}
            gitHubAssetsStats={props.gitHubAssetsStats}
            onSyncGitHubAssets={props.onSyncGitHubAssets}
          />
        )}

        {activeTab === 'world' && (
          <WorldSettingsTab
            skyboxTheme={props.skyboxTheme}
            onChangeSkyboxTheme={props.onChangeSkyboxTheme}
            skyboxSeed={props.skyboxSeed}
            onRegenerateSkybox={props.onRegenerateSkybox}
            showCeiling={props.showCeiling}
            onToggleCeiling={props.onToggleCeiling}
            minimapEnabled={props.minimapEnabled}
            onToggleMinimap={props.onToggleMinimap}
            onBorderWalls={props.onBorderWalls}
            onClearGrid={props.onClearGrid}
            gridSize={props.grid.length}
            onResizeMap={props.onResizeMap}
            campaignLevels={props.campaignLevels}
            activeLevelIndex={props.activeLevelIndex}
            levelTitle={props.levelTitle}
            onSelectCampaignLevel={props.onSelectCampaignLevel}
            onRenameCampaignLevel={props.onRenameCampaignLevel}
            onAddCampaignLevel={props.onAddCampaignLevel}
            onDuplicateCampaignLevel={props.onDuplicateCampaignLevel}
            onDeleteCampaignLevel={props.onDeleteCampaignLevel}
            onMoveCampaignLevel={props.onMoveCampaignLevel}
            campaignSettings={props.campaignSettings}
            onUpdateCampaignSettings={props.onUpdateCampaignSettings}
            selectedCell={props.selectedCell}
            onPlaceExitOnSelectedCell={props.onPlaceExitOnSelectedCell}
          />
        )}
        {activeTab === 'world' && (
          <MovementSettingsSection
            movement={props.movement}
            onUpdateMovement={props.onUpdateMovement}
            classic={props.classic}
            onToggleClassic={props.onToggleClassic}
            verticalFeatures={props.verticalFeatures}
          />
        )}
      </div>
    </aside>
  );
});
