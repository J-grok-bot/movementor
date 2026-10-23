"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { ensureFirstDay, localDateKey, PROGRESS_EVENT, readProgress, unsolvedCounts } from "@/lib/puzzles";

const TABS = [
  { href: "/", label: "Review" },
  { href: "/openings", label: "Openings" },
  { href: "/puzzles", label: "Puzzles" },
];

/** Unsolved daily puzzles (today's + backlog), from localStorage. 0 until mounted. */
function useUnsolvedPuzzles(): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    const today = localDateKey();
    const calc = () => {
      try {
        const c = unsolvedCounts(readProgress(), localDateKey());
        setN(c.today + c.backlog);
      } catch {
        setN(0);
      }
    };
    try {
      ensureFirstDay(today);
    } catch {
      /* storage unavailable */
    }
    calc();
    window.addEventListener(PROGRESS_EVENT, calc);
    window.addEventListener("storage", calc);
    const t = window.setInterval(calc, 60_000);
    return () => {
      window.removeEventListener(PROGRESS_EVENT, calc);
      window.removeEventListener("storage", calc);
      window.clearInterval(t);
    };
  }, []);
  return n;
}

/** Top-level tabs: Review | Openings | Puzzles (dot = unsolved daily puzzles). */
export function AppNav({ className = "" }: { className?: string }) {
  const path = usePathname();
  const unsolved = useUnsolvedPuzzles();
  return (
    <nav
      className={`flex gap-1 rounded-lg bg-zinc-900 p-1 text-sm ${className}`}
      data-testid="app-nav"
    >
      {TABS.map((t) => {
        const active =
          t.href === "/"
            ? path === "/" || path.startsWith("/game")
            : path.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            className={`relative rounded-md px-2 py-1 font-semibold sm:px-3 ${active ? "bg-zinc-700 text-white" : "text-zinc-400 hover:text-zinc-200"}`}
            aria-current={active ? "page" : undefined}
            data-testid={`nav-${t.label.toLowerCase()}`}
          >
            {t.label}
            {t.href === "/puzzles" && unsolved > 0 && (
              <span
                className="absolute right-0.5 top-0.5 h-2 w-2 rounded-full bg-orange-500"
                data-testid="puzzle-dot"
                aria-label={`${unsolved} unsolved puzzle${unsolved > 1 ? "s" : ""}`}
              />
            )}
          </Link>
        );
      })}
    </nav>
  );
}
