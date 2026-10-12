// Pure, environment-agnostic game analysis. Works in the browser (Web Worker engine)
// and in Node (for headless tests) as long as you supply an Evaluator.
import { Chess, type Color } from "chess.js";
import { classifyMove, type Classification } from "./classify";
import { explainMove, type Explanation } from "./explain";
import { hangingPieces, materialAfter, materialSwing, pieceCount, board as looseBoard, VALUE } from "./tactics";
import { bookLookup, epd, type OpeningBook } from "./openingBook";

export type { Classification } from "./classify";
export type Phase = "opening" | "middlegame" | "endgame";

/** Engine score from the side-to-move's perspective (raw UCI semantics). */
export interface EngineScore {
  cp?: number; // centipawns
  mate?: number; // moves to mate; >0 side to move mates, <0 side to move gets mated, 0 = already mated
}

export interface EngineLine {
  multipv: number; // 1 = best
  score: EngineScore; // side-to-move perspective
  pv: string[]; // UCI moves
  depth: number;
}

export interface EngineResult {
  score: EngineScore; // of line 1
  bestMove: string | null; // UCI, e.g. "e2e4"
  pv: string[]; // line 1
  depth: number;
  lines: EngineLine[]; // all MultiPV lines, sorted best first
}

export type Evaluator = (fen: string, depth: number) => Promise<EngineResult>;

/** Normalised evaluation from White's perspective. */
export interface Eval {
  cp: number | null; // null when mate
  mate: number | null; // >0 White mates in N, <0 Black mates in N, 0 = game over by mate (see winner)
  winner?: "white" | "black";
}


export interface MoveAnalysis {
  ply: number; // 1-based
  moveNumber: number;
  color: "white" | "black";
  san: string;
  uci: string;
  from: string;
  to: string;
  fenBefore: string;
  fenAfter: string;
  evalBefore: Eval;
  evalAfter: Eval;
  bestMoveUci: string | null;
  bestMoveSan: string | null;
  bestLineSan: string[]; // engine's full principal variation from fenBefore (SAN)
  lines: LineInfo[]; // engine's top lines (MultiPV) from fenBefore: [0] = best, [1] = 2nd best
  continuation: LineInfo | null; // engine's best line from fenAfter (what happens next)
  winBefore: number; // mover's win% before the move
  winAfter: number; // mover's win% after the move
  winLoss: number; // percentage points lost (>=0)
  cpLoss: number; // centipawns lost (mates capped), mover's perspective
  accuracy: number; // 0-100, Lichess-style per-move accuracy
  classification: Classification;
  reason: string; // classifier's short reason
  note: string | null;
  sacrifice: number; // pawns of material deliberately given up (0 if none)
  phase: Phase;
  explanation: Explanation;
}

/** One engine line, ready to display/preview. */
export interface LineInfo {
  rank: number; // 1 = best
  eval: Eval; // White's perspective
  uci: string[];
  san: string[];
  startFen: string;
}

export interface PlayerSummary {
  accuracy: number;
  acpl: number;
  counts: Record<Classification, number>;
}

export interface GameAnalysis {
  depth: number;
  multiPv: number;
  opening: { eco: string; name: string } | null;
  initialFen: string;
  initialEval: Eval;
  moves: MoveAnalysis[];
  white: PlayerSummary;
  black: PlayerSummary;
}

export { THRESHOLDS } from "./classify";
const MATE_CP = 1000; // cap used for centipawn-loss arithmetic

/** Lichess win% model: 50 + 50 * (2 / (1 + e^(-0.00368208 * cp)) - 1) */
export function winPercentFromCp(cp: number): number {
  const c = Math.max(-1000, Math.min(1000, cp));
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * c)) - 1);
}

