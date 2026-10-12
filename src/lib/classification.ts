import type { Classification } from "./classify";

// Original icon/color scheme for this app (deliberately not Chess.com's artwork).
export const CLASS_STYLE: Record<Classification, { color: string; symbol: string; text: string; label: string }> = {
  Brilliant: { color: "#d946ef", symbol: "!!", text: "text-fuchsia-400", label: "Brilliant" },
  Great: { color: "#38bdf8", symbol: "!", text: "text-sky-400", label: "Great" },
  Best: { color: "#22c55e", symbol: "★", text: "text-green-400", label: "Best" },
  Excellent: { color: "#84cc16", symbol: "✦", text: "text-lime-400", label: "Excellent" },
  Good: { color: "#94a3b8", symbol: "✓", text: "text-slate-300", label: "Good" },
  Book: { color: "#a78bfa", symbol: "≡", text: "text-violet-400", label: "Book" },
  Inaccuracy: { color: "#eab308", symbol: "?!", text: "text-yellow-400", label: "Inaccuracy" },
  Mistake: { color: "#f97316", symbol: "?", text: "text-orange-400", label: "Mistake" },
  Miss: { color: "#f43f5e", symbol: "⊘", text: "text-rose-400", label: "Miss" },
  Blunder: { color: "#dc2626", symbol: "??", text: "text-red-500", label: "Blunder" },
};

export const FLAGGED: Classification[] = ["Inaccuracy", "Mistake", "Miss", "Blunder"];
export const HIGHLIGHT: Classification[] = ["Brilliant", "Great"];
