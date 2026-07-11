/** Pure homography math for photo-based measurement against a letter-size sheet. */

export type Pt = { x: number; y: number };

export type Matrix3x3 = [
  [number, number, number],
  [number, number, number],
  [number, number, number],
];

export const LETTER_SHORT_IN = 8.5;
export const LETTER_LONG_IN = 11;

export class PhotoMeasureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PhotoMeasureError";
  }
}

const EPS = 1e-9;
const ASPECT_TOLERANCE = 0.15;

const WORLD_LANDSCAPE: Pt[] = [
  { x: 0, y: 0 },
  { x: LETTER_SHORT_IN, y: 0 },
  { x: LETTER_SHORT_IN, y: LETTER_LONG_IN },
  { x: 0, y: LETTER_LONG_IN },
];

const WORLD_PORTRAIT: Pt[] = [
  { x: 0, y: 0 },
  { x: LETTER_LONG_IN, y: 0 },
  { x: LETTER_LONG_IN, y: LETTER_SHORT_IN },
  { x: 0, y: LETTER_SHORT_IN },
];

function cross2d(a: Pt, b: Pt, c: Pt): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function dist(a: Pt, b: Pt): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function rotatePts(pts: Pt[], offset: number): Pt[] {
  const n = pts.length;
  return pts.map((_, i) => pts[(i + offset) % n]!);
}

/** Sort corners counter-clockwise by polar angle from the centroid. */
export function sortCornersByAngle(pts: Pt[]): Pt[] {
  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  return [...pts].sort((a, b) => {
    const aa = Math.atan2(a.y - cy, a.x - cx);
    const bb = Math.atan2(b.y - cy, b.x - cx);
    return aa - bb;
  });
}

/** True when three or more corners are nearly collinear. */
export function areCornersDegenerate(pts: Pt[]): boolean {
  if (pts.length < 4) return true;
  for (let i = 0; i < 4; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % 4]!;
    const c = pts[(i + 2) % 4]!;
    if (Math.abs(cross2d(a, b, c)) < EPS) return true;
  }
  const area =
    Math.abs(cross2d(pts[0]!, pts[1]!, pts[2]!) + cross2d(pts[0]!, pts[2]!, pts[3]!)) / 2;
  return area < EPS;
}

function solveLinearSystem(a: number[][], b: number[]): number[] {
  const n = b.length;
  const aug = a.map((row, i) => [...row, b[i]!]);

  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(aug[row]![col]!) > Math.abs(aug[pivot]![col]!)) pivot = row;
    }
    if (Math.abs(aug[pivot]![col]!) < EPS) {
      throw new PhotoMeasureError(
        "corners don't form a rectangle — re-tap",
      );
    }
    if (pivot !== col) {
      [aug[col], aug[pivot]] = [aug[pivot]!, aug[col]!];
    }
    const div = aug[col]![col]!;
    for (let j = col; j <= n; j++) aug[col]![j]! /= div;
    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = aug[row]![col]!;
      for (let j = col; j <= n; j++) aug[row]![j]! -= factor * aug[col]![j]!;
    }
  }
  return aug.map((row) => row[n]!);
}

function normalizeH(h: Matrix3x3): Matrix3x3 {
  const scale = h[2][2] !== 0 ? h[2][2] : h[2][0] + h[2][1] + h[1][2];
  if (Math.abs(scale) < EPS) {
    throw new PhotoMeasureError("corners don't form a rectangle — re-tap");
  }
  return h.map((row) => row.map((v) => v / scale)) as Matrix3x3;
}

function isValidH(h: Matrix3x3): boolean {
  return h.every((row) => row.every((v) => Number.isFinite(v)));
}

/**
 * Direct linear transform: maps image pixels to world inches.
 * `imagePts[i]` corresponds to `worldPts[i]`.
 */
export function computeHomography(imagePts: Pt[], worldPts: Pt[]): Matrix3x3 {
  if (imagePts.length !== 4 || worldPts.length !== 4) {
    throw new PhotoMeasureError("exactly four corner points are required");
  }
  if (areCornersDegenerate(imagePts)) {
    throw new PhotoMeasureError("corners don't form a rectangle — re-tap");
  }

  const a: number[][] = [];
  const rhs: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = imagePts[i]!;
    const { x: u, y: v } = worldPts[i]!;
    a.push([x, y, 1, 0, 0, 0, -x * u, -y * u]);
    rhs.push(u);
    a.push([0, 0, 0, x, y, 1, -x * v, -y * v]);
    rhs.push(v);
  }

  const sol = solveLinearSystem(a, rhs);
  const h: Matrix3x3 = [
    [sol[0]!, sol[1]!, sol[2]!],
    [sol[3]!, sol[4]!, sol[5]!],
    [sol[6]!, sol[7]!, 1],
  ];
  const normalized = normalizeH(h);
  if (!isValidH(normalized)) {
    throw new PhotoMeasureError("corners don't form a rectangle — re-tap");
  }
  return normalized;
}

