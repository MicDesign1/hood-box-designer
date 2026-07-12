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
  /** Converts a pair of image-pixel points to a real-world distance in inches, or null if not yet calibrated. */
  measureFn: ((a: Point, b: Point) => number) | null;
  onCalPointsChange: (points: Point[]) => void;
  onMeasurePointsChange: (points: Point[]) => void;
  /** Index (within the active tool's point array) of the currently selected marker, for nudging. */
  selectedIndex: number | null;
  onSelectedIndexChange: (index: number | null) => void;
  /** Bump this to force a re-fit (e.g. a new photo was loaded). */
  fitSignal: number;
  /** Passive, non-interactive segments from prior measurements (e.g. other fields already measured). */
  extraSegments?: { ptA: Point; ptB: Point; label: string }[];
}

interface ViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

const FIT_MARGIN_RATIO = 0.05;
// Touch-target radius for grabbing an existing point, in real screen px
// (independent of zoom/container size) — 26px radius = 52px diameter,
// clearing the 44x44px minimum touch-target guideline. The visual dot stays
// small (see DOT_MIN_SCREEN_PX/DOT_MAX_SCREEN_PX) so this hit area is larger
// than what's drawn, which is intentional.
const HIT_RADIUS_SCREEN_PX = 26;
const LOUPE_SIZE = 130;
const LOUPE_ZOOM = 3;

// Label/dot sizing targets real screen px, scaled between these bounds by
// container width, then converted into viewBox units at render time. Using
// vb.w alone (the old approach) produced screen text that shrank with the
// container — legible on desktop, ~5-6px and unreadable at a 390px phone
// width.
const LABEL_FONT_MIN_SCREEN_PX = 14;
const LABEL_FONT_MAX_SCREEN_PX = 18;
const DOT_MIN_SCREEN_PX = 6;
const DOT_MAX_SCREEN_PX = 9;
const NARROW_CONTAINER_PX = 320;
const WIDE_CONTAINER_PX = 900;
const LABEL_COLLISION_SCREEN_PX = 26;

