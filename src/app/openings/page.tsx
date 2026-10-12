import { Suspense } from "react";
import type { Metadata } from "next";
import { OpeningsView } from "@/components/OpeningsView";

export const metadata: Metadata = {
  title: "Openings · MoveMentor",
  description: "Explore chess openings move by move, search by name and practice the book moves.",
};

export default function OpeningsPage() {
  return (
    <Suspense fallback={<main className="p-4 text-sm text-zinc-400">Loading openings…</main>}>
      <OpeningsView />
    </Suspense>
  );
}
