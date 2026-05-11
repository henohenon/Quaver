import * as Tone from 'tone';
import type { AudioStyle } from '../index';
import { generateMelody, melodyDurationSec, midiToFreq } from '../melody';
import { awaitPlaybackDuration, cancelPlayback } from '../playback';

// Acid bass: MonoSynth ベース + sawtooth + filter envelope の 303 風レゾナンス。
// 低音域 (root -24半音シフト)。 spec audioStyle 11。

let synth: Tone.PolySynth<Tone.MonoSynth> | null = null;

function ensureSynth(): Tone.PolySynth<Tone.MonoSynth> {
  if (synth) return synth;
  synth = new Tone.PolySynth(Tone.MonoSynth, {
    oscillator: { type: 'sawtooth' },
    filter: { Q: 6, type: 'lowpass', frequency: 800, rolloff: -24 },
    filterEnvelope: {
      attack: 0.01, decay: 0.2, sustain: 0.2, release: 0.2,
      baseFrequency: 200, octaves: 3,
    },
    envelope: { attack: 0.001, decay: 0.3, sustain: 0.1, release: 0.2 },
  }).toDestination();
  synth.volume.value = -10;
  return synth;
}

export const acidBass: AudioStyle = {
  id: 11,
  name: 'Acid bass',

  async play(mod) {
    await Tone.start();
    const s = ensureSynth();
    s.releaseAll();
    for (const n of generateMelody(mod, { rootOffset: -24 })) {
      s.triggerAttackRelease(midiToFreq(n.midi), n.duration, n.time, n.velocity);
    }
    await awaitPlaybackDuration(melodyDurationSec(mod));
  },

  stop() {
    synth?.releaseAll();
    cancelPlayback();
  },
};
