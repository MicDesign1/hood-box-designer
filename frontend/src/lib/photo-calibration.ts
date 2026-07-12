/** Reference-object calibration for Photo Mode, in image-pixel coordinates. */

import { computeHomography, distanceInches, type Matrix3x3 } from "@/lib/photoMeasure";

export interface Point {
  x: number;
  y: number;
}

export type ReferenceId = "sheet" | "a4" | "poker" | "credit" | "custom";

export interface ReferenceObject {
  id: ReferenceId;
  label: string;
  /** [width, height] in inches, or null for "custom known length". */
  dimensions: [number, number] | null;
}

export const REFERENCE_OBJECTS: ReferenceObject[] = [
  { id: "sheet", label: "Letter-size sheet (8.5 × 11 in)", dimensions: [8.5, 11] },
  { id: "a4", label: "A4 sheet (210 × 297 mm)", dimensions: [8.268, 11.693] },
  { id: "poker", label: "Poker playing card", dimensions: [2.5, 3.5] },
  { id: "credit", label: "Credit card (ID-1)", dimensions: [3.37, 2.125] },
  { id: "custom", label: "Known length (2 points)", dimensions: null },
];

/** Reference IDs that are automatic-paper-detection candidates (rectangular sheets, not cards/custom). */
export const PAPER_REFERENCE_IDS: ReferenceId[] = ["sheet", "a4"];

export const CORNER_ORDER = ["top-left", "top-right", "bottom-right", "bottom-left"] as const;

export type Calibration =
  | { kind: "homography"; matrix: Matrix3x3 }
  | { kind: "scale"; pxPerInch: number };

export function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function requiredCalPoints(refId: ReferenceId): number {
  return refId === "custom" ? 2 : 4;
}

/**
 * Builds a calibration from tapped points, or null if not enough points are
 * placed yet. Rectangular references (sheet, cards) go through the tested
 * 4-point homography engine (`computeHomography`), which perspective-corrects
 * the whole photo rather than just deriving a single px/inch scale — corners
 * are expected in order (top-left, top-right, bottom-right, bottom-left),
 * with the object's long/short side matched to whichever measured side is
 * longer so exact physical orientation doesn't have to be guessed. "Known
 * length" stays a simple two-point scale.
 */
export function computeCalibration(
  refId: ReferenceId,
  calPoints: Point[],
  customLengthInches: number | null,
): Calibration | null {
  if (refId === "custom") {
    if (calPoints.length < 2 || !customLengthInches || customLengthInches <= 0) return null;
    const px = dist(calPoints[0], calPoints[1]);
    if (!(px > 0)) return null;
    return { kind: "scale", pxPerInch: px / customLengthInches };
  }

  const ref = REFERENCE_OBJECTS.find((r) => r.id === refId);
  if (!ref?.dimensions || calPoints.length < 4) return null;

  const [p0, p1, p2, p3] = calPoints;
  const widthPx = (dist(p0, p1) + dist(p3, p2)) / 2;
  const heightPx = (dist(p0, p3) + dist(p1, p2)) / 2;
  const long = Math.max(...ref.dimensions);
  const short = Math.min(...ref.dimensions);
  const worldW = widthPx >= heightPx ? long : short;
  const worldH = widthPx >= heightPx ? short : long;

  const worldPts: Point[] = [
    { x: 0, y: 0 },
    { x: worldW, y: 0 },
    { x: worldW, y: worldH },
    { x: 0, y: worldH },
  ];

  try {
    const matrix = computeHomography(calPoints, worldPts);
    return { kind: "homography", matrix };
  } catch {
    return null;
  }
}

export function measureInches(calibration: Calibration, a: Point, b: Point): number {
  if (calibration.kind === "scale") return dist(a, b) / calibration.pxPerInch;
  return distanceInches(calibration.matrix, a, b);
}

/** Snaps a measured value to the nearest 1/16" — matches how a tape measure reads. */
export function snapToSixteenth(inches: number): number {
  return Math.round(inches / 0.0625) * 0.0625;
}