/** Win% for White. */
export function whiteWinPercent(e: Eval): number {
  if (e.mate !== null) {
    if (e.mate === 0) return e.winner === "white" ? 100 : e.winner === "black" ? 0 : 50;
    return e.mate > 0 ? 100 : 0;
  }
  return winPercentFromCp(e.cp ?? 0);
}

/** Centipawns for White with mates capped (used for graphs and cp loss). */
export function whiteCp(e: Eval): number {
  if (e.mate !== null) {
    if (e.mate === 0) return e.winner === "white" ? MATE_CP : e.winner === "black" ? -MATE_CP : 0;
    return e.mate > 0 ? MATE_CP : -MATE_CP;
  }
  return Math.max(-MATE_CP, Math.min(MATE_CP, e.cp ?? 0));
}

export function formatEval(e: Eval): string {
  if (e.mate !== null) {
    if (e.mate === 0) return e.winner === "white" ? "1-0" : e.winner === "black" ? "0-1" : "½-½";
    return `${e.mate > 0 ? "" : "-"}M${Math.abs(e.mate)}`;
  }
  const v = (e.cp ?? 0) / 100;
  return `${v > 0 ? "+" : ""}${v.toFixed(1)}`;
}

/** Lichess per-move accuracy from win% drop. */
export function moveAccuracy(winLoss: number): number {
  const a = 103.1668 * Math.exp(-0.04354 * winLoss) - 3.1669;
  return Math.max(0, Math.min(100, a));
}

function toWhiteEval(score: EngineScore, sideToMove: "w" | "b"): Eval {
  const sign = sideToMove === "w" ? 1 : -1;
  if (score.mate !== undefined) {
    if (score.mate === 0) return { cp: null, mate: 0, winner: sideToMove === "w" ? "black" : "white" };
    return { cp: null, mate: score.mate * sign };
  }
  return { cp: (score.cp ?? 0) * sign, mate: null };
}

function uciToSan(fen: string, line: string[], max = 64): string[] {
  const c = new Chess(fen);
  const out: string[] = [];
  for (const u of line.slice(0, max)) {
    try {
      const m = c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
      out.push(m.san);
    } catch {
      break;
    }
  }
  return out;
}

function emptyCounts(): Record<Classification, number> {
  return { Brilliant: 0, Great: 0, Best: 0, Excellent: 0, Good: 0, Book: 0, Inaccuracy: 0, Mistake: 0, Miss: 0, Blunder: 0 };
}

function summarizePlayer(moves: MoveAnalysis[]): PlayerSummary {
  const counts = emptyCounts();
  for (const m of moves) counts[m.classification]++;
  if (!moves.length) return { accuracy: 0, acpl: 0, counts };
  const accs = moves.map((m) => m.accuracy);
  const mean = accs.reduce((a, b) => a + b, 0) / accs.length;
  // Blend arithmetic & harmonic mean (harmonic punishes big errors more), similar in spirit to Lichess.
  const harmonic = accs.length / accs.reduce((a, b) => a + 1 / Math.max(b, 1), 0);
  const acpl = moves.reduce((a, m) => a + m.cpLoss, 0) / moves.length;
  return { accuracy: (mean + harmonic) / 2, acpl, counts };
}

/** Evaluate a position, short-circuiting terminal positions without the engine. */
async function evalPosition(chess: Chess, evaluate: Evaluator, depth: number): Promise<{ ev: Eval; res: EngineResult | null }> {
  const fen = chess.fen();
  const stm = chess.turn();
  if (chess.isCheckmate()) return { ev: { cp: null, mate: 0, winner: stm === "w" ? "black" : "white" }, res: null };
  if (chess.isDraw() || chess.isStalemate()) return { ev: { cp: 0, mate: null }, res: null };
  const res = await evaluate(fen, depth);
  return { ev: toWhiteEval(res.score, stm), res };
}

