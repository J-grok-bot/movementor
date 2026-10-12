// Rule-based "coach" explanations. No AI: facts are detected with chess.js + engine lines, then
// rendered with varied templates. A pluggable renderer interface allows an optional LLM wording
// layer later (off by default; see getExplanationRenderer).
import { Chess, type Color, type PieceSymbol, type Square } from "chess.js";
import type { Classification } from "./classify";
import type { Eval, LineInfo } from "./analysis";
import {
  NAME,
  VALUE,
  board,
  colorName,
  forkFrom,
  hangingPieces,
  lineTacticsFrom,
  materialBalance,
  materialSwing,
  opp,
  playUci,
} from "./tactics";

export type Fact =
  | { kind: "book"; opening: string | null }
  | { kind: "capture"; piece: PieceSymbol; captured: PieceSymbol; square: Square; recapture: boolean }
  | { kind: "check" }
  | { kind: "checkmate" }
  | { kind: "castle"; side: "kingside" | "queenside" }
  | { kind: "promotion"; to: PieceSymbol }
  | { kind: "materialWon"; amount: number; line: "played" | "best" }
  | { kind: "materialLost"; amount: number; reply: string | null }
  | { kind: "hangs"; piece: PieceSymbol; square: Square; reply: string | null }
  | { kind: "fork"; by: "played" | "best" | "reply"; san: string; piece: PieceSymbol; targets: PieceSymbol[] }
  | ({ kind: "pin" } & LineTacticFact)
  | ({ kind: "skewer" } & LineTacticFact)
  | { kind: "mateAllowed"; n: number; reply: string | null }
  | { kind: "mateMissed"; n: number; best: string | null }
  | { kind: "mateThreat"; n: number }
  | { kind: "tradeWhenAhead"; piece: PieceSymbol; ahead: number }
  | { kind: "sacrifice"; amount: number }
  | { kind: "onlyMove"; gap: number; second: string | null }
  | { kind: "missedPunish"; opponentMove: string; gain: number; best: string | null }
  | { kind: "bestAlternative"; san: string; eval: string };

interface LineTacticFact {
  by: "played" | "best" | "reply";
  san: string;
  piece: PieceSymbol;
  front: PieceSymbol;
  back: PieceSymbol;
}

/**
 * Which engine line a sentence talks about, so the UI can offer a preview:
 * "best" = engine's top line from the position before the move, "second" = its 2nd line,
 * "reply" = the engine's line after the played move (starts with the opponent's reply).
 */
export type LineRef = "best" | "second" | "reply";

export interface Explanation {
  headline: string;
  details: string[];
  /** Optional line references: headlineRef for the headline, detailRefs[i] for details[i]. */
  headlineRef?: LineRef | null;
  detailRefs?: (LineRef | null)[];
  facts: Fact[];
}

export interface ExplainInput {
  ply: number;
  san: string;
  uci: string;
  color: "white" | "black";
  classification: Classification;
  fenBefore: string;
  fenAfter: string;
  evalBefore: Eval;
  evalAfter: Eval;
  winLoss: number;
  isBest: boolean;
  lines: LineInfo[]; // engine lines from fenBefore
  continuation: LineInfo | null; // engine line from fenAfter
  sacrifice: number;
  opening: string | null;
  previous: { san: string; classification: Classification; fenBefore: string; captured: boolean } | null;
  formatEval: (e: Eval) => string;
}

// ---------- wording helpers ----------

/** Deterministic template choice so the same move always gets the same wording. */
export function pick<T>(options: T[], seed: number): T {
  return options[Math.abs(seed * 2654435761) % options.length];
}

export function materialWords(amount: number): string {
  const a = Math.round(Math.abs(amount));
  if (a >= 9) return "the queen's worth of material";
  if (a >= 7) return "a rook and more";
  if (a >= 5) return "a rook's worth of material";
  if (a >= 3) return "a piece";
  if (a === 2) return "two pawns";
  return "a pawn";
}

const art = (w: string) => (/^[aeiou]/.test(w) ? `an ${w}` : `a ${w}`);
const list = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
const targetsText = (ts: PieceSymbol[]) => list(ts.map((t) => `the ${NAME[t]}`));

// ---------- fact detection ----------

