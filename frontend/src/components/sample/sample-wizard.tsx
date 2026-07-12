"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  ArrowLeft,
  Camera,
  Check,
  ClipboardCopy,
  Download,
  Loader2,
  Package,
  RotateCcw,
  Ruler,
} from "lucide-react";

import { DielinePreviewPanel } from "@/components/dieline-preview-panel";
import {
  BlankHeightDiagram,
  BlankWidthDiagram,
  BlankWidthExcludesTabDiagram,
  FlapHeightDiagram,
  HscFlapHeightDiagram,
  PanelDDiagram,
  PanelOneDiagram,
  PanelTwoDiagram,
} from "@/components/sample/measurement-diagrams";
import { PhotoMeasureSession } from "@/components/PhotoMeasure/PhotoMeasureSession";
import type {
  DimensionField,
  LockedMeasurement,
  PhotoCalibrationCapture,
  PhotoSegment,
} from "@/components/PhotoMeasure/types";
import { FluteProfile, StyleDiagram } from "@/components/sample/style-diagrams";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  downloadDxfFromPayload,
  downloadSvgFromPayload,
  fetchDielineDxfFromPayload,
  fetchDielineSvgFromPayload,
} from "@/lib/dieline";
import { formatBlankSize, formatDimensionSummary, formatFractionInches } from "@/lib/imperial";
import { applyPhotoLock, MEASUREMENT_FIELD_LABELS, resolveMeasurementInches } from "@/lib/sample-capture";
import {
  confidenceLabel,
  extraMeasurementKind,
  fetchSolve,
  jointDisplayLabel,
  needsExtraMeasurement,
  solveResultToGeneratePayload,
  SAMPLE_TAB_WIDTH,
  styleDisplayName,
} from "@/lib/solve";
import {
  INITIAL_SAMPLE_STATE,
  type DimensionStandard,
  type SampleFlute,
  type SampleJoint,
  type SampleMeasurements,
  type SampleStyle,
  type SampleWizardState,
  type SolveResponse,
} from "@/types/sample";
import type { DielineGeometry } from "@/types/geometry";

const STYLE_OPTIONS: { id: SampleStyle; title: string; subtitle: string }[] = [
  { id: "rsc", title: "Flaps top & bottom", subtitle: "Regular shipping box" },
  { id: "hsc", title: "Flaps one side", subtitle: "Open-top tray or half box" },
  { id: "tube", title: "No flaps", subtitle: "Four-panel wrap or sleeve" },
];

const FLUTE_OPTIONS: { id: SampleFlute; title: string; subtitle: string }[] = [
  { id: "B", title: "B-flute", subtitle: "Fine corrugation" },
  { id: "C", title: "C-flute", subtitle: "Medium corrugation" },
  { id: "BC", title: "BC double wall", subtitle: "Heavy duty" },
];

function displaySuggestedInput(text: string): string {
  return text.replace(/depth panel/gi, "height panel");
}

/**
 * Builds the solver payload. Every measurement is sourced via
 * `resolveMeasurementInches`, never by re-parsing the display string
 * directly: the solver needs full precision to disambiguate near-tie
 * candidate styles, and the display string is deliberately rounded to 2
 * decimals for on-screen/editable use (see sample-capture.ts). Exported for
 * direct unit testing of that sourcing behavior.
 */
export function buildSolvePayload(
  state: SampleWizardState,
): Parameters<typeof fetchSolve>[0] | null {
  if (!state.flute || !state.style) return null;

  const joint: SampleJoint = state.style === "tube" ? "taped" : (state.joint ?? "glued");

  const panel1 = resolveMeasurementInches(state, "panel1");
  const panelD = resolveMeasurementInches(state, "panelD");
  const panel2 = resolveMeasurementInches(state, "panel2");
  const blankW = resolveMeasurementInches(state, "blankWidth");
  const blankH = resolveMeasurementInches(state, "blankHeight");
  const flapH = resolveMeasurementInches(state, "flapHeight");

  if (panel1 === null || panel2 === null) {
    return null;
  }

  const payload: Parameters<typeof fetchSolve>[0] = {
    flute: state.flute,
    style: state.style,
    joint,
    tab_width: SAMPLE_TAB_WIDTH,
    panel_1: panel1,
    panel_2: panel2,
  };

  if (state.style === "tube") {
    if (blankH === null) return null;
    payload.blank_h = blankH;
  } else {
    if (panelD === null) return null;
    payload.panel_d = panelD;
  }

  if (joint === "glued" && state.style !== "tube") {
    payload.blank_w_excludes_tab = true;
  }

  if (blankW !== null) payload.blank_w = blankW;
  if (state.style === "tube") {
    if (blankW !== null) payload.blank_w = blankW;
  } else if (blankH !== null) {
    payload.blank_h = blankH;
  }
  if (flapH !== null && state.style !== "tube") payload.flap_h = flapH;

  return payload;
}

