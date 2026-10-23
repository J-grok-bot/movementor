// Test helper: print a legal move that is NOT the solution move (and not mate) for a puzzle position.
// usage: node scripts/puzzle-helper.mjs "<fen>" <solutionUci>
import { Chess } from "chess.js";
const [fen, sol] = process.argv.slice(2);
const c = new Chess(fen);
for (const m of c.moves({ verbose: true })) {
  const u = m.from + m.to + (m.promotion ?? "");
  if (u === sol || m.promotion) continue;
  const d = new Chess(fen);
  d.move(m);
  if (!d.isCheckmate()) {
    console.log(u);
    break;
  }
}
