import { formatEval, whiteWinPercent, type GameAnalysis } from "./analysis";
import type { Classification } from "./classify";

export type MarkerGroup = "brilliant" | "great" | "errors" | "blunder";
export const GROUP_OF: Partial<Record<Classification, MarkerGroup>> = {
  Brilliant: "brilliant",
  Great: "great",
  Mistake: "errors",
  Miss: "errors",
  Blunder: "blunder",
};
export const GROUPS: MarkerGroup[] = ["brilliant", "blunder", "great", "errors"];
export const GROUP_LABEL: Record<MarkerGroup, string> = {
  brilliant: "Brilliant",
  blunder: "Blunders",
  great: "Great",
  errors: "Mistakes / Misses",
};
export type MarkerToggles = Record<MarkerGroup, boolean>;
/** Keep the graph clean: only Brilliant and Blunder by default; inaccuracies are never marked. */
export const DEFAULT_TOGGLES: MarkerToggles = { brilliant: true, blunder: true, great: false, errors: false };

/** Rank used to pick which marker represents a cluster. */
const RANK: Partial<Record<Classification, number>> = { Blunder: 5, Brilliant: 4, Miss: 3, Mistake: 2, Great: 1 };

export interface GraphMarker {
  ply: number;
  color: "white" | "black";
  classification: Classification;
  win: number; // White win% after the move (graph y)
  label: string; // e.g. "28... Rxf1"
  tooltip: string; // e.g. "28... Rxf1 ?? Blunder, -3.6 → +5.0"
}

export function buildMarkers(a: GameAnalysis, symbols: Record<string, string>, toggles: MarkerToggles = DEFAULT_TOGGLES): GraphMarker[] {
  return a.moves.flatMap((m) => {
    const g = GROUP_OF[m.classification];
    if (!g || !toggles[g]) return [];
    const label = `${m.moveNumber}${m.color === "white" ? "." : "..."} ${m.san}`;
    return [
      {
        ply: m.ply,
        color: m.color,
        classification: m.classification,
        win: whiteWinPercent(m.evalAfter),
        label,
        tooltip: `${label} ${symbols[m.classification] ?? ""} ${m.classification}, ${formatEval(m.evalBefore)} → ${formatEval(m.evalAfter)}`,
      },
    ];
  });
}

export interface MarkerCluster {
  key: string;
  side: "white" | "black";
  ply: number; // representative (most important) marker's ply
  lead: GraphMarker;
  items: GraphMarker[];
}

/**
 * Collapse markers whose x positions (px, from graph width and ply count) are closer than minGapPx into one
 * badge led by the most important classification (its side decides above/below), so badges never overlap.
 */
export function clusterMarkers(markers: GraphMarker[], totalPlies: number, widthPx: number, minGapPx = 18): MarkerCluster[] {
  const n = Math.max(totalPlies, 1);
  const px = (p: number) => (p / n) * widthPx;
  const out: MarkerCluster[] = [];
  let cur: GraphMarker[] = [];
  const flush = () => {
    if (!cur.length) return;
    const lead = cur.reduce((b, m) => ((RANK[m.classification] ?? 0) > (RANK[b.classification] ?? 0) ? m : b));
    out.push({ key: `c-${cur[0].ply}`, side: lead.color, ply: lead.ply, lead, items: cur });
    cur = [];
  };
  for (const m of [...markers].sort((a, b) => a.ply - b.ply)) {
    // compare against the cluster's first marker so each badge spans < minGapPx; the next badge starts >= minGapPx away
    if (cur.length && px(m.ply) - px(cur[0].ply) < minGapPx) cur.push(m);
    else {
      flush();
      cur = [m];
    }
  }
  flush();
  return out;
}
