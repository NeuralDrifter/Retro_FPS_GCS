/**
 * The render loop (moved out of startGame.ts in P1.4). Each animation frame advances the fixed 30 Hz
 * sim by the elapsed time, interpolates the camera and moving geometry between ticks, syncs the HUD
 * and renders. On software WebGL it paces frames with afterDraw instead of requestAnimationFrame.
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
  ENGINE_CONFIG,
} from '../types';
import type { RuntimeContext } from './RuntimeState';
import { TICK_MS, UNITS_TO_METERS } from './constants';
import { hudEnemyTotals, syncHud } from './hud';
import { emitLog } from './combat';
import { runSingleSimTick } from './simTick';
import {
  SIM_CONFIG,
  getOpenDoorsSetFromSim,
  lerpBamToRadians,
} from '../../sim';
import { CollisionSystem } from '../CollisionSystem';
import { SoundEffects } from '../SoundEffects';

/** Frame clock and HUD-sync bookkeeping of the render loop */
export interface FrameLoopState {
  lastFrameTimeMs: number;
  accumulatorMs: number;
  lastHudSyncTime: number;
  hasSyncedHud: boolean;
  lastSyncX: number;
  lastSyncZ: number;
  lastSyncYaw: number;
  lastSyncPitch: number;
  lastSyncRow: number;
  lastSyncCol: number;
  lastSyncSpeed: number;
  dioramaAngleRad: number;
}

/** Heights partway between two ticks; returns `curr` itself when nothing is moving */
function lerpHeights(prev: number[][], curr: number[][], alpha: number): number[][] {
  if (prev === curr || prev.every((row, r) => row.every((h, c) => h === curr[r]?.[c]))) return curr;
  return curr.map((row, r) =>
    row.map((h, c) => {
      const from = prev[r]?.[c] ?? h;
      return from + (h - from) * alpha;
    })
  );
}

