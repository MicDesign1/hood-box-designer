import type { LockedMeasurement } from "@/components/PhotoMeasure/types";
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

export const MEASUREMENT_FIELD_LABELS: Record<keyof SampleMeasurements, string> = {
  panelD: "Height panel",
  panel1: "First panel width",
  panel2: "Second panel width",
  blankWidth: "Blank width",
  blankHeight: "Blank height",
  flapHeight: "Flap height",
};
