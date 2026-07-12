import { describe, expect, it } from "vitest";

import { buildSolvePayload } from "@/components/sample/sample-wizard";
import { INITIAL_SAMPLE_STATE, type SampleWizardState } from "@/types/sample";

function rscState(overrides: Partial<SampleWizardState> = {}): SampleWizardState {
  return {
    ...INITIAL_SAMPLE_STATE,
    style: "rsc",
    joint: "taped",
    flute: "C",
    ...overrides,
  };
}

describe("buildSolvePayload (Sample flow solver input sourcing)", () => {
  it("sends the full-precision raw capture, not the rounded display string, when the field came from a photo", () => {
    const state = rscState({
      measurements: {
        ...INITIAL_SAMPLE_STATE.measurements,
        panelD: "5.94", // .toFixed(2) of the raw capture below
        panel1: "12.02",
        panel2: "8.03",
      },
      rawMeasurements: {
        panelD: { raw: 5.9375, dimensionStandard: "ID" },
        panel1: { raw: 12.015625, dimensionStandard: "ID" },
        panel2: { raw: 8.03125, dimensionStandard: "ID" },
      },
    });

    const payload = buildSolvePayload(state);

    expect(payload).not.toBeNull();
    expect(payload!.panel_d).toBe(5.9375);
    expect(payload!.panel_1).toBe(12.015625);
    expect(payload!.panel_2).toBe(8.03125);
  });

  it("sends the typed value when the user hand-edited a field after it was photo-captured", () => {
    const state = rscState({
      measurements: {
        ...INITIAL_SAMPLE_STATE.measurements,
        panelD: "6.5", // user typed over the captured value
        panel1: "12.02",
        panel2: "8.03",
      },
      rawMeasurements: {
        panelD: { raw: 5.9375, dimensionStandard: "ID" }, // stale -- must not win
        panel1: { raw: 12.015625, dimensionStandard: "ID" },
        panel2: { raw: 8.03125, dimensionStandard: "ID" },
      },
    });

    const payload = buildSolvePayload(state);

    expect(payload!.panel_d).toBe(6.5);
  });

  it("sends the typed value for hand-typed-only fields (no raw capture exists)", () => {
    const state = rscState({
      measurements: {
        ...INITIAL_SAMPLE_STATE.measurements,
        panelD: "5 15/16",
        panel1: "12 1/64",
        panel2: "8 1/32",
      },
    });

    const payload = buildSolvePayload(state);

    expect(payload!.panel_d).toBeCloseTo(5.9375, 10);
    expect(payload!.panel_1).toBeCloseTo(12.015625, 10);
    expect(payload!.panel_2).toBeCloseTo(8.03125, 10);
  });

  it("still returns null when required fields are missing, unchanged from before", () => {
    expect(buildSolvePayload(rscState())).toBeNull();
  });
});
