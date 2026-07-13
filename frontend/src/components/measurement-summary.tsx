/**
 * The standing "All dimensions are inside (ID)" label (owner decision,
 * proposal §6) -- shared so Design and Sample display it identically.
 *
 * Previously also rendered a "Reference dimensions" list here. That display
 * was removed from the UI -- reference-marker creation itself was already
 * removed earlier (see git history) -- while leaving the backend wiring
 * (CaptureRole's reference variant, append_reference_legend, the
 * reference_dimensions API field, and the frontend request-building code
 * that still sends it) fully intact and dormant. L, W, H are the only
 * dimensions a user can see or place.
 */
export function MeasurementSummary() {
  return (
    <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        All dimensions are inside (ID)
      </p>
    </div>
  );
}
