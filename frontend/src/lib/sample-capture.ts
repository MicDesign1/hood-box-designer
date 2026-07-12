import type { LockedMeasurement } from "@/components/PhotoMeasure/types";
import { parseImperialInput } from "@/lib/imperial";
import type { SampleMeasurements, SampleWizardState } from "@/types/sample";

/**
 * Merges a locked photo measurement into wizard state. The raw, full-precision
 * captured value is written once into `rawMeasurements` and never touched
 * again by any later update; `measurements` holds a separate, rounded,
 * user-editable display string derived from it at the moment of capture.
 * Editing the display field afterward (the user can type over it in the
 * form) never reaches back into `rawMeasurements`.
 */
export function applyPhotoLock(
  state: SampleWizardState,
  field: keyof SampleMeasurements,
  result: LockedMeasurement,
): SampleWizardState {
  return {
    ...state,
    measurements: { ...state.measurements, [field]: result.inches.toFixed(2) },
    rawMeasurements: {
      ...state.rawMeasurements,
      [field]: { raw: result.inches, dimensionStandard: state.dimensionStandard },
    },
  };
}

// The display string is stored as `.toFixed(2)`, so re-parsing it can differ
// from the original raw capture by up to 0.005 (half the smallest step at 2
// decimals) even when the user hasn't touched it. Anything beyond that means
// the user edited the field since it was captured.
const DISPLAY_ROUND_TOLERANCE_IN = 0.006;

/**
 * The value the solver should actually receive for a field: the immutable
 * full-precision raw capture (`rawMeasurements[field].raw`), if the current
 * display string still matches what was captured -- i.e. the user hasn't
 * hand-edited it since. If the string has diverged (the user typed over a
 * photo-captured value) or there was never a raw capture (the field was
 * always hand-typed), the typed value wins -- a hand-typed string is
 * already the ground truth and must never be silently overridden by a
 * stale raw capture.
 */
export function resolveMeasurementInches(
  state: Pick<SampleWizardState, "measurements" | "rawMeasurements">,
  field: keyof SampleMeasurements,
): number | null {
  const typed = parseImperialInput(state.measurements[field]);
  const raw = state.rawMeasurements[field];
  if (raw != null && typed != null && Math.abs(raw.raw - typed) < DISPLAY_ROUND_TOLERANCE_IN) {
    return raw.raw;
  }
  return typed;
}

export const MEASUREMENT_FIELD_LABELS: Record<keyof SampleMeasurements, string> = {
  panelD: "Height panel",
  panel1: "First panel width",
  panel2: "Second panel width",
  blankWidth: "Blank width",
  blankHeight: "Blank height",
  flapHeight: "Flap height",
};
