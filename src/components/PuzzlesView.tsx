"use client";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Chess } from "chess.js";
import { formatEval } from "@/lib/analysis";
import {
  attemptMove,
  backlogDates,
  ensureFirstDay,
  isSolved,
  loadPuzzles,
  localDateKey,
  playSolutionMove,
  PROGRESS_EVENT,
  puzzlesForDate,
  readProgress,
  saveResult,
  solverColor,
  startPuzzle,
  streak,
  unsolvedCounts,
  type PlayState,
  type Progress,
  type Puzzle,
  type PuzzleBundle,
} from "@/lib/puzzles";
import { moveUci, uciLineToSan, type UserMove } from "@/lib/sandbox";
import { AppNav } from "./AppNav";
import { EvalBar } from "./EvalBar";
import { Footer } from "./Footer";
import { useBoardInput } from "./useBoardInput";
import { useLiveEval } from "./useLiveEval";

const Chessboard = dynamic(() => import("react-chessboard").then((m) => m.Chessboard), {
  ssr: false,
  loading: () => <div className="aspect-square w-full animate-pulse rounded bg-zinc-800" />,
});

type Phase = "setup" | "playing" | "reply" | "solved" | "completed" | "revealed" | "analyze";
interface Entry {
  date: string;
  puzzle: Puzzle;
}
const themeLabel = (t: string) => t.replace(/([a-z])([A-Z0-9])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());
const fmtDate = (d: string) =>
  new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
const levelLabel = (p: Puzzle) => (p.level === "easy" ? "Easier" : "Harder");

function useProgress(today: string): Progress {
  const [p, setP] = useState<Progress>({ firstDay: null, days: {} });
  useEffect(() => {
    setP(ensureFirstDay(today));
    const on = () => setP(readProgress());
    window.addEventListener(PROGRESS_EVENT, on);
    window.addEventListener("storage", on);
    return () => {
      window.removeEventListener(PROGRESS_EVENT, on);
      window.removeEventListener("storage", on);
    };
  }, [today]);
  return p;
}

