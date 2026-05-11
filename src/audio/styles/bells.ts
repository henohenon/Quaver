import * as Tone from 'tone';
import type { AudioStyle } from '../index';
import { generateMelody, melodyDurationSec, midiToFreq } from '../melody';
import { awaitPlaybackDuration, cancelPlayback } from '../playback';

// Bells: FMSynth with bell-like params。 共鳴ストライク + 長い余韻。 spec audioStyle 5。

let synth: Tone.PolySynth<Tone.FMSynth> | null = null;

function ensureSynth(): Tone.PolySynth<Tone.FMSynth> {
  if (synth) return synth;
  synth = new Tone.PolySynth(Tone.FMSynth, {
    harmonicity: 3.01,
    modulationIndex: 14,
    envelope: { attack: 0.001, decay: 1.8, sustain: 0, release: 1.2 },
    modulation: { type: 'sine' },
    modulationEnvelope: { attack: 0.002, decay: 0.4, sustain: 0, release: 0.4 },
  }).toDestination();
  synth.volume.value = -12;
  return synth;
}

export const bells: AudioStyle = {
  id: 5,
  name: 'Bells',

  async play(mod) {
    await Tone.start();
    const s = ensureSynth();
    s.releaseAll();
    // bellsは1オクターブ上で輝きが出る
    for (const n of generateMelody(mod, { rootOffset: 12 })) {
      s.triggerAttackRelease(midiToFreq(n.midi), n.duration, n.time, n.velocity);
    }
    await awaitPlaybackDuration(melodyDurationSec(mod) + 0.8);
  },

  stop() {
    synth?.releaseAll();
    cancelPlayback();
  },
};
