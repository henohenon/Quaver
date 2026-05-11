import { modulationFor, type Modulation } from './hash';
import { play, stopAll, styleFor } from './audio';
import { startScan, type ScanHandle } from './scan';
import { initEffect, playEffect, stopAllEffects, effectFor } from './effect';
import { generateMatrix } from './effect/qr-matrix';

const AUDIO_STYLE_NAMES = [
  'Music box', 'Ambient pad', 'Techno pulse', 'Glitch',
  'Choir', 'Bells', 'Plucked', '808 + drums',
  'Granular wash', 'FM piano', 'Chip tune', 'Acid bass',
  'Wind chimes', 'Drone', 'Frog/insect', 'Heartbeat',
] as const;

const VISUAL_STYLE_NAMES = [
  'Crumble', 'Swarm', 'Crystal', 'Liquid',
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
  effectCanvas?: HTMLCanvasElement | null;
  videoWrap?: HTMLElement | null;
};

async function trigger(text: string, options: TriggerOptions): Promise<void> {
  if (playing || text.length === 0) return;
  playing = true;
  const { onParams, effectCanvas, videoWrap } = options;
  try {
    stopAll();
    stopAllEffects();
    const mod = await modulationFor(text);
    onParams(mod);

    const tasks: Promise<unknown>[] = [play(mod)];
    if (effectCanvas) {
      const matrix = generateMatrix(text);
      if (videoWrap) videoWrap.classList.add('playing');
      tasks.push(
        playEffect(effectCanvas, matrix, mod).finally(() => {
          if (videoWrap) videoWrap.classList.remove('playing');
        }),
      );
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

// ----- Scan screen -----

function initScanScreen(): void {
  const video = $<HTMLVideoElement>('video');
  const placeholder = $<HTMLDivElement>('videoPlaceholder');
  const startBtn = $<HTMLButtonElement>('scanStart');
  const stopBtn = $<HTMLButtonElement>('scanStop');
  const status = $<HTMLParagraphElement>('scanStatus');
  const lastQr = $<HTMLParagraphElement>('lastQr');
  const output = $<HTMLPreElement>('scanOutput');
  const effectCanvas = $<HTMLCanvasElement>('effectCanvas');
  const videoWrap = $<HTMLDivElement>('videoWrap');

  initEffect(effectCanvas);

  let handle: ScanHandle | null = null;
  let lastDetected = '';

  const setStatus = (msg: string): void => {
    status.textContent = msg;
  };

  const onDetect = (data: string): void => {
    // 同じQRを連続検出した場合: 再生中ならskip、別QRに切り替わったら即再生。
    if (data === lastDetected && playing) return;
    lastDetected = data;
    lastQr.textContent = `detected: ${data}`;
    setStatus('再生中...');
    void trigger(data, {
      onParams: (mod) => {
        output.textContent = formatModulation(mod);
      },
      effectCanvas,
      videoWrap,
    }).then(() => {
      setStatus('スキャン中 — 次のQRを向けてください');
    });
  };

  const start = async (): Promise<void> => {
    startBtn.disabled = true;
    setStatus('カメラ起動中...');
    placeholder.style.display = 'none';
    try {
      handle = await startScan({
        video,
        onDetect,
        onError: (err) => {
          // 1フレーム失敗は無視 (loopは継続)
          console.warn('scan frame error', err);
        },
      });
      stopBtn.disabled = false;
      setStatus('スキャン中 — QRをカメラに向けてください');
    } catch (err) {
      placeholder.style.display = 'flex';
      placeholder.textContent = `カメラエラー: ${describeError(err)}`;
      setStatus('');
      startBtn.disabled = false;
    }
  };

  const stop = (): void => {
    handle?.stop();
    handle = null;
    stopBtn.disabled = true;
    startBtn.disabled = false;
    setStatus('停止しました');
    placeholder.style.display = 'flex';
    placeholder.textContent = '「スキャン開始」を押してください';
    lastDetected = '';
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
  const navLink = $<HTMLAnchorElement>('navLink');
  scanEl.classList.toggle('active', route === 'scan');
  debugEl.classList.toggle('active', route === 'debug');
  if (route === 'scan') {
    navLink.textContent = 'debug ▸';
    navLink.href = '#/debug';
  } else {
    navLink.textContent = '◂ scan';
    navLink.href = '#/';
  }
}

initScanScreen();
initDebugScreen();
applyRoute();
window.addEventListener('hashchange', applyRoute);