function widthScaledPx(containerWidthPx: number, minPx: number, maxPx: number): number {
  if (!(containerWidthPx > 0)) return minPx;
  const t = Math.min(1, Math.max(0, (containerWidthPx - NARROW_CONTAINER_PX) / (WIDE_CONTAINER_PX - NARROW_CONTAINER_PX)));
  return minPx + t * (maxPx - minPx);
}

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
  measureFn,
  onCalPointsChange,
  onMeasurePointsChange,
  selectedIndex,
  onSelectedIndexChange,
  fitSignal,
  extraSegments,
}: PhotoStageProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const vbRef = useRef<ViewBox | null>(null);
  const [vb, setVb] = useState<ViewBox | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinchDist = useRef<number | null>(null);
  const gesture = useRef<{ moved: boolean; dragIndex: number | null; startX: number; startY: number } | null>(null);
  const [loupe, setLoupe] = useState<{
    clientX: number;
    clientY: number;
    imagePoint: Point;
    screenPxPerImagePx: number;
  } | null>(null);
  const [loadedImg, setLoadedImg] = useState<HTMLImageElement | null>(null);
  const [renderWidthPx, setRenderWidthPx] = useState(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width) setRenderWidthPx(width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const activePoints = tool === "calibrate" ? calPoints : measurePoints;
  const setActivePoints = tool === "calibrate" ? onCalPointsChange : onMeasurePointsChange;
  const maxActivePoints = tool === "calibrate" ? maxCalPoints : Infinity;

  useEffect(() => {
    const img = new Image();
    img.onload = () => setLoadedImg(img);
    img.src = image.url;
    return () => {
      img.onload = null;
    };
  }, [image.url]);

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

  // The svg uses the default "xMidYMid meet" preserveAspectRatio: it scales
  // uniformly to fit and letterboxes/centers any leftover space, rather than
  // stretching width/height independently. Screen<->image conversions must
  // mirror that exact transform, or clicks drift off-target whenever the
  // container's aspect ratio doesn't happen to match the photo's.
  function meetTransform(rect: { left: number; top: number; width: number; height: number }, v: ViewBox) {
    const scale = Math.min(rect.width / v.w, rect.height / v.h);
    return {
      scale,
      offsetX: rect.left + (rect.width - v.w * scale) / 2,
      offsetY: rect.top + (rect.height - v.h * scale) / 2,
    };
  }

  const clientToImage = useCallback((clientX: number, clientY: number): Point | null => {
    const svg = svgRef.current;
    const v = vbRef.current;
    if (!svg || !v) return null;
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    const { scale, offsetX, offsetY } = meetTransform(rect, v);
    return {
      x: v.x + (clientX - offsetX) / scale,
      y: v.y + (clientY - offsetY) / scale,
    };
  }, []);

  const zoomAt = useCallback(
    (clientX: number, clientY: number, factor: number) => {
      const current = vbRef.current;
      const svg = svgRef.current;
      if (!current || !svg) return;
      const rect = svg.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const { scale, offsetX, offsetY } = meetTransform(rect, current);
      const px = current.x + (clientX - offsetX) / scale;
      const py = current.y + (clientY - offsetY) / scale;
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

  function updateLoupe(clientX: number, clientY: number) {
    const svg = svgRef.current;
    const v = vbRef.current;
    const pt = clientToImage(clientX, clientY);
    if (!svg || !v || !pt) return;
    const rect = svg.getBoundingClientRect();
    const { scale } = meetTransform(rect, v);
    setLoupe({ clientX, clientY, imagePoint: pt, screenPxPerImagePx: scale });
  }

  function hitTestActivePoint(clientX: number, clientY: number): number | null {
    const svg = svgRef.current;
    const v = vbRef.current;
    const pt = clientToImage(clientX, clientY);
    if (!svg || !v || !pt) return null;
    const rect = svg.getBoundingClientRect();
    const { scale: screenPxPerImagePx } = meetTransform(rect, v);
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
      setLoupe(null);
    } else {
      const dragIndex = hitTestActivePoint(event.clientX, event.clientY);
      gesture.current = { moved: false, dragIndex, startX: event.clientX, startY: event.clientY };
      if (dragIndex != null) onSelectedIndexChange(dragIndex);
      updateLoupe(event.clientX, event.clientY);
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
        updateLoupe(event.clientX, event.clientY);
      } else {
        const current = vbRef.current;
        const rect = svgRef.current!.getBoundingClientRect();
        const { scale } = meetTransform(rect, current);
        const dx = event.movementX / scale;
        const dy = event.movementY / scale;
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
        const nextIndex = activePoints.length;
        setActivePoints([...activePoints, pt]);
        onSelectedIndexChange(nextIndex);
      } else {
        onSelectedIndexChange(null);
      }
    }
    gesture.current = null;
    setLoupe(null);
    if (pointers.current.size === 0) setIsDragging(false);
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // capture may already be released by the browser
    }
  }

  if (!vb) return null;

  // Screen-px targets converted into viewBox units so rendered size tracks
  // real container width instead of vb.w (which shrinks on zoom-in and has
  // no relationship to how large the container actually renders on screen).
  const effectiveRenderWidthPx = renderWidthPx || vb.w;
  const screenToVb = vb.w / effectiveRenderWidthPx;
  const pointRadius = widthScaledPx(renderWidthPx, DOT_MIN_SCREEN_PX, DOT_MAX_SCREEN_PX) * screenToVb;
  const fontSize = widthScaledPx(renderWidthPx, LABEL_FONT_MIN_SCREEN_PX, LABEL_FONT_MAX_SCREEN_PX) * screenToVb;
  const labelCollisionVb = LABEL_COLLISION_SCREEN_PX * screenToVb;
  const calDone = calPoints.length >= maxCalPoints;

  const measurementPairs: [Point, Point][] = [];
  for (let i = 0; i + 1 < measurePoints.length; i += 2) {
    measurementPairs.push([measurePoints[i], measurePoints[i + 1]]);
  }

  // Greedy label placement: default position is above the segment midpoint;
  // if that collides with an already-placed label (crowded measurements on
  // one photo), push it out perpendicular to the segment and draw a leader
  // line back to the true midpoint instead of letting text overlap.
  const placedLabels: { lx: number; ly: number }[] = [];
  const labelPlacements = measurementPairs.map(([a, b], i) => {
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    let lx = mx;
    let ly = my - pointRadius * 0.9;
    let leader = false;
    for (const other of placedLabels) {
      if (Math.hypot(lx - other.lx, ly - other.ly) < labelCollisionVb) {
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const segLen = Math.hypot(dx, dy) || 1;
        const nx = -dy / segLen;
        const ny = dx / segLen;
        const sign = i % 2 === 0 ? 1 : -1;
        lx += nx * labelCollisionVb * 1.5 * sign;
        ly += ny * labelCollisionVb * 1.5 * sign;
        leader = true;
      }
    }
    placedLabels.push({ lx, ly });
    return { mx, my, lx, ly, leader };
  });

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
        {calPoints.map((p, i) => {
          const isSelected = tool === "calibrate" && selectedIndex === i;
          return (
            <g key={`cal-${i}`} opacity={tool === "calibrate" ? 1 : 0.4}>
              <circle
                cx={p.x}
                cy={p.y}
                r={isSelected ? pointRadius * 1.35 : pointRadius}
                fill="#f59e0b33"
                stroke="#f59e0b"
                strokeWidth={isSelected ? pointRadius * 0.4 : pointRadius * 0.22}
              />
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
          );
        })}

        {extraSegments?.map((seg, i) => {
          const mx = (seg.ptA.x + seg.ptB.x) / 2;
          const my = (seg.ptA.y + seg.ptB.y) / 2;
          return (
            <g key={`extra-${i}`} opacity={0.55}>
              <line x1={seg.ptA.x} y1={seg.ptA.y} x2={seg.ptB.x} y2={seg.ptB.y} stroke="#2563eb" strokeWidth={pointRadius * 0.28} />
              <text
                x={mx}
                y={my - pointRadius * 0.9}
                textAnchor="middle"
                fontSize={fontSize * 0.95}
                fontWeight={600}
                fill="#1e3a8a"
                stroke="#ffffffcc"
                strokeWidth={fontSize * 0.15}
                paintOrder="stroke"
              >
                {seg.label}
              </text>
            </g>
          );
        })}

        {measurementPairs.map(([a, b], i) => {
          const inches = measureFn ? measureFn(a, b) : null;
          const label = inches != null ? `M${i + 1} ${formatFractionInches(inches, 16)}"` : `M${i + 1}`;
          const placement = labelPlacements[i]!;
          return (
            <g key={`m-${i}`} opacity={tool === "measure" ? 1 : 0.55}>
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#0284c7" strokeWidth={pointRadius * 0.32} />
              {placement.leader && (
                <line
                  x1={placement.mx}
                  y1={placement.my}
                  x2={placement.lx}
                  y2={placement.ly}
                  stroke="#0284c7"
                  strokeWidth={pointRadius * 0.14}
                  strokeDasharray={`${pointRadius * 0.25} ${pointRadius * 0.25}`}
                />
              )}
              <text
                x={placement.lx}
                y={placement.ly}
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
        {measurePoints.map((p, i) => {
          const isSelected = tool === "measure" && selectedIndex === i;
          return (
            <circle
              key={`mp-${i}`}
              cx={p.x}
              cy={p.y}
              r={isSelected ? pointRadius * 0.85 : pointRadius * 0.55}
              fill="#0284c744"
              stroke="#0284c7"
              strokeWidth={isSelected ? pointRadius * 0.36 : pointRadius * 0.2}
              opacity={tool === "measure" ? 1 : 0.55}
            />
          );
        })}
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

      {loupe && loadedImg && (
        <Loupe
          clientX={loupe.clientX}
          clientY={loupe.clientY}
          image={loadedImg}
          imagePoint={loupe.imagePoint}
          screenPxPerImagePx={loupe.screenPxPerImagePx}
        />
      )}
    </div>
  );
}

function Loupe({
  clientX,
  clientY,
  image,
  imagePoint,
  screenPxPerImagePx,
}: {
  clientX: number;
  clientY: number;
  image: HTMLImageElement;
  imagePoint: Point | null;
  screenPxPerImagePx: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !imagePoint) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const srcSize = LOUPE_SIZE / (Math.max(screenPxPerImagePx, 1e-6) * LOUPE_ZOOM);
    const sx = Math.max(0, Math.min(image.naturalWidth - srcSize, imagePoint.x - srcSize / 2));
    const sy = Math.max(0, Math.min(image.naturalHeight - srcSize, imagePoint.y - srcSize / 2));

    ctx.clearRect(0, 0, LOUPE_SIZE, LOUPE_SIZE);
    ctx.drawImage(image, sx, sy, srcSize, srcSize, 0, 0, LOUPE_SIZE, LOUPE_SIZE);
    ctx.strokeStyle = "#dc2626";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(LOUPE_SIZE / 2, 0);
    ctx.lineTo(LOUPE_SIZE / 2, LOUPE_SIZE);
    ctx.moveTo(0, LOUPE_SIZE / 2);
    ctx.lineTo(LOUPE_SIZE, LOUPE_SIZE / 2);
    ctx.stroke();
  }, [image, imagePoint, screenPxPerImagePx]);

  if (!imagePoint) return null;

  const left = Math.min(
    typeof window !== "undefined" ? window.innerWidth - LOUPE_SIZE - 8 : clientX,
    clientX + 16,
  );
  const top = Math.max(8, clientY - LOUPE_SIZE - 24);

  return (
    <canvas
      ref={canvasRef}
      width={LOUPE_SIZE}
      height={LOUPE_SIZE}
      className="pointer-events-none fixed z-50 rounded-full border-2 border-primary shadow-lg"
      style={{ left, top, width: LOUPE_SIZE, height: LOUPE_SIZE }}
    />
  );
}
