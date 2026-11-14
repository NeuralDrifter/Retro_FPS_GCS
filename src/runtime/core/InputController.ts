/**
 * Keyboard and mouse input for a running game (moved out of startGame.ts in P1.4).
 *
 * InputState holds what the next sim tick reads: the keys held down and the look, use and shoot
 * input gathered since the last tick. It also exists in headless runs, which feed recorded input
 * instead. bindInputListeners attaches the DOM listeners that fill it and returns their cleanup.
 */

/** Look, use and shoot input gathered since the previous tick */
export interface FrameInput {
  yawDeltaBam: number;
  pitchDeltaBam: number;
  use: boolean;
  shoot: boolean;
}

export const NO_FRAME_INPUT: Readonly<FrameInput> = { yawDeltaBam: 0, pitchDeltaBam: 0, use: false, shoot: false };

export class InputState {
  /** KeyboardEvent.code values currently held down */
  readonly keys: Record<string, boolean> = {};
  pendingYawDeltaBam = 0;
  pendingPitchDeltaBam = 0;
  pendingUse = false;
  pendingShoot = false;
  /** True once a pointer lock was requested and not refused or released */
  pointerLockRequested = false;

  /** Returns the input gathered since the last call and clears it */
  takeFrameInput(): FrameInput {
    const frame: FrameInput = {
      yawDeltaBam: this.pendingYawDeltaBam,
      pitchDeltaBam: this.pendingPitchDeltaBam,
      use: this.pendingUse,
      shoot: this.pendingShoot,
    };
    this.pendingYawDeltaBam = 0;
    this.pendingPitchDeltaBam = 0;
    this.pendingUse = false;
    this.pendingShoot = false;
    return frame;
  }

  releaseAllKeys(): void {
    for (const code of Object.keys(this.keys)) this.keys[code] = false;
  }
}

export interface InputBindings {
  domCanvas: HTMLCanvasElement;
  mountEl: HTMLElement;
  /** True when recorded input drives the game, so live input is ignored */
  isReplaying: () => boolean;
  /** False while a menu is open */
  isGameplayActive: () => boolean;
  /** Lets an open menu take the key first; returns true when it did */
  menuHandlesKey: (code: string) => boolean;
  lookSettings: () => { mouseSensitivity?: number; invertY?: boolean };
  autoLockPointerOnClick: boolean;
  requestPointerLock: () => void;
  /** Space jumps when the level allows jumping; otherwise it uses, like E */
  spaceJumps: () => boolean;
  fire: () => void;
  reload: () => void;
  toggleMinimap: () => void;
}

const isPointerLocked = (b: InputBindings) =>
  document.pointerLockElement === b.domCanvas || document.pointerLockElement === b.mountEl;

/** Attaches the game's keyboard and mouse listeners; returns a function that removes them */
export function bindInputListeners(state: InputState, b: InputBindings): () => void {
  const { domCanvas } = b;
  let isDraggingLook = false;
  let pointerDownX = 0;
  let pointerDownY = 0;
  let prevPointerX = 0;
  let prevPointerY = 0;
  let maxDragDelta = 0;

  const onCanvasPointerDown = (e: PointerEvent) => {
    if (b.isReplaying() || e.button !== 0) return;
    if (!b.isGameplayActive()) return;
    if (isPointerLocked(b)) {
      b.fire();
      return;
    }
    if (b.autoLockPointerOnClick) {
      b.requestPointerLock();
    }
    isDraggingLook = true;
    pointerDownX = e.clientX;
    pointerDownY = e.clientY;
    prevPointerX = e.clientX;
    prevPointerY = e.clientY;
    maxDragDelta = 0;
  };

  const onWindowMouseMove = (e: MouseEvent) => {
    if (b.isReplaying()) return;
    if (!b.isGameplayActive()) return;
    const settings = b.lookSettings();
    const sensMult = Math.max(0.1, (settings.mouseSensitivity ?? 100) / 100);
    const invertSign = settings.invertY ? -1 : 1;
    if (
      isPointerLocked(b) ||
      (state.pointerLockRequested && !isDraggingLook && Boolean(e.movementX || e.movementY))
    ) {
      const yawRad = -(e.movementX || 0) * 0.0022 * sensMult;
      const pitchRad = -(e.movementY || 0) * 0.0022 * sensMult * invertSign;
      state.pendingYawDeltaBam += Math.round((yawRad / (Math.PI * 2)) * 65536);
      state.pendingPitchDeltaBam += Math.round((pitchRad / (Math.PI * 2)) * 65536);
      return;
    }

    if (!isDraggingLook) return;
    const dx = e.clientX - prevPointerX;
    const dy = e.clientY - prevPointerY;
    prevPointerX = e.clientX;
    prevPointerY = e.clientY;

    const totalDrag = Math.hypot(e.clientX - pointerDownX, e.clientY - pointerDownY);
    if (totalDrag > maxDragDelta) {
      maxDragDelta = totalDrag;
    }

    const yawRad = -dx * 0.0045 * sensMult;
    const pitchRad = -dy * 0.0045 * sensMult * invertSign;
    state.pendingYawDeltaBam += Math.round((yawRad / (Math.PI * 2)) * 65536);
    state.pendingPitchDeltaBam += Math.round((pitchRad / (Math.PI * 2)) * 65536);
  };

  const onWindowPointerUp = (e: PointerEvent) => {
    if (b.isReplaying() || !isDraggingLook) return;
    isDraggingLook = false;
    if (!b.isGameplayActive()) return;
    if (e.button === 0 && maxDragDelta < 6 && document.pointerLockElement !== domCanvas) {
      b.fire();
    }
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (b.isReplaying()) return;
    if (
      document.activeElement instanceof HTMLInputElement ||
      document.activeElement instanceof HTMLSelectElement ||
      document.activeElement instanceof HTMLTextAreaElement
    ) {
      return;
    }
    if (e.code === 'Escape') {
      state.pointerLockRequested = false;
    }
    if (b.menuHandlesKey(e.code)) {
      state.releaseAllKeys();
      return;
    }
    state.keys[e.code] = true;

    if (e.code === 'KeyM') b.toggleMinimap();
    if (e.code === 'KeyF') b.fire();
    if (e.code === 'KeyR') b.reload();
    if (e.code === 'KeyE' || (e.code === 'Space' && !b.spaceJumps())) {
      state.pendingUse = true;
    }
  };

  const onKeyUp = (e: KeyboardEvent) => {
    state.keys[e.code] = false;
  };

  domCanvas.addEventListener('pointerdown', onCanvasPointerDown);
  window.addEventListener('mousemove', onWindowMouseMove);
  window.addEventListener('pointerup', onWindowPointerUp);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);

  return () => {
    domCanvas.removeEventListener('pointerdown', onCanvasPointerDown);
    window.removeEventListener('mousemove', onWindowMouseMove);
    window.removeEventListener('pointerup', onWindowPointerUp);
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
  };
}
