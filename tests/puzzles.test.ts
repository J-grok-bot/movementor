import { test } from "node:test";
import assert from "node:assert/strict";
import {
  attemptMove,
  backlogDates,
  dayNumber,
  emptyProgress,
  localDateKey,
  playSolutionMove,
  puzzlesForDate,
  shiftDate,
  solverColor,
  startPuzzle,
  streak,
  toPuzzle,
  unsolvedCounts,
  withFirstDay,
  withResult,
  type PuzzleBundle,
  type PuzzleRow,
} from "../src/lib/puzzles";

const rows = (n: number, tag: string): PuzzleRow[] =>
  Array.from({ length: n }, (_, i) => [`${tag}${i}`, "8/8/8/8/8/8/8/8 w - - 0 1", "a1a2", 1000 + i, ""]);

test("date picker: deterministic, one easy + one hard, changes daily, cycles", () => {
  const b = { easy: rows(5, "e"), hard: rows(7, "h") };
  const [e1, h1] = puzzlesForDate(b, "2026-10-22");
  assert.equal(e1.level, "easy");
  assert.equal(h1.level, "hard");
  assert.deepEqual(puzzlesForDate(b, "2026-10-22").map((p) => p.id), [e1.id, h1.id]);
  assert.notEqual(puzzlesForDate(b, "2026-10-23")[0].id, e1.id);
  assert.equal(puzzlesForDate(b, shiftDate("2026-10-22", 5))[0].id, e1.id);
  assert.equal(dayNumber("1970-01-02"), 1);
  assert.equal(shiftDate("2026-12-31", 1), "2027-01-01");
  assert.equal(shiftDate("2024-03-01", -1), "2024-02-29");
  assert.equal(localDateKey(new Date(2026, 0, 5, 23, 59)), "2026-01-05");
});

// Real Lichess puzzle 00sHx: Qxe5 ... (black solves). FEN before setup move.
const P = toPuzzle(["00sHx", "q3k1nr/1pp1nQpp/3p4/1P2p3/4P3/B1PP1b2/B5PP/5K2 b k - 0 17", "e8d7 a2e6 d7d8 f7f8", 1760, "mate mateIn2"], "hard");

test("move validation: setup move, orientation, correct/wrong, auto reply, solved", () => {
  const s = startPuzzle(P);
  assert.equal(solverColor(P), "white");
  assert.equal(s.lastMove, "e8d7");
  assert.equal(attemptMove(P, s, "f7g8").kind, "wrong");
  assert.equal(attemptMove(P, s, "a1a1").kind, "illegal");
  const r = attemptMove(P, s, "a2e6");
  assert.equal(r.kind, "correct");
  if (r.kind !== "correct") return;
  assert.equal(r.reply, "d7d8");
  assert.equal(r.next.solved, false);
  const r2 = attemptMove(P, r.next, "f7f8");
  assert.ok(r2.kind === "correct" && r2.next.solved);
});

test("any checkmating move is accepted", () => {
  // White: Kc1 Qb6 Rh7, black Ka8 + pawn. Solution Qb7#, but Rh8# also mates.
  const p = toPuzzle(["m", "k7/7R/1Q6/8/4p3/8/8/2K5 b - - 0 1", "e4e3 b6b7", 1000, "mateIn1"], "easy");
  const s = startPuzzle(p);
  const r = attemptMove(p, s, "h7h8");
  assert.ok(r.kind === "correct" && r.next.solved);
  assert.equal(playSolutionMove(p, s).solved, true);
});

test("backlog persists across a date change until solved; first day limits it; streak", () => {
  let p = withFirstDay(emptyProgress(), "2026-10-20");
  assert.equal(withFirstDay(p, "2026-10-25").firstDay, "2026-10-20");
  // day 1: solve both; day 2: one solved, one failed via Show solution; day 3: nothing
  p = withResult(p, "2026-10-20", "a", "solved", "2026-10-20");
  p = withResult(p, "2026-10-20", "b", "solved", "2026-10-20");
  p = withResult(p, "2026-10-21", "c", "solved", "2026-10-21");
  p = withResult(p, "2026-10-21", "d", "failed", "2026-10-21");
  // serialize as localStorage would, then the date changes
  p = JSON.parse(JSON.stringify(p));
  assert.deepEqual(backlogDates(p, "2026-10-23"), ["2026-10-22", "2026-10-21"]);
  assert.deepEqual(unsolvedCounts(p, "2026-10-23"), { today: 2, backlog: 3 });
  // failed stays failed on another failure, solved later clears it
  p = withResult(p, "2026-10-21", "d", "failed", "2026-10-23");
  assert.deepEqual(backlogDates(p, "2026-10-23"), ["2026-10-22", "2026-10-21"]);
  p = withResult(p, "2026-10-21", "d", "solved", "2026-10-23");
  assert.deepEqual(backlogDates(p, "2026-10-23"), ["2026-10-22"]);
  assert.equal(withResult(p, "2026-10-21", "d", "failed", "2026-10-24").days["2026-10-21"].d.status, "solved");
  // new users: nothing before their first day
  assert.deepEqual(backlogDates(withFirstDay(emptyProgress(), "2026-10-23"), "2026-10-23"), []);
  // streak: only days solved on their own day; late backlog solve of 10-21 doesn't count
  assert.equal(streak(p, "2026-10-21"), 1);
  p = withResult(p, "2026-10-23", "e", "solved", "2026-10-23");
  p = withResult(p, "2026-10-23", "f", "solved", "2026-10-23");
  assert.equal(streak(p, "2026-10-23"), 1);
  assert.equal(streak(p, "2026-10-24"), 1); // today not done yet: streak from yesterday
});

test("bundled puzzles all replay legally with the solver to move", async () => {
  const { readFileSync } = await import("node:fs");
  const b = JSON.parse(readFileSync(new URL("../public/puzzles.json", import.meta.url), "utf8")) as PuzzleBundle;
  assert.ok(b.easy.length >= 1000 && b.hard.length >= 1000);
  assert.match(b.source, /Lichess/);
  for (const level of ["easy", "hard"] as const) {
    for (const row of b[level]) {
      const p = toPuzzle(row, level);
      let s = startPuzzle(p);
      assert.equal(s.fen.split(" ")[1], solverColor(p)[0], p.id);
      while (!s.solved) s = playSolutionMove(p, s);
      assert.equal(s.step, p.moves.length, p.id);
      assert.ok(p.rating >= (level === "easy" ? 800 : 1500) && p.rating < (level === "easy" ? 1500 : 2200), p.id);
    }
  }
});
