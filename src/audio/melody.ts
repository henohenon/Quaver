import * as Tone from 'tone';
import type { Modulation } from '../hash';

// メロディ素材の共通生成: scaleSeed で スケール選択、 densitySeed (旧未使用byte) で root pitch、
// noteSeeds で各音の音階度数/オクターブ/velocity。

export const SCALES: ReadonlyArray<readonly number[]> = [
  [0, 2, 4, 7, 9],           // 0: major pentatonic
  [0, 3, 5, 7, 10],          // 1: minor pentatonic
  [0, 2, 3, 5, 7, 9, 10],    // 2: dorian
  [0, 1, 3, 5, 7, 8, 10],    // 3: phrygian
  [0, 2, 4, 6, 7, 9, 11],    // 4: lydian
  [0, 3, 5, 6, 7, 10],       // 5: blues
  [0, 2, 4, 6, 8, 10],       // 6: whole-tone
  [0, 4, 7, 11],             // 7: major7 arpeggio
];

// densitySeed (byte 0..255) → root MIDI C4..C6 (60..84)
const ROOT_MIN_MIDI = 60;
const ROOT_MAX_MIDI = 84;

export function rootMidiFor(mod: Modulation): number {
  const span = ROOT_MAX_MIDI - ROOT_MIN_MIDI + 1;
  return ROOT_MIN_MIDI + Math.floor((mod.densitySeed / 256) * span);
}

export function scaleFor(mod: Modulation): readonly number[] {
  return SCALES[mod.scaleSeed % SCALES.length]!;
}

export type MelodyNote = {
  midi: number;
  /** Tone.now() ベースの絶対時刻 */
  time: number;
  duration: string;
  velocity: number;
};

export type MelodyConfig = {
  subdivisionsPerBeat?: number; // default 2 (= 8分音符)
  noteDuration?: string;        // Tone notation, default '8n'
  velocityRange?: [number, number]; // default [0.4, 0.9]
  rootOffset?: number;          // 半音シフト (timbre別に register移動、 default 0)
};

export function generateMelody(mod: Modulation, config: MelodyConfig = {}): MelodyNote[] {
  const scale = scaleFor(mod);
  const root = rootMidiFor(mod) + (config.rootOffset ?? 0);
  const subdiv = config.subdivisionsPerBeat ?? 2;
  const duration = config.noteDuration ?? '8n';
  const [velMin, velMax] = config.velocityRange ?? [0.4, 0.9];

  const beatSec = 60 / mod.bpm;
  const stepSec = beatSec / subdiv;
  const startAt = Tone.now() + 0.05;

  const notes: MelodyNote[] = [];
  for (let i = 0; i < mod.noteCount; i++) {
    const byte = mod.noteSeeds[i % mod.noteSeeds.length]!;
    const degree = byte % scale.length;
    const octShift = (byte >> 4) & 1;
    const midi = root + scale[degree]! + octShift * 12;
    const velocity = velMin + (byte / 255) * (velMax - velMin);
    const time = startAt + i * stepSec;
    notes.push({ midi, time, duration, velocity });
  }
  return notes;
}

export function melodyDurationSec(mod: Modulation, subdivisionsPerBeat = 2, tailSec = 1.0): number {
  const beatSec = 60 / mod.bpm;
  const stepSec = beatSec / subdivisionsPerBeat;
  return mod.noteCount * stepSec + tailSec;
}

export function midiToFreq(midi: number): number {
  return Tone.Frequency(midi, 'midi').toFrequency();
}
