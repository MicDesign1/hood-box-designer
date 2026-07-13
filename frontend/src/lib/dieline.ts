import { formatDecimalInches } from "@/lib/imperial";
import { caliperForSpec, type BoxSpec } from "@/types/box";
import type { ReferenceDimension } from "@/types/capture";
import type { DielineGeometry } from "@/types/geometry";

/** Wire shape for the backend's ReferenceDimension model (snake_case,
 * raw_inches) -- distinct from the frontend's own camelCase ReferenceDimension
 * (types/capture.ts) so this conversion is a visible, deliberate step, not
 * an accidental shape coincidence. */
export function toReferenceDimensionPayload(refs: ReferenceDimension[]): { label: string; raw_inches: number }[] {
  return refs.map((ref) => ({ label: ref.label, raw_inches: ref.rawInches }));
}

const API_BASE_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000").replace(/\/+$/, "");

/** Backend API path — same base URL as generate/export (NEXT_PUBLIC_API_URL). */
export function apiUrl(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${API_BASE_URL}${normalized}`;
}

export interface DielineGenerateResponse {
  svg: string;
  geometry: DielineGeometry | null;
  fefco_code: string;
  generated: boolean;
  message: string | null;
  warnings: string[];
  derived: Record<string, string | number | boolean | null>;
}

export interface BoxSpecPayload {
  fefco_code: BoxSpec["style"];
  length: number;
  width: number;
  height: number;
  caliper: number;
  units: "in";
  fillet_radius?: number;
  flute_type?: BoxSpec["fluteType"];
  joint?: BoxSpec["joint"];
  tab_width?: number;
  /** Annotation-only legend entries (requirement B) -- never read by
   * geometry/scoring math on either side. Omitted entirely when empty, so
   * every existing caller/fixture that builds a payload without this field
   * is unaffected. */
  reference_dimensions?: { label: string; raw_inches: number }[];
}

export function toBoxSpecPayload(spec: BoxSpec, referenceDimensions: ReferenceDimension[] = []): BoxSpecPayload {
  const payload: BoxSpecPayload = {
    fefco_code: spec.style,
    length: spec.length,
    width: spec.width,
    height: spec.height,
    caliper: caliperForSpec(spec),
    units: "in",
    ...(spec.filletRadius !== undefined ? { fillet_radius: spec.filletRadius } : {}),
  };

  if (spec.style === "0201" || spec.style === "hsc" || spec.style === "tube") {
    if (spec.fluteType) {
      payload.flute_type = spec.fluteType;
    }
    if (spec.joint) {
      payload.joint = spec.joint;
    }
  }

  if (referenceDimensions.length > 0) {
    payload.reference_dimensions = toReferenceDimensionPayload(referenceDimensions);
  }

  return payload;
}

export async function fetchDielineSvgFromPayload(
  payload: BoxSpecPayload,
  signal?: AbortSignal,
): Promise<DielineGenerateResponse> {
  const response = await fetch(apiUrl("/api/dieline/generate"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal,
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `Dieline request failed (${response.status})`);
  }

  return response.json() as Promise<DielineGenerateResponse>;
}

export async function fetchDielineDxfFromPayload(payload: BoxSpecPayload): Promise<Blob> {
  const response = await fetch(apiUrl("/api/dieline/export/dxf"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `DXF export failed (${response.status})`);
  }

  return response.blob();
}

export async function fetchDielineSvg(
  spec: BoxSpec,
  referenceDimensions: ReferenceDimension[] = [],
  signal?: AbortSignal,
): Promise<DielineGenerateResponse> {
  const response = await fetch(apiUrl("/api/dieline/generate"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(toBoxSpecPayload(spec, referenceDimensions)),
    signal,
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `Dieline request failed (${response.status})`);
  }

  return response.json() as Promise<DielineGenerateResponse>;
}

export async function fetchDielineDxf(spec: BoxSpec, referenceDimensions: ReferenceDimension[] = []): Promise<Blob> {
  const response = await fetch(apiUrl("/api/dieline/export/dxf"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(toBoxSpecPayload(spec, referenceDimensions)),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `DXF export failed (${response.status})`);
  }

  return response.blob();
}

function buildFilenameFromPayload(
  payload: BoxSpecPayload,
  extension: "svg" | "dxf",
): string {
  const length = formatDecimalInches(payload.length);
  const width = formatDecimalInches(payload.width);
  const height = formatDecimalInches(payload.height);
  return `dieline-${payload.fefco_code}-${length}x${width}x${height}in.${extension}`;
}

function buildFilename(spec: BoxSpec, extension: "svg" | "dxf"): string {
  const length = formatDecimalInches(spec.length);
  const width = formatDecimalInches(spec.width);
  const height = formatDecimalInches(spec.height);
  return `fefco-${spec.style}-${length}x${width}x${height}in.${extension}`;
}

export function downloadSvgFromPayload(svg: string, payload: BoxSpecPayload): void {
  const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  triggerDownload(blob, buildFilenameFromPayload(payload, "svg"));
}

export function downloadDxfFromPayload(blob: Blob, payload: BoxSpecPayload): void {
  triggerDownload(blob, buildFilenameFromPayload(payload, "dxf"));
}

export function downloadSvg(svg: string, spec: BoxSpec): void {
  const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  triggerDownload(blob, buildFilename(spec, "svg"));
}

export function downloadDxf(blob: Blob, spec: BoxSpec): void {
  triggerDownload(blob, buildFilename(spec, "dxf"));
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