function moverMateIn(e: Eval, mover: Color): number | null {
  if (e.mate === null || e.mate === 0) return null;
  const forMover = mover === "w" ? e.mate > 0 : e.mate < 0;
  return forMover ? Math.abs(e.mate) : null;
}
function opponentMateIn(e: Eval, mover: Color): number | null {
  if (e.mate === null || e.mate === 0) return null;
  const forOpp = mover === "w" ? e.mate < 0 : e.mate > 0;
  return forOpp ? Math.abs(e.mate) : null;
}

function tacticFacts(fen: string, uci: string, by: "played" | "best" | "reply"): Fact[] {
  const seq = playUci(fen, [uci]);
  if (!seq.length) return [];
  const { fen: after, to, san } = seq[0];
  const out: Fact[] = [];
  const fork = forkFrom(after, to);
  if (fork) out.push({ kind: "fork", by, san, piece: fork.piece, targets: fork.targets.map((t) => t.type) });
  for (const t of lineTacticsFrom(after, to)) {
    const f: LineTacticFact = { by, san, piece: t.piece, front: t.front.type, back: t.back.type };
    out.push(t.kind === "pin" ? { kind: "pin", ...f } : { kind: "skewer", ...f });
  }
  return out;
}

export function detectFacts(i: ExplainInput): Fact[] {
  const mover: Color = i.color === "white" ? "w" : "b";
  const facts: Fact[] = [];
  const c = new Chess(i.fenBefore);
  const m = c.move({ from: i.uci.slice(0, 2), to: i.uci.slice(2, 4), promotion: i.uci[4] });

  if (i.classification === "Book") facts.push({ kind: "book", opening: i.opening });
  if (c.isCheckmate()) facts.push({ kind: "checkmate" });
  else if (c.inCheck()) facts.push({ kind: "check" });
  if (m.isKingsideCastle()) facts.push({ kind: "castle", side: "kingside" });
  if (m.isQueensideCastle()) facts.push({ kind: "castle", side: "queenside" });
  if (m.promotion) facts.push({ kind: "promotion", to: m.promotion });
  const prevTo = i.previous ? playUci(i.previous.fenBefore, [lastMoveUci(i.previous.fenBefore, i.fenBefore)].filter(Boolean) as string[])[0]?.to : undefined;
  if (m.captured) facts.push({ kind: "capture", piece: m.piece, captured: m.captured, square: m.to, recapture: !!i.previous?.captured && prevTo === m.to });

  // Trading down when ahead
  const balanceBefore = materialBalance(board(i.fenBefore), mover);
  if (m.captured && m.captured === m.piece && VALUE[m.piece] >= 3 && balanceBefore >= 2) {
    facts.push({ kind: "tradeWhenAhead", piece: m.piece, ahead: balanceBefore });
  }

  // Mates
  const mateBefore = moverMateIn(i.evalBefore, mover);
  const mateAfter = moverMateIn(i.evalAfter, mover);
  const oppMateAfter = opponentMateIn(i.evalAfter, mover);
  const oppMateBefore = opponentMateIn(i.evalBefore, mover);
  const reply = i.continuation?.san[0] ?? null;
  const best = i.lines[0];
  if (oppMateAfter !== null && oppMateBefore === null) facts.push({ kind: "mateAllowed", n: oppMateAfter, reply });
  if (mateBefore !== null && mateAfter === null && !c.isCheckmate()) facts.push({ kind: "mateMissed", n: mateBefore, best: best?.san[0] ?? null });
  if (mateAfter !== null) facts.push({ kind: "mateThreat", n: mateAfter });

  // Tactics created by the played move
  facts.push(...tacticFacts(i.fenBefore, i.uci, "played"));

  // What the played move allows (opponent's best reply). Swings are measured at two horizons and the
  // more conservative one is used, so we only claim material changes that the engine line sustains.
  const playedLine = [i.uci, ...(i.continuation?.uci ?? [])];
  const s6 = materialSwing(i.fenBefore, playedLine, mover, 6);
  const s10 = materialSwing(i.fenBefore, playedLine, mover, 10);
  // If the opponent just captured, measure gains from before that capture (so a recapture isn't "winning" material).
  const recaptureAdj = i.previous?.captured
    ? Math.max(0, materialBalance(board(i.previous.fenBefore), mover) - balanceBefore)
    : 0;
  const playedGain = Math.min(s6, s10) - recaptureAdj;
  const playedSwing = Math.max(s6, s10);
  if (i.continuation?.uci[0]) {
    const replyUci = i.continuation.uci[0];
    const replyTo = replyUci.slice(2, 4) as Square;
    const hung = hangingPieces(i.fenAfter, mover).find((h) => h.square === replyTo);
    if (hung && playedSwing <= -Math.min(VALUE[hung.type], 3) + 0.5) facts.push({ kind: "hangs", piece: hung.type, square: hung.square, reply });
    if (i.winLoss >= 5) facts.push(...tacticFacts(i.fenAfter, replyUci, "reply"));
  }
  // Sanity check against the engine: only claim material changes the evaluation actually reflects.
  const moverPawns = (e: Eval) => (e.mate !== null ? (moverMateIn(e, mover) !== null ? 99 : e.mate === 0 && c.isCheckmate() ? 99 : -99) : ((e.cp ?? 0) / 100) * (mover === "w" ? 1 : -1));
  const evalAfterP = moverPawns(i.evalAfter);
  if (playedSwing <= -1 && !i.sacrifice && i.winLoss >= 5 && evalAfterP <= balanceBefore + playedSwing + 2) facts.push({ kind: "materialLost", amount: -playedSwing, reply });
  if (playedGain >= 1 && evalAfterP >= balanceBefore + playedGain - 2) facts.push({ kind: "materialWon", amount: playedGain, line: "played" });

  if (i.sacrifice >= 2) facts.push({ kind: "sacrifice", amount: i.sacrifice });

  // Engine's alternative
  if (best && !i.isBest && best.uci[0]) {
    facts.push({ kind: "bestAlternative", san: best.san[0], eval: i.formatEval(best.eval) });
    const bestSwing = Math.min(materialSwing(i.fenBefore, best.uci, mover, 6), materialSwing(i.fenBefore, best.uci, mover, 10));
    if (bestSwing >= 2 && i.winLoss >= 5 && moverPawns(best.eval) >= balanceBefore + bestSwing - 2) facts.push({ kind: "materialWon", amount: bestSwing, line: "best" });
    if (i.winLoss >= 5) facts.push(...tacticFacts(i.fenBefore, best.uci[0], "best"));
    if (i.classification === "Miss" && i.previous) {
      facts.push({ kind: "missedPunish", opponentMove: i.previous.san, gain: bestSwing, best: best.san[0] });
    }
  }
  if (i.classification === "Great" && i.lines[1]) {
    const mw = (l: LineInfo) => {
      const w = whiteWin(l.eval);
      return mover === "w" ? w : 100 - w;
    };
    facts.push({ kind: "onlyMove", gap: mw(i.lines[0]) - mw(i.lines[1]), second: i.lines[1].san[0] ?? null });
  }
  return facts;
}

