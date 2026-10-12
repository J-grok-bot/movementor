"use client";
// Background analysis of the newest un-reviewed games: one at a time, only when the tab is visible
// and idle, never while the user is analyzing a game, and on touch devices only while charging.
import { useSyncExternalStore } from "react";
import { analyzePgn } from "./analysis";
import { getCachedAnalysis, isReviewed, saveAnalysis } from "./analysisCache";
import type { GameSummary } from "./chesscom";
import { abortPreload, runPreload, userActivity } from "./engineManager";
import { loadOpeningBook } from "./openingBook";
import { getSettings, subscribeSettings } from "./settings";
import { createStore } from "./store";

export const PRELOAD_COUNT = 3;

export interface PreloadState {
  running: { id: string; done: number; total: number } | null;
  queued: string[];
  blockedReason: string | null; // why preloading isn't running right now (for debugging / UI)
}
const state = createStore<PreloadState>({ running: null, queued: [], blockedReason: null });

let candidates: GameSummary[] = [];
const failed = new Set<string>(); // games that errored (not aborted): don't retry this session
let pumping = false;
let wired = false;
let battery: { charging: boolean; addEventListener: (t: string, f: () => void) => void } | null | undefined;

type BatteryNav = Navigator & { getBattery?: () => Promise<{ charging: boolean; addEventListener: (t: string, f: () => void) => void }> };

/** Desktop (fine pointer) always OK; touch devices only if the Battery API says we're charging. */
async function powerOk(): Promise<{ ok: boolean; reason?: string }> {
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  if (!coarse) return { ok: true };
  const nav = navigator as BatteryNav;
  if (!nav.getBattery) return { ok: false, reason: "mobile without Battery API" };
  if (battery === undefined) {
    try {
      battery = await nav.getBattery();
      battery.addEventListener("chargingchange", () => schedule());
    } catch {
      battery = null;
    }
  }
  if (!battery) return { ok: false, reason: "battery status unavailable" };
  return battery.charging ? { ok: true } : { ok: false, reason: "not charging" };
}

function wire() {
  if (wired || typeof window === "undefined") return;
  wired = true;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") abortPreload();
    else schedule();
  });
  userActivity.subscribe(() => {
    if (userActivity.get() === 0) schedule(); // resume after the user's game finished
  });
  subscribeSettings(() => {
    if (!getSettings().preload) abortPreload();
    schedule();
  });
}

function whenIdle(): Promise<void> {
  return new Promise((r) => {
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
    if (w.requestIdleCallback) w.requestIdleCallback(() => r(), { timeout: 3000 });
    else setTimeout(r, 500);
  });
}

function pending(): GameSummary[] {
  const { depth, multiPv } = getSettings();
  return [...candidates]
    .sort((a, b) => b.endTime - a.endTime)
    .slice(0, PRELOAD_COUNT)
    .filter((g) => !failed.has(g.id) && !isReviewed(g.id) && !getCachedAnalysis(g.id, depth, multiPv));
}

/** Call after the game list loads. */
export function setPreloadCandidates(games: GameSummary[]) {
  wire();
  candidates = games;
  schedule();
}

export function schedule() {
  if (typeof window === "undefined" || pumping) return;
  void pump();
}

async function pump() {
  pumping = true;
  try {
    for (;;) {
      const todo = pending();
      state.set((s) => ({ ...s, queued: todo.map((g) => g.id) }));
      if (!todo.length) return block(null);
      if (!getSettings().preload) return block("turned off in settings");
      if (document.visibilityState !== "visible") return block("tab hidden");
      if (userActivity.get() > 0) return block("user is reviewing a game");
      const power = await powerOk();
      if (!power.ok) return block(power.reason ?? "power");
      await whenIdle();
      if (userActivity.get() > 0 || document.visibilityState !== "visible" || !getSettings().preload) continue;

      const g = todo[0];
      const { depth, multiPv } = getSettings();
      const signal = { aborted: false };
      state.set((s) => ({ ...s, running: { id: g.id, done: 0, total: 1 }, blockedReason: null }));
      let result = null;
      try {
        const book = await loadOpeningBook().catch(() => null);
        result = await runPreload(multiPv, signal, (eng) =>
          analyzePgn(g.pgn, eng.evaluate, {
            depth,
            multiPv,
            book,
            signal,
            onProgress: (done, total) => state.set((s) => ({ ...s, running: { id: g.id, done, total } })),
          }),
        );
      } catch (e) {
        result = null; // aborted (user opened a game / tab hidden): restart later
        if (!signal.aborted && !(e instanceof Error && e.message === "aborted")) failed.add(g.id);
      }
      state.set((s) => ({ ...s, running: null }));
      if (result) saveAnalysis(g.id, depth, multiPv, result);
      else if (userActivity.get() > 0 || document.visibilityState !== "visible") return block("paused");
    }
  } finally {
    pumping = false;
  }
}

function block(reason: string | null) {
  state.set((s) => ({ ...s, blockedReason: reason }));
}

const SERVER: PreloadState = { running: null, queued: [], blockedReason: null };
export function usePreloadState(): PreloadState {
  return useSyncExternalStore(state.subscribe, state.get, () => SERVER);
}
