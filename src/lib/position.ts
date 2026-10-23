// Position editor model for the /analyze calculator: board map <-> FEN, castling cleanup, validation.
import { Chess, type Square } from "chess.js";

export type PieceCode = "wK" | "wQ" | "wR" | "wB" | "wN" | "wP" | "bK" | "bQ" | "bR" | "bB" | "bN" | "bP";
export type BoardMap = Partial<Record<string, PieceCode>>;
export interface Castling {
  K: boolean;
  Q: boolean;
  k: boolean;
  q: boolean;
}
export interface Setup {
  board: BoardMap;
  turn: "w" | "b";
  castling: Castling;
  ep: string | null; // en passant target square, e.g. "e6"
}

export const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
export const PIECES: PieceCode[] = ["wK", "wQ", "wR", "wB", "wN", "wP", "bK", "bQ", "bR", "bB", "bN", "bP"];
const FILES = "abcdefgh";
export const ALL_SQUARES = [...FILES].flatMap((f) => [1, 2, 3, 4, 5, 6, 7, 8].map((r) => `${f}${r}`));
const NO_CASTLING: Castling = { K: false, Q: false, k: false, q: false };

const toCode = (ch: string): PieceCode => ((ch === ch.toUpperCase() ? "w" : "b") + ch.toUpperCase()) as PieceCode;
const toChar = (p: PieceCode) => (p[0] === "w" ? p[1] : p[1].toLowerCase());

export function placementToBoard(placement: string): BoardMap {
  const board: BoardMap = {};
  placement.split("/").forEach((row, i) => {
    let f = 0;
    for (const ch of row) {
      if (/\d/.test(ch)) f += Number(ch);
      else {
        if (f < 8) board[`${FILES[f]}${8 - i}`] = toCode(ch);
        f++;
      }
    }
  });
  return board;
}

export function boardToPlacement(board: BoardMap): string {
  const rows: string[] = [];
  for (let r = 8; r >= 1; r--) {
    let row = "";
    let empty = 0;
    for (const f of FILES) {
      const p = board[`${f}${r}`];
      if (!p) empty++;
      else {
        if (empty) row += empty;
        empty = 0;
        row += toChar(p);
      }
    }
    rows.push(row + (empty ? empty : ""));
  }
  return rows.join("/");
}

/** Castling rights only survive while the king and that rook are on their home squares. */
export function cleanCastling(board: BoardMap, c: Castling): Castling {
  return {
    K: c.K && board.e1 === "wK" && board.h1 === "wR",
    Q: c.Q && board.e1 === "wK" && board.a1 === "wR",
    k: c.k && board.e8 === "bK" && board.h8 === "bR",
    q: c.q && board.e8 === "bK" && board.a8 === "bR",
  };
}
export const castlingAllowed = (board: BoardMap) => cleanCastling(board, { K: true, Q: true, k: true, q: true });

/** En passant target squares that make sense for this board and side to move (a pawn just double-stepped). */
export function epCandidates(board: BoardMap, turn: "w" | "b"): string[] {
  const [rank, behind, start, pawn, mine] = turn === "w" ? [5, 6, 7, "bP", "wP"] : [4, 3, 2, "wP", "bP"];
  return [...FILES].flatMap((f, i) => {
    if (board[`${f}${rank}`] !== pawn || board[`${f}${behind}`] || board[`${f}${start}`]) return [];
    const capturer = [FILES[i - 1], FILES[i + 1]].some((g) => g && board[`${g}${rank}`] === mine);
    return capturer ? [`${f}${behind}`] : [];
  });
}

export function setupToFen(s: Setup): string {
  const c = cleanCastling(s.board, s.castling);
  const cs = (c.K ? "K" : "") + (c.Q ? "Q" : "") + (c.k ? "k" : "") + (c.q ? "q" : "") || "-";
  const ep = s.ep && epCandidates(s.board, s.turn).includes(s.ep) ? s.ep : "-";
  return `${boardToPlacement(s.board)} ${s.turn} ${cs} ${ep} 0 1`;
}

/** Parses a FEN (placement required, other fields optional). Returns null if it isn't FEN-shaped. */
export function fenToSetup(fen: string): Setup | null {
  const [placement, turn = "w", cs = "-", ep = "-"] = fen.trim().split(/\s+/);
  if (!placement || !/^[pnbrqkPNBRQK1-8]+(\/[pnbrqkPNBRQK1-8]+){7}$/.test(placement)) return null;
  const widths = placement.split("/").map((r) => [...r].reduce((n, ch) => n + (/\d/.test(ch) ? Number(ch) : 1), 0));
  if (widths.some((w) => w !== 8)) return null;
  const board = placementToBoard(placement);
  const castling = cleanCastling(board, { K: cs.includes("K"), Q: cs.includes("Q"), k: cs.includes("k"), q: cs.includes("q") });
  const t = turn === "b" ? "b" : "w";
  return { board, turn: t, castling, ep: epCandidates(board, t).includes(ep) ? ep : null };
}

