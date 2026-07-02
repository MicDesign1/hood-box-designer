/** Raw dieline geometry, in drawing units (inches or mm), for live rendering. */

export type LineSegment = [x1: number, y1: number, x2: number, y2: number];

export type LabelKind = "panel" | "tab" | "flap" | "glue";

export interface LabelMark {
  x: number;
  y: number;
  kind: LabelKind;
  value: number | null;
  letter: string | null;
  panel_index: number | null;
  small: boolean;
  faint: boolean;
}

export interface DielineGeometry {
  unit: "in" | "mm";
  total_w: number;
  total_h: number;
  cuts: LineSegment[];
  creases: LineSegment[];
  labels: LabelMark[];
}
