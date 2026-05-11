import * as THREE from 'three';
import type { VisualEffect } from '../index';
import type { Modulation } from '../../hash';
import type { QRMatrix } from '../qr-matrix';

// Crumble: QRの黒モジュールが音階の高さに沿って上昇 + フェード。
// 各モジュールは noteCount にmoduloで対応する note に紐づき、 そのnoteの時刻から rise が始まる。

const CELL_SIZE = 0.3;
const RISE_DURATION = 2.0; // sec — 1モジュールが上昇しきって消えるまで
const TAIL_SEC = 1.0;       // 余韻

let renderer: THREE.WebGLRenderer | null = null;
let scene: THREE.Scene | null = null;
let camera: THREE.PerspectiveCamera | null = null;
let canvasRef: HTMLCanvasElement | null = null;

const sharedGeometry = new THREE.BoxGeometry(CELL_SIZE * 0.9, CELL_SIZE * 0.9, CELL_SIZE * 0.9);

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
  renderer.setPixelRatio(window.devicePixelRatio);
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
  camera.position.set(0, 4, 15);
  camera.lookAt(0, 0, 0);
  resize();
}

function resize(): void {
  if (!renderer || !canvasRef || !camera) return;
  const w = canvasRef.clientWidth;
  const h = canvasRef.clientHeight;
  if (w === 0 || h === 0) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

function clearScene(): void {
  if (!scene) return;
  for (const child of [...scene.children]) {
    scene.remove(child);
    if (child instanceof THREE.Mesh) {
      const mat = child.material;
      if (Array.isArray(mat)) {
        mat.forEach((m) => m.dispose());
      } else {
        mat.dispose();
      }
    }
  }
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

  async play(matrix: QRMatrix, mod: Modulation): Promise<void> {
    setupScene(canvasRef ?? document.createElement('canvas'));
    if (!renderer || !scene || !camera) {
      throw new Error('crumble scene not initialized');
    }
    resize();
    clearScene();

    const halfGrid = (matrix.size * CELL_SIZE) / 2;
    const beatSec = 60 / mod.bpm;
    const stepSec = beatSec / 2;
    const totalSec = mod.noteCount * stepSec + RISE_DURATION + TAIL_SEC;

    const cubes: Cube[] = [];
    for (let row = 0; row < matrix.size; row++) {
      for (let col = 0; col < matrix.size; col++) {
        const idx = row * matrix.size + col;
        if (!matrix.modules[idx]) continue;

        const material = new THREE.MeshBasicMaterial({
          color: 0xe7e7ef,
          transparent: true,
          opacity: 1,
        });
        const mesh = new THREE.Mesh(sharedGeometry, material);
        const x = col * CELL_SIZE - halfGrid + CELL_SIZE / 2;
        // 行0を奥に置く (QRの上端が奥)
        const z = row * CELL_SIZE - halfGrid + CELL_SIZE / 2;
        mesh.position.set(x, 0, z);
        scene.add(mesh);

        const byte = mod.noteSeeds[idx % mod.noteSeeds.length]!;
        const noteIdx = idx % mod.noteCount;
        const startDelay = noteIdx * stepSec;
        // 上昇高さは 2..8 の範囲で byte値依存
        const riseHeight = 2 + (byte / 255) * 6;
        cubes.push({ mesh, material, startDelay, riseHeight });
      }
    }

    running = true;
    const startMs = performance.now();

    return new Promise<void>((resolve) => {
      const tick = (): void => {
        if (!running) {
          resolve();
          return;
        }
        const t = (performance.now() - startMs) / 1000;

        for (const c of cubes) {
          const local = t - c.startDelay;
          if (local <= 0) continue;
          if (local >= RISE_DURATION) {
            c.mesh.visible = false;
            continue;
          }
          // ease-out cubic
          const p = local / RISE_DURATION;
          const ease = 1 - Math.pow(1 - p, 3);
          c.mesh.position.y = ease * c.riseHeight;
          c.material.opacity = 1 - p;
        }

        // ゆるい orbit — 視覚的な動きを付ける
        const orbit = t * 0.15;
        camera!.position.x = Math.sin(orbit) * 14;
        camera!.position.z = Math.cos(orbit) * 14;
        camera!.lookAt(0, 1.5, 0);

        renderer!.render(scene!, camera!);

        if (t >= totalSec) {
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
