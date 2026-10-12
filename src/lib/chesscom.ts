// Chess.com Published-Data API helpers (public, read-only, no auth).
// Docs: https://www.chess.com/news/view/published-data-api

// Chess.com asks API clients to identify themselves with a descriptive User-Agent including
// contact info. Override with MOVEMENTOR_USER_AGENT (e.g. to add an email) when you deploy.
export const DEFAULT_USER_AGENT = "MoveMentor (https://github.com/J-grok-bot/movementor)";
export const USER_AGENT = process.env.MOVEMENTOR_USER_AGENT?.trim() || DEFAULT_USER_AGENT;

export interface ChessComPlayer {
  username: string;
  rating: number;
  result: string;
}

export interface ChessComGame {
  url: string;
  pgn?: string;
  time_control: string;
  end_time: number;
  rated: boolean;
  time_class: string;
  rules: string;
  uuid?: string;
  eco?: string;
  white: ChessComPlayer;
  black: ChessComPlayer;
}

export type Outcome = "win" | "loss" | "draw";

export interface GameSummary {
  id: string;
  url: string;
  pgn: string;
  endTime: number; // unix seconds
  timeClass: string;
  timeControl: string;
  rated: boolean;
  opening: string | null;
  userColor: "white" | "black";
  white: { username: string; rating: number; result: string };
  black: { username: string; rating: number; result: string };
  opponent: { username: string; rating: number };
  outcome: Outcome;
  resultDetail: string;
}

const DRAW_RESULTS = new Set([
  "agreed",
  "repetition",
  "stalemate",
  "insufficient",
  "50move",
  "timevsinsufficient",
]);

export function formatTimeControl(tc: string): string {
  if (tc.includes("/")) {
    const days = Math.round(Number(tc.split("/")[1]) / 86400);
    return `${days} day${days === 1 ? "" : "s"}/move`;
  }
  const [base, inc] = tc.split("+").map(Number);
  const mins = base >= 60 ? `${+(base / 60).toFixed(2)}` : `${base}s`;
  return inc ? `${mins}+${inc}` : `${mins} min`;
}

function openingFromPgn(pgn: string, eco?: string): string | null {
  const m = pgn.match(/\[ECOUrl "[^"]*\/openings\/([^"]+)"\]/) ?? (eco ? eco.match(/\/openings\/(.+)$/) : null);
  if (!m) return null;
  return decodeURIComponent(m[1]).replace(/-/g, " ").replace(/\.{3}/g, "...").trim();
}

export function summarize(game: ChessComGame, username: string): GameSummary | null {
  if (!game.pgn || game.rules !== "chess") return null;
  const u = username.toLowerCase();
  const isWhite = game.white.username.toLowerCase() === u;
  const isBlack = game.black.username.toLowerCase() === u;
  if (!isWhite && !isBlack) return null;
  const me = isWhite ? game.white : game.black;
  const opp = isWhite ? game.black : game.white;
  const outcome: Outcome =
    me.result === "win" ? "win" : DRAW_RESULTS.has(me.result) ? "draw" : "loss";
  const resultDetail = outcome === "win" ? opp.result : me.result;
  return {
    id: game.uuid ?? game.url,
    url: game.url,
    pgn: game.pgn,
    endTime: game.end_time,
    timeClass: game.time_class,
    timeControl: formatTimeControl(game.time_control),
    rated: game.rated,
    opening: openingFromPgn(game.pgn, game.eco),
    userColor: isWhite ? "white" : "black",
    white: game.white,
    black: game.black,
    opponent: { username: opp.username, rating: opp.rating },
    outcome,
    resultDetail,
  };
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    // Cache archive responses briefly so repeated page loads don't hammer the API.
    next: { revalidate: 300 },
  });
  if (res.status === 404) throw new HttpError(404, "Player not found on Chess.com");
  if (res.status === 429) throw new HttpError(429, "Rate limited by Chess.com, try again shortly");
  if (!res.ok) throw new HttpError(res.status, `Chess.com API error ${res.status}`);
  return (await res.json()) as T;
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/**
 * Fetch recent games for a user. Requests are made sequentially (never in parallel),
 * per Chess.com's API etiquette.
 */
export async function fetchRecentGames(
  username: string,
  { limit = 50, maxMonths = 3 } = {},
): Promise<GameSummary[]> {
  const user = username.trim().toLowerCase();
  if (!/^[a-z0-9_-]{1,40}$/.test(user)) throw new HttpError(400, "Invalid username");
  const { archives } = await getJson<{ archives: string[] }>(
    `https://api.chess.com/pub/player/${user}/games/archives`,
  );
  const games: GameSummary[] = [];
  for (const archiveUrl of [...archives].reverse().slice(0, maxMonths)) {
    const { games: monthGames } = await getJson<{ games: ChessComGame[] }>(archiveUrl);
    for (const g of monthGames) {
      const s = summarize(g, user);
      if (s) games.push(s);
    }
    if (games.length >= limit) break;
  }
  return games.sort((a, b) => b.endTime - a.endTime).slice(0, limit);
}
