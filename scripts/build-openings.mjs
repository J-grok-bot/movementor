// Builds public/openings.json from the lichess-org/chess-openings TSVs (CC0, public domain)
// in ./data. Every position reached along a named opening line counts as "book"; positions at the
// end of a line carry the ECO code + name.
//   node scripts/build-openings.mjs
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { Chess } from "chess.js";

const epd = (fen) => fen.split(" ").slice(0, 4).join(" ");
const book = {}; // epd -> [eco, name] | 0
let lines = 0;
// For the Openings page: every line as [eco, name, "san san …"], and for every book position the book
// moves out of it: epd -> [[san, index of the most general (shortest-named) line through the child], …].
const all = [];
const next = {};
for (const f of ["a", "b", "c", "d", "e"]) {
  const rows = readFileSync(`data/${f}.tsv`, "utf8").trim().split("\n").slice(1);
  for (const row of rows) {
    const [eco, name, pgn] = row.split("\t");
    const c = new Chess();
    const sans = pgn.replace(/\d+\.(\.\.)?/g, " ").trim().split(/\s+/);
    const idx = all.length;
    all.push([eco, name, sans.join(" ")]);
    for (const san of sans) {
      const from = epd(c.fen());
      c.move(san);
      const kids = (next[from] ??= []);
      const kid = kids.find((k) => k[0] === san);
      if (!kid) kids.push([san, idx]);
      else if (all[kid[1]][1].length > name.length) kid[1] = idx;
      const k = epd(c.fen());
      if (!(k in book)) book[k] = 0;
    }
    const k = epd(c.fen());
    const prev = book[k];
    // Prefer the shortest (most general) name for a transposed position.
    if (!prev || prev[1].length > name.length) book[k] = [eco, name];
    lines++;
  }
}
mkdirSync("public", { recursive: true });
writeFileSync("public/openings.json", JSON.stringify(book));
writeFileSync("public/opening-tree.json", JSON.stringify({ lines: all, next }));
console.log(`${lines} opening lines -> ${Object.keys(book).length} book positions`);
