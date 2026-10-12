// Static tactical helpers built on chess.js. Pure functions, used by the classifier and explainer.
import { Chess, type Color, type PieceSymbol, type Square } from "chess.js";

export const VALUE: Record<PieceSymbol, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
export const NAME: Record<PieceSymbol, string> = { p: "pawn", n: "knight", b: "bishop", r: "rook", q: "queen", k: "king" };
const KING_VALUE = 100; // for ordering targets in pins/skewers/forks

export const opp = (c: Color): Color => (c === "w" ? "b" : "w");
export const colorName = (c: Color) => (c === "w" ? "White" : "Black");

export interface PieceAt {
  square: Square;
  type: PieceSymbol;
  color: Color;
}

/** Load a FEN without legality validation (lets us analyse "what if it were X's turn"). */
export function board(fen: string): Chess {
  return new Chess(fen, { skipValidation: true });
}

export function pieces(c: Chess): PieceAt[] {
  const out: PieceAt[] = [];
  for (const row of c.board()) for (const p of row) if (p) out.push({ square: p.square, type: p.type, color: p.color });
  return out;
}

/** Material of `color` minus the opponent's, in pawns. */
export function materialBalance(c: Chess, color: Color): number {
  let s = 0;
  for (const p of pieces(c)) s += (p.color === color ? 1 : -1) * VALUE[p.type];
  return s;
}

/** Count of non-pawn, non-king pieces on the board (both sides). */
export function pieceCount(c: Chess): number {
  return pieces(c).filter((p) => p.type !== "p" && p.type !== "k").length;
}

const val = (t: PieceSymbol) => (t === "k" ? KING_VALUE : VALUE[t]);

/** Play UCI moves from a FEN; returns the positions after each move (stops at the first illegal move). */
export function playUci(fen: string, uci: string[]) {
  const c = new Chess(fen);
  const out: { fen: string; san: string; captured?: PieceSymbol; piece: PieceSymbol; from: Square; to: Square; check: boolean }[] = [];
  for (const u of uci) {
    try {
      const m = c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
      out.push({ fen: c.fen(), san: m.san, captured: m.captured, piece: m.piece, from: m.from, to: m.to, check: c.inCheck() });
    } catch {
      break;
    }
  }
  return out;
}

/**
 * Material change for `color` along a line, measured after `plies` moves, extended while the
 * last move was a capture (cheap quiescence) so we don't stop in the middle of an exchange.
 */
export function materialSwing(fen: string, uci: string[], color: Color, plies = 6): number {
  const start = materialBalance(board(fen), color);
  const seq = playUci(fen, uci);
  if (!seq.length) return 0;
  let end = Math.min(plies, seq.length);
  while (end < seq.length && end < plies + 4 && seq[end - 1].captured) end++;
  return materialBalance(board(seq[end - 1].fen), color) - start;
}

/** Material change for `color` after exactly `plies` moves of a line (or null if the line is shorter). */
export function materialAfter(fen: string, uci: string[], color: Color, plies: number): number | null {
  const seq = playUci(fen, uci);
  if (seq.length < plies) return null;
  return materialBalance(board(seq[plies - 1].fen), color) - materialBalance(board(fen), color);
}

export interface Hanging {
  square: Square;
  type: PieceSymbol;
  color: Color;
  attackers: Square[];
  defended: boolean;
  cheapestAttacker: PieceSymbol;
}

/** Pieces of `color` that the opponent can win: undefended and attacked, or attacked by something cheaper. */
export function hangingPieces(fen: string, color: Color): Hanging[] {
  const c = board(fen);
  const out: Hanging[] = [];
  for (const p of pieces(c)) {
    if (p.color !== color || p.type === "k") continue;
    const attackers = c.attackers(p.square, opp(color));
    if (!attackers.length) continue;
    const defenders = c.attackers(p.square, color);
    const cheapest = attackers.map((s) => c.get(s)!.type).sort((a, b) => val(a) - val(b))[0];
    if (!defenders.length || val(cheapest) < VALUE[p.type]) {
      out.push({ square: p.square, type: p.type, color, attackers, defended: defenders.length > 0, cheapestAttacker: cheapest });
    }
  }
  return out.sort((a, b) => VALUE[b.type] - VALUE[a.type]);
}

export interface Fork {
  square: Square;
  piece: PieceSymbol;
  targets: { square: Square; type: PieceSymbol }[];
}

/** Does the piece on `square` attack two or more valuable enemy targets (king, higher value, or undefended)? */
export function forkFrom(fen: string, square: Square): Fork | null {
  const c = board(fen);
  const me = c.get(square);
  if (!me) return null;
  const enemy = opp(me.color);
  const targets: { square: Square; type: PieceSymbol }[] = [];
  for (const p of pieces(c)) {
    if (p.color !== enemy) continue;
    if (!c.attackers(p.square, me.color).includes(square)) continue;
    const defended = c.attackers(p.square, enemy).length > 0;
    if (p.type === "k" || val(p.type) > val(me.type) || (!defended && p.type !== "p")) targets.push({ square: p.square, type: p.type });
  }
  if (targets.length < 2) return null;
  // A fork is only meaningful if the forking piece can't simply be taken for free.
  const attackersOfMe = c.attackers(square, enemy);
  const defendersOfMe = c.attackers(square, me.color);
  if (attackersOfMe.length && !defendersOfMe.length && me.type !== "p") {
    const canTakeSafely = !targets.some((t) => t.type === "k"); // if it gives check the king must respond first
    if (canTakeSafely) return null;
  }
  return { square, piece: me.type, targets: targets.sort((a, b) => val(b.type) - val(a.type)) };
}

export interface LineTactic {
  kind: "pin" | "skewer";
  square: Square;
  piece: PieceSymbol;
  front: { square: Square; type: PieceSymbol };
  back: { square: Square; type: PieceSymbol };
}

const DIRS: Record<"b" | "r", [number, number][]> = {
  b: [
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ],
  r: [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ],
};

function sq(file: number, rank: number): Square | null {
  if (file < 0 || file > 7 || rank < 0 || rank > 7) return null;
  return `${"abcdefgh"[file]}${rank + 1}` as Square;
}

/** Pins and skewers created by the sliding piece on `square`. */
export function lineTacticsFrom(fen: string, square: Square): LineTactic[] {
  const c = board(fen);
  const me = c.get(square);
  if (!me || !["b", "r", "q"].includes(me.type)) return [];
  const dirs = me.type === "q" ? [...DIRS.b, ...DIRS.r] : DIRS[me.type as "b" | "r"];
  const f0 = square.charCodeAt(0) - 97;
  const r0 = Number(square[1]) - 1;
  const out: LineTactic[] = [];
  for (const [df, dr] of dirs) {
    const hits: { square: Square; type: PieceSymbol; color: Color }[] = [];
    for (let i = 1; i < 8 && hits.length < 2; i++) {
      const s = sq(f0 + df * i, r0 + dr * i);
      if (!s) break;
      const p = c.get(s);
      if (p) hits.push({ square: s, type: p.type, color: p.color });
    }
    if (hits.length < 2 || hits[0].color === me.color || hits[1].color === me.color) continue;
    const [front, back] = hits;
    if (val(back.type) > val(front.type) && (back.type === "k" || val(back.type) > val(me.type)) && front.type !== "p") {
      out.push({ kind: "pin", square, piece: me.type, front, back });
    } else if (val(front.type) > val(back.type) && (front.type === "k" || front.type === "q") && back.type !== "p" && val(back.type) >= 3) {
      out.push({ kind: "skewer", square, piece: me.type, front, back });
    }
  }
  return out;
}
