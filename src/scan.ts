import jsQR from 'jsqr';

export type Corner = { x: number; y: number };

export type QRDetection = {
  data: string;
  /** topLeft, topRight, bottomRight, bottomLeft の順 (時計回り) */
  corners: [Corner, Corner, Corner, Corner];
  /** jsQRに渡したフレームの寸法 (intrinsics近似に使う) */
  frameWidth: number;
  frameHeight: number;
};

export type ScanHandle = {
  stop(): void;
};

export type ScanOptions = {
  video: HTMLVideoElement;
  onDetect(detection: QRDetection): void;
  onError?(error: unknown): void;
};

/**
 * カメラを起動して video に流し、jsQRをrequestAnimationFrameで毎フレーム回す。
 * QR検出時に onDetect を呼ぶ (連続フレームでの重複は呼び出し側で抑制する)。
 * 戻り値の stop() で停止 + camera track を release。
 */
export async function startScan(options: ScanOptions): Promise<ScanHandle> {
  const { video, onDetect, onError } = options;

  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'environment' },
    audio: false,
  });

  video.srcObject = stream;
  video.setAttribute('playsinline', '');
  await video.play();

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    stream.getTracks().forEach((t) => t.stop());
    throw new Error('failed to get canvas 2d context');
  }

  let running = true;
  let rafId = 0;

  const tick = (): void => {
    if (!running) return;
    rafId = requestAnimationFrame(tick);

    if (video.readyState !== video.HAVE_ENOUGH_DATA) return;

    const w = video.videoWidth;
    const h = video.videoHeight;
    if (w === 0 || h === 0) return;

    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    ctx.drawImage(video, 0, 0, w, h);

    let imageData: ImageData;
    try {
      imageData = ctx.getImageData(0, 0, w, h);
    } catch (err) {
      onError?.(err);
      return;
    }

    const code = jsQR(imageData.data, imageData.width, imageData.height, {
      inversionAttempts: 'dontInvert',
    });
    if (code && code.data.length > 0) {
      const loc = code.location;
      onDetect({
        data: code.data,
        corners: [
          { x: loc.topLeftCorner.x, y: loc.topLeftCorner.y },
          { x: loc.topRightCorner.x, y: loc.topRightCorner.y },
          { x: loc.bottomRightCorner.x, y: loc.bottomRightCorner.y },
          { x: loc.bottomLeftCorner.x, y: loc.bottomLeftCorner.y },
        ],
        frameWidth: w,
        frameHeight: h,
      });
    }
  };

  rafId = requestAnimationFrame(tick);

  return {
    stop(): void {
      running = false;
      cancelAnimationFrame(rafId);
      stream.getTracks().forEach((t) => t.stop());
      video.srcObject = null;
    },
  };
}
