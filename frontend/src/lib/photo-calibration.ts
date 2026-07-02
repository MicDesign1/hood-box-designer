/** Scale calibration + measurement math for Photo Mode, in image-pixel coordinates. */

export interface Point {
  x: number;
  y: number;
}

export type ReferenceId = "poker" | "credit" | "custom";

export interface ReferenceObject {
  id: ReferenceId;
  label: string;
  /** [width, height] in inches, or null for "custom known length". */
  dimensions: [number, number] | null;
}

export const REFERENCE_OBJECTS: ReferenceObject[] = [
  { id: "poker", label: "Poker playing card", dimensions: [2.5, 3.5] },
  { id: "credit", label: "Credit card (ID-1)", dimensions: [3.37, 2.125] },
  { id: "custom", label: "Known length (2 points)", dimensions: null },
];

export const CORNER_ORDER = ["top-left", "top-right", "bottom-right", "bottom-left"] as const;

export function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function requiredCalPoints(refId: ReferenceId): number {
  return refId === "custom" ? 2 : 4;
}

/**
 * Returns pixels-per-inch from calibration points, or null if not enough
 * points are placed yet. For card references, corners are expected in
 * order (top-left, top-right, bottom-right, bottom-left) but the width/
 * height assignment is resolved by matching the longer/shorter measured
 * side to the longer/shorter reference side, so exact orientation doesn't
 * have to be perfect.
 */
export function computeScale(
  refId: ReferenceId,
  calPoints: Point[],
  customLengthInches: number | null,
): number | null {
  if (refId === "custom") {
    if (calPoints.length < 2 || !customLengthInches || customLengthInches <= 0) return null;
    return dist(calPoints[0], calPoints[1]) / customLengthInches;
  }

  const ref = REFERENCE_OBJECTS.find((r) => r.id === refId);
  if (!ref?.dimensions || calPoints.length < 4) return null;

  const [p0, p1, p2, p3] = calPoints;
  const widthPx = (dist(p0, p1) + dist(p3, p2)) / 2;
  const heightPx = (dist(p0, p3) + dist(p1, p2)) / 2;
  const [refW, refH] = ref.dimensions;

  const scaleFromLongSide = Math.max(widthPx, heightPx) / Math.max(refW, refH);
  const scaleFromShortSide = Math.min(widthPx, heightPx) / Math.min(refW, refH);
  if (!(scaleFromLongSide > 0) || !(scaleFromShortSide > 0)) return null;

  return (scaleFromLongSide + scaleFromShortSide) / 2;
}

/** Snaps a measured value to the nearest 1/16" — matches how a tape measure reads. */
export function snapToSixteenth(inches: number): number {
  return Math.round(inches / 0.0625) * 0.0625;
}
