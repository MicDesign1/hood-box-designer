import { formatDecimalInches } from "@/lib/imperial";
import { caliperForSpec, type BoxSpec } from "@/types/box";
import type { DielineGeometry } from "@/types/geometry";

const API_BASE_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000").replace(/\/+$/, "");

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
}

export function toBoxSpecPayload(spec: BoxSpec): BoxSpecPayload {
  const payload: BoxSpecPayload = {
    fefco_code: spec.style,
    length: spec.length,
    width: spec.width,
    height: spec.height,
    caliper: caliperForSpec(spec),
    units: "in",
    ...(spec.filletRadius !== undefined ? { fillet_radius: spec.filletRadius } : {}),
  };

  if (spec.style === "0201") {
    if (spec.fluteType) {
      payload.flute_type = spec.fluteType;
    }
    if (spec.joint) {
      payload.joint = spec.joint;
    }
  }

  return payload;
}

export async function fetchDielineSvg(
  spec: BoxSpec,
  signal?: AbortSignal,
): Promise<DielineGenerateResponse> {
  const response = await fetch(`${API_BASE_URL}/api/dieline/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(toBoxSpecPayload(spec)),
    signal,
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `Dieline request failed (${response.status})`);
  }

  return response.json() as Promise<DielineGenerateResponse>;
}

export async function fetchDielineDxf(spec: BoxSpec): Promise<Blob> {
  const response = await fetch(`${API_BASE_URL}/api/dieline/export/dxf`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(toBoxSpecPayload(spec)),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `DXF export failed (${response.status})`);
  }

  return response.blob();
}

function buildFilename(spec: BoxSpec, extension: "svg" | "dxf"): string {
  const length = formatDecimalInches(spec.length);
  const width = formatDecimalInches(spec.width);
  const height = formatDecimalInches(spec.height);
  return `fefco-${spec.style}-${length}x${width}x${height}in.${extension}`;
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
