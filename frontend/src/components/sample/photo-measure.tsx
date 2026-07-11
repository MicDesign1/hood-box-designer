"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, Check, RotateCcw, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { parseImperialInput } from "@/lib/imperial";
import {
  computeHomographyFromCorners,
  distanceInches,
  validateCalibration,
  type Matrix3x3,
  type Pt,
  PhotoMeasureError,
} from "@/lib/photoMeasure";
import type { SampleMeasurements } from "@/types/sample";

export type CalibrationMode = "letter" | "known";

export type PhotoCalibration =
  | {
      mode: "letter";
      imageUrl: string;
      imageWidth: number;
      imageHeight: number;
      corners: Pt[];
      homography: Matrix3x3;
    }
  | {
      mode: "known";
      imageUrl: string;
      imageWidth: number;
      imageHeight: number;
      points: Pt[];
      knownInches: number;
      pxPerInch: number;
    };

export type PhotoSegment = {
  ptA: Pt;
  ptB: Pt;
  inches: number;
};

type PhotoMeasureOverlayProps = {
  open: boolean;
  mode: "calibrate" | "measure";
  measureFieldLabel?: string;
  calibration: PhotoCalibration | null;
  segments: Partial<Record<keyof SampleMeasurements, PhotoSegment>>;
  onClose: () => void;
  onCalibrationComplete: (calibration: PhotoCalibration) => void;
  onMeasureComplete: (field: keyof SampleMeasurements, inches: number, segment: PhotoSegment) => void;
  measureField: keyof SampleMeasurements | null;
};

const LOUPE_SIZE = 120;
const LOUPE_ZOOM = 3;
const NUDGE_STEP = 1;

function pixelDist(a: Pt, b: Pt): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function measureDistance(cal: PhotoCalibration, ptA: Pt, ptB: Pt): number {
  if (cal.mode === "letter") {
    return distanceInches(cal.homography, ptA, ptB);
  }
  return pixelDist(ptA, ptB) / cal.pxPerInch;
}

function clientToImage(
  clientX: number,
  clientY: number,
  canvas: HTMLCanvasElement,
  imageWidth: number,
  imageHeight: number,
): Pt {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((clientX - rect.left) / rect.width) * imageWidth,
    y: ((clientY - rect.top) / rect.height) * imageHeight,
  };
}

function imageToCanvas(
  pt: Pt,
  canvas: HTMLCanvasElement,
  imageWidth: number,
  imageHeight: number,
): Pt {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (pt.x / imageWidth) * rect.width,
    y: (pt.y / imageHeight) * rect.height,
  };
}

function nearestPointIndex(
  pt: Pt,
  points: Pt[],
  thresholdPx: number,
  canvas: HTMLCanvasElement,
  iw: number,
  ih: number,
): number {
  let best = -1;
  let bestDist = thresholdPx;
  points.forEach((c, i) => {
    const cc = imageToCanvas(c, canvas, iw, ih);
    const cp = imageToCanvas(pt, canvas, iw, ih);
    const d = Math.hypot(cc.x - cp.x, cc.y - cp.y);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  });
  return best;
}

