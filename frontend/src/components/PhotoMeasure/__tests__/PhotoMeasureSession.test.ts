import { describe, expect, it } from "vitest";

import { deriveLockedMeasurements } from "@/components/PhotoMeasure/PhotoMeasureSession";
import type { CaptureMarker } from "@/types/capture";

const PT_A = { x: 0, y: 0 };
const PT_B = { x: 100, y: 0 };

/**
 * Structural/negative test (Phase 3 gate): `deriveLockedMeasurements` is the
 * ONLY function that produces the `Record<string, LockedMeasurement>`
 * payload every downstream consumer reads -- `onComplete`, `onLockDimension`,
 * and from there `buildSolvePayload` (sample-wizard.tsx) and
 * `dimsFromLockedMeasurements` (photo-mode.tsx), which is what ultimately
 * reaches SolveRequest/BoxSpecPayload. Proving a reference-role marker never
 * produces a key here proves it structurally cannot reach either payload,
 * not merely that it currently doesn't.
 */
describe("deriveLockedMeasurements (reference-role leakage guard)", () => {
  it("a reference-role marker never appears under any key, even mixed with real dimension/panel markers", () => {
    const markers: CaptureMarker[] = [
      { id: "m1", ptA: PT_A, ptB: PT_B, rawInches: 12, role: { kind: "dimension", axis: "length" }, keep: true },
      { id: "m2", ptA: PT_A, ptB: PT_B, rawInches: 8, role: { kind: "panel", panelField: "panel1" }, keep: true },
      { id: "m3", ptA: PT_A, ptB: PT_B, rawInches: 6, role: { kind: "reference", label: "Ruler length" }, keep: true },
    ];

    const locked = deriveLockedMeasurements(markers);

    expect(Object.keys(locked).sort()).toEqual(["length", "panel1"]);
    expect(Object.values(locked).some((v) => v.inches === 6)).toBe(false);
  });

  it("a reference marker's label cannot masquerade as a real key, even when it collides with one", () => {
    const markers: CaptureMarker[] = [
      { id: "m1", ptA: PT_A, ptB: PT_B, rawInches: 999, role: { kind: "reference", label: "length" }, keep: true },
    ];

    const locked = deriveLockedMeasurements(markers);

    expect(locked).toEqual({});
    expect(locked.length).toBeUndefined();
  });

  it("excludes un-kept markers regardless of role", () => {
    const markers: CaptureMarker[] = [
      { id: "m1", ptA: PT_A, ptB: PT_B, rawInches: 12, role: { kind: "dimension", axis: "length" }, keep: false },
    ];
    expect(deriveLockedMeasurements(markers)).toEqual({});
  });

  it("excludes provisional (role === null) markers", () => {
    const markers: CaptureMarker[] = [{ id: "m1", ptA: PT_A, ptB: PT_B, rawInches: 12, role: null, keep: true }];
    expect(deriveLockedMeasurements(markers)).toEqual({});
  });
});
