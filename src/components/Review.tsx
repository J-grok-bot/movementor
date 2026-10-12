"use client";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { analyzePgn, formatEval, lineFens, numberedLine, type GameAnalysis, type MoveAnalysis, type Classification, type LineInfo } from "@/lib/analysis";
import { runUserAnalysis } from "@/lib/engineManager";
import { getCachedAnalysis, saveAnalysis } from "@/lib/analysisCache";
import { CLASS_STYLE, FLAGGED } from "@/lib/classification";
import { CLASSIFICATIONS } from "@/lib/classify";
import { loadOpeningBook } from "@/lib/openingBook";
import { getExplanationRenderer, type Explanation } from "@/lib/explain";
import { Overview } from "./Overview";
import { LineExplorer, type ExplorerState } from "./LineExplorer";
import type { GameSummary } from "@/lib/chesscom";
import { EvalBar } from "./EvalBar";
import { EvalGraph } from "./EvalGraph";

const Chessboard = dynamic(() => import("react-chessboard").then((m) => m.Chessboard), {
  ssr: false,
  loading: () => <div className="aspect-square w-full animate-pulse rounded bg-zinc-800" />,
});

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
export type Status = { kind: "idle" } | { kind: "loading-engine" } | { kind: "analyzing"; done: number; total: number } | { kind: "done"; seconds: number | null } | { kind: "error"; message: string };

