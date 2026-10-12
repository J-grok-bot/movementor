// Builds public/openings.json from the lichess-org/chess-openings TSVs (CC0, public domain)
// in ./data. Every position reached along a named opening line counts as "book"; positions at the
// end of a line carry the ECO code + name.
//   node scripts/build-openings.mjs
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { Chess } from "chess.js";

const epd = (fen) => fen.split(" ").slice(0, 4).join(" ");
const book = {}; // epd -> [eco, name] | 0
let lines = 0;
for (const f of ["a", "b", "c", "d", "e"]) {
  const rows = readFileSync(`data/${f}.tsv`, "utf8").trim().split("\n").slice(1);
  for (const row of rows) {
    const [eco, name, pgn] = row.split("\t");
    const c = new Chess();
    const sans = pgn.replace(/\d+\.(\.\.)?/g, " ").trim().split(/\s+/);
    for (const san of sans) {
      c.move(san);
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
console.log(`${lines} opening lines -> ${Object.keys(book).length} book positions`);