export function PuzzlesView() {
  const [bundle, setBundle] = useState<PuzzleBundle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [today, setToday] = useState(() => localDateKey());
  const progress = useProgress(today);
  useEffect(() => {
    loadPuzzles().then(setBundle, (e) => setError(String(e)));
    // a new local day while the tab stays open: today's puzzles roll over, yesterday's unsolved go to the backlog
    const t = window.setInterval(() => setToday(localDateKey()), 60_000);
    return () => window.clearInterval(t);
  }, []);

  const todays: Entry[] = useMemo(
    () => (bundle ? puzzlesForDate(bundle, today).map((puzzle) => ({ date: today, puzzle })) : []),
    [bundle, today],
  );
  const backlog: Entry[] = useMemo(() => {
    if (!bundle) return [];
    return backlogDates(progress, today).flatMap((d) =>
      puzzlesForDate(bundle, d)
        .filter((p) => !isSolved(progress, d, p.id))
        .map((puzzle) => ({ date: d, puzzle })),
    );
  }, [bundle, progress, today]);
  const counts = unsolvedCounts(progress, today);
  const streakDays = streak(progress, today);

  const [sel, setSel] = useState<{ date: string; id: string } | null>(null);
  useEffect(() => {
    if (!todays.length || (sel && sel.date <= today && sel.date !== "")) return;
    const first = todays.find((e) => !isSolved(progress, e.date, e.puzzle.id)) ?? todays[0];
    setSel({ date: first.date, id: first.puzzle.id });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todays]);
  const entry = useMemo(
    () => [...todays, ...backlog].find((e) => sel && e.date === sel.date && e.puzzle.id === sel.id) ?? null,
    [todays, backlog, sel],
  );
  // keep a backlog puzzle selected after it's solved (it leaves the backlog list)
  const [held, setHeld] = useState<Entry | null>(null);
  useEffect(() => {
    if (entry) setHeld(entry);
  }, [entry]);
  const cur = entry ?? (held && sel && held.date === sel.date && held.puzzle.id === sel.id ? held : null);

  const boardRef = useRef<HTMLDivElement>(null);
  const choose = (e: Entry) => {
    setSel({ date: e.date, id: e.puzzle.id });
    const top = boardRef.current?.getBoundingClientRect().top ?? 0;
    if (top < 0) boardRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  };

  return (
    <main
      className="mx-auto max-w-6xl p-3 sm:p-4"
      style={{
        paddingTop: "max(0.75rem, env(safe-area-inset-top, 0px))",
        paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 1rem)",
      }}
    >
      <header className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h1 className="flex items-center gap-2 text-xl font-bold sm:text-2xl">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.svg" alt="" width={32} height={32} className="h-8 w-8" />
          <span className="max-[430px]:sr-only">MoveMentor</span>
          <AppNav className="ml-2" />
        </h1>
        <div className="text-sm text-zinc-400" data-testid="puzzle-streak">
          🔥 {streakDays} day streak
        </div>
      </header>

      {error && <p className="text-sm text-red-400">Couldn&apos;t load puzzles: {error}</p>}
      {!bundle && !error && <div className="aspect-square w-full max-w-[560px] animate-pulse rounded bg-zinc-800" />}
      {bundle && (
        <div className="flex flex-col gap-4 lg:flex-row">
          <div className="w-full max-w-[560px] shrink-0" ref={boardRef} style={{ scrollMarginTop: "env(safe-area-inset-top, 0px)" }}>
            <div className="mb-2 grid grid-cols-2 gap-2" data-testid="today-puzzles">
              {todays.map((e) => (
                <PuzzleChip key={e.puzzle.id} e={e} progress={progress} active={cur?.puzzle.id === e.puzzle.id && cur.date === e.date} onClick={() => choose(e)} />
              ))}
            </div>
            {cur && <PuzzleBoard key={`${cur.date}-${cur.puzzle.id}`} entry={cur} today={today} progress={progress} />}
          </div>
          <aside className="min-w-0 flex-1 space-y-3">
            <section className="rounded-lg bg-zinc-900 p-3" data-testid="backlog">
              <h2 className="mb-2 text-sm font-semibold">
                Unsolved <span className="ml-1 rounded-full bg-zinc-700 px-2 py-0.5 text-xs" data-testid="backlog-count">{backlog.length}</span>
              </h2>
              {backlog.length === 0 ? (
                <p className="text-xs text-zinc-400">
                  Nothing waiting. Puzzles you don&apos;t solve stay here (with their date) until you solve them.
                </p>
              ) : (
                <ul className="max-h-80 space-y-1 overflow-y-auto">
                  {backlog.map((e) => (
                    <li key={`${e.date}-${e.puzzle.id}`}>
                      <button
                        onClick={() => choose(e)}
                        data-testid="backlog-item"
                        data-date={e.date}
                        className={`flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-sm hover:bg-zinc-800 ${cur?.puzzle.id === e.puzzle.id && cur.date === e.date ? "bg-zinc-800 ring-1 ring-zinc-600" : ""}`}
                      >
                        <span>
                          {fmtDate(e.date)} · {levelLabel(e.puzzle)}
                        </span>
                        <span className="text-xs text-zinc-400">
                          {progress.days[e.date]?.[e.puzzle.id]?.status === "failed" ? "retry" : "not tried"}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <p className="text-xs text-zinc-500">
              Two new puzzles every day (the same for everyone), one easier and one harder. Today: {counts.today} left
              {counts.backlog ? ` · ${counts.backlog} in your backlog` : ""}. The streak counts days you solve both of
              that day&apos;s puzzles. Puzzles from the{" "}
              <a className="underline" href="https://database.lichess.org/#puzzles" target="_blank" rel="noreferrer">
                Lichess puzzle database
              </a>{" "}
              (CC0).
            </p>
          </aside>
        </div>
      )}
      <Footer />
    </main>
  );
}

function PuzzleChip({ e, progress, active, onClick }: { e: Entry; progress: Progress; active: boolean; onClick: () => void }) {
  const st = progress.days[e.date]?.[e.puzzle.id]?.status;
  return (
    <button
      onClick={onClick}
      data-testid="today-chip"
      data-status={st ?? "new"}
      className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm ${active ? "bg-zinc-700 ring-1 ring-zinc-500" : "bg-zinc-900 hover:bg-zinc-800"}`}
    >
      <span className="font-semibold">{levelLabel(e.puzzle)}</span>
      <span className={st === "solved" ? "text-green-400" : st === "failed" ? "text-amber-400" : "text-zinc-500"}>
        {st === "solved" ? "✓ Solved" : st === "failed" ? "Retry" : "To do"}
      </span>
    </button>
  );
}

function PuzzleBoard({ entry, today, progress }: { entry: Entry; today: string; progress: Progress }) {
  const p = entry.puzzle;
  const orientation = useMemo(() => solverColor(p), [p]);
  const [state, setState] = useState<PlayState>(() => ({ fen: p.fen, step: 0, lastMove: null, solved: false }));
  const [phase, setPhase] = useState<Phase>("setup");
  const [shownFen, setShownFen] = useState<string | null>(null); // a wrong move, shown briefly
  const [feedback, setFeedback] = useState<{ tone: "ok" | "bad" | "info"; text: string } | null>(null);
  const [mistakes, setMistakes] = useState(0);
  const [hint, setHint] = useState(false);
  const [analysis, setAnalysis] = useState<string[]>([]); // free moves in Analyze mode
  const timers = useRef<number[]>([]);
  const later = (fn: () => void, ms: number) => timers.current.push(window.setTimeout(fn, ms));
  const alreadySolved = isSolved(progress, entry.date, p.id);

  const restart = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setState({ fen: p.fen, step: 0, lastMove: null, solved: false });
    setPhase("setup");
    setFeedback(null);
    setMistakes(0);
    setHint(false);
    setAnalysis([]);
    setShownFen(null);
    later(() => {
      setState(startPuzzle(p));
      setPhase("playing");
    }, 600);
  }, [p]);
  useEffect(() => {
    restart();
    return () => timers.current.forEach(clearTimeout);
  }, [restart]);

  const finish = (m: number) => {
    if (m === 0) {
      saveResult(entry.date, p.id, "solved", today);
      setPhase("solved");
      setFeedback({ tone: "ok", text: "Solved! 🎉" });
    } else {
      saveResult(entry.date, p.id, "failed", today);
      setPhase("completed");
      setFeedback({ tone: "info", text: `Finished with ${m} mistake${m > 1 ? "s" : ""}. It stays unsolved: retry for a clean solve.` });
    }
  };

  // Analyze starts from the puzzle position (after the opponent's setup move); the engine line shows the idea.
  const startState = useMemo(() => startPuzzle(p), [p]);
  const analyzeFen = useMemo(() => {
    const c = new Chess(startState.fen);
    for (const u of analysis) c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
    return c.fen();
  }, [startState.fen, analysis]);

  const onMove = (m: UserMove) => {
    const uci = moveUci(m);
    if (phase === "analyze") {
      setAnalysis((a) => [...a, uci]);
      return;
    }
    if (phase !== "playing") return;
    const r = attemptMove(p, state, uci);
    if (r.kind === "illegal") return;
    if (r.kind === "wrong") {
      setMistakes((n) => n + 1);
      if (mistakes === 0) saveResult(entry.date, p.id, "failed", today);
      setShownFen(r.fen);
      setFeedback({ tone: "bad", text: "✗ Not the move. Try again." });
      later(() => setShownFen(null), 600);
      return;
    }
    setHint(false);
    setState(r.afterUser);
    if (r.next.solved) {
      finish(mistakes);
      return;
    }
    setFeedback({ tone: "ok", text: "✓ Correct! Keep going." });
    setPhase("reply");
    later(() => {
      setState(r.next);
      setPhase("playing");
    }, 450);
  };

  const showSolution = () => {
    timers.current.forEach(clearTimeout);
    saveResult(entry.date, p.id, "failed", today);
    setPhase("revealed");
    setHint(false);
    setFeedback({ tone: "info", text: "Solution shown. This puzzle stays unsolved: retry it any time." });
    let s = state;
    const stepFn = () => {
      if (s.solved) return;
      s = playSolutionMove(p, s);
      setState(s);
      if (!s.solved) later(stepFn, 700);
    };
    later(stepFn, 250);
  };

  const fen = phase === "analyze" ? analyzeFen : (shownFen ?? state.fen);
  const liveRaw = useLiveEval(phase === "analyze" ? analyzeFen : null);
  const live = liveRaw && liveRaw.fen === analyzeFen ? liveRaw : null;
  const canMove = phase === "analyze" || (phase === "playing" && !shownFen);
  const input = useBoardInput(fen, canMove, onMove);
  const done = phase === "solved" || phase === "completed" || phase === "revealed" || phase === "analyze";

  const squareStyles = useMemo(() => {
    const st: Record<string, React.CSSProperties> = {};
    const lm = phase === "analyze" ? analysis[analysis.length - 1] ?? startState.lastMove : state.lastMove;
    if (lm) for (const sq of [lm.slice(0, 2), lm.slice(2, 4)]) st[sq] = { backgroundColor: "rgba(255, 214, 10, 0.45)" };
    if (hint && phase === "playing") st[p.moves[state.step].slice(0, 2)] = { boxShadow: "inset 0 0 0 4px #38bdf8", backgroundColor: "rgba(56, 189, 248, 0.35)" };
    return { ...st, ...input.styles };
  }, [state, startState, hint, phase, p, input.styles, analysis]);

  const toMove = fen.split(" ")[1] === "w" ? "White" : "Black";
  const pv = live ? uciLineToSan(live.fen, live.pv, 8) : [];
  const btn = "rounded bg-zinc-700 px-3 py-1.5 text-sm hover:bg-zinc-600 disabled:opacity-40";
  const feedbackCls = !feedback ? "text-zinc-400" : feedback.tone === "ok" ? "text-green-400" : feedback.tone === "bad" ? "text-red-400" : "text-amber-300";

  return (
    <div data-testid="puzzle" data-id={p.id} data-phase={phase} data-fen={fen} data-orientation={orientation}>
      <div className="mb-2 flex min-h-12 items-center justify-between rounded-lg bg-zinc-900 px-3 py-2 text-sm" data-testid="puzzle-feedback">
        <span className={`font-semibold ${feedbackCls}`}>
          {feedback?.text ??
            (phase === "setup" ? "Opponent is moving…" : `${orientation === "white" ? "White" : "Black"} to move: find the best move`)}
        </span>
        {alreadySolved && phase !== "solved" && <span className="text-xs text-green-400">✓ solved before</span>}
      </div>
      <div className="flex gap-2">
        {phase === "analyze" && <EvalBar ev={live?.ev ?? null} flipped={orientation === "black"} />}
        <div className="relative flex-1" data-testid="puzzle-board">
          <Chessboard
            options={{
              id: "puzzle-board",
              position: fen,
              boardOrientation: orientation,
              allowDragging: canMove,
              ...input.handlers,
              squareStyles,
              animationDurationInMs: 200,
              darkSquareStyle: { backgroundColor: "#769656" },
              lightSquareStyle: { backgroundColor: "#eeeed2" },
            }}
          />
          {input.picker}
        </div>
      </div>
      <div className="mt-2 flex min-h-9 flex-wrap gap-2">
        {!done && (
          <>
            <button className={btn} onClick={() => setHint(true)} disabled={phase !== "playing" || hint} data-testid="hint">
              💡 Hint
            </button>
            <button className={btn} onClick={showSolution} disabled={phase === "setup"} data-testid="show-solution">
              Show solution
            </button>
          </>
        )}
        {done && (
          <>
            {phase !== "analyze" ? (
              <button className={btn} onClick={() => setPhase("analyze")} data-testid="analyze">
                🔍 Analyze
              </button>
            ) : (
              <button className={btn} onClick={() => setAnalysis([])} disabled={!analysis.length} data-testid="analyze-reset">
                ⟲ Puzzle start
              </button>
            )}
            <button className={btn} onClick={restart} data-testid="retry">
              ↻ {isSolved(progress, entry.date, p.id) ? "Play again" : "Retry"}
            </button>
          </>
        )}
      </div>
      {done && (
        <div className="mt-2 rounded-lg bg-zinc-900 p-3 text-sm" data-testid="puzzle-info">
          <div>
            <span className="font-semibold">Rating {p.rating}</span>
            <span className="text-zinc-400">
              {" "}
              · {fmtDate(entry.date)} ·{" "}
              <a className="underline" href={`https://lichess.org/training/${p.id}`} target="_blank" rel="noreferrer">
                Lichess #{p.id}
              </a>
            </span>
          </div>
          <div className="mt-1 flex flex-wrap gap-1" data-testid="puzzle-themes">
            {p.themes.map((t) => (
              <span key={t} className="rounded bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-300">
                {themeLabel(t)}
              </span>
            ))}
          </div>
          {phase === "analyze" && (
            <div className="mt-2 border-t border-zinc-800 pt-2" data-testid="puzzle-analysis">
              <div className="flex items-center gap-2">
                <span className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-xs font-bold text-zinc-900" data-testid="puzzle-eval">
                  {live ? formatEval(live.ev) : "…"}
                </span>
                <span className="text-xs text-zinc-400">{live ? `depth ${live.depth}` : "thinking…"} · {toMove} to move</span>
              </div>
              <div className="mt-1 font-mono text-xs text-zinc-300" data-testid="puzzle-line">
                {pv.length ? pv.join(" ") : "…"}
              </div>
              <p className="mt-1 text-xs text-zinc-500">Analyzing from the puzzle position. Drag or tap pieces to try other moves.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
