/**
 * Shared capture core (proposal: photo-measure unification, capture-record
 * design). This is the method-agnostic layer that both capture methods
 * (direct-entry / Design, panel-derived / Sample) feed and that all output
 * modes (data table, PDF, dieline annotation layer) will eventually draw
 * from. It does NOT replace `BoxSpec` or `SampleWizardState` -- those stay
 * method-specific; this unifies capture mechanics only.
 *
 * No ID/OD field exists anywhere in this file, deliberately. Captured
 * values are always inside dimensions (ID) -- that is a structural
 * invariant of this type, not a default that could be toggled. The only
 * place an outside dimension is ever computed is the existing, unchanged
 * "Outside (approx)" display conversion in the Sample flow
 * (backend/dieline_core/scoring.py:outside_dimensions_from_id), which reads
 * from a *solved* result, never from a CaptureMarker.
 */
import type { Point } from "@/lib/photo-calibration";
import type { PhotoCalibrationCapture } from "@/components/PhotoMeasure/types";

/**
 * The record's flute vocabulary is intentionally wider than either flow's
 * own type (`RscFluteType`/`SampleFlute`, both "B"|"C"|"BC" today) --
 * it mirrors the backend's full `FluteType` (backend/app/models/box_spec.py)
 * since that's the actual source of truth. Neither flow's UI is required to
 * expose the full set; this just stops the record itself from being the
 * thing that forecloses it later.
 */
export type FluteType = "A" | "B" | "C" | "E" | "F" | "BC" | "EB";

/**
 * What a marker's raw value means. The discriminant is the actual guard
 * against leakage, not just documentation: code that computes geometry or
 * allowance math has no shared field to read across the three shapes, so it
 * cannot consume a `reference` marker without a visible, deliberate branch
 * to do so.
 */
export type CaptureRole =
  | { kind: "dimension"; axis: "length" | "width" | "height" }
  | {
      kind: "panel";
      panelField: "panel1" | "panel2" | "panelD" | "blankWidth" | "blankHeight" | "flapHeight";
    }
  | { kind: "reference"; label: string };

/** The old `Record<string, LockedMeasurement>` key a role corresponds to,
 * or null for reference roles. This is the actual structural guard against
 * leakage, not just documentation: it returns null unconditionally for
 * `kind: "reference"` -- it never reads `.label`, so nothing a user types
 * into a reference marker's label (including a string that collides with a
 * real axis/panel key, e.g. "length") can ever produce a key. Code that
 * builds solver/BoxSpec payloads has no path to a reference marker's data
 * without a deliberate branch on `role.kind` that doesn't exist anywhere
 * upstream of `referenceDimensions()` below. */
export function roleLookupKey(role: CaptureRole): string | null {
  if (role.kind === "dimension") return role.axis;
  if (role.kind === "panel") return role.panelField;
  return null;
}

/** Dimension/panel roles are exclusive: assigning one to a new marker steals
 * it from whichever marker held it before. Reference roles are never
 * exclusive with each other -- a session can have any number of them. */
export function roleEquals(a: CaptureRole | null, b: CaptureRole): boolean {
  if (!a || a.kind === "reference" || b.kind === "reference") return false;
  if (a.kind === "dimension" && b.kind === "dimension") return a.axis === b.axis;
  if (a.kind === "panel" && b.kind === "panel") return a.panelField === b.panelField;
  return false;
}

export interface CaptureMarker {
  /** "m1", "m2", ... assigned at placement, stable for the life of the session. */
  readonly id: string;
  readonly ptA: Point;
  readonly ptB: Point;
  /**
   * Full precision from measureFn, taken once, the moment `role` is
   * assigned. `readonly` is deliberate: no code path anywhere reassigns
   * this after the marker locks -- rounding is display-only and always
   * produces a *new* value elsewhere, never overwrites this one.
   */
  readonly rawInches: number;
  /**
   * null = provisional: points still adjustable, marker excluded from every
   * output. Assigning a role *is* the lock action -- there is no separate
   * commit step. (Requirement A: "no marker is treated as final until the
   * user designates it.")
   */
  role: CaptureRole | null;
  /**
   * Meaningful only once `role` is non-null. Lets a marker be placed,
   * assigned, and still excluded from output without deleting it -- the
   * numbered list stays stable and auditable.
   */
  keep: boolean;
}

export interface CaptureSession {
  readonly id: string;
  /** Which capture method produced this session. Drives the completion
   * rule (see `isComplete` below) and which CaptureRole kinds are expected;
   * it does not change how markers themselves are stored. */
  readonly method: "direct" | "panel-derived";
  calibration: PhotoCalibrationCapture | null;
  /** Placement order. Individual markers are immutable once `role` is
   * assigned (see CaptureMarker); the array itself is append/replace-only
   * (re-measuring a role replaces that marker, never mutates it in place). */
  markers: CaptureMarker[];
  /** Manual entry only -- no auto-detect, matches the standing constraint. */
  flute: FluteType | null;
  /** Manual entry only; null = "use the flute's nominal caliper." */
  caliper: number | null;
  readonly capturedAt: string;
}

/** Markers that actually count for output: assigned a role AND kept. */
export function keptMarkers(session: CaptureSession): CaptureMarker[] {
  return session.markers.filter((m) => m.role !== null && m.keep);
}

export interface ReferenceDimension {
  label: string;
  rawInches: number;
}

/** Reference-only markers among the kept set -- annotations, never math. */
export function referenceDimensions(session: CaptureSession): ReferenceDimension[] {
  return keptMarkers(session)
    .filter(
      (m): m is CaptureMarker & { role: { kind: "reference"; label: string } } =>
        m.role?.kind === "reference",
    )
    .map((m) => ({ label: m.role.label, rawInches: m.rawInches }));
}

/**
 * Method-aware completion rule (owner decision): direct-entry needs all
 * three of length/width/height kept; panel-derived needs its panel set
 * (mirrors what the solver already requires today -- panel_1, panel_2, and
 * either panel_d or, for tube, blankHeight). Reference markers never
 * affect completion, in either method.
 */
export function isComplete(session: CaptureSession): boolean {
  const kept = keptMarkers(session);
  if (session.method === "direct") {
    const axes = new Set(
      kept.flatMap((m) => (m.role?.kind === "dimension" ? [m.role.axis] : [])),
    );
    return axes.has("length") && axes.has("width") && axes.has("height");
  }
  const panelFields = new Set(
    kept.flatMap((m) => (m.role?.kind === "panel" ? [m.role.panelField] : [])),
  );
  // Matches today's solver requirement (buildSolvePayload / backend
  // validate_measurements): panel1 + panel2 always; panelD unless the style
  // is tube, where blankHeight stands in for tube height instead. This
  // function doesn't know the sample's style, so it accepts either -- the
  // caller (Sample flow) still applies its own style-specific requirement
  // on top, exactly as `requiredPhotoDimensions()` does today.
  const hasDepth = panelFields.has("panelD") || panelFields.has("blankHeight");
  return panelFields.has("panel1") && panelFields.has("panel2") && hasDepth;
}