export function Review({
  game,
  depth,
  multiPv = 2,
  onStatus,
  explorerLayout = "auto",
}: {
  game: GameSummary;
  depth: number;
  multiPv?: number;
  onStatus?: (s: Status) => void;
  explorerLayout?: "auto" | "sheet";
}) {
  const [analysis, setAnalysis] = useState<GameAnalysis | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [ply, setPly] = useState(0);
  const [mode, setMode] = useState<"overview" | "review">("overview");
  const [engineName, setEngineName] = useState<string>("Stockfish");
  // Engine-line preview: board temporarily shows a position inside an engine line.
  const [preview, setPreview] = useState<ExplorerState | null>(null);
  const [closing, setClosing] = useState(false);
  const closeTimer = useRef<number | null>(null);
  const flipped = game.userColor === "black";

  useEffect(() => onStatus?.(status), [status, onStatus]);

  // Run analysis whenever the game or settings change (cached in localStorage). Uses the shared
  // engine; opening a game pre-empts any background preloading.
  useEffect(() => {
    const signal = { aborted: false };
    setAnalysis(null);
    setPly(0);
    setMode("overview");
    const cached = getCachedAnalysis(game.id, depth, multiPv);
    if (cached) {
      setAnalysis(cached);
      setStatus({ kind: "done", seconds: null });
      return;
    }
    setStatus({ kind: "loading-engine" });
    (async () => {
      try {
        const book = await loadOpeningBook().catch(() => null);
        const t0 = performance.now();
        const result = await runUserAnalysis(multiPv, (eng) => {
          if (!signal.aborted) setEngineName(eng.name);
          return analyzePgn(game.pgn, eng.evaluate, {
            depth,
            multiPv,
            book,
            signal,
            onProgress: (done, total) => !signal.aborted && setStatus({ kind: "analyzing", done, total }),
          });
        });
        saveAnalysis(game.id, depth, multiPv, result);
        if (signal.aborted) return;
        setAnalysis(result);
        setStatus({ kind: "done", seconds: (performance.now() - t0) / 1000 });
      } catch (e) {
        if (!signal.aborted) setStatus({ kind: "error", message: e instanceof Error ? e.message : String(e) });
      }
    })();
    return () => {
      signal.aborted = true;
    };
  }, [game, depth, multiPv]);

  const maxPly = analysis?.moves.length ?? 0;
  const go = useCallback(
    (p: number) => {
      setPreview(null);
      setPly(Math.max(0, Math.min(maxPly, p)));
    },
    [maxPly],
  );
  const closePreview = useCallback(() => {
    const reduced = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      setPreview(null);
      return;
    }
    setClosing(true);
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = null;
      setPreview(null);
      setClosing(false);
    }, 300);
  }, []);
  const openPreview = useCallback((id: string, line: LineInfo, step: number, context: string) => {
    if (closeTimer.current) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    setClosing(false);
    setPreview({ id, line, step, context });
  }, []);
  const previewFens = useMemo(() => (preview ? lineFens(preview.line.startFen, preview.line.uci) : []), [preview]);
  const stepPreview = useCallback(
    (step: number) => setPreview((pv) => (pv ? { ...pv, step: Math.max(0, Math.min(previewFens.length, step)) } : pv)),
    [previewFens.length],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT" || mode !== "review") return;
      if (preview) {
        if (e.key === "ArrowLeft") stepPreview(preview.step - 1);
        else if (e.key === "ArrowRight") stepPreview(preview.step + 1);
        else if (e.key === "Home" || e.key === "ArrowUp") stepPreview(0);
        else if (e.key === "End" || e.key === "ArrowDown") stepPreview(previewFens.length);
        else if (e.key === "Escape" || e.key === "Backspace") closePreview();
        else return;
        e.preventDefault();
        return;
      }
      if (e.key === "ArrowLeft") go(ply - 1);
      else if (e.key === "ArrowRight") go(ply + 1);
      else if (e.key === "Home" || e.key === "ArrowUp") go(0);
      else if (e.key === "End" || e.key === "ArrowDown") go(maxPly);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, ply, maxPly, preview, previewFens.length, stepPreview, mode, closePreview]);

  const sideRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = sideRef.current;
    if (!el) return;
    if (mode !== "review") {
      el.style.minHeight = "";
      return;
    }
    const h = el.getBoundingClientRect().height;
    if (h > (parseFloat(el.style.minHeight) || 0)) el.style.minHeight = `${Math.ceil(h)}px`;
  });

  const current: MoveAnalysis | null = analysis && ply > 0 ? analysis.moves[ply - 1] : null;
  // The real board always shows the played game; explored lines live in the LineExplorer overlay.
  const gameFen = current ? current.fenAfter : (analysis?.initialFen ?? START_FEN);
  const fen = gameFen;
  const ev = current ? current.evalAfter : (analysis?.initialEval ?? null);
  const curLabel = current ? `${current.moveNumber}${current.color === "white" ? "." : "..."} ${current.san}` : "";
  // Lines from the position before the current move ("instead of this move") and after it ("from here").
  const linesBefore: LineInfo[] = current ? current.lines : (analysis?.moves[0]?.lines ?? []);
  const lineAfter: LineInfo | null = current ? current.continuation : null;

  const boardOptions = useMemo(() => {
    const squareStyles: Record<string, React.CSSProperties> = {};
    const arrows: { startSquare: string; endSquare: string; color: string }[] = [];
    if (current) {
      const c = CLASS_STYLE[current.classification].color;
      squareStyles[current.from] = { backgroundColor: `${c}66` };
      squareStyles[current.to] = { backgroundColor: `${c}99` };
      if (FLAGGED.includes(current.classification) && current.bestMoveUci && !preview) {
        arrows.push({ startSquare: current.bestMoveUci.slice(0, 2), endSquare: current.bestMoveUci.slice(2, 4), color: "#22c55ecc" });
      }
    }
    return {
      id: "review-board",
      position: fen,
      boardOrientation: (flipped ? "black" : "white") as "white" | "black",
      allowDragging: false,
      allowDrawingArrows: true,
      arrows,
      squareStyles,
      animationDurationInMs: 150,
      darkSquareStyle: { backgroundColor: "#769656" },
      lightSquareStyle: { backgroundColor: "#eeeed2" },
    };
  }, [fen, flipped, current, preview]);

  const topPlayer = flipped ? game.white : game.black;
  const bottomPlayer = flipped ? game.black : game.white;

  if (analysis && mode === "overview") {
    return (
      <div className="flex flex-col gap-2">
        <StatusLine status={status} depth={depth} engineName={engineName} />
        <Overview
          analysis={analysis}
          game={game}
          onStart={(p) => {
            setMode("review");
            go(p);
          }}
        />
      </div>
    );
  }

  const exploring = !!preview && !closing;
  return (
    <div className="relative flex flex-col gap-4 lg:flex-row">
      {analysis && !preview && (
        <MobileNav ply={ply} maxPly={maxPly} label={curLabel} current={current} onGo={go} />
      )}
      {preview && (
        <LineExplorer
          key={preview.id}
          layout={explorerLayout}
          state={preview}
          fens={previewFens}
          flipped={flipped}
          closing={closing}
          playedFen={gameFen}
          onStep={stepPreview}
          onClose={closePreview}
        />
      )}
      {/* Board column (the played game; dimmed and frozen while a line is being explored) */}
      <div
        className={`w-full max-w-[560px] shrink-0 transition-[opacity,filter] duration-300 motion-reduce:transition-none ${
          exploring ? "opacity-60 saturate-50" : ""
        }`}
        data-testid="game-board-column"
        data-frozen={exploring ? "true" : "false"}
      >
        <PlayerTag p={topPlayer} />
        <div className={`mb-1 rounded px-2 py-1 text-xs ${exploring ? "bg-zinc-800 text-zinc-300" : "invisible"}`} aria-hidden={!exploring}>
          🔒 Played game, frozen{curLabel ? ` after ${curLabel}` : " at the start"}
        </div>
        <div className="flex gap-2">
          <EvalBar ev={ev} flipped={flipped} />
          <div className="relative flex-1">
            <Chessboard options={boardOptions} />
            {current && (
              <div
                className="pointer-events-none absolute right-1 top-1 rounded-full px-2 py-0.5 text-xs font-bold text-white shadow"
                style={{ backgroundColor: CLASS_STYLE[current.classification].color }}
              >
                {CLASS_STYLE[current.classification].symbol} {current.classification}
              </div>
            )}
          </div>
        </div>
        <PlayerTag p={bottomPlayer} />
        <div className="mt-3 hidden justify-center gap-2 lg:flex">
          {[
            ["⏮", 0, "First (Home)"],
            ["◀", ply - 1, "Previous (←)"],
            ["▶", ply + 1, "Next (→)"],
            ["⏭", maxPly, "Last (End)"],
          ].map(([label, target, title]) => (
            <button
              key={String(title)}
              title={String(title)}
              onClick={() => go(Number(target))}
              disabled={!analysis || !!preview}
              className="rounded bg-zinc-700 px-4 py-2 text-lg hover:bg-zinc-600 disabled:opacity-40"
            >
              {label}
            </button>
          ))}
        </div>
        <p className="mt-1 hidden text-center text-xs text-zinc-500 lg:block">Use ← → arrow keys to step through moves</p>
      </div>

      {/* Side panel. Its height only ratchets up while stepping, so a shorter explanation can't shrink the page
          and make the browser clamp (jump) the scroll position. */}
      <div ref={sideRef} className="flex min-w-0 flex-1 flex-col gap-3">
        <StatusLine status={status} depth={depth} engineName={engineName} />
        {analysis && (
          <>
            <div className="flex items-center justify-between">
              <button onClick={() => setMode("overview")} className="rounded bg-zinc-800 px-3 py-1 text-xs hover:bg-zinc-700" data-testid="back-overview">
                ← Overview
              </button>
            </div>
            <Summary analysis={analysis} game={game} />
            <EvalGraph analysis={analysis} ply={ply} onSelect={go} />
            <MoveDetail move={current} prev={current ? (analysis.moves[current.ply - 2] ?? null) : null} opening={analysis.opening?.name ?? null} />
            <EngineLines
              title={current ? `Engine's best instead of ${current.moveNumber}${current.color === "white" ? "." : "..."} ${current.san}` : "Engine's best from the start"}
              lines={linesBefore}
              idPrefix={`b${ply}`}
              preview={preview}
              onPreview={(id, line, step) => openPreview(id, line, step, current ? `Instead of ${curLabel}, which was played` : "From the starting position")}
            />
            {lineAfter && (
              <EngineLines
                title="Engine's line from this position"
                lines={[lineAfter]}
                idPrefix={`a${ply}`}
                preview={preview}
                onPreview={(id, line, step) => openPreview(id, line, step, `Engine continuation after ${curLabel}`)}
              />
            )}
            <MoveList moves={analysis.moves} ply={ply} onSelect={go} />
          </>
        )}
        <a href={game.url} target="_blank" rel="noreferrer" className="text-xs text-zinc-500 underline">
          View original game on Chess.com
        </a>
      </div>
    </div>
  );
}

