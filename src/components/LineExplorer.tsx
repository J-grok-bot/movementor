"use client";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import { formatEval, numberedLine, type LineInfo } from "@/lib/analysis";
import { uciLineToSan, type UserMove } from "@/lib/sandbox";
import { useBoardInput } from "./useBoardInput";
import { useLiveEval } from "./useLiveEval";

const Chessboard = dynamic(() => import("react-chessboard").then((m) => m.Chessboard), {
  ssr: false,
  loading: () => <div className="aspect-square w-full animate-pulse rounded bg-slate-700" />,
});

export interface ExplorerState {
  id: string;
  line: LineInfo;
  step: number;
  context: string; // e.g. "Instead of 17... exf3" or, for a sandbox, "Your analysis from 14... Re8"
  /** User-made variation (moves entered on a board) rather than an engine line. */
  sandbox?: boolean;
}

/**
 * Hypothetical-line explorer: a raised card that slides out beside the real board (desktop, over the
 * unused game list) or up as a bottom sheet (narrow screens). Uses a different board theme so the
 * explored line can't be confused with the played game.
 */
export function LineExplorer({
  state,
  fens,
  flipped,
  closing,
  playedFen,
  onStep,
  onClose,
  onUserMove,
  onUndo,
  layout = "auto",
}: {
  onUserMove: (m: UserMove) => void;
  onUndo: () => void;
  layout?: "auto" | "sheet";
  state: ExplorerState;
  fens: { fen: string; from: string; to: string }[];
  flipped: boolean;
  closing: boolean;
  playedFen: string;
  onStep: (step: number) => void;
  onClose: () => void;
}) {
  // Enter animation: render hidden, then flip to shown on the next frame.
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(id);
  }, []);
  const shown = entered && !closing;
  const side = layout === "auto"; // "auto": side card on lg+, sheet below; "sheet": always a sheet

  const { line, step } = state;
  const pos = step > 0 ? fens[step - 1] : null;
  const fen = pos?.fen ?? line.startFen;
  const tokens = useMemo(() => numberedLine(line.startFen, line.san), [line]);
  const first = tokens[0] ? `${tokens[0].label} ${tokens[0].san}`.trim() : "";
  const sandbox = !!state.sandbox;
  // Live engine eval for the position on the explorer board (sandbox lines only; engine lines carry their own).
  const live = useLiveEval(sandbox && shown ? fen : null);
  const liveSan = useMemo(() => (live ? uciLineToSan(fen, live.pv, 6) : []), [live, fen]);
  const liveTokens = useMemo(() => (liveSan.length ? numberedLine(fen, liveSan) : []), [liveSan, fen]);
  const input = useBoardInput(fen, shown, onUserMove);

  const boardOptions = useMemo(() => {
    const squareStyles: Record<string, React.CSSProperties> = {};
    if (pos) {
      squareStyles[pos.from] = { backgroundColor: "rgba(250, 204, 21, 0.45)" };
      squareStyles[pos.to] = { backgroundColor: "rgba(250, 204, 21, 0.65)" };
    }
    Object.assign(squareStyles, input.styles);
    const next = line.uci[step];
    const arrows = next ? [{ startSquare: next.slice(0, 2), endSquare: next.slice(2, 4), color: "rgba(250, 204, 21, 0.85)" }] : [];
    const best = live?.pv[0];
    if (sandbox && !next && best) arrows.push({ startSquare: best.slice(0, 2), endSquare: best.slice(2, 4), color: "rgba(34, 197, 94, 0.8)" });
    return {
      id: "explorer-board",
      position: fen,
      boardOrientation: (flipped ? "black" : "white") as "white" | "black",
      allowDragging: shown,
      ...input.handlers,
      allowDrawingArrows: false,
      arrows,
      squareStyles,
      animationDurationInMs: 180,
      darkSquareStyle: { backgroundColor: "#6d7fa6" },
      lightSquareStyle: { backgroundColor: "#dfe5f1" },
    };
  }, [fen, flipped, pos, line.uci, step, input.styles, input.handlers, live, sandbox, shown]);

  const miniOptions = useMemo(
    () => ({
      id: "played-mini-board",
      position: playedFen,
      boardOrientation: (flipped ? "black" : "white") as "white" | "black",
      allowDragging: false,
      showNotation: false,
      showAnimations: false,
      darkSquareStyle: { backgroundColor: "#769656" },
      lightSquareStyle: { backgroundColor: "#eeeed2" },
    }),
    [playedFen, flipped],
  );

  const stripRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Scroll only the strip itself (scrollIntoView could also move the page on mobile).
    const box = stripRef.current;
    const el = box?.querySelector<HTMLElement>(`[data-xstep="${step}"]`);
    if (!box || !el) return;
    const top = el.offsetTop - box.offsetTop;
    if (top < box.scrollTop) box.scrollTop = top;
    else if (top + el.offsetHeight > box.scrollTop + box.clientHeight) box.scrollTop = top + el.offsetHeight - box.clientHeight;
  }, [step, tokens.length]);

  const btn = "rounded-md bg-slate-700/80 px-3 py-1.5 text-base text-slate-100 hover:bg-slate-600 disabled:opacity-40";

  return (
    <>
      {/* Backdrop for the bottom-sheet layout (narrow screens only) */}
      <div
        className={`fixed inset-0 z-40 bg-black/50 transition-opacity duration-300 motion-reduce:transition-none ${side ? "lg:hidden" : ""} ${shown ? "opacity-100" : "opacity-0"}`}
        onClick={onClose}
        aria-hidden
      />
      <section
        role="dialog"
        aria-label={`Exploring engine line ${first}`}
        data-testid="line-explorer"
        data-state={shown ? "open" : "closed"}
        className={[
          // sheet (default / mobile)
          "fixed inset-x-0 bottom-0 z-50 max-h-[92vh] overflow-y-auto rounded-t-2xl",
          // side card (desktop): slides out to the left of the real board, over the game list column
          side ? "lg:absolute lg:inset-x-auto lg:bottom-auto lg:right-full lg:top-0 lg:mr-4 lg:max-h-none lg:w-[320px] lg:overflow-visible lg:rounded-xl" : "mx-auto max-w-xl",
          "border border-indigo-400/60 bg-gradient-to-b from-slate-800 to-slate-900 p-3 shadow-2xl shadow-indigo-950/60 ring-1 ring-indigo-500/20",
          "transition-[transform,opacity] duration-300 ease-out motion-reduce:transition-none",
          shown ? "translate-y-0 opacity-100 lg:translate-x-0" : side ? "translate-y-full opacity-0 lg:translate-x-10 lg:translate-y-0" : "translate-y-full opacity-0",
        ].join(" ")}
      >
        <div className={`mx-auto mb-2 h-1 w-10 rounded-full bg-slate-600 ${side ? "lg:hidden" : ""}`} />
        <header className="mb-2 flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className={`text-[10px] font-semibold uppercase tracking-wider ${sandbox ? "text-amber-300" : "text-indigo-300"}`}>
              {sandbox ? "Your analysis · not played" : "Hypothetical line"}
            </div>
            <h3 className="text-sm font-bold text-slate-50" data-testid="explorer-title">
              {sandbox ? (
                state.context
              ) : (
                <>
                  Exploring: {first} line <span className="font-normal text-indigo-200">(not played)</span>
                </>
              )}
            </h3>
            <p className="text-xs text-slate-400">{sandbox ? "Move pieces to keep analysing. Stockfish evaluates every position." : state.context}</p>
          </div>
          <span
            className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs font-bold text-slate-900"
            title={sandbox ? "Live Stockfish evaluation of this position" : "Engine evaluation of this line"}
            data-testid="explorer-eval"
          >
            {sandbox ? (live ? formatEval(live.ev) : "…") : formatEval(line.eval)}
          </span>
        </header>

        <div className="flex gap-3">
          <div
            className={`relative min-w-0 flex-1 overflow-hidden rounded-md ring-2 ${sandbox ? "ring-amber-400/60" : "ring-indigo-400/50"}`}
            data-testid="explorer-board"
            data-fen={fen}
          >
            <Chessboard options={boardOptions} />
            {input.picker}
          </div>
          {/* Mini "played game" board: only in the sheet layout, where the real board is covered */}
          <div className={`w-24 shrink-0 ${side ? "lg:hidden" : ""}`} data-testid="explorer-played-mini">
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Played game</div>
            <div className="pointer-events-none overflow-hidden rounded opacity-80 grayscale-[30%]">
              <Chessboard options={miniOptions} />
            </div>
          </div>
        </div>

        {sandbox && (
          <div className="mt-2 min-h-[2.75rem] rounded bg-slate-950/50 px-2 py-1 text-xs text-slate-300" data-testid="live-eval">
            {live ? (
              <>
                <span className="font-semibold text-slate-100">Stockfish</span> <span className="text-slate-500">depth {live.depth}</span>
                {liveSan[0] && (
                  <>
                    {" · best "}
                    <span className="font-mono font-semibold text-green-400" data-testid="live-best">
                      {liveSan[0]}
                    </span>
                  </>
                )}
                <div className="truncate font-mono text-slate-400">
                  {liveTokens.map((t) => `${t.label}${t.label ? " " : ""}${t.san}`).join(" ") || "Game over"}
                </div>
              </>
            ) : (
              <span className="text-slate-500">Stockfish is thinking…</span>
            )}
          </div>
        )}

        {/* Move strip */}
        <div ref={stripRef} className="mt-2 flex max-h-24 flex-wrap gap-x-1 gap-y-0.5 overflow-y-auto rounded bg-slate-950/50 p-1.5 text-sm" data-testid="explorer-strip">
          <button
            data-xstep={0}
            onClick={() => onStep(0)}
            className={`rounded px-1 font-mono text-xs ${step === 0 ? "bg-yellow-400 text-slate-900" : "text-slate-400 hover:bg-slate-700"}`}
          >
            start
          </button>
          {tokens.map((t) => (
            <span key={t.index} className="whitespace-nowrap">
              {t.label && <span className="mr-0.5 text-slate-500">{t.label}</span>}
              <button
                data-xstep={t.index + 1}
                onClick={() => onStep(t.index + 1)}
                className={`rounded px-1 font-mono ${step === t.index + 1 ? "bg-yellow-400 font-bold text-slate-900" : "text-slate-200 hover:bg-slate-700"}`}
              >
                {t.san}
              </button>
            </span>
          ))}
        </div>

        <div className="mt-2 flex items-center justify-between gap-2">
          <div className="flex gap-1">
            <button className={btn} title="Line start (Home)" onClick={() => onStep(0)} disabled={step === 0}>
              ⏮
            </button>
            <button className={btn} title="Previous (←)" onClick={() => onStep(step - 1)} disabled={step === 0}>
              ◀
            </button>
            <button className={btn} title="Next (→)" onClick={() => onStep(step + 1)} disabled={step >= fens.length}>
              ▶
            </button>
            <button className={btn} title="Line end (End)" onClick={() => onStep(fens.length)} disabled={step >= fens.length}>
              ⏭
            </button>
          </div>
          {sandbox && (
            <button className={btn} title="Undo last move" onClick={onUndo} disabled={step === 0} data-testid="sandbox-undo">
              ↶
            </button>
          )}
          <span className="font-mono text-xs text-slate-400" data-testid="explorer-step">
            {step}/{fens.length}
          </span>
        </div>
        <button
          onClick={onClose}
          className="mt-2 w-full rounded-md bg-indigo-600 py-2 text-sm font-semibold text-white hover:bg-indigo-500"
          data-testid="explorer-close"
        >
          ← Back to game <span className="font-normal text-indigo-200">(Esc)</span>
        </button>
      </section>
    </>
  );
}
