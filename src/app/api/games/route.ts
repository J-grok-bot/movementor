import { NextRequest, NextResponse } from "next/server";
import { fetchRecentGames, HttpError } from "@/lib/chesscom";

export async function GET(req: NextRequest) {
  const username = req.nextUrl.searchParams.get("username") ?? "";
  const limit = Math.min(Number(req.nextUrl.searchParams.get("limit") ?? 50) || 50, 200);
  try {
    const games = await fetchRecentGames(username, { limit });
    return NextResponse.json({ username, count: games.length, games });
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 502;
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status });
  }
}