/** Capturing something undefended or worth more than the capturer: no "Great" for that. */
function isObviousCapture(fenBefore: string, to: string, mover: Color, piece: keyof typeof VALUE, captured?: keyof typeof VALUE) {
  if (!captured) return false;
  if (VALUE[captured] > VALUE[piece]) return true;
  return hangingPieces(fenBefore, mover === "w" ? "b" : "w").some((h) => h.square === to);
}

/** Pawns of material deliberately given up by the move (0 if not a sacrifice). */
export function detectSacrifice(
  fenBefore: string,
  uci: string,
  continuation: string[],
  mover: Color,
  piece: keyof typeof VALUE,
  captured?: keyof typeof VALUE,
  secondLine?: string[],
): number {
  // Not a sacrifice if material was already being lost: in check, a piece already hanging,
  // or the alternative (2nd-best) line loses the same material anyway.
  const start = new Chess(fenBefore);
  if (start.inCheck()) return 0;
  if (hangingPieces(fenBefore, mover).some((h) => VALUE[h.type] >= 2)) return 0;
  if (secondLine?.length) {
    const alt = materialAfter(fenBefore, secondLine, mover, 3);
    if (alt !== null && alt <= -2) return 0;
  }
  const line = [uci, ...continuation];
  // Material after: our move, their reply, our next move (and two more plies if available).
  const d3 = materialAfter(fenBefore, line, mover, 3);
  const d5 = materialAfter(fenBefore, line, mover, 5);
  if (d3 !== null && d3 <= -2 && (d5 === null || d5 <= -1)) return -d3;
  // Static: a piece worth >= a minor left where a cheaper piece (or anything, if undefended) can take it.
  const net = VALUE[piece] - (captured ? VALUE[captured] : 0);
  if (VALUE[piece] >= 3 && net >= 2) {
    const after = new Chess(fenBefore);
    after.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    const to = uci.slice(2, 4) as Parameters<Chess["attackers"]>[0];
    const attackers = after.attackers(to, mover === "w" ? "b" : "w");
    if (attackers.length) {
      const defended = after.attackers(to, mover).length > 0;
      const cheapest = Math.min(...attackers.map((sq) => VALUE[after.get(sq)!.type] || 100));
      if (!defended || cheapest < VALUE[piece]) return net;
    }
  }
  return 0;
}

function toLineInfos(fen: string, res: EngineResult): LineInfo[] {
  const stm = fen.split(" ")[1] === "b" ? "b" : "w";
  return res.lines
    .filter((l) => l.pv.length)
    .map((l) => {
      const san = uciToSan(fen, l.pv);
      return { rank: l.multipv, eval: toWhiteEval(l.score, stm), uci: l.pv.slice(0, san.length), san, startFen: fen };
    });
}

/** Format SAN moves with move numbers, e.g. "12... Nf6 13. Bg5 h6". */
export function numberedLine(startFen: string, san: string[]): { label: string; san: string; index: number }[] {
  const parts = startFen.split(" ");
  let num = Number(parts[5]) || 1;
  let white = parts[1] !== "b";
  return san.map((m, i) => {
    const label = white ? `${num}.` : i === 0 ? `${num}...` : "";
    if (!white) num++;
    white = !white;
    return { label, san: m, index: i };
  });
}

/** FENs after each move of a UCI line (for stepping through a preview). */
export function lineFens(startFen: string, uci: string[]): { fen: string; from: string; to: string }[] {
  const c = new Chess(startFen);
  const out: { fen: string; from: string; to: string }[] = [];
  for (const u of uci) {
    try {
      const m = c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
      out.push({ fen: c.fen(), from: m.from, to: m.to });
    } catch {
      break;
    }
  }
  return out;
}

export interface AnalyzeOptions {
  depth?: number;
  multiPv?: number; // informational; the engine must be configured with the same MultiPV
  book?: OpeningBook | null;
  onProgress?: (done: number, total: number) => void;
  signal?: { aborted: boolean };
}

