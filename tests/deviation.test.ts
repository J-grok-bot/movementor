import { test } from "node:test";
import assert from "node:assert/strict";
import { bannerText, continueWithEngine, deviationFen, startEngineLine, stepDeviation, userMoveInDeviation, userMoveOnGame } from "../src/lib/deviation";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

test("on game: the real next move advances, another move deviates (amber)", () => {
  assert.deepEqual(userMoveOnGame(START, 0, "e2e4", { from: "e2", to: "e4" }), { kind: "advance" });
  const r = userMoveOnGame(START, 0, "e2e4", { from: "d2", to: "d4" });
  assert.equal(r.kind, "deviate");
  if (r.kind !== "deviate") return;
  assert.equal(r.deviation.kind, "user");
  assert.equal(r.deviation.basePly, 0);
  assert.deepEqual(r.deviation.san, ["d4"]);
  assert.equal(bannerText(r.deviation, ""), "Off game · 1 move from the start");
  assert.deepEqual(userMoveOnGame(START, 0, "e2e4", { from: "e2", to: "e5" }), { kind: "illegal" });
});

test("engine line preview is blue; a different user move turns it amber and truncates", () => {
  const line = { startFen: START, uci: ["e2e4", "e7e5", "g1f3", "b8c6"], san: ["e4", "e5", "Nf3", "Nc6"] };
  let d = startEngineLine(3, line, "Engine's best instead of 2. Nf3");
  assert.equal(d.kind, "engine");
  assert.equal(d.step, 1);
  assert.equal(bannerText(d, "x"), "Engine's best instead of 2. Nf3 · 1/4");
  // playing the line's own next move just steps forward, still blue
  d = userMoveInDeviation(d, { from: "e7", to: "e5" })!;
  assert.equal(d.kind, "engine");
  assert.equal(d.step, 2);
  // step back and play something else: rest of the line is replaced
  d = stepDeviation(d, 1);
  d = userMoveInDeviation(d, { from: "c7", to: "c5" })!;
  assert.equal(d.kind, "user");
  assert.deepEqual(d.san, ["e4", "c5"]);
  assert.equal(d.step, 2);
  assert.equal(d.basePly, 3); // resume target unchanged
  assert.equal(bannerText(d, "2. Nf3"), "Off game · 2 moves from 2. Nf3");
  assert.equal(deviationFen(d), "rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2");
  assert.equal(userMoveInDeviation(d, { from: "e1", to: "e3" }), null);
});

test("Preview from a deviation continues with the engine line on the same board (blue)", () => {
  const r = userMoveOnGame(START, 0, "e2e4", { from: "d2", to: "d4" });
  if (r.kind !== "deviate") throw new Error();
  const d = continueWithEngine(r.deviation, ["d7d5", "c2c4"], "Engine line from 1. d4");
  assert.equal(d.kind, "engine");
  assert.deepEqual(d.san, ["d4", "d5", "c4"]);
  assert.equal(d.step, 2);
  assert.equal(d.basePly, 0);
  assert.equal(stepDeviation(d, 99).step, 3);
  assert.equal(stepDeviation(d, -1).step, 0);
  assert.equal(deviationFen(stepDeviation(d, 0)), START);
});
