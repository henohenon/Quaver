import { modulationFor, type Modulation } from './hash';
import { play, stopAll, styleFor } from './audio';
import { startScan, type ScanHandle, type QRDetection } from './scan';
import { initEffect, playEffect, stopAllEffects, effectFor, type EffectContext } from './effect';
import { generateMatrix } from './effect/qr-matrix';

const AUDIO_STYLE_NAMES = [
  'Music box', 'Ambient pad', 'Techno pulse', 'Glitch',
  'Choir', 'Bells', 'Plucked', '808 + drums',
  'Granular wash', 'FM piano', 'Chip tune', 'Acid bass',
  'Wind chimes', 'Drone', 'Frog/insect', 'Heartbeat',
] as const;

const VISUAL_STYLE_NAMES = [
  'Spectrum', 'Swarm', 'Crystal', 'Liquid',
  'Explosion', 'Constellation', 'Origami', 'Decay',
] as const;

const CAMERA_NAMES = ['static', 'orbit', 'dolly', 'shake'] as const;

function formatModulation(mod: Modulation): string {
  const audioName = AUDIO_STYLE_NAMES[mod.audioStyle];
  const audioActual = styleFor(mod).name;
  const audioNote = audioName === audioActual ? '' : ` (※ ${audioActual} で代替再生)`;
  const visualName = VISUAL_STYLE_NAMES[mod.visualStyle];
  const visualActual = effectFor(mod).name;
  const visualNote = visualName === visualActual ? '' : ` (※ ${visualActual} で代替描画)`;
  return [
    `audio  : ${mod.audioStyle.toString().padStart(2)} (${audioName})${audioNote}`,
    `visual : ${mod.visualStyle.toString().padStart(2)} (${visualName})${visualNote}`,
    `bpm    : ${mod.bpm}`,
    `notes  : ${mod.noteCount}`,
    `palette: ${mod.paletteIndex}`,
    `camera : ${mod.cameraIndex} (${CAMERA_NAMES[mod.cameraIndex]})`,
    `scale  : 0x${mod.scaleSeed.toString(16).padStart(2, '0')}`,
    `density: 0x${mod.densitySeed.toString(16).padStart(2, '0')}`,
  ].join('\n');
}

function $<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`element not found: #${id}`);
  return el as T;
}

// ----- 共通 playback 制御 -----

let playing = false;

type TriggerOptions = {
  onParams: (mod: Modulation) => void;
  effect?: {
    canvas: HTMLCanvasElement;
    getContext: () => EffectContext | null;
  };
};

async function trigger(text: string, options: TriggerOptions): Promise<void> {
  if (playing || text.length === 0) return;
  playing = true;
  const { onParams, effect } = options;
  try {
    stopAll();
    stopAllEffects();
    const mod = await modulationFor(text);
    onParams(mod);

    const tasks: Promise<unknown>[] = [play(mod)];
    if (effect) {
      const matrix = generateMatrix(text);
      tasks.push(playEffect(effect.canvas, matrix, mod, effect.getContext));
    }
    await Promise.all(tasks);
  } finally {
    playing = false;
  }
}

// ----- Debug screen -----

function initDebugScreen(): void {
  const form = $<HTMLFormElement>('form');
  const input = $<HTMLInputElement>('text');
  const output = $<HTMLPreElement>('output');
  const button = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;

  const renderParams = (text: string): void => {
    if (text.length === 0) {
      output.textContent = 'ここに変調パラメータが表示されます';
      return;
    }
    void modulationFor(text).then((mod) => {
      output.textContent = formatModulation(mod);
    });
  };

  input.addEventListener('input', () => renderParams(input.value));

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (playing) return;
    button.disabled = true;
    button.textContent = '再生中...';
    void trigger(input.value, {
      onParams: (mod) => {
        output.textContent = formatModulation(mod);
      },
    }).finally(() => {
      button.disabled = false;
      button.textContent = '鳴らす';
    });
  });
}

// ----- Scan screen helpers -----

// video/canvas は CSSの object-fit: cover で viewport を充填する (黒帯廃止)。
// 端は多少cropされるが、 video/canvas は同じ intrinsic size なので位置整合は保たれる。

// hero画面のエラー表示 (start失敗時)
function setHeroError(hero: HTMLElement, msg: string | null): void {
  let el = document.getElementById('heroError') as HTMLParagraphElement | null;
  if (msg === null) {
    el?.remove();
    return;
  }
  if (!el) {
    el = document.createElement('p');
    el.id = 'heroError';
    el.style.color = '#ff9494';
    el.style.fontSize = '0.85rem';
    el.style.margin = '0';
    hero.appendChild(el);
  }
  el.textContent = msg;
}

// ----- Scan screen -----

const LOST_TIMEOUT_MS = 800;

