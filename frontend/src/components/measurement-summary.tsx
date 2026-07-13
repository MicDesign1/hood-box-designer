import type { ReferenceDimension } from "@/types/capture";

export interface MeasurementSummaryProps {
  referenceDimensions: ReferenceDimension[];
}

/**
 * Shared reference-dimensions display + the standing "All dimensions are
 * inside (ID)" label (owner decision, proposal §6) -- used by both Design
 * and Sample so the two Phase 3 ad-hoc lists don't drift apart.
 *
 * Deliberately does NOT re-render raw panel measurements, the solved
 * length/width/height, or the "Outside (approx)" row: Sample's results
 * screen already shows all three (the "As measured" detail, the L x W x H
 * header, and the Outside line) and rebuilding them here would duplicate
 * tested, working UI for no reader benefit. This component is the one
 * genuinely new, shared piece both flows needed.
 */
export function MeasurementSummary({ referenceDimensions }: MeasurementSummaryProps) {
  return (
    <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        All dimensions are inside (ID)
      </p>
      {referenceDimensions.length > 0 && (
        <div data-testid="reference-dimensions-list">
          <p className="mt-1.5 font-semibold">Reference dimensions</p>
          <ul className="mt-1 space-y-0.5 text-muted-foreground">
            {referenceDimensions.map((ref, i) => (
              <li key={i}>
                {ref.label}: <span className="font-mono">{ref.rawInches.toFixed(3)}&quot;</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
