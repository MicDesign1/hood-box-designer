export type DimensionFormat = "decimal" | "fraction";

const FRACTION_DENOMINATORS = [2, 4, 8, 16, 32, 64] as const;

function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) {
    const temp = y;
    y = x % y;
    x = temp;
  }
  return x;
}

export function parseImperialInput(raw: string): number | null {
  const trimmed = raw.trim().replace(/"/g, "");
  if (!trimmed) return null;

  if (trimmed.endsWith("/") || /\s$/.test(raw)) return null;

  const normalized = trimmed.replace(/-/g, " ");
  const mixedMatch = normalized.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)$/);
  if (mixedMatch) {
    const whole = Number.parseInt(mixedMatch[1], 10);
    const numerator = Number.parseInt(mixedMatch[2], 10);
    const denominator = Number.parseInt(mixedMatch[3], 10);
    if (denominator === 0) return null;
    return whole + numerator / denominator;
  }

  const fractionMatch = normalized.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (fractionMatch) {
    const numerator = Number.parseInt(fractionMatch[1], 10);
    const denominator = Number.parseInt(fractionMatch[2], 10);
    if (denominator === 0) return null;
    return numerator / denominator;
  }

  if (/^\d+\s+\d+$/.test(normalized)) return null;

  const decimal = Number.parseFloat(normalized);
  if (Number.isNaN(decimal) || !/^-?\d+(\.\d+)?$/.test(normalized)) return null;

  return decimal;
}

function snapToFraction(
  inches: number,
  maxDenominator: (typeof FRACTION_DENOMINATORS)[number],
): { whole: number; numerator: number; denominator: number } {
  const sign = inches < 0 ? -1 : 1;
  const absolute = Math.abs(inches);
  const whole = Math.floor(absolute);
  const fractional = absolute - whole;

  let bestNumerator = 0;
  let bestDenominator = 1;
  let bestError = Number.POSITIVE_INFINITY;

  for (const denominator of FRACTION_DENOMINATORS) {
    if (denominator > maxDenominator) break;
    const numerator = Math.round(fractional * denominator);
    const error = Math.abs(fractional - numerator / denominator);
    if (error < bestError) {
      bestError = error;
      bestNumerator = numerator;
      bestDenominator = denominator;
    }
  }

  let adjustedWhole = whole;
  let numerator = bestNumerator;
  const denominator = bestDenominator;

  if (numerator === denominator) {
    adjustedWhole += 1;
    numerator = 0;
  }

  const divisor = gcd(numerator, denominator);
  const reducedNumerator = numerator / divisor;
  const reducedDenominator = denominator / divisor;

  return {
    whole: adjustedWhole * sign,
    numerator: reducedNumerator,
    denominator: reducedDenominator,
  };
}

export function formatFractionInches(
  inches: number,
  maxDenominator: (typeof FRACTION_DENOMINATORS)[number] = 16,
): string {
  const { whole, numerator, denominator } = snapToFraction(inches, maxDenominator);

  if (numerator === 0) {
    return `${whole}`;
  }

  const absoluteWhole = Math.abs(whole);
  const fraction = `${numerator}/${denominator}`;

  if (absoluteWhole === 0) {
    return whole < 0 ? `-${fraction}` : fraction;
  }

  return whole < 0 ? `-${absoluteWhole} ${fraction}` : `${absoluteWhole} ${fraction}`;
}

export function formatDecimalInches(inches: number, precision = 3): string {
  const rounded = Number(inches.toFixed(precision));
  return `${rounded}`;
}

export function formatInches(
  inches: number,
  format: DimensionFormat,
  precision = 3,
): string {
  if (format === "fraction") {
    const denominator = precision <= 2 ? 16 : precision <= 3 ? 32 : 64;
    return formatFractionInches(inches, denominator);
  }
  return formatDecimalInches(inches, precision);
}

export function formatDimensionSummary(
  length: number,
  width: number,
  height: number,
  boardLabel: string,
  format: DimensionFormat,
): string {
  const box =
    format === "fraction"
      ? `${formatFractionInches(length)} × ${formatFractionInches(width)} × ${formatFractionInches(height)} in`
      : `${formatDecimalInches(length)} × ${formatDecimalInches(width)} × ${formatDecimalInches(height)} in`;

  return `${box} · ${boardLabel}`;
}

export type UnitSystem = "in" | "mm";

export function formatDualDimension(
  value: number,
  units: UnitSystem,
  precision = 3,
): string {
  if (units === "mm") {
    const rounded = Number(value.toFixed(1));
    return `${rounded} mm`;
  }

  const fraction = formatFractionInches(value, 32);
  const decimal = formatDecimalInches(value, precision);
  return `${fraction}" (${decimal})`;
}

export function formatBlankSize(
  width: number,
  height: number,
  units: UnitSystem,
): string {
  if (units === "mm") {
    const w = Number(width.toFixed(1));
    const h = Number(height.toFixed(1));
    return `${w} × ${h} mm`;
  }

  return `${formatFractionInches(width, 32)} × ${formatFractionInches(height, 32)} in`;
}