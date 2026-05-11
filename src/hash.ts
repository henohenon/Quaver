// SHA-256ベースの決定論的バイト分配。
// 同じ入力 → 同じ32バイト → 同じプリセット + 変調 → 同じ出力。

export type HashBytes = Uint8Array;

export async function hashInput(text: string): Promise<HashBytes> {
  const encoded = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  return new Uint8Array(digest);
}

export type Modulation = {
  /** 音色スタイル 0..15 (Tier 1) */
  audioStyle: number;
  /** ビジュアルスタイル 0..7 (Tier 1) */
  visualStyle: number;
  /** BPM 60..180 */
  bpm: number;
  /** 音数 8..32 */
  noteCount: number;
  /** スケール選択 raw (audioStyle側で許容セットに射影する) */
  scaleSeed: number;
  /** 密度 raw 0..255 (audio側で疎/中/密に射影) */
  densitySeed: number;
  /** カラーパレット 0..7 */
  paletteIndex: number;
  /** カメラワーク 0..3 (static / orbit / dolly / shake) */
  cameraIndex: number;
  /** 各音の音階・長さ・ベロシティ用シード (24バイト) */
  noteSeeds: Uint8Array;
};

const AUDIO_STYLE_COUNT = 16;
const VISUAL_STYLE_COUNT = 8;
const PALETTE_COUNT = 8;
const CAMERA_COUNT = 4;

const BPM_MIN = 60;
const BPM_MAX = 180;
const NOTE_COUNT_MIN = 8;
const NOTE_COUNT_MAX = 32;

// バイト値 (0..255) を [min, max] (inclusive) の整数に均等射影。
function mapByteToRange(byte: number, min: number, max: number): number {
  const span = max - min + 1;
  // 0..255 → 0..(span-1)、最後の値は丸めで span-1 にクランプ
  const scaled = Math.floor((byte / 256) * span);
  return min + Math.min(scaled, span - 1);
}

export function distribute(bytes: HashBytes): Modulation {
  if (bytes.length < 32) {
    throw new Error(`expected at least 32 bytes, got ${bytes.length}`);
  }
  return {
    audioStyle: bytes[0]! % AUDIO_STYLE_COUNT,
    visualStyle: bytes[1]! % VISUAL_STYLE_COUNT,
    bpm: mapByteToRange(bytes[2]!, BPM_MIN, BPM_MAX),
    noteCount: mapByteToRange(bytes[3]!, NOTE_COUNT_MIN, NOTE_COUNT_MAX),
    scaleSeed: bytes[4]!,
    densitySeed: bytes[5]!,
    paletteIndex: bytes[6]! % PALETTE_COUNT,
    cameraIndex: bytes[7]! % CAMERA_COUNT,
    noteSeeds: bytes.slice(8, 32),
  };
}

export async function modulationFor(text: string): Promise<Modulation> {
  const bytes = await hashInput(text);
  return distribute(bytes);
}
