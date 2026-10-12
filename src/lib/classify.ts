// Pure move classifier. All inputs are precomputed by the analysis pipeline so this is easy to unit test.

export const CLASSIFICATIONS = [
  "Brilliant",
  "Great",
  "Best",
  "Excellent",
  "Good",
  "Book",
  "Inaccuracy",
  "Mistake",
  "Miss",
  "Blunder",
] as const;
export type Classification = (typeof CLASSIFICATIONS)[number];

// Thresholds in win-percentage points lost (same spirit as Lichess).
export const THRESHOLDS = {
  excellent: 2, // < 2 lost  -> Excellent
  inaccuracy: 10, // >= 10   -> Inaccuracy
  mistake: 20, // >= 20      -> Mistake
  blunder: 30, // >= 30      -> Blunder
  greatGap: 15, // best line must be >= 15 win% better than the 2nd-best line for "Great"
  sacrifice: 2, // >= 2 pawns of material given up for "Brilliant"
  missGain: 2, // the missed line had to win >= 2 pawns (or mate) for "Miss"
};

export interface ClassifyInput {
  inBook: boolean;
  isBest: boolean; // played move == engine's top move
  winLoss: number; // mover's win% lost vs. best (>= 0)
  winBefore: number; // mover's win% before the move (engine best play)
  winAfter: number; // mover's win% after the played move
  sacrifice: number; // pawns of material deliberately given up (0 if none)
  secondBestGap: number | null; // mover's win%(best line) - win%(2nd line); null if no 2nd line
  isRecapture: boolean;
  opponentErred: boolean; // opponent's previous move lost >= inaccuracy threshold
  bestGain: number; // material (pawns) the best line wins for the mover
  bestMates: boolean; // best line is a forced mate for the mover
  hadMate: boolean; // mover had a forced mate before the move
  keepsMate: boolean; // mover still has a forced mate (or delivered mate) after the move
  allowsMate: boolean; // played move allows a forced mate that didn't exist before
}

export interface ClassifyResult {
  classification: Classification;
  reason: string; // short machine-ish reason, useful for debugging/tests
}

export function classifyMove(i: ClassifyInput): ClassifyResult {
  if (i.inBook) return { classification: "Book", reason: "position is in the opening book" };

  const nearBest = i.isBest || i.winLoss < THRESHOLDS.excellent;
  if (nearBest && i.sacrifice >= THRESHOLDS.sacrifice && i.winAfter >= 50 && i.winBefore < 97 && !i.allowsMate) {
    return { classification: "Brilliant", reason: `sound sacrifice of ${i.sacrifice} pawns` };
  }
  if (
    i.isBest &&
    i.secondBestGap !== null &&
    i.secondBestGap >= THRESHOLDS.greatGap &&
    !i.isRecapture &&
    i.winAfter >= 30 &&
    i.winBefore < 97
  ) {
    return { classification: "Great", reason: `only good move (next best ${i.secondBestGap.toFixed(0)}% worse)` };
  }
  if (i.isBest) return { classification: "Best", reason: "engine's top move" };
  if (i.winLoss < THRESHOLDS.excellent && !i.allowsMate && !(i.hadMate && !i.keepsMate)) {
    return { classification: "Excellent", reason: "almost as good as the best move" };
  }

  let c: Classification =
    i.winLoss >= THRESHOLDS.blunder
      ? "Blunder"
      : i.winLoss >= THRESHOLDS.mistake
        ? "Mistake"
        : i.winLoss >= THRESHOLDS.inaccuracy
          ? "Inaccuracy"
          : "Good";
  let reason = `lost ${i.winLoss.toFixed(1)}% win chance`;

  const missedMate = i.hadMate && !i.keepsMate;
  const missedPunish = i.opponentErred && (i.bestGain >= THRESHOLDS.missGain || i.bestMates) && i.winLoss >= THRESHOLDS.inaccuracy;
  if ((missedMate || missedPunish) && i.winAfter >= 40 && !i.allowsMate) {
    return { classification: "Miss", reason: missedMate ? "missed a forced mate" : "failed to punish the opponent's error" };
  }
  if (missedMate && c === "Good") {
    c = "Inaccuracy";
    reason = "missed a forced mate";
  }
  if (i.allowsMate && (c === "Good" || c === "Inaccuracy")) {
    c = "Mistake";
    reason = "allows a forced mate";
  }
  return { classification: c, reason };
}
