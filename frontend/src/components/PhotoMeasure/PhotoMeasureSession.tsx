"use client";

import { useRef, useState } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Camera,
  Check,
  Ruler,
  Trash2,
  Undo2,
  Upload,
  X,
} from "lucide-react";

import { PhotoStage, type PhotoImage } from "@/components/photo-stage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatFractionInches, parseImperialInput } from "@/lib/imperial";
import {
  CORNER_ORDER,
  REFERENCE_OBJECTS,
  computeCalibration,
  measureInches,
  requiredCalPoints,
  type Calibration,
  type Point,
  type ReferenceId,
} from "@/lib/photo-calibration";
import { cn } from "@/lib/utils";
import type { LockedMeasurement, PhotoMeasureSessionProps, PhotoSegment } from "./types";

const NUDGE_STEP = 1;

export function PhotoMeasureSession({
  dimensions,
  presentation,
  initialCalibration = null,
  onLockDimension,
  onCalibrationChange,
  onComplete,
  onCancel,
}: PhotoMeasureSessionProps) {
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const [image, setImage] = useState<PhotoImage | null>(
    initialCalibration
      ? { url: initialCalibration.imageUrl, w: initialCalibration.imageWidth, h: initialCalibration.imageHeight }
      : null,
  );
  const [fitSignal, setFitSignal] = useState(0);
  const [refId, setRefId] = useState<ReferenceId>(initialCalibration?.refId ?? "sheet");
  const [customLengthInput, setCustomLengthInput] = useState(
    initialCalibration?.customLengthInches != null ? String(initialCalibration.customLengthInches) : "",
  );
  const [calPoints, setCalPoints] = useState<Point[]>(initialCalibration?.calPoints ?? []);
  const [tool, setTool] = useState<"calibrate" | "measure">(initialCalibration ? "measure" : "calibrate");
  const [measurePoints, setMeasurePoints] = useState<Point[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [activeFieldIndex, setActiveFieldIndex] = useState(0);
  const [locked, setLocked] = useState<Record<string, LockedMeasurement>>({});
  const [error, setError] = useState<string | null>(null);

  const customLengthInches = parseImperialInput(customLengthInput);
  const calibration: Calibration | null = image ? computeCalibration(refId, calPoints, customLengthInches) : null;
  const maxCalPoints = requiredCalPoints(refId);
  const measureFn = calibration ? (a: Point, b: Point) => measureInches(calibration, a, b) : null;

  const activeField = dimensions[activeFieldIndex] ?? null;
  const pendingInches =
    measurePoints.length >= 2 && measureFn ? measureFn(measurePoints[0]!, measurePoints[1]!) : null;
  const allLocked = dimensions.length > 0 && dimensions.every((d) => locked[d.key] != null);

  const extraSegments = dimensions
    .filter((d) => d.key !== activeField?.key && locked[d.key])
    .map((d) => {
      const seg = locked[d.key]!.segment;
      return { ptA: seg.ptA, ptB: seg.ptB, label: `${d.label}: ${formatFractionInches(seg.inches, 16)}"` };
    });

  function resetForNewImage(nextImage: PhotoImage) {
    setImage(nextImage);
    setCalPoints([]);
    setMeasurePoints([]);
    setLocked({});
    setActiveFieldIndex(0);
    setTool("calibrate");
    setSelectedIndex(null);
    setError(null);
    setFitSignal((s) => s + 1);
  }

  function loadFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      const url = reader.result as string;
      const probe = new Image();
      probe.onload = () => resetForNewImage({ url, w: probe.naturalWidth, h: probe.naturalHeight });
      probe.src = url;
    };
    reader.readAsDataURL(file);
  }

  function handleFileInput(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) loadFile(file);
    event.target.value = "";
  }

  function handleReferenceChange(value: string) {
    setRefId(value as ReferenceId);
    setCalPoints([]);
    setSelectedIndex(null);
    setError(null);
  }

  function handleCalPointsChange(next: Point[]) {
    setCalPoints(next);
    if (!image) return;
    const required = requiredCalPoints(refId);
    if (next.length < required) return;
    const cal = computeCalibration(refId, next, customLengthInches);
    if (!cal) {
      setError(refId === "custom" ? "Enter a valid known length." : "Corners don't form a rectangle — re-tap.");
      return;
    }
    setError(null);
    onCalibrationChange({
      imageUrl: image.url,
      imageWidth: image.w,
      imageHeight: image.h,
      refId,
      calPoints: next,
      customLengthInches,
    });
  }

  function handleCustomLengthChange(value: string) {
    setCustomLengthInput(value);
    if (calPoints.length >= 2) handleCalPointsChange(calPoints);
  }

  function switchTool(next: "calibrate" | "measure") {
    setTool(next);
    setSelectedIndex(null);
  }

  function selectField(index: number) {
    setActiveFieldIndex(index);
    setMeasurePoints([]);
    setSelectedIndex(null);
    setTool("measure");
  }

  function undoPending() {
    setMeasurePoints((points) => points.slice(0, -1));
    setSelectedIndex(null);
  }

  function lockActiveField() {
    if (!activeField || pendingInches == null) return;
    const segment: PhotoSegment = { ptA: measurePoints[0]!, ptB: measurePoints[1]!, inches: pendingInches };
    const result: LockedMeasurement = { inches: pendingInches, segment };
    setLocked((current) => ({ ...current, [activeField.key]: result }));
    onLockDimension(activeField.key, result);
    setMeasurePoints([]);
    setSelectedIndex(null);
    const nextIndex = dimensions.findIndex((d, i) => i > activeFieldIndex && !locked[d.key]);
    if (nextIndex !== -1) setActiveFieldIndex(nextIndex);
  }

  function nudgeSelected(dx: number, dy: number) {
    if (selectedIndex === null) return;
    if (tool === "calibrate") {
      const point = calPoints[selectedIndex];
      if (!point) return;
      const updated = [...calPoints];
      updated[selectedIndex] = { x: point.x + dx, y: point.y + dy };
      handleCalPointsChange(updated);
    } else {
      const point = measurePoints[selectedIndex];
      if (!point) return;
      const updated = [...measurePoints];
      updated[selectedIndex] = { x: point.x + dx, y: point.y + dy };
      setMeasurePoints(updated);
    }
  }

  const stage = image ? (
    <PhotoStage
      key={image.url}
      image={image}
      tool={tool}
      calPoints={calPoints}
      measurePoints={measurePoints}
      maxCalPoints={maxCalPoints}
      measureFn={measureFn}
      onCalPointsChange={handleCalPointsChange}
      onMeasurePointsChange={setMeasurePoints}
      selectedIndex={selectedIndex}
      onSelectedIndexChange={setSelectedIndex}
      fitSignal={fitSignal}
      extraSegments={extraSegments}
    />
  ) : (
    <div className="flex h-full min-h-[320px] flex-col items-center justify-center gap-3 rounded-lg border bg-white px-6 text-center text-sm text-muted-foreground sm:min-h-[420px]">
      <Camera className="size-8 text-muted-foreground/50" />
      <p>No photo yet</p>
      <p className="text-xs">Shoot straight down, subject flat, reference object lying on it.</p>
    </div>
  );

  const fileInputs = (
    <>
      <input ref={uploadInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileInput} />
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={handleFileInput}
      />
    </>
  );

  const controls = (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => cameraInputRef.current?.click()} className="flex-1 sm:flex-none">
          <Camera />
          Take Photo
        </Button>
        <Button variant="outline" onClick={() => uploadInputRef.current?.click()} className="flex-1 sm:flex-none">
          <Upload />
          {image ? "Replace Photo" : "Upload Photo"}
        </Button>
      </div>

      <div className="space-y-3 rounded-xl border bg-card p-4">
        <p className="text-sm font-semibold">Scale reference</p>
        <p className="text-xs text-muted-foreground">
          {refId === "sheet"
            ? "Lay a letter-size sheet flat on the same surface, fully visible, then tap its four corners."
            : refId === "custom"
              ? "Tap the two ends of a known length. Shoot straight overhead for best accuracy."
              : `Tap the card's 4 corners in order: ${CORNER_ORDER.join(" → ")}.`}
        </p>
        <div className="space-y-2">
          <Label htmlFor="reference-object">Reference object</Label>
          <Select value={refId} onValueChange={handleReferenceChange}>
            <SelectTrigger id="reference-object" className="w-full">
              <SelectValue>{REFERENCE_OBJECTS.find((r) => r.id === refId)?.label}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {REFERENCE_OBJECTS.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.label}
                  {r.dimensions ? ` — ${r.dimensions[0]}" × ${r.dimensions[1]}"` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {refId === "custom" && (
          <div className="space-y-2">
            <Label htmlFor="known-length">Known length between the 2 points (in)</Label>
            <Input
              id="known-length"
              type="text"
              inputMode="decimal"
              placeholder="e.g. 12 or 12 1/2"
              value={customLengthInput}
              onChange={(event) => handleCustomLengthChange(event.target.value)}
              className="h-11"
            />
          </div>
        )}
        <div
          className={cn(
            "flex items-center justify-between rounded-md border px-3 py-2 text-sm",
            calibration ? "border-emerald-300 bg-emerald-50" : "border-border bg-muted/30",
          )}
        >
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Scale</span>
          <span className={cn("font-mono text-sm font-semibold", calibration ? "text-emerald-700" : "text-muted-foreground")}>
            {calibration
              ? calibration.kind === "homography"
                ? "✓ calibrated (perspective-corrected)"
                : `${Math.round(calibration.pxPerInch)} px = 1"`
              : `${calPoints.length}/${maxCalPoints} points placed`}
          </span>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant={tool === "calibrate" ? "default" : "outline"} onClick={() => switchTool("calibrate")} disabled={!image}>
            Place corners
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!calPoints.length}
            onClick={() => {
              setCalPoints([]);
              setSelectedIndex(null);
            }}
          >
            <Trash2 />
            Clear
          </Button>
        </div>
      </div>

      {calibration && (
        <div className="space-y-2 rounded-xl border bg-card p-4">
          <p className="text-sm font-semibold">Measurements</p>
          {dimensions.map((d, i) => {
            const isActive = i === activeFieldIndex && tool === "measure";
            const value = locked[d.key];
            return (
              <button
                key={d.key}
                type="button"
                onClick={() => selectField(i)}
                className={cn(
                  "flex w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-sm",
                  isActive ? "border-primary bg-primary/5" : "border-border",
                )}
              >
                <span>
                  <span className="font-medium">{d.label}</span>
                  {d.hint && <span className="block text-xs text-muted-foreground">{d.hint}</span>}
                </span>
                <span className="flex items-center gap-1.5 font-mono text-sm font-semibold">
                  {value ? formatFractionInches(value.inches, 16) + '"' : "—"}
                  {value && <Check className="size-3.5 text-emerald-600" />}
                </span>
              </button>
            );
          })}

          {tool === "measure" && activeField && (
            <div className="space-y-2 border-t pt-3">
              <p className="text-xs text-muted-foreground">
                Tap two points on the photo for <strong>{activeField.label}</strong> — drag or nudge to adjust,
                then lock it in.
              </p>
              <div className="flex flex-wrap gap-2">
                <span className="flex-1 rounded-md border px-2 py-1.5 font-mono text-sm font-semibold">
                  {pendingInches != null ? `${formatFractionInches(pendingInches, 16)}"` : "—"}
                </span>
                <Button size="sm" variant="outline" disabled={!measurePoints.length} onClick={undoPending}>
                  <Undo2 />
                  Undo
                </Button>
                <Button size="sm" disabled={pendingInches == null} onClick={lockActiveField}>
                  <Check />
                  Lock in: {activeField.label}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {((tool === "calibrate" ? calPoints.length : measurePoints.length) > 0) && (
        <div className="rounded-xl border bg-card p-4">
          <p className="mb-2 text-sm font-semibold">
            {selectedIndex !== null ? `Marker ${selectedIndex + 1} selected — nudges move it 1 image pixel.` : "Tap a marker on the photo to select it."}
          </p>
          <div className="grid w-fit grid-cols-3 gap-1">
            <span />
            <Button size="icon" variant="outline" disabled={selectedIndex === null} onClick={() => nudgeSelected(0, -NUDGE_STEP)} aria-label="Nudge up">
              <ArrowUp className="size-4" />
            </Button>
            <span />
            <Button size="icon" variant="outline" disabled={selectedIndex === null} onClick={() => nudgeSelected(-NUDGE_STEP, 0)} aria-label="Nudge left">
              <ArrowLeft className="size-4" />
            </Button>
            <span />
            <Button size="icon" variant="outline" disabled={selectedIndex === null} onClick={() => nudgeSelected(NUDGE_STEP, 0)} aria-label="Nudge right">
              <ArrowRight className="size-4" />
            </Button>
            <span />
            <Button size="icon" variant="outline" disabled={selectedIndex === null} onClick={() => nudgeSelected(0, NUDGE_STEP)} aria-label="Nudge down">
              <ArrowDown className="size-4" />
            </Button>
            <span />
          </div>
        </div>
      )}

      {calibration && (
        <Button size="lg" className="w-full" disabled={!allLocked} onClick={() => onComplete(locked)}>
          <Ruler className="size-4" />
          {allLocked
            ? "Use these measurements"
            : `Still need ${dimensions.filter((d) => !locked[d.key]).length} of ${dimensions.length}`}
        </Button>
      )}
    </div>
  );

  if (presentation === "overlay") {
    return (
      <div className="fixed inset-0 z-50 flex flex-col bg-background">
        <header className="flex items-center gap-2 border-b px-3 py-3">
          <Button variant="ghost" size="icon" onClick={onCancel} aria-label="Close">
            <X className="size-5" />
          </Button>
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold">Measure from photo</p>
            <p className="truncate text-xs text-muted-foreground">
              {dimensions.length} measurement{dimensions.length === 1 ? "" : "s"} · one photo, one calibration
            </p>
          </div>
        </header>
        {fileInputs}
        <div className="flex-1 overflow-y-auto p-3">
          <div className="mx-auto flex max-w-md flex-col gap-3">
            <div className="h-[45vh] min-h-[280px] overflow-hidden rounded-lg">{stage}</div>
            {controls}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
      {fileInputs}
      <div className="space-y-4">{controls}</div>
      <section className="overflow-hidden rounded-lg">{stage}</section>
    </div>
  );
}
