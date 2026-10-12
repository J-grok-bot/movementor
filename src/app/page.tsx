"use client";
import { useCallback, useEffect, useState } from "react";
import { GameList } from "@/components/GameList";
import { Review } from "@/components/Review";
import type { GameSummary } from "@/lib/chesscom";

const DEFAULT_USER = "Killer5291";

export default function Home() {
  const [username, setUsername] = useState(DEFAULT_USER);
  const [games, setGames] = useState<GameSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<GameSummary | null>(null);
  const [depth, setDepth] = useState(14);
  const [multiPv, setMultiPv] = useState(2);

  const load = useCallback(async (user: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/games?username=${encodeURIComponent(user.trim())}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setGames(data.games);
      setSelected(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setGames([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const u = params.get("user") ?? DEFAULT_USER;
    const d = Number(params.get("depth"));
    if (d >= 6 && d <= 22) setDepth(d);
    if (params.get("lines") === "1") setMultiPv(1);
    setUsername(u);
    load(u);
  }, [load]);

  // ?game=N auto-selects the Nth game (handy for sharing/testing).
  useEffect(() => {
    const n = new URLSearchParams(window.location.search).get("game");
    if (n !== null && games.length && !selected) setSelected(games[Number(n)] ?? null);
  }, [games, selected]);

  return (
    <main className="mx-auto max-w-7xl p-4">
      <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.svg" alt="" width={32} height={32} className="h-8 w-8" />
            MoveMentor
          </h1>
          <p className="text-sm text-zinc-400">Free move-by-move game review. Stockfish runs locally in your browser.</p>
        </div>
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            load(username);
          }}
        >
          <label className="text-xs text-zinc-400">
            Chess.com username
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="mt-1 block w-48 rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-100"
            />
          </label>
          <label className="text-xs text-zinc-400">
            Depth
            <select
              value={depth}
              onChange={(e) => setDepth(Number(e.target.value))}
              className="mt-1 block rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-100"
            >
              {[10, 12, 14, 16, 18].map((d) => (
                <option key={d} value={d}>
                  {d}
                  {d === 14 ? " (default)" : d >= 16 ? " (slower)" : " (fast)"}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1.5 pb-2 text-xs text-zinc-400" title="Also compute the engine's 2nd-best line (MultiPV 2). Roughly 2-3x slower.">
            <input type="checkbox" checked={multiPv === 2} onChange={(e) => setMultiPv(e.target.checked ? 2 : 1)} />
            2nd-best line
          </label>
          <button className="rounded bg-blue-600 px-4 py-1.5 text-sm font-semibold hover:bg-blue-500" disabled={loading}>
            {loading ? "Loading…" : "Load games"}
          </button>
        </form>
      </header>

      {error && <p className="mb-3 rounded bg-red-900/40 p-2 text-sm text-red-300">{error}</p>}

      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <aside className="lg:max-h-[calc(100vh-120px)] lg:overflow-y-auto">
          <h2 className="mb-2 text-sm font-semibold text-zinc-300">Recent games {games.length ? `(${games.length})` : ""}</h2>
          {loading && !games.length ? <p className="text-sm text-zinc-400">Fetching games from Chess.com…</p> : null}
          <GameList games={games} selectedId={selected?.id ?? null} onSelect={setSelected} />
        </aside>
        <section>
          {selected ? (
            <Review key={selected.id} game={selected} depth={depth} multiPv={multiPv} />
          ) : (
            <div className="flex h-64 items-center justify-center rounded-lg border border-dashed border-zinc-700 text-zinc-500">
              Pick a game to review
            </div>
          )}
        </section>
      </div>

      <footer className="mt-8 space-y-1 text-xs text-zinc-500" data-testid="footer">
        <p>
          <strong className="text-zinc-400">Not affiliated with Chess.com.</strong> Game data comes from the public Chess.com
          Published-Data API.
        </p>
        <p>
          MoveMentor is free software (GPL-3.0):{" "}
          <a className="underline" href="https://github.com/J-grok-bot/movementor" target="_blank" rel="noreferrer">
            source code
          </a>
          . Analysis by{" "}
          <a className="underline" href="https://stockfishchess.org" target="_blank" rel="noreferrer">
            Stockfish
          </a>{" "}
          via{" "}
          <a className="underline" href="https://github.com/nmrugg/stockfish.js" target="_blank" rel="noreferrer">
            stockfish.js
          </a>{" "}
          (GPLv3,{" "}
          <a className="underline" href="/stockfish/COPYING-GPLv3.txt">
            license
          </a>
          ,{" "}
          <a className="underline" href="https://github.com/official-stockfish/Stockfish" target="_blank" rel="noreferrer">
            engine source
          </a>
          ). Opening names from{" "}
          <a className="underline" href="https://github.com/lichess-org/chess-openings" target="_blank" rel="noreferrer">
            lichess-org/chess-openings
          </a>{" "}
          (CC0).
        </p>
      </footer>
    </main>
  );
}
