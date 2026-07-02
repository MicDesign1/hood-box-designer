"use client";

import { useEffect, useState } from "react";
import { Download, Loader2, Package } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  downloadDxf,
  downloadSvg,
  fetchDielineDxf,
  fetchDielineSvg,
} from "@/lib/dieline";
import {
  formatDimensionSummary,
  formatInches,
  parseImperialInput,
  type DimensionFormat,
} from "@/lib/imperial";
import { DielinePreview } from "@/components/dieline-preview";
import { DerivedScoresTable } from "@/components/derived-scores-table";
import {
  DEFAULT_BOX_SPEC,
  FEFCO_STYLES,
  getFefcoStyleLabel,
  isFefcoStyleAvailable,
  type BoxSpec,
} from "@/types/box";
import type { DielineGeometry } from "@/types/geometry";

type NumericField = keyof Pick<BoxSpec, "length" | "width" | "height" | "caliper">;

const DIMENSION_FIELDS: {
  key: NumericField;
  label: string;
  min: number;
  decimalStep: number;
  precision: number;
}[] = [
  { key: "length", label: "Length (in)", min: 2, decimalStep: 0.0625, precision: 3 },
  { key: "width", label: "Width (in)", min: 2, decimalStep: 0.0625, precision: 3 },
  { key: "height", label: "Height (in)", min: 1, decimalStep: 0.0625, precision: 3 },
  { key: "caliper", label: "Board Caliper (in)", min: 0.01, decimalStep: 0.001, precision: 4 },
];

function buildInputValues(spec: BoxSpec, format: DimensionFormat): Record<NumericField, string> {
  return {
    length: formatInches(spec.length, format, 3),
    width: formatInches(spec.width, format, 3),
    height: formatInches(spec.height, format, 3),
    caliper: formatInches(spec.caliper, format, 4),
  };
}

