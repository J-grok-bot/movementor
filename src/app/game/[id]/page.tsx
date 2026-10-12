"use client";
import { Suspense, useCallback, useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Review, type Status } from "@/components/Review";
import { Footer } from "@/components/Footer";
import type { GameSummary } from "@/lib/chesscom";
import { fetchGames, getCachedGames, LAST_USER_KEY } from "@/lib/gamesStore";
import { useSettings } from "@/lib/settings";
import { DESKTOP_QUERY } from "@/lib/useMedia";

const CHIP = {
  win: "bg-green-600",
  loss: "bg-red-600",
  draw: "bg-zinc-500",
};

function GameView() {
  const { id: rawId } = useParams<{ id: string }>();
  const id = decodeURIComponent(rawId);
  const search = useSearchParams();
  const router = useRouter();
  const settings = useSettings();
  const [game, setGame] = useState<GameSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [user, setUser] = useState<string>("");

  useEffect(() => {
    const u = search.get("user") ?? localStorage.getItem(LAST_USER_KEY) ?? "Killer5291";
    setUser(u);
    // Desktop deep link: use the side-by-side layout instead.
    if (window.matchMedia(DESKTOP_QUERY).matches && !search.get("standalone")) {
      router.replace(`/?user=${encodeURIComponent(u)}&g=${encodeURIComponent(id)}`);
      return;
    }
    const find = (list: GameSummary[] | null) => list?.find((g) => g.id === id) ?? null;
    const cached = find(getCachedGames(u));
    if (cached) {
      setGame(cached);
      return;
    }
    fetchGames(u)
      .then((list) => {
        const g = find(list);
        if (g) setGame(g);
        else setError("Game not found in this player's recent games.");
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [id, search, router]);

  const back = useCallback(() => {
    if (sessionStorage.getItem("movementor:from-list")) {
      sessionStorage.removeItem("movementor:from-list");
      router.back();
    } else router.push(`/?user=${encodeURIComponent(user)}`);
  }, [router, user]);

  const pct = status.kind === "analyzing" ? Math.round((status.done / status.total) * 100) : status.kind === "done" ? 100 : 0;
  const me = game ? (game.userColor === "white" ? game.white : game.black) : null;

  return (
    <main className="mx-auto min-h-screen max-w-3xl">
      <header className="sticky top-0 z-30 border-b border-zinc-800 bg-zinc-900/95 backdrop-blur" data-testid="game-header">
        <div className="flex items-center gap-2 px-2 py-2">
          <button onClick={back} className="rounded-md px-2 py-1.5 text-lg hover:bg-zinc-800" aria-label="Back to games" data-testid="back-to-list">
            ←
          </button>
          {game ? (
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <span className={`inline-flex h-5 shrink-0 items-center rounded px-1.5 text-[11px] font-bold uppercase text-white ${CHIP[game.outcome]}`}>
                  {game.outcome}
                </span>
                <span className="truncate">
                  vs {game.opponent.username} <span className="font-normal text-zinc-400">({game.opponent.rating})</span>
                </span>
              </div>
              <div className="truncate text-xs text-zinc-500">
                {game.timeClass} {game.timeControl} · you {me?.rating} as {game.userColor} · {game.resultDetail}
              </div>
            </div>
          ) : (
            <div className="flex-1 text-sm text-zinc-400">{error ?? "Loading game…"}</div>
          )}
          <span className="shrink-0 text-xs text-zinc-400" data-testid="header-progress">
            {status.kind === "analyzing" ? `${pct}%` : status.kind === "loading-engine" ? "starting…" : status.kind === "done" ? "✓" : ""}
          </span>
        </div>
        <div className="h-0.5 bg-zinc-800">
          <div
            className={`h-full transition-all ${status.kind === "done" ? "bg-green-500/60" : "bg-blue-500"}`}
            style={{ width: `${status.kind === "idle" ? 0 : status.kind === "loading-engine" ? 3 : pct}%` }}
          />
        </div>
      </header>
      <div className="p-3">
        {game && <Review key={game.id} game={game} depth={settings.depth} multiPv={settings.multiPv} onStatus={setStatus} explorerLayout="sheet" />}
        <Footer />
      </div>
    </main>
  );
}

export default function GamePage() {
  return (
    <Suspense fallback={<div className="p-4 text-sm text-zinc-400">Loading…</div>}>
      <GameView />
    </Suspense>
  );
}