export function PhotoMeasureOverlay({
  open,
  mode,
  measureFieldLabel,
  calibration,
  segments,
  onClose,
  onCalibrationComplete,
  onMeasureComplete,
  measureField,
}: PhotoMeasureOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [imageUrl, setImageUrl] = useState<string | null>(calibration?.imageUrl ?? null);
  const [imageSize, setImageSize] = useState({ w: calibration?.imageWidth ?? 0, h: calibration?.imageHeight ?? 0 });
  const [calibrationMode, setCalibrationMode] = useState<CalibrationMode>(
    calibration?.mode ?? "letter",
  );
  const [calPoints, setCalPoints] = useState<Pt[]>(
    calibration?.mode === "letter" ? calibration.corners : calibration?.mode === "known" ? calibration.points : [],
  );
  const [knownLengthInput, setKnownLengthInput] = useState(
    calibration?.mode === "known" ? String(calibration.knownInches) : "",
  );
  const [activeCalibration, setActiveCalibration] = useState<PhotoCalibration | null>(calibration);
  const [selectedPoint, setSelectedPoint] = useState<number | null>(null);
  const [measurePts, setMeasurePts] = useState<Pt[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loupe, setLoupe] = useState<{ x: number; y: number; visible: boolean }>({ x: 0, y: 0, visible: false });
  const [fallbackOpen, setFallbackOpen] = useState(calibration?.mode === "known");

  const calibrationDone = activeCalibration !== null;
  const maxCalPoints = calibrationMode === "letter" ? 4 : 2;

  useEffect(() => {
    if (!open) return;
    setImageUrl(calibration?.imageUrl ?? null);
    setImageSize({ w: calibration?.imageWidth ?? 0, h: calibration?.imageHeight ?? 0 });
    setCalibrationMode(calibration?.mode ?? "letter");
    setCalPoints(
      calibration?.mode === "letter"
        ? calibration.corners
        : calibration?.mode === "known"
          ? calibration.points
          : [],
    );
    setKnownLengthInput(calibration?.mode === "known" ? String(calibration.knownInches) : "");
    setActiveCalibration(calibration);
    setFallbackOpen(calibration?.mode === "known");
    setMeasurePts([]);
    setSelectedPoint(null);
    setError(null);
  }, [open, calibration]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const img = imageRef.current;
    if (!canvas || !img || !imageUrl) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * devicePixelRatio;
    canvas.height = rect.height * devicePixelRatio;
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);
    ctx.drawImage(img, 0, 0, rect.width, rect.height);

    const toCanvas = (p: Pt) => imageToCanvas(p, canvas, imageSize.w, imageSize.h);

    Object.values(segments).forEach((seg) => {
      if (!seg) return;
      const a = toCanvas(seg.ptA);
      const b = toCanvas(seg.ptB);
      ctx.strokeStyle = "#2563eb";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.fillStyle = "#2563eb";
      ctx.font = "12px sans-serif";
      ctx.fillText(`${seg.inches.toFixed(2)}"`, (a.x + b.x) / 2 + 4, (a.y + b.y) / 2 - 4);
    });

    if (measurePts.length === 2 && activeCalibration) {
      const a = toCanvas(measurePts[0]!);
      const b = toCanvas(measurePts[1]!);
      const inches = measureDistance(activeCalibration, measurePts[0]!, measurePts[1]!);
      ctx.strokeStyle = "#dc2626";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.fillStyle = "#dc2626";
      ctx.font = "bold 13px sans-serif";
      ctx.fillText(`${inches.toFixed(2)}"`, (a.x + b.x) / 2 + 4, (a.y + b.y) / 2 - 4);
    } else if (measurePts.length === 1) {
      const a = toCanvas(measurePts[0]!);
      ctx.fillStyle = "#dc2626";
      ctx.beginPath();
      ctx.arc(a.x, a.y, 5, 0, Math.PI * 2);
      ctx.fill();
    }

    calPoints.forEach((c, i) => {
      const p = toCanvas(c);
      ctx.fillStyle = selectedPoint === i ? "#dc2626" : "#16a34a";
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#fff";
      ctx.font = "bold 10px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(i + 1), p.x, p.y);
    });
  }, [imageUrl, imageSize, calPoints, selectedPoint, measurePts, activeCalibration, segments]);

  useEffect(() => {
    if (!imageUrl) return;
    const img = new Image();
    img.onload = () => {
      imageRef.current = img;
      setImageSize({ w: img.naturalWidth, h: img.naturalHeight });
      requestAnimationFrame(draw);
    };
    img.src = imageUrl;
  }, [imageUrl, draw]);

  useEffect(() => {
    draw();
  }, [draw, calPoints, measurePts, segments, selectedPoint, loupe.visible]);

  useEffect(() => {
    const onResize = () => draw();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [draw]);

  function handleFile(file: File) {
    const url = URL.createObjectURL(file);
    setImageUrl(url);
    setCalPoints([]);
    setActiveCalibration(null);
    setMeasurePts([]);
    setError(null);
    setSelectedPoint(null);
  }

  function switchCalibrationMode(next: CalibrationMode) {
    setCalibrationMode(next);
    setCalPoints([]);
    setActiveCalibration(null);
    setSelectedPoint(null);
    setError(null);
    setFallbackOpen(next === "known");
    if (next === "letter") {
      setKnownLengthInput("");
    }
  }

  function tryFinalizeCalibration(nextPoints: Pt[], knownInput = knownLengthInput) {
    if (!imageUrl || !imageSize.w) return;

    if (calibrationMode === "letter") {
      if (nextPoints.length < 4) return;
      try {
        const h = computeHomographyFromCorners(nextPoints);
        validateCalibration(h, nextPoints);
        const cal: PhotoCalibration = {
          mode: "letter",
          imageUrl,
          imageWidth: imageSize.w,
          imageHeight: imageSize.h,
          corners: nextPoints,
          homography: h,
        };
        setActiveCalibration(cal);
        setError(null);
        onCalibrationComplete(cal);
      } catch (err) {
        setActiveCalibration(null);
        setError(err instanceof PhotoMeasureError ? err.message : "Could not calibrate — re-tap corners.");
      }
      return;
    }

    if (nextPoints.length < 2) return;
    const knownInches = parseImperialInput(knownInput);
    if (knownInches === null || knownInches <= 0) {
      setActiveCalibration(null);
      return;
    }
    const px = pixelDist(nextPoints[0]!, nextPoints[1]!);
    if (px <= 0) {
      setActiveCalibration(null);
      setError("Place two distinct points for the known length.");
      return;
    }
    const cal: PhotoCalibration = {
      mode: "known",
      imageUrl,
      imageWidth: imageSize.w,
      imageHeight: imageSize.h,
      points: nextPoints,
      knownInches,
      pxPerInch: px / knownInches,
    };
    setActiveCalibration(cal);
    setError(null);
    onCalibrationComplete(cal);
  }

  function handleCanvasPointer(clientX: number, clientY: number) {
    const canvas = canvasRef.current;
    if (!canvas || !imageSize.w) return;
    const pt = clientToImage(clientX, clientY, canvas, imageSize.w, imageSize.h);

    if (mode === "calibrate" || !calibrationDone) {
      const near = nearestPointIndex(pt, calPoints, 28, canvas, imageSize.w, imageSize.h);
      if (near >= 0) {
        const updated = [...calPoints];
        updated[near] = pt;
        setCalPoints(updated);
        setSelectedPoint(near);
        tryFinalizeCalibration(updated);
        return;
      }
      if (calPoints.length < maxCalPoints) {
        const updated = [...calPoints, pt];
        setCalPoints(updated);
        setSelectedPoint(updated.length - 1);
        tryFinalizeCalibration(updated);
      }
      return;
    }

    if (!activeCalibration || !measureField) return;
    if (measurePts.length === 0) {
      setMeasurePts([pt]);
    } else if (measurePts.length === 1) {
      const inches = measureDistance(activeCalibration, measurePts[0]!, pt);
      const rounded = Math.round(inches * 100) / 100;
      const segment = { ptA: measurePts[0]!, ptB: pt, inches: rounded };
      onMeasureComplete(measureField, rounded, segment);
      setMeasurePts([]);
      onClose();
    }
  }

  function nudgePoint(dx: number, dy: number) {
    if (selectedPoint === null || !calPoints[selectedPoint]) return;
    const updated = [...calPoints];
    updated[selectedPoint] = {
      x: updated[selectedPoint]!.x + dx,
      y: updated[selectedPoint]!.y + dy,
    };
    setCalPoints(updated);
    tryFinalizeCalibration(updated);
  }

  function resetCalPoints() {
    setCalPoints([]);
    setActiveCalibration(null);
    setSelectedPoint(null);
    setError(null);
  }

  if (!open) return null;

  const calibrateSubtitle =
    calibrationMode === "letter"
      ? `Tap 4 corners of the letter-size sheet (${calPoints.length}/4)`
      : `Tap 2 ends of a known length (${calPoints.length}/2)`;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      <header className="flex items-center gap-2 border-b px-3 py-3">
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
          <X className="size-5" />
        </Button>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">
            {mode === "measure" && measureFieldLabel
              ? `Measure: ${measureFieldLabel}`
              : "Calibrate scale from photo"}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {mode === "measure" ? "Tap two points — crease to crease" : calibrateSubtitle}
          </p>
        </div>
      </header>

      {(mode === "calibrate" || !calibrationDone) && (
        <div className="space-y-3 border-b px-4 py-3">
          <Button
            className="h-auto w-full justify-start px-4 py-3 text-left"
            variant={calibrationMode === "letter" ? "default" : "outline"}
            onClick={() => switchCalibrationMode("letter")}
          >
            <span className="font-semibold">Letter-size sheet (8.5 × 11)</span>
          </Button>
          {calibrationMode === "letter" && (
            <p className="text-sm text-muted-foreground">
              Lay a letter-size sheet flat on the same surface as the blank, fully visible, then tap its
              four corners.
            </p>
          )}

          <details open={fallbackOpen} onToggle={(e) => setFallbackOpen(e.currentTarget.open)}>
            <summary className="cursor-pointer text-sm text-muted-foreground">
              No letter paper on hand?
            </summary>
            <div className="mt-3 space-y-3">
              <Button
                className="w-full"
                variant={calibrationMode === "known" ? "default" : "outline"}
                onClick={() => switchCalibrationMode("known")}
              >
                Known dimension (2 points)
              </Button>
              {calibrationMode === "known" && (
                <>
                  <p className="text-sm text-muted-foreground">
                    Tap the two ends of a known length (ruler, tape, printed scale).
                  </p>
                  <div className="space-y-2">
                    <Label htmlFor="known-length">Known length between the 2 points (in)</Label>
                    <Input
                      id="known-length"
                      inputMode="decimal"
                      placeholder="e.g. 12 or 12 1/2"
                      value={knownLengthInput}
                      onChange={(e) => {
                        const next = e.target.value;
                        setKnownLengthInput(next);
                        tryFinalizeCalibration(calPoints, next);
                      }}
                      className="h-11"
                    />
                  </div>
                </>
              )}
            </div>
          </details>
        </div>
      )}

      {!imageUrl ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6">
          <Camera className="size-12 text-muted-foreground" />
          <p className="text-center text-sm text-muted-foreground">
            Take or choose a photo with the blank and your scale reference visible.
          </p>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFile(file);
            }}
          />
          <Button size="lg" onClick={() => fileRef.current?.click()}>
            <Camera className="size-4" />
            Choose photo
          </Button>
        </div>
      ) : (
        <>
          <div className="relative min-h-0 flex-1 touch-none">
            <canvas
              ref={canvasRef}
              className="h-full w-full"
              onPointerDown={(e) => {
                e.preventDefault();
                setLoupe({ x: e.clientX, y: e.clientY, visible: true });
                handleCanvasPointer(e.clientX, e.clientY);
              }}
              onPointerMove={(e) => {
                if (e.buttons > 0) {
                  setLoupe({ x: e.clientX, y: e.clientY, visible: true });
                }
              }}
              onPointerUp={() => setLoupe((l) => ({ ...l, visible: false }))}
              onPointerLeave={() => setLoupe((l) => ({ ...l, visible: false }))}
            />
            {loupe.visible && canvasRef.current && imageRef.current && (
              <Loupe
                clientX={loupe.x}
                clientY={loupe.y}
                canvas={canvasRef.current}
                image={imageRef.current}
                imageWidth={imageSize.w}
                imageHeight={imageSize.h}
              />
            )}
          </div>

          {error && <p className="border-t px-4 py-2 text-sm text-destructive">{error}</p>}

          {(mode === "calibrate" || !calibrationDone) && calPoints.length > 0 && (
            <div className="flex items-center justify-center gap-2 border-t px-4 py-3">
              <span className="text-sm text-muted-foreground">Nudge point:</span>
              <Button variant="outline" size="icon" disabled={selectedPoint === null} onClick={() => nudgePoint(0, -NUDGE_STEP)} aria-label="Up">
                ↑
              </Button>
              <Button variant="outline" size="icon" disabled={selectedPoint === null} onClick={() => nudgePoint(-NUDGE_STEP, 0)} aria-label="Left">
                ←
              </Button>
              <Button variant="outline" size="icon" disabled={selectedPoint === null} onClick={() => nudgePoint(NUDGE_STEP, 0)} aria-label="Right">
                →
              </Button>
              <Button variant="outline" size="icon" disabled={selectedPoint === null} onClick={() => nudgePoint(0, NUDGE_STEP)} aria-label="Down">
                ↓
              </Button>
              <Button variant="ghost" size="sm" onClick={resetCalPoints}>
                <RotateCcw className="size-4" />
                Reset
              </Button>
            </div>
          )}

          {calibrationDone && mode === "calibrate" && (
            <div className="border-t p-4">
              <Button className="w-full" onClick={onClose}>
                <Check className="size-4" />
                Calibration saved — back to form
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Loupe({
  clientX,
  clientY,
  canvas,
  image,
  imageWidth,
  imageHeight,
}: {
  clientX: number;
  clientY: number;
  canvas: HTMLCanvasElement;
  image: HTMLImageElement;
  imageWidth: number;
  imageHeight: number;
}) {
  const loupeRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const loupeCanvas = loupeRef.current;
    if (!loupeCanvas) return;
    const ctx = loupeCanvas.getContext("2d");
    if (!ctx) return;

    const pt = clientToImage(clientX, clientY, canvas, imageWidth, imageHeight);
    const srcSize = LOUPE_SIZE / LOUPE_ZOOM;
    const sx = Math.max(0, Math.min(imageWidth - srcSize, pt.x - srcSize / 2));
    const sy = Math.max(0, Math.min(imageHeight - srcSize, pt.y - srcSize / 2));

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
  }, [clientX, clientY, canvas, image, imageWidth, imageHeight]);

  const left = Math.min(window.innerWidth - LOUPE_SIZE - 8, clientX + 16);
  const top = Math.max(8, clientY - LOUPE_SIZE - 24);

  return (
    <canvas
      ref={loupeRef}
      width={LOUPE_SIZE}
      height={LOUPE_SIZE}
      className="pointer-events-none fixed z-50 rounded-full border-2 border-primary shadow-lg"
      style={{ left, top, width: LOUPE_SIZE, height: LOUPE_SIZE }}
    />
  );
}

export function PhotoMeasureLauncher({
  onOpenCalibrate,
  hasCalibration,
}: {
  onOpenCalibrate: () => void;
  hasCalibration: boolean;
}) {
  return (
    <div className="rounded-xl border border-dashed bg-card p-4">
      <p className="text-sm font-medium">Measure from photo</p>
      <p className="mt-1 text-sm text-muted-foreground">
        Calibrate with a letter-size sheet, then tap creases on the photo.
      </p>
      <Button variant="outline" className="mt-3 w-full" onClick={onOpenCalibrate}>
        <Camera className="size-4" />
        {hasCalibration ? "Open photo / recalibrate" : "Take or choose photo"}
      </Button>
    </div>
  );
}
