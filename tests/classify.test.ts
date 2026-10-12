import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyMove, type ClassifyInput } from "../src/lib/classify";
import { estimateRating } from "../src/lib/overview";
import { UciSearchParser } from "../src/lib/analysis";

const base: ClassifyInput = {
  inBook: false,
  isBest: false,
  winLoss: 0,
  winBefore: 55,
  winAfter: 55,
  sacrifice: 0,
  secondBestGap: null,
  isRecapture: false,
  opponentErred: false,
  bestGain: 0,
  bestMates: false,
  hadMate: false,
  keepsMate: false,
  allowsMate: false,
};
const cls = (o: Partial<ClassifyInput>) => classifyMove({ ...base, ...o }).classification;

test("book moves", () => assert.equal(cls({ inBook: true, winLoss: 5 }), "Book"));

test("brilliant = sound sacrifice of >= 2 pawns", () => {
  assert.equal(cls({ isBest: true, sacrifice: 3, winBefore: 60, winAfter: 70 }), "Brilliant");
  assert.equal(cls({ isBest: false, winLoss: 1, sacrifice: 5, winBefore: 60, winAfter: 59 }), "Brilliant");
});
test("no brilliant when the sacrifice leaves you worse, already totally winning, or is a pawn", () => {
  assert.equal(cls({ isBest: true, sacrifice: 3, winBefore: 40, winAfter: 40 }), "Best");
  assert.equal(cls({ isBest: true, sacrifice: 3, winBefore: 99, winAfter: 99 }), "Best");
  assert.equal(cls({ isBest: true, sacrifice: 1, winBefore: 60, winAfter: 70 }), "Best");
});

test("great = only good move (MultiPV gap)", () => {
  assert.equal(cls({ isBest: true, secondBestGap: 25, winAfter: 60 }), "Great");
  assert.equal(cls({ isBest: true, secondBestGap: 5, winAfter: 60 }), "Best");
  assert.equal(cls({ isBest: true, secondBestGap: 40, isRecapture: true }), "Best");
  assert.equal(cls({ isBest: true, secondBestGap: null }), "Best");
});

test("win% loss thresholds", () => {
  assert.equal(cls({ winLoss: 1 }), "Excellent");
  assert.equal(cls({ winLoss: 5 }), "Good");
  assert.equal(cls({ winLoss: 12 }), "Inaccuracy");
  assert.equal(cls({ winLoss: 22 }), "Mistake");
  assert.equal(cls({ winLoss: 35 }), "Blunder");
});

test("miss = failing to punish an opponent error", () => {
  assert.equal(cls({ opponentErred: true, bestGain: 3, winLoss: 25, winBefore: 90, winAfter: 65 }), "Miss");
  // Without an opponent error it's a normal mistake
  assert.equal(cls({ opponentErred: false, bestGain: 3, winLoss: 25, winBefore: 90, winAfter: 65 }), "Mistake");
  // If you end up losing it's still a blunder
  assert.equal(cls({ opponentErred: true, bestGain: 3, winLoss: 60, winBefore: 90, winAfter: 30 }), "Blunder");
  // Missed forced mate while staying fine
  assert.equal(cls({ hadMate: true, keepsMate: false, winLoss: 12, winBefore: 100, winAfter: 88 }), "Miss");
});

test("allowing mate is at least a mistake", () => {
  assert.equal(cls({ allowsMate: true, winLoss: 12, winAfter: 0 }), "Mistake");
});

test("rating estimate is monotonic and bounded", () => {
  let prev = 0;
  for (let a = 0; a <= 100; a += 5) {
    const r = estimateRating(a);
    assert.ok(r >= prev, `estimate should not decrease at ${a}`);
    prev = r;
  }
  assert.equal(estimateRating(0), 250);
  assert.equal(estimateRating(100), 2800);
});

test("UCI parser handles MultiPV and mate scores", () => {
  const p = new UciSearchParser();
  p.feed("info depth 10 seldepth 12 multipv 1 score cp 35 nodes 1 pv e2e4 e7e5");
  p.feed("info depth 10 seldepth 12 multipv 2 score mate -3 nodes 1 pv d2d4 d7d5");
  const r = p.feed("bestmove e2e4 ponder e7e5")!;
  assert.equal(r.bestMove, "e2e4");
  assert.deepEqual(r.score, { cp: 35 });
  assert.equal(r.lines.length, 2);
  assert.deepEqual(r.lines[1].score, { mate: -3 });
});

import { detectSacrifice } from "../src/lib/analysis";
test("sacrifice detection: Greek gift Bxh7+ is a 2-pawn sacrifice; a normal trade is not", () => {
  const fen = "r1bq1rk1/pppn1ppp/4p3/3pP3/1b1P4/2NB1N2/PPP2PPP/R2QK2R w KQ - 0 1";
  assert.equal(detectSacrifice(fen, "d3h7", ["g8h7", "f3g5", "h7g8", "d1h5"], "w", "b", undefined), 2);
  // Same sacrifice but the alternative line loses the same material anyway -> not a sacrifice
  assert.equal(detectSacrifice(fen, "d3h7", ["g8h7", "f3g5", "h7g8", "d1h5"], "w", "b", undefined, ["d3h7", "g8h7", "f3g5"]), 0);
  // Knight trade on d5 is not a sacrifice
  const trade = "4k3/8/8/3n4/8/2N5/8/4K3 w - - 0 1";
  assert.equal(detectSacrifice(trade, "c3d5", [], "w", "n", "n"), 0);
});
