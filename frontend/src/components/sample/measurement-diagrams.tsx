/** Simple schematic SVGs showing where to measure on a flat blank. */

interface DiagramProps {
  className?: string;
}

export function BlankWidthExcludesTabDiagram({ className }: DiagramProps) {
  return (
    <svg viewBox="0 0 220 100" className={className} aria-hidden>
      <rect x="15" y="25" width="190" height="50" fill="#f8fafc" stroke="#94a3b8" strokeWidth="2" rx="2" />
      <rect x="15" y="25" width="18" height="50" fill="#e2e8f0" stroke="#94a3b8" strokeWidth="1" />
      <line x1="33" y1="25" x2="33" y2="75" stroke="#16a34a" strokeWidth="2" strokeDasharray="5 3" />
      <line x1="33" y1="88" x2="205" y2="88" stroke="#2563eb" strokeWidth="2" />
      <polygon points="200,85 205,88 200,91" fill="#2563eb" />
      <text x="120" y="96" textAnchor="middle" fontSize="10" fill="#2563eb" fontWeight="600">
        width — stop at tab base, skip tab
      </text>
      <text x="24" y="52" textAnchor="middle" fontSize="8" fill="#64748b" transform="rotate(-90 24 52)">
        tab
      </text>
    </svg>
  );
}

export function BlankWidthDiagram({ className }: DiagramProps) {
  return (
    <svg viewBox="0 0 200 100" className={className} aria-hidden>
      <rect x="20" y="25" width="160" height="50" fill="#f8fafc" stroke="#94a3b8" strokeWidth="2" rx="2" />
      <line x1="20" y1="88" x2="180" y2="88" stroke="#2563eb" strokeWidth="2" markerStart="url(#arrow)" markerEnd="url(#arrow)" />
      <defs>
        <marker id="arrow" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto">
          <path d="M0,0 L6,3 L0,6 Z" fill="#2563eb" />
        </marker>
      </defs>
      <text x="100" y="96" textAnchor="middle" fontSize="11" fill="#2563eb" fontWeight="600">
        full width
      </text>
      <line x1="60" y1="25" x2="60" y2="75" stroke="#16a34a" strokeWidth="1.5" strokeDasharray="4 3" />
      <line x1="100" y1="25" x2="100" y2="75" stroke="#16a34a" strokeWidth="1.5" strokeDasharray="4 3" />
      <line x1="140" y1="25" x2="140" y2="75" stroke="#16a34a" strokeWidth="1.5" strokeDasharray="4 3" />
    </svg>
  );
}

export function BlankHeightDiagram({ className }: DiagramProps) {
  return (
    <svg viewBox="0 0 120 140" className={className} aria-hidden>
      <rect x="30" y="20" width="60" height="100" fill="#f8fafc" stroke="#94a3b8" strokeWidth="2" rx="2" />
      <line x1="12" y1="20" x2="12" y2="120" stroke="#2563eb" strokeWidth="2" />
      <polygon points="9,24 12,18 15,24" fill="#2563eb" />
      <polygon points="9,116 12,122 15,116" fill="#2563eb" />
      <text x="12" y="76" textAnchor="middle" fontSize="10" fill="#2563eb" fontWeight="600" transform="rotate(-90 12 76)">
        full height
      </text>
    </svg>
  );
}

export function FlapHeightDiagram({ className }: DiagramProps) {
  return (
    <svg viewBox="0 0 160 120" className={className} aria-hidden>
      <rect x="20" y="15" width="120" height="90" fill="#f8fafc" stroke="#94a3b8" strokeWidth="2" rx="2" />
      <rect x="20" y="15" width="120" height="22" fill="#e2e8f0" stroke="none" />
      <rect x="20" y="83" width="120" height="22" fill="#e2e8f0" stroke="none" />
      <line x1="20" y1="83" x2="140" y2="83" stroke="#16a34a" strokeWidth="2" strokeDasharray="5 3" />
      <line x1="148" y1="83" x2="148" y2="105" stroke="#2563eb" strokeWidth="2" />
      <polygon points="144,102 148,108 152,102" fill="#2563eb" />
      <text x="148" y="78" textAnchor="middle" fontSize="9" fill="#2563eb" fontWeight="600">
        flap
      </text>
      <text x="100" y="74" fontSize="8" fill="#16a34a">
        crease
      </text>
    </svg>
  );
}

