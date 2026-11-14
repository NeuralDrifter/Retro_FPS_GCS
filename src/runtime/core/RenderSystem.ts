/**
 * The game's WebGL renderer, scene, camera and lights (moved out of startGame.ts in P1.4).
 *
 * createRenderSystem builds them for a canvas or a container element, keeps the camera and
 * renderer sized to the mount element, and dispose() releases every GPU resource it created,
 * including the WebGL context itself.
 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

export interface RenderSystem {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly hemiLight: THREE.HemisphereLight;
  readonly dirLight: THREE.DirectionalLight;
  /** The element the canvas fills (the container, or the given canvas's parent) */
  readonly mountEl: HTMLElement;
  /** True on software WebGL (SwiftShader, llvmpipe): no antialiasing or shadows, pixel ratio 1 */
  readonly isSoftwareGl: boolean;
  dispose(): void;
}

/** Detects a software WebGL implementation with a throwaway context */
function detectSoftwareGl(): boolean {
  const probeCanvas = document.createElement('canvas');
  const gl = probeCanvas.getContext('webgl2');
  if (!gl) return true;
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
  const gpu = String(gl.getParameter(param));
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
}

export function createRenderSystem(canvasOrContainer: HTMLCanvasElement | HTMLElement): RenderSystem {
  const isSoftwareGl = detectSoftwareGl();
  const ownsCanvas = !(canvasOrContainer instanceof HTMLCanvasElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x090c12);
  scene.fog = new THREE.FogExp2(0x090c12, 0.025);

  const mountEl =
    canvasOrContainer instanceof HTMLCanvasElement
      ? canvasOrContainer.parentElement ?? canvasOrContainer
      : canvasOrContainer;

  const width = mountEl.clientWidth || 800;
  const height = mountEl.clientHeight || 600;
  const camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 120);

  const renderer = new THREE.WebGLRenderer({
    canvas: canvasOrContainer instanceof HTMLCanvasElement ? canvasOrContainer : undefined,
    antialias: !isSoftwareGl,
    powerPreference: 'high-performance',
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(width, height);
  renderer.shadowMap.enabled = !isSoftwareGl;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  if (!(canvasOrContainer instanceof HTMLCanvasElement)) {
    const existingCanvases = canvasOrContainer.querySelectorAll('canvas[data-forgecore-canvas="true"]');
    existingCanvases.forEach((c) => c.remove());
    renderer.domElement.setAttribute('data-forgecore-canvas', 'true');
    canvasOrContainer.insertBefore(renderer.domElement, canvasOrContainer.firstChild);
  }

  const pmremGenerator = new THREE.PMREMGenerator(renderer);
  const roomEnvironment = new RoomEnvironment();
  const envTarget = pmremGenerator.fromScene(roomEnvironment, 0.04);
  scene.environment = envTarget.texture;
  roomEnvironment.dispose();
  pmremGenerator.dispose();

  const hemiLight = new THREE.HemisphereLight(0x38bdf8, 0x0f172a, 0.65);
  scene.add(hemiLight);

  const dirLight = new THREE.DirectionalLight(0xfffbeb, 1.35);
  dirLight.position.set(14, 28, 12);
  dirLight.castShadow = !isSoftwareGl;
  dirLight.shadow.mapSize.width = 1024;
  dirLight.shadow.mapSize.height = 1024;
  dirLight.shadow.camera.near = 1;
  dirLight.shadow.camera.far = 65;
  const d = 24;
  dirLight.shadow.camera.left = -d;
  dirLight.shadow.camera.right = d;
  dirLight.shadow.camera.top = d;
  dirLight.shadow.camera.bottom = -d;
  dirLight.shadow.bias = -0.0005;
  dirLight.shadow.normalBias = 0.02;
  scene.add(dirLight);

  const playerTorch = new THREE.PointLight(0xf59e0b, 2.2, 16, 1.6);
  camera.add(playerTorch);

  const resizeObserver =
    typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver((entries) => {
          for (const entry of entries) {
            const { width: w, height: h } = entry.contentRect;
            if (w > 0 && h > 0) {
              camera.aspect = w / h;
              camera.updateProjectionMatrix();
              renderer.setSize(w, h);
            }
          }
        })
      : null;
  resizeObserver?.observe(mountEl);

  let disposed = false;
  return {
    scene,
    camera,
    renderer,
    hemiLight,
    dirLight,
    mountEl,
    isSoftwareGl,
    dispose() {
      if (disposed) return;
      disposed = true;
      resizeObserver?.disconnect();
      envTarget.dispose();
      dirLight.dispose();
      renderer.dispose();
      // Free the GPU context now instead of waiting for GC, so Edit and Play switches never pile up contexts
      renderer.forceContextLoss();
      if (ownsCanvas) renderer.domElement.remove();
    },
  };
}
