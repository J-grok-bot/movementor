import { Suspense } from "react";
import type { Metadata } from "next";
import { PuzzlesView } from "@/components/PuzzlesView";

export const metadata: Metadata = {
  title: "Daily puzzles · MoveMentor",
  description: "Two free chess puzzles a day from the Lichess puzzle database, with hints, solutions and engine analysis.",
};

export default function PuzzlesPage() {
  return (
    <Suspense fallback={<main className="p-4 text-sm text-zinc-400">Loading puzzles…</main>}>
      <PuzzlesView />
    </Suspense>
  );
}
