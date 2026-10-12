"use client";
import { formatEval, whiteWinPercent, type Eval } from "@/lib/analysis";

export function EvalBar({ ev, flipped }: { ev: Eval | null; flipped: boolean }) {
  const white = ev ? whiteWinPercent(ev) : 50;
  const label = ev ? formatEval(ev) : "…";
  const whiteAhead = white >= 50;
  return (
    <div
      className={`relative flex w-6 shrink-0 overflow-hidden rounded bg-zinc-800 ${flipped ? "flex-col" : "flex-col-reverse"}`}
      title={`Evaluation ${label}`}
    >
      <div className="bg-zinc-100 transition-all duration-300" style={{ height: `${white}%` }} />
      <span
        className={`absolute left-0 right-0 text-center text-[10px] font-bold ${
          whiteAhead !== flipped ? "bottom-1" : "top-1"
        } ${whiteAhead ? "text-zinc-900" : "text-zinc-100"}`}
      >
        {label.replace("+", "")}
      </span>
    </div>
  );
}
