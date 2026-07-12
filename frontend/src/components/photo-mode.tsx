"use client";

import { PhotoMeasureSession } from "@/components/PhotoMeasure/PhotoMeasureSession";
import type { DimensionField, LockedMeasurement } from "@/components/PhotoMeasure/types";

export interface PhotoModeProps {
  onApplyMeasurements: (dims: { length: number; width: number; height: number }) => void;
}

const DIMENSIONS: DimensionField[] = [
  { key: "length", label: "Length" },
  { key: "width", label: "Width" },
  { key: "height", label: "Height" },
];

/**
 * Full precision straight through -- no rounding here. `locked[key].inches`
 * is already the immutable raw capture (see PhotoMeasureSession/CaptureMarker),
 * and this must reach BoxSpec unrounded: display-only rounding happens in
 * design-mode.tsx's own formatting (formatInches/formatFractionInches),
 * which reads from BoxSpec but never mutates it. Returns null if the
 * session completed without all three (shouldn't happen -- the "Use these
 * measurements" button is disabled until it does -- but this function
 * doesn't trust that from the outside).
 */
export function dimsFromLockedMeasurements(
  locked: Record<string, LockedMeasurement>,
): { length: number; width: number; height: number } | null {
  const { length, width, height } = locked;
  if (!length || !width || !height) return null;
  return { length: length.inches, width: width.inches, height: height.inches };
}

export function PhotoMode({ onApplyMeasurements }: PhotoModeProps) {
  return (
    <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <PhotoMeasureSession
        dimensions={DIMENSIONS}
        presentation="embedded"
        onLockDimension={() => {}}
        onCalibrationChange={() => {}}
        onCancel={() => {}}
        onComplete={(locked) => {
          const dims = dimsFromLockedMeasurements(locked);
          if (dims) onApplyMeasurements(dims);
        }}
      />
    </main>
  );
}
