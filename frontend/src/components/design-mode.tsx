"use client";

import { useEffect, useState } from "react";
import { Download, Loader2, Printer } from "lucide-react";

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
import { DielinePreviewPanel } from "@/components/dieline-preview-panel";
import {
  FEFCO_STYLES,
  JOINT_OPTIONS,
  RSC_FLUTE_OPTIONS,
  caliperForSpec,
  getFefcoStyleLabel,
  isFefcoStyleAvailable,
  type BoxSpec,
  type JointType,
  type RscFluteType,
} from "@/types/box";
import type { ReferenceDimension } from "@/types/capture";
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

function visibleDimensionFields(style: BoxSpec["style"]) {
  return style === "0201"
    ? DIMENSION_FIELDS.filter((field) => field.key !== "caliper")
    : DIMENSION_FIELDS;
}

function buildInputValues(spec: BoxSpec, format: DimensionFormat): Record<NumericField, string> {
  return {
    length: formatInches(spec.length, format, 3),
    width: formatInches(spec.width, format, 3),
    height: formatInches(spec.height, format, 3),
    caliper: formatInches(spec.caliper, format, 4),
  };
}

export interface DesignModeProps {
  spec: BoxSpec;
  setSpec: React.Dispatch<React.SetStateAction<BoxSpec>>;
  /** Bumped whenever spec is updated from outside (e.g. Photo Mode) so input text resyncs. */
  specRevision: number;
  /** Reference dimensions captured via Photo Input -- drawn as a legend on
   * the generated SVG/DXF (requirement B), never read by geometry/scoring. */
  referenceDimensions?: ReferenceDimension[];
}

export function DesignMode({ spec, setSpec, specRevision, referenceDimensions = [] }: DesignModeProps) {
  const [dimensionFormat, setDimensionFormat] = useState<DimensionFormat>("decimal");
  const [inputValues, setInputValues] = useState<Record<NumericField, string>>(() =>
    buildInputValues(spec, "decimal"),
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

  const styleIsAvailable = isFefcoStyleAvailable(spec.style);
  const isRsc = spec.style === "0201";
  const effectiveCaliper = caliperForSpec(spec);

  // Re-syncs on manual format toggles AND on external spec updates (e.g. Photo
  // Mode applying measurements) — but not on every keystroke from
  // updateDimension below, which already keeps inputValues in lockstep itself.
  useEffect(() => {
    setInputValues(buildInputValues(spec, dimensionFormat));
    // `spec` is deliberately excluded: it changes on every keystroke via
    // updateDimension, and re-running this on every change would fight the
    // user's typing (reformatting the field mid-edit).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dimensionFormat, specRevision]);

  useEffect(() => {
    const controller = new AbortController();

    async function loadDieline() {
      setIsLoading(true);
      setError(null);

      try {
        const result = await fetchDielineSvg(spec, referenceDimensions, controller.signal);
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
  }, [spec, referenceDimensions]);

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
      const blob = await fetchDielineDxf(spec, referenceDimensions);
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
                setSpec((current) => {
                  const style = value as BoxSpec["style"];
                  if (style === "0201") {
                    return {
                      ...current,
                      style,
                      fluteType: current.fluteType ?? "C",
                      joint: current.joint ?? "glued",
                    };
                  }
                  return { ...current, style };
                })
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
            {visibleDimensionFields(spec.style).map(({ key, label, min, decimalStep }) => (
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

          {isRsc ? (
            <>
              <div className="space-y-2">
                <Label htmlFor="flute-type">Flute</Label>
                <Select
                  value={spec.fluteType ?? "C"}
                  onValueChange={(value) =>
                    setSpec((current) => ({
                      ...current,
                      fluteType: value as RscFluteType,
                    }))
                  }
                >
                  <SelectTrigger id="flute-type" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {RSC_FLUTE_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="joint-type">Joint</Label>
                <Select
                  value={spec.joint ?? "glued"}
                  onValueChange={(value) =>
                    setSpec((current) => ({
                      ...current,
                      joint: value as JointType,
                    }))
                  }
                >
                  <SelectTrigger id="joint-type" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {JOINT_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </>
          ) : null}

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
              automatic radius (0.75× board caliper, min 0.125&quot;); enter 0 for sharp corners.
              {isRsc ? (
                <>
                  {" "}
                  Caliper follows the selected flute ({formatInches(effectiveCaliper, "decimal", 4)}{" "}
                  in).
                </>
              ) : null}
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="flex min-w-0 flex-col gap-4">
        <DielinePreviewPanel
          geometry={geometry}
          isLoading={isLoading}
          error={error}
          previewMessage={previewMessage}
          warnings={warnings}
          derived={derived}
          description={
            styleIsAvailable
              ? "Server-rendered layout with cut lines (red) and crease lines (green dashed)."
              : "Placeholder preview from the backend while this style is in development."
          }
          footer={
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-muted-foreground">
                {formatDimensionSummary(
                  spec.length,
                  spec.width,
                  spec.height,
                  isRsc
                    ? `${spec.fluteType ?? "C"}-flute · ${spec.joint ?? "glued"} joint`
                    : `Board ${formatInches(spec.caliper, dimensionFormat, 4)} in`,
                  dimensionFormat,
                )}
              </p>
              <div className="print-hide flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
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
                <Button
                  variant="outline"
                  onClick={() => window.print()}
                  className="w-full sm:w-auto"
                  disabled={!styleIsAvailable || isLoading}
                >
                  <Printer />
                  Print / Save as PDF
                </Button>
              </div>
            </div>
          }
        />

        <p className="text-center text-xs text-muted-foreground sm:text-sm">
          Preview and exports are generated server-side with FEFCO-aware flap, slot, and
          glue-tab rules. Validate allowances, registration marks, and press-specific
          clearances before production.
        </p>
      </div>
    </main>
  );
}
