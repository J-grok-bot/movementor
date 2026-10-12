// "Your analysis" sandbox: user moves on the review boards branch off into a hypothetical line.
import { Chess, type Square } from "chess.js";
import type { LineInfo } from "./analysis";

export interface UserMove {
  from: string;
  to: string;
  promotion?: string; // q r b n
}

export const moveUci = (m: UserMove) => m.from + m.to + (m.promotion ?? "");

/** The legal move (or null) for from->to in fen; promotion defaults to none so callers can ask first. */
export function legalMove(fen: string, m: UserMove): { san: string; uci: string; fen: string } | null {
  const c = new Chess(fen);
  try {
    const r = c.move({ from: m.from, to: m.to, promotion: m.promotion });
    return { san: r.san, uci: r.from + r.to + (r.promotion ?? ""), fen: c.fen() };
  } catch {
    return null;
  }
}

/** True when from->to is a legal pawn move onto the last rank (needs a promotion choice). */
export function needsPromotion(fen: string, from: string, to: string): boolean {
  const c = new Chess(fen);
  return c.moves({ square: from as Square, verbose: true }).some((m) => m.to === to && !!m.promotion);
}

export function legalTargets(fen: string, from: string): string[] {
  return new Chess(fen)
    .moves({ square: from as Square, verbose: true })
    .map((m) => m.to);
}

export type MoveOutcome =
  | { kind: "illegal" }
  | { kind: "advance"; step: number } // the move is the line's (or game's) own next move
  | { kind: "branch"; line: LineInfo; step: number }; // new user variation

/**
 * A user move at `step` of `line` (step 0 = line.startFen). Playing the line's next move just advances;
 * anything else truncates the line there and appends the move as a sandbox line.
 */
export function applyUserMove(line: Pick<LineInfo, "startFen" | "uci" | "san">, step: number, m: UserMove): MoveOutcome {
  const c = new Chess(line.startFen);
  for (const u of line.uci.slice(0, step)) c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
  const lm = legalMove(c.fen(), m);
  if (!lm) return { kind: "illegal" };
  if (line.uci[step] === lm.uci) return { kind: "advance", step: step + 1 };
  return {
    kind: "branch",
    step: step + 1,
    line: {
      rank: 0,
      eval: { cp: 0, mate: null },
      startFen: line.startFen,
      uci: [...line.uci.slice(0, step), lm.uci],
      san: [...line.san.slice(0, step), lm.san],
    },
  };
}

/** UCI line -> SAN (stops at the first illegal move). */
export function uciLineToSan(fen: string, uci: string[], max = 99): string[] {
  const c = new Chess(fen);
  const out: string[] = [];
  for (const u of uci.slice(0, max)) {
    try {
      out.push(c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] }).san);
    } catch {
      break;
    }
  }
  return out;
}
