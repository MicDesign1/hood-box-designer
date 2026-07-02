import { formatDecimalInches, formatFractionInches, type UnitSystem } from "@/lib/imperial";

type DerivedValues = Record<string, string | number | boolean | null>;

interface DerivedRow {
  label: string;
  formula?: string;
  fraction: string;
  decimal: string;
  /** Blank size etc: a compound W×H value that doesn't split into fraction/decimal columns. */
  wide?: boolean;
}

function getDerivedNumber(derived: DerivedValues, key: string): number | null {
  const raw = derived[key];
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string") {
    const parsed = Number.parseFloat(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function getUnitSystem(derived: DerivedValues): UnitSystem {
  return derived.units === "mm" ? "mm" : "in";
}

function getFlapDepth(derived: DerivedValues): number | null {
  const top = getDerivedNumber(derived, "flap_top");
  const bottom = getDerivedNumber(derived, "flap_bottom");

  if (top === null && bottom === null) return null;
  if (top === null) return bottom;
  if (bottom === null) return top;
  return Math.max(top, bottom);
}

function fmtFraction(value: number, units: UnitSystem): string {
  if (units === "mm") return "—";
  return `${formatFractionInches(value, 32)}"`;
}

function fmtDecimal(value: number, units: UnitSystem): string {
  if (units === "mm") return `${Number(value.toFixed(1))} mm`;
  return `${formatDecimalInches(value, 3)}"`;
}

function buildDerivedRows(derived: DerivedValues): DerivedRow[] {
  const units = getUnitSystem(derived);
  const rows: DerivedRow[] = [];

  const push = (label: string, value: number | null, formula?: string) => {
    if (value === null || !(value > 0)) return;
    rows.push({ label, formula, fraction: fmtFraction(value, units), decimal: fmtDecimal(value, units) });
  };

  push("Length panel", getDerivedNumber(derived, "panel_L"), "L + t");
  push("Width panel", getDerivedNumber(derived, "panel_W"), "W + t");
  push("Depth score", getDerivedNumber(derived, "depth_score"), "H + t");
  push("Flap depth", getFlapDepth(derived));
  push("Glue tab", getDerivedNumber(derived, "glue_tab"));
  push("Slot width", getDerivedNumber(derived, "slot_width"));
  push("Fillet radius", getDerivedNumber(derived, "fillet_radius"));

  const blankW = getDerivedNumber(derived, "blank_w");
  const blankH = getDerivedNumber(derived, "blank_h");
  if (blankW !== null && blankH !== null) {
    const blankLabel =
      units === "mm"
        ? `${Number(blankW.toFixed(1))} × ${Number(blankH.toFixed(1))} mm`
        : `${formatFractionInches(blankW, 32)}" × ${formatFractionInches(blankH, 32)}"`;
    rows.push({ label: "Blank size", fraction: blankLabel, decimal: "", wide: true });
  }

  return rows;
}

interface DerivedScoresTableProps {
  derived: DerivedValues;
}

export function DerivedScoresTable({ derived }: DerivedScoresTableProps) {
  const rows = buildDerivedRows(derived);
  if (rows.length === 0) return null;

  return (
    <div className="overflow-hidden rounded-lg border bg-card text-card-foreground shadow-sm">
      <div className="border-b bg-muted/30 px-4 py-3">
        <h3 className="text-sm font-medium">Derived Scores</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Panel sizes account for board caliper (t) — inside dimension + caliper.
        </p>
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border/60 text-[11px] uppercase tracking-wide text-muted-foreground">
            <th className="px-4 py-2 text-left font-medium">Score</th>
            <th className="px-4 py-2 text-right font-medium">Fraction</th>
            <th className="px-4 py-2 text-right font-medium">Decimal</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr
              key={row.label}
              className={index < rows.length - 1 ? "border-b border-border/60" : undefined}
            >
              <td className="px-4 py-2.5 text-muted-foreground">
                {row.label}
                {row.formula ? (
                  <span className="ml-1.5 font-mono text-[11px] text-muted-foreground/70">
                    = {row.formula}
                  </span>
                ) : null}
              </td>
              {row.wide ? (
                <td
                  colSpan={2}
                  className="px-4 py-2.5 text-right font-mono text-[13px] tabular-nums tracking-tight text-foreground"
                >
                  {row.fraction}
                </td>
              ) : (
                <>
                  <td className="px-4 py-2.5 text-right font-mono text-[13px] tabular-nums tracking-tight text-foreground">
                    {row.fraction}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-[13px] tabular-nums tracking-tight text-muted-foreground">
                    {row.decimal}
                  </td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>

      <p className="border-t bg-muted/20 px-4 py-3 text-xs leading-relaxed text-muted-foreground">
        Scoring model: panels = inside dim + caliper (t); depth score = height + caliper;
        flap depth follows the active FEFCO style from width + caliper. Verify against your
        plant&apos;s flute allowance chart before cutting a die.
      </p>
    </div>
  );
}