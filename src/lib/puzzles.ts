// Daily puzzles from the Lichess puzzle database (CC0, https://database.lichess.org/#puzzles).
import { Chess } from "chess.js";

/** Compact bundled form: [id, fen, moves (space-separated UCI, first = opponent's setup move), rating, themes]. */
export type PuzzleRow = [string, string, string, number, string];
export interface PuzzleBundle {
  source: string;
  easy: PuzzleRow[]; // pre-shuffled; day N uses easy[N % len]
  hard: PuzzleRow[];
}
export interface Puzzle {
  id: string;
  fen: string; // position before the opponent's setup move
  moves: string[]; // UCI; moves[0] = opponent's setup move, then solver/opponent alternating
  rating: number;
  themes: string[];
  level: "easy" | "hard";
}

export const toPuzzle = (r: PuzzleRow, level: Puzzle["level"]): Puzzle => ({
  id: r[0],
  fen: r[1],
  moves: r[2].split(" "),
  rating: r[3],
  themes: r[4] ? r[4].split(" ") : [],
  level,
});

let bundle: Promise<PuzzleBundle> | null = null;
export function loadPuzzles(): Promise<PuzzleBundle> {
  bundle ??= fetch("/puzzles.json").then((r) => {
    if (!r.ok) throw new Error(`puzzles.json ${r.status}`);
    return r.json();
  });
  return bundle;
}

