"use client";
// One shared Stockfish worker for the whole app, with an exclusive lock so a user-opened game
// always pre-empts background preloading.
import { BrowserEngine } from "./browserEngine";
import { createStore } from "./store";

let initP: Promise<BrowserEngine> | null = null;
export function getEngine(): Promise<BrowserEngine> {
  if (!initP) {
    initP = (async () => {
      const e = new BrowserEngine();
      await e.init();
      return e;
    })();
    initP.catch(() => (initP = null));
  }
  return initP;
}

let lock: Promise<void> = Promise.resolve();
function acquire(): Promise<() => void> {
  let release!: () => void;
  const next = new Promise<void>((r) => (release = r));
  const prev = lock;
  lock = prev.then(() => next);
  return prev.then(() => release);
}

/** Number of user analyses in flight; preloading pauses while > 0. */
export const userActivity = createStore(0);
let preloadSignal: { aborted: boolean } | null = null;

export async function runUserAnalysis<T>(multiPv: number, fn: (e: BrowserEngine) => Promise<T>): Promise<T> {
  userActivity.set((n) => n + 1);
  if (preloadSignal) preloadSignal.aborted = true; // user's game gets priority
  const release = await acquire();
  try {
    const eng = await getEngine();
    await eng.setMultiPv(multiPv);
    await eng.newGame();
    return await fn(eng);
  } finally {
    release();
    userActivity.set((n) => n - 1);
  }
}

/** Runs a background job unless a user analysis is active; returns null if it couldn't start. */
export async function runPreload<T>(multiPv: number, signal: { aborted: boolean }, fn: (e: BrowserEngine) => Promise<T>): Promise<T | null> {
  if (userActivity.get() > 0) return null;
  const release = await acquire();
  try {
    if (userActivity.get() > 0 || signal.aborted) return null;
    preloadSignal = signal;
    const eng = await getEngine();
    await eng.setMultiPv(multiPv);
    await eng.newGame();
    return await fn(eng);
  } finally {
    preloadSignal = null;
    release();
  }
}

export function abortPreload() {
  if (preloadSignal) preloadSignal.aborted = true;
}
