import type { Modulation } from '../hash';
import { musicBox } from './styles/music-box';

export type AudioStyle = {
  readonly id: number;
  readonly name: string;
  /** modで指定された変調を適用して melody を発音する。完了で resolve。 */
  play(mod: Modulation): Promise<void>;
  /** 即停止 (進行中のnoteも release) */
  stop(): void;
};

// id 0..15 のうち実装済みのもの。未実装は music-box にフォールバック (体験を切らさないため)。
const REGISTRY: Partial<Record<number, AudioStyle>> = {
  0: musicBox,
};

export function styleFor(mod: Modulation): AudioStyle {
  return REGISTRY[mod.audioStyle] ?? musicBox;
}

export async function play(mod: Modulation): Promise<void> {
  await styleFor(mod).play(mod);
}

export function stopAll(): void {
  for (const style of Object.values(REGISTRY)) {
    style?.stop();
  }
}
