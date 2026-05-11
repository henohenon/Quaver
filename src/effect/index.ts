import type { Modulation } from '../hash';
import type { QRMatrix } from './qr-matrix';
import type { Corner } from '../scan';
import { crumble } from './styles/crumble';

export type EffectContext = {
  corners: [Corner, Corner, Corner, Corner];
  frameWidth: number;
  frameHeight: number;
};

/** トラッキング用: 毎フレーム最新の context を返す。 nullなら直前値を使う想定。 */
export type EffectContextProvider = () => EffectContext | null;

export type VisualEffect = {
  readonly id: number;
  readonly name: string;
  /** canvas をbindして renderer等を初期化 (idempotent) */
  init(canvas: HTMLCanvasElement): void;
  /** matrix + 変調 + ライブ context provider で1再生サイクル。 */
  play(matrix: QRMatrix, mod: Modulation, getContext: EffectContextProvider): Promise<void>;
  stop(): void;
};

// 未実装IDは Crumble にフォールバック (体験を切らさない)。
const REGISTRY: Partial<Record<number, VisualEffect>> = {
  0: crumble,
};

export function effectFor(mod: Modulation): VisualEffect {
  return REGISTRY[mod.visualStyle] ?? crumble;
}

export function initEffect(canvas: HTMLCanvasElement): void {
  for (const e of Object.values(REGISTRY)) e?.init(canvas);
}

export async function playEffect(
  canvas: HTMLCanvasElement,
  matrix: QRMatrix,
  mod: Modulation,
  getContext: EffectContextProvider,
): Promise<void> {
  const e = effectFor(mod);
  e.init(canvas);
  await e.play(matrix, mod, getContext);
}

export function stopAllEffects(): void {
  for (const e of Object.values(REGISTRY)) e?.stop();
}
