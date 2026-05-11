import * as Tone from 'tone';
import type { AudioStyle } from '../index';
import { generateMelody, melodyDurationSec, midiToFreq } from '../melody';
import { awaitPlaybackDuration, cancelPlayback } from '../playback';

// Ambient pad: sawtooth + slow attack + long release + reverb。 ふわっとした持続感。
// spec audioStyle 1。

let synth: Tone.PolySynth<Tone.Synth> | null = null;
let reverb: Tone.Reverb | null = null;

function ensureSynth(): Tone.PolySynth<Tone.Synth> {
  if (synth) return synth;
  reverb = new Tone.Reverb({ decay: 4, wet: 0.45 }).toDestination();
  synth = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: 'sawtooth' },
    envelope: { attack: 0.3, decay: 0.4, sustain: 0.5, release: 1.5 },
  }).connect(reverb);
  synth.volume.value = -14;
  return synth;
}

export const ambientPad: AudioStyle = {
  id: 1,
  name: 'Ambient pad',

  async play(mod) {
    await Tone.start();
    const s = ensureSynth();
    s.releaseAll();
    // sustainが効くよう 1音を長め (4n)
    for (const n of generateMelody(mod, { noteDuration: '4n' })) {
      s.triggerAttackRelease(midiToFreq(n.midi), n.duration, n.time, n.velocity);
    }
    // reverb tailぶん余韻を伸ばす
    await awaitPlaybackDuration(melodyDurationSec(mod) + 1.5);
  },

  stop() {
    synth?.releaseAll();
    cancelPlayback();
  },
};
