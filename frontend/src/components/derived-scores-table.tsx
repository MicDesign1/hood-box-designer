import {
  formatBlankSize,
  formatDualDimension,
  type UnitSystem,
} from "@/lib/imperial";

type DerivedValues = Record<string, string | number | boolean | null>;

interface DerivedRow {
  label: string;
  value: string;
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

function buildDerivedRows(derived: DerivedValues): DerivedRow[] {
  const units = getUnitSystem(derived);
  const rows: DerivedRow[] = [];

  const panelL = getDerivedNumber(derived, "panel_L");
  if (panelL !== null) {
    rows.push({
      label: "Length panel",
      value: formatDualDimension(panelL, units),
    });
  }

  const panelW = getDerivedNumber(derived, "panel_W");
  if (panelW !== null) {
    rows.push({
      label: "Width panel",
      value: formatDualDimension(panelW, units),
    });
  }

  const depthScore = getDerivedNumber(derived, "depth_score");
  if (depthScore !== null) {
    rows.push({
      label: "Depth score",
      value: formatDualDimension(depthScore, units),
    });
  }

  const flapDepth = getFlapDepth(derived);
  if (flapDepth !== null && flapDepth > 0) {
    rows.push({
      label: "Flap depth",
      value: formatDualDimension(flapDepth, units),
    });
  }

  const slotWidth = getDerivedNumber(derived, "slot_width");
  if (slotWidth !== null) {
    rows.push({
      label: "Slot width",
      value: formatDualDimension(slotWidth, units),
    });
  }

  const blankW = getDerivedNumber(derived, "blank_w");
  const blankH = getDerivedNumber(derived, "blank_h");
  if (blankW !== null && blankH !== null) {
    rows.push({
      label: "Blank size",
      value: formatBlankSize(blankW, blankH, units),
    });
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
      </div>

      <table className="w-full text-sm">
        <tbody>
          {rows.map((row, index) => (
            <tr
              key={row.label}
              className={index < rows.length - 1 ? "border-b border-border/60" : undefined}
            >
              <td className="px-4 py-2.5 text-muted-foreground">{row.label}</td>
              <td className="px-4 py-2.5 text-right font-mono text-[13px] tabular-nums tracking-tight text-foreground">
                {row.value}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="border-t bg-muted/20 px-4 py-3 text-xs leading-relaxed text-muted-foreground">
        Scoring model: panels = inside dim + caliper; depth score = height + caliper;
        flap depth follows the active FEFCO style from width + caliper.
      </p>
    </div>
  );
}