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
const MAX_BAR_HEIGHT = 0.8;    // bar数が多いので低めに (QR黒モジュール = 数百本)
const BAR_FILL = 0.85;          // セル内のbar占有比率
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
// 現在 play() で待機中の Promise resolve。 stop() から明示 resolve できるようにモジュールに保持。
let pendingResolve: (() => void) | null = null;

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
  binIdx: number;
};

/**
 * Fisher-Yates シャッフルで bin → cell の対応を生成する。
 * noteSeeds由来の deterministic seed なので、 同じQR → 同じ配置。
 */
function shuffleBins(numBins: number, noteSeeds: Uint8Array): number[] {
  const order = Array.from({ length: numBins }, (_, i) => i);
  for (let i = numBins - 1; i > 0; i--) {
    const seed = noteSeeds[i % noteSeeds.length] ?? 0;
    // (seed * 257) で多少分散させてから mod (連続byteが同じだと弱いシャッフルになるのを軽減)
    const j = (seed * 257 + i * 31) % (i + 1);
    const tmp = order[i]!;
    order[i] = order[j]!;
    order[j] = tmp;
  }
  return order;
}

export const spectrum: VisualEffect = {
  id: 0,
  name: 'Spectrum',

  init(targetCanvas: HTMLCanvasElement): void {
    setupScene(targetCanvas);
  },

  async play(matrix: QRMatrix, mod: Modulation, getContext: EffectContextProvider): Promise<void> {
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

    // QR の黒モジュール位置に bars を配置する。
    // 黒モジュール数は ~200-500、 これを numBins (64) で循環シェアする。
    // moduleCounter * 7 + 11 (7 は numBins=64 と互いに素) で 周期を崩す。
    const cellSize = 2 / matrix.size;
    const barXY = cellSize * BAR_FILL;
    const halfCell = cellSize / 2;
    const permutation = shuffleBins(numBins, mod.noteSeeds);

    const bars: Bar[] = [];
    let moduleCounter = 0;
    for (let row = 0; row < matrix.size; row++) {
      for (let col = 0; col < matrix.size; col++) {
        const idx = row * matrix.size + col;
        if (!matrix.modules[idx]) continue; // 白モジュールはスキップ

        const binIdx = permutation[(moduleCounter * 7 + 11) % numBins]!;
        moduleCounter++;

        const hue = (binIdx / numBins) * 0.85;
        const color = new THREE.Color().setHSL(hue, 0.75, 0.55);
        const material = new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.88,
        });
        const mesh = new THREE.Mesh(barGeometry, material);
        // marker local: col → X (left→right)、 row → Y (top=+Y)
        const x = -1 + halfCell + col * cellSize;
        const y =  1 - halfCell - row * cellSize;
        mesh.position.set(x, y, 0);
        mesh.scale.set(barXY, barXY, MIN_BAR_HEIGHT);
        markerRoot.add(mesh);
        bars.push({ mesh, material, binIdx });
      }
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
      pendingResolve = resolve;
      const settle = (): void => {
        if (pendingResolve === resolve) pendingResolve = null;
        resolve();
      };
      const tick = (): void => {
        if (!running) {
          settle();
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

        // === FFT 取得 + bar 更新 (bar.binIdx で参照) ===
        const fft = analyser.getValue();
        if (fft instanceof Float32Array) {
          for (const b of bars) {
            const db = fft[b.binIdx] ?? MIN_DB;
            const normalized = Math.max(0, Math.min(1, (db - MIN_DB) / (MAX_DB - MIN_DB)));
            const height = MIN_BAR_HEIGHT + normalized * MAX_BAR_HEIGHT;
            b.mesh.scale.z = height;
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
          settle();
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
    // pending Promise を即解決 (cancelAnimationFrame で tick が来なくなるので明示 resolve)。
    if (pendingResolve) {
      const r = pendingResolve;
      pendingResolve = null;
      r();
    }
    clearScene();
    renderer?.clear();
  },
};
