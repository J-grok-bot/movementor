"use client";
import { useEffect, useState } from "react";
import { toWhiteEval, type Eval } from "@/lib/analysis";
import { runUserAnalysis } from "@/lib/engineManager";
import type { BrowserEngine } from "@/lib/browserEngine";

export interface LiveEval {
  fen: string;
  depth: number;
  ev: Eval;
  pv: string[]; // UCI
  lines: { ev: Eval; pv: string[] }[]; // MultiPV lines, best first (just line 1 when multiPv = 1)
}

const DEPTHS = [6, 10, 14, 18];

/**
 * Live Stockfish eval for one position, deepening step by step (6 → 18) so the number updates quickly.
 * Uses the shared worker via runUserAnalysis (pauses background preloading); a new position stops the stale search.
 */
export function useLiveEval(fen: string | null, multiPv = 1, depths: number[] = DEPTHS): LiveEval | null {
  const [state, setState] = useState<LiveEval | null>(null);
  useEffect(() => {
    if (!fen) return;
    let live = true;
    let engine: BrowserEngine | null = null;
    const stm = fen.split(" ")[1] as "w" | "b";
    const timer = window.setTimeout(() => {
      runUserAnalysis(multiPv, async (e) => {
        engine = e;
        for (const d of depths) {
          if (!live) break;
          const r = await e.evaluate(fen, d);
          if (!live) break;
          setState({
            fen,
            depth: r.depth || d,
            ev: toWhiteEval(r.score, stm),
            pv: r.pv,
            lines: r.lines.filter((l) => l.pv.length).map((l) => ({ ev: toWhiteEval(l.score, stm), pv: l.pv })),
          });
        }
        engine = null;
      }).catch(() => undefined);
    }, 120);
    return () => {
      live = false;
      window.clearTimeout(timer);
      engine?.stop(); // cancel the stale search; the loop exits on its bestmove
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fen, multiPv]);
  return state && state.fen === fen ? state : null;
}