function whiteWin(e: Eval): number {
  if (e.mate !== null) return e.mate === 0 ? (e.winner === "white" ? 100 : e.winner === "black" ? 0 : 50) : e.mate > 0 ? 100 : 0;
  const cp = Math.max(-1000, Math.min(1000, e.cp ?? 0));
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
}

/** Find the UCI of the single legal move leading from one FEN to the next (null if none). */
function lastMoveUci(fromFen: string, toFen: string): string | null {
  const c = new Chess(fromFen);
  const target = toFen.split(" ").slice(0, 4).join(" ");
  for (const m of c.moves({ verbose: true })) {
    c.move(m);
    const hit = c.fen().split(" ").slice(0, 4).join(" ") === target;
    c.undo();
    if (hit) return m.from + m.to + (m.promotion ?? "");
  }
  return null;
}

// ---------- rendering ----------

function find<K extends Fact["kind"]>(facts: Fact[], kind: K, pred?: (f: Extract<Fact, { kind: K }>) => boolean) {
  return facts.find((f) => f.kind === kind && (!pred || pred(f as Extract<Fact, { kind: K }>))) as Extract<Fact, { kind: K }> | undefined;
}

function tacticSentence(f: Extract<Fact, { kind: "fork" | "pin" | "skewer" }>): string {
  if (f.kind === "fork") return `${f.san} forks ${targetsText(f.targets)}`;
  if (f.kind === "pin") return `${f.san} pins the ${NAME[f.front]} to the ${NAME[f.back]}`;
  return `${f.san} skewers the ${NAME[f.front]}, winning the ${NAME[f.back]} behind it`;
}
/** "Ng3+, forking the king and the rook" (for "allows …" / "Better was …"). */
function tacticPhrase(f: Extract<Fact, { kind: "fork" | "pin" | "skewer" }>): string {
  if (f.kind === "fork") return `${f.san}, forking ${targetsText(f.targets)}`;
  if (f.kind === "pin") return `${f.san}, pinning the ${NAME[f.front]} to the ${NAME[f.back]}`;
  return `${f.san}, skewering the ${NAME[f.front]} to the ${NAME[f.back]}`;
}