function copySpecText(
  result: SolveResponse,
  flute: SampleFlute,
  displayLabel: string | null,
): string {
  const styleName = styleDisplayName(result.style, displayLabel);
  const inside = `${formatFractionInches(result.L)} × ${formatFractionInches(result.W)} × ${formatFractionInches(result.D)} in`;
  const blank = formatBlankSize(result.predicted_blank_w, result.predicted_blank_h, "in");
  const lines = [
    `Style: ${styleName}`,
    `Flute: ${flute}-flute`,
    `Joint: ${jointDisplayLabel(result)}`,
    `Inside dimensions: ${inside}`,
  ];
  if (
    result.outside_L !== undefined &&
    result.outside_W !== undefined &&
    result.outside_D !== undefined
  ) {
    lines.push(
      `Outside (approx): ${formatFractionInches(result.outside_L)} × ${formatFractionInches(result.outside_W)} × ${formatFractionInches(result.outside_D)} in`,
    );
  }
  lines.push(`Flat blank: ${blank}`);
  return lines.join("\n");
}

function formatEnteredMeasurements(measurements: SampleMeasurements, style: SampleStyle): string {
  const parts = [
    `Panel 1: ${measurements.panel1 || "—"}`,
    `Panel 2: ${measurements.panel2 || "—"}`,
  ];
  if (style === "tube") {
    parts.unshift(`Blank height: ${measurements.blankHeight || "—"}`);
  } else {
    parts.unshift(`Height panel: ${measurements.panelD || "—"}`);
  }
  if (measurements.blankWidth || measurements.blankHeight || measurements.flapHeight) {
    parts.push(`Cross-check blank W: ${measurements.blankWidth || "—"}`);
    if (style !== "tube") {
      parts.push(`Cross-check blank H: ${measurements.blankHeight || "—"}`);
      parts.push(`Cross-check flap H: ${measurements.flapHeight || "—"}`);
    }
  }
  return parts.join("\n");
}

