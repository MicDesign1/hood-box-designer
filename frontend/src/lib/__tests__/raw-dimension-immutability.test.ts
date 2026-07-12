import { describe, expect, it } from "vitest";

import type { LockedMeasurement } from "@/components/PhotoMeasure/types";
import { applyPhotoLock } from "@/lib/sample-capture";
import { INITIAL_SAMPLE_STATE } from "@/types/sample";

function capture(inches: number): LockedMeasurement {
  return {
    inches,
    segment: { ptA: { x: 10, y: 10 }, ptB: { x: 240, y: 10 }, inches },
  };
}

describe("raw dimension immutability", () => {
  it("preserves the exact captured value through repeated state updates, unaffected by display rounding", () => {
    const captured = capture(5.937499999999);

    let state = applyPhotoLock(INITIAL_SAMPLE_STATE, "panelD", captured);

    // the raw store holds the exact captured value -- not the rounded
    // 2-decimal string used for the editable form field
    expect(state.rawMeasurements.panelD?.raw).toBe(captured.inches);
    expect(state.measurements.panelD).toBe("5.94");

    // hand-editing the display field afterward (the user can type over it
    // in the form) must never reach back into the raw record
    state = { ...state, measurements: { ...state.measurements, panelD: "6" } };
    expect(state.rawMeasurements.panelD?.raw).toBe(captured.inches);

    // locking a second, different field must not disturb the first one's
    // raw value
    const second = capture(12.01);
    state = applyPhotoLock(state, "panel1", second);
    expect(state.rawMeasurements.panelD?.raw).toBe(captured.inches);
    expect(state.rawMeasurements.panel1?.raw).toBe(second.inches);

    // re-locking panelD (re-measuring the same field) overwrites only that
    // field's raw record with the new capture -- it doesn't silently round
    // or blend with the prior value
    const remeasured = capture(6.0001);
    state = applyPhotoLock(state, "panelD", remeasured);
    expect(state.rawMeasurements.panelD?.raw).toBe(remeasured.inches);
    expect(state.rawMeasurements.panel1?.raw).toBe(second.inches);
  });

  it("tags every captured field with the session's dimensionStandard, defaulting to ID", () => {
    expect(INITIAL_SAMPLE_STATE.dimensionStandard).toBe("ID");

    const state = applyPhotoLock(INITIAL_SAMPLE_STATE, "panel2", capture(8.125));
    expect(state.rawMeasurements.panel2?.dimensionStandard).toBe("ID");

    const odState = applyPhotoLock(
      { ...INITIAL_SAMPLE_STATE, dimensionStandard: "OD" },
      "panel2",
      capture(8.125),
    );
    expect(odState.rawMeasurements.panel2?.dimensionStandard).toBe("OD");
  });

  it("never mutates the original state object (no shared references, no in-place writes)", () => {
    const before = INITIAL_SAMPLE_STATE;
    const beforeMeasurementsRef = before.measurements;
    const beforeRawRef = before.rawMeasurements;

    applyPhotoLock(before, "panelD", capture(4.5));

    expect(before.measurements).toBe(beforeMeasurementsRef);
    expect(before.rawMeasurements).toBe(beforeRawRef);
    expect(before.measurements.panelD).toBe("");
    expect(Object.keys(before.rawMeasurements)).toHaveLength(0);
  });
});