function PlayerTag({ p }: { p: { username: string; rating: number } }) {
  return (
    <div className="my-1 pl-8 text-sm font-semibold">
      {p.username} <span className="font-normal text-zinc-400">({p.rating})</span>
    </div>
  );
}

function StatusLine({ status, depth, engineName }: { status: Status; depth: number; engineName: string }) {
  if (status.kind === "loading-engine") return <p className="text-sm text-zinc-400">Loading Stockfish (WASM)…</p>;
  if (status.kind === "error") return <p className="text-sm text-red-400">Analysis failed: {status.message}</p>;
  if (status.kind === "analyzing") {
    const pct = Math.round((status.done / status.total) * 100);
    return (
      <div data-testid="progress">
        <div className="mb-1 flex justify-between text-sm text-zinc-300">
          <span>Analyzing with {engineName} at depth {depth}…</span>
          <span>
            {status.done}/{status.total} positions ({pct}%)
          </span>
        </div>
        <div className="h-2 overflow-hidden rounded bg-zinc-800">
          <div className="h-full bg-blue-500 transition-all" style={{ width: `${pct}%` }} />
        </div>
      </div>
    );
  }
  if (status.kind === "done")
    return (
      <p className="text-xs text-zinc-500" data-testid="analysis-done">
        Analyzed at depth {depth} with {engineName}
        {status.seconds !== null ? ` in ${status.seconds.toFixed(1)}s` : " (cached)"}
      </p>
    );
  return null;
}

