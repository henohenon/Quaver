import * as Tone from 'tone';
import type { AudioStyle } from '../index';
import type { Modulation } from '../../hash';

// Music box: 減衰の早いオルゴール風サイン波。短いdecay、サスティンなし。
const SCALES = [
  [0, 2, 4, 7, 9],   // major pentatonic
  [0, 3, 5, 7, 10],  // minor pentatonic
] as const;

const ROOT_MIDI = 72; // C5
const SUBDIVISION_PER_BEAT = 2; // 8th notes

let synth: Tone.PolySynth | null = null;

function ensureSynth(): Tone.PolySynth {
  if (synth) return synth;
  synth = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: 'sine' },
    envelope: {
      attack: 0.001,
      decay: 0.8,
      sustain: 0,
      release: 0.6,
    },
  }).toDestination();
  synth.volume.value = -6;
  return synth;
}

function midiToFreq(midi: number): number {
  return Tone.Frequency(midi, 'midi').toFrequency();
}

export const musicBox: AudioStyle = {
  id: 0,
  name: 'Music box',

  async play(mod: Modulation): Promise<void> {
    await Tone.start();
    const s = ensureSynth();
    s.releaseAll();

    const scale = SCALES[mod.scaleSeed % SCALES.length]!;
    const beatSec = 60 / mod.bpm;
    const stepSec = beatSec / SUBDIVISION_PER_BEAT;
    const startAt = Tone.now() + 0.05;

    for (let i = 0; i < mod.noteCount; i++) {
      const byte = mod.noteSeeds[i % mod.noteSeeds.length]!;
      const degree = byte % scale.length;
      const octShift = (byte >> 4) & 1; // 0 or 1 octave up
      const midi = ROOT_MIDI + scale[degree]! + octShift * 12;
      const velocity = 0.4 + (byte / 255) * 0.5;
      const time = startAt + i * stepSec;
      s.triggerAttackRelease(midiToFreq(midi), '8n', time, velocity);
    }

    const totalSec = mod.noteCount * stepSec + 1.0; // 余韻
    await new Promise<void>((resolve) => {
      setTimeout(resolve, totalSec * 1000);
    });
  },

  stop(): void {
    synth?.releaseAll();
  },
};
