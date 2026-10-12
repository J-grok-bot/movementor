"use client";
import dynamic from "next/dynamic";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  analyzePgn,
  formatEval,
  numberedLine,
  type GameAnalysis,
  type MoveAnalysis,
  type Classification,
  type LineInfo,
} from "@/lib/analysis";
import { runUserAnalysis } from "@/lib/engineManager";
import { uciLineToSan, type UserMove } from "@/lib/sandbox";
import {
  bannerText,
  continueWithEngine,
  deviationFen,
  lastMove,
  startEngineLine,
  stepDeviation,
  userMoveInDeviation,
  userMoveOnGame,
  type Deviation,
} from "@/lib/deviation";
import { useBoardInput } from "./useBoardInput";
import { useLiveEval, type LiveEval } from "./useLiveEval";
import { getCachedAnalysis, saveAnalysis } from "@/lib/analysisCache";
import { CLASS_STYLE, FLAGGED } from "@/lib/classification";
import { CLASSIFICATIONS } from "@/lib/classify";
import { loadOpeningBook } from "@/lib/openingBook";
import { getExplanationRenderer, type Explanation, type LineRef } from "@/lib/explain";
import { Overview } from "./Overview";
import type { GameSummary } from "@/lib/chesscom";
import { EvalBar } from "./EvalBar";
import { EvalGraph } from "./EvalGraph";

const Chessboard = dynamic(
  () => import("react-chessboard").then((m) => m.Chessboard),
  {
    ssr: false,
    loading: () => (
      <div className="aspect-square w-full animate-pulse rounded bg-zinc-800" />
    ),
  },
);

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
export type Status =
  | { kind: "idle" }
  | { kind: "loading-engine" }
  | { kind: "analyzing"; done: number; total: number }
  | { kind: "done"; seconds: number | null }
  | { kind: "error"; message: string };

