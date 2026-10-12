"use client";
// Client-side cache of the fetched game list (sessionStorage) so the list and /game/[id] can share it
// without re-hitting the Chess.com API. All API requests stay sequential (one in flight at a time).
import type { GameSummary } from "./chesscom";

const key = (user: string) => `movementor:games:${user.trim().toLowerCase()}`;

export function getCachedGames(user: string): GameSummary[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(key(user));
    return raw ? (JSON.parse(raw) as GameSummary[]) : null;
  } catch {
    return null;
  }
}

let inflight: Promise<unknown> = Promise.resolve();
export async function fetchGames(user: string): Promise<GameSummary[]> {
  const run = async () => {
    const res = await fetch(`/api/games?username=${encodeURIComponent(user.trim())}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
    try {
      sessionStorage.setItem(key(user), JSON.stringify(data.games));
    } catch {
      /* ignore */
    }
    return data.games as GameSummary[];
  };
  const p = inflight.then(run, run);
  inflight = p.catch(() => undefined);
  return p;
}

export const LAST_USER_KEY = "movementor:last-user";
export const LIST_SCROLL_KEY = "movementor:list-scroll";