/** Builds the frame callback for one running game; it reschedules itself until rt.stopped */
export function createFrameTick(
  ctx: RuntimeContext,
  loop: FrameLoopState,
  afterDraw: (cb: () => void) => void
): () => void {
  const { rt, euler, input, isReplayOrDeterministic, options } = ctx;
  const isSoftwareGl = Boolean(rt.renderSystem?.isSoftwareGl);
  const tick = () => {
    if (rt.stopped || !rt.renderer || !rt.scene || !rt.camera) return;

    const nowMs = performance.now();
    const rawDeltaMs = Math.max(0, nowMs - loop.lastFrameTimeMs);
    loop.lastFrameTimeMs = nowMs;

    if (document.hidden) {
      loop.accumulatorMs = 0;
      rt.frameId = requestAnimationFrame(tick);
      return;
    }

    const dtSec = Math.min(rawDeltaMs / 1000, 0.1);
    const isMenuPaused = Boolean(
      rt.menuController && rt.menuController.isSimulationPaused()
    );

    if (isMenuPaused) {
      loop.accumulatorMs = 0;
      const activeScreen = rt.menuController?.getActiveScreen();
      if (
        rt.menuController?.getAppState() === 'MAIN_MENU' &&
        activeScreen?.backgroundConfig.type === '3d-scene'
      ) {
        const bg = activeScreen.backgroundConfig;
        const targetWorld = CollisionSystem.gridToWorld(
          bg.cameraTarget.row,
          bg.cameraTarget.col,
          rt.grid.length
        );
        const targetY = bg.cameraTarget.elevationMeters ?? 1.8;
        if (bg.cameraMode === 'orbit') {
          loop.dioramaAngleRad += (bg.orbitSpeedRadPerSec || 0.2) * dtSec;
          const radius = Math.max(2, bg.orbitRadiusMeters || 10);
          rt.camera.position.set(
            targetWorld.x + Math.cos(loop.dioramaAngleRad) * radius,
            targetY + 2.2,
            targetWorld.z + Math.sin(loop.dioramaAngleRad) * radius
          );
          rt.camera.lookAt(targetWorld.x, targetY, targetWorld.z);
        } else {
          rt.camera.position.set(targetWorld.x, targetY, targetWorld.z);
          euler.set(bg.fixedPitchRad ?? 0, bg.fixedYawRad ?? 0, 0, 'YXZ');
          rt.camera.quaternion.setFromEuler(euler);
        }
      }
      rt.renderer.render(rt.scene, rt.camera);
      if (isSoftwareGl) {
        afterDraw(tick);
      } else {
        rt.frameId = requestAnimationFrame(tick);
      }
      return;
    }

    rt.elapsedSec += dtSec;
    loop.accumulatorMs += rawDeltaMs;

    let ticksToRun = Math.floor(loop.accumulatorMs / TICK_MS);
    if (ticksToRun > SIM_CONFIG.MAX_TICKS_PER_FRAME) {
      ticksToRun = SIM_CONFIG.MAX_TICKS_PER_FRAME;
      loop.accumulatorMs = loop.accumulatorMs % TICK_MS;
    } else {
      loop.accumulatorMs -= ticksToRun * TICK_MS;
    }

    const frameStartSim = rt.currSimState;
    let stateChangedThisFrame = false;

    for (let tickIdx = 0; tickIdx < ticksToRun; tickIdx++) {
      runSingleSimTick(ctx, tickIdx);
      stateChangedThisFrame = true;
    }

    const curSim = rt.currSimState;
    const prevSim = rt.prevSimState;

    if (curSim.logs.length > rt.lastLogCount) {
      const latestLog = curSim.logs[curSim.logs.length - 1];
      rt.lastLogCount = curSim.logs.length;
      emitLog(ctx, `Event: ${latestLog.message}`);
    }

    if (curSim.soundsPlayed.length > rt.lastSoundCount) {
      for (
        let sIdx = rt.lastSoundCount;
        sIdx < curSim.soundsPlayed.length;
        sIdx++
      ) {
        const cue = curSim.soundsPlayed[sIdx];
        if (cue) {
          SoundEffects.playById(cue.soundId);
        }
      }
      rt.lastSoundCount = curSim.soundsPlayed.length;
    }

    if (
      stateChangedThisFrame &&
      (curSim.collectedKeys.length !== frameStartSim.collectedKeys.length ||
        curSim.messages.length !== frameStartSim.messages.length ||
        curSim.secretsFound !== frameStartSim.secretsFound ||
        curSim.levelEnded !== frameStartSim.levelEnded ||
        Object.keys(curSim.movers).length !==
          Object.keys(frameStartSim.movers).length ||
        Object.keys(curSim.movers).some(
          (k) =>
            curSim.movers[k]?.state !== frameStartSim.movers[k]?.state ||
            (curSim.movers[k]?.progress ?? 0) >= 5000 !==
              (frameStartSim.movers[k]?.progress ?? 0) >= 5000
        ))
    ) {
      options.onSimStateChange?.(curSim);
      syncHud(ctx);
    }

    const alpha = Math.max(0, Math.min(1, loop.accumulatorMs / TICK_MS));
    const prevP = prevSim.players[0];
    const currP = curSim.players[0];

    let currentSpeedMetersPerSec = 0;
    let currentYawRad = loop.lastSyncYaw;
    let currentPitchRad = loop.lastSyncPitch;

    if (prevP && currP) {
      const interpXUnits =
        prevP.xUnits + (currP.xUnits - prevP.xUnits) * alpha;
      const interpZUnits =
        prevP.zUnits + (currP.zUnits - prevP.zUnits) * alpha;

      rt.camera.position.x = interpXUnits * UNITS_TO_METERS;
      rt.camera.position.z = interpZUnits * UNITS_TO_METERS;

      const interpYawRad = lerpBamToRadians(
        prevP.yawBam,
        currP.yawBam,
        alpha
      );
      const interpPitchBam =
        prevP.pitchBam + (currP.pitchBam - prevP.pitchBam) * alpha;
      const interpPitchRad = (interpPitchBam / 65536) * (Math.PI * 2);

      currentYawRad = interpYawRad;
      currentPitchRad = interpPitchRad;

      euler.set(interpPitchRad, interpYawRad, 0, 'YXZ');
      rt.camera.quaternion.setFromEuler(euler);

      currentSpeedMetersPerSec =
        currP.speedUnitsPerTick *
        UNITS_TO_METERS *
        SIM_CONFIG.TICKS_PER_SECOND;

      const playerCellRow = currP.gridRow;
      const playerCellCol = currP.gridCol;
      const prevFloorH =
        prevSim.floorHeights?.[playerCellRow]?.[playerCellCol] ?? 0;
      const currFloorH =
        curSim.floorHeights?.[playerCellRow]?.[playerCellCol] ?? 0;
      const interpFloorH =
        (prevFloorH + (currFloorH - prevFloorH) * alpha) * UNITS_TO_METERS;

      if (curSim.vertical) {
        // Vertical levels: the sim tracks the eye height through steps, jumps and falls
        const eyeY =
          (prevP.yUnits + (currP.yUnits - prevP.yUnits) * alpha) * UNITS_TO_METERS;
        const bob =
          currP.speedUnitsPerTick > 0 && currP.onGround && !rt.combatState.isDead
            ? Math.sin(rt.elapsedSec * 10) * 0.045
            : 0;
        rt.camera.position.y = eyeY + bob;
      } else if (currP.speedUnitsPerTick > 0 && !rt.combatState.isDead) {
        const isSprinting = Boolean(
          input.keys['ShiftLeft'] || input.keys['ShiftRight']
        );
        rt.camera.position.y =
          interpFloorH +
          ENGINE_CONFIG.PLAYER_EYE_HEIGHT +
          Math.sin(rt.elapsedSec * (isSprinting ? 14 : 10)) * 0.055;
      } else {
        rt.camera.position.y = THREE.MathUtils.damp(
          rt.camera.position.y,
          interpFloorH + ENGINE_CONFIG.PLAYER_EYE_HEIGHT,
          10,
          dtSec
        );
      }

      if (curSim.earthquake && curSim.earthquake.remainingTicks > 0) {
        const shakeMag = (curSim.earthquake.intensity / 1000) * 0.25;
        const tremorX =
          Math.sin(curSim.tick * 1.7 + rt.elapsedSec * 25) * shakeMag;
        const tremorY =
          Math.cos(curSim.tick * 2.3 + rt.elapsedSec * 30) * shakeMag * 0.6;
        rt.camera.position.x += tremorX;
        rt.camera.position.y += tremorY;
      }
    }

    rt.combatSystem?.update(dtSec, rt.elapsedSec, currentSpeedMetersPerSec);

    const openDoorsSet = getOpenDoorsSetFromSim(curSim);

    if (rt.enemyAI && !isReplayOrDeterministic) {
      rt.enemyAI.setVerticalWorld(curSim.vertical ? curSim : null);
      const occluders = [...rt.wallMeshes];
      rt.doorMeshes.forEach((doorGroup, cKey) => {
        if (!openDoorsSet.has(cKey)) {
          occluders.push(doorGroup);
        }
      });

      rt.enemyAI.update(
        dtSec,
        rt.elapsedSec,
        rt.camera.position,
        curSim.grid,
        openDoorsSet,
        occluders,
        rt.combatState.isDead,
        {
          onPlayerDamaged: (damage, attackerName) => {
            if (rt.combatState.isDead) return;
            const nextHealth = Math.max(0, rt.combatState.health - damage);
            const nowDead = nextHealth <= 0;

            rt.isPlayerHurtFlashing = true;
            window.clearTimeout(rt.hurtFlashTimeout);
            rt.hurtFlashTimeout = window.setTimeout(() => {
              rt.isPlayerHurtFlashing = false;
              syncHud(ctx);
            }, 180);

            rt.combatState = {
              ...rt.combatState,
              health: nextHealth,
              isDead: nowDead,
            };
            syncHud(ctx);

            emitLog(ctx, 
              nowDead
                ? `Combat: Player defeated by ${attackerName}!`
                : `Combat: ${attackerName} melee attack (-${damage} HP).`
            );
          },
          onAmmoCollected: (amount) => {
            rt.combatState = {
              ...rt.combatState,
              ammo: Math.min(rt.combatState.maxAmmo, rt.combatState.ammo + amount),
            };
            syncHud(ctx);
            emitLog(ctx, 
              `Loot: Picked up +${amount} Plasma Cells from defeated enemy.`
            );
          },
        },
        curSim.solidFootprint
      );
    }

    rt.keyMeshes.forEach((keyGroup, cellKey) => {
      const isCollected = curSim.collectedKeys.includes(cellKey);
      keyGroup.visible = !isCollected;
      if (!isCollected) {
        const card = keyGroup.getObjectByName('floatingKeycard');
        if (card) {
          card.rotation.y = rt.elapsedSec * 2.2;
          card.position.y = 1.25 + Math.sin(rt.elapsedSec * 3.5) * 0.14;
        }
      }
    });

    rt.doorMeshes.forEach((doorGroup, dKey) => {
      const leaf = doorGroup.getObjectByName('doorLeaf');
      if (leaf) {
        const moverId = `door:${dKey}`;
        const prevProg = prevSim.movers[moverId]?.progress ?? 0;
        const currProg = curSim.movers[moverId]?.progress ?? 0;
        const interpProg =
          (prevProg + (currProg - prevProg) * alpha) /
          SIM_CONFIG.MOVER_MAX_PROGRESS;

        const closedY = (ENGINE_CONFIG.WALL_HEIGHT * 0.96) / 2;
        const openY = ENGINE_CONFIG.WALL_HEIGHT * 1.38;
        leaf.position.y = closedY + (openY - closedY) * interpProg;
      }
    });

    for (const mKey of Object.keys(curSim.movers)) {
      const currMover = curSim.movers[mKey];
      if (!currMover || currMover.kind !== 'pushwall') continue;

      const cellKey = `${currMover.row},${currMover.col}`;
      const wallGroup = rt.getWallBlockGroup(cellKey);
      if (!wallGroup) continue;

      const prevProg = prevSim.movers[mKey]?.progress ?? 0;
      const currProg = currMover.progress;
      const interpProg =
        (prevProg + (currProg - prevProg) * alpha) /
        SIM_CONFIG.MOVER_MAX_PROGRESS;

      const dRow =
        currMover.direction === 'N'
          ? -1
          : currMover.direction === 'S'
          ? 1
          : 0;
      const dCol =
        currMover.direction === 'E'
          ? 1
          : currMover.direction === 'W'
          ? -1
          : 0;
      const distCells = currMover.distanceCells ?? 2;
      const baseWorld = CollisionSystem.gridToWorld(
        currMover.row,
        currMover.col,
        curSim.gridSize
      );

      wallGroup.position.x =
        baseWorld.x +
        dCol * distCells * ENGINE_CONFIG.CELL_SIZE * interpProg;
      wallGroup.position.z =
        baseWorld.z +
        dRow * distCells * ENGINE_CONFIG.CELL_SIZE * interpProg;

      if (
        currMover.state === 'done' &&
        currMover.targetRow === undefined
      ) {
        wallGroup.visible = false;
      }
    }

    // Lifts and moving floors glide between ticks, like the flat levels' floor tiles
    if (rt.updateLayeredHeights) {
      rt.updateLayeredHeights(
        lerpHeights(prevSim.floorHeights, curSim.floorHeights, alpha),
        lerpHeights(prevSim.ceilingHeights, curSim.ceilingHeights, alpha)
      );
    }

    const defaultCeilH = SIM_CONFIG.DEFAULT_CEILING_HEIGHT_UNITS;
    for (let r = 0; r < curSim.gridSize; r++) {
      const prevFloorRow = prevSim.floorHeights?.[r];
      const currFloorRow = curSim.floorHeights?.[r];
      const prevCeilRow = prevSim.ceilingHeights?.[r];
      const currCeilRow = curSim.ceilingHeights?.[r];
      for (let c = 0; c < curSim.gridSize; c++) {
        const prevH = prevFloorRow?.[c] ?? 0;
        const currH = currFloorRow?.[c] ?? 0;
        if (rt.floorLayer && (prevH !== 0 || currH !== 0)) {
          const interpH = prevH + (currH - prevH) * alpha;
          rt.floorLayer.setCellY(`${r},${c}`, interpH * UNITS_TO_METERS);
        }
        const prevCeilH = prevCeilRow?.[c] ?? defaultCeilH;
        const currCeilH = currCeilRow?.[c] ?? defaultCeilH;
        if (
          rt.ceilingLayer &&
          (prevCeilH !== defaultCeilH || currCeilH !== defaultCeilH)
        ) {
          const interpH = prevCeilH + (currCeilH - prevCeilH) * alpha;
          rt.ceilingLayer.setCellY(`${r},${c}`, interpH * UNITS_TO_METERS);
        }
      }
    }

    if (rt.elapsedSec - loop.lastHudSyncTime > 0.05 && currP) {
      loop.lastHudSyncTime = rt.elapsedSec;
      const nx = rt.camera.position.x;
      const nz = rt.camera.position.z;
      const nyaw = currentYawRad;
      const npitch = currentPitchRad;
      if (
        !loop.hasSyncedHud ||
        Math.abs(nx - loop.lastSyncX) > 0.005 ||
        Math.abs(nz - loop.lastSyncZ) > 0.005 ||
        Math.abs(nyaw - loop.lastSyncYaw) > 0.005 ||
        Math.abs(npitch - loop.lastSyncPitch) > 0.005 ||
        currP.gridRow !== loop.lastSyncRow ||
        currP.gridCol !== loop.lastSyncCol ||
        Math.abs(currentSpeedMetersPerSec - loop.lastSyncSpeed) > 0.05
      ) {
        loop.hasSyncedHud = true;
        loop.lastSyncX = nx;
        loop.lastSyncZ = nz;
        loop.lastSyncYaw = nyaw;
        loop.lastSyncPitch = npitch;
        loop.lastSyncRow = currP.gridRow;
        loop.lastSyncCol = currP.gridCol;
        loop.lastSyncSpeed = currentSpeedMetersPerSec;
        rt.playerTransform = {
          x: nx,
          y: rt.camera.position.y,
          z: nz,
          yaw: nyaw,
          pitch: npitch,
          gridRow: currP.gridRow,
          gridCol: currP.gridCol,
          speed: currentSpeedMetersPerSec,
        };
        options.onPlayerMove?.(rt.playerTransform);
      }

      if (rt.enemyAI) {
        const snapshots = rt.enemyAI.getTelemetrySnapshots();
        rt.enemySnapshots = snapshots.enemies;
        rt.ammoDrops = snapshots.ammoDrops;
        const totals = hudEnemyTotals(ctx, snapshots);
        if (
          rt.combatState.kills !== totals.kills ||
          rt.combatState.totalEnemies !== totals.totalEnemies
        ) {
          rt.combatState = { ...rt.combatState, ...totals };
        }
      }

      syncHud(ctx);
    }

    if (rt.dirLight) {
      rt.dirLight.position.set(
        rt.camera.position.x + 14,
        28,
        rt.camera.position.z + 12
      );
      rt.dirLight.target.position.set(rt.camera.position.x, 0, rt.camera.position.z);
      rt.dirLight.target.updateMatrixWorld();
    }

    rt.renderer.render(rt.scene, rt.camera);

    if (isSoftwareGl) {
      afterDraw(tick);
    } else {
      rt.frameId = requestAnimationFrame(tick);
    }
  };
  return tick;
}
