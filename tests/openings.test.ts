import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { continuations, findLine, lineSteps, normalize, openingAt, playSans, searchOpenings, type OpeningTree } from "../src/lib/openings";
import type { OpeningBook } from "../src/lib/openingBook";

const tree: OpeningTree = JSON.parse(readFileSync("public/opening-tree.json", "utf8"));
const book: OpeningBook = JSON.parse(readFileSync("public/openings.json", "utf8"));

test("opening lookup by position: deepest named position, transpositions included", () => {
  const london = openingAt(book, playSans(["d4", "d5", "Nf3", "Nf6", "Bf4"]).fens);
  assert.equal(london?.name, "Queen's Pawn Game: London System");
  assert.match(london!.eco, /^[A-E]\d\d$/);
  // Same position via a different move order (Nf3 first) still finds a book name.
  const a = openingAt(book, playSans(["e4", "c5", "Nf3", "d6", "d4", "cxd4", "Nxd4", "Nf6", "Nc3", "a6"]).fens);
  assert.match(a!.name, /Najdorf/);
  const b = openingAt(book, playSans(["Nf3", "d6", "e4", "c5", "d4", "cxd4", "Nxd4", "Nf6", "Nc3", "a6"]).fens);
  assert.equal(b?.name, a?.name);
  // Out-of-book moves keep the last named position.
  const c = openingAt(book, playSans(["e4", "e5", "Nf3", "Nc6", "Bb5", "h5", "h3"]).fens);
  assert.match(c!.name, /Ruy Lopez/);
});

test("book continuations name where they lead", () => {
  const start = continuations(tree, book, playSans([]).fens[0]);
  const sans = start.map((c) => c.san);
  for (const m of ["e4", "d4", "c4", "Nf3"]) assert.ok(sans.includes(m), m);
  const afterE4 = continuations(tree, book, playSans(["e4"]).fens[1]);
  const c5 = afterE4.find((c) => c.san === "c5");
  assert.equal(c5?.name, "Sicilian Defense");
  assert.ok(c5?.exact);
});

test("fuzzy search over opening names", () => {
  const najdorf = searchOpenings(tree, "sicilian najdorf");
  assert.match(najdorf[0].name, /^Sicilian Defense: Najdorf Variation/);
  const london = searchOpenings(tree, "london");
  assert.ok(london.slice(0, 5).some((r) => /London System/.test(r.name)));
  assert.match(searchOpenings(tree, "sicillian dragon")[0].name, /Sicilian Defense: Dragon/); // typo
  assert.match(searchOpenings(tree, "queens gambit declined")[0].name, /Queen's Gambit Declined/);
  assert.equal(searchOpenings(tree, "C42")[0].eco, "C42");
  assert.deepEqual(searchOpenings(tree, "zzzz"), []);
  assert.equal(normalize("Grünfeld Defense"), "grunfeld defense");
});

test("walkthrough steps carry intermediate names", () => {
  const i = findLine(tree, "Queen's Pawn Game: London System");
  assert.ok(i >= 0);
  const steps = lineSteps(tree, book, i);
  assert.deepEqual(steps.map((s) => s.san).slice(0, 3), lineSteps(tree, book, i).map((s) => s.san).slice(0, 3));
  const names = steps.map((s) => s.name?.name).filter(Boolean);
  assert.ok(names.includes("Queen's Pawn Game"));
  assert.equal(names.at(-1), "Queen's Pawn Game: London System");
});
