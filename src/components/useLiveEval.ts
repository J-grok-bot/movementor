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
}

const DEPTHS = [6, 10, 14, 18];

/**
 * Live Stockfish eval for one position, deepening step by step (6 → 18) so the number updates quickly.
 * Uses the shared worker via runUserAnalysis (pauses background preloading); a new position stops the stale search.
 */
export function useLiveEval(fen: string | null): LiveEval | null {
  const [state, setState] = useState<LiveEval | null>(null);
  useEffect(() => {
    if (!fen) return;
    let live = true;
    let engine: BrowserEngine | null = null;
    const stm = fen.split(" ")[1] as "w" | "b";
    const timer = window.setTimeout(() => {
      runUserAnalysis(1, async (e) => {
        engine = e;
        for (const d of DEPTHS) {
          if (!live) break;
          const r = await e.evaluate(fen, d);
          if (!live) break;
          setState({ fen, depth: r.depth || d, ev: toWhiteEval(r.score, stm), pv: r.pv });
        }
        engine = null;
      }).catch(() => undefined);
    }, 120);
    return () => {
      live = false;
      window.clearTimeout(timer);
      engine?.stop(); // cancel the stale search; the loop exits on its bestmove
    };
  }, [fen]);
  return state && state.fen === fen ? state : null;
}