export function applyHomography(h: Matrix3x3, pt: Pt): Pt {
  const w = h[2][0] * pt.x + h[2][1] * pt.y + h[2][2];
  if (Math.abs(w) < EPS) {
    throw new PhotoMeasureError("corners don't form a rectangle — re-tap");
  }
  return {
    x: (h[0][0] * pt.x + h[0][1] * pt.y + h[0][2]) / w,
    y: (h[1][0] * pt.x + h[1][1] * pt.y + h[1][2]) / w,
  };
}

export function distanceInches(h: Matrix3x3, ptA: Pt, ptB: Pt): number {
  const a = applyHomography(h, ptA);
  const b = applyHomography(h, ptB);
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function edgeMatchesSheet(edgeInches: number): boolean {
  return (
    Math.abs(edgeInches - LETTER_SHORT_IN) <= ASPECT_TOLERANCE ||
    Math.abs(edgeInches - LETTER_LONG_IN) <= ASPECT_TOLERANCE
  );
}

function quadCenter(pts: Pt[]): Pt {
  return {
    x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
    y: pts.reduce((s, p) => s + p.y, 0) / pts.length,
  };
}

function scoreCandidate(h: Matrix3x3, imagePts: Pt[], worldPts: Pt[]): number {
  const e0 = distanceInches(h, imagePts[0]!, imagePts[1]!);
  const e1 = distanceInches(h, imagePts[1]!, imagePts[2]!);
  if (!edgeMatchesSheet(e0) || !edgeMatchesSheet(e1)) return Infinity;

  const mappedCenter = applyHomography(h, quadCenter(imagePts));
  const centerErr = dist(mappedCenter, quadCenter(worldPts));

  const edgeErr = Math.min(
    Math.abs(e0 - LETTER_SHORT_IN) + Math.abs(e1 - LETTER_LONG_IN),
    Math.abs(e0 - LETTER_LONG_IN) + Math.abs(e1 - LETTER_SHORT_IN),
  );
  return edgeErr + centerErr * 2;
}

/**
 * Orientation- and order-agnostic homography from four tapped sheet corners.
 */
export function computeHomographyFromCorners(imagePts: Pt[]): Matrix3x3 {
  if (imagePts.length !== 4) {
    throw new PhotoMeasureError("exactly four corner points are required");
  }
  if (areCornersDegenerate(imagePts)) {
    throw new PhotoMeasureError("corners don't form a rectangle — re-tap");
  }

  const sorted = sortCornersByAngle(imagePts) as Pt[];
  const worldLayouts = [WORLD_LANDSCAPE, WORLD_PORTRAIT];

  let best: { h: Matrix3x3; score: number } | null = null;

  for (let rot = 0; rot < 4; rot++) {
    const rotated = rotatePts(sorted, rot) as Pt[];
    for (const world of worldLayouts) {
      try {
        const h = computeHomography(rotated, world);
        const score = scoreCandidate(h, rotated, world);
        if (!Number.isFinite(score) || score === Infinity) continue;
        if (!best || score < best.score) best = { h, score };
      } catch {
        // try next assignment
      }
    }
  }

  if (!best) {
    throw new PhotoMeasureError("corners don't form a rectangle — re-tap");
  }
  return best.h;
}

/** Sanity-check calibration after four corners are placed. */
export function validateCalibration(h: Matrix3x3, imageCorners: Pt[]): void {
  if (!isValidH(h) || areCornersDegenerate(imageCorners)) {
    throw new PhotoMeasureError("corners don't form a rectangle — re-tap");
  }
  const sorted = sortCornersByAngle(imageCorners) as Pt[];
  const e0 = distanceInches(h, sorted[0]!, sorted[1]!);
  const e1 = distanceInches(h, sorted[1]!, sorted[2]!);
  if (!edgeMatchesSheet(e0) || !edgeMatchesSheet(e1)) {
    throw new PhotoMeasureError(
      "corners don't look like a letter-size sheet — re-tap",
    );
  }
}

/** Project a world point through a 3×3 matrix (world → image). Used in tests. */
export function projectPoint(m: Matrix3x3, pt: Pt): Pt {
  const w = m[2][0] * pt.x + m[2][1] * pt.y + m[2][2];
  return {
    x: (m[0][0] * pt.x + m[0][1] * pt.y + m[0][2]) / w,
    y: (m[1][0] * pt.x + m[1][1] * pt.y + m[1][2]) / w,
  };
}

/** Invert a 3×3 homography. */
export function invertMatrix3x3(m: Matrix3x3): Matrix3x3 {
  const [
    [a, b, c],
    [d, e, f],
    [g, h, i],
  ] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const D = -(b * i - c * h);
  const E = a * i - c * g;
  const F = -(a * h - b * g);
  const G = b * f - c * e;
  const H = -(a * f - c * d);
  const I = a * e - b * d;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < EPS) {
    throw new PhotoMeasureError("corners don't form a rectangle — re-tap");
  }
  const inv = [
    [A / det, D / det, G / det],
    [B / det, E / det, H / det],
    [C / det, F / det, I / det],
  ] as Matrix3x3;
  return inv;
}
