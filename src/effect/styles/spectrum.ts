import * as THREE from 'three';
import type { VisualEffect, EffectContextProvider } from '../index';
import type { Modulation } from '../../hash';
import type { QRMatrix } from '../qr-matrix';
import { estimatePose, type Pose } from '../pose';
import { getAnalyser, ANALYSER_FFT_SIZE } from '../../audio/analyser';

// Spectrum: marker平面 X軸に沿って FFT bins を バー で並べ、 +Z (法線方向、 toward camera)に
// amplitude で extrude。 hue gradient (低周波=赤、 高周波=紫)。 markerにanchor、 毎フレーム追従。

const MIN_DB = -100;
const MAX_DB = -20;
const MIN_BAR_HEIGHT = 0.01;
const MAX_BAR_HEIGHT = 1.6;
const BAR_THICKNESS_Y = 0.06; // marker local Y方向の厚み
const BAR_FILL = 0.85;         // bar width 比率 (隣との隙間)
const TAIL_SEC = 0.4;          // 音終了後の余韻

let renderer: THREE.WebGLRenderer | null = null;
let scene: THREE.Scene | null = null;
let camera: THREE.PerspectiveCamera | null = null;
let canvasRef: HTMLCanvasElement | null = null;

// base が z=0 になるよう pivot offset した unit cube。 scale.z で上方向にスタック。
const barGeometry = new THREE.BoxGeometry(1, 1, 1);
barGeometry.translate(0, 0, 0.5);

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

function resizeRendererToFrame(frameW: number, frameH: number): void {
  renderer?.setSize(frameW, frameH, false);
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
  const R = pose.R;
  const t = pose.t;
  out.set(
     R[0]!,  R[1]!,  R[2]!,  t[0]!,
    -R[3]!, -R[4]!, -R[5]!, -t[1]!,
    -R[6]!, -R[7]!, -R[8]!, -t[2]!,
         0,      0,      0,      1,
  );
}

function applyIntrinsics(cam: THREE.PerspectiveCamera, frameW: number, frameH: number): void {
  cam.fov = (2 * Math.atan(0.5) * 180) / Math.PI;
  cam.aspect = frameW / frameH;
  cam.updateProjectionMatrix();
}

type Bar = {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
};

export const spectrum: VisualEffect = {
  id: 0,
  name: 'Spectrum',

  init(targetCanvas: HTMLCanvasElement): void {
    setupScene(targetCanvas);
  },

  // _matrix: QR matrix は spectrum描画では使わない (audio FFT駆動)
  async play(_matrix: QRMatrix, mod: Modulation, getContext: EffectContextProvider): Promise<void> {
    setupScene(canvasRef ?? document.createElement('canvas'));
    if (!renderer || !scene || !camera) throw new Error('spectrum scene not initialized');
    clearScene();

    const initialCtx = getContext();
    if (!initialCtx) throw new Error('no detection context at play start');
    resizeRendererToFrame(initialCtx.frameWidth, initialCtx.frameHeight);
    applyIntrinsics(camera, initialCtx.frameWidth, initialCtx.frameHeight);

    const analyser = getAnalyser();
    const numBins = ANALYSER_FFT_SIZE;

    const markerRoot = new THREE.Group();
    markerRoot.matrixAutoUpdate = false;
    poseToMatrix(
      estimatePose(initialCtx.corners, initialCtx.frameWidth, initialCtx.frameHeight),
      markerRoot.matrix,
    );
    scene.add(markerRoot);

    // bars: 64 bins を marker X (-1..+1) に並べる
    const cellWidth = 2 / numBins;
    const barWidth = cellWidth * BAR_FILL;
    const halfCell = cellWidth / 2;

    const bars: Bar[] = [];
    for (let i = 0; i < numBins; i++) {
      const hue = i / numBins * 0.85; // 0..0.85 (赤→紫の手前まで、 似た色避ける)
      const color = new THREE.Color().setHSL(hue, 0.75, 0.55);
      const material = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.88,
      });
      const mesh = new THREE.Mesh(barGeometry, material);
      const x = -1 + halfCell + i * cellWidth;
      mesh.position.set(x, 0, 0);
      mesh.scale.set(barWidth, BAR_THICKNESS_Y, MIN_BAR_HEIGHT);
      markerRoot.add(mesh);
      bars.push({ mesh, material });
    }

    const beatSec = 60 / mod.bpm;
    const stepSec = beatSec / 2;
    // music-boxの再生時間と同期 (noteCount * stepSec + 1秒余韻) + 視覚余韻
    const audioSec = mod.noteCount * stepSec + 1.0;
    const totalSec = audioSec + TAIL_SEC;

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

        // === 追従: pose 再推定 ===
        const liveCtx = getContext();
        if (liveCtx) {
          try {
            const pose = estimatePose(liveCtx.corners, liveCtx.frameWidth, liveCtx.frameHeight);
            poseToMatrix(pose, tmpMatrix);
            markerRoot.matrix.copy(tmpMatrix);
          } catch {
            // singular → 直前pose維持
          }
        }

        // === FFT 取得 + bar 更新 ===
        const fft = analyser.getValue();
        // 'fft' typeなら Float32Array が返る (channel=monoのため)
        if (fft instanceof Float32Array) {
          const len = Math.min(fft.length, bars.length);
          for (let i = 0; i < len; i++) {
            const db = fft[i] ?? MIN_DB;
            const normalized = Math.max(0, Math.min(1, (db - MIN_DB) / (MAX_DB - MIN_DB)));
            const height = MIN_BAR_HEIGHT + normalized * MAX_BAR_HEIGHT;
            bars[i]!.mesh.scale.z = height;
          }
        }

        // 音が終わったあとは余韻フェード
        if (tSec > audioSec) {
          const fadeP = Math.min(1, (tSec - audioSec) / TAIL_SEC);
          for (const b of bars) b.material.opacity = 0.88 * (1 - fadeP);
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
    renderer?.clear();
  },
};
