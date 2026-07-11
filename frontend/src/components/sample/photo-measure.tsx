"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Camera, Check, RotateCcw, X } from "lucide-react";

import { PhotoStage, type PhotoImage } from "@/components/photo-stage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { parseImperialInput } from "@/lib/imperial";
import {
  REFERENCE_OBJECTS,
  computeCalibration,
  measureInches,
  requiredCalPoints,
  type Point,
  type ReferenceId,
} from "@/lib/photo-calibration";
import type { SampleMeasurements } from "@/types/sample";

const NUDGE_STEP = 1;

export interface PhotoCalibration {
  imageUrl: string;
  imageWidth: number;
  imageHeight: number;
  refId: ReferenceId;
  calPoints: Point[];
  customLengthInches: number | null;
}

export type PhotoSegment = {
  ptA: Point;
  ptB: Point;
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
  const fileRef = useRef<HTMLInputElement>(null);

  const [imageUrl, setImageUrl] = useState<string | null>(calibration?.imageUrl ?? null);
  const [imageSize, setImageSize] = useState({ w: calibration?.imageWidth ?? 0, h: calibration?.imageHeight ?? 0 });
  const [refId, setRefId] = useState<ReferenceId>(calibration?.refId ?? "sheet");
  const [customLengthInput, setCustomLengthInput] = useState(
    calibration?.customLengthInches != null ? String(calibration.customLengthInches) : "",
  );
  const [calPoints, setCalPoints] = useState<Point[]>(calibration?.calPoints ?? []);
  const [measurePoints, setMeasurePoints] = useState<Point[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fitSignal, setFitSignal] = useState(0);
  const [fallbackOpen, setFallbackOpen] = useState(calibration ? calibration.refId !== "sheet" : false);

  const customLengthInches = parseImperialInput(customLengthInput);
  const maxCalPoints = requiredCalPoints(refId);
  const calibrationObj = imageUrl && imageSize.w ? computeCalibration(refId, calPoints, customLengthInches) : null;
  const calibrationDone = calibrationObj !== null;
  const showCalibratePanel = mode === "calibrate" || !calibrationDone;
  const tool: "calibrate" | "measure" = showCalibratePanel ? "calibrate" : "measure";

  useEffect(() => {
    if (!open) return;
    setImageUrl(calibration?.imageUrl ?? null);
    setImageSize({ w: calibration?.imageWidth ?? 0, h: calibration?.imageHeight ?? 0 });
    setRefId(calibration?.refId ?? "sheet");
    setCustomLengthInput(calibration?.customLengthInches != null ? String(calibration.customLengthInches) : "");
    setCalPoints(calibration?.calPoints ?? []);
    setFallbackOpen(calibration ? calibration.refId !== "sheet" : false);
    setMeasurePoints([]);
    setSelectedIndex(null);
    setError(null);
    setFitSignal((s) => s + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function finalizeCalibration(nextCalPoints: Point[], nextRefId: ReferenceId, nextCustomLengthInches: number | null) {
    if (!imageUrl || !imageSize.w) return;
    const required = requiredCalPoints(nextRefId);
    if (nextCalPoints.length < required) return;
    const cal = computeCalibration(nextRefId, nextCalPoints, nextCustomLengthInches);
    if (!cal) {
      setError(
        nextRefId === "custom" ? "Enter a valid known length." : "Corners don't form a rectangle — re-tap.",
      );
      return;
    }
    setError(null);
    onCalibrationComplete({
      imageUrl,
      imageWidth: imageSize.w,
      imageHeight: imageSize.h,
      refId: nextRefId,
      calPoints: nextCalPoints,
      customLengthInches: nextCustomLengthInches,
    });
  }

  function handleFile(file: File) {
    const url = URL.createObjectURL(file);
    const probe = new Image();
    probe.onload = () => {
      setImageSize({ w: probe.naturalWidth, h: probe.naturalHeight });
      setFitSignal((s) => s + 1);
    };
    probe.src = url;
    setImageUrl(url);
    setCalPoints([]);
    setMeasurePoints([]);
    setSelectedIndex(null);
    setError(null);
  }

  function selectReference(next: ReferenceId) {
    setRefId(next);
    setCalPoints([]);
    setSelectedIndex(null);
    setError(null);
    setFallbackOpen(next !== "sheet");
  }

  function handleCalPointsChange(next: Point[]) {
    setCalPoints(next);
    finalizeCalibration(next, refId, customLengthInches);
  }

  function handleCustomLengthChange(value: string) {
    setCustomLengthInput(value);
    const parsed = parseImperialInput(value);
    if (calPoints.length >= 2) finalizeCalibration(calPoints, refId, parsed);
  }

  function handleMeasurePointsChange(next: Point[]) {
    setMeasurePoints(next);
    if (next.length >= 2 && calibrationObj && measureField) {
      const inches = measureInches(calibrationObj, next[0]!, next[1]!);
      const rounded = Math.round(inches * 100) / 100;
      const segment: PhotoSegment = { ptA: next[0]!, ptB: next[1]!, inches: rounded };
      onMeasureComplete(measureField, rounded, segment);
      setMeasurePoints([]);
      setSelectedIndex(null);
      onClose();
    }
  }

  function nudgeSelected(dx: number, dy: number) {
    if (selectedIndex === null || !calPoints[selectedIndex]) return;
    const updated = [...calPoints];
    updated[selectedIndex] = { x: updated[selectedIndex]!.x + dx, y: updated[selectedIndex]!.y + dy };
    handleCalPointsChange(updated);
  }

  function resetCalPoints() {
    setCalPoints([]);
    setSelectedIndex(null);
    setError(null);
  }

  const measureFn = calibrationObj ? (a: Point, b: Point) => measureInches(calibrationObj, a, b) : null;
  const extraSegments = Object.values(segments)
    .filter((seg): seg is PhotoSegment => seg != null)
    .map((seg) => ({ ptA: seg.ptA, ptB: seg.ptB, label: `${seg.inches.toFixed(2)}"` }));

  if (!open) return null;

  const fallbackRefs = REFERENCE_OBJECTS.filter((r) => r.id !== "sheet");

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      <header className="flex items-center gap-2 border-b px-3 py-3">
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
          <X className="size-5" />
        </Button>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">
            {mode === "measure" && measureFieldLabel ? `Measure: ${measureFieldLabel}` : "Calibrate scale from photo"}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {mode === "measure"
              ? "Tap two points — crease to crease"
              : `${REFERENCE_OBJECTS.find((r) => r.id === refId)?.label} — ${calPoints.length}/${maxCalPoints} points`}
          </p>
        </div>
      </header>

      {showCalibratePanel && (
        <div className="space-y-3 border-b px-4 py-3">
          <Button
            className="h-auto w-full justify-start px-4 py-3 text-left"
            variant={refId === "sheet" ? "default" : "outline"}
            onClick={() => selectReference("sheet")}
          >
            <span className="font-semibold">Letter-size sheet (8.5 × 11)</span>
          </Button>
          {refId === "sheet" && (
            <p className="text-sm text-muted-foreground">
              Lay a letter-size sheet flat on the same surface as the blank, fully visible, then tap its four
              corners.
            </p>
          )}

          <details open={fallbackOpen} onToggle={(e) => setFallbackOpen(e.currentTarget.open)}>
            <summary className="cursor-pointer text-sm text-muted-foreground">No letter paper on hand?</summary>
            <div className="mt-3 space-y-3">
              {fallbackRefs.map((r) => (
                <Button
                  key={r.id}
                  className="w-full"
                  variant={refId === r.id ? "default" : "outline"}
                  onClick={() => selectReference(r.id)}
                >
                  {r.label}
                  {r.dimensions ? ` (${r.dimensions[0]}" × ${r.dimensions[1]}")` : ""}
                </Button>
              ))}
              {refId === "custom" && (
                <>
                  <p className="text-sm text-muted-foreground">
                    Tap the two ends of a known length (ruler, tape, printed scale). Shoot straight overhead for
                    best accuracy.
                  </p>
                  <div className="space-y-2">
                    <Label htmlFor="known-length">Known length between the 2 points (in)</Label>
                    <Input
                      id="known-length"
                      inputMode="decimal"
                      placeholder="e.g. 12 or 12 1/2"
                      value={customLengthInput}
                      onChange={(e) => handleCustomLengthChange(e.target.value)}
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
          <div className="relative min-h-0 flex-1">
            <PhotoStage
              key={imageUrl}
              image={{ url: imageUrl, w: imageSize.w, h: imageSize.h } as PhotoImage}
              tool={tool}
              calPoints={calPoints}
              measurePoints={measurePoints}
              maxCalPoints={maxCalPoints}
              measureFn={measureFn}
              onCalPointsChange={handleCalPointsChange}
              onMeasurePointsChange={handleMeasurePointsChange}
              selectedIndex={selectedIndex}
              onSelectedIndexChange={setSelectedIndex}
              fitSignal={fitSignal}
              extraSegments={extraSegments}
            />
          </div>

          {error && <p className="border-t px-4 py-2 text-sm text-destructive">{error}</p>}

          {showCalibratePanel && calPoints.length > 0 && (
            <div className="flex items-center justify-center gap-2 border-t px-4 py-3">
              <span className="text-sm text-muted-foreground">Nudge point:</span>
              <Button
                variant="outline"
                size="icon"
                disabled={selectedIndex === null}
                onClick={() => nudgeSelected(0, -NUDGE_STEP)}
                aria-label="Up"
              >
                <ArrowUp className="size-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                disabled={selectedIndex === null}
                onClick={() => nudgeSelected(-NUDGE_STEP, 0)}
                aria-label="Left"
              >
                <ArrowLeft className="size-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                disabled={selectedIndex === null}
                onClick={() => nudgeSelected(NUDGE_STEP, 0)}
                aria-label="Right"
              >
                <ArrowRight className="size-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                disabled={selectedIndex === null}
                onClick={() => nudgeSelected(0, NUDGE_STEP)}
                aria-label="Down"
              >
                <ArrowDown className="size-4" />
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
