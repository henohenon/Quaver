import * as Tone from 'tone';

// Master destination に分岐接続する FFT analyser (singleton)。
// effect側から getAnalyser() で参照、 各 tick で getValue() でFFT bin読む。

const FFT_SIZE = 64;
const SMOOTHING = 0.7; // 0..1、 高いほど滑らか

let analyser: Tone.Analyser | null = null;

export function getAnalyser(): Tone.Analyser {
  if (analyser) return analyser;
  analyser = new Tone.Analyser({
    type: 'fft',
    size: FFT_SIZE,
    smoothing: SMOOTHING,
  });
  // master output に分岐 (analyser は sink、 destinationの音は普通にspeakerに行く)
  Tone.getDestination().connect(analyser);
  return analyser;
}

export const ANALYSER_FFT_SIZE = FFT_SIZE;