export function HscFlapHeightDiagram({ className }: DiagramProps) {
  return (
    <svg viewBox="0 0 160 100" className={className} aria-hidden>
      <rect x="20" y="10" width="120" height="70" fill="#f8fafc" stroke="#94a3b8" strokeWidth="2" rx="2" />
      <rect x="20" y="58" width="120" height="22" fill="#e2e8f0" stroke="none" />
      <line x1="20" y1="58" x2="140" y2="58" stroke="#16a34a" strokeWidth="2" strokeDasharray="5 3" />
      <line x1="148" y1="58" x2="148" y2="80" stroke="#2563eb" strokeWidth="2" />
      <polygon points="144,77 148,83 152,77" fill="#2563eb" />
      <text x="148" y="53" textAnchor="middle" fontSize="9" fill="#2563eb" fontWeight="600">
        flap
      </text>
    </svg>
  );
}

export function PanelOneDiagram({ className }: DiagramProps) {
  return (
    <svg viewBox="0 0 200 90" className={className} aria-hidden>
      <rect x="15" y="20" width="170" height="50" fill="#f8fafc" stroke="#94a3b8" strokeWidth="2" rx="2" />
      <rect x="15" y="20" width="14" height="50" fill="#e2e8f0" stroke="#94a3b8" strokeWidth="1" />
      <line x1="55" y1="20" x2="55" y2="70" stroke="#16a34a" strokeWidth="2" strokeDasharray="5 3" />
      <line x1="29" y1="78" x2="55" y2="78" stroke="#2563eb" strokeWidth="2" />
      <polygon points="52,75 55,81 58,75" fill="#2563eb" />
      <text x="42" y="86" textAnchor="middle" fontSize="9" fill="#2563eb" fontWeight="600">
        first panel
      </text>
      <text x="22" y="48" textAnchor="middle" fontSize="7" fill="#64748b" transform="rotate(-90 22 48)">
        tab
      </text>
      <line x1="95" y1="20" x2="95" y2="70" stroke="#16a34a" strokeWidth="1" strokeDasharray="4 3" opacity="0.5" />
      <line x1="135" y1="20" x2="135" y2="70" stroke="#16a34a" strokeWidth="1" strokeDasharray="4 3" opacity="0.5" />
    </svg>
  );
}

export function PanelTwoDiagram({ className }: DiagramProps) {
  return (
    <svg viewBox="0 0 200 90" className={className} aria-hidden>
      <rect x="15" y="20" width="170" height="50" fill="#f8fafc" stroke="#94a3b8" strokeWidth="2" rx="2" />
      <line x1="55" y1="20" x2="55" y2="70" stroke="#16a34a" strokeWidth="1" strokeDasharray="4 3" opacity="0.5" />
      <line x1="95" y1="20" x2="95" y2="70" stroke="#16a34a" strokeWidth="2" strokeDasharray="5 3" />
      <line x1="55" y1="78" x2="95" y2="78" stroke="#2563eb" strokeWidth="2" />
      <polygon points="92,75 95,81 98,75" fill="#2563eb" />
      <text x="75" y="86" textAnchor="middle" fontSize="9" fill="#2563eb" fontWeight="600">
        second panel
      </text>
    </svg>
  );
}

export function PanelDDiagram({ className }: DiagramProps) {
  return (
    <svg viewBox="0 0 120 140" className={className} aria-hidden>
      <rect x="30" y="20" width="60" height="100" fill="#f8fafc" stroke="#94a3b8" strokeWidth="2" rx="2" />
      <rect x="30" y="20" width="60" height="18" fill="#e2e8f0" stroke="none" />
      <rect x="30" y="102" width="60" height="18" fill="#e2e8f0" stroke="none" />
      <line x1="30" y1="38" x2="90" y2="38" stroke="#16a34a" strokeWidth="2" strokeDasharray="5 3" />
      <line x1="30" y1="102" x2="90" y2="102" stroke="#16a34a" strokeWidth="2" strokeDasharray="5 3" />
      <line x1="98" y1="38" x2="98" y2="102" stroke="#2563eb" strokeWidth="2" />
      <polygon points="95,99 98,105 101,99" fill="#2563eb" />
      <text x="98" y="76" textAnchor="middle" fontSize="9" fill="#2563eb" fontWeight="600" transform="rotate(-90 98 76)">
        height panel
      </text>
    </svg>
  );
}
