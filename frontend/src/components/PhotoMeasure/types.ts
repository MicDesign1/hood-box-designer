import type { Point, ReferenceId } from "@/lib/photo-calibration";

/** One dimension this measurement session should collect. `key` is caller-defined
 * (e.g. "length" | "width" | "height" for Design Mode, or "panelD" | "panel1" |
 * "panel2" for Price a Sample) — PhotoMeasureSession has no built-in notion of
 * what the keys mean, it just walks the list and reports back per-key. */
export interface DimensionField {
  key: string;
  label: string;
  hint?: string;
}

export interface PhotoCalibrationCapture {
  imageUrl: string;
  imageWidth: number;
  imageHeight: number;
  refId: ReferenceId;
  calPoints: Point[];
  customLengthInches: number | null;
}

export interface PhotoSegment {
  ptA: Point;
  ptB: Point;
  /** Full-precision measured distance in inches — no rounding applied here.
   * Callers decide their own storage/display rounding policy. */
  inches: number;
}

export type LockedMeasurement = { inches: number; segment: PhotoSegment };

export interface PhotoMeasureSessionProps {
  dimensions: DimensionField[];
  /** "embedded" = inline panel (Design Mode); "overlay" = fullscreen modal (Price a Sample). */
  presentation: "embedded" | "overlay";
  /** Reuse a calibration from a prior session (e.g. re-measuring another field
   * without re-photographing). Null/undefined starts fresh. */
  initialCalibration?: PhotoCalibrationCapture | null;
  /** Model-proposed starting points for dots (Phase 4 hook). Always {} through
   * Phase 3 — dots always start unplaced until the user taps or a future
   * proposal fills them in as adjustable, never auto-locked, starting points. */
  initialProposedPoints?: Partial<Record<string, [Point, Point]>>;
  /** Fires once per dimension, only when the user explicitly locks it in —
   * never on second-dot placement alone. */
  onLockDimension: (key: string, result: LockedMeasurement) => void;
  /** Fires whenever a valid calibration is computed, so the caller can persist
   * it (e.g. to reuse across a later session without re-photographing). */
  onCalibrationChange: (calibration: PhotoCalibrationCapture) => void;
  /** Fires once every field in `dimensions` has been locked and the user
   * confirms. */
  onComplete: (locked: Record<string, LockedMeasurement>) => void;
  onCancel: () => void;
}
