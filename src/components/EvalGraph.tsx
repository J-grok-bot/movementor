"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { whiteWinPercent, type GameAnalysis } from "@/lib/analysis";
import { CLASS_STYLE } from "@/lib/classification";
import {
  buildMarkers,
  clusterMarkers,
  DEFAULT_TOGGLES,
  GROUP_LABEL,
  GROUPS,
  type MarkerCluster,
  type MarkerGroup,
  type MarkerToggles,
} from "@/lib/graphMarkers";

const SYMBOLS = Object.fromEntries(Object.entries(CLASS_STYLE).map(([k, v]) => [k, v.symbol]));
const GROUP_ICON: Record<MarkerGroup, keyof typeof CLASS_STYLE> = {
  brilliant: "Brilliant",
  blunder: "Blunder",
  great: "Great",
  errors: "Mistake",
};
const KEY = "movementor-graph-markers";

function useToggles(): [MarkerToggles, (g: MarkerGroup) => void] {
  const [t, setT] = useState<MarkerToggles>(DEFAULT_TOGGLES);
  useEffect(() => {
    try {
      setT({ ...DEFAULT_TOGGLES, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") });
    } catch {}
    const on = (e: StorageEvent) => e.key === KEY && e.newValue && setT({ ...DEFAULT_TOGGLES, ...JSON.parse(e.newValue) });
    window.addEventListener("storage", on);
    return () => window.removeEventListener("storage", on);
  }, []);
  const toggle = (g: MarkerGroup) =>
    setT((cur) => {
      const next = { ...cur, [g]: !cur[g] };
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  return [t, toggle];
}

/** Win%-for-White graph; click to jump. Badges mark key moments (White's above the line, Black's below). */
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

  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth || 600));
    ro.observe(el);
    setWidth(el.clientWidth || 600);
    return () => ro.disconnect();
  }, []);
  const [toggles, toggle] = useToggles();
  const clusters = useMemo(
    () => clusterMarkers(buildMarkers(analysis, SYMBOLS, toggles), n, width, width < 480 ? 22 : 18),
    [analysis, toggles, n, width],
  );
  const [tip, setTip] = useState<MarkerCluster | null>(null);
  const [pinned, setPinned] = useState(false);
  useEffect(() => {
    if (!pinned) return;
    const close = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) {
        setTip(null);
        setPinned(false);
      }
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [pinned]);

  const BADGE = 18;
  const pos = (c: MarkerCluster) => {
    const leftPx = (c.ply / n) * width;
    const cy = y(c.lead.win);
    const top = c.side === "white" ? cy - BADGE - 3 : cy + 3;
    return { left: Math.min(Math.max(leftPx - BADGE / 2, 0), width - BADGE), top: Math.min(Math.max(top, 7), H - BADGE - 2) };
  };

  return (
    <div data-testid="eval-graph-wrap">
      <div ref={wrap} className="relative" style={{ height }}>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="block w-full cursor-pointer rounded bg-zinc-800"
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
          {ply !== undefined && (
            <line x1={x(ply)} x2={x(ply)} y1={0} y2={H} stroke="#3b82f6" strokeWidth={2} vectorEffect="non-scaling-stroke" />
          )}
        </svg>
        {clusters.map((c) => {
          const st = CLASS_STYLE[c.lead.classification];
          const big = c.lead.classification === "Brilliant" || c.lead.classification === "Blunder";
          const p = pos(c);
          return (
            <button
              key={c.key}
              type="button"
              data-testid="graph-marker"
              data-marker-ply={c.ply}
              data-class={c.lead.classification}
              data-side={c.side}
              data-count={c.items.length}
              aria-label={c.items.map((m) => m.tooltip).join("; ")}
              className="absolute flex items-center justify-center rounded-full font-bold leading-none text-white shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
              style={{
                left: p.left,
                top: p.top,
                width: BADGE,
                height: BADGE,
                fontSize: big ? 9 : 8,
                background: st.color,
                // ring shows the player: light ring = White, dark ring = Black
                boxShadow: `0 0 0 ${big ? 2 : 1.5}px ${c.side === "white" ? "#fafafa" : "#18181b"}`,
                opacity: big ? 1 : 0.9,
              }}
              onMouseEnter={() => !pinned && setTip(c)}
              onMouseLeave={() => !pinned && setTip(null)}
              onFocus={() => setTip(c)}
              onClick={(e) => {
                e.stopPropagation();
                if (c.items.length > 1) {
                  setTip(c);
                  setPinned(true);
                } else {
                  setTip(c);
                  onSelect(c.ply);
                }
              }}
            >
              {st.symbol}
              {c.items.length > 1 && (
                <span className="absolute -right-2 -top-2 rounded-full bg-zinc-950 px-1 text-[8px] leading-[12px] text-zinc-100 ring-1 ring-zinc-600">
                  {c.items.length}
                </span>
              )}
            </button>
          );
        })}
        {tip && (
          <div
            data-testid="graph-tooltip"
            className="absolute z-20 rounded-md border border-zinc-700 bg-zinc-950/95 px-2 py-1 text-xs text-zinc-100 shadow-lg"
            style={{
              left: Math.min(Math.max((tip.ply / n) * width - 90, 0), Math.max(width - 180, 0)),
              width: 180,
              ...(tip.side === "white" ? { top: Math.min(pos(tip).top + BADGE + 4, H) } : { bottom: Math.min(H - pos(tip).top + 4, H) }),
            }}
          >
            {tip.items.map((m) =>
              tip.items.length > 1 ? (
                <button
                  key={m.ply}
                  type="button"
                  data-testid="graph-tooltip-item"
                  className="block w-full rounded px-1 py-0.5 text-left hover:bg-zinc-800"
                  style={{ color: CLASS_STYLE[m.classification].color }}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelect(m.ply);
                    setTip(null);
                    setPinned(false);
                  }}
                >
                  {m.tooltip}
                </button>
              ) : (
                <div key={m.ply} style={{ color: CLASS_STYLE[m.classification].color }}>
                  {m.tooltip}
                </div>
              ),
            )}
          </div>
        )}
      </div>
      <div className="mt-1 flex flex-wrap gap-1" data-testid="graph-legend">
        {GROUPS.map((g) => {
          const st = CLASS_STYLE[GROUP_ICON[g]];
          return (
            <button
              key={g}
              type="button"
              data-testid={`graph-toggle-${g}`}
              aria-pressed={toggles[g]}
              onClick={() => toggle(g)}
              className={`flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] ${
                toggles[g] ? "border-zinc-500 text-zinc-200" : "border-zinc-800 text-zinc-500 line-through"
              }`}
            >
              <span className="inline-block h-2 w-2 rounded-full" style={{ background: st.color, opacity: toggles[g] ? 1 : 0.4 }} />
              {g === "errors" ? "? ⊘" : st.symbol} {GROUP_LABEL[g]}
            </button>
          );
        })}
        <span className="ml-auto self-center text-[10px] text-zinc-500">ring: ○ White above · ● Black below</span>
      </div>
    </div>
  );
}
