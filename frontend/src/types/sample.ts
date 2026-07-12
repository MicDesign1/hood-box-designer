/** Types for the /sample salesperson flow. */

export type SampleStyle = "rsc" | "hsc" | "tube";

export type SampleFlute = "B" | "C" | "BC";

export type SampleStep = "style" | "joint" | "flute" | "measurements" | "result";

export type SampleJoint = "taped" | "glued";

export type SolveConfidence = "high" | "medium" | "low" | "ambiguous";

export interface SampleMeasurements {
  panelD: string;
  panel1: string;
  panel2: string;
  blankWidth: string;
  blankHeight: string;
  flapHeight: string;
}

export type DimensionStandard = "ID" | "OD";

export interface RawMeasurement {
  /** Full-precision inches exactly as measured from the photo — immutable
   * once captured. Never rounded, snapped, or padded; the `measurements`
   * string fields above are a separate, display/editable derivation. */
  raw: number;
  dimensionStandard: DimensionStandard;
}

export interface SolveResponse {
  style: SampleStyle;
  flute: string;
  joint: "taped" | "glued";
  joint_label: string;
  tab_width: number;
  L: number;
  W: number;
  D: number;
  outside_L?: number;
  outside_W?: number;
  outside_D?: number;
  predicted_blank_w: number;
  predicted_blank_h: number;
  predicted_scores_x: number[];
  predicted_scores_y: number[];
  rms_error_in: number;
  confidence: SolveConfidence;
  rotated: boolean;
  reason?: string;
  suggested_input?: string;
  warning?: string;
  runner_up?: Record<string, unknown>;
}

export interface SampleWizardState {
  step: SampleStep;
  style: SampleStyle | null;
  joint: SampleJoint | null;
  /** Tube only: false = liner (no seam), true = tube with seam. */
  hasSeam: boolean | null;
  flute: SampleFlute | null;
  measurements: SampleMeasurements;
  /** Immutable raw capture per field, keyed the same as `measurements`.
   * Populated only for fields measured from a photo; hand-typed fields have
   * no raw record since the typed string is already the ground truth. */
  rawMeasurements: Partial<Record<keyof SampleMeasurements, RawMeasurement>>;
  /**
   * TODO(owner): confirm this default. This flow measures panel creases,
   * which the solver converts to inside dimensions (solver.py
   * _depth_from_panel_d / _length_from_panel_width use panel-to-crease
   * allowance subtraction), so "ID" matches how this flow actually measures
   * today. Surfaced as a toggle at capture time in case a given sample is
   * measured against outside faces instead.
   */
  dimensionStandard: DimensionStandard;
  extraMeasurement: string;
  solveResult: SolveResponse | null;
  displayLabel: string | null;
}

export const INITIAL_SAMPLE_STATE: SampleWizardState = {
  step: "style",
  style: null,
  joint: null,
  hasSeam: null,
  flute: null,
  measurements: {
    panelD: "",
    panel1: "",
    panel2: "",
    blankWidth: "",
    blankHeight: "",
    flapHeight: "",
  },
  rawMeasurements: {},
  dimensionStandard: "ID",
  extraMeasurement: "",
  solveResult: null,
  displayLabel: null,
};
