import type { Modulation } from '../hash';
import type { QRMatrix } from './qr-matrix';
import { crumble } from './styles/crumble';

export type VisualEffect = {
  readonly id: number;
  readonly name: string;
  /** canvas をbindして renderer等を初期化 (idempotent) */
  init(canvas: HTMLCanvasElement): void;
  /** matrix + 変調で1再生サイクル。完了で resolve。 */
  play(matrix: QRMatrix, mod: Modulation): Promise<void>;
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
): Promise<void> {
  const e = effectFor(mod);
  e.init(canvas);
  await e.play(matrix, mod);
}

export function stopAllEffects(): void {
  for (const e of Object.values(REGISTRY)) e?.stop();
}
