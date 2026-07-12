"use client";

import { useMemo, useRef, useState } from "react";
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
import { PAPER_ASPECT, detectPaperCorners, type PaperCandidate } from "@/lib/paper-detection";
import {
  CORNER_ORDER,
  PAPER_REFERENCE_IDS,
  REFERENCE_OBJECTS,
  computeCalibration,
  measureInches,
  requiredCalPoints,
  type Calibration,
  type Point,
  type ReferenceId,
} from "@/lib/photo-calibration";
import { cn } from "@/lib/utils";
import type { CaptureMarker, CaptureRole, CaptureSession } from "@/types/capture";
import type { LockedMeasurement, PhotoMeasureSessionProps, PhotoSegment } from "./types";

const NUDGE_STEP = 1;

// Phase 0 only: PhotoMeasureSession's `dimensions` prop is a flat
// { key, label }[] with no role-kind metadata -- the marker-designation UI
// that actually lets a user choose dimension/panel/reference per marker
// doesn't exist yet (that's Phase 2/3). Until then, a key is inferred as a
// direct-entry axis if it matches Design's fixed vocabulary, otherwise
// treated as a Sample-style panel field. Every current caller
// (photo-mode.tsx, sample-wizard.tsx) already only ever uses one of these
// two closed vocabularies, so this is exact today, not a guess -- but it's
// a stand-in this phase deliberately keeps narrow rather than have it
// silently cover a case (reference roles) it isn't built for yet.
const DIRECT_DIMENSION_AXES = new Set(["length", "width", "height"]);

function inferRoleForKey(key: string): CaptureRole {
  if (DIRECT_DIMENSION_AXES.has(key)) {
    return { kind: "dimension", axis: key as "length" | "width" | "height" };
  }
  return {
    kind: "panel",
    panelField: key as "panel1" | "panel2" | "panelD" | "blankWidth" | "blankHeight" | "flapHeight",
  };
}

/** The old `Record<string, LockedMeasurement>` key a role corresponds to,
 * or null for reference roles (which have no such key -- by design, nothing
 * upstream of Phase 2 can construct a reference role yet). */
function roleLookupKey(role: CaptureRole): string | null {
  if (role.kind === "dimension") return role.axis;
  if (role.kind === "panel") return role.panelField;
  return null;
}
const PAPER_SIZE_STORAGE_KEY = "photoMeasure:paperRefId";
/** How long to wait for opencv to load + run before giving up and falling
 * back to the not-detected notice. Slow connections are real; never spin
 * forever. */
const DETECTION_TIMEOUT_MS = 15000;

type DetectionState = "idle" | "detecting" | "detected" | "not-detected" | "manual";

function isPaperReference(id: ReferenceId): boolean {
  return (PAPER_REFERENCE_IDS as ReferenceId[]).includes(id);
}

function loadRememberedPaperRefId(): ReferenceId | null {
  if (typeof window === "undefined") return null;
  const stored = window.localStorage.getItem(PAPER_SIZE_STORAGE_KEY);
  return stored === "sheet" || stored === "a4" ? stored : null;
}

function isDetectDebugEnabled(): boolean {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("detectDebug") === "1";
}

