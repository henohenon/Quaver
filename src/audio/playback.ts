// 共有 playback タイマー: setTimeout 1個でreleaseまでの待ち時間を管理。
// 任意の style の stop() から cancelPlayback() で即解決可 (トラッキング切れ等での中断用)。

let currentTimeout: number | null = null;
let currentResolve: (() => void) | null = null;

export function awaitPlaybackDuration(sec: number): Promise<void> {
  return new Promise<void>((resolve) => {
    currentResolve = resolve;
    currentTimeout = window.setTimeout(() => {
      currentTimeout = null;
      currentResolve = null;
      resolve();
    }, sec * 1000);
  });
}

export function cancelPlayback(): void {
  if (currentTimeout !== null) {
    clearTimeout(currentTimeout);
    currentTimeout = null;
  }
  if (currentResolve) {
    const r = currentResolve;
    currentResolve = null;
    r();
  }
}
