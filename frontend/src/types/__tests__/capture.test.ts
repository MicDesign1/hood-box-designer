import { describe, expect, it } from "vitest";

import { referenceDimensions, roleEquals, roleLookupKey, type CaptureMarker, type CaptureRole, type CaptureSession } from "@/types/capture";

const PT = { x: 0, y: 0 };

function marker(overrides: Partial<CaptureMarker> & { role: CaptureRole | null }): CaptureMarker {
  return { id: "m1", ptA: PT, ptB: PT, rawInches: 5, keep: true, ...overrides };
}

function session(markers: CaptureMarker[], method: CaptureSession["method"] = "direct"): CaptureSession {
  return { id: "s1", method, calibration: null, markers, flute: null, caliper: null, capturedAt: "" };
}

describe("roleLookupKey (structural leakage guard, Phase 3 gate)", () => {
  it("returns the axis for a dimension role", () => {
    expect(roleLookupKey({ kind: "dimension", axis: "length" })).toBe("length");
  });

  it("returns the panel field for a panel role", () => {
    expect(roleLookupKey({ kind: "panel", panelField: "panelD" })).toBe("panelD");
  });

  it("returns null for a reference role -- unconditionally, never reading .label", () => {
    expect(roleLookupKey({ kind: "reference", label: "Ruler length" })).toBeNull();
  });

  it("returns null even when a reference marker's label collides with a real axis/panel key", () => {
    // The concern the audit flagged: a user could name a reference marker
    // "length" or "panelD" -- roleLookupKey must not be fooled by that text
    // into producing a real key, because it never reads .label at all.
    expect(roleLookupKey({ kind: "reference", label: "length" })).toBeNull();
    expect(roleLookupKey({ kind: "reference", label: "panelD" })).toBeNull();
  });
});

describe("roleEquals", () => {
  it("treats two reference roles as never equal, even with the same label", () => {
    const a: CaptureRole = { kind: "reference", label: "Ruler length" };
    const b: CaptureRole = { kind: "reference", label: "Ruler length" };
    expect(roleEquals(a, b)).toBe(false);
  });

  it("treats matching dimension axes as equal (exclusivity guard)", () => {
    expect(roleEquals({ kind: "dimension", axis: "length" }, { kind: "dimension", axis: "length" })).toBe(true);
  });
});

describe("referenceDimensions", () => {
  it("only surfaces kept reference-role markers, with their label and raw value", () => {
    const s = session([
      marker({ id: "m1", role: { kind: "dimension", axis: "length" }, rawInches: 12 }),
      marker({ id: "m2", role: { kind: "reference", label: "Ruler length" }, rawInches: 6, keep: true }),
      marker({ id: "m3", role: { kind: "reference", label: "Not kept" }, rawInches: 3, keep: false }),
      marker({ id: "m4", role: null, rawInches: 9 }), // provisional, never reaches here in practice
    ]);
    expect(referenceDimensions(s)).toEqual([{ label: "Ruler length", rawInches: 6 }]);
  });
});
