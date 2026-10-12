"use client";
import type { GameSummary } from "@/lib/chesscom";

const OUTCOME_STYLE = {
  win: "bg-green-600/20 text-green-400",
  loss: "bg-red-600/20 text-red-400",
  draw: "bg-zinc-600/30 text-zinc-300",
};

export function GameList({
  games,
  selectedId,
  onSelect,
}: {
  games: GameSummary[];
  selectedId: string | null;
  onSelect: (g: GameSummary) => void;
}) {
  if (!games.length) return <p className="text-sm text-zinc-400">No standard chess games found.</p>;
  return (
    <ul className="divide-y divide-zinc-800 overflow-y-auto rounded-lg border border-zinc-800" data-testid="game-list">
      {games.map((g) => {
        const me = g.userColor === "white" ? g.white : g.black;
        return (
          <li key={g.id}>
            <button
              onClick={() => onSelect(g)}
              className={`w-full px-3 py-2 text-left text-sm transition hover:bg-zinc-800 ${
                selectedId === g.id ? "bg-zinc-800" : ""
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-medium">
                  <span className={`mr-1 inline-block h-2.5 w-2.5 rounded-sm border border-zinc-500 ${g.userColor === "white" ? "bg-white" : "bg-zinc-900"}`} />
                  vs {g.opponent.username} <span className="text-zinc-400">({g.opponent.rating})</span>
                </span>
                <span className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-semibold uppercase ${OUTCOME_STYLE[g.outcome]}`}>
                  {g.outcome}
                </span>
              </div>
              <div className="mt-0.5 flex justify-between gap-2 text-xs text-zinc-400">
                <span className="truncate">
                  {g.timeClass} · {g.timeControl} · you {me.rating} · {g.resultDetail}
                </span>
                <span className="shrink-0">
                  {new Date(g.endTime * 1000).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                </span>
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
