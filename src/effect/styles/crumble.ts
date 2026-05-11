import * as THREE from 'three';
import type { VisualEffect, EffectContext, EffectContextProvider } from '../index';
import type { Modulation } from '../../hash';
import type { QRMatrix } from '../qr-matrix';
import { estimatePose, type Pose } from '../pose';

// Crumble: marker pose を毎フレーム再推定 (追跡)。
// cube は marker local の Z=0平面に固定配置、 +Z方向 (法線、 toward camera) に上昇 + フェード。
// markerRoot に pose transform を適用、 cube は markerRoot 子なので追従する。

const RISE_DURATION = 2.0;
const TAIL_SEC = 1.0;

let renderer: THREE.WebGLRenderer | null = null;
let scene: THREE.Scene | null = null;
let camera: THREE.PerspectiveCamera | null = null;
let canvasRef: HTMLCanvasElement | null = null;

const sharedGeometry = new THREE.BoxGeometry(1, 1, 1);

let running = false;
let rafId = 0;

function setupScene(targetCanvas: HTMLCanvasElement): void {
  if (renderer && canvasRef === targetCanvas) return;
  canvasRef = targetCanvas;
  renderer = new THREE.WebGLRenderer({
    canvas: targetCanvas,
    alpha: true,
    antialias: true,
  });
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(window.devicePixelRatio);
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(50, 1, 0.01, 200);
}

/**
 * canvas の内部 pixel buffer を raw frame サイズに合わせる。
 * CSSは `object-fit: cover` で viewport にcrop表示 — videoと同じ intrinsic sizeなので位置整合する。
 * Three は raw frame aspectで render、 CSS側でcropが起こる。
 */
function resizeRendererToFrame(frameW: number, frameH: number): void {
  if (!renderer) return;
  renderer.setSize(frameW, frameH, false);
}

function clearScene(): void {
  if (!scene) return;
  for (const child of [...scene.children]) {
    scene.remove(child);
    child.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        const m = obj.material;
        if (Array.isArray(m)) m.forEach((x) => x.dispose());
        else m.dispose();
      }
    });
  }
}

function poseToMatrix(pose: Pose, out: THREE.Matrix4): void {
  // OpenCV camera frame (Y down, Z forward) → Three (Y up, Z backward)
  // M_three = D * [R | t]   where D = diag(1, -1, -1)
  const R = pose.R;
  const t = pose.t;
  out.set(
     R[0]!,  R[1]!,  R[2]!,  t[0]!,
    -R[3]!, -R[4]!, -R[5]!, -t[1]!,
    -R[6]!, -R[7]!, -R[8]!, -t[2]!,
         0,      0,      0,      1,
  );
}

function applyIntrinsics(cam: THREE.PerspectiveCamera, ctx: EffectContext): void {
  // fy ≈ frameHeight、 fov_v = 2*atan(0.5) ≈ 53.13°
  const fovV = (2 * Math.atan(0.5) * 180) / Math.PI;
  cam.fov = fovV;
  cam.aspect = ctx.frameWidth / ctx.frameHeight;
  cam.updateProjectionMatrix();
}

type Cube = {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  startDelay: number;
  riseHeight: number;
};

export const crumble: VisualEffect = {
  id: 0,
  name: 'Crumble',

  init(targetCanvas: HTMLCanvasElement): void {
    setupScene(targetCanvas);
  },

  async play(matrix: QRMatrix, mod: Modulation, getContext: EffectContextProvider): Promise<void> {
    setupScene(canvasRef ?? document.createElement('canvas'));
    if (!renderer || !scene || !camera) throw new Error('crumble scene not initialized');
    clearScene();

    // 初期 context (呼び出し直前に scan onDetect が更新済みのはず)。
    const initialCtx = getContext();
    if (!initialCtx) throw new Error('no detection context at play start');
    resizeRendererToFrame(initialCtx.frameWidth, initialCtx.frameHeight);
    applyIntrinsics(camera, initialCtx);

    const markerRoot = new THREE.Group();
    markerRoot.matrixAutoUpdate = false;
    poseToMatrix(estimatePose(initialCtx.corners, initialCtx.frameWidth, initialCtx.frameHeight), markerRoot.matrix);
    scene.add(markerRoot);

    // === Cube grid (marker local: X right, Y up, +Z out-of-plane) ===
    const cellSize = 2 / matrix.size;
    const halfCell = cellSize / 2;

    const beatSec = 60 / mod.bpm;
    const stepSec = beatSec / 2;
    const totalSec = mod.noteCount * stepSec + RISE_DURATION + TAIL_SEC;

    const cubes: Cube[] = [];
    for (let row = 0; row < matrix.size; row++) {
      for (let col = 0; col < matrix.size; col++) {
        const idx = row * matrix.size + col;
        if (!matrix.modules[idx]) continue;

        const material = new THREE.MeshBasicMaterial({
          color: 0x000000,
          transparent: true,
          opacity: 1,
        });
        const mesh = new THREE.Mesh(sharedGeometry, material);
        mesh.scale.set(cellSize * 0.95, cellSize * 0.95, cellSize * 0.3);
        const x = -1 + halfCell + col * cellSize;
        const y =  1 - halfCell - row * cellSize;
        mesh.position.set(x, y, 0);
        markerRoot.add(mesh);

        const byte = mod.noteSeeds[idx % mod.noteSeeds.length]!;
        const noteIdx = idx % mod.noteCount;
        const startDelay = noteIdx * stepSec;
        const riseHeight = 0.5 + (byte / 255) * 1.5;
        cubes.push({ mesh, material, startDelay, riseHeight });
      }
    }

    running = true;
    const startMs = performance.now();
    const tmpMatrix = new THREE.Matrix4();

    return new Promise<void>((resolve) => {
      const tick = (): void => {
        if (!running) {
          resolve();
          return;
        }
        const tSec = (performance.now() - startMs) / 1000;

        // === 追従: 最新 context で pose再計算 ===
        // null (marker一時lost) なら markerRoot.matrix は前回値を維持。
        const liveCtx = getContext();
        if (liveCtx) {
          try {
            const pose = estimatePose(liveCtx.corners, liveCtx.frameWidth, liveCtx.frameHeight);
            poseToMatrix(pose, tmpMatrix);
            markerRoot.matrix.copy(tmpMatrix);
          } catch {
            // singular等は無視、 直前pose維持
          }
        }

        for (const c of cubes) {
          const local = tSec - c.startDelay;
          if (local <= 0) continue;
          if (local >= RISE_DURATION) {
            c.mesh.visible = false;
            continue;
          }
          const p = local / RISE_DURATION;
          const ease = 1 - Math.pow(1 - p, 3);
          c.mesh.position.z = ease * c.riseHeight;
          c.material.opacity = 1 - p;
        }

        renderer!.render(scene!, camera!);

        if (tSec >= totalSec) {
          running = false;
          resolve();
          return;
        }
        rafId = requestAnimationFrame(tick);
      };
      rafId = requestAnimationFrame(tick);
    });
  },

  stop(): void {
    running = false;
    cancelAnimationFrame(rafId);
    clearScene();
    if (renderer) renderer.clear();
  },
};
