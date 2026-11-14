/**
 * The 3D world for the current level: skybox and the world mesh group.
 * Moved out of startGame.ts in P1.4; every function takes the run's RuntimeContext first.
 */
/**
 * ============================================================================
 * STANDALONE ENGINE RUNTIME ENTRY POINT (`startGame`)
 * ============================================================================
 * Pure Three.js + Vanilla DOM runtime with zero React or editor dependencies.
 * Extracted from Viewport3D.tsx for 1:1 parity between editor preview and
 * standalone exported games.
 */

import * as THREE from 'three';
import {
  getCollectedKeysSetFromSim,
  getOpenDoorsSetFromSim,
} from '../../sim';
import { TextureGenerator } from '../TextureGenerator';
import { WorldBuilder } from '../WorldBuilder';
import type { RuntimeContext } from './RuntimeState';

export function updateSkybox(ctx: RuntimeContext): void {
  const { rt } = ctx;
  if (!rt.scene) return;
  rt.skyboxTex?.dispose();
  const generated = TextureGenerator.createSkyboxTexture(
    rt.skyboxTheme,
    rt.skyboxSeed
  );
  rt.skyboxTex = generated.texture;
  rt.scene.background = generated.texture;
  rt.scene.fog = new THREE.FogExp2(generated.fogColor, 0.025);
  if (rt.hemiLight) {
    rt.hemiLight.color.setHex(generated.hemiSkyColor);
    rt.hemiLight.groundColor.setHex(generated.hemiGroundColor);
  }
}

export function rebuild3DWorld(ctx: RuntimeContext): void {
  const { rt } = ctx;
  if (!rt.scene || !rt.renderer) return;
  rt.worldBuildCount++;

  const maxAniso = rt.renderer.capabilities.getMaxAnisotropy();

  if (!rt.doorTex) {
    rt.doorTex = TextureGenerator.createDoorTexture(maxAniso);
  }

  if (rt.worldGroup) {
    rt.scene.remove(rt.worldGroup);
    WorldBuilder.disposeWorldGroup(rt.worldGroup);
  }

  const collectedKeysSet = getCollectedKeysSetFromSim(rt.currSimState);
  const openDoorsSet = getOpenDoorsSetFromSim(rt.currSimState);

  const built = WorldBuilder.buildWorldFromGrid(
    rt.grid,
    rt.wallTextures,
    rt.floorTextures,
    rt.ceilingTextures,
    rt.customTextures,
    rt.entities,
    rt.doorTex,
    maxAniso,
    {
      showCeiling: rt.showCeiling,
      showWireframe: rt.showWireframe,
      spawn: rt.spawn,
      collectedKeys: collectedKeysSet,
      openDoors: openDoorsSet,
      vertical: rt.vertical,
    }
  );

  rt.worldGroup = built.worldGroup;
  rt.updateLayeredHeights = built.updateLayeredHeights ?? null;
  rt.wallMeshes = built.wallMeshes;
  rt.getWallBlockGroup = built.getWallBlockGroup;
  rt.doorMeshes = built.doorMeshes;
  rt.keyMeshes = built.keyMeshes;
  rt.floorLayer = built.floorLayer;
  rt.ceilingLayer = built.ceilingLayer;
  rt.enemyAI = built.enemyAI;
  rt.aiEnemiesLoaded = false;
  rt.scene.add(built.worldGroup);
}
