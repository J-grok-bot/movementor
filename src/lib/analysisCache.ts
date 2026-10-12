"use client";
// localStorage cache of finished analyses with LRU eviction, plus a "reviewed" index for badges.
import { useSyncExternalStore } from "react";
import type { GameAnalysis } from "./analysis";
import { createStore } from "./store";

const VERSION = "v3";
const PREFIX = `movementor:${VERSION}:`;
const INDEX = "movementor:cache-index";

export const analysisKey = (gameId: string, depth: number, multiPv: number) => `${PREFIX}${gameId}:d${depth}:pv${multiPv}`;

type Index = Record<string, number>; // key -> last used (ms)
function readIndex(): Index {
  try {
    return JSON.parse(localStorage.getItem(INDEX) ?? "{}");
  } catch {
    return {};
  }
}
function writeIndex(i: Index) {
  try {
    localStorage.setItem(INDEX, JSON.stringify(i));
  } catch {
    /* ignore */
  }
}

/** Game ids that have any cached analysis. */
const reviewed = createStore<Set<string>>(new Set());
let scanned = false;
function scan() {
  if (scanned || typeof window === "undefined") return;
  scanned = true;
  const s = new Set<string>();
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k?.startsWith(PREFIX)) s.add(k.slice(PREFIX.length).split(":")[0]);
  }
  reviewed.set(s);
}

export function getCachedAnalysis(gameId: string, depth: number, multiPv: number): GameAnalysis | null {
  if (typeof window === "undefined") return null;
  const key = analysisKey(gameId, depth, multiPv);
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  try {
    const a = JSON.parse(raw) as GameAnalysis;
    const idx = readIndex();
    idx[key] = Date.now();
    writeIndex(idx);
    return a;
  } catch {
    return null;
  }
}

export function saveAnalysis(gameId: string, depth: number, multiPv: number, a: GameAnalysis) {
  const key = analysisKey(gameId, depth, multiPv);
  const data = JSON.stringify(a);
  const idx = readIndex();
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      localStorage.setItem(key, data);
      idx[key] = Date.now();
      writeIndex(idx);
      scan();
      reviewed.set((s) => new Set(s).add(gameId));
      return true;
    } catch {
      // Storage full: evict the least recently used analysis and retry.
      const oldest = Object.entries(idx)
        .filter(([k]) => k !== key)
        .sort((a, b) => a[1] - b[1])[0];
      const victim = oldest?.[0] ?? findUnindexed(key);
      if (!victim) return false;
      localStorage.removeItem(victim);
      delete idx[victim];
      const id = victim.slice(PREFIX.length).split(":")[0];
      reviewed.set((s) => {
        const n = new Set(s);
        n.delete(id);
        return n;
      });
    }
  }
  return false;
}

function findUnindexed(except: string): string | null {
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k !== except && (k.startsWith(PREFIX) || /^movementor:v[12]:|^review:/.test(k))) return k;
  }
  return null;
}

export function isReviewed(gameId: string): boolean {
  scan();
  return reviewed.get().has(gameId);
}

const EMPTY = new Set<string>();
export function useReviewedIds(): Set<string> {
  return useSyncExternalStore(
    (l) => {
      scan();
      return reviewed.subscribe(l);
    },
    () => {
      scan();
      return reviewed.get();
    },
    () => EMPTY,
  );
}