export function Review({
  game,
  depth,
  multiPv = 2,
  onStatus,
}: {
  game: GameSummary;
  depth: number;
  multiPv?: number;
  onStatus?: (s: Status) => void;
}) {
  const [analysis, setAnalysis] = useState<GameAnalysis | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [ply, setPly] = useState(0);
  const [mode, setMode] = useState<"overview" | "review">("overview");
  const [engineName, setEngineName] = useState<string>("Stockfish");
  // One board: on the game (green), or deviated into an engine line (blue) / the user's own moves (amber).
  const [dev, setDev] = useState<Deviation | null>(null);
  const flipped = game.userColor === "black";

  useEffect(() => onStatus?.(status), [status, onStatus]);

  // Run analysis whenever the game or settings change (cached in localStorage). Uses the shared
  // engine; opening a game pre-empts any background preloading.
  useEffect(() => {
    const signal = { aborted: false };
    setAnalysis(null);
    setPly(0);
    setDev(null);
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
      setDev(null);
      setPly(Math.max(0, Math.min(maxPly, p)));
    },
    [maxPly],
  );
  /** Resume / Esc: back to the game position where the deviation started. */
  const resume = useCallback(() => {
    setDev((d) => {
      if (d) setPly(d.basePly);
      return null;
    });
  }, []);
  const stepDev = useCallback((n: number) => setDev((d) => (d ? stepDeviation(d, n) : d)), []);

  const plyLabel = useCallback(
    (p: number) => {
      const m = analysis && p > 0 ? analysis.moves[p - 1] : null;
      return m ? `${m.moveNumber}${m.color === "white" ? "." : "..."} ${m.san}` : "";
    },
    [analysis],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT" || mode !== "review") return;
      if (dev) {
        if (e.key === "ArrowLeft") stepDev(dev.step - 1);
        else if (e.key === "ArrowRight") stepDev(dev.step + 1);
        else if (e.key === "Home" || e.key === "ArrowUp") stepDev(0);
        else if (e.key === "End" || e.key === "ArrowDown") stepDev(dev.uci.length);
        else if (e.key === "Escape") resume();
        else return;
      } else if (e.key === "ArrowLeft") go(ply - 1);
      else if (e.key === "ArrowRight") go(ply + 1);
      else if (e.key === "Home" || e.key === "ArrowUp") go(0);
      else if (e.key === "End" || e.key === "ArrowDown") go(maxPly);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, ply, maxPly, dev, stepDev, resume, mode]);

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
  const gameFen = current ? current.fenAfter : (analysis?.initialFen ?? START_FEN);
  const fen = dev ? deviationFen(dev) : gameFen;
  const live = useLiveEval(dev ? fen : null); // every position in a deviation gets evaluated
  const ev = dev ? (live?.ev ?? null) : current ? current.evalAfter : (analysis?.initialEval ?? null);
  const curLabel = plyLabel(ply);
  const baseLabel = dev ? plyLabel(dev.basePly) : "";
  // Lines from the position before the current move ("instead of this move") and after it ("from here").
  const linesBefore: LineInfo[] = current ? current.lines : (analysis?.moves[0]?.lines ?? []);
  const lineAfter: LineInfo | null = current ? current.continuation : null;

  /** Start a blue engine-line preview on the main board. */
  const previewLine = useCallback(
    (id: string, line: LineInfo, step: number, kind: "instead" | "after") => {
      const basePly = kind === "instead" ? Math.max(0, ply - 1) : ply;
      const title = kind === "instead" && current ? `Engine's best instead of ${curLabel}` : `Engine line from ${curLabel || "the start"}`;
      setDev(startEngineLine(basePly, line, title, step, id));
    },
    [ply, current, curLabel],
  );

  // User moves (drag or tap-tap) at any time: the real next game move advances; anything else deviates (amber).
  const canInput = !!analysis && mode === "review";
  const onBoardMove = useCallback(
    (m: UserMove) => {
      if (!analysis) return;
      if (dev) {
        const next = userMoveInDeviation(dev, m);
        if (next) setDev(next);
        return;
      }
      const r = userMoveOnGame(gameFen, ply, analysis.moves[ply]?.uci ?? null, m);
      if (r.kind === "advance") go(ply + 1);
      else if (r.kind === "deviate") setDev(r.deviation);
    },
    [analysis, dev, gameFen, ply, go],
  );
  const boardInput = useBoardInput(fen, canInput, onBoardMove);

  const hue = dev ? (dev.kind === "engine" ? "blue" : "amber") : "green";
  const boardOptions = useMemo(() => {
    const squareStyles: Record<string, React.CSSProperties> = {};
    const arrows: { startSquare: string; endSquare: string; color: string }[] = [];
    if (dev) {
      const lm = lastMove(dev);
      if (lm) {
        squareStyles[lm.from] = { backgroundColor: "rgba(250, 204, 21, 0.45)" };
        squareStyles[lm.to] = { backgroundColor: "rgba(250, 204, 21, 0.65)" };
      }
      const next = dev.uci[dev.step];
      if (next) arrows.push({ startSquare: next.slice(0, 2), endSquare: next.slice(2, 4), color: "rgba(96, 165, 250, 0.9)" });
      else if (live?.pv[0]) arrows.push({ startSquare: live.pv[0].slice(0, 2), endSquare: live.pv[0].slice(2, 4), color: "#22c55ecc" });
    } else if (current) {
      const c = CLASS_STYLE[current.classification].color;
      squareStyles[current.from] = { backgroundColor: `${c}66` };
      squareStyles[current.to] = { backgroundColor: `${c}99` };
      if (FLAGGED.includes(current.classification) && current.bestMoveUci) {
        arrows.push({ startSquare: current.bestMoveUci.slice(0, 2), endSquare: current.bestMoveUci.slice(2, 4), color: "#22c55ecc" });
      }
    }
    Object.assign(squareStyles, boardInput.styles);
    return {
      id: "review-board",
      position: fen,
      boardOrientation: (flipped ? "black" : "white") as "white" | "black",
      allowDragging: canInput,
      ...boardInput.handlers,
      allowDrawingArrows: true,
      arrows,
      squareStyles,
      animationDurationInMs: 150,
      darkSquareStyle: { backgroundColor: HUES[hue].dark },
      lightSquareStyle: { backgroundColor: HUES[hue].light },
    };
  }, [fen, flipped, current, dev, live, canInput, boardInput.handlers, boardInput.styles, hue]);

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

  const devLabel = dev ? (dev.step > 0 ? numberedLine(dev.startFen, dev.san)[dev.step - 1] : null) : null;
  return (
    <div className="relative flex flex-col gap-4 lg:flex-row">
      {analysis &&
        (dev ? (
          <MobileNav
            pos={dev.step}
            max={dev.uci.length}
            counter={`${dev.kind === "user" ? "Off game" : "Engine line"} ${dev.step}/${dev.uci.length}`}
            label={devLabel ? `${devLabel.label ?? ""} ${devLabel.san}`.trim() : baseLabel || "start"}
            onGo={stepDev}
            tone={hue}
          />
        ) : (
          <MobileNav
            pos={ply}
            max={maxPly}
            counter={`Move ${ply}/${maxPly}`}
            label={curLabel}
            current={current}
            onGo={go}
            tone="green"
          />
        ))}
      {/* Board column: always the same board; its hue says whether you're on the game or exploring. */}
      <div
        className="w-full max-w-[560px] shrink-0"
        data-testid="game-board-column"
        data-fen={fen}
        data-hue={hue}
        data-ply={dev ? dev.basePly : ply}
        data-frozen={dev ? "true" : "false"}
      >
        <PlayerTag p={topPlayer} />
        <DeviationBanner dev={dev} text={dev ? bannerText(dev, baseLabel) : ""} onResume={resume} />
        <div className="flex gap-2">
          <EvalBar ev={ev} flipped={flipped} />
          <div
            className={`review-board relative flex-1 rounded-sm ring-2 transition-shadow duration-300 motion-reduce:transition-none ${HUES[hue].ring}`}
            data-testid="review-board"
          >
            <Chessboard options={boardOptions} />
            {boardInput.picker}
            {current && !dev && (
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
          {(dev
            ? [
                ["⏮", 0, "Line start (Home)"],
                ["◀", dev.step - 1, "Previous (←)"],
                ["▶", dev.step + 1, "Next (→)"],
                ["⏭", dev.uci.length, "Line end (End)"],
              ]
            : [
                ["⏮", 0, "First (Home)"],
                ["◀", ply - 1, "Previous (←)"],
                ["▶", ply + 1, "Next (→)"],
                ["⏭", maxPly, "Last (End)"],
              ]
          ).map(([label, target, title]) => (
            <button
              key={String(title)}
              title={String(title)}
              onClick={() => (dev ? stepDev(Number(target)) : go(Number(target)))}
              disabled={!analysis}
              className="rounded bg-zinc-700 px-4 py-2 text-lg hover:bg-zinc-600 disabled:opacity-40"
            >
              {label}
            </button>
          ))}
        </div>
        <p className="mt-1 hidden text-center text-xs text-zinc-500 lg:block">
          ← → step · drag or tap pieces to try your own moves · Esc resumes the game
        </p>
      </div>

      {/* Side panel. Its height only ratchets up while stepping, so a shorter explanation can't shrink the page
          and make the browser clamp (jump) the scroll position. */}
      <div ref={sideRef} className="flex min-w-0 flex-1 flex-col gap-3">
        {!analysis && <StatusLine status={status} depth={depth} engineName={engineName} />}
        {analysis && (
          <>
            {/* Coach card on the game; live analysis of the current position while deviated. */}
            {dev ? (
              <LivePanel
                dev={dev}
                fen={fen}
                live={live}
                onPreview={(pv) => setDev((d) => (d ? continueWithEngine(d, pv, `Engine line from ${baseLabel || "the start"}`) : d))}
              />
            ) : (
              <MoveDetail
                onPreviewRef={(ref) => {
                  if (!current) return;
                  const line = ref === "reply" ? current.continuation : current.lines[ref === "best" ? 0 : 1];
                  if (!line) return;
                  if (ref === "reply") previewLine(`a${ply}-${line.rank}`, line, 1, "after");
                  else previewLine(`b${ply}-${line.rank}`, line, 1, "instead");
                }}
                move={current}
                prev={current ? (analysis.moves[current.ply - 2] ?? null) : null}
                opening={analysis.opening?.name ?? null}
              />
            )}
            <EngineLines
              compact
              title={current ? `Engine's best instead of ${curLabel}` : "Engine's best from the start"}
              lines={linesBefore}
              idPrefix={`b${ply}`}
              preview={dev?.id ? { id: dev.id, step: dev.step } : null}
              onPreview={(id, line, step) => previewLine(id, line, step, current ? "instead" : "after")}
            />
            {lineAfter && (
              <EngineLines
                compact
                title="Engine's line from this position"
                lines={[lineAfter]}
                idPrefix={`a${ply}`}
                preview={dev?.id ? { id: dev.id, step: dev.step } : null}
                onPreview={(id, line, step) => previewLine(id, line, step, "after")}
              />
            )}
            <Summary analysis={analysis} game={game} />
            <EvalGraph analysis={analysis} ply={dev ? dev.basePly : ply} onSelect={go} />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <button onClick={() => setMode("overview")} className="rounded bg-zinc-800 px-3 py-1 text-xs hover:bg-zinc-700" data-testid="back-overview">
                ← Overview
              </button>
              <StatusLine status={status} depth={depth} engineName={engineName} />
            </div>
            <MoveList moves={analysis.moves} ply={dev ? dev.basePly : ply} deviated={dev ? (dev.kind === "user" ? "amber" : "blue") : null} onSelect={go} />
          </>
        )}
        <a href={game.url} target="_blank" rel="noreferrer" className="text-xs text-zinc-500 underline">
          View original game on Chess.com
        </a>
      </div>
    </div>
  );
}

const HUES = {
  green: { dark: "#769656", light: "#eeeed2", ring: "ring-transparent" },
  blue: { dark: "#5f7fb8", light: "#dce6f5", ring: "ring-sky-400/70" },
  amber: { dark: "#b8873b", light: "#f6e7c4", ring: "ring-amber-400/80" },
} as const;

/** Stable-height slot above the board: empty on the game, a banner with Resume while deviated. */
function DeviationBanner({ dev, text, onResume }: { dev: Deviation | null; text: string; onResume: () => void }) {
  const tone = dev?.kind === "user" ? "border-amber-400/60 bg-amber-500/15 text-amber-100" : "border-sky-400/60 bg-sky-500/15 text-sky-100";
  return (
    <div className="mb-1 flex h-9 items-center" aria-live="polite">
      {dev && (
        <div className={`flex w-full items-center gap-2 rounded-md border px-2 py-1 text-xs ${tone}`} data-testid="deviation-banner" data-kind={dev.kind} data-step={dev.step} data-len={dev.uci.length}>
          <span className="min-w-0 flex-1 truncate font-semibold">{text}</span>
          <button
            onClick={onResume}
            className="shrink-0 rounded-md bg-white px-3 py-1 text-xs font-bold text-zinc-900 shadow hover:bg-zinc-200"
            data-testid="resume"
            title="Back to the game (Esc)"
          >
            ↩ Resume
          </button>
        </div>
      )}
    </div>
  );
}

/** Live Stockfish analysis of the current deviation position (in place of the coach card). */
function LivePanel({ dev, fen, live, onPreview }: { dev: Deviation; fen: string; live: LiveEval | null; onPreview: (pvUci: string[]) => void }) {
  const san = live ? uciLineToSan(fen, live.pv, 8) : [];
  const tokens = san.length ? numberedLine(fen, san) : [];
  const visible = tokens.slice(0, 6);
  const amber = dev.kind === "user";
  return (
    <div className={`min-h-[7.5rem] rounded-lg p-3 text-sm ${amber ? "bg-amber-950/40 ring-1 ring-amber-500/30" : "bg-sky-950/40 ring-1 ring-sky-500/30"}`} data-testid="live-analysis">
      <div className="flex items-center justify-between gap-2">
        <span className={`text-xs font-semibold uppercase tracking-wide ${amber ? "text-amber-300" : "text-sky-300"}`}>
          {amber ? "Your analysis · not played" : "Engine line · not played"}
        </span>
        <span className="font-mono text-xs text-zinc-400" data-testid="live-depth">
          {live ? `depth ${live.depth}` : "thinking…"}
        </span>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <span className="w-14 shrink-0 rounded bg-zinc-100 px-1 text-center font-mono text-xs font-bold text-zinc-900" data-testid="live-eval-chip">
          {live ? formatEval(live.ev) : "…"}
        </span>
        <span className="text-zinc-300">
          {live ? (
            san[0] ? (
              <>
                Best: <span className="font-mono font-semibold text-green-400" data-testid="live-best">{san[0]}</span>
              </>
            ) : (
              "Game over"
            )
          ) : (
            "Stockfish is evaluating this position…"
          )}
        </span>
      </div>
      {visible.length > 0 && (
        <div className="mt-1.5 flex items-center gap-2">
          <div className="flex h-6 min-w-0 flex-1 flex-wrap items-center overflow-hidden font-mono text-zinc-300" data-testid="live-line">
            {visible.map((t) => (
              <span key={t.index} className="mr-1 whitespace-nowrap">
                {t.label && <span className="mr-0.5 text-zinc-500">{t.label}</span>}
                {t.san}
              </span>
            ))}
            {tokens.length > visible.length && <span className="text-zinc-500">…</span>}
          </div>
          <button
            onClick={() => live && onPreview(live.pv)}
            className="shrink-0 rounded bg-zinc-700 px-2 py-0.5 text-xs hover:bg-zinc-600"
            data-testid="live-preview"
            title="Play this line on the board"
          >
            ▶ Preview
          </button>
        </div>
      )}
    </div>
  );
}

function PlayerTag({ p }: { p: { username: string; rating: number } }) {
  return (
    <div className="my-1 pl-8 text-sm font-semibold">
      {p.username}{" "}
      <span className="font-normal text-zinc-400">({p.rating})</span>
    </div>
  );
}

function StatusLine({
  status,
  depth,
  engineName,
}: {
  status: Status;
  depth: number;
  engineName: string;
}) {
  if (status.kind === "loading-engine")
    return <p className="text-sm text-zinc-400">Loading Stockfish (WASM)…</p>;
  if (status.kind === "error")
    return (
      <p className="text-sm text-red-400">Analysis failed: {status.message}</p>
    );
  if (status.kind === "analyzing") {
    const pct = Math.round((status.done / status.total) * 100);
    return (
      <div data-testid="progress">
        <div className="mb-1 flex justify-between text-sm text-zinc-300">
          <span>
            Analyzing with {engineName} at depth {depth}…
          </span>
          <span>
            {status.done}/{status.total} positions ({pct}%)
          </span>
        </div>
        <div className="h-2 overflow-hidden rounded bg-zinc-800">
          <div
            className="h-full bg-blue-500 transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    );
  }
  if (status.kind === "done")
    return (
      <p className="text-xs text-zinc-500" data-testid="analysis-done">
        Analyzed at depth {depth} with {engineName}
        {status.seconds !== null
          ? ` in ${status.seconds.toFixed(1)}s`
          : " (cached)"}
      </p>
    );
  return null;
}

function Summary({
  analysis,
  game,
}: {
  analysis: GameAnalysis;
  game: GameSummary;
}) {
  const sides = ["white", "black"] as const;
  return (
    <div className="rounded-lg border border-zinc-800 p-2 text-sm">
      {sides.map((s) => (
        <div
          key={s}
          className="flex flex-wrap items-center gap-x-2 gap-y-1 py-0.5"
        >
          <span className="w-32 truncate font-semibold">
            {game[s].username}
            {game.userColor === s ? " (you)" : ""}
          </span>
          <span className="w-12 font-bold">
            {analysis[s].accuracy.toFixed(1)}
          </span>
          {CLASSIFICATIONS.filter((c) => analysis[s].counts[c]).map((c) => (
            <span
              key={c}
              className={`text-xs ${CLASS_STYLE[c].text}`}
              title={c}
            >
              {CLASS_STYLE[c].symbol}
              {analysis[s].counts[c]}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

const ARTICLE: Partial<Record<Classification, string>> = {
  Inaccuracy: "an inaccuracy",
  Excellent: "excellent",
  Great: "a great move",
  Brilliant: "brilliant",
  Book: "a book move",
  Miss: "a miss",
};

/**
 * Which engine line each coach sentence refers to. Uses the explicit refs from the explainer; analyses cached
 * before refs existed fall back to spotting the line's first move (SAN) in the sentence.
 * No "best"/"second" refs when the played move was the engine's top move.
 */
function sentenceRefs(exp: Explanation, move: MoveAnalysis): { headline: LineRef | null; details: (LineRef | null)[] } {
  const isTop = move.bestMoveUci === move.uci;
  const available = (r: LineRef | null | undefined): LineRef | null => {
    if (!r) return null;
    if (r === "reply") return move.continuation?.san.length ? r : null;
    if (isTop) return null;
    return move.lines[r === "best" ? 0 : 1]?.san.length ? r : null;
  };
  if (exp.headlineRef !== undefined || exp.detailRefs) {
    return { headline: available(exp.headlineRef), details: exp.details.map((_, i) => available(exp.detailRefs?.[i])) };
  }
  const has = (text: string, san: string | undefined) =>
    !!san && new RegExp(`(^|[\\s(:,])${san.replace(/[+#=]/g, (c) => `\\${c}`)}(?=[\\s).,:+#]|$)`).test(text);
  const guess = (text: string): LineRef | null =>
    available(has(text, move.lines[0]?.san[0]) ? "best" : has(text, move.continuation?.san[0]) ? "reply" : has(text, move.lines[1]?.san[0]) ? "second" : null);
  const details = exp.details.map(guess);
  const headline = guess(exp.headline);
  return { headline: headline && details.includes(headline) ? null : headline, details };
}

function PreviewPill({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="ml-1.5 inline-flex translate-y-[-1px] items-center rounded-full bg-zinc-700 px-2 py-px align-middle text-[11px] leading-4 text-zinc-100 hover:bg-zinc-600"
      title="Show this line on a board"
      data-testid="coach-preview"
    >
      ▶ Preview
    </button>
  );
}

function MoveDetail({
  move,
  prev,
  opening,
  onPreviewRef,
}: {
  move: MoveAnalysis | null;
  prev: MoveAnalysis | null;
  opening: string | null;
  onPreviewRef: (ref: LineRef) => void;
}) {
  const [rendered, setRendered] = useState<Explanation | null>(null);
  // Optional wording layer (off by default): only runs if a non-"rules" renderer is configured.
  useEffect(() => {
    setRendered(null);
    const r = getExplanationRenderer();
    if (!move || r.id === "rules") return;
    let live = true;
    r.render(
      {
        ...move,
        isBest: move.classification === "Best" || move.bestMoveUci === move.uci,
        opening,
        previous: prev
          ? {
              san: prev.san,
              classification: prev.classification,
              fenBefore: prev.fenBefore,
              captured: prev.san.includes("x"),
            }
          : null,
        formatEval,
      },
      move.explanation,
    )
      .then((e) => live && setRendered(e))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [move, prev, opening]);

  if (!move)
    return (
      <div className="min-h-[7.5rem] rounded-lg bg-zinc-800/60 p-3 text-sm text-zinc-400">
        Starting position. Press → to step through the game.
      </div>
    );
  const s = CLASS_STYLE[move.classification];
  const exp = rendered ?? move.explanation;
  const refs = sentenceRefs(exp, move);
  const label =
    ARTICLE[move.classification] ??
    (move.classification === "Best"
      ? "the best move"
      : `a ${move.classification.toLowerCase()}`);
  return (
    <div
      className="min-h-[7.5rem] rounded-lg bg-zinc-800/60 p-3 text-sm"
      data-testid="move-detail"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2">
          <span
            className="inline-flex h-6 min-w-7 items-center justify-center rounded px-1 text-xs font-bold text-white"
            style={{ backgroundColor: s.color }}
          >
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
      <div
        className="mt-2 border-l-2 pl-2"
        style={{ borderColor: s.color }}
        data-testid="coach"
      >
        <p className="text-zinc-100">
          {exp.headline}
          {refs.headline && <PreviewPill onClick={() => onPreviewRef(refs.headline!)} />}
        </p>
        {exp.details.map((d, i) => (
          <p key={i} className="mt-0.5 text-zinc-400">
            {d}
            {refs.details[i] && <PreviewPill onClick={() => onPreviewRef(refs.details[i]!)} />}
          </p>
        ))}
      </div>
    </div>
  );
}

const COMPACT_MOVES = 4;

function EngineLines({
  title,
  lines,
  idPrefix,
  preview,
  onPreview,
  compact = false,
}: {
  title: string;
  lines: LineInfo[];
  idPrefix: string;
  preview: { id: string; step: number } | null;
  onPreview: (id: string, line: LineInfo, step: number) => void;
  /** One line per engine line: eval + first few moves, the rest behind "…" (the explorer always shows it all). */
  compact?: boolean;
}) {
  const [showMore, setShowMore] = useState(false);
  if (!lines.length) return null;
  const shown = compact && !showMore ? lines.slice(0, 1) : lines;
  const hidden = lines.length - shown.length;
  return (
    <div
      className="rounded-lg border border-zinc-800 p-2 text-sm"
      data-testid="engine-lines"
    >
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="truncate text-xs font-semibold uppercase tracking-wide text-zinc-400">
          {title}
        </span>
        {compact && lines.length > 1 && (
          <button
            onClick={() => setShowMore((v) => !v)}
            className="shrink-0 rounded px-1.5 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
            data-testid="more-lines"
            aria-expanded={showMore}
          >
            {showMore
              ? "fewer lines"
              : `+${hidden} more line${hidden > 1 ? "s" : ""}`}
          </button>
        )}
      </div>
      {shown.map((line) => {
        const id = `${idPrefix}-${line.rank}`;
        const active = preview?.id === id;
        const tokens = numberedLine(line.startFen, line.san);
        const visible = compact ? tokens.slice(0, COMPACT_MOVES) : tokens;
        const truncated = visible.length < tokens.length;
        return (
          <div
            key={id}
            className={`flex gap-2 rounded px-1 py-1 ${compact ? "items-center" : "items-start"} ${active ? "bg-blue-900/30" : ""}`}
          >
            <span
              className={`${compact ? "" : "mt-0.5"} w-14 shrink-0 rounded px-1 text-center font-mono text-xs font-bold ${
                line.rank === 1
                  ? "bg-zinc-100 text-zinc-900"
                  : "bg-zinc-700 text-zinc-100"
              }`}
              title={
                line.rank === 1
                  ? "Top engine line"
                  : `Engine line #${line.rank}`
              }
            >
              {formatEval(line.eval)}
            </span>
            <div
              className={`min-w-0 flex-1 ${compact ? "flex items-center" : "leading-6"}`}
            >
              <div
                className={
                  compact
                    ? "flex h-6 min-w-0 flex-wrap items-center overflow-hidden"
                    : "contents"
                }
                data-testid="line-moves"
              >
                {visible.map((t) => (
                  <span key={t.index} className="whitespace-nowrap">
                    {t.label && (
                      <span className="mr-0.5 text-zinc-500">{t.label}</span>
                    )}
                    <button
                      data-line={id}
                      data-step={t.index + 1}
                      onClick={() => onPreview(id, line, t.index + 1)}
                      className={`mr-1 rounded px-0.5 font-mono hover:bg-zinc-700 ${
                        active && preview!.step === t.index + 1
                          ? "bg-blue-600 text-white"
                          : t.index === 0
                            ? "font-semibold text-green-400"
                            : "text-zinc-200"
                      }`}
                    >
                      {t.san}
                    </button>
                  </span>
                ))}
              </div>
              {truncated && (
                <button
                  onClick={() => onPreview(id, line, visible.length + 1)}
                  className="shrink-0 rounded px-1 text-zinc-400 hover:bg-zinc-700"
                  title={`${tokens.length - visible.length} more moves: open the full line`}
                  aria-label="Show full line"
                >
                  …
                </button>
              )}
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

function MoveList({
  moves,
  ply,
  deviated,
  onSelect,
}: {
  moves: MoveAnalysis[];
  ply: number;
  /** While deviated, `ply` is the deviation-start move and gets a hued outline. */
  deviated: "blue" | "amber" | null;
  onSelect: (p: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Scroll only the list's own container (never the window: scrollIntoView would also scroll the page on mobile).
    const box = ref.current;
    const el = box?.querySelector<HTMLElement>(`[data-ply="${ply}"]`);
    if (!box || !el) return;
    const top =
      el.getBoundingClientRect().top -
      box.getBoundingClientRect().top +
      box.scrollTop;
    const bottom = top + el.offsetHeight;
    if (top < box.scrollTop) box.scrollTop = Math.max(0, top - 4);
    else if (bottom > box.scrollTop + box.clientHeight)
      box.scrollTop = bottom - box.clientHeight + 4;
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
        data-uci={m.uci}
        onClick={() => onSelect(m.ply)}
        className={`flex w-full items-center justify-between rounded px-2 py-0.5 text-left font-mono ${
          ply === m.ply
            ? deviated === "amber"
              ? "bg-amber-500/20 ring-1 ring-amber-400"
              : deviated === "blue"
                ? "bg-sky-500/20 ring-1 ring-sky-400"
                : "bg-blue-600/40"
            : "hover:bg-zinc-800"
        }`}
        data-deviation-start={deviated && ply === m.ply ? "true" : undefined}
      >
        <span>{m.san}</span>
        {m.classification !== "Good" && (
          <span
            className="text-xs font-bold"
            style={{ color: CLASS_STYLE[m.classification].color }}
          >
            {CLASS_STYLE[m.classification].symbol}
          </span>
        )}
      </button>
    ) : (
      <span />
    );
  return (
    <div
      ref={ref}
      className="max-h-56 overflow-y-auto overscroll-contain rounded-lg border lg:max-h-80 border-zinc-800 text-sm"
      data-testid="move-list"
    >
      {rows.map(([w, b], i) => (
        <div
          key={i}
          className="grid grid-cols-[3rem_1fr_1fr] items-center gap-1 px-1 odd:bg-zinc-900"
        >
          <span className="text-right text-zinc-500">{w.moveNumber}.</span>
          {cell(w.color === "white" ? w : undefined)}
          {cell(w.color === "black" ? w : b)}
        </div>
      ))}
    </div>
  );
}

/** Mobile-only bottom bar: always reachable, sits above Safari's toolbar via the safe-area inset.
 *  Steps through the game, or through the deviation line while deviated. */
function MobileNav({
  pos,
  max,
  counter,
  label,
  current,
  onGo,
  tone,
}: {
  pos: number;
  max: number;
  counter: string;
  label: string;
  current?: MoveAnalysis | null;
  onGo: (p: number) => void;
  tone: "green" | "blue" | "amber";
}) {
  const btn = "flex-1 rounded-lg bg-zinc-700 py-2.5 text-lg active:bg-zinc-600 disabled:opacity-40";
  const toneText = tone === "amber" ? "text-amber-300" : tone === "blue" ? "text-sky-300" : "text-zinc-400";
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 border-t border-zinc-800 bg-zinc-950/95 px-3 pt-2 backdrop-blur lg:hidden"
      style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 0.5rem)" }}
      data-testid="mobile-nav"
    >
      <div className={`mb-1.5 flex items-center justify-center gap-2 text-xs ${toneText}`} data-testid="mobile-nav-counter">
        <span>{counter}</span>
        {label && (
          <span className="truncate font-mono text-zinc-200">
            · {label}
            {current && (
              <span className="ml-1" style={{ color: CLASS_STYLE[current.classification].color }}>
                {CLASS_STYLE[current.classification].symbol}
              </span>
            )}
          </span>
        )}
      </div>
      <div className="flex gap-2">
        <button className={btn} onClick={() => onGo(0)} disabled={pos === 0} aria-label="First" data-testid="nav-first">
          ⏮
        </button>
        <button className={btn} onClick={() => onGo(pos - 1)} disabled={pos === 0} aria-label="Previous" data-testid="nav-prev">
          ◀
        </button>
        <button className={btn} onClick={() => onGo(pos + 1)} disabled={pos >= max} aria-label="Next" data-testid="nav-next">
          ▶
        </button>
        <button className={btn} onClick={() => onGo(max)} disabled={pos >= max} aria-label="Last" data-testid="nav-last">
          ⏭
        </button>
      </div>
    </nav>
  );
}
