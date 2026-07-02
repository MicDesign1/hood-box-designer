"use client";

import { useRef, useState } from "react";
import { Camera, Ruler, Trash2, Undo2, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PhotoStage, type PhotoImage } from "@/components/photo-stage";
import { formatFractionInches, parseImperialInput } from "@/lib/imperial";
import {
  CORNER_ORDER,
  REFERENCE_OBJECTS,
  computeScale,
  dist,
  requiredCalPoints,
  snapToSixteenth,
  type Point,
  type ReferenceId,
} from "@/lib/photo-calibration";
import { cn } from "@/lib/utils";

type DimensionKey = "length" | "width" | "height";

const DIMENSION_LABELS: Record<DimensionKey, string> = {
  length: "Length",
  width: "Width",
  height: "Height",
};

const DIMENSION_ORDER: DimensionKey[] = ["length", "width", "height"];

export interface PhotoModeProps {
  onApplyMeasurements: (dims: { length: number; width: number; height: number }) => void;
}

export function PhotoMode({ onApplyMeasurements }: PhotoModeProps) {
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const [image, setImage] = useState<PhotoImage | null>(null);
  const [fitSignal, setFitSignal] = useState(0);
  const [refId, setRefId] = useState<ReferenceId>("poker");
  const [customLengthInput, setCustomLengthInput] = useState("");
  const [tool, setTool] = useState<"calibrate" | "measure">("calibrate");
  const [calPoints, setCalPoints] = useState<Point[]>([]);
  const [measurePoints, setMeasurePoints] = useState<Point[]>([]);
  const [assignments, setAssignments] = useState<Record<number, DimensionKey>>({});

  const customLengthInches = parseImperialInput(customLengthInput);
  const pxPerInch = computeScale(refId, calPoints, customLengthInches);
  const maxCalPoints = requiredCalPoints(refId);

  const measurements = [];
  for (let i = 0; i + 1 < measurePoints.length; i += 2) {
    const a = measurePoints[i];
    const b = measurePoints[i + 1];
    const px = dist(a, b);
    const inches = pxPerInch ? px / pxPerInch : null;
    measurements.push({ index: measurements.length, inches, assignedTo: assignments[measurements.length] ?? null });
  }

  const assignedValues: Partial<Record<DimensionKey, number>> = {};
  for (const [idxStr, key] of Object.entries(assignments)) {
    const m = measurements[Number(idxStr)];
    if (m?.inches != null) assignedValues[key] = snapToSixteenth(m.inches);
  }
  const missingDimensions = DIMENSION_ORDER.filter((key) => assignedValues[key] === undefined);

  const step = !image ? 1 : !pxPerInch ? 2 : missingDimensions.length > 0 ? 3 : 4;

  function loadFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      const url = reader.result as string;
      const probe = new Image();
      probe.onload = () => {
        setImage({ url, w: probe.naturalWidth, h: probe.naturalHeight });
        setCalPoints([]);
        setMeasurePoints([]);
        setAssignments({});
        setTool("calibrate");
        setFitSignal((s) => s + 1);
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
    setRefId(value as ReferenceId);
    setCalPoints([]);
  }

  function assignMeasurement(index: number, key: DimensionKey) {
    setAssignments((current) => {
      const next: Record<number, DimensionKey> = {};
      for (const [idxStr, k] of Object.entries(current)) {
        if (k !== key) next[Number(idxStr)] = k;
      }
      next[index] = key;
      return next;
    });
  }

  function undoLastMeasurePoint() {
    setMeasurePoints((points) => (points.length % 2 === 1 ? points.slice(0, -1) : points.slice(0, -2)));
  }

  function handleApply() {
    if (missingDimensions.length > 0) return;
    onApplyMeasurements({
      length: assignedValues.length!,
      width: assignedValues.width!,
      height: assignedValues.height!,
    });
  }

  return (
    <main className="mx-auto grid max-w-7xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[320px_1fr] lg:px-8 lg:py-8">
      <div className="flex items-center gap-1.5 text-xs font-medium lg:col-span-2" aria-hidden="true">
        {[
          { n: 1, label: "Photo" },
          { n: 2, label: "Calibrate" },
          { n: 3, label: "Measure" },
          { n: 4, label: "Apply" },
        ].map((s, i, arr) => (
          <div key={s.n} className="flex items-center gap-1.5">
            <span
              className={cn(
                "flex size-5 items-center justify-center rounded-full text-[11px]",
                step >= s.n ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
              )}
            >
              {s.n}
            </span>
            <span className={step >= s.n ? "text-foreground" : "text-muted-foreground"}>{s.label}</span>
            {i < arr.length - 1 ? <span className="mx-1 text-muted-foreground">→</span> : null}
          </div>
        ))}
      </div>

      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>1 · Photo</CardTitle>
            <CardDescription>Shoot straight down, box flat, reference card lying on it.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <input ref={uploadInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileInput} />
            <input
              ref={cameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={handleFileInput}
            />
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
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>2 · Scale reference</CardTitle>
            <CardDescription>
              {refId === "custom"
                ? "Tap the two ends of a known length (ruler, tape, printed scale)."
                : `Tap the card's 4 corners in order: ${CORNER_ORDER.join(" → ")}.`}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
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

            {refId === "custom" ? (
              <div className="space-y-2">
                <Label htmlFor="custom-length">Known length between the 2 points (in)</Label>
                <Input
                  id="custom-length"
                  type="text"
                  inputMode="decimal"
                  placeholder="e.g. 12 or 12 1/2"
                  value={customLengthInput}
                  onChange={(event) => setCustomLengthInput(event.target.value)}
                />
              </div>
            ) : null}

            <div
              className={cn(
                "flex items-center justify-between rounded-md border px-3 py-2 text-sm",
                pxPerInch ? "border-emerald-300 bg-emerald-50" : "border-border bg-muted/30",
              )}
            >
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Scale</span>
              <span className={cn("font-mono text-sm font-semibold", pxPerInch ? "text-emerald-700" : "text-muted-foreground")}>
                {pxPerInch ? `${Math.round(pxPerInch)} px = 1"` : `${calPoints.length}/${maxCalPoints} points placed`}
              </span>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant={tool === "calibrate" ? "default" : "outline"}
                onClick={() => setTool("calibrate")}
                disabled={!image}
              >
                Place corners
              </Button>
              <Button size="sm" variant="outline" disabled={!calPoints.length} onClick={() => setCalPoints([])}>
                <Trash2 />
                Clear
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>3 · Measure panels</CardTitle>
            <CardDescription>Measure crease-to-crease across a flat panel, then assign to L / W / H.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant={tool === "measure" ? "default" : "outline"}
                disabled={!pxPerInch}
                onClick={() => setTool("measure")}
              >
                <Ruler />
                Measure
              </Button>
              <Button size="sm" variant="outline" disabled={!measurePoints.length} onClick={undoLastMeasurePoint}>
                <Undo2 />
                Undo
              </Button>
              <Button size="sm" variant="outline" disabled={!measurePoints.length} onClick={() => { setMeasurePoints([]); setAssignments({}); }}>
                <Trash2 />
                Clear
              </Button>
            </div>

            {!pxPerInch ? (
              <p className="text-xs text-muted-foreground">Calibrate the scale first, then measurements read in real inches.</p>
            ) : measurements.length === 0 ? (
              <p className="text-xs text-muted-foreground">Tap two points on the photo to take a measurement.</p>
            ) : (
              <div className="space-y-2">
                {measurements.map((m) => (
                  <div key={m.index} className="flex items-center gap-2 rounded-md border px-2 py-1.5">
                    <span className="font-mono text-sm font-semibold text-sky-700">M{m.index + 1}</span>
                    <span className="font-mono text-sm font-semibold">
                      {m.inches != null ? `${formatFractionInches(m.inches, 16)}"` : "—"}
                    </span>
                    <span className="ml-auto flex gap-1">
                      {DIMENSION_ORDER.map((key) => (
                        <Button
                          key={key}
                          size="xs"
                          variant={m.assignedTo === key ? "default" : "outline"}
                          onClick={() => assignMeasurement(m.index, key)}
                        >
                          {DIMENSION_LABELS[key][0]}
                        </Button>
                      ))}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>4 · Apply</CardTitle>
            <CardDescription>
              {missingDimensions.length > 0
                ? `Still need: ${missingDimensions.map((k) => DIMENSION_LABELS[k]).join(", ")}`
                : "All three dimensions assigned — ready to generate."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {DIMENSION_ORDER.map((key) => (
              <div key={key} className="flex justify-between border-b border-dashed pb-1 text-sm last:border-0">
                <span className="text-muted-foreground">{DIMENSION_LABELS[key]}</span>
                <span className="font-mono font-semibold">
                  {assignedValues[key] != null ? `${formatFractionInches(assignedValues[key]!, 16)}"` : "—"}
                </span>
              </div>
            ))}
            <Button size="lg" className="w-full" disabled={missingDimensions.length > 0} onClick={handleApply}>
              Use These Measurements in Design Mode
            </Button>
          </CardContent>
        </Card>
      </div>

      <section className="overflow-hidden rounded-lg">
        {image ? (
          <PhotoStage
            key={image.url}
            image={image}
            tool={tool}
            calPoints={calPoints}
            measurePoints={measurePoints}
            maxCalPoints={maxCalPoints}
            pxPerInch={pxPerInch}
            onCalPointsChange={setCalPoints}
            onMeasurePointsChange={setMeasurePoints}
            fitSignal={fitSignal}
          />
        ) : (
          <div className="flex h-full min-h-[320px] flex-col items-center justify-center gap-2 rounded-lg border bg-white px-6 text-center text-sm text-muted-foreground sm:min-h-[420px] lg:min-h-[520px]">
            <Camera className="size-8 text-muted-foreground/50" />
            <p>No photo yet</p>
            <p className="text-xs">Take or upload a photo of the flat box with a reference card on it.</p>
          </div>
        )}
      </section>
    </main>
  );
}
