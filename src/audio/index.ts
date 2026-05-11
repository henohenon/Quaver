import type { Modulation } from '../hash';
import { musicBox } from './styles/music-box';
import { ambientPad } from './styles/ambient-pad';
import { bells } from './styles/bells';
import { plucked } from './styles/plucked';
import { acidBass } from './styles/acid-bass';

export type AudioStyle = {
  readonly id: number;
  readonly name: string;
  /** modで指定された変調を適用して melody を発音する。完了で resolve。 */
  play(mod: Modulation): Promise<void>;
  /** 即停止 (進行中のnoteも release) */
  stop(): void;
};

const IMPLEMENTED: readonly AudioStyle[] = [musicBox, ambientPad, bells, plucked, acidBass];

// spec の 16 audioStyle (`bytes[0] % 16`) を 5つの実装に semantic fallback でマップ。
// spec通りのIDは一致 (0=Music box, 1=Ambient pad, 5=Bells, 6=Plucked, 11=Acid bass)、
// それ以外は雰囲気の近いものに割り当て。 main.ts の AUDIO_STYLE_NAMES と styleFor(mod).name が
// 食い違う場合は modulation params 表示で 「※ 代替再生」 が出る。
const REGISTRY: Record<number, AudioStyle> = {
  0:  musicBox,    // Music box (一致)
  1:  ambientPad,  // Ambient pad (一致)
  2:  acidBass,    // Techno pulse → bass で代替
  3:  musicBox,    // Glitch → 代替なし、 box
  4:  ambientPad,  // Choir → pad
  5:  bells,       // Bells (一致)
  6:  plucked,     // Plucked (一致)
  7:  acidBass,    // 808 + drums → bass
  8:  ambientPad,  // Granular wash → pad
  9:  plucked,     // FM piano → plucked
  10: bells,       // Chip tune → bells
  11: acidBass,    // Acid bass (一致)
  12: bells,       // Wind chimes → bells
  13: ambientPad,  // Drone → pad
  14: musicBox,    // Frog/insect → box
  15: musicBox,    // Heartbeat → box
};

export function styleFor(mod: Modulation): AudioStyle {
  return REGISTRY[mod.audioStyle] ?? musicBox;
}

export async function play(mod: Modulation): Promise<void> {
  await styleFor(mod).play(mod);
}

export function stopAll(): void {
  for (const s of IMPLEMENTED) s.stop();
}
