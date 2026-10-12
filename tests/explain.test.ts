import { test } from "node:test";
import assert from "node:assert/strict";
import { Chess } from "chess.js";
import { explainMove, getExplanationRenderer, pick, type ExplainInput } from "../src/lib/explain";
import { formatEval, type Eval, type LineInfo } from "../src/lib/analysis";
import { forkFrom, hangingPieces, lineTacticsFrom, materialSwing } from "../src/lib/tactics";
import type { Classification } from "../src/lib/classify";

function input(fen: string, uci: string, o: { cls: Classification; before: Eval; after: Eval; cont?: string[]; best?: string[]; winLoss?: number; opening?: string }): ExplainInput {
  const c = new Chess(fen);
  const m = c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
  const line = (start: string, u: string[], ev: Eval, rank = 1): LineInfo => {
    const b = new Chess(start);
    return { rank, eval: ev, uci: u, san: u.map((x) => b.move({ from: x.slice(0, 2), to: x.slice(2, 4), promotion: x[4] }).san), startFen: start };
  };
  return {
    ply: 7,
    san: m.san,
    uci,
    color: m.color === "w" ? "white" : "black",
    classification: o.cls,
    fenBefore: fen,
    fenAfter: c.fen(),
    evalBefore: o.before,
    evalAfter: o.after,
    winLoss: o.winLoss ?? 0,
    isBest: !o.best,
    lines: [line(fen, o.best ?? [uci], o.before)],
    continuation: o.cont ? line(c.fen(), o.cont, o.after) : null,
    sacrifice: 0,
    opening: o.opening ?? null,
    previous: null,
    formatEval,
  };
}
const cp = (v: number): Eval => ({ cp: v, mate: null });

test("tactics: hanging piece, fork, pin, skewer, material swing", () => {
  // Black knight on e5 attacked by a white pawn on d4.
  assert.equal(hangingPieces("4k3/8/8/4n3/3P4/8/8/4K3 b - - 0 1", "b")[0]?.square, "e5");
  // Knight on c7 forks king e8 and rook a8.
  const fork = forkFrom("r3k3/2N5/8/8/8/8/8/4K3 b - - 0 1", "c7");
  assert.ok(fork && fork.targets.map((t) => t.type).includes("k") && fork.targets.map((t) => t.type).includes("r"));
  // Bishop b5 pins knight c6 to king e8.
  assert.equal(lineTacticsFrom("4k3/8/2n5/1B6/8/8/8/4K3 b - - 0 1", "b5")[0]?.kind, "pin");
  // Rook e1 skewers king e5 and queen e8.
  assert.equal(lineTacticsFrom("4q3/8/8/4k3/8/8/8/K3R3 b - - 0 1", "e1")[0]?.kind, "skewer");
  // Winning a free knight: +3
  assert.equal(materialSwing("4k3/8/8/4n3/3P4/8/8/4K3 w - - 0 1", ["d4e5"], "w"), 3);
});

test("explains a hanging piece blunder", () => {
  const e = explainMove(input("4k3/8/3p4/8/8/5N2/8/4K3 w - - 0 1", "f3e5", { cls: "Blunder", before: cp(300), after: cp(0), cont: ["d6e5"], best: ["f3d4"], winLoss: 40 }));
  assert.match(e.headline, /knight on e5/);
  assert.match(e.headline, /hanging|drops|unprotected/);
  assert.ok(e.details.some((d) => d.startsWith("Better was Nd4")));
});

test("explains a fork by the played move", () => {
  const e = explainMove(input("r3k3/8/8/1N6/8/8/8/4K3 w - - 0 1", "b5c7", { cls: "Best", before: cp(500), after: cp(500), cont: ["e8d7", "c7a8"] }));
  assert.match(e.headline, /fork/i);
  assert.match(e.headline, /king and the rook/);
});

test("explains allowing mate", () => {
  const e = explainMove(input("3r2k1/5ppp/8/8/8/8/P4PPP/6K1 w - - 0 1", "a2a3", { cls: "Blunder", before: cp(-500), after: { cp: null, mate: -1 }, cont: ["d8d1"], best: ["h2h3"], winLoss: 30 }));
  assert.match(e.headline, /mate in 1/);
});

test("book move mentions the opening; captures and castling are described", () => {
  const b = explainMove(input("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", "e2e4", { cls: "Book", before: cp(30), after: cp(30), opening: "King's Pawn Game" }));
  assert.match(b.headline, /King's Pawn Game/);
  const castle = explainMove(input("4k3/8/8/8/8/8/8/4K2R w K - 0 1", "e1g1", { cls: "Best", before: cp(500), after: cp(500) }));
  assert.match(castle.headline, /castles kingside|king to safety/);
  const cap = explainMove(input("4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1", "e4d5", { cls: "Best", before: cp(0), after: cp(100), cont: ["e8d7"] }));
  assert.ok(cap.facts.some((f) => f.kind === "capture"));
});

test("templates vary deterministically", () => {
  const opts = ["a", "b", "c"];
  const seen = new Set([1, 2, 3, 4, 5, 6].map((s) => pick(opts, s)));
  assert.ok(seen.size >= 2);
  assert.equal(pick(opts, 4), pick(opts, 4));
});

test("LLM wording layer is off by default", () => {
  assert.equal(getExplanationRenderer().id, "rules");
});
