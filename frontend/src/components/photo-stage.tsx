"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Maximize2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { formatFractionInches } from "@/lib/imperial";
import { dist, type Point } from "@/lib/photo-calibration";

export interface PhotoImage {
  url: string;
  w: number;
  h: number;
}

export interface PhotoStageProps {
  image: PhotoImage;
  tool: "calibrate" | "measure";
  calPoints: Point[];
  measurePoints: Point[];
  maxCalPoints: number;
  pxPerInch: number | null;
  onCalPointsChange: (points: Point[]) => void;
  onMeasurePointsChange: (points: Point[]) => void;
  /** Bump this to force a re-fit (e.g. a new photo was loaded). */
  fitSignal: number;
}

interface ViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

const FIT_MARGIN_RATIO = 0.05;
const HIT_RADIUS_SCREEN_PX = 26;

/**
 * A pannable/zoomable native-SVG viewer over an uploaded photo, supporting
 * tap-to-place and drag-to-adjust points. Mirrors DielinePreview's viewBox-
 * based pan/zoom architecture (real SVG zoom, not a CSS transform) so
 * hairline/point sizing stays proportionate at any zoom level, extended
 * here with tap/drag point placement which the dieline preview doesn't need.
 */
export function PhotoStage({
  image,
  tool,
  calPoints,
  measurePoints,
  maxCalPoints,
  pxPerInch,
  onCalPointsChange,
  onMeasurePointsChange,
  fitSignal,
}: PhotoStageProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const vbRef = useRef<ViewBox | null>(null);
  const [vb, setVb] = useState<ViewBox | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinchDist = useRef<number | null>(null);
  const gesture = useRef<{ moved: boolean; dragIndex: number | null; startX: number; startY: number } | null>(null);

  const activePoints = tool === "calibrate" ? calPoints : measurePoints;
  const setActivePoints = tool === "calibrate" ? onCalPointsChange : onMeasurePointsChange;
  const maxActivePoints = tool === "calibrate" ? maxCalPoints : Infinity;

  const fit = useCallback(() => {
    if (!(image.w > 0) || !(image.h > 0)) return;
    const margin = Math.max(image.w, image.h) * FIT_MARGIN_RATIO;
    const next = { x: -margin, y: -margin, w: image.w + margin * 2, h: image.h + margin * 2 };
    vbRef.current = next;
    setVb(next);
  }, [image.w, image.h]);

  useEffect(() => {
    fit();
  }, [fit, fitSignal]);

  const clientToImage = useCallback((clientX: number, clientY: number): Point | null => {
    const svg = svgRef.current;
    const v = vbRef.current;
    if (!svg || !v) return null;
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    return {
      x: v.x + ((clientX - rect.left) / rect.width) * v.w,
      y: v.y + ((clientY - rect.top) / rect.height) * v.h,
    };
  }, []);

  const zoomAt = useCallback(
    (clientX: number, clientY: number, factor: number) => {
      const current = vbRef.current;
      const svg = svgRef.current;
      if (!current || !svg) return;
      const rect = svg.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const px = current.x + ((clientX - rect.left) / rect.width) * current.w;
      const py = current.y + ((clientY - rect.top) / rect.height) * current.h;
      const maxW = image.w * 20 || 1000;
      const minW = image.w * 0.02 || 1;
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
    [image.w],
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
    // `vb !== null` is deliberate: on first mount vb is still null, so the
    // container div hasn't rendered yet and this effect's first run finds
    // nothing to bind to. image.w/h (zoomAt's only dep) are already fully
    // populated before PhotoStage ever mounts, so nothing else would make
    // this effect re-run once the real container exists — re-run exactly
    // once, when vb flips from null to a real viewBox after fit().
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoomAt, vb !== null]);

  function hitTestActivePoint(clientX: number, clientY: number): number | null {
    const svg = svgRef.current;
    const v = vbRef.current;
    const pt = clientToImage(clientX, clientY);
    if (!svg || !v || !pt) return null;
    const rect = svg.getBoundingClientRect();
    const screenPxPerImagePx = rect.width / v.w;
    const hitRadiusImagePx = HIT_RADIUS_SCREEN_PX / Math.max(screenPxPerImagePx, 1e-6);

    let best: number | null = null;
    let bestDist = hitRadiusImagePx;
    activePoints.forEach((p, i) => {
      const d = dist(p, pt);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    });
    return best;
  }

  function handlePointerDown(event: React.PointerEvent<SVGSVGElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinchDist.current = Math.hypot(a.x - b.x, a.y - b.y);
      gesture.current = null;
    } else {
      const dragIndex = hitTestActivePoint(event.clientX, event.clientY);
      gesture.current = { moved: false, dragIndex, startX: event.clientX, startY: event.clientY };
    }
    setIsDragging(true);
  }

  function handlePointerMove(event: React.PointerEvent<SVGSVGElement>) {
    if (!pointers.current.has(event.pointerId) || !vbRef.current) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointers.current.size === 1) {
      const g = gesture.current;
      if (g && Math.hypot(event.clientX - g.startX, event.clientY - g.startY) > 6) {
        g.moved = true;
      }
      if (g && g.dragIndex != null) {
        const pt = clientToImage(event.clientX, event.clientY);
        if (pt) {
          setActivePoints(activePoints.map((p, i) => (i === g.dragIndex ? pt : p)));
        }
      } else {
        const current = vbRef.current;
        const rect = svgRef.current!.getBoundingClientRect();
        const dx = (event.movementX / rect.width) * current.w;
        const dy = (event.movementY / rect.height) * current.h;
        const next = { ...current, x: current.x - dx, y: current.y - dy };
        vbRef.current = next;
        setVb(next);
      }
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
    const wasSingle = pointers.current.size === 1;
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) pinchDist.current = null;

    const g = gesture.current;
    if (wasSingle && g && !g.moved && g.dragIndex == null) {
      const pt = clientToImage(event.clientX, event.clientY);
      if (pt && activePoints.length < maxActivePoints) {
        setActivePoints([...activePoints, pt]);
      }
    }
    gesture.current = null;
    if (pointers.current.size === 0) setIsDragging(false);
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // capture may already be released by the browser
    }
  }

  if (!vb) return null;

  const pointRadius = vb.w / 130;
  const fontSize = vb.w / 68;
  const calDone = calPoints.length >= maxCalPoints;

  const measurementPairs: [Point, Point][] = [];
  for (let i = 0; i + 1 < measurePoints.length; i += 2) {
    measurementPairs.push([measurePoints[i], measurePoints[i + 1]]);
  }

  return (
    <div
      ref={containerRef}
      className="relative h-full min-h-[320px] w-full overflow-hidden rounded-lg border bg-white sm:min-h-[420px] lg:min-h-[520px]"
    >
      <svg
        ref={svgRef}
        viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
        className="h-full w-full touch-none select-none"
        style={{ cursor: isDragging ? "grabbing" : "crosshair" }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        onDoubleClick={fit}
      >
        <image href={image.url} x={0} y={0} width={image.w} height={image.h} preserveAspectRatio="none" />

        {calPoints.length >= 2 && (
          <polyline
            points={[...calPoints, ...(calDone ? [calPoints[0]] : [])].map((p) => `${p.x},${p.y}`).join(" ")}
            fill="none"
            stroke="#f59e0b"
            strokeWidth={pointRadius * 0.3}
            strokeDasharray={`${pointRadius * 0.6} ${pointRadius * 0.4}`}
            opacity={tool === "calibrate" ? 0.9 : 0.4}
          />
        )}
        {calPoints.map((p, i) => (
          <g key={`cal-${i}`} opacity={tool === "calibrate" ? 1 : 0.4}>
            <circle cx={p.x} cy={p.y} r={pointRadius} fill="#f59e0b33" stroke="#f59e0b" strokeWidth={pointRadius * 0.22} />
            <circle cx={p.x} cy={p.y} r={pointRadius * 0.14} fill="#f59e0b" />
            <text
              x={p.x}
              y={p.y - pointRadius * 1.4}
              textAnchor="middle"
              fontSize={fontSize}
              fontWeight={700}
              fill="#b45309"
              stroke="#ffffffcc"
              strokeWidth={fontSize * 0.15}
              paintOrder="stroke"
            >
              {i + 1}
            </text>
          </g>
        ))}

        {measurementPairs.map(([a, b], i) => {
          const mx = (a.x + b.x) / 2;
          const my = (a.y + b.y) / 2;
          const px = dist(a, b);
          const inches = pxPerInch ? px / pxPerInch : null;
          const label = inches != null ? `M${i + 1} ${formatFractionInches(inches, 16)}"` : `M${i + 1}`;
          return (
            <g key={`m-${i}`} opacity={tool === "measure" ? 1 : 0.55}>
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#0284c7" strokeWidth={pointRadius * 0.32} />
              <text
                x={mx}
                y={my - pointRadius * 0.9}
                textAnchor="middle"
                fontSize={fontSize * 1.05}
                fontWeight={700}
                fill="#ffffff"
                stroke="#0c4a6e"
                strokeWidth={fontSize * 0.22}
                paintOrder="stroke"
              >
                {label}
              </text>
            </g>
          );
        })}
        {measurePoints.map((p, i) => (
          <circle
            key={`mp-${i}`}
            cx={p.x}
            cy={p.y}
            r={pointRadius * 0.55}
            fill="#0284c744"
            stroke="#0284c7"
            strokeWidth={pointRadius * 0.2}
            opacity={tool === "measure" ? 1 : 0.55}
          />
        ))}
      </svg>

      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-2">
        <p className="rounded-md bg-background/85 px-2 py-1 text-[11px] text-muted-foreground shadow-sm backdrop-blur-sm">
          {tool === "calibrate" ? "Tap the reference corners in order" : "Tap pairs of points to measure"} · drag a
          point to adjust · pinch/scroll to zoom
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
