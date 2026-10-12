// Opening explorer helpers (pure; used by /openings and unit tests).
// Data: public/opening-tree.json built by scripts/build-openings.mjs from lichess-org/chess-openings (CC0).
import { Chess } from "chess.js";
import { bookLookup, epd, type OpeningBook } from "./openingBook";

export interface OpeningTree {
  /** [eco, name, "e4 c5 Nf3 …"] */
  lines: [string, string, string][];
  /** epd -> [[san, index of the most general line through the resulting position], …] */
  next: Record<string, [string, number][]>;
}

export interface OpeningName {
  eco: string;
  name: string;
}

export const START_FEN =
  "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

export function lineMoves(tree: OpeningTree, index: number): string[] {
  return tree.lines[index][2].split(" ");
}

/** Plays SAN moves from the start; stops at the first illegal move. */
export function playSans(
  sans: string[],
  startFen = START_FEN,
): { fens: string[]; sans: string[]; uci: string[] } {
  const c = new Chess(startFen);
  const fens = [c.fen()];
  const ok: string[] = [];
  const uci: string[] = [];
  for (const s of sans) {
    try {
      const m = c.move(s);
      ok.push(m.san);
      uci.push(m.from + m.to + (m.promotion ?? ""));
      fens.push(c.fen());
    } catch {
      break;
    }
  }
  return { fens, sans: ok, uci };
}

/** Deepest named book position along the game so far (matched by position, so transpositions work). */
export function openingAt(
  book: OpeningBook,
  fens: string[],
): (OpeningName & { ply: number }) | null {
  for (let i = fens.length - 1; i >= 0; i--) {
    const v = bookLookup(book, fens[i]);
    if (v && v !== true) return { ...v, ply: i };
  }
  return null;
}

/** Whether the current position is still in the book. */
export function inBook(book: OpeningBook, fen: string): boolean {
  return bookLookup(book, fen) !== null || fen === START_FEN;
}

export interface Continuation extends OpeningName {
  san: string;
  /** true when the resulting position itself carries this name; false = the most general line through it */
  exact: boolean;
  lineIndex: number;
}

/** Book moves from a position, each with the opening it leads to. Popular-first order of the source data. */
export function continuations(
  tree: OpeningTree,
  book: OpeningBook,
  fen: string,
): Continuation[] {
  const kids = tree.next[epd(fen)] ?? [];
  return kids.map(([san, idx]) => {
    const c = new Chess(fen);
    c.move(san);
    const v = bookLookup(book, c.fen());
    const [eco, name] =
      v && v !== true
        ? [v.eco, v.name]
        : [tree.lines[idx][0], tree.lines[idx][1]];
    return { san, eco, name, exact: !!v && v !== true, lineIndex: idx };
  });
}

/** Steps of a named line: the position after every move and the name of that position (if it has one). */
export function lineSteps(tree: OpeningTree, book: OpeningBook, index: number) {
  const { fens, sans, uci } = playSans(lineMoves(tree, index));
  return sans.map((san, i) => {
    const v = bookLookup(book, fens[i + 1]);
    return {
      san,
      uci: uci[i],
      fen: fens[i + 1],
      name: v && v !== true ? v : null,
    };
  });
}

export function findLine(tree: OpeningTree, name: string): number {
  const n = normalize(name);
  return tree.lines.findIndex((l) => normalize(l[1]) === n);
}

// ---------- fuzzy search ----------

export function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/'s\b/g, "s")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function lev1(a: string, b: string): boolean {
  // edit distance <= 1
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0,
    j = 0,
    edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else {
      i++;
      j++;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

function tokenScore(t: string, words: string[], eco: string): number {
  if (t === eco) return 5;
  let best = 0;
  for (const w of words) {
    let s = 0;
    if (w === t) s = 4;
    else if (w.startsWith(t)) s = 3;
    else if (t.length >= 3 && w.includes(t)) s = 2;
    else if (t.length >= 4 && (lev1(t, w) || lev1(t, w.slice(0, t.length))))
      s = 1.5;
    if (s > best) best = s;
  }
  return best;
}

export interface SearchResult extends OpeningName {
  index: number;
  moves: string[];
  score: number;
}

/** Fuzzy name search: every query word must match a name word (exact, prefix, substring or one typo) or the ECO code. */
export function searchOpenings(
  tree: OpeningTree,
  query: string,
  limit = 30,
): SearchResult[] {
  const tokens = normalize(query).split(" ").filter(Boolean);
  if (!tokens.length) return [];
  const out: SearchResult[] = [];
  tree.lines.forEach(([eco, name, moves], index) => {
    const words = normalize(name).split(" ");
    let score = 0;
    for (const t of tokens) {
      const s = tokenScore(t, words, eco.toLowerCase());
      if (!s) return;
      score += s;
    }
    // Prefer general lines (shorter names / fewer moves) and names that start with the query.
    if (normalize(name).startsWith(tokens[0])) score += 1;
    // …and lines where a query word is the variation's head word ("Dragon" in "Sicilian Defense: Dragon Variation").
    const head = normalize(name.split(":")[1] ?? "").split(" ")[0];
    if (
      head &&
      tokens.some((t) => head === t || (t.length >= 4 && head.startsWith(t)))
    )
      score += 1;
    score -= words.length * 0.15 + moves.split(" ").length * 0.02;
    out.push({ index, eco, name, moves: moves.split(" "), score });
  });
  return out
    .sort((a, b) => b.score - a.score || a.name.length - b.name.length)
    .slice(0, limit);
}

let treeP: Promise<OpeningTree> | null = null;
/** Browser: lazily fetch /opening-tree.json once (~830 KB, ~120 KB gzipped). */
export function loadOpeningTree(
  url = "/opening-tree.json",
): Promise<OpeningTree> {
  if (!treeP)
    treeP = fetch(url).then((r) => (r.ok ? r.json() : { lines: [], next: {} }));
  return treeP;
}