export async function analyzePgn(pgn: string, evaluate: Evaluator, opts: AnalyzeOptions = {}): Promise<GameAnalysis> {
  const depth = opts.depth ?? 12;
  const game = new Chess();
  game.loadPgn(pgn);
  const history = game.history({ verbose: true });
  const headers = game.getHeaders();
  const initialFen = headers.SetUp === "1" && headers.FEN ? headers.FEN : new Chess().fen();

  const board = new Chess(initialFen);
  const total = history.length + 1;
  const evals: { ev: Eval; res: EngineResult | null }[] = [];
  evals.push(await evalPosition(board, evaluate, depth));
  opts.onProgress?.(1, total);
  for (let i = 0; i < history.length; i++) {
    if (opts.signal?.aborted) throw new Error("aborted");
    board.move(history[i].san);
    evals.push(await evalPosition(board, evaluate, depth));
    opts.onProgress?.(i + 2, total);
  }

  // Opening book: a move is "Book" while every move so far has stayed in the bundled book.
  let stillBook = !!opts.book && epd(initialFen) === epd(new Chess().fen());
  let opening: { eco: string; name: string } | null = null;

  const moves: MoveAnalysis[] = [];
  history.forEach((h, i) => {
    const mover: "white" | "black" = h.color === "w" ? "white" : "black";
    const moverC: Color = h.color;
    const sign = mover === "white" ? 1 : -1;
    const before = evals[i].ev;
    const after = evals[i + 1].ev;
    const bestMoveUci = evals[i].res?.bestMove ?? null;
    const uci = h.from + h.to + (h.promotion ?? "");
    const wb = whiteWinPercent(before);
    const wa = whiteWinPercent(after);
    const winBefore = mover === "white" ? wb : 100 - wb;
    const winAfter = mover === "white" ? wa : 100 - wa;
    const isBest = bestMoveUci === uci;
    const winLoss = isBest ? 0 : Math.max(0, winBefore - winAfter);
    const cpLoss = isBest ? 0 : Math.max(0, (whiteCp(before) - whiteCp(after)) * sign);
    const lines = evals[i].res ? toLineInfos(h.before, evals[i].res!) : [];
    const bestLineSan = lines[0]?.san ?? [];
    const nextRes = evals[i + 1].res;
    const continuation = nextRes ? (toLineInfos(h.after, nextRes)[0] ?? null) : null;

    // Book
    let inBook = false;
    if (stillBook && opts.book) {
      const hit = bookLookup(opts.book, h.after);
      if (hit) {
        inBook = true;
        if (hit !== true) opening = hit;
      } else stillBook = false;
    }

    // Sacrifice: material still down two plies after the move along the engine's line
    // (opponent takes, we continue), or a valuable piece left en prise that the engine declines to take.
    const sacrifice = detectSacrifice(h.before, uci, continuation?.uci ?? [], moverC, h.piece, h.captured, lines[1]?.uci);

    // MultiPV gap for "Great"
    const moverWin = (e: Eval) => (mover === "white" ? whiteWinPercent(e) : 100 - whiteWinPercent(e));
    const secondBestGap = lines.length >= 2 ? moverWin(lines[0].eval) - moverWin(lines[1].eval) : null;

    const prev = moves[i - 1];
    const prevCapturedOn = prev && history[i - 1].captured ? history[i - 1].to : null;
    const bestGain = lines[0] && !isBest ? materialSwing(h.before, lines[0].uci, moverC) : 0;
    const moverMate = (e: Eval) => e.mate !== null && e.mate !== 0 && e.mate * sign > 0;
    const { classification, reason } = classifyMove({
      inBook,
      isBest,
      winLoss,
      winBefore,
      winAfter,
      sacrifice,
      secondBestGap,
      isRecapture: (!!h.captured && prevCapturedOn === h.to) || isObviousCapture(h.before, h.to, moverC, h.piece, h.captured),
      opponentErred: !!prev && prev.winLoss >= 10,
      bestGain,
      bestMates: !!lines[0] && moverMate(lines[0].eval),
      hadMate: moverMate(before),
      keepsMate: moverMate(after) || (after.mate === 0 && after.winner === mover),
      allowsMate: after.mate !== null && after.mate !== 0 && after.mate * sign < 0 && !(before.mate !== null && before.mate * sign < 0),
    });

    const pc = pieceCount(looseBoard(h.before));
    const phase: Phase = inBook || (i < 20 && pc > 10) ? "opening" : pc <= 6 ? "endgame" : "middlegame";
    const base = {
      ply: i + 1,
      moveNumber: Number(h.before.split(" ")[5]) || Math.floor(i / 2) + 1,
      color: mover,
      san: h.san,
      uci,
      from: h.from,
      to: h.to,
      fenBefore: h.before,
      fenAfter: h.after,
      evalBefore: before,
      evalAfter: after,
      bestMoveUci,
      bestMoveSan: bestMoveUci ? (uciToSan(h.before, [bestMoveUci])[0] ?? null) : null,
      bestLineSan,
      lines,
      continuation,
      winBefore,
      winAfter,
      winLoss,
      cpLoss,
      accuracy: inBook ? 100 : moveAccuracy(winLoss),
      classification,
      reason,
      sacrifice,
      phase,
    };
    const explanation = explainMove({
      ...base,
      isBest,
      opening: opening?.name ?? null,
      previous: prev ? { san: prev.san, classification: prev.classification, fenBefore: prev.fenBefore, captured: !!history[i - 1].captured } : null,
      formatEval,
    });
    moves.push({ ...base, note: classification === "Miss" || /mate/.test(reason) ? explanation.headline : null, explanation });
  });

  return {
    depth,
    multiPv: opts.multiPv ?? Math.max(1, ...moves.map((m) => m.lines.length)),
    opening,
    initialFen,
    initialEval: evals[0].ev,
    moves,
    white: summarizePlayer(moves.filter((m) => m.color === "white")),
    black: summarizePlayer(moves.filter((m) => m.color === "black")),
  };
}

