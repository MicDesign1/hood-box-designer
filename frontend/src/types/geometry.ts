/** Raw dieline geometry, in drawing units (inches or mm), for live rendering. */

export type LineSegment = [x1: number, y1: number, x2: number, y2: number];

/** A straight cut, or a quarter-circle slot-root fillet (`sweep_flag` is the SVG arc sweep-flag). */
export type CutElement =
  | { kind: "line"; x1: number; y1: number; x2: number; y2: number }
  | { kind: "arc"; x1: number; y1: number; x2: number; y2: number; radius: number; sweep_flag: 0 | 1 };

export type LabelKind = "panel" | "tab" | "flap" | "glue" | "height" | "blank" | "reference";

export interface LabelMark {
  x: number;
  y: number;
  kind: LabelKind;
  value: number | null;
  /** Second value for two-part callouts (currently "blank" only: value=width, value2=height). */
  value2: number | null;
  /** Panel letter ("L"/"W") for "panel" kind; the user-supplied label text for "reference" kind. */
  letter: string | null;
  panel_index: number | null;
  small: boolean;
  faint: boolean;
}

export interface DielineGeometry {
  unit: "in" | "mm";
  total_w: number;
  total_h: number;
  cuts: CutElement[];
  creases: LineSegment[];
  labels: LabelMark[];
}