export function renderRuleBased(i: ExplainInput, facts: Fact[]): Explanation {
  const s = i.ply;
  const side = colorName(i.color === "white" ? "w" : "b");
  const other = colorName(opp(i.color === "white" ? "w" : "b"));
  const details: string[] = [];
  const detailRefs: (LineRef | null)[] = [];
  const detail = (text: string, ref: LineRef | null = null) => {
    details.push(text);
    detailRefs.push(ref);
  };
  const san = i.san;
  let headline: string;
  let headlineRef: LineRef | null = null;

  const mate = find(facts, "checkmate");
  const book = find(facts, "book");
  const sac = find(facts, "sacrifice");
  const only = find(facts, "onlyMove");
  const fork = find(facts, "fork", (f) => f.by === "played");
  const lineTac = (find(facts, "pin", (f) => f.by === "played") ?? find(facts, "skewer", (f) => f.by === "played")) as
    | Extract<Fact, { kind: "pin" | "skewer" }>
    | undefined;
  const capture = find(facts, "capture");
  const wonPlayed = find(facts, "materialWon", (f) => f.line === "played");
  const wonBest = find(facts, "materialWon", (f) => f.line === "best");
  const lost = find(facts, "materialLost");
  const hangs = find(facts, "hangs");
  const replyTac = (find(facts, "fork", (f) => f.by === "reply") ??
    find(facts, "pin", (f) => f.by === "reply") ??
    find(facts, "skewer", (f) => f.by === "reply")) as Extract<Fact, { kind: "fork" | "pin" | "skewer" }> | undefined;
  const bestTac = (find(facts, "fork", (f) => f.by === "best") ??
    find(facts, "pin", (f) => f.by === "best") ??
    find(facts, "skewer", (f) => f.by === "best")) as Extract<Fact, { kind: "fork" | "pin" | "skewer" }> | undefined;
  const mateAllowed = find(facts, "mateAllowed");
  const mateMissed = find(facts, "mateMissed");
  const mateThreat = find(facts, "mateThreat");
  const alt = find(facts, "bestAlternative");
  const missed = find(facts, "missedPunish");
  const trade = find(facts, "tradeWhenAhead");
  const castle = find(facts, "castle");
  const promo = find(facts, "promotion");

  const goodMoveReason = (): string | null => {
    if (mate) return pick([`${san} is checkmate. Game over!`, `${san} delivers checkmate.`], s);
    if (mateThreat) return pick([`${san} keeps a forced mate in ${mateThreat.n} on the board.`, `${san} is on track for mate in ${mateThreat.n}.`], s);
    if (fork) return pick([`${tacticSentence(fork)}.`, `Nice fork: ${tacticSentence(fork)}.`, `${tacticSentence(fork)}, and both can't be saved.`], s);
    if (lineTac) return `${tacticSentence(lineTac)}.`;
    if (promo) return `${san} promotes to ${art(NAME[promo.to])}.`;
    if (wonPlayed && wonPlayed.amount >= 1)
      return pick(
        [`${san} wins ${materialWords(wonPlayed.amount)}.`, `${san} picks up ${materialWords(wonPlayed.amount)} by force.`, `After ${san}, ${side} comes out ${materialWords(wonPlayed.amount)} ahead.`],
        s,
      );
    if (trade) return pick([`${san} trades ${NAME[trade.piece]}s while ${trade.ahead} points up. Simplifying when ahead is exactly right.`, `Good technique: ${san} swaps off ${art(NAME[trade.piece])} with extra material on the board.`], s);
    if (castle) return pick([`${san} castles ${castle.side}, tucking the king away and connecting the rooks.`, `${san} gets the king to safety.`], s);
    if (capture && capture.recapture) return pick([`${san} recaptures the ${NAME[capture.captured]} on ${capture.square}.`, `${san} restores the material balance by taking back on ${capture.square}.`], s);
    if (capture) return pick([`${san} takes the ${NAME[capture.captured]} on ${capture.square}.`, `${san} captures the ${NAME[capture.captured]} on ${capture.square}.`], s);
    if (find(facts, "check")) return pick([`${san} gives check and keeps the initiative.`, `${san} is a useful check.`], s);
    return null;
  };

  switch (i.classification) {
    case "Book":
      headline = pick(
        [`${san} is a book move${book?.opening ? ` (${book.opening})` : ""}.`, `${san} is opening theory${book?.opening ? `: ${book.opening}` : ""}.`, `Still in the book with ${san}${book?.opening ? ` (${book.opening})` : ""}.`],
        s,
      );
      break;
    case "Brilliant":
      headline = pick(
        [
          `${san}!! Brilliant: ${side} gives up ${materialWords(sac?.amount ?? 3)} and the engine says it works.`,
          `${san}!! A sound sacrifice of ${materialWords(sac?.amount ?? 3)}: ${other} can't safely accept.`,
          `${san}!! is a brilliant sacrifice: ${materialWords(sac?.amount ?? 3)} invested for a winning position.`,
        ],
        s,
      );
      break;
    case "Great":
      headline = pick(
        [
          `${san}! is the only good move here.${only?.second ? ` The next best, ${only.second}, is much worse.` : ""}`,
          `${san}! Great find. Everything else ${only ? `throws away about ${Math.round(only.gap)}% of winning chances` : "is clearly worse"}.`,
          `${san}! is a critical move: ${side} had to find it.`,
        ],
        s,
      );
      break;
    case "Best":
      headline = goodMoveReason() ?? pick([`${san} is the engine's top choice.`, `${san} is the best move in the position.`, `Spot on: ${san} is exactly what the engine wanted.`], s);
      break;
    case "Excellent":
      headline = goodMoveReason() ?? pick([`${san} is an excellent move, practically as strong as the engine's pick.`, `${san} is nearly perfect.`], s);
      if (alt) detail(`The engine slightly preferred ${alt.san} (${alt.eval}).`, "best");
      break;
    case "Good":
      headline = goodMoveReason() ?? pick([`${san} is a reasonable move.`, `${san} is fine, though not the most precise.`, `${san} keeps things under control.`], s);
      if (alt) detail(`${alt.san} (${alt.eval}) was a bit stronger.`, "best");
      break;
    default: {
      // Inaccuracy, Mistake, Miss, Blunder: explain the main cause.
      if (i.classification === "Miss" && mateMissed) {
        headline = `${san} misses a forced mate in ${mateMissed.n}${mateMissed.best ? ` starting with ${mateMissed.best}` : ""}.`;
        if (mateMissed.best) headlineRef = "best";
      } else if (i.classification === "Miss" && missed) {
        if (missed.best) headlineRef = "best";
        headline = pick(
          [
            `${san} misses the chance to punish ${missed.opponentMove}.${missed.best && missed.gain >= 1 ? ` ${missed.best} would have won ${materialWords(missed.gain)}.` : missed.best ? ` ${missed.best} was the way.` : ""}`,
            `${other} slipped with ${missed.opponentMove}, but ${san} lets it go.${missed.best ? ` ${missed.best} was the punishment.` : ""}`,
          ],
          s,
        );
      } else if (mateAllowed) {
        headline = pick([`${san} allows mate in ${mateAllowed.n}${mateAllowed.reply ? ` after ${mateAllowed.reply}` : ""}.`, `${san} walks into a forced mate in ${mateAllowed.n}.`], s);
        headlineRef = "reply";
      } else if (mateMissed) {
        headline = `${san} lets a forced mate in ${mateMissed.n} slip away.`;
        headlineRef = "best";
      } else if (hangs && !(lost && lost.amount > VALUE[hangs.piece] + 0.5)) {
        if (hangs.reply) headlineRef = "reply";
        headline = pick(
          [`${san} leaves the ${NAME[hangs.piece]} on ${hangs.square} hanging${hangs.reply ? `: ${hangs.reply} just takes it` : ""}.`, `${san} drops the ${NAME[hangs.piece]} on ${hangs.square}.`, `After ${san}, the ${NAME[hangs.piece]} on ${hangs.square} is unprotected and can be taken.`],
          s,
        );
      } else if (replyTac) {
        headline = pick([`${san} allows ${tacticPhrase(replyTac)}.`, `${san} runs into ${tacticPhrase(replyTac)}.`], s);
        headlineRef = "reply";
      } else if (lost) {
        headline = pick([`${san} loses ${materialWords(lost.amount)}${lost.reply ? ` after ${lost.reply}` : ""}.`, `${san} gives away ${materialWords(lost.amount)}.`, `${san} costs ${materialWords(lost.amount)} in the engine's line.`], s);
        headlineRef = "reply";
      } else if (wonBest) {
        headline = pick([`${san} misses a chance to win ${materialWords(wonBest.amount)}.`, `${san} overlooks a way to win ${materialWords(wonBest.amount)}.`], s);
        headlineRef = "best";
      } else
        headline = pick(
          [`${san} lets the advantage slip (${i.formatEval(i.evalBefore)} → ${i.formatEval(i.evalAfter)}).`, `${san} worsens ${side}'s position (${i.formatEval(i.evalBefore)} → ${i.formatEval(i.evalAfter)}).`, `${san} is imprecise and hands ${other} the better chances (${i.formatEval(i.evalAfter)}).`],
          s,
        );
      if (alt) {
        let d = `Better was ${alt.san} (${alt.eval})`;
        if (bestTac) d += `: ${tacticSentence(bestTac).replace(/^\S+ /, "it ")}`;
        else if (wonBest && !headline.includes("win")) d += `, winning ${materialWords(wonBest.amount)}`;
        detail(`${d}.`, "best");
        // The headline's line is the same one: show the button on the "Better was …" sentence only.
        if (headlineRef === "best") headlineRef = null;
      }
      if (replyTac && !headline.includes(replyTac.san)) detail(`Watch out for ${tacticPhrase(replyTac)}.`, "reply");
      if (lost && hangs && !headline.includes("loses")) detail(`In the engine's line ${side} ends up ${materialWords(lost.amount)} down.`, headlineRef === "reply" ? null : "reply");
      if (capture && !headline.includes("takes")) detail(`Taking the ${NAME[capture.captured]} on ${capture.square} doesn't make up for it.`);
    }
  }
  if (i.classification === "Great" && only?.second && headline.includes(only.second)) headlineRef = "second";
  return { headline, details, facts, headlineRef, detailRefs };
}

export function explainMove(i: ExplainInput): Explanation {
  return renderRuleBased(i, detectFacts(i));
}

// ---------- optional wording layer (off by default) ----------

/**
 * Pluggable renderer: receives the structured facts plus the rule-based text and returns new wording.
 * An LLM-backed implementation could live here; it is NOT enabled by default and nothing ships with AI.
 */
export interface ExplanationRenderer {
  id: string;
  render(input: ExplainInput, ruleBased: Explanation): Promise<Explanation>;
}

export const ruleBasedRenderer: ExplanationRenderer = {
  id: "rules",
  render: async (_input, ruleBased) => ruleBased,
};

const renderers = new Map<string, ExplanationRenderer>([[ruleBasedRenderer.id, ruleBasedRenderer]]);

export function registerExplanationRenderer(r: ExplanationRenderer) {
  renderers.set(r.id, r);
}

/** Selected via NEXT_PUBLIC_EXPLANATION_RENDERER (default "rules"). Falls back to rules if not registered. */
export function getExplanationRenderer(): ExplanationRenderer {
  const id = process.env.NEXT_PUBLIC_EXPLANATION_RENDERER ?? "rules";
  return renderers.get(id) ?? ruleBasedRenderer;
}
