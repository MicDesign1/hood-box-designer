import type { SampleFlute, SampleStyle, SolveResponse } from "@/types/sample";
import { FLUTE_CALIPER_IN } from "@/types/box";
import { apiUrl, toReferenceDimensionPayload, type BoxSpecPayload } from "@/lib/dieline";
import type { ReferenceDimension } from "@/types/capture";

export interface SolveRequestPayload {
  flute: SampleFlute;
  style?: SampleStyle;
  joint?: "taped" | "glued";
  tab_width?: number;
  blank_w_excludes_tab?: boolean;
  panel_d?: number;
  panel_1?: number;
  panel_2?: number;
  blank_w?: number;
  blank_h?: number;
  flap_h?: number;
}

export const SAMPLE_TAB_WIDTH = 1.5;

export async function fetchSolve(
  payload: SolveRequestPayload,
  signal?: AbortSignal,
): Promise<SolveResponse> {
  const response = await fetch(apiUrl("/api/dieline/solve"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal,
  });

  if (!response.ok) {
    let detail = await response.text();
    try {
      const parsed = JSON.parse(detail) as { detail?: string };
      if (parsed.detail) detail = parsed.detail;
    } catch {
      // keep raw text
    }
    throw new Error(detail || `Solve request failed (${response.status})`);
  }

  return response.json() as Promise<SolveResponse>;
}

const FEFCO_FROM_SOLVE: Record<SampleStyle, BoxSpecPayload["fefco_code"]> = {
  rsc: "0201",
  hsc: "hsc",
  tube: "tube",
};

export function solveResultToGeneratePayload(
  result: SolveResponse,
  flute: SampleFlute,
  referenceDimensions: ReferenceDimension[] = [],
): BoxSpecPayload {
  const payload: BoxSpecPayload = {
    fefco_code: FEFCO_FROM_SOLVE[result.style],
    length: result.L,
    width: result.W,
    height: result.D,
    caliper: FLUTE_CALIPER_IN[flute],
    units: "in",
    flute_type: flute,
    joint: result.joint,
  };
  if (result.joint === "glued") {
    payload.tab_width = result.tab_width ?? SAMPLE_TAB_WIDTH;
  }
  if (referenceDimensions.length > 0) {
    payload.reference_dimensions = toReferenceDimensionPayload(referenceDimensions);
  }
  return payload;
}

export function jointDisplayLabel(result: SolveResponse): string {
  if (result.joint_label) return result.joint_label;
  return result.joint === "glued"
    ? `glued joint, ${result.tab_width ?? SAMPLE_TAB_WIDTH}" tab (standard — adjust in Artios if needed)`
    : "taped joint";
}

export function styleDisplayName(
  style: SampleStyle,
  displayLabel: string | null,
): string {
  if (displayLabel) return displayLabel;
  switch (style) {
    case "rsc":
      return "Regular box (flaps top & bottom)";
    case "hsc":
      return "Half box (flaps one side)";
    case "tube":
      return "Tube wrap (four panels)";
    default:
      return style;
  }
}

export function confidenceLabel(confidence: SolveResponse["confidence"]): string {
  switch (confidence) {
    case "high":
      return "Good match";
    case "medium":
      return "Close match";
    case "ambiguous":
      return "Need one more measurement";
    case "low":
      return "Poor fit — double-check your numbers";
    default:
      return confidence;
  }
}

export function needsExtraMeasurement(result: SolveResponse): boolean {
  return result.confidence === "ambiguous" && Boolean(result.suggested_input);
}

export function extraMeasurementKind(
  result: SolveResponse,
): "panel-d" | "panel" | "flap" | null {
  const hint = result.suggested_input?.toLowerCase() ?? "";
  if (hint.includes("depth panel")) return "panel-d";
  if (hint.includes("second panel")) return "panel";
  if (hint.includes("first panel") || hint.includes("panel")) return "panel";
  if (hint.includes("flap")) return "flap";
  if (result.style === "tube") return "panel";
  return "panel-d";
}