export function SampleWizard() {
  const [state, setState] = useState<SampleWizardState>(INITIAL_SAMPLE_STATE);
  const [pendingSeam, setPendingSeam] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [geometry, setGeometry] = useState<DielineGeometry | null>(null);
  const [svgMarkup, setSvgMarkup] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewMessage, setPreviewMessage] = useState<string | null>(null);
  const [previewWarnings, setPreviewWarnings] = useState<string[]>([]);
  const [previewDerived, setPreviewDerived] = useState<
    Record<string, string | number | boolean | null>
  >({});
  const [exportingDxf, setExportingDxf] = useState(false);
  const [copied, setCopied] = useState(false);
  const [photoCalibration, setPhotoCalibration] = useState<PhotoCalibrationCapture | null>(null);
  const [photoSegments, setPhotoSegments] = useState<
    Partial<Record<keyof SampleMeasurements, PhotoSegment>>
  >({});
  const [photoSessionOpen, setPhotoSessionOpen] = useState(false);
  const [photoSessionDimensions, setPhotoSessionDimensions] = useState<DimensionField[]>([]);

  const reset = useCallback(() => {
    setState(INITIAL_SAMPLE_STATE);
    setPendingSeam(false);
    setError(null);
    setGeometry(null);
    setSvgMarkup("");
    setPreviewError(null);
    setPreviewMessage(null);
    setPreviewWarnings([]);
    setPreviewDerived({});
    setCopied(false);
    setPhotoCalibration(null);
    setPhotoSegments({});
    setPhotoSessionOpen(false);
    setPhotoSessionDimensions([]);
  }, []);

  const runSolve = useCallback(async (next: SampleWizardState) => {
    const payload = buildSolvePayload(next);
    if (!payload) {
      setError("Please enter valid measurements (fractions like 42 3/4 are OK).");
      return;
    }

    setLoading(true);
    setError(null);
    setGeometry(null);
    setSvgMarkup("");
    setPreviewError(null);
    setPreviewMessage(null);
    setPreviewWarnings([]);
    setPreviewDerived({});
    try {
      const result = await fetchSolve(payload);
      setState((current) => ({
        ...current,
        solveResult: result,
        step: "result",
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not solve this blank.");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadPreview = useCallback(async (result: SolveResponse, flute: SampleFlute) => {
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const payload = solveResultToGeneratePayload(result, flute);
      const response = await fetchDielineSvgFromPayload(payload);
      setSvgMarkup(response.svg);
      setGeometry(response.geometry ?? null);
      setPreviewMessage(response.message);
      setPreviewWarnings(response.warnings ?? []);
      setPreviewDerived(response.derived ?? {});
    } catch (err) {
      setGeometry(null);
      setSvgMarkup("");
      setPreviewMessage(null);
      setPreviewWarnings([]);
      setPreviewDerived({});
      setPreviewError(
        err instanceof Error ? err.message : "Failed to load dieline from backend.",
      );
    } finally {
      setPreviewLoading(false);
    }
  }, []);

  useEffect(() => {
    const { solveResult, flute } = state;
    if (!solveResult || !flute) return;
    if (solveResult.confidence !== "high" && solveResult.confidence !== "medium") {
      setGeometry(null);
      setSvgMarkup("");
      setPreviewError(null);
      setPreviewMessage(null);
      setPreviewWarnings([]);
      setPreviewDerived({});
      return;
    }
    void loadPreview(solveResult, flute);
  }, [state.solveResult, state.flute, loadPreview]);

  const canShowPreview =
    state.solveResult &&
    (state.solveResult.confidence === "high" || state.solveResult.confidence === "medium");

  function updateMeasurement(field: keyof SampleMeasurements, value: string) {
    setState((current) => ({
      ...current,
      measurements: { ...current.measurements, [field]: value },
    }));
  }

  function selectStyle(style: SampleStyle) {
    if (style === "tube") {
      setState((current) => ({ ...current, style, hasSeam: null, joint: null }));
      setPendingSeam(true);
      return;
    }
    setPendingSeam(false);
    setState((current) => ({
      ...current,
      style,
      hasSeam: null,
      joint: null,
      displayLabel: null,
      step: "joint",
    }));
  }

  function selectJoint(joint: SampleJoint) {
    setState((current) => ({ ...current, joint, step: "flute" }));
  }

  function answerSeam(hasSeam: boolean) {
    setPendingSeam(false);
    setState((current) => ({
      ...current,
      hasSeam,
      displayLabel: hasSeam ? null : "Liner (no seam)",
      step: "flute",
    }));
  }

  function selectFlute(flute: SampleFlute) {
    setState((current) => ({ ...current, flute, step: "measurements" }));
  }

  function requiredPhotoDimensions(): DimensionField[] {
    if (state.style === "tube") {
      return [
        { key: "blankHeight", label: "Blank height", hint: "Bottom edge to top edge — this is the tube height" },
        { key: "panel1", label: "First panel width" },
        { key: "panel2", label: "Second panel width" },
      ];
    }
    return [
      { key: "panelD", label: "Height panel", hint: "Middle panel, top crease to bottom crease" },
      { key: "panel1", label: "First panel width" },
      { key: "panel2", label: "Second panel width" },
    ];
  }

  function optionalPhotoDimensions(): DimensionField[] {
    const dims: DimensionField[] = [{ key: "blankWidth", label: "Blank width" }];
    if (state.style !== "tube") {
      dims.push({ key: "blankHeight", label: "Blank height (cross-check)" });
      dims.push({ key: "flapHeight", label: "Flap height" });
    }
    return dims;
  }

  function openPhotoSession(dimensions: DimensionField[]) {
    setPhotoSessionDimensions(dimensions);
    setPhotoSessionOpen(true);
  }

  function handlePhotoLockDimension(key: string, result: LockedMeasurement) {
    const field = key as keyof SampleMeasurements;
    setPhotoSegments((current) => ({ ...current, [field]: result.segment }));
    setState((current) => applyPhotoLock(current, field, result));
  }

  async function submitMeasurements() {
    await runSolve(state);
  }

  async function submitExtraMeasurement() {
    if (!state.solveResult) return;
    const kind = extraMeasurementKind(state.solveResult);
    const measurements = { ...state.measurements };
    if (kind === "panel-d") measurements.panelD = state.extraMeasurement;
    else if (kind === "panel") measurements.panel1 = state.extraMeasurement;
    else if (kind === "flap") measurements.flapHeight = state.extraMeasurement;
    await runSolve({ ...state, measurements });
  }

  const mainWidthClass =
    state.step === "result" && canShowPreview ? "max-w-4xl" : "max-w-lg";

  return (
    <div className="min-h-full bg-muted/30">
      <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur-sm">
        <div className={`mx-auto flex items-center gap-3 px-4 py-4 ${mainWidthClass}`}>
          <Link
            href="/"
            className="flex size-9 shrink-0 items-center justify-center rounded-lg border bg-background text-muted-foreground"
            aria-label="Back to home"
          >
            <ArrowLeft className="size-4" />
          </Link>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-semibold">Price a Sample</h1>
            <p className="text-sm text-muted-foreground">Measure a flat blank, get the box size</p>
          </div>
          <Package className="size-5 shrink-0 text-muted-foreground" />
        </div>
      </header>

      <main className={`mx-auto px-4 py-6 pb-28 ${mainWidthClass}`}>
        {state.step === "style" && (
          <section className="space-y-4">
            <div>
              <h2 className="text-xl font-semibold">What kind of blank is it?</h2>
              <p className="mt-1 text-sm text-muted-foreground">Tap the picture that looks like your sample.</p>
            </div>
            <div className="grid gap-3">
              {STYLE_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => selectStyle(option.id)}
                  className="flex items-center gap-4 rounded-xl border bg-card p-4 text-left shadow-sm transition-colors hover:border-primary/40 active:bg-muted/50"
                >
                  <div className="flex size-20 shrink-0 items-center justify-center rounded-lg bg-muted/50">
                    <StyleDiagram style={option.id} className="h-14 w-20" />
                  </div>
                  <div>
                    <p className="font-semibold">{option.title}</p>
                    <p className="text-sm text-muted-foreground">{option.subtitle}</p>
                  </div>
                </button>
              ))}
            </div>

            {pendingSeam && (
              <Card className="border-primary/30 bg-primary/5">
                <CardContent className="space-y-4 pt-6">
                  <p className="font-medium">Is there a taped or stitched seam?</p>
                  <p className="text-sm text-muted-foreground">
                    A tube has a seam joining the panels. A liner is the same shape but not joined.
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    <Button size="lg" onClick={() => answerSeam(true)}>
                      Yes, has seam
                    </Button>
                    <Button size="lg" variant="outline" onClick={() => answerSeam(false)}>
                      No seam
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}
          </section>
        )}

        {state.step === "joint" && (
          <section className="space-y-4">
            <div>
              <h2 className="text-xl font-semibold">Is there a glue tab?</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Look at the ends of the flat blank. A narrow extra strip (about 1–2 inches) past the
                last crease means it was glued or stitched.
              </p>
            </div>
            <div className="grid gap-3">
              <button
                type="button"
                onClick={() => selectJoint("glued")}
                className="rounded-xl border bg-card p-4 text-left shadow-sm transition-colors hover:border-primary/40 active:bg-muted/50"
              >
                <p className="font-semibold">Yes — glued or stitched</p>
                <p className="text-sm text-muted-foreground">
                  There is a tab on one end. You will measure width without the tab.
                </p>
              </button>
              <button
                type="button"
                onClick={() => selectJoint("taped")}
                className="rounded-xl border bg-card p-4 text-left shadow-sm transition-colors hover:border-primary/40 active:bg-muted/50"
              >
                <p className="font-semibold">No — taped</p>
                <p className="text-sm text-muted-foreground">No extra tab; measure the full blank width.</p>
              </button>
            </div>
            <Button variant="ghost" onClick={() => setState((c) => ({ ...c, step: "style" }))}>
              <ArrowLeft className="size-4" />
              Back
            </Button>
          </section>
        )}

        {state.step === "flute" && (
          <section className="space-y-4">
            <div>
              <h2 className="text-xl font-semibold">What flute is it?</h2>
              <p className="mt-1 text-sm text-muted-foreground">Look at the edge of the corrugated board.</p>
            </div>
            <div className="grid gap-3">
              {FLUTE_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => selectFlute(option.id)}
                  className="flex items-center gap-4 rounded-xl border bg-card p-4 text-left shadow-sm transition-colors hover:border-primary/40 active:bg-muted/50"
                >
                  <div className="w-28 shrink-0 overflow-hidden rounded-lg">
                    <FluteProfile flute={option.id} className="h-12 w-full" />
                  </div>
                  <div>
                    <p className="font-semibold">{option.title}</p>
                    <p className="text-sm text-muted-foreground">{option.subtitle}</p>
                  </div>
                </button>
              ))}
            </div>
            <Button
              variant="ghost"
              onClick={() =>
                setState((c) => ({
                  ...c,
                  step: c.style === "tube" ? "style" : "joint",
                }))
              }
            >
              <ArrowLeft className="size-4" />
              Back
            </Button>
          </section>
        )}

        {state.step === "measurements" && state.style && (
          <section className="space-y-5">
            <div>
              <h2 className="text-xl font-semibold">Measure panel creases</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Measure crease-to-crease on each panel — not the full blank. Fractions are fine (e.g. 6 3/4).
              </p>
            </div>

            <div className="rounded-xl border border-dashed bg-card p-4">
              <p className="text-sm font-medium">Measure from photo</p>
              <p className="mt-1 text-sm text-muted-foreground">
                One photo, calibrate once, then measure the height panel and both panel widths in the same
                session.
              </p>
              <div className="mt-3 flex items-center justify-between gap-2 rounded-md border bg-muted/30 px-3 py-2 text-sm">
                <span className="text-muted-foreground">Measuring inside or outside faces?</span>
                <Select
                  value={state.dimensionStandard}
                  onValueChange={(v) => setState((c) => ({ ...c, dimensionStandard: v as DimensionStandard }))}
                >
                  <SelectTrigger className="h-8 w-28">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ID">Inside (ID)</SelectItem>
                    <SelectItem value="OD">Outside (OD)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button
                variant="outline"
                className="mt-3 w-full"
                onClick={() => openPhotoSession(requiredPhotoDimensions())}
              >
                <Camera className="size-4" />
                {photoCalibration ? "Open photo / recalibrate" : "Take or choose photo"}
              </Button>
            </div>

            {state.style !== "tube" ? (
              <MeasureField
                label="Height panel"
                hint="Middle panel, top crease to bottom crease (between the flap creases)"
                value={state.measurements.panelD}
                onChange={(v) => updateMeasurement("panelD", v)}
                diagram={<PanelDDiagram className="mx-auto h-28 w-24" />}
                onMeasure={
                  photoCalibration ? () => openPhotoSession(requiredPhotoDimensions()) : undefined
                }
              />
            ) : (
              <MeasureField
                label="Blank height"
                hint="Bottom edge to top edge — this is the tube height"
                value={state.measurements.blankHeight}
                onChange={(v) => updateMeasurement("blankHeight", v)}
                diagram={<BlankHeightDiagram className="mx-auto h-28 w-24" />}
                onMeasure={
                  photoCalibration ? () => openPhotoSession(requiredPhotoDimensions()) : undefined
                }
              />
            )}

            <MeasureField
              label="First panel width"
              hint={
                state.joint === "glued" && state.style !== "tube"
                  ? "From the end WITHOUT the tab to the first vertical crease"
                  : "Left edge to the first vertical crease"
              }
              value={state.measurements.panel1}
              onChange={(v) => updateMeasurement("panel1", v)}
              diagram={<PanelOneDiagram className="mx-auto h-20 w-full max-w-xs" />}
              onMeasure={
                photoCalibration ? () => openPhotoSession(requiredPhotoDimensions()) : undefined
              }
            />

            <MeasureField
              label="Second panel width"
              hint="First crease to the second vertical crease"
              value={state.measurements.panel2}
              onChange={(v) => updateMeasurement("panel2", v)}
              diagram={<PanelTwoDiagram className="mx-auto h-20 w-full max-w-xs" />}
              onMeasure={
                photoCalibration ? () => openPhotoSession(requiredPhotoDimensions()) : undefined
              }
            />

            <details className="rounded-xl border bg-card px-4 py-3">
              <summary className="cursor-pointer text-sm font-medium">
                Whole-blank measurements (double-check)
              </summary>
              <div className="mt-4 space-y-4">
                <MeasureField
                  label="Blank width"
                  hint={
                    state.joint === "glued"
                      ? "Optional — from the non-tab end to the tab-base crease; do not include the tab"
                      : "Optional — left edge to right edge"
                  }
                  value={state.measurements.blankWidth}
                  onChange={(v) => updateMeasurement("blankWidth", v)}
                  diagram={
                    state.joint === "glued" ? (
                      <BlankWidthExcludesTabDiagram className="mx-auto h-24 w-full max-w-sm" />
                    ) : (
                      <BlankWidthDiagram className="mx-auto h-20 w-full max-w-xs" />
                    )
                  }
                  onMeasure={
                    photoCalibration ? () => openPhotoSession(optionalPhotoDimensions()) : undefined
                  }
                />
                {state.style !== "tube" && (
                  <>
                    <MeasureField
                      label="Blank height"
                      hint="Optional — bottom edge to top edge"
                      value={state.measurements.blankHeight}
                      onChange={(v) => updateMeasurement("blankHeight", v)}
                      diagram={<BlankHeightDiagram className="mx-auto h-28 w-24" />}
                      onMeasure={
                        photoCalibration ? () => openPhotoSession(optionalPhotoDimensions()) : undefined
                      }
                    />
                    <MeasureField
                      label="Flap height"
                      hint="Optional — bottom edge to first horizontal crease"
                      value={state.measurements.flapHeight}
                      onChange={(v) => updateMeasurement("flapHeight", v)}
                      diagram={
                        state.style === "hsc" ? (
                          <HscFlapHeightDiagram className="mx-auto h-24 w-full max-w-xs" />
                        ) : (
                          <FlapHeightDiagram className="mx-auto h-28 w-full max-w-xs" />
                        )
                      }
                      onMeasure={
                        photoCalibration ? () => openPhotoSession(optionalPhotoDimensions()) : undefined
                      }
                    />
                  </>
                )}
              </div>
            </details>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <div className="flex gap-3">
              <Button variant="outline" onClick={() => setState((c) => ({ ...c, step: "flute" }))}>
                Back
              </Button>
              <Button className="flex-1" size="lg" disabled={loading} onClick={() => void submitMeasurements()}>
                {loading ? <Loader2 className="size-4 animate-spin" /> : "Get box size"}
              </Button>
            </div>
          </section>
        )}

        {state.step === "result" && state.solveResult && state.flute && (
          <section className="space-y-5">
            <div className="rounded-xl border bg-card p-5 shadow-sm">
              <p className="text-sm font-medium text-muted-foreground">
                {styleDisplayName(state.solveResult.style, state.displayLabel)}
              </p>
              <p className="mt-2 text-3xl font-bold tracking-tight">
                {formatFractionInches(state.solveResult.L)} × {formatFractionInches(state.solveResult.W)} ×{" "}
                {formatFractionInches(state.solveResult.D)} in
              </p>
              <p className="mt-1 text-sm text-muted-foreground">Inside length × width × height</p>
              {state.solveResult.outside_L !== undefined &&
                state.solveResult.outside_W !== undefined &&
                state.solveResult.outside_D !== undefined && (
                  <p className="mt-2 text-lg font-semibold text-muted-foreground">
                    Outside (approx):{" "}
                    {formatFractionInches(state.solveResult.outside_L)} ×{" "}
                    {formatFractionInches(state.solveResult.outside_W)} ×{" "}
                    {formatFractionInches(state.solveResult.outside_D)} in
                  </p>
                )}
              <p className="mt-2 text-sm font-medium">{jointDisplayLabel(state.solveResult)}</p>
              {state.solveResult.warning && (
                <p className="mt-2 text-sm text-amber-800">{state.solveResult.warning}</p>
              )}
              <div className="mt-4 inline-flex rounded-full bg-muted px-3 py-1 text-sm font-medium">
                {confidenceLabel(state.solveResult.confidence)}
              </div>
              {state.solveResult.reason && state.solveResult.confidence === "ambiguous" && (
                <p className="mt-3 text-sm text-muted-foreground">{state.solveResult.reason}</p>
              )}
            </div>

            {Object.keys(state.rawMeasurements).length > 0 && (
              <details className="rounded-xl border bg-card px-4 py-3">
                <summary className="cursor-pointer text-sm font-medium">As measured (raw, from photo)</summary>
                <div className="mt-3 space-y-1 text-sm">
                  {(Object.entries(state.rawMeasurements) as [keyof SampleMeasurements, { raw: number; dimensionStandard: string }][]).map(
                    ([field, m]) => (
                      <div key={field} className="flex justify-between border-b border-dashed pb-1 last:border-0">
                        <span className="text-muted-foreground">{MEASUREMENT_FIELD_LABELS[field]}</span>
                        <span className="font-mono">
                          {formatFractionInches(m.raw, 16)}&quot; ({m.dimensionStandard})
                        </span>
                      </div>
                    ),
                  )}
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  Captured directly from the photo at full precision — never rounded or padded. The length ×
                  width × height above is computed from these via the flute&apos;s scoring allowances.
                </p>
              </details>
            )}

            {needsExtraMeasurement(state.solveResult) && (
              <Card>
                <CardContent className="space-y-4 pt-6">
                  <p className="font-medium">One more measurement would help</p>
                  <p className="text-sm text-muted-foreground">
                    {displaySuggestedInput(state.solveResult.suggested_input ?? "")}
                  </p>
                  {extraMeasurementKind(state.solveResult) === "panel-d" ? (
                    <PanelDDiagram className="mx-auto h-28 w-24" />
                  ) : extraMeasurementKind(state.solveResult) === "panel" ? (
                    <PanelOneDiagram className="mx-auto h-20 w-full max-w-xs" />
                  ) : state.solveResult.style === "hsc" ? (
                    <HscFlapHeightDiagram className="mx-auto h-24 w-full max-w-xs" />
                  ) : (
                    <FlapHeightDiagram className="mx-auto h-28 w-full max-w-xs" />
                  )}
                  <div className="space-y-2">
                    <Label htmlFor="extra-measure">Additional measurement (in)</Label>
                    <Input
                      id="extra-measure"
                      inputMode="decimal"
                      placeholder='e.g. 4 5/8'
                      value={state.extraMeasurement}
                      onChange={(e) => setState((c) => ({ ...c, extraMeasurement: e.target.value }))}
                      className="h-12 text-lg"
                    />
                  </div>
                  <Button className="w-full" size="lg" disabled={loading} onClick={() => void submitExtraMeasurement()}>
                    {loading ? <Loader2 className="size-4 animate-spin" /> : "Update result"}
                  </Button>
                </CardContent>
              </Card>
            )}

            {canShowPreview && state.solveResult && state.flute && (
              <DielinePreviewPanel
                geometry={geometry}
                isLoading={previewLoading}
                error={previewError}
                previewMessage={previewMessage}
                warnings={previewWarnings}
                derived={previewDerived}
                footer={
                  <div className="flex flex-col gap-3">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <p className="text-sm text-muted-foreground">
                        {formatDimensionSummary(
                          state.solveResult.L,
                          state.solveResult.W,
                          state.solveResult.D,
                          `${state.flute}-flute · ${jointDisplayLabel(state.solveResult)}`,
                          "fraction",
                        )}
                      </p>
                      <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
                        <Button
                          variant="outline"
                          disabled={exportingDxf}
                          onClick={async () => {
                            setExportingDxf(true);
                            try {
                              const payload = solveResultToGeneratePayload(
                                state.solveResult!,
                                state.flute!,
                              );
                              const blob = await fetchDielineDxfFromPayload(payload);
                              downloadDxfFromPayload(blob, payload);
                            } finally {
                              setExportingDxf(false);
                            }
                          }}
                        >
                          {exportingDxf ? (
                            <Loader2 className="size-4 animate-spin" />
                          ) : (
                            <Download className="size-4" />
                          )}
                          Download DXF
                        </Button>
                        <Button
                          variant="outline"
                          disabled={!svgMarkup || previewLoading}
                          onClick={() => {
                            const payload = solveResultToGeneratePayload(
                              state.solveResult!,
                              state.flute!,
                            );
                            downloadSvgFromPayload(svgMarkup, payload);
                          }}
                        >
                          <Download className="size-4" />
                          Download SVG
                        </Button>
                      </div>
                    </div>
                    <Button
                      variant="secondary"
                      className="w-full sm:w-auto"
                      onClick={async () => {
                        const text = copySpecText(
                          state.solveResult!,
                          state.flute!,
                          state.displayLabel,
                        );
                        await navigator.clipboard.writeText(text);
                        setCopied(true);
                        setTimeout(() => setCopied(false), 2000);
                      }}
                    >
                      {copied ? <Check className="size-4" /> : <ClipboardCopy className="size-4" />}
                      {copied ? "Copied!" : "Copy spec to clipboard"}
                    </Button>
                  </div>
                }
              />
            )}

            {state.solveResult.confidence === "low" && state.style && (
              <Card className="border-amber-200 bg-amber-50/50">
                <CardContent className="space-y-3 pt-6">
                  <p className="font-medium">Send to a designer</p>
                  <p className="text-sm text-muted-foreground">
                    These measurements don&apos;t fit a standard box style well. Share what you gathered and our best
                    guess below.
                  </p>
                  <pre className="whitespace-pre-wrap rounded-lg bg-background/80 p-3 text-sm text-foreground">
                    {formatEnteredMeasurements(state.measurements, state.style)}
                  </pre>
                  <p className="text-sm">
                    Best guess:{" "}
                    <span className="font-semibold">
                      {formatFractionInches(state.solveResult.L)} × {formatFractionInches(state.solveResult.W)} ×{" "}
                      {formatFractionInches(state.solveResult.D)} in
                    </span>
                  </p>
                </CardContent>
              </Card>
            )}

            <Button variant="ghost" className="w-full" onClick={reset}>
              <RotateCcw className="size-4" />
              Start over
            </Button>
          </section>
        )}
      </main>

      {photoSessionOpen && (
        <PhotoMeasureSession
          dimensions={photoSessionDimensions}
          presentation="overlay"
          initialCalibration={photoCalibration}
          onLockDimension={handlePhotoLockDimension}
          onCalibrationChange={(cal: PhotoCalibrationCapture) => setPhotoCalibration(cal)}
          onComplete={() => setPhotoSessionOpen(false)}
          onCancel={() => setPhotoSessionOpen(false)}
        />
      )}
    </div>
  );
}

function MeasureField({
  label,
  hint,
  value,
  onChange,
  diagram,
  onMeasure,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (value: string) => void;
  diagram: React.ReactNode;
  onMeasure?: () => void;
}) {
  return (
    <div className="rounded-xl border bg-card p-4 shadow-sm">
      <div className="mb-3">{diagram}</div>
      <div className="flex items-start justify-between gap-2">
        <Label className="text-base font-semibold">{label}</Label>
        {onMeasure && (
          <Button variant="outline" size="sm" onClick={onMeasure}>
            <Ruler className="size-3.5" />
            Measure
          </Button>
        )}
      </div>
      <p className="mb-2 text-sm text-muted-foreground">{hint}</p>
      <Input
        inputMode="decimal"
        placeholder='e.g. 42 3/4'
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-12 text-lg"
      />
    </div>
  );
}
