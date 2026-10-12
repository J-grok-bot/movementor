import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMarkers, clusterMarkers, DEFAULT_TOGGLES } from "../src/lib/graphMarkers";
import type { GameAnalysis } from "../src/lib/analysis";

const ev = (cp: number) => ({ cp, mate: null, winner: null }) as never;
function game(classes: string[]): GameAnalysis {
  return {
    initialEval: ev(0),
    moves: classes.map((c, i) => ({
      ply: i + 1,
      moveNumber: Math.floor(i / 2) + 1,
      color: i % 2 ? "black" : "white",
      san: `m${i + 1}`,
      classification: c,
      evalBefore: ev(-360),
      evalAfter: ev(500),
    })),
  } as unknown as GameAnalysis;
}
const SYM = { Blunder: "??", Brilliant: "!!" };

test("defaults show only Brilliant and Blunder; never inaccuracies", () => {
  const g = game(["Brilliant", "Great", "Mistake", "Miss", "Blunder", "Inaccuracy", "Best"]);
  assert.deepEqual(buildMarkers(g, SYM).map((m) => m.classification), ["Brilliant", "Blunder"]);
  const all = buildMarkers(g, SYM, { brilliant: true, blunder: true, great: true, errors: true });
  assert.deepEqual(all.map((m) => m.classification), ["Brilliant", "Great", "Mistake", "Miss", "Blunder"]);
  assert.equal(DEFAULT_TOGGLES.great, false);
});

test("tooltip text", () => {
  const g = game(["Best", "Blunder"]);
  assert.equal(buildMarkers(g, SYM)[0].tooltip, "1... m2 ?? Blunder, -3.6 → +5.0");
});

test("nearby markers merge, led by the most important", () => {
  const g = game(["Blunder", "Best", "Brilliant", "Best", "Blunder", "Blunder"]);
  const ms = buildMarkers(g, SYM);
  const narrow = clusterMarkers(ms, 100, 300); // 3px per ply
  const white = narrow;
  assert.equal(white.length, 1);
  assert.equal(white[0].items.length, 4);
  assert.equal(white[0].lead.classification, "Blunder");
  const wide = clusterMarkers(ms, 6, 600);
  assert.equal(wide.length, 4);
});
