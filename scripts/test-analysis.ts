/**
 * Headless end-to-end test: fetch a real game from Chess.com, run the same analysis
 * code the browser uses with the same Stockfish lite single-threaded WASM build (in Node),
 * and print per-move classifications + summary.
 *
 *   npm run test:analysis -- [username] [gameIndex] [depth]
 */
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import type { OpeningBook } from "../src/lib/openingBook";
import { analyzePgn, formatEval, numberedLine, UciSearchParser, type EngineResult, type LineInfo } from "../src/lib/analysis";
import { fetchRecentGames } from "../src/lib/chesscom";

const require = createRequire(import.meta.url);

type NodeEngine = { processCommand: (cmd: string) => void; terminate: () => void };

function createNodeEvaluator() {
  const parser = new UciSearchParser();
  let pending: ((r: EngineResult) => void) | null = null;
  let readyResolve: (() => void) | null = null;
  const engine: NodeEngine = require("stockfish")("lite-single", (line: string) => {
    if (line === "readyok" && readyResolve) {
      readyResolve();
      readyResolve = null;
      return;
    }
    const r = parser.feed(line);
    if (r && pending) {
      const p = pending;
      pending = null;
      p(r);
    }
  });
  const ready = () => new Promise<void>((res) => { readyResolve = res; engine.processCommand("isready"); });
  return {
    async init() {
      engine.processCommand("uci");
      engine.processCommand("setoption name MultiPV value 2");
      engine.processCommand("ucinewgame");
      await ready();
    },
    evaluate: (fen: string, depth: number) =>
      new Promise<EngineResult>((res) => {
        pending = res;
        engine.processCommand(`position fen ${fen}`);
        engine.processCommand(`go depth ${depth}`);
      }),
    terminate: () => engine.terminate(),
  };
}

async function main() {
  const [username = "Killer5291", idx = "0", depthArg = "12"] = process.argv.slice(2);
  const games = await fetchRecentGames(username, { limit: 20 });
  console.log(`Fetched ${games.length} recent games for ${username}`);
  const g = games[Number(idx)];
  if (!g) throw new Error("No game at that index");
  console.log(
    `\nGame: ${g.white.username} (${g.white.rating}) vs ${g.black.username} (${g.black.rating}) | ` +
      `${g.timeClass} ${g.timeControl} | ${new Date(g.endTime * 1000).toISOString()} | ` +
      `${username} played ${g.userColor}, result: ${g.outcome} (${g.resultDetail})\n${g.url}\nOpening: ${g.opening}\n`,
  );
  const eng = createNodeEvaluator();
  await eng.init();
  const t0 = Date.now();
  const book = JSON.parse(readFileSync("public/openings.json", "utf8")) as OpeningBook;
  const a = await analyzePgn(g.pgn, eng.evaluate, { depth: Number(depthArg), multiPv: 2, book });
  eng.terminate();
  console.log(`Opening (book): ${a.opening ? a.opening.eco + " " + a.opening.name : "-"}`);
  console.log(`Analyzed ${a.moves.length} plies at depth ${a.depth} in ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);
  for (const m of a.moves) {
    const tag = !["Best", "Good", "Excellent", "Book"].includes(m.classification);
    const best = tag && m.bestMoveSan ? ` (best: ${m.bestMoveSan})` : "";
    console.log(
      `${String(m.moveNumber).padStart(3)}${m.color === "white" ? "." : "..."} ${m.san.padEnd(8)} ` +
        `${formatEval(m.evalBefore).padStart(6)} -> ${formatEval(m.evalAfter).padStart(6)}  ` +
        `win% loss ${m.winLoss.toFixed(1).padStart(5)}  ${m.classification}${tag ? best + "  <--" : ""}${m.note ? " [" + m.note + "]" : ""}`,
    );
    const fmt = (l?: LineInfo) =>
      l ? `${formatEval(l.eval).padStart(6)}  ${numberedLine(l.startFen, l.san).map((t) => (t.label ? t.label + " " : "") + t.san).join(" ")}` : "-";
    console.log(`        coach: ${m.explanation.headline}${m.explanation.details.length ? " | " + m.explanation.details.join(" ") : ""}`);
    if (process.env.SHOW_LINES) {
      console.log(`        top line: ${fmt(m.lines[0])}`);
      console.log(`        2nd line: ${fmt(m.lines[1])}`);
    }
  }
  for (const side of ["white", "black"] as const) {
    const s = a[side];
    console.log(
      `\n${side.toUpperCase()} ${g[side].username}: accuracy ${s.accuracy.toFixed(1)}%, ACPL ${s.acpl.toFixed(0)}, ` +
        Object.entries(s.counts).filter(([, n]) => n).map(([k, n]) => `${k} ${n}`).join(", "),
    );
  }
  // Sanity assertions
  if (a.moves.length !== g.pgn.match(/\d+\.\s/g)?.length && a.moves.length === 0) throw new Error("no moves analysed");
  const bad = a.moves.filter((m) => !Number.isFinite(m.winLoss) || m.accuracy < 0 || m.accuracy > 100);
  if (bad.length) throw new Error(`Invalid numbers on ${bad.length} moves`);
  const engineMoves = a.moves.filter((m) => m.bestMoveUci);
  const noLine = engineMoves.filter((m) => !m.lines[0] || m.lines[0].san.length === 0 || m.lines[0].uci[0] !== m.bestMoveUci);
  if (noLine.length) throw new Error(`${noLine.length} moves missing a top engine line`);
  const with2 = engineMoves.filter((m) => m.lines[1]?.san.length).length;
  const avgLen = engineMoves.reduce((n, m) => n + m.lines[0].san.length, 0) / engineMoves.length;
  console.log(`Top line present on ${engineMoves.length}/${a.moves.length} moves (avg PV length ${avgLen.toFixed(1)} plies); 2nd line on ${with2}`);
  console.log("\nOK: analysis pipeline sanity checks passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
