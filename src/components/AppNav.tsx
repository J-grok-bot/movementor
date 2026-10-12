"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/", label: "Review" },
  { href: "/openings", label: "Openings" },
];

/** Top-level tabs: Review | Openings. */
export function AppNav({ className = "" }: { className?: string }) {
  const path = usePathname();
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
            className={`rounded-md px-2.5 py-1 font-semibold sm:px-3 ${active ? "bg-zinc-700 text-white" : "text-zinc-400 hover:text-zinc-200"}`}
            aria-current={active ? "page" : undefined}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
