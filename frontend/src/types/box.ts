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

/** All dimensions are stored as decimal inches. */
export interface BoxSpec {
  style: FefcoStyle;
  length: number;
  width: number;
  height: number;
  caliper: number;
}

export const DEFAULT_BOX_SPEC: BoxSpec = {
  style: "0201",
  length: 12,
  width: 8,
  height: 6,
  caliper: 0.157,
};

export function getFefcoStyleLabel(code: FefcoStyle): string {
  return FEFCO_STYLES.find((style) => style.code === code)?.label ?? code;
}

export function isFefcoStyleAvailable(code: FefcoStyle): boolean {
  return FEFCO_STYLES.find((style) => style.code === code)?.available ?? false;
}