import { describe, expect, it } from "vitest";

import { resolveMeasurementInches } from "@/lib/sample-capture";
import { INITIAL_SAMPLE_STATE } from "@/types/sample";

describe("resolveMeasurementInches", () => {
  it("prefers the immutable raw capture when the display string still matches it", () => {
    const state = {
      ...INITIAL_SAMPLE_STATE,
      measurements: { ...INITIAL_SAMPLE_STATE.measurements, panel1: "12.02" },
      rawMeasurements: { panel1: { raw: 12.015625, dimensionStandard: "ID" as const } },
    };
    // 12.015625 rounds (toFixed(2)) to "12.02" -- unchanged since capture.
    expect(resolveMeasurementInches(state, "panel1")).toBe(12.015625);
  });

  it("prefers the typed value when the user has hand-edited the field since capture", () => {
    const state = {
      ...INITIAL_SAMPLE_STATE,
      measurements: { ...INITIAL_SAMPLE_STATE.measurements, panel1: "13" }, // user overwrote it
      rawMeasurements: { panel1: { raw: 12.015625, dimensionStandard: "ID" as const } },
    };
    expect(resolveMeasurementInches(state, "panel1")).toBe(13);
  });

  it("uses the typed value when there is no raw capture at all (hand-typed field)", () => {
    const state = {
      ...INITIAL_SAMPLE_STATE,
      measurements: { ...INITIAL_SAMPLE_STATE.measurements, panel2: "6 3/4" },
    };
    expect(resolveMeasurementInches(state, "panel2")).toBe(6.75);
  });

  it("returns null when the field is empty/unparseable", () => {
    expect(resolveMeasurementInches(INITIAL_SAMPLE_STATE, "panelD")).toBeNull();
  });
});
