"use client";
import { useSyncExternalStore } from "react";

export function useMediaQuery(query: string, serverDefault = false): boolean {
  return useSyncExternalStore(
    (l) => {
      const m = window.matchMedia(query);
      m.addEventListener("change", l);
      return () => m.removeEventListener("change", l);
    },
    () => window.matchMedia(query).matches,
    () => serverDefault,
  );
}

export const DESKTOP_QUERY = "(min-width: 1024px)";
