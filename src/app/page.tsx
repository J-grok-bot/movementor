"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { GameList } from "@/components/GameList";
import { Review } from "@/components/Review";
import { SettingsPanel } from "@/components/SettingsPanel";
import { Footer } from "@/components/Footer";
import type { GameSummary } from "@/lib/chesscom";
import { fetchGames, getCachedGames, LAST_USER_KEY, LIST_SCROLL_KEY } from "@/lib/gamesStore";
import { setPreloadCandidates, usePreloadState } from "@/lib/preloader";
import { useReviewedIds } from "@/lib/analysisCache";
import { updateSettings, useSettings } from "@/lib/settings";
import { DESKTOP_QUERY, useMediaQuery } from "@/lib/useMedia";

const DEFAULT_USER = "Killer5291";

export default function Home() {
  const router = useRouter();
  const isDesktop = useMediaQuery(DESKTOP_QUERY, true);
  const settings = useSettings();
  const reviewed = useReviewedIds();
  const preload = usePreloadState();
  const [username, setUsername] = useState(DEFAULT_USER);
  const [games, setGames] = useState<GameSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<GameSummary | null>(null);
  const wantedId = useRef<string | null>(null);
  const wantedIndex = useRef<number | null>(null);

  const showGames = useCallback((user: string, list: GameSummary[]) => {
    setGames(list);
    setPreloadCandidates(list);
    try {
      localStorage.setItem(LAST_USER_KEY, user);
    } catch {
      /* ignore */
    }
  }, []);

  const load = useCallback(
    async (user: string) => {
      setLoading(true);
      setError(null);
      try {
        showGames(user, await fetchGames(user));
        setSelected(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setGames([]);
      } finally {
        setLoading(false);
      }
    },
    [showGames],
  );

  // Initial load: URL params > last user; reuse the session's cached list (keeps back-navigation instant).
  useEffect(() => {
    sessionStorage.removeItem("movementor:from-list");
    const params = new URLSearchParams(window.location.search);
    const u = params.get("user") ?? localStorage.getItem(LAST_USER_KEY) ?? DEFAULT_USER;
    const d = Number(params.get("depth"));
    if (d >= 6 && d <= 22) updateSettings({ depth: d });
    if (params.get("lines") === "1") updateSettings({ multiPv: 1 });
    wantedId.current = params.get("g");
    const n = params.get("game");
    wantedIndex.current = n !== null ? Number(n) : null;
    setUsername(u);
    const cached = getCachedGames(u);
    if (cached) showGames(u, cached);
    else load(u);
  }, [load, showGames]);

  // Restore list scroll position after returning from a game (mobile).
  useLayoutEffect(() => {
    if (!games.length) return;
    const y = sessionStorage.getItem(LIST_SCROLL_KEY);
    if (y !== null) {
      sessionStorage.removeItem(LIST_SCROLL_KEY);
      window.scrollTo(0, Number(y));
      requestAnimationFrame(() => window.scrollTo(0, Number(y)));
    }
  }, [games]);

  // Desktop deep links: ?g=<id> or legacy ?game=<index> select a game in the side-by-side layout.
  useEffect(() => {
    if (!games.length || selected || !isDesktop) return;
    const byId = wantedId.current ? games.find((g) => g.id === wantedId.current) : null;
    const byIndex = wantedIndex.current !== null ? games[wantedIndex.current] : null;
    if (byId || byIndex) setSelected(byId ?? byIndex ?? null);
    wantedId.current = null;
    wantedIndex.current = null;
  }, [games, selected, isDesktop]);

  const onSelect = (g: GameSummary) => {
    if (isDesktop) {
      setSelected(g);
      const url = new URL(window.location.href);
      url.searchParams.set("user", username.trim());
      url.searchParams.set("g", g.id);
      url.searchParams.delete("game");
      window.history.replaceState(null, "", url);
      return;
    }
    sessionStorage.setItem(LIST_SCROLL_KEY, String(window.scrollY));
    sessionStorage.setItem("movementor:from-list", "1");
    router.push(`/game/${encodeURIComponent(g.id)}?user=${encodeURIComponent(username.trim())}`);
  };

  return (
    <main className="mx-auto max-w-7xl p-3 sm:p-4">
      <header className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.svg" alt="" width={32} height={32} className="h-8 w-8" />
            MoveMentor
          </h1>
          <p className="hidden text-sm text-zinc-400 sm:block">Free move-by-move game review. Stockfish runs locally in your browser.</p>
        </div>
        <form
          className="flex w-full items-end gap-2 sm:w-auto"
          onSubmit={(e) => {
            e.preventDefault();
            load(username);
          }}
        >
          <label className="min-w-0 flex-1 text-xs text-zinc-400 sm:flex-none">
            Chess.com username
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="mt-1 block w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-100 sm:w-48"
            />
          </label>
          <button className="rounded bg-blue-600 px-3 py-1.5 text-sm font-semibold hover:bg-blue-500" disabled={loading}>
            {loading ? "Loading…" : "Load"}
          </button>
          <SettingsPanel />
        </form>
      </header>

      {error && <p className="mb-3 rounded bg-red-900/40 p-2 text-sm text-red-300">{error}</p>}

      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <aside className="lg:max-h-[calc(100vh-120px)] lg:overflow-y-auto">
          <h2 className="mb-2 text-sm font-semibold text-zinc-300">Recent games {games.length ? `(${games.length})` : ""}</h2>
          {loading && !games.length ? <p className="text-sm text-zinc-400">Fetching games from Chess.com…</p> : null}
          <GameList games={games} selectedId={selected?.id ?? null} onSelect={onSelect} reviewed={reviewed} preload={preload} />
        </aside>
        <section className="hidden lg:block">
          {selected ? (
            <Review key={selected.id} game={selected} depth={settings.depth} multiPv={settings.multiPv} />
          ) : (
            <div className="flex h-64 items-center justify-center rounded-lg border border-dashed border-zinc-700 text-zinc-500">Pick a game to review</div>
          )}
        </section>
      </div>

      <Footer />
    </main>
  );
}