function initScanScreen(): void {
  const video = $<HTMLVideoElement>('video');
  const hero = $<HTMLDivElement>('hero');
  const cameraStage = $<HTMLDivElement>('cameraStage');
  const startBtn = $<HTMLButtonElement>('scanStart');
  const stopBtn = $<HTMLButtonElement>('scanStop');
  const status = $<HTMLParagraphElement>('scanStatus');
  const effectCanvas = $<HTMLCanvasElement>('effectCanvas');

  initEffect(effectCanvas);

  let handle: ScanHandle | null = null;
  let lastDetected = '';
  let latestDetection: QRDetection | null = null;
  let lastDetectTime = 0;
  let trackingLost = false;
  let lostWatchdogId: number | null = null;

  const setStatus = (msg: string): void => {
    status.textContent = msg;
  };

  const showHero = (): void => {
    cameraStage.hidden = true;
    hero.hidden = false;
  };

  const showCamera = (): void => {
    hero.hidden = true;
    cameraStage.hidden = false;
  };

  const getEffectContext = (): EffectContext | null => {
    if (!latestDetection) return null;
    const { corners, frameWidth, frameHeight } = latestDetection;
    return { corners, frameWidth, frameHeight };
  };

  const startWatchdog = (): void => {
    if (lostWatchdogId !== null) return;
    lostWatchdogId = window.setInterval(() => {
      // 再生中で最終検出から LOST_TIMEOUT_MS 経過 → トラッキング切れ。
      // 音/エフェクトを即停止+破棄、 latestDetectionも捨てる。
      if (!playing || trackingLost) return;
      if (performance.now() - lastDetectTime > LOST_TIMEOUT_MS) {
        trackingLost = true;
        stopAll();
        stopAllEffects();
        lastDetected = '';
        latestDetection = null;
      }
    }, 100);
  };

  const stopWatchdog = (): void => {
    if (lostWatchdogId !== null) {
      clearInterval(lostWatchdogId);
      lostWatchdogId = null;
    }
  };

  const onDetect = (detection: QRDetection): void => {
    // 追跡用に毎フレーム最新値を上書き (再生中でも続行)
    latestDetection = detection;
    lastDetectTime = performance.now();
    trackingLost = false;

    const { data } = detection;
    if (data === lastDetected && playing) return;
    lastDetected = data;
    setStatus('再生中...');
    void trigger(data, {
      onParams: () => {
        // scan画面では modulation params 表示しない (debug画面で見られる)
      },
      effect: {
        canvas: effectCanvas,
        getContext: getEffectContext,
      },
    }).then(() => {
      if (trackingLost) {
        setStatus('トラッキング切れ — QRを向け直して');
      } else {
        setStatus('スキャン中 — 次のQRを向けてください');
      }
    });
  };

  const start = async (): Promise<void> => {
    startBtn.disabled = true;
    setHeroError(hero, null);
    setStatus('カメラ起動中...');
    showCamera();
    try {
      handle = await startScan({
        video,
        onDetect,
        onError: (err) => {
          console.warn('scan frame error', err);
        },
      });
      stopBtn.disabled = false;
      setStatus('スキャン中 — QRをカメラに向けてください');
      lastDetectTime = performance.now(); // start基準でwatchdog計算
      startWatchdog();
    } catch (err) {
      startBtn.disabled = false;
      showHero();
      setHeroError(hero, `カメラエラー: ${describeError(err)}`);
      setStatus('');
    }
  };

  const stop = (): void => {
    stopWatchdog();
    handle?.stop();
    handle = null;
    stopAll();
    stopAllEffects();
    latestDetection = null;
    lastDetected = '';
    trackingLost = false;
    stopBtn.disabled = true;
    startBtn.disabled = false;
    setStatus('');
    showHero();
  };

  startBtn.addEventListener('click', () => void start());
  stopBtn.addEventListener('click', stop);

  // hash切替時に scan画面から離れたら停止
  window.addEventListener('hashchange', () => {
    if (currentRoute() !== 'scan' && handle) stop();
  });
}

function describeError(err: unknown): string {
  if (err instanceof DOMException) {
    if (err.name === 'NotAllowedError') return 'カメラのアクセスが拒否されました';
    if (err.name === 'NotFoundError') return 'カメラが見つかりません';
    if (err.name === 'NotReadableError') return 'カメラが他のアプリで使用中です';
    return `${err.name}: ${err.message}`;
  }
  if (err instanceof Error) return err.message;
  return String(err);
}

// ----- Router -----

type Route = 'scan' | 'debug';

function currentRoute(): Route {
  return location.hash === '#/debug' ? 'debug' : 'scan';
}

function applyRoute(): void {
  const route = currentRoute();
  const scanEl = $<HTMLElement>('scanScreen');
  const debugEl = $<HTMLElement>('debugScreen');
  scanEl.classList.toggle('active', route === 'scan');
  debugEl.classList.toggle('active', route === 'debug');
}

initScanScreen();
initDebugScreen();
applyRoute();
window.addEventListener('hashchange', applyRoute);
