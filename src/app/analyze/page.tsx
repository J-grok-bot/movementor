import { Suspense } from "react";
import type { Metadata } from "next";
import { AnalyzeView } from "@/components/AnalyzeView";

export const metadata: Metadata = {
  title: "Position calculator · MoveMentor",
  description: "Set up any chess position by dragging pieces onto the board and let Stockfish find the best move, free in your browser.",
};

export default function AnalyzePage() {
  return (
    <Suspense fallback={<main className="p-4 text-sm text-zinc-400">Loading calculator…</main>}>
      <AnalyzeView />
    </Suspense>
  );
}
