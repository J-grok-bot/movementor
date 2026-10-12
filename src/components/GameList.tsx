"use client";
import type { GameSummary } from "@/lib/chesscom";
import type { PreloadState } from "@/lib/preloader";

const CHIP = {
  win: { cls: "bg-green-600 text-white", label: "W" },
  loss: { cls: "bg-red-600 text-white", label: "L" },
  draw: { cls: "bg-zinc-500 text-white", label: "D" },
};

function shortDate(t: number) {
  const d = new Date(t * 1000);
  const today = new Date();
  return d.toDateString() === today.toDateString()
    ? d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function GameList({
  games,
  selectedId,
  onSelect,
  reviewed,
  preload,
}: {
  games: GameSummary[];
  selectedId: string | null;
  onSelect: (g: GameSummary) => void;
  reviewed: Set<string>;
  preload: PreloadState;
}) {
  if (!games.length) return <p className="text-sm text-zinc-400">No standard chess games found.</p>;
  return (
    <ul className="divide-y divide-zinc-800 overflow-hidden rounded-lg border border-zinc-800" data-testid="game-list">
      {games.map((g) => {
        const me = g.userColor === "white" ? g.white : g.black;
        const chip = CHIP[g.outcome];
        const running = preload.running?.id === g.id ? preload.running : null;
        const queued = !running && preload.queued.includes(g.id) && !reviewed.has(g.id);
        return (
          <li key={g.id} className="relative">
            <button
              onClick={() => onSelect(g)}
              data-game-id={g.id}
              className={`flex w-full items-center gap-2 px-2.5 py-2 text-left text-sm transition hover:bg-zinc-800 ${selectedId === g.id ? "bg-zinc-800" : ""}`}
            >
              <span className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-[11px] font-bold ${chip.cls}`} title={g.outcome}>
                {chip.label}
              </span>
              <span
                className={`h-2.5 w-2.5 shrink-0 rounded-full border border-zinc-500 ${g.userColor === "white" ? "bg-white" : "bg-zinc-900"}`}
                title={`You played ${g.userColor}`}
              />
              <span className="min-w-0 flex-1 truncate">
                <span className="font-medium">{g.opponent.username}</span> <span className="text-zinc-400">{g.opponent.rating}</span>
                <span className="hidden text-xs text-zinc-500 lg:inline"> · you {me.rating} · {g.resultDetail}</span>
              </span>
              {reviewed.has(g.id) && (
                <span className="shrink-0 rounded bg-indigo-600/30 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-300" data-testid="reviewed-badge">
                  Reviewed
                </span>
              )}
              {running && (
                <span className="shrink-0 text-[10px] text-sky-300" data-testid="preload-progress">
                  {Math.round((running.done / running.total) * 100)}%
                </span>
              )}
              {queued && <span className="shrink-0 text-[10px] text-zinc-500" title="Queued for background analysis">⋯</span>}
              <span className="w-12 shrink-0 text-right text-xs text-zinc-400">{g.timeControl}</span>
              <span className="w-14 shrink-0 text-right text-xs text-zinc-500">{shortDate(g.endTime)}</span>
            </button>
            {running && (
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 bg-zinc-800">
                <div className="h-full bg-sky-500/70 transition-all" style={{ width: `${(running.done / running.total) * 100}%` }} />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
