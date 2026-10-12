"use client";
import { useMemo } from "react";
import type { GameAnalysis } from "@/lib/analysis";
import type { GameSummary } from "@/lib/chesscom";
import { CLASSIFICATIONS } from "@/lib/classify";
import { CLASS_STYLE } from "@/lib/classification";
import { estimateRating, keyMoments, phaseAccuracy, PHASES, summaryParagraph } from "@/lib/overview";
import { EvalGraph } from "./EvalGraph";

export function Overview({ analysis, game, onStart }: { analysis: GameAnalysis; game: GameSummary; onStart: (ply: number) => void }) {
  const sides = ["white", "black"] as const;
  const moments = useMemo(() => keyMoments(analysis), [analysis]);
  const summary = useMemo(() => summaryParagraph(analysis, game), [analysis, game]);
  const phases = useMemo(() => ({ white: phaseAccuracy(analysis, "white"), black: phaseAccuracy(analysis, "black") }), [analysis]);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4" data-testid="overview">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-xl font-bold">Game overview</h2>
          <p className="text-sm text-zinc-400">
            {game.white.username} vs {game.black.username} · {game.timeClass} {game.timeControl} ·{" "}
            {new Date(game.endTime * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
            {analysis.opening ? ` · ${analysis.opening.eco} ${analysis.opening.name}` : game.opening ? ` · ${game.opening}` : ""}
          </p>
        </div>
        <button onClick={() => onStart(0)} className="rounded-lg bg-green-600 px-6 py-2.5 text-base font-bold hover:bg-green-500" data-testid="start-review">
          Start review ▶
        </button>
      </div>

      {/* Player cards */}
      <div className="grid grid-cols-2 gap-3">
        {sides.map((s) => (
          <div key={s} className={`rounded-lg border p-3 ${game.userColor === s ? "border-blue-500/60 bg-blue-950/20" : "border-zinc-800"}`}>
            <div className="flex items-center gap-2 text-sm font-semibold">
              <span className={`inline-block h-3 w-3 rounded-sm border border-zinc-500 ${s === "white" ? "bg-white" : "bg-zinc-900"}`} />
              {game[s].username} <span className="font-normal text-zinc-400">({game[s].rating})</span>
              {game.userColor === s && <span className="text-xs text-blue-400">you</span>}
            </div>
            <div className="mt-2 flex items-end gap-4">
              <div>
                <div className="text-3xl font-bold">{analysis[s].accuracy.toFixed(1)}</div>
                <div className="text-xs text-zinc-400">Accuracy</div>
              </div>
              <div>
                <div className="text-2xl font-semibold text-zinc-200">≈{estimateRating(analysis[s].accuracy)}</div>
                <div className="text-xs text-zinc-400" title="Rough estimate derived from accuracy only; not a real rating.">
                  Est. game rating (estimate)
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {/* Counts */}
        <table className="w-full rounded-lg border border-zinc-800 text-sm" data-testid="counts-table">
          <thead>
            <tr className="text-xs text-zinc-400">
              <th className="px-2 py-1 text-left font-normal">Move quality</th>
              {sides.map((s) => (
                <th key={s} className="px-2 py-1 text-right font-semibold">
                  {game[s].username}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {CLASSIFICATIONS.map((c) => (
              <tr key={c} className="odd:bg-zinc-900/60">
                <td className={`px-2 py-0.5 ${CLASS_STYLE[c].text}`}>
                  <span
                    className="mr-2 inline-flex h-5 w-6 items-center justify-center rounded text-[11px] font-bold text-white"
                    style={{ backgroundColor: CLASS_STYLE[c].color }}
                  >
                    {CLASS_STYLE[c].symbol}
                  </span>
                  {c}
                </td>
                {sides.map((s) => (
                  <td key={s} className={`px-2 py-0.5 text-right font-mono ${analysis[s].counts[c] ? CLASS_STYLE[c].text : "text-zinc-600"}`}>
                    {analysis[s].counts[c]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>

        <div className="flex flex-col gap-3">
          {/* Phase accuracy */}
          <table className="w-full rounded-lg border border-zinc-800 text-sm" data-testid="phase-table">
            <thead>
              <tr className="text-xs text-zinc-400">
                <th className="px-2 py-1 text-left font-normal">Phase accuracy</th>
                {sides.map((s) => (
                  <th key={s} className="px-2 py-1 text-right font-semibold">
                    {game[s].username}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {PHASES.map((p) => (
                <tr key={p} className="odd:bg-zinc-900/60">
                  <td className="px-2 py-0.5 capitalize">{p}</td>
                  {sides.map((s) => {
                    const v = phases[s][p];
                    return (
                      <td key={s} className="px-2 py-0.5 text-right font-mono">
                        {v === null ? <span className="text-zinc-600">n/a</span> : v.toFixed(0)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <div>
            <div className="mb-1 text-xs text-zinc-400">Evaluation (White on top half) · dots = key moments</div>
            <EvalGraph analysis={analysis} onSelect={(p) => onStart(p)} height={110} />
          </div>
        </div>
      </div>

      {/* Key moments */}
      <div className="rounded-lg border border-zinc-800 p-3">
        <h3 className="mb-2 text-sm font-semibold text-zinc-300">Key moments</h3>
        {moments.length === 0 && <p className="text-sm text-zinc-500">A quiet game without big swings.</p>}
        <ul className="flex flex-col gap-1" data-testid="key-moments">
          {moments.map((k) => (
            <li key={k.ply}>
              <button onClick={() => onStart(k.ply)} className="flex w-full items-start gap-2 rounded px-1 py-1 text-left text-sm hover:bg-zinc-800">
                <span
                  className="mt-0.5 inline-flex h-5 w-7 shrink-0 items-center justify-center rounded text-[11px] font-bold text-white"
                  style={{ backgroundColor: CLASS_STYLE[k.move.classification].color }}
                >
                  {CLASS_STYLE[k.move.classification].symbol}
                </span>
                <span className="w-24 shrink-0 whitespace-nowrap font-mono text-zinc-400">
                  {k.move.moveNumber}
                  {k.move.color === "white" ? "." : "..."} {k.move.san}
                </span>
                <span className="text-zinc-200">
                  <span className="text-zinc-500">{game[k.move.color].username}: </span>
                  {k.text}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="rounded-lg bg-zinc-800/60 p-3 text-sm leading-relaxed text-zinc-200" data-testid="summary">
        <h3 className="mb-1 text-sm font-semibold text-zinc-300">Summary</h3>
        {summary}
      </div>
    </div>
  );
}
