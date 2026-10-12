import { test } from "node:test";
import assert from "node:assert/strict";
import { applyUserMove, legalMove, needsPromotion, uciLineToSan } from "../src/lib/sandbox";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const line = { startFen: START, uci: ["e2e4", "e7e5", "g1f3"], san: ["e4", "e5", "Nf3"] };

test("playing the line's own next move just advances", () => {
  assert.deepEqual(applyUserMove(line, 1, { from: "e7", to: "e5" }), { kind: "advance", step: 2 });
});

test("a different move branches into a sandbox line truncated at that point", () => {
  const r = applyUserMove(line, 1, { from: "c7", to: "c5" });
  assert.equal(r.kind, "branch");
  if (r.kind !== "branch") return;
  assert.deepEqual(r.line.san, ["e4", "c5"]);
  assert.deepEqual(r.line.uci, ["e2e4", "c7c5"]);
  assert.equal(r.step, 2);
  // keep going from the sandbox
  const r2 = applyUserMove(r.line, 2, { from: "g1", to: "f3" });
  assert.equal(r2.kind, "branch");
  if (r2.kind === "branch") assert.deepEqual(r2.line.san, ["e4", "c5", "Nf3"]);
});

test("illegal moves are rejected", () => {
  assert.deepEqual(applyUserMove(line, 0, { from: "e2", to: "e5" }), { kind: "illegal" });
  assert.equal(legalMove(START, { from: "e1", to: "e2" }), null);
});

test("promotion needs a choice and respects it", () => {
  const fen = "8/4P1k1/8/8/8/8/6K1/8 w - - 0 1";
  assert.ok(needsPromotion(fen, "e7", "e8"));
  assert.ok(!needsPromotion(START, "e2", "e4"));
  const r = applyUserMove({ startFen: fen, uci: [], san: [] }, 0, { from: "e7", to: "e8", promotion: "n" });
  assert.equal(r.kind, "branch");
  if (r.kind === "branch") {
    assert.equal(r.line.san[0], "e8=N+");
    assert.equal(r.line.uci[0], "e7e8n");
  }
});

test("engine PV in UCI converts to SAN", () => {
  assert.deepEqual(uciLineToSan(START, ["e2e4", "e7e5", "zzzz"]), ["e4", "e5"]);
});
