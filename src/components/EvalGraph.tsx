"use client";
import { whiteWinPercent, type GameAnalysis } from "@/lib/analysis";
import { CLASS_STYLE } from "@/lib/classification";
import type { Classification } from "@/lib/classify";

const MARKED: Classification[] = ["Brilliant", "Great", "Miss", "Mistake", "Blunder"];

/** Win%-for-White graph across the game; click to jump to a move. Markers at key moments. */
export function EvalGraph({
  analysis,
  ply,
  onSelect,
  height = 80,
}: {
  analysis: GameAnalysis;
  ply?: number;
  onSelect: (ply: number) => void;
  height?: number;
}) {
  const pts = [analysis.initialEval, ...analysis.moves.map((m) => m.evalAfter)].map(whiteWinPercent);
  const W = 600;
  const H = height;
  const n = Math.max(pts.length - 1, 1);
  const x = (i: number) => (i / n) * W;
  const y = (p: number) => H - (p / 100) * (H - 8) - 4;
  const line = pts.map((p, i) => `${x(i)},${y(p)}`).join(" ");
  const area = `0,${H} ${line} ${W},${H}`;
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full cursor-pointer rounded bg-zinc-800"
      style={{ height }}
      preserveAspectRatio="none"
      data-testid="eval-graph"
      onClick={(e) => {
        const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
        onSelect(Math.round(((e.clientX - r.left) / r.width) * n));
      }}
    >
      <polygon points={area} fill="#e4e4e7" />
      <line x1={0} x2={W} y1={H / 2} y2={H / 2} stroke="#71717a" strokeDasharray="4 4" strokeWidth={1} />
      {ply !== undefined && <line x1={x(ply)} x2={x(ply)} y1={0} y2={H} stroke="#3b82f6" strokeWidth={2} />}
      {analysis.moves.map((m) =>
        MARKED.includes(m.classification) ? (
          <circle
            key={m.ply}
            cx={x(m.ply)}
            cy={y(pts[m.ply])}
            r={m.classification === "Brilliant" || m.classification === "Blunder" ? 5 : 3.5}
            fill={CLASS_STYLE[m.classification].color}
            stroke="#18181b"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          >
            <title>{`${m.moveNumber}${m.color === "white" ? "." : "..."} ${m.san}: ${m.classification}`}</title>
          </circle>
        ) : null,
      )}
    </svg>
  );
}
