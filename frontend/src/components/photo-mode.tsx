"use client";

import { PhotoMeasureSession } from "@/components/PhotoMeasure/PhotoMeasureSession";
import type { DimensionField } from "@/components/PhotoMeasure/types";
import { snapToSixteenth } from "@/lib/photo-calibration";

export interface PhotoModeProps {
  onApplyMeasurements: (dims: { length: number; width: number; height: number }) => void;
}

const DIMENSIONS: DimensionField[] = [
  { key: "length", label: "Length" },
  { key: "width", label: "Width" },
  { key: "height", label: "Height" },
];

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
          onApplyMeasurements({
            length: snapToSixteenth(locked.length!.inches),
            width: snapToSixteenth(locked.width!.inches),
            height: snapToSixteenth(locked.height!.inches),
          });
        }}
      />
    </main>
  );
}
