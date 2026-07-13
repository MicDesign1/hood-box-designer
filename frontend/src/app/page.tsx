"use client";

import Link from "next/link";
import { useState } from "react";
import { Camera, ClipboardList, Ruler as RulerIcon, Package } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import { DesignMode } from "@/components/design-mode";
import { MeasurementSummary } from "@/components/measurement-summary";
import { PhotoMode } from "@/components/photo-mode";
import { cn } from "@/lib/utils";
import { DEFAULT_BOX_SPEC, type BoxSpec } from "@/types/box";
import type { ReferenceDimension } from "@/types/capture";

type Mode = "design" | "photo";

export default function HomePage() {
  const [mode, setMode] = useState<Mode>("design");
  const [spec, setSpec] = useState<BoxSpec>(DEFAULT_BOX_SPEC);
  const [specRevision, setSpecRevision] = useState(0);
  // Mirrors whatever the photo session last reported as its kept reference
  // markers -- drives both the on-screen MeasurementSummary and the legend
  // drawn onto the exported SVG/DXF.
  const [referenceDimensions, setReferenceDimensions] = useState<ReferenceDimension[]>([]);

  function applyPhotoMeasurements(dims: { length: number; width: number; height: number }) {
    setSpec((current) => ({ ...current, ...dims }));
    setSpecRevision((r) => r + 1);
    setMode("design");
  }

  return (
    <div className="min-h-full bg-muted/30">
      <header className="border-b bg-background/80 backdrop-blur-sm">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-5 sm:px-6 lg:px-8">
          <div className="flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Package className="size-5" />
          </div>
          <div>
            <h1 className="text-lg font-semibold tracking-tight sm:text-xl">
              Hood Container Dieline Studio
            </h1>
            <p className="text-sm text-muted-foreground">
              FEFCO / ECMA Dieline Generator
            </p>
          </div>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Link
              href="/sample"
              className={cn(buttonVariants({ size: "sm", variant: "outline" }), "gap-1.5")}
            >
              <ClipboardList />
              Price a Sample
            </Link>
            <div className="flex items-center gap-1 rounded-lg border bg-muted/40 p-1">
            <Button
              size="sm"
              variant={mode === "design" ? "default" : "ghost"}
              onClick={() => setMode("design")}
            >
              <RulerIcon />
              Design
            </Button>
            <Button
              size="sm"
              variant={mode === "photo" ? "default" : "ghost"}
              onClick={() => setMode("photo")}
            >
              <Camera />
              Photo Input
            </Button>
            </div>
          </div>
        </div>
      </header>

      {mode === "design" ? (
        <>
          <div className="mx-auto max-w-7xl px-4 pt-6 sm:px-6 lg:px-8">
            <MeasurementSummary referenceDimensions={referenceDimensions} />
          </div>
          <DesignMode spec={spec} setSpec={setSpec} specRevision={specRevision} referenceDimensions={referenceDimensions} />
        </>
      ) : (
        <PhotoMode onApplyMeasurements={applyPhotoMeasurements} onReferenceDimensions={setReferenceDimensions} />
      )}
    </div>
  );
}
