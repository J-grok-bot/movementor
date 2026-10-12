// One-board review: the board is either on the game, or "deviated" into a line that branches off a game
// position: an engine line (blue) or the user's own moves (amber). Pure state helpers (unit-tested).
import { lineFens } from "./analysis";
import { applyUserMove, uciLineToSan, type UserMove } from "./sandbox";

export interface Deviation {
  kind: "engine" | "user";
  /** Game ply whose position the line starts from; Resume/Esc returns here. */
  basePly: number;
  startFen: string;
  uci: string[];
  san: string[];
  /** Position inside the line: 0 = startFen (still the game position), n = after n line moves. */
  step: number;
  /** Banner title for engine lines, e.g. "Engine's best instead of 14... Re8". */
  title: string;
  /** Id of the engine line being previewed (to highlight it in the panel), if any. */
  id?: string;
}

export function deviationFen(d: Deviation): string {
  if (d.step === 0) return d.startFen;
  return lineFens(d.startFen, d.uci.slice(0, d.step))[d.step - 1].fen;
}

export function lastMove(d: Deviation): { from: string; to: string } | null {
  const u = d.step > 0 ? d.uci[d.step - 1] : null;
  return u ? { from: u.slice(0, 2), to: u.slice(2, 4) } : null;
}

export function startEngineLine(
  basePly: number,
  line: { startFen: string; uci: string[]; san: string[] },
  title: string,
  step = 1,
  id?: string,
): Deviation {
  return { kind: "engine", basePly, startFen: line.startFen, uci: line.uci, san: line.san, step: Math.min(step, line.uci.length), title, id };
}

export type GameMoveResult = { kind: "illegal" } | { kind: "advance" } | { kind: "deviate"; deviation: Deviation };

/** A user move while the board is on the game: the real next move advances, anything else deviates (amber). */
export function userMoveOnGame(gameFen: string, ply: number, nextGameUci: string | null, m: UserMove): GameMoveResult {
  const r = applyUserMove({ startFen: gameFen, uci: [], san: [] }, 0, m);
  if (r.kind !== "branch") return { kind: "illegal" };
  if (nextGameUci && r.line.uci[0] === nextGameUci) return { kind: "advance" };
  return { kind: "deviate", deviation: { kind: "user", basePly: ply, startFen: gameFen, uci: r.line.uci, san: r.line.san, step: 1, title: "" } };
}

/**
 * A user move while deviated. Playing the line's own next move just steps forward (colour unchanged);
 * any other legal move truncates the rest of the line, appends the move and turns the line amber.
 */
export function userMoveInDeviation(d: Deviation, m: UserMove): Deviation | null {
  const r = applyUserMove(d, d.step, m);
  if (r.kind === "illegal") return null;
  if (r.kind === "advance") return { ...d, step: r.step };
  return { ...d, kind: "user", uci: r.line.uci, san: r.line.san, step: r.step, id: undefined };
}

/** "Preview" of the live engine line from the current deviation position: continue on the same board in blue. */
export function continueWithEngine(d: Deviation, pvUci: string[], title: string): Deviation {
  const fen = deviationFen(d);
  const san = uciLineToSan(fen, pvUci);
  const uci = pvUci.slice(0, san.length);
  return { ...d, kind: "engine", uci: [...d.uci.slice(0, d.step), ...uci], san: [...d.san.slice(0, d.step), ...san], step: Math.min(d.step + 1, d.step + san.length), title, id: undefined };
}

export function stepDeviation(d: Deviation, step: number): Deviation {
  return { ...d, step: Math.max(0, Math.min(d.uci.length, step)) };
}

/** Banner text, e.g. "Off game · 3 moves from 14... Re8" or "Engine's best instead of 14... Re8 · 2/9". */
export function bannerText(d: Deviation, baseLabel: string): string {
  if (d.kind === "user") return `Off game · ${d.step} move${d.step === 1 ? "" : "s"} from ${baseLabel || "the start"}`;
  return `${d.title || `Engine line from ${baseLabel || "the start"}`} · ${d.step}/${d.uci.length}`;
}