export const startSetup = (): Setup => fenToSetup(START_FEN)!;
export const emptySetup = (): Setup => ({ board: {}, turn: "w", castling: { ...NO_CASTLING }, ep: null });

/** Board edits keep castling/en passant consistent. */
export function withBoard(s: Setup, board: BoardMap): Setup {
  return { ...s, board, castling: cleanCastling(board, s.castling), ep: s.ep && epCandidates(board, s.turn).includes(s.ep) ? s.ep : null };
}

const count = (board: BoardMap, p: PieceCode) => Object.values(board).filter((x) => x === p).length;

/** Friendly problems that stop the engine from calculating; empty when the position is legal enough. */
export function validateSetup(s: Setup): string[] {
  const b = s.board;
  const errs: string[] = [];
  for (const [color, name] of [["w", "White"], ["b", "Black"]] as const) {
    const k = count(b, `${color}K`);
    if (k === 0) errs.push(`${name} needs a king.`);
    if (k > 1) errs.push(`${name} has ${k} kings. Only one is allowed.`);
    const total = Object.values(b).filter((p) => p![0] === color).length;
    if (total > 16) errs.push(`${name} has ${total} pieces. The most is 16.`);
    const pawns = count(b, `${color}P`);
    if (pawns > 8) errs.push(`${name} has ${pawns} pawns. The most is 8.`);
    // every piece beyond the starting set must be a promoted pawn
    const extra =
      Math.max(0, count(b, `${color}Q`) - 1) +
      Math.max(0, count(b, `${color}R`) - 2) +
      Math.max(0, count(b, `${color}B`) - 2) +
      Math.max(0, count(b, `${color}N`) - 2);
    if (pawns <= 8 && pawns + extra > 8)
      errs.push(`${name} has too many promoted pieces for ${pawns} pawn${pawns === 1 ? "" : "s"} (each extra piece needs a pawn that promoted).`);
  }
  const backRank = Object.entries(b)
    .filter(([sq, p]) => p?.[1] === "P" && (sq[1] === "1" || sq[1] === "8"))
    .map(([sq]) => sq);
  if (backRank.length) errs.push(`Pawns can't stand on the 1st or 8th rank (${backRank.sort().join(", ")}).`);
  if (!errs.length) {
    const other = s.turn === "w" ? "b" : "w";
    const kingSq = Object.entries(b).find(([, p]) => p === `${other}K`)![0];
    const c = new Chess(setupToFen({ ...s, ep: null }), { skipValidation: true });
    if (c.isAttacked(kingSq as Square, s.turn))
      errs.push(`${other === "w" ? "White" : "Black"} is in check but it's ${s.turn === "w" ? "White" : "Black"}'s move. Switch the side to move or fix the position.`);
  }
  return errs;
}

export type GameEnd = { kind: "checkmate"; winner: "White" | "Black" } | { kind: "stalemate" } | { kind: "draw"; reason: string } | null;
/** Checkmate / stalemate / dead position for a valid FEN. */
export function gameEnd(fen: string): GameEnd {
  const c = new Chess(fen, { skipValidation: true });
  if (c.isCheckmate()) return { kind: "checkmate", winner: c.turn() === "w" ? "Black" : "White" };
  if (c.isStalemate()) return { kind: "stalemate" };
  if (c.isInsufficientMaterial()) return { kind: "draw", reason: "insufficient material" };
  return null;
}
export const gameEndText = (g: NonNullable<GameEnd>) =>
  g.kind === "checkmate" ? `Checkmate, ${g.winner} wins` : g.kind === "stalemate" ? "Stalemate (draw)" : `Draw: ${g.reason}`;

// ---- persistence ----
export const ANALYZE_KEY = "movementor-analyze";
export interface SavedAnalyze {
  fen: string;
  orientation: "white" | "black";
}
export function readSaved(storage: Pick<Storage, "getItem"> | undefined = typeof localStorage === "undefined" ? undefined : localStorage): SavedAnalyze | null {
  try {
    const v = JSON.parse(storage?.getItem(ANALYZE_KEY) ?? "null");
    if (v && typeof v.fen === "string" && fenToSetup(v.fen)) return { fen: v.fen, orientation: v.orientation === "black" ? "black" : "white" };
  } catch {
    /* ignore */
  }
  return null;
}
export function writeSaved(v: SavedAnalyze) {
  try {
    localStorage.setItem(ANALYZE_KEY, JSON.stringify(v));
  } catch {
    /* storage full or blocked */
  }
}
