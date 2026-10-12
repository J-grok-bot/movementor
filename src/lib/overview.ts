// Game overview: phase accuracy, rough rating estimate, key moments and a rule-based summary.
import type { GameAnalysis, MoveAnalysis, Phase } from "./analysis";
import { formatEval, whiteWinPercent } from "./analysis";
import type { Classification } from "./classify";

export const PHASES: Phase[] = ["opening", "middlegame", "endgame"];
type Side = "white" | "black";

/** Mean per-move accuracy by phase (null if the player made no moves in that phase). */
export function phaseAccuracy(a: GameAnalysis, side: Side): Record<Phase, number | null> {
  const out = { opening: null, middlegame: null, endgame: null } as Record<Phase, number | null>;
  for (const p of PHASES) {
    const ms = a.moves.filter((m) => m.color === side && m.phase === p);
    if (ms.length) out[p] = ms.reduce((s, m) => s + m.accuracy, 0) / ms.length;
  }
  return out;
}

/**
 * A deliberately rough "played like" rating ESTIMATE from accuracy alone (piecewise-linear).
 * It's a motivational number, not a real rating: accuracy depends heavily on how sharp the game was.
 */
const RATING_CURVE: [number, number][] = [
  [30, 250],
  [45, 500],
  [55, 750],
  [65, 1100],
  [75, 1500],
  [82, 1850],
  [88, 2200],
  [93, 2500],
  [97, 2800],
];
export function estimateRating(accuracy: number): number {
  const c = RATING_CURVE;
  if (accuracy <= c[0][0]) return c[0][1];
  for (let i = 1; i < c.length; i++) {
    if (accuracy <= c[i][0]) {
      const [a0, r0] = c[i - 1];
      const [a1, r1] = c[i];
      return Math.round((r0 + ((accuracy - a0) / (a1 - a0)) * (r1 - r0)) / 25) * 25;
    }
  }
  return c[c.length - 1][1];
}

export interface KeyMoment {
  ply: number;
  move: MoveAnalysis;
  text: string;
  swing: number; // win% swing (absolute)
}

const KEY_CLASSES: Classification[] = ["Brilliant", "Great", "Miss", "Blunder", "Mistake"];

/** Up to `max` most important moments: brilliancies/great moves, then the biggest errors. */
export function keyMoments(a: GameAnalysis, max = 6): KeyMoment[] {
  const scored = a.moves
    .filter((m) => KEY_CLASSES.includes(m.classification))
    .map((m) => ({
      ply: m.ply,
      move: m,
      text: m.explanation.headline,
      swing: m.classification === "Brilliant" || m.classification === "Great" ? 100 : m.winLoss,
    }))
    .sort((x, y) => y.swing - x.swing)
    .slice(0, max);
  return scored.sort((x, y) => x.ply - y.ply);
}

function sideName(a: { white: { username: string }; black: { username: string } }, s: Side) {
  return a[s].username;
}

/** Short rule-based narrative of the game. */
export function summaryParagraph(
  a: GameAnalysis,
  game: { white: { username: string }; black: { username: string }; userColor: Side; outcome: "win" | "loss" | "draw"; resultDetail: string },
): string {
  const me = game.userColor;
  const them: Side = me === "white" ? "black" : "white";
  const parts: string[] = [];
  const myAcc = a[me].accuracy;
  const theirAcc = a[them].accuracy;
  if (a.opening) parts.push(`The game opened with the ${a.opening.name}.`);

  // Biggest turning point
  const biggest = [...a.moves].sort((x, y) => y.winLoss - x.winLoss)[0];
  if (biggest && biggest.winLoss >= 20) {
    const who = sideName(game, biggest.color);
    parts.push(
      `The biggest swing came on move ${biggest.moveNumber} when ${who} played ${biggest.san} (${formatEval(biggest.evalBefore)} → ${formatEval(biggest.evalAfter)}).`,
    );
  }

  // Lead changes
  let changes = 0;
  let prev = 0;
  for (const m of a.moves) {
    const w = whiteWinPercent(m.evalAfter);
    const state = w > 65 ? 1 : w < 35 ? -1 : 0;
    if (state !== 0 && prev !== 0 && state !== prev) changes++;
    if (state !== 0) prev = state;
  }
  if (changes >= 2) parts.push(`The advantage changed hands ${changes} times, so it was a real fight.`);
  else if (changes === 0 && Math.abs(whiteWinPercent(a.moves.at(-1)?.evalAfter ?? a.initialEval) - 50) > 30)
    parts.push(`One side took control and never gave it back.`);

  // Accuracy comparison
  const diff = myAcc - theirAcc;
  parts.push(
    Math.abs(diff) < 3
      ? `Both players were about equally accurate (${myAcc.toFixed(0)}% vs ${theirAcc.toFixed(0)}%).`
      : diff > 0
        ? `You were the more accurate player (${myAcc.toFixed(0)}% vs ${theirAcc.toFixed(0)}%).`
        : `Your opponent was more accurate (${theirAcc.toFixed(0)}% vs your ${myAcc.toFixed(0)}%).`,
  );

  // Phase strengths
  const ph = phaseAccuracy(a, me);
  const ranked = PHASES.filter((p) => ph[p] !== null).sort((x, y) => (ph[y] as number) - (ph[x] as number));
  if (ranked.length >= 2) parts.push(`Your strongest phase was the ${ranked[0]}; the ${ranked[ranked.length - 1]} is where to focus.`);

  const blunders = a[me].counts.Blunder;
  const misses = a[me].counts.Miss;
  if (blunders) parts.push(`You made ${blunders} blunder${blunders > 1 ? "s" : ""}${misses ? ` and ${misses} missed chance${misses > 1 ? "s" : ""}` : ""}; checking for hanging pieces and checks before each move would catch most of them.`);
  else if (misses) parts.push(`You missed ${misses} chance${misses > 1 ? "s" : ""} to punish mistakes; when your opponent slips, look for captures and checks first.`);
  else parts.push(`No blunders from you. Nice and clean.`);

  const res = game.outcome === "win" ? `You won (${game.resultDetail === "win" ? "win" : `opponent ${game.resultDetail}`}).` : game.outcome === "loss" ? `You lost (${game.resultDetail}).` : `The game was drawn (${game.resultDetail}).`;
  parts.push(res);
  return parts.join(" ");
}
