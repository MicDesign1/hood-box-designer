"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";

import { DielinePreview } from "@/components/dieline-preview";
import { DerivedScoresTable } from "@/components/derived-scores-table";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { DielineGeometry } from "@/types/geometry";

export interface DielinePreviewPanelProps {
  geometry: DielineGeometry | null;
  isLoading?: boolean;
  error?: string | null;
  previewMessage?: string | null;
  warnings?: string[];
  derived?: Record<string, string | number | boolean | null>;
  title?: string;
  description?: string;
  footer?: React.ReactNode;
}

export function DielinePreviewPanel({
  geometry,
  isLoading = false,
  error = null,
  previewMessage = null,
  warnings = [],
  derived = {},
  title = "Live Dieline Preview",
  description = "Server-rendered layout with cut lines (red) and crease lines (green dashed).",
  footer,
}: DielinePreviewPanelProps) {
  const [showCuts, setShowCuts] = useState(true);
  const [showCreases, setShowCreases] = useState(true);
  const [showLabels, setShowLabels] = useState(true);

  return (
    <Card className="flex flex-1 flex-col">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-4">
        <div className="print-hide flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
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

        {Object.keys(derived).length > 0 ? <DerivedScoresTable derived={derived} /> : null}

        {footer}
      </CardContent>
    </Card>
  );
}