function Summary({ analysis, game }: { analysis: GameAnalysis; game: GameSummary }) {
  const sides = ["white", "black"] as const;
  return (
    <div className="rounded-lg border border-zinc-800 p-2 text-sm">
      {sides.map((s) => (
        <div key={s} className="flex flex-wrap items-center gap-x-2 gap-y-1 py-0.5">
          <span className="w-32 truncate font-semibold">
            {game[s].username}
            {game.userColor === s ? " (you)" : ""}
          </span>
          <span className="w-12 font-bold">{analysis[s].accuracy.toFixed(1)}</span>
          {CLASSIFICATIONS.filter((c) => analysis[s].counts[c]).map((c) => (
            <span key={c} className={`text-xs ${CLASS_STYLE[c].text}`} title={c}>
              {CLASS_STYLE[c].symbol}
              {analysis[s].counts[c]}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

const ARTICLE: Partial<Record<Classification, string>> = { Inaccuracy: "an inaccuracy", Excellent: "excellent", Great: "a great move", Brilliant: "brilliant", Book: "a book move", Miss: "a miss" };

function MoveDetail({ move, prev, opening }: { move: MoveAnalysis | null; prev: MoveAnalysis | null; opening: string | null }) {
  const [rendered, setRendered] = useState<Explanation | null>(null);
  // Optional wording layer (off by default): only runs if a non-"rules" renderer is configured.
  useEffect(() => {
    setRendered(null);
    const r = getExplanationRenderer();
    if (!move || r.id === "rules") return;
    let live = true;
    r.render(
      { ...move, isBest: move.classification === "Best" || move.bestMoveUci === move.uci, opening, previous: prev ? { san: prev.san, classification: prev.classification, fenBefore: prev.fenBefore, captured: prev.san.includes("x") } : null, formatEval },
      move.explanation,
    )
      .then((e) => live && setRendered(e))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [move, prev, opening]);

  if (!move) return <div className="min-h-[8.5rem] rounded-lg bg-zinc-800/60 p-3 text-sm text-zinc-400">Starting position. Press → to step through the game.</div>;
  const s = CLASS_STYLE[move.classification];
  const exp = rendered ?? move.explanation;
  const label = ARTICLE[move.classification] ?? (move.classification === "Best" ? "the best move" : `a ${move.classification.toLowerCase()}`);
  return (
    <div className="min-h-[8.5rem] rounded-lg bg-zinc-800/60 p-3 text-sm" data-testid="move-detail">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2">
          <span className="inline-flex h-6 min-w-7 items-center justify-center rounded px-1 text-xs font-bold text-white" style={{ backgroundColor: s.color }}>
            {s.symbol}
          </span>
          <span className="font-mono font-semibold">
            {move.moveNumber}
            {move.color === "white" ? "." : "..."} {move.san}
          </span>
          <span className={`font-semibold ${s.text}`}>is {label}</span>
        </span>
        <span className="font-mono text-zinc-300">
          {formatEval(move.evalBefore)} → {formatEval(move.evalAfter)}
        </span>
      </div>
      <div className="mt-2 border-l-2 pl-2" style={{ borderColor: s.color }} data-testid="coach">
        <p className="text-zinc-100">{exp.headline}</p>
        {exp.details.map((d, i) => (
          <p key={i} className="mt-0.5 text-zinc-400">
            {d}
          </p>
        ))}
      </div>
    </div>
  );
}

function EngineLines({
  title,
  lines,
  idPrefix,
  preview,
  onPreview,
}: {
  title: string;
  lines: LineInfo[];
  idPrefix: string;
  preview: { id: string; step: number } | null;
  onPreview: (id: string, line: LineInfo, step: number) => void;
}) {
  if (!lines.length) return null;
  return (
    <div className="min-h-[7rem] rounded-lg border border-zinc-800 p-2 text-sm" data-testid="engine-lines">
      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-400">{title}</div>
      {lines.map((line) => {
        const id = `${idPrefix}-${line.rank}`;
        const active = preview?.id === id;
        return (
          <div key={id} className={`flex items-start gap-2 rounded px-1 py-1 ${active ? "bg-blue-900/30" : ""}`}>
            <span
              className={`mt-0.5 w-14 shrink-0 rounded px-1 text-center font-mono text-xs font-bold ${
                line.rank === 1 ? "bg-zinc-100 text-zinc-900" : "bg-zinc-700 text-zinc-100"
              }`}
              title={line.rank === 1 ? "Top engine line" : `Engine line #${line.rank}`}
            >
              {formatEval(line.eval)}
            </span>
            <div className="min-w-0 flex-1 leading-6">
              {numberedLine(line.startFen, line.san).map((t) => (
                <span key={t.index} className="whitespace-nowrap">
                  {t.label && <span className="mr-0.5 text-zinc-500">{t.label}</span>}
                  <button
                    data-line={id}
                    data-step={t.index + 1}
                    onClick={() => onPreview(id, line, t.index + 1)}
                    className={`mr-1 rounded px-0.5 font-mono hover:bg-zinc-700 ${
                      active && preview!.step === t.index + 1 ? "bg-blue-600 text-white" : t.index === 0 ? "font-semibold text-green-400" : "text-zinc-200"
                    }`}
                  >
                    {t.san}
                  </button>
                </span>
              ))}
            </div>
            <button
              onClick={() => onPreview(id, line, 1)}
              className="shrink-0 rounded bg-zinc-700 px-2 py-0.5 text-xs hover:bg-zinc-600"
              title="Play this line on the board"
            >
              ▶ Preview
            </button>
          </div>
        );
      })}
    </div>
  );
}

function MoveList({ moves, ply, onSelect }: { moves: MoveAnalysis[]; ply: number; onSelect: (p: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Scroll only the list's own container (never the window: scrollIntoView would also scroll the page on mobile).
    const box = ref.current;
    const el = box?.querySelector<HTMLElement>(`[data-ply="${ply}"]`);
    if (!box || !el) return;
    const top = el.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop;
    const bottom = top + el.offsetHeight;
    if (top < box.scrollTop) box.scrollTop = Math.max(0, top - 4);
    else if (bottom > box.scrollTop + box.clientHeight) box.scrollTop = bottom - box.clientHeight + 4;
  }, [ply]);
  const rows: [MoveAnalysis, MoveAnalysis | undefined][] = [];
  for (let i = 0; i < moves.length; i += 2) {
    if (moves[i].color === "black") {
      rows.push([moves[i], undefined]); // game started with black to move (custom FEN)
      i--;
      continue;
    }
    rows.push([moves[i], moves[i + 1]]);
  }
  const cell = (m?: MoveAnalysis) =>
    m ? (
      <button
        data-ply={m.ply}
        onClick={() => onSelect(m.ply)}
        className={`flex w-full items-center justify-between rounded px-2 py-0.5 text-left font-mono ${ply === m.ply ? "bg-blue-600/40" : "hover:bg-zinc-800"}`}
      >
        <span>{m.san}</span>
        {m.classification !== "Good" && (
          <span className="text-xs font-bold" style={{ color: CLASS_STYLE[m.classification].color }}>
            {CLASS_STYLE[m.classification].symbol}
          </span>
        )}
      </button>
    ) : (
      <span />
    );
  return (
    <div ref={ref} className="max-h-56 overflow-y-auto overscroll-contain rounded-lg border lg:max-h-80 border-zinc-800 text-sm" data-testid="move-list">
      {rows.map(([w, b], i) => (
        <div key={i} className="grid grid-cols-[3rem_1fr_1fr] items-center gap-1 px-1 odd:bg-zinc-900">
          <span className="text-right text-zinc-500">{w.moveNumber}.</span>
          {cell(w.color === "white" ? w : undefined)}
          {cell(w.color === "black" ? w : b)}
        </div>
      ))}
    </div>
  );
}

/** Mobile-only bottom bar: always reachable, sits above Safari's toolbar via the safe-area inset. */
function MobileNav({
  ply,
  maxPly,
  label,
  current,
  onGo,
}: {
  ply: number;
  maxPly: number;
  label: string;
  current: MoveAnalysis | null;
  onGo: (p: number) => void;
}) {
  const btn = "flex-1 rounded-lg bg-zinc-700 py-2.5 text-lg active:bg-zinc-600 disabled:opacity-40";
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 border-t border-zinc-800 bg-zinc-950/95 px-3 pt-2 backdrop-blur lg:hidden"
      style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 0.5rem)" }}
      data-testid="mobile-nav"
    >
      <div className="mb-1.5 flex items-center justify-center gap-2 text-xs text-zinc-400" data-testid="mobile-nav-counter">
        <span>
          Move {ply}/{maxPly}
        </span>
        {current && (
          <span className="truncate font-mono text-zinc-200">
            · {label}{" "}
            <span style={{ color: CLASS_STYLE[current.classification].color }}>{CLASS_STYLE[current.classification].symbol}</span>
          </span>
        )}
      </div>
      <div className="flex gap-2">
        <button className={btn} onClick={() => onGo(0)} disabled={ply === 0} aria-label="First move" data-testid="nav-first">⏮</button>
        <button className={btn} onClick={() => onGo(ply - 1)} disabled={ply === 0} aria-label="Previous move" data-testid="nav-prev">◀</button>
        <button className={btn} onClick={() => onGo(ply + 1)} disabled={ply >= maxPly} aria-label="Next move" data-testid="nav-next">▶</button>
        <button className={btn} onClick={() => onGo(maxPly)} disabled={ply >= maxPly} aria-label="Last move" data-testid="nav-last">⏭</button>
      </div>
    </nav>
  );
}
