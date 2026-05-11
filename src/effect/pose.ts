// QR 4頂点 → カメラ姿勢 (R, t) を OpenCV慣習で推定する。
// recipeのsolvePnP相当を、 4点coplanarの homography → 分解で代替 (OpenCV.js依存を避ける)。
//
// 座標系: OpenCV camera frame (X right, Y down, Z forward into scene)。
// Three.jsへの変換 (Y/Z flip) は呼び出し側で行う。

export type Point2D = { x: number; y: number };

export type Pose = {
  /** 3x3 rotation, row-major (9 elements) */
  R: number[];
  /** 3-element translation */
  t: [number, number, number];
};

export type Intrinsics = {
  fx: number;
  fy: number;
  cx: number;
  cy: number;
};

/** マーカー: TL(-1,+1), TR(+1,+1), BR(+1,-1), BL(-1,-1) on Z=0、+Y up。 */
export const MARKER_CORNERS: [Point2D, Point2D, Point2D, Point2D] = [
  { x: -1, y:  1 },
  { x:  1, y:  1 },
  { x:  1, y: -1 },
  { x: -1, y: -1 },
];

/** 画像幅高さから素朴に intrinsics近似 (fy ≈ image height で fov_v ≈ 53°)。 */
export function approxIntrinsics(width: number, height: number): Intrinsics {
  return { fx: height, fy: height, cx: width / 2, cy: height / 2 };
}

/**
 * marker plane の (X, Y, 0) → image (u, v) を写す homography H (3x3 row-major) を
 * DLT で求める。 4点対応で 8 unknowns、 h22=1 に正規化。
 */
export function computeHomography(
  markerCorners: [Point2D, Point2D, Point2D, Point2D],
  imageCorners: [Point2D, Point2D, Point2D, Point2D],
): number[] {
  // 各対応点で 2 equations:
  //   h00 X + h01 Y + h02 - h20 X u - h21 Y u = u
  //   h10 X + h11 Y + h12 - h20 X v - h21 Y v = v
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const X = markerCorners[i]!.x;
    const Y = markerCorners[i]!.y;
    const u = imageCorners[i]!.x;
    const v = imageCorners[i]!.y;
    A.push([X, Y, 1, 0, 0, 0, -u * X, -u * Y]);
    b.push(u);
    A.push([0, 0, 0, X, Y, 1, -v * X, -v * Y]);
    b.push(v);
  }
  const h = solveLinear(A, b);
  return [h[0]!, h[1]!, h[2]!, h[3]!, h[4]!, h[5]!, h[6]!, h[7]!, 1];
}

/** Gaussian elimination + back substitution. n=8 専用ではなく汎用。 */
function solveLinear(A: number[][], b: number[]): number[] {
  const n = A.length;
  const M: number[][] = A.map((row, i) => [...row, b[i]!]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    let pivotAbs = Math.abs(M[col]![col]!);
    for (let r = col + 1; r < n; r++) {
      const v = Math.abs(M[r]![col]!);
      if (v > pivotAbs) {
        pivot = r;
        pivotAbs = v;
      }
    }
    if (pivotAbs < 1e-12) throw new Error('singular linear system');
    if (pivot !== col) [M[col], M[pivot]] = [M[pivot]!, M[col]!];
    for (let r = col + 1; r < n; r++) {
      const factor = M[r]![col]! / M[col]![col]!;
      for (let c = col; c <= n; c++) M[r]![c]! -= factor * M[col]![c]!;
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = M[i]![n]!;
    for (let j = i + 1; j < n; j++) s -= M[i]![j]! * x[j]!;
    x[i] = s / M[i]![i]!;
  }
  return x;
}

/**
 * Homography 分解。
 * K^-1 @ H = lambda * [r1 | r2 | t]
 * 1) r1, r2 を正規化 (lambda = 1/|K^-1 H col0|)
 * 2) r2 を r1 と直交化 (Gram-Schmidt)
 * 3) r3 = r1 × r2
 * 4) t.z>0 になるよう sign補正 (marker が camera前方にある前提)
 */
export function decomposeHomography(H: number[], K: Intrinsics): Pose {
  const { fx, fy, cx, cy } = K;
  const Kinv = [
    1 / fx, 0,      -cx / fx,
    0,      1 / fy, -cy / fy,
    0,      0,       1,
  ];
  const M = mat3mul(Kinv, H);

  // M の列ベクトル
  const c0 = [M[0]!, M[3]!, M[6]!];
  const c1 = [M[1]!, M[4]!, M[7]!];
  const c2 = [M[2]!, M[5]!, M[8]!];

  let lambda = 1 / norm(c0);
  // t.z (= lambda * c2.z) が正になるよう sign
  if (lambda * c2[2]! < 0) lambda = -lambda;

  const r1 = scale(c0, lambda);
  let r2 = scale(c1, lambda);
  const t  = scale(c2, lambda) as [number, number, number];

  // r2 を r1 に直交化
  const dot12 = dot(r1, r2);
  r2 = sub(r2, scale(r1, dot12));
  const r2n = scale(r2, 1 / norm(r2));

  const r3 = cross(r1, r2n);

  // R = [r1 | r2 | r3] (列ベクトル) → row-major:
  return {
    R: [
      r1[0]!, r2n[0]!, r3[0]!,
      r1[1]!, r2n[1]!, r3[1]!,
      r1[2]!, r2n[2]!, r3[2]!,
    ],
    t,
  };
}

export function estimatePose(
  imageCorners: [Point2D, Point2D, Point2D, Point2D],
  frameWidth: number,
  frameHeight: number,
): Pose {
  const H = computeHomography(MARKER_CORNERS, imageCorners);
  const K = approxIntrinsics(frameWidth, frameHeight);
  return decomposeHomography(H, K);
}

// ----- 小helper -----

function mat3mul(A: number[], B: number[]): number[] {
  const C = new Array<number>(9).fill(0);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      for (let k = 0; k < 3; k++) C[i * 3 + j]! += A[i * 3 + k]! * B[k * 3 + j]!;
    }
  }
  return C;
}

function norm(v: number[]): number {
  return Math.hypot(v[0]!, v[1]!, v[2]!);
}

function dot(a: number[], b: number[]): number {
  return a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
}

function scale(v: number[], s: number): number[] {
  return [v[0]! * s, v[1]! * s, v[2]! * s];
}

function sub(a: number[], b: number[]): number[] {
  return [a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!];
}

function cross(a: number[], b: number[]): number[] {
  return [
    a[1]! * b[2]! - a[2]! * b[1]!,
    a[2]! * b[0]! - a[0]! * b[2]!,
    a[0]! * b[1]! - a[1]! * b[0]!,
  ];
}
