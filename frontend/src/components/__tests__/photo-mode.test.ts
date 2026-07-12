import { describe, expect, it } from "vitest";

import { dimsFromLockedMeasurements } from "@/components/photo-mode";
import type { LockedMeasurement } from "@/components/PhotoMeasure/types";

function locked(inches: number): LockedMeasurement {
  return { inches, segment: { ptA: { x: 0, y: 0 }, ptB: { x: 100, y: 0 }, inches } };
}

describe("dimsFromLockedMeasurements (Design flow raw-precision storage)", () => {
  it("passes full-precision inches through unrounded -- no snapToSixteenth or any other rounding", () => {
    const dims = dimsFromLockedMeasurements({
      length: locked(12.015625001),
      width: locked(8.03124999),
      height: locked(5.999996),
    });
    expect(dims).toEqual({ length: 12.015625001, width: 8.03124999, height: 5.999996 });
  });

  it("returns null if any of length/width/height is missing", () => {
    expect(dimsFromLockedMeasurements({ length: locked(12), width: locked(8) })).toBeNull();
    expect(dimsFromLockedMeasurements({})).toBeNull();
  });
});
