"use client";
import { useSyncExternalStore } from "react";
import { createStore } from "./store";

export interface Settings {
  depth: number;
  multiPv: number; // 1 or 2
  preload: boolean; // background analysis of the newest games
}
export const DEFAULT_SETTINGS: Settings = { depth: 14, multiPv: 2, preload: true };
const KEY = "movementor:settings";

function read(): Settings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

const store = createStore<Settings>(DEFAULT_SETTINGS);
let loaded = false;
function ensureLoaded() {
  if (!loaded && typeof window !== "undefined") {
    loaded = true;
    store.set(read());
  }
}

export function getSettings(): Settings {
  ensureLoaded();
  return store.get();
}

export function updateSettings(patch: Partial<Settings>) {
  ensureLoaded();
  store.set((s) => ({ ...s, ...patch }));
  try {
    localStorage.setItem(KEY, JSON.stringify(store.get()));
  } catch {
    /* ignore */
  }
}

export function subscribeSettings(l: () => void) {
  return store.subscribe(l);
}

export function useSettings(): Settings {
  return useSyncExternalStore(
    (l) => {
      ensureLoaded();
      return store.subscribe(l);
    },
    getSettings,
    () => DEFAULT_SETTINGS,
  );
}
