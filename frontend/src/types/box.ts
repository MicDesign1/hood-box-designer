export type FefcoStyle =
  | "0200"
  | "0201"
  | "0202"
  | "0203"
  | "0204"
  | "0300"
  | "0409"
  | "0427"
  | "0713";

export type RscFluteType = "B" | "C" | "BC";

export type JointType = "taped" | "glued";

export interface FefcoStyleOption {
  code: FefcoStyle;
  label: string;
  available: boolean;
}

export const FEFCO_STYLES: FefcoStyleOption[] = [
  { code: "0201", label: "0201 — Regular Slotted Container (RSC)", available: true },
  { code: "0203", label: "0203 — Full Overlap Slotted Container (FOL)", available: true },
  { code: "0200", label: "0200 — Half Slotted Container (HSC)", available: true },
  { code: "0202", label: "0202 — Overlap Slotted Container (OSC)", available: true },
  { code: "0713", label: "0713 — Crash-Lock Auto Bottom", available: true },
  { code: "0204", label: "0204 — Full Flap Slotted Container", available: false },
  { code: "0300", label: "0300 — Telescope Box", available: false },
  { code: "0409", label: "0409 — Wrap-Around Blank", available: false },
  { code: "0427", label: "0427 — Die-Cut with Hinged Lid", available: false },
];

export const RSC_FLUTE_OPTIONS: { value: RscFluteType; label: string }[] = [
  { value: "B", label: "B-flute" },
  { value: "C", label: "C-flute" },
  { value: "BC", label: "BC doublewall" },
];

export const JOINT_OPTIONS: { value: JointType; label: string }[] = [
  { value: "taped", label: "Taped (no glue tab)" },
  { value: "glued", label: "Glued (1.5″ tab)" },
];

/** Nominal caliper (in) from scoring-allowances.md Quick-Reference. */
export const FLUTE_CALIPER_IN: Record<RscFluteType, number> = {
  B: 0.125,
  C: 0.1563,
  BC: 0.2813,
};

/** All dimensions are stored as decimal inches. */
export interface BoxSpec {
  style: FefcoStyle;
  length: number;
  width: number;
  height: number;
  /** Board caliper for non-0201 styles. For 0201, derived from `fluteType`. */
  caliper: number;
  /** 0201 only — selects scoring row and caliper. */
  fluteType?: RscFluteType;
  /** 0201 only — manufacturer's joint. */
  joint?: JointType;
  /** Slot-root fillet radius override, in inches. Omit for the backend's automatic radius. */
  filletRadius?: number;
}

export const DEFAULT_BOX_SPEC: BoxSpec = {
  style: "0201",
  length: 12,
  width: 8,
  height: 6,
  caliper: FLUTE_CALIPER_IN.C,
  fluteType: "C",
  joint: "taped",
};

export function getFefcoStyleLabel(code: FefcoStyle): string {
  return FEFCO_STYLES.find((style) => style.code === code)?.label ?? code;
}

export function isFefcoStyleAvailable(code: FefcoStyle): boolean {
  return FEFCO_STYLES.find((style) => style.code === code)?.available ?? false;
}

export function caliperForSpec(spec: BoxSpec): number {
  if (spec.style === "0201" && spec.fluteType) {
    return FLUTE_CALIPER_IN[spec.fluteType];
  }
  return spec.caliper;
}
