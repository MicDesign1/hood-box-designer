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
  extraMeasurement: "",
  solveResult: null,
  displayLabel: null,
};