export default function HomePage() {
  const [spec, setSpec] = useState<BoxSpec>(DEFAULT_BOX_SPEC);
  const [dimensionFormat, setDimensionFormat] = useState<DimensionFormat>("decimal");
  const [inputValues, setInputValues] = useState<Record<NumericField, string>>(() =>
    buildInputValues(DEFAULT_BOX_SPEC, "decimal"),
  );
  const [filletRadiusInput, setFilletRadiusInput] = useState("");
  const [svgMarkup, setSvgMarkup] = useState("");
  const [geometry, setGeometry] = useState<DielineGeometry | null>(null);
  const [previewMessage, setPreviewMessage] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [derived, setDerived] = useState<Record<string, string | number | boolean | null>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isExportingDxf, setIsExportingDxf] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCuts, setShowCuts] = useState(true);
  const [showCreases, setShowCreases] = useState(true);
  const [showLabels, setShowLabels] = useState(true);

  const styleIsAvailable = isFefcoStyleAvailable(spec.style);

  useEffect(() => {
    setInputValues(buildInputValues(spec, dimensionFormat));
  }, [dimensionFormat]);

  useEffect(() => {
    const controller = new AbortController();

    async function loadDieline() {
      setIsLoading(true);
      setError(null);

      try {
        const result = await fetchDielineSvg(spec, controller.signal);
        if (controller.signal.aborted) return;

        setSvgMarkup(result.svg);
        setGeometry(result.geometry ?? null);
        setPreviewMessage(result.message);
        setWarnings(result.warnings ?? []);
        setDerived(result.derived ?? {});
      } catch (loadError) {
        if (controller.signal.aborted) return;
        setSvgMarkup("");
        setGeometry(null);
        setPreviewMessage(null);
        setWarnings([]);
        setDerived({});
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Failed to load dieline from backend.",
        );
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    }

    void loadDieline();

    return () => controller.abort();
  }, [spec]);

  function updateDimension(field: NumericField, rawValue: string) {
    setInputValues((current) => ({ ...current, [field]: rawValue }));

    const parsed = parseImperialInput(rawValue);
    if (parsed === null) return;

    const fieldConfig = DIMENSION_FIELDS.find((item) => item.key === field);
    if (!fieldConfig || parsed < fieldConfig.min) return;

    setSpec((current) => ({ ...current, [field]: parsed }));
  }

  function updateFilletRadius(rawValue: string) {
    setFilletRadiusInput(rawValue);

    if (rawValue.trim() === "") {
      setSpec((current) => ({ ...current, filletRadius: undefined }));
      return;
    }

    const parsed = parseImperialInput(rawValue);
    if (parsed === null || parsed < 0) return;

    setSpec((current) => ({ ...current, filletRadius: parsed }));
  }

  async function handleDownloadDxf() {
    setIsExportingDxf(true);
    setError(null);

    try {
      const blob = await fetchDielineDxf(spec);
      downloadDxf(blob, spec);
    } catch (exportError) {
      setError(
        exportError instanceof Error
          ? exportError.message
          : "Failed to export DXF from backend.",
      );
    } finally {
      setIsExportingDxf(false);
    }
  }

  return (
    <div className="min-h-full bg-muted/30">
      <header className="border-b bg-background/80 backdrop-blur-sm">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-5 sm:px-6 lg:px-8">
          <div className="flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Package className="size-5" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
              Dieline Studio
            </h1>
            <p className="text-sm text-muted-foreground">
              FEFCO / ECMA Dieline Generator
            </p>
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-7xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[320px_1fr] lg:px-8 lg:py-8">
        <Card className="h-fit lg:sticky lg:top-6">
          <CardHeader>
            <CardTitle>Box Parameters</CardTitle>
            <CardDescription>
              Configure dimensions in imperial inches. Dielines are generated by the
              backend API.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="fefco-style">FEFCO Style</Label>
              <Select
                value={spec.style}
                onValueChange={(value) =>
                  setSpec((current) => ({ ...current, style: value as BoxSpec["style"] }))
                }
              >
                <SelectTrigger id="fefco-style" className="w-full">
                  <SelectValue>{getFefcoStyleLabel(spec.style)}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {FEFCO_STYLES.map((style) => (
                    <SelectItem key={style.code} value={style.code}>
                      {style.label}
                      {!style.available ? " (preview coming soon)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!styleIsAvailable ? (
                <p className="text-xs text-muted-foreground">
                  This style is listed for planning, but the backend has not been built for
                  it yet.
                </p>
              ) : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor="dimension-format">Dimension Format</Label>
              <Select
                value={dimensionFormat}
                onValueChange={(value) =>
                  setDimensionFormat(value as DimensionFormat)
                }
              >
                <SelectTrigger id="dimension-format" className="w-full">
                  <SelectValue>
                    {dimensionFormat === "decimal" ? "Decimal inches" : "Fraction inches"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="decimal">Decimal inches</SelectItem>
                  <SelectItem value="fraction">Fraction inches</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
              {DIMENSION_FIELDS.map(({ key, label, min, decimalStep }) => (
                <div key={key} className="space-y-2">
                  <Label htmlFor={key}>{label}</Label>
                  <Input
                    id={key}
                    type={dimensionFormat === "decimal" ? "number" : "text"}
                    min={dimensionFormat === "decimal" ? min : undefined}
                    step={dimensionFormat === "decimal" ? decimalStep : undefined}
                    inputMode={dimensionFormat === "decimal" ? "decimal" : "text"}
                    placeholder={dimensionFormat === "fraction" ? 'e.g. 12 1/2' : undefined}
                    value={inputValues[key]}
                    onChange={(event) => updateDimension(key, event.target.value)}
                    onBlur={(event) => {
                      const parsed = parseImperialInput(event.target.value);
                      if (parsed !== null) {
                        setInputValues((current) => ({
                          ...current,
                          [key]: formatInches(
                            parsed,
                            dimensionFormat,
                            key === "caliper" ? 4 : 3,
                          ),
                        }));
                      }
                    }}
                  />
                </div>
              ))}
            </div>

            {dimensionFormat === "fraction" ? (
              <p className="text-xs text-muted-foreground">
                Enter fractions like <span className="font-mono">12 1/2</span> or{" "}
                <span className="font-mono">3/8</span>
              </p>
            ) : null}

            <div className="space-y-2">
              <Label htmlFor="fillet-radius">Fillet radius (in)</Label>
              <Input
                id="fillet-radius"
                type="text"
                inputMode="decimal"
                placeholder="auto"
                value={filletRadiusInput}
                onChange={(event) => updateFilletRadius(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Rounds the slot-root corners where flaps meet the crease. Leave blank for an
                automatic radius (0.75× caliper, min 0.125&quot;); enter 0 for sharp corners.
              </p>
            </div>
          </CardContent>
        </Card>

        <div className="flex min-w-0 flex-col gap-4">
          <Card className="flex flex-1 flex-col">
            <CardHeader>
              <CardTitle>Live Dieline Preview</CardTitle>
              <CardDescription>
                {styleIsAvailable
                  ? "Server-rendered layout with cut lines (red) and crease lines (green dashed)."
                  : "Placeholder preview from the backend while this style is in development."}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col gap-4">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Layers
                </span>
                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    className="size-4 rounded border-input accent-primary"
                    checked={showCuts}
                    onChange={(event) => setShowCuts(event.target.checked)}
                  />
                  Cuts
                </label>
                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    className="size-4 rounded border-input accent-primary"
                    checked={showCreases}
                    onChange={(event) => setShowCreases(event.target.checked)}
                  />
                  Creases
                </label>
                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    className="size-4 rounded border-input accent-primary"
                    checked={showLabels}
                    onChange={(event) => setShowLabels(event.target.checked)}
                  />
                  Labels
                </label>
              </div>

              <div className="relative min-h-[320px] flex-1 sm:min-h-[420px] lg:min-h-[520px]">
                {isLoading ? (
                  <div className="absolute inset-0 z-10 flex items-center justify-center gap-2 rounded-lg border bg-white text-sm text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" />
                    Generating dieline…
                  </div>
                ) : null}
                {!isLoading && error ? (
                  <div className="flex h-full items-center justify-center rounded-lg border bg-white px-6 text-center text-sm text-destructive">
                    {error}
                  </div>
                ) : null}
                {!isLoading && !error ? (
                  <DielinePreview
                    geometry={geometry}
                    showCuts={showCuts}
                    showCreases={showCreases}
                    showLabels={showLabels}
                  />
                ) : null}
              </div>

              {previewMessage ? (
                <p className="text-xs text-muted-foreground">{previewMessage}</p>
              ) : null}

              {warnings.length > 0 ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  <p className="font-medium">Warnings</p>
                  <ul className="mt-1 list-disc space-y-1 pl-4">
                    {warnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {Object.keys(derived).length > 0 ? (
                <DerivedScoresTable derived={derived} />
              ) : null}

              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-muted-foreground">
                  {formatDimensionSummary(
                    spec.length,
                    spec.width,
                    spec.height,
                    spec.caliper,
                    dimensionFormat,
                  )}
                </p>
                <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
                  <Button
                    onClick={() => downloadSvg(svgMarkup, spec)}
                    className="w-full sm:w-auto"
                    disabled={!styleIsAvailable || isLoading || !svgMarkup}
                  >
                    <Download />
                    Download SVG
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => void handleDownloadDxf()}
                    className="w-full sm:w-auto"
                    disabled={!styleIsAvailable || isLoading || isExportingDxf}
                  >
                    {isExportingDxf ? <Loader2 className="size-4 animate-spin" /> : <Download />}
                    Download DXF
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <p className="text-center text-xs text-muted-foreground sm:text-sm">
            Preview and exports are generated server-side with FEFCO-aware flap, slot, and
            glue-tab rules. Validate allowances, registration marks, and press-specific
            clearances before production.
          </p>
        </div>
      </main>
    </div>
  );
}