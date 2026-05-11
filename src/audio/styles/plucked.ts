import * as Tone from 'tone';
import type { AudioStyle } from '../index';
import { generateMelody, melodyDurationSec, midiToFreq } from '../melody';
import { awaitPlaybackDuration, cancelPlayback } from '../playback';

// Plucked: triangle + 鋭いattack、 ハープ/撥弦風。 spec audioStyle 6。

let synth: Tone.PolySynth<Tone.Synth> | null = null;

function ensureSynth(): Tone.PolySynth<Tone.Synth> {
  if (synth) return synth;
  synth = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: 'triangle' },
    envelope: { attack: 0.002, decay: 0.45, sustain: 0, release: 0.25 },
  }).toDestination();
  synth.volume.value = -8;
  return synth;
}

export const plucked: AudioStyle = {
  id: 6,
  name: 'Plucked',

  async play(mod) {
    await Tone.start();
    const s = ensureSynth();
    s.releaseAll();
    for (const n of generateMelody(mod)) {
      s.triggerAttackRelease(midiToFreq(n.midi), n.duration, n.time, n.velocity);
    }
    await awaitPlaybackDuration(melodyDurationSec(mod));
  },

  stop() {
    synth?.releaseAll();
    cancelPlayback();
  },
};
