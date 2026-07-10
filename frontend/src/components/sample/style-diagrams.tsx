import type { SampleStyle } from "@/types/sample";

interface StyleDiagramProps {
  style: SampleStyle;
  className?: string;
}

export function StyleDiagram({ style, className }: StyleDiagramProps) {
  if (style === "rsc") return <RscDiagram className={className} />;
  if (style === "hsc") return <HscDiagram className={className} />;
  return <TubeDiagram className={className} />;
}

function RscDiagram({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 80" className={className} aria-hidden>
      <rect x="20" y="22" width="80" height="36" fill="#fff" stroke="#334155" strokeWidth="2" rx="1" />
      <rect x="20" y="10" width="80" height="12" fill="#cbd5e1" stroke="#334155" strokeWidth="1.5" />
      <rect x="20" y="58" width="80" height="12" fill="#cbd5e1" stroke="#334155" strokeWidth="1.5" />
      <line x1="40" y1="22" x2="40" y2="58" stroke="#16a34a" strokeWidth="1" strokeDasharray="3 2" opacity="0.6" />
      <line x1="60" y1="22" x2="60" y2="58" stroke="#16a34a" strokeWidth="1" strokeDasharray="3 2" opacity="0.6" />
      <line x1="80" y1="22" x2="80" y2="58" stroke="#16a34a" strokeWidth="1" strokeDasharray="3 2" opacity="0.6" />
    </svg>
  );
}

function HscDiagram({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 70" className={className} aria-hidden>
      <rect x="20" y="10" width="80" height="36" fill="#fff" stroke="#334155" strokeWidth="2" rx="1" />
      <rect x="20" y="46" width="80" height="12" fill="#cbd5e1" stroke="#334155" strokeWidth="1.5" />
      <line x1="40" y1="10" x2="40" y2="46" stroke="#16a34a" strokeWidth="1" strokeDasharray="3 2" opacity="0.6" />
      <line x1="60" y1="10" x2="60" y2="46" stroke="#16a34a" strokeWidth="1" strokeDasharray="3 2" opacity="0.6" />
      <line x1="80" y1="10" x2="80" y2="46" stroke="#16a34a" strokeWidth="1" strokeDasharray="3 2" opacity="0.6" />
    </svg>
  );
}

function TubeDiagram({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 50" className={className} aria-hidden>
      <rect x="15" y="15" width="90" height="20" fill="#fff" stroke="#334155" strokeWidth="2" rx="1" />
      <line x1="37" y1="15" x2="37" y2="35" stroke="#16a34a" strokeWidth="1.5" strokeDasharray="3 2" />
      <line x1="60" y1="15" x2="60" y2="35" stroke="#16a34a" strokeWidth="1.5" strokeDasharray="3 2" />
      <line x1="83" y1="15" x2="83" y2="35" stroke="#16a34a" strokeWidth="1.5" strokeDasharray="3 2" />
    </svg>
  );
}

export function FluteProfile({ flute, className }: { flute: "B" | "C" | "BC"; className?: string }) {
  const waves = flute === "B" ? 14 : flute === "C" ? 9 : 7;
  const amplitude = flute === "B" ? 4 : flute === "C" ? 6 : 5;
  const paths: string[] = [];
  const width = 120;
  const height = 40;
  const mid = height / 2;

  function wavePath(yOffset: number, amp: number, count: number): string {
    const step = width / count;
    let d = `M 0 ${mid + yOffset}`;
    for (let i = 0; i < count; i++) {
      const x1 = i * step + step / 2;
      const x2 = (i + 1) * step;
      d += ` Q ${x1} ${mid + yOffset - amp} ${x2} ${mid + yOffset}`;
    }
    return d;
  }

  paths.push(wavePath(0, amplitude, waves));
  if (flute === "BC") {
    paths.push(wavePath(8, amplitude * 0.7, waves - 2));
  }

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className={className} aria-hidden>
      <rect width={width} height={height} fill="#f8fafc" rx="4" />
      {paths.map((d, i) => (
        <path key={i} d={d} fill="none" stroke="#475569" strokeWidth="2.5" strokeLinecap="round" />
      ))}
    </svg>
  );
}
