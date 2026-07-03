"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Maximize2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { formatFractionInches } from "@/lib/imperial";
import type { CutElement, DielineGeometry, LabelMark, LineSegment } from "@/types/geometry";

export interface DielinePreviewProps {
  geometry: DielineGeometry | null;
  showCuts: boolean;
  showCreases: boolean;
  showLabels: boolean;
}

interface ViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

const GRID_MINOR: Record<"in" | "mm", number> = { in: 0.25, mm: 10 };
const GRID_MAJOR: Record<"in" | "mm", number> = { in: 1, mm: 100 };
const FIT_MARGIN_RATIO = 0.05;

function segsToPath(segments: LineSegment[]): string {
  return segments.map(([x1, y1, x2, y2]) => `M ${x1} ${y1} L ${x2} ${y2}`).join(" ");
}

/** Cuts mix straight segments and quarter-circle slot-root fillets in one path string. */
function cutsToPath(elements: CutElement[]): string {
  return elements
    .map((el) =>
      el.kind === "arc"
        ? `M ${el.x1} ${el.y1} A ${el.radius} ${el.radius} 0 0 ${el.sweep_flag} ${el.x2} ${el.y2}`
        : `M ${el.x1} ${el.y1} L ${el.x2} ${el.y2}`,
    )
    .join(" ");
}

function fmtDim(value: number, unit: "in" | "mm"): string {
  if (unit === "mm") return `${Math.round(value * 10) / 10} mm`;
  return `${formatFractionInches(value, 32)}"`;
}

function labelLines(mark: LabelMark, unit: "in" | "mm"): { main: string; sub: string | null } {
  switch (mark.kind) {
    case "panel":
      return {
        main: `${mark.letter ?? ""} ${fmtDim(mark.value ?? 0, unit)}`,
        sub: `panel ${mark.panel_index ?? ""}`,
      };
    case "tab":
      return { main: "TAB", sub: fmtDim(mark.value ?? 0, unit) };
    case "flap":
      return { main: `flap ${fmtDim(mark.value ?? 0, unit)}`, sub: null };
    case "glue":
      return { main: "GLUE", sub: null };
    default:
      return { main: "", sub: null };
  }
}

/**
 * Renders dieline geometry as a native SVG viewBox, so pan/zoom is real SVG
 * zoom (not a CSS transform on a static, print-sized file). Stroke width and
 * label size are derived from the *current* viewBox width each render, which
 * is what keeps hairlines and text visible and proportionate at any zoom
 * level instead of the sub-pixel invisibility you get from reusing a
 * physically-sized export SVG as the on-screen preview.
 */
export function DielinePreview({ geometry, showCuts, showCreases, showLabels }: DielinePreviewProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const vbRef = useRef<ViewBox | null>(null);
  const [vb, setVb] = useState<ViewBox | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinchDist = useRef<number | null>(null);

  const totalW = geometry?.total_w ?? 0;
  const totalH = geometry?.total_h ?? 0;

  const fit = useCallback(() => {
    if (!(totalW > 0) || !(totalH > 0)) return;
    const margin = Math.max(totalW, totalH) * FIT_MARGIN_RATIO;
    const next = { x: -margin, y: -margin, w: totalW + margin * 2, h: totalH + margin * 2 };
    vbRef.current = next;
    setVb(next);
  }, [totalW, totalH]);

  useEffect(() => {
    fit();
  }, [fit]);

  const zoomAt = useCallback(
    (clientX: number, clientY: number, factor: number) => {
      const current = vbRef.current;
      if (!current || !svgRef.current) return;
      const rect = svgRef.current.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const px = current.x + ((clientX - rect.left) / rect.width) * current.w;
      const py = current.y + ((clientY - rect.top) / rect.height) * current.h;
      const maxW = totalW * 20 || 1000;
      const minW = totalW * 0.01 || 1;
      const w = Math.min(Math.max(current.w * factor, minW), maxW);
      const h = current.h * (w / current.w);
      const next = {
        x: px - ((px - current.x) / current.w) * w,
        y: py - ((py - current.y) / current.h) * h,
        w,
        h,
      };
      vbRef.current = next;
      setVb(next);
    },
    [totalW],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      zoomAt(event.clientX, event.clientY, event.deltaY > 0 ? 1.12 : 0.89);
    };

    container.addEventListener("wheel", handleWheel, { passive: false });
    return () => container.removeEventListener("wheel", handleWheel);
    // `vb !== null` guards against the container div not existing yet on
    // this effect's first run (see the identical fix + explanation in
    // PhotoStage, which hit this for real).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoomAt, vb !== null]);

  function handlePointerDown(event: React.PointerEvent<SVGSVGElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinchDist.current = Math.hypot(a.x - b.x, a.y - b.y);
    }
    setIsDragging(true);
  }

  function handlePointerMove(event: React.PointerEvent<SVGSVGElement>) {
    if (!pointers.current.has(event.pointerId) || !vbRef.current || !svgRef.current) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointers.current.size === 1) {
      const current = vbRef.current;
      const rect = svgRef.current.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const dx = (event.movementX / rect.width) * current.w;
      const dy = (event.movementY / rect.height) * current.h;
      const next = { ...current, x: current.x - dx, y: current.y - dy };
      vbRef.current = next;
      setVb(next);
    } else if (pointers.current.size === 2 && pinchDist.current) {
      const [a, b] = [...pointers.current.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (d > 0) {
        zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, pinchDist.current / d);
        pinchDist.current = d;
      }
    }
  }

  function endPointer(event: React.PointerEvent<SVGSVGElement>) {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) pinchDist.current = null;
    if (pointers.current.size === 0) setIsDragging(false);
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // capture may already be released by the browser
    }
  }

  if (!geometry || geometry.cuts.length === 0 || !vb) {
    return (
      <div
        ref={containerRef}
        className="flex h-full min-h-[320px] w-full items-center justify-center rounded-lg border bg-white px-6 text-center text-sm text-muted-foreground sm:min-h-[420px] lg:min-h-[520px]"
      >
        Enter dimensions to generate a dieline
      </div>
    );
  }

  const unit = geometry.unit;
  const strokeW = vb.w / 700;
  const labelSize = vb.w / 46;
  const gridMinor = GRID_MINOR[unit];
  const gridMajor = GRID_MAJOR[unit];

  return (
    <div
      ref={containerRef}
      className="relative h-full min-h-[320px] w-full overflow-hidden rounded-lg border bg-white sm:min-h-[420px] lg:min-h-[520px]"
    >
      <svg
        ref={svgRef}
        viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
        className="h-full w-full touch-none select-none"
        style={{ cursor: isDragging ? "grabbing" : "grab" }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        onDoubleClick={fit}
      >
        <defs>
          <pattern id="dieline-grid-minor" width={gridMinor} height={gridMinor} patternUnits="userSpaceOnUse">
            <path d={`M ${gridMinor} 0 L 0 0 0 ${gridMinor}`} fill="none" stroke="#e2e8f0" strokeWidth={strokeW * 0.5} />
          </pattern>
          <pattern id="dieline-grid-major" width={gridMajor} height={gridMajor} patternUnits="userSpaceOnUse">
            <rect width={gridMajor} height={gridMajor} fill="url(#dieline-grid-minor)" />
            <path d={`M ${gridMajor} 0 L 0 0 0 ${gridMajor}`} fill="none" stroke="#cbd5e1" strokeWidth={strokeW * 0.8} />
          </pattern>
        </defs>

        <rect x={vb.x} y={vb.y} width={vb.w} height={vb.h} fill="url(#dieline-grid-major)" />

        {showCreases && (
          <path
            d={segsToPath(geometry.creases)}
            fill="none"
            stroke="#16a34a"
            strokeWidth={strokeW * 1.8}
            strokeDasharray={`${strokeW * 8} ${strokeW * 5}`}
            strokeLinecap="round"
          />
        )}
        {showCuts && (
          <path
            d={cutsToPath(geometry.cuts)}
            fill="none"
            stroke="#dc2626"
            strokeWidth={strokeW * 2.2}
            strokeLinecap="round"
          />
        )}
        {showLabels &&
          geometry.labels.map((mark, index) => {
            const { main, sub } = labelLines(mark, unit);
            const size = mark.small ? labelSize * 0.62 : labelSize;
            return (
              <g key={index}>
                <text
                  x={mark.x}
                  y={mark.y}
                  textAnchor="middle"
                  fontSize={size}
                  fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                  fontWeight={600}
                  fill={mark.faint ? "#9ca3af" : "#1f2937"}
                >
                  {main}
                </text>
                {sub && (
                  <text
                    x={mark.x}
                    y={mark.y + size * 0.9}
                    textAnchor="middle"
                    fontSize={size * 0.5}
                    fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                    fill="#6b7280"
                  >
                    {sub}
                  </text>
                )}
              </g>
            );
          })}
      </svg>

      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-2">
        <p className="rounded-md bg-background/85 px-2 py-1 text-[11px] text-muted-foreground shadow-sm backdrop-blur-sm">
          Drag to pan · Scroll / pinch to zoom · Double-click to fit
        </p>
        <Button
          size="sm"
          variant="outline"
          className="pointer-events-auto h-7 gap-1 bg-background/90 px-2 text-xs shadow-sm backdrop-blur-sm"
          onClick={fit}
        >
          <Maximize2 className="size-3.5" />
          Fit
        </Button>
      </div>
    </div>
  );
}