/** Local calendar date as YYYY-MM-DD. */
export function localDateKey(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
/** Whole days since 1970-01-01 for a YYYY-MM-DD key (timezone-independent). */
export function dayNumber(key: string): number {
  const [y, m, d] = key.split("-").map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
}
export function shiftDate(key: string, days: number): string {
  const t = new Date((dayNumber(key) + days) * 86_400_000);
  return t.toISOString().slice(0, 10);
}
export const isDateKey = (s: string | null | undefined): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(dayNumber(s));

/** The two puzzles for a date: the same for everyone, one easier and one harder. */
export function puzzlesForDate(b: Pick<PuzzleBundle, "easy" | "hard">, key: string): [Puzzle, Puzzle] {
  const n = dayNumber(key);
  const pick = (rows: PuzzleRow[]) => rows[((n % rows.length) + rows.length) % rows.length];
  return [toPuzzle(pick(b.easy), "easy"), toPuzzle(pick(b.hard), "hard")];
}

// ---- play state -------------------------------------------------------------------------------

export interface PlayState {
  fen: string; // current position
  step: number; // index into puzzle.moves of the next move to be played
  lastMove: string | null; // UCI
  solved: boolean;
}

const play = (fen: string, uci: string) => {
  const c = new Chess(fen);
  c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
  return c;
};

/** Position after the opponent's setup move; the solver is the side to move here. */
export function startPuzzle(p: Puzzle): PlayState {
  return { fen: play(p.fen, p.moves[0]).fen(), step: 1, lastMove: p.moves[0], solved: p.moves.length <= 1 };
}
export const solverColor = (p: Puzzle): "white" | "black" => (startPuzzle(p).fen.split(" ")[1] === "w" ? "white" : "black");

export type AttemptResult =
  | { kind: "illegal" }
  | { kind: "wrong"; fen: string } // fen = position after the wrong move (to show briefly)
  | { kind: "correct"; afterUser: PlayState; reply: string | null; next: PlayState }; // next = after the opponent's reply

/**
 * Check a solver move against the solution. The expected move is correct; so is any other move that
 * delivers checkmate (puzzles with several mates accept them all), which finishes the puzzle.
 */
export function attemptMove(p: Puzzle, s: PlayState, uci: string): AttemptResult {
  if (s.solved) return { kind: "illegal" };
  let c: Chess;
  try {
    c = play(s.fen, uci);
  } catch {
    return { kind: "illegal" };
  }
  const expected = p.moves[s.step];
  const mate = c.isCheckmate();
  if (uci !== expected && !mate) return { kind: "wrong", fen: c.fen() };
  const afterUser: PlayState = { fen: c.fen(), step: s.step + 1, lastMove: uci, solved: mate || s.step + 1 >= p.moves.length };
  if (afterUser.solved) return { kind: "correct", afterUser, reply: null, next: afterUser };
  const reply = p.moves[s.step + 1];
  const r = play(afterUser.fen, reply);
  const next: PlayState = { fen: r.fen(), step: s.step + 2, lastMove: reply, solved: s.step + 2 >= p.moves.length };
  return { kind: "correct", afterUser, reply, next };
}

/** Next state when auto-playing the solution one move. */
export function playSolutionMove(p: Puzzle, s: PlayState): PlayState {
  if (s.solved) return s;
  const c = play(s.fen, p.moves[s.step]);
  return { fen: c.fen(), step: s.step + 1, lastMove: p.moves[s.step], solved: s.step + 1 >= p.moves.length };
}

// ---- saved progress ---------------------------------------------------------------------------
// A puzzle stays unsolved (in the backlog, with its date) until it is solved correctly. A wrong move or
// "Show solution" marks it failed, which is still unsolved and can be retried later.

export interface PuzzleRecord {
  status: "solved" | "failed";
  solvedOn?: string; // local date it was solved (streaks only count puzzles solved on their own day)
}
export interface Progress {
  firstDay: string | null; // first day the user saw puzzles: no backlog before it
  days: Record<string, Record<string, PuzzleRecord>>; // puzzle date -> puzzle id -> record
}
export const PROGRESS_KEY = "movementor-puzzles";
export const PROGRESS_EVENT = "movementor-puzzles-change";
export const PER_DAY = 2;
const MAX_BACKLOG_DAYS = 365;

export const emptyProgress = (): Progress => ({ firstDay: null, days: {} });

export function readProgress(storage: Pick<Storage, "getItem"> | null = typeof localStorage === "undefined" ? null : localStorage): Progress {
  try {
    const p = JSON.parse(storage?.getItem(PROGRESS_KEY) ?? "null") as Progress | null;
    return p && typeof p === "object" && p.days ? { firstDay: p.firstDay ?? null, days: p.days } : emptyProgress();
  } catch {
    return emptyProgress();
  }
}
function write(p: Progress, storage: Pick<Storage, "setItem"> | null = typeof localStorage === "undefined" ? null : localStorage) {
  try {
    storage?.setItem(PROGRESS_KEY, JSON.stringify(p));
    if (typeof window !== "undefined") window.dispatchEvent(new Event(PROGRESS_EVENT));
  } catch {}
}

/** Pure update: record a result. Solved always wins; a failed result never downgrades a solved puzzle. */
export function withResult(p: Progress, date: string, id: string, status: PuzzleRecord["status"], today: string): Progress {
  const days = { ...p.days, [date]: { ...(p.days[date] ?? {}) } };
  const cur = days[date][id];
  if (cur?.status === "solved") return p;
  days[date][id] = status === "solved" ? { status, solvedOn: today } : { status };
  return { firstDay: p.firstDay ?? today, days };
}
/** Pure update: remember the first day (no backlog for days before the user started). */
export const withFirstDay = (p: Progress, today: string): Progress => (p.firstDay ? p : { ...p, firstDay: today });

export function ensureFirstDay(today: string): Progress {
  const p = readProgress();
  if (p.firstDay) return p;
  const n = withFirstDay(p, today);
  write(n);
  return n;
}
export function saveResult(date: string, id: string, status: PuzzleRecord["status"], today: string): Progress {
  const n = withResult(readProgress(), date, id, status, today);
  write(n);
  return n;
}

export const isSolved = (p: Progress, date: string, id: string) => p.days[date]?.[id]?.status === "solved";
export const solvedCount = (p: Progress, date: string) => Object.values(p.days[date] ?? {}).filter((r) => r.status === "solved").length;

/** Past dates (newest first, before today, not before firstDay) that still have unsolved puzzles. */
export function backlogDates(p: Progress, today: string): string[] {
  if (!p.firstDay) return [];
  const out: string[] = [];
  for (let d = shiftDate(today, -1), i = 0; d >= p.firstDay && i < MAX_BACKLOG_DAYS; d = shiftDate(d, -1), i++) {
    if (solvedCount(p, d) < PER_DAY) out.push(d);
  }
  return out;
}
/** Unsolved puzzles: today's plus the backlog (counts only, no bundle needed). */
export function unsolvedCounts(p: Progress, today: string): { today: number; backlog: number } {
  return {
    today: PER_DAY - Math.min(PER_DAY, solvedCount(p, today)),
    backlog: backlogDates(p, today).reduce((n, d) => n + PER_DAY - Math.min(PER_DAY, solvedCount(p, d)), 0),
  };
}

/** A day counts towards the streak when both of its puzzles were solved on that same day. */
export const dayStreakDone = (p: Progress, date: string) =>
  Object.values(p.days[date] ?? {}).filter((r) => r.status === "solved" && r.solvedOn === date).length >= PER_DAY;

/** Consecutive streak days ending today (or yesterday, if today isn't finished yet). */
export function streak(p: Progress, today: string): number {
  let d = dayStreakDone(p, today) ? today : shiftDate(today, -1);
  let n = 0;
  while (dayStreakDone(p, d)) {
    n++;
    d = shiftDate(d, -1);
  }
  return n;
}