// Diagnostic-script-only: bypasses the debug overlay's area floor/candidate
// cap so an offline evidence-gathering run sees every contour opencv
// considered, not just the ones worth drawing on screen. Never set by the
// live UI itself.
function isDetectLogAllEnabled(): boolean {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("detectLogAll") === "1";
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | "timeout"> {
  return Promise.race([promise, new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), ms))]);
}

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
  const [refId, setRefId] = useState<ReferenceId>(
    () => initialCalibration?.refId ?? loadRememberedPaperRefId() ?? "sheet",
  );
  const [customLengthInput, setCustomLengthInput] = useState(
    initialCalibration?.customLengthInches != null ? String(initialCalibration.customLengthInches) : "",
  );
  const [calPoints, setCalPoints] = useState<Point[]>(initialCalibration?.calPoints ?? []);
  const [tool, setTool] = useState<"calibrate" | "measure">(initialCalibration ? "measure" : "calibrate");
  const [measurePoints, setMeasurePoints] = useState<Point[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [activeFieldIndex, setActiveFieldIndex] = useState(0);
  // Source of truth for locked measurements is now the shared CaptureMarker
  // record, not a bare key->value map -- see `locked` below, which derives
  // the exact same Record<string, LockedMeasurement> shape every existing
  // read site in this file already expects, so nothing downstream of that
  // derivation had to change.
  const [markers, setMarkers] = useState<CaptureMarker[]>([]);
  const markerIdCounterRef = useRef(0);
  const sessionIdRef = useRef(`capture-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const capturedAtRef = useRef(new Date().toISOString());
  const [error, setError] = useState<string | null>(null);
  const [detectionState, setDetectionState] = useState<DetectionState>(initialCalibration ? "manual" : "idle");
  const [detectDebugEnabled] = useState(isDetectDebugEnabled);
  const [detectLogAllEnabled] = useState(isDetectLogAllEnabled);
  const [debugCandidates, setDebugCandidates] = useState<PaperCandidate[]>([]);
  const detectionGenerationRef = useRef(0);

  const locked = useMemo(() => {
    const map: Record<string, LockedMeasurement> = {};
    for (const m of markers) {
      if (!m.role || !m.keep) continue;
      const key = roleLookupKey(m.role);
      if (key == null) continue; // reference roles don't participate in the old key->value map
      map[key] = { inches: m.rawInches, segment: { ptA: m.ptA, ptB: m.ptB, inches: m.rawInches } };
    }
    return map;
  }, [markers]);

  const customLengthInches = parseImperialInput(customLengthInput);
  const calibration: Calibration | null = image ? computeCalibration(refId, calPoints, customLengthInches) : null;
  const maxCalPoints = requiredCalPoints(refId);
  const measureFn = calibration ? (a: Point, b: Point) => measureInches(calibration, a, b) : null;

  // Phase 0: assembled for structural completeness (proves the session is
  // genuinely representable, not just the marker array) but not yet
  // exported or consumed by anything -- no external prop carries it out of
  // this component. `method` is inferred from `presentation` for now: today
  // embedded is always Design (direct-entry) and overlay is always Sample
  // (panel-derived), 1:1, so this is exact, not a guess -- but it's a
  // stand-in a future phase should replace with an explicit prop once a
  // caller actually needs to declare it (e.g. once reference-dimension
  // labeling needs the session's method to differ from its UI chrome).
  const captureSession: CaptureSession = useMemo(
    () => ({
      id: sessionIdRef.current,
      method: presentation === "embedded" ? "direct" : "panel-derived",
      calibration: image
        ? {
            imageUrl: image.url,
            imageWidth: image.w,
            imageHeight: image.h,
            refId,
            calPoints,
            customLengthInches,
          }
        : null,
      markers,
      flute: null, // not captured by this component today -- entered elsewhere in each flow's own form
      caliper: null,
      capturedAt: capturedAtRef.current,
    }),
    [presentation, image, refId, calPoints, customLengthInches, markers],
  );

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
    detectionGenerationRef.current += 1; // supersede any in-flight detection for the old photo
    setImage(nextImage);
    setCalPoints([]);
    setMeasurePoints([]);
    setMarkers([]);
    setActiveFieldIndex(0);
    setTool("calibrate");
    setSelectedIndex(null);
    setError(null);
    setDetectionState("idle");
    setDebugCandidates([]);
    setFitSignal((s) => s + 1);
  }

  async function tryAutoDetectPaper(imgEl: HTMLImageElement, nextImage: PhotoImage, forRefId: ReferenceId) {
    if (!isPaperReference(forRefId)) return;
    const aspect = PAPER_ASPECT[forRefId];
    if (!aspect) return;

    const myGeneration = ++detectionGenerationRef.current;
    setDetectionState("detecting");
    setDebugCandidates([]);

    const outcome = await withTimeout(
      detectPaperCorners(imgEl, aspect, { collectDebug: detectDebugEnabled, logAll: detectLogAllEnabled }),
      DETECTION_TIMEOUT_MS,
    );

    // The user replaced the photo, changed reference, or started tapping
    // manually while this was in flight -- this result is stale, drop it.
    if (detectionGenerationRef.current !== myGeneration) return;

    if (outcome === "timeout") {
      setDetectionState("not-detected");
      return;
    }
    if (detectDebugEnabled) {
      setDebugCandidates(outcome.candidates);
      // Exposed for frontend/scripts/detect-debug.mjs, which drives this
      // exact runtime code path against a static test photo and reads this
      // back -- not used by the app itself.
      (window as unknown as { __paperDetectDebug?: unknown }).__paperDetectDebug = outcome;

      const d = outcome.diagnostics;
      if (d.fourPointCount === 0) {
        console.info(
          `[paper-detect] 0 of ${d.contoursTotal} contours ever reached the 4-point approxPolyDP stage ` +
            `(work image ${d.workWidth}x${d.workHeight}, scale ${d.scale.toFixed(3)}).`,
        );
      } else {
        console.info(
          `[paper-detect] ${d.contoursTotal} contours -> ${d.fourPointCount} reached 4 points -> ${d.quadCount} were convex quads.`,
        );
      }
      console.table(
        outcome.candidates.map((c) => ({
          pointCount: c.pointCount,
          areaPx: Math.round(c.areaPx),
          "area%": (c.areaFraction * 100).toFixed(1),
          convex: c.isConvex,
          ratio: c.measuredRatio?.toFixed(3) ?? "—",
          ratioErr: c.ratioError != null ? `${(c.ratioError * 100).toFixed(0)}%` : "—",
          accepted: c.accepted,
          reason: c.reason,
        })),
      );
    }

    const corners = outcome.corners;
    const cal = corners ? computeCalibration(forRefId, corners, null) : null;
    if (!corners || !cal) {
      setDetectionState("not-detected");
      return;
    }
    setCalPoints(corners);
    setDetectionState("detected");
    onCalibrationChange({
      imageUrl: nextImage.url,
      imageWidth: nextImage.w,
      imageHeight: nextImage.h,
      refId: forRefId,
      calPoints: corners,
      customLengthInches: null,
    });
  }

  function loadFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      const url = reader.result as string;
      const probe = new Image();
      probe.onload = () => {
        const nextImage: PhotoImage = { url, w: probe.naturalWidth, h: probe.naturalHeight };
        resetForNewImage(nextImage);
        void tryAutoDetectPaper(probe, nextImage, refId);
      };
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
    const next = value as ReferenceId;
    detectionGenerationRef.current += 1; // supersede any in-flight detection for the old reference
    setRefId(next);
    setCalPoints([]);
    setSelectedIndex(null);
    setError(null);
    setDetectionState("idle");
    setDebugCandidates([]);
    if (isPaperReference(next)) {
      if (typeof window !== "undefined") window.localStorage.setItem(PAPER_SIZE_STORAGE_KEY, next);
      if (image) {
        const img = new Image();
        img.onload = () => void tryAutoDetectPaper(img, image, next);
        img.src = image.url;
      }
    }
  }

  function clearForManualCalibration() {
    detectionGenerationRef.current += 1; // the user opted out -- ignore any late detection result
    setCalPoints([]);
    setSelectedIndex(null);
    setError(null);
    setDetectionState("manual");
  }

  function handleCalPointsChange(next: Point[]) {
    // Any direct user interaction with calibration points (manual tap, or
    // dragging/nudging an auto-detected one) supersedes a still-running
    // detection -- it must never overwrite what the user is doing now.
    detectionGenerationRef.current += 1;
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
    const ptA = measurePoints[0]!;
    const ptB = measurePoints[1]!;
    const role = inferRoleForKey(activeField.key);
    const marker: CaptureMarker = {
      id: `m${++markerIdCounterRef.current}`,
      ptA,
      ptB,
      rawInches: pendingInches,
      role,
      keep: true,
    };
    setMarkers((current) => [
      ...current.filter((m) => !m.role || roleLookupKey(m.role) !== activeField.key),
      marker,
    ]);

    // External contract unchanged: still emit the exact same
    // LockedMeasurement shape callers already handle.
    const segment: PhotoSegment = { ptA, ptB, inches: pendingInches };
    const result: LockedMeasurement = { inches: pendingInches, segment };
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

  const debugQuads = detectDebugEnabled
    ? debugCandidates
        .filter((c) => c.points.length === 4)
        .map((c) => ({
          points: c.points,
          color: c.accepted ? "#16a34a" : "#dc2626",
          label: `${c.reason}${c.ratioError != null ? ` (Δ${(c.ratioError * 100).toFixed(0)}%)` : ""}`,
        }))
    : undefined;

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
      debugQuads={debugQuads}
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
          {isPaperReference(refId)
            ? "Lay the sheet flat on the same surface, fully visible — corners are detected automatically, or tap all four yourself."
            : refId === "custom"
              ? "Tap the two ends of a known length. Shoot straight overhead for best accuracy."
              : `Tap the card's 4 corners in order: ${CORNER_ORDER.join(" → ")}.`}
        </p>
        {detectionState === "detecting" && (
          <p className="flex items-center gap-1.5 text-xs font-medium text-sky-700">
            <span className="size-2 animate-pulse rounded-full bg-sky-500" aria-hidden="true" />
            Detecting sheet…
          </p>
        )}
        {detectionState === "detected" && (
          <div className="flex items-center justify-between gap-2 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
            <span>Paper detected — drag a corner to adjust if it&apos;s off.</span>
            <Button size="xs" variant="outline" onClick={clearForManualCalibration}>
              Looks wrong? Place manually
            </Button>
          </div>
        )}
        {detectionState === "not-detected" && (
          <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Couldn&apos;t detect the sheet automatically — tap its four corners.
          </p>
        )}
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
