import QRCode from 'qrcode';

export type QRMatrix = {
  /** 1辺のモジュール数 (e.g. 21, 25, ...) */
  size: number;
  /** size*size の boolean配列 (true = 黒モジュール) */
  modules: boolean[];
};

/**
 * text → QRビットマトリクス。
 * error correction は M (中)。 effect用なので scan耐性は不要、 サイズと密度のバランス重視。
 */
export function generateMatrix(text: string): QRMatrix {
  const qr = QRCode.create(text, { errorCorrectionLevel: 'M' });
  const size = qr.modules.size;
  const data = qr.modules.data;
  const modules: boolean[] = new Array(size * size);
  for (let i = 0; i < modules.length; i++) {
    modules[i] = data[i] === 1;
  }
  return { size, modules };
}