/** Parse UCI engine output for a single "go depth N" search (supports MultiPV). */
export class UciSearchParser {
  private lines = new Map<number, EngineLine>();

  /** Feed a line; returns a result when "bestmove" arrives. */
  feed(line: string): EngineResult | null {
    if (line.startsWith("info") && line.includes(" score ")) {
      if (line.includes(" lowerbound") || line.includes(" upperbound")) return null;
      const mpv = Number(line.match(/ multipv (\d+)/)?.[1] ?? 1);
      const d = line.match(/ depth (\d+)/);
      const cp = line.match(/ score cp (-?\d+)/);
      const mate = line.match(/ score mate (-?\d+)/);
      const pv = line.match(/ pv (.+)$/);
      const prev = this.lines.get(mpv);
      this.lines.set(mpv, {
        multipv: mpv,
        depth: d ? Number(d[1]) : (prev?.depth ?? 0),
        score: cp ? { cp: Number(cp[1]) } : mate ? { mate: Number(mate[1]) } : (prev?.score ?? { cp: 0 }),
        pv: pv ? pv[1].trim().split(/\s+/) : (prev?.pv ?? []),
      });
      return null;
    }
    if (line.startsWith("bestmove")) {
      const bm = line.split(/\s+/)[1];
      const bestMove = bm && bm !== "(none)" ? bm : null;
      const lines = [...this.lines.values()].sort((a, b) => a.multipv - b.multipv);
      const top = lines[0] ?? { multipv: 1, score: { cp: 0 }, pv: [], depth: 0 };
      if (bestMove && top.pv[0] !== bestMove) top.pv = [bestMove];
      this.lines.clear();
      return { score: top.score, bestMove, pv: top.pv, depth: top.depth, lines: lines.length ? lines : [top] };
    }
    return null;
  }
}
