"use client";
// Position calculator: build any position (start position, empty board, drag-and-drop or tap-to-place pieces),
// then ask Stockfish for the best move and top 3 lines, and play on from there with live evaluation.
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Chess } from "chess.js";
import { formatEval, numberedLine } from "@/lib/analysis";
import { legalMove, uciLineToSan, type UserMove } from "@/lib/sandbox";
import {
  castlingAllowed,
  emptySetup,
  epCandidates,
  fenToSetup,
  gameEnd,
  gameEndText,
  readSaved,
  setupToFen,
  startSetup,
  validateSetup,
  withBoard,
  writeSaved,
  type BoardMap,
  type Castling,
  type Setup,
} from "@/lib/position";
import { AppNav } from "./AppNav";
import { EvalBar } from "./EvalBar";
import { Footer } from "./Footer";
import type { Tool } from "./EditorBoard";
import { useBoardInput } from "./useBoardInput";
import { useLiveEval } from "./useLiveEval";

const boardSkeleton = () => <div className="aspect-square w-full animate-pulse rounded bg-zinc-800" />;
const Chessboard = dynamic(() => import("react-chessboard").then((m) => m.Chessboard), { ssr: false, loading: boardSkeleton });
const EditorBoard = dynamic(() => import("./EditorBoard").then((m) => m.EditorBoard), { ssr: false, loading: boardSkeleton });

const DEPTHS = [6, 10, 14, 18, 20];
const LINE_MOVES = 8;
type Mode = "edit" | "calc";
const btn = "rounded bg-zinc-700 px-3 py-1.5 text-sm hover:bg-zinc-600 disabled:opacity-40 disabled:hover:bg-zinc-700";

export function AnalyzeView() {
  const params = useSearchParams();
  const [setup, setSetup] = useState<Setup>(startSetup);
  const [orientation, setOrientation] = useState<"white" | "black">("white");
  const [ready, setReady] = useState(false);
  const [mode, setMode] = useState<Mode>("edit");
  const [tool, setTool] = useState<Tool>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [fenText, setFenText] = useState("");
  const [fenError, setFenError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [moves, setMoves] = useState<string[]>([]); // UCI moves played from the setup in calculator mode
  const boardRef = useRef<HTMLElement>(null);
  // after switching modes the panel below the board changes height: bring the board back into view if it's above the fold
  const showBoard = () =>
    requestAnimationFrame(() => {
      const top = boardRef.current?.getBoundingClientRect().top ?? 0;
      if (top < 0) boardRef.current?.scrollIntoView({ block: "start" });
    });

  // load: ?fen= deep link, else the last edited position, else the starting position
  useEffect(() => {
    const linked = params.get("fen");
    const fromLink = linked ? fenToSetup(linked) : null;
    const saved = readSaved();
    const s = fromLink ?? (saved ? fenToSetup(saved.fen) : null);
    if (s) setSetup(s);
    if (saved && !fromLink) setOrientation(saved.orientation);
    if (fromLink && fromLink.turn === "b") setOrientation("black");
    setReady(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setupFen = useMemo(() => setupToFen(setup), [setup]);
  useEffect(() => {
    if (ready) writeSaved({ fen: setupFen, orientation });
  }, [ready, setupFen, orientation]);
  useEffect(() => {
    setFenText(setupFen);
    setFenError(null);
  }, [setupFen]);

  const errors = useMemo(() => validateSetup(setup), [setup]);
  const valid = errors.length === 0;

  const updateBoard = useCallback((b: BoardMap) => setSetup((s) => withBoard(s, b)), []);
  const setCastle = (k: keyof Castling, v: boolean) => setSetup((s) => ({ ...s, castling: { ...s.castling, [k]: v } }));
  const setTurn = (turn: "w" | "b") => setSetup((s) => ({ ...s, turn, ep: null }));
  const loadFen = () => {
    const s = fenToSetup(fenText.trim());
    if (!s) return setFenError("That doesn't look like a FEN. Example: " + "8/8/8/4k3/8/8/4P3/4K3 w - - 0 1");
    setSetup(s);
    setFenError(null);
  };
  const copyFen = async () => {
    try {
      await navigator.clipboard.writeText(setupFen);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setFenError("Couldn't copy automatically. Select the text and copy it.");
    }
  };

  // ---- calculator mode ----
  const fen = useMemo(() => {
    if (mode !== "calc") return setupFen;
    const c = new Chess(setupFen);
    for (const u of moves) c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
    return c.fen();
  }, [mode, setupFen, moves]);
  const played = useMemo(() => (mode === "calc" ? uciLineToSan(setupFen, moves) : []), [mode, setupFen, moves]);
  const end = mode === "calc" ? gameEnd(fen) : null;
  const liveRaw = useLiveEval(mode === "calc" && !end ? fen : null, 3, DEPTHS);
  const live = liveRaw && liveRaw.fen === fen ? liveRaw : null;
  const best = live?.lines[0]?.pv[0] ?? null;
  const bestSan = best ? uciLineToSan(fen, [best], 1)[0] : null;
  const lines = useMemo(
    () => (live ? live.lines.slice(0, 3).map((l, i) => ({ rank: i + 1, ev: l.ev, uci: l.pv, tokens: numberedLine(fen, uciLineToSan(fen, l.pv, LINE_MOVES)) })) : []),
    [live, fen],
  );

  const play = useCallback(
    (m: UserMove) => {
      const r = legalMove(fen, m);
      if (r) setMoves((ms) => [...ms, r.uci]);
    },
    [fen],
  );
  const input = useBoardInput(fen, mode === "calc" && !end, play);
  const playLine = (uci: string[], upto: number) => setMoves((ms) => [...ms, ...uci.slice(0, upto)]);

  const calculate = () => {
    if (!valid) return;
    setTool(null);
    setSelected(null);
    setMoves([]);
    setMode("calc");
    showBoard();
  };

  const calcStyles = useMemo(() => {
    const st: Record<string, React.CSSProperties> = {};
    const lm = moves[moves.length - 1];
    if (lm) for (const sq of [lm.slice(0, 2), lm.slice(2, 4)]) st[sq] = { backgroundColor: "rgba(255, 214, 10, 0.45)" };
    return { ...st, ...input.styles };
  }, [moves, input.styles]);

  const toMove = fen.split(" ")[1] === "w" ? "White" : "Black";
  const eps = epCandidates(setup.board, setup.turn);
  const allowed = castlingAllowed(setup.board);

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
      </header>

      <div
        className="grid gap-4 lg:grid-cols-[minmax(0,560px)_minmax(0,1fr)]"
        data-testid="analyze"
        data-mode={mode}
        data-fen={fen}
        data-valid={valid}
        data-orientation={orientation}
      >
        <section ref={boardRef} className="scroll-mt-2">
          <div className="mb-2 flex min-h-10 items-center justify-between gap-2 rounded-lg bg-zinc-900 px-3 py-2 text-sm" data-testid="analyze-status">
            {mode === "edit" ? (
              <span className="font-semibold text-zinc-200">Set up a position</span>
            ) : end ? (
              <span className="font-semibold text-amber-300" data-testid="game-end">
                {gameEndText(end)}
              </span>
            ) : (
              <span className="min-w-0 truncate font-semibold text-zinc-200" data-testid="best-move">
                {toMove} to move · Best:{" "}
                <span className="font-mono text-green-400" data-testid="best-san">
                  {bestSan ?? "…"}
                </span>
              </span>
            )}
            {mode === "calc" && !end && (
              <span className="shrink-0 font-mono text-xs text-zinc-400" data-testid="calc-eval">
                {live ? `${formatEval(live.ev)} · d${live.depth}` : "thinking…"}
              </span>
            )}
          </div>
          <div className="flex gap-2">
            {mode === "calc" ? (
              <EvalBar ev={end ? null : (live?.ev ?? null)} flipped={orientation === "black"} />
            ) : (
              <div className="w-6 shrink-0" aria-hidden /> /* keeps the board the same size in both modes */
            )}
            <div className="min-w-0 flex-1">
              {mode === "edit" ? (
                <EditorBoard
                  board={setup.board}
                  orientation={orientation}
                  tool={tool}
                  selected={selected}
                  onBoard={updateBoard}
                  onTool={(t) => {
                    setTool(t);
                    setSelected(null);
                  }}
                  onSelect={setSelected}
                />
              ) : (
                <div className="relative" data-testid="calc-board">
                  <Chessboard
                    options={{
                      id: "calc-board",
                      position: fen,
                      boardOrientation: orientation,
                      squareStyles: calcStyles,
                      arrows: best && !end ? [{ startSquare: best.slice(0, 2), endSquare: best.slice(2, 4), color: "rgba(34, 197, 94, 0.85)" }] : [],
                      darkSquareStyle: { backgroundColor: "#769656" },
                      lightSquareStyle: { backgroundColor: "#eeeed2" },
                      animationDurationInMs: 150,
                      ...input.handlers,
                    }}
                  />
                  {input.picker}
                  {best && !end && <span className="sr-only" data-testid="best-arrow" data-uci={best} />}
                </div>
              )}
            </div>
          </div>
        </section>

        <section className="flex flex-col gap-3">
          {mode === "edit" ? (
            <>
              <div className="flex flex-wrap gap-2">
                <button className={btn} onClick={() => setSetup(startSetup())} data-testid="start-position">
                  Starting position
                </button>
                <button className={btn} onClick={() => setSetup(emptySetup())} data-testid="clear-board">
                  Clear board
                </button>
                <button className={btn} onClick={() => setOrientation((o) => (o === "white" ? "black" : "white"))} data-testid="flip">
                  ⇅ Flip
                </button>
              </div>

              <div className="rounded-lg border border-zinc-800 p-2 text-sm">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wide text-zinc-400">To move</span>
                  <div className="flex overflow-hidden rounded-md ring-1 ring-zinc-700" role="radiogroup" aria-label="Side to move">
                    {(["w", "b"] as const).map((t) => (
                      <button
                        key={t}
                        role="radio"
                        aria-checked={setup.turn === t}
                        onClick={() => setTurn(t)}
                        data-testid={`turn-${t}`}
                        className={`px-3 py-1 font-semibold ${setup.turn === t ? "bg-zinc-100 text-zinc-900" : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"}`}
                      >
                        {t === "w" ? "White" : "Black"}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Castling</span>
                  {(
                    [
                      ["K", "White O-O"],
                      ["Q", "White O-O-O"],
                      ["k", "Black O-O"],
                      ["q", "Black O-O-O"],
                    ] as const
                  ).map(([k, label]) => {
                    const ok = allowed[k];
                    return (
                      <label
                        key={k}
                        className={`flex items-center gap-1 text-xs ${ok ? "text-zinc-200" : "text-zinc-600"}`}
                        title={ok ? label : `${label}: king and rook must be on their home squares`}
                      >
                        <input type="checkbox" checked={setup.castling[k]} disabled={!ok} onChange={(e) => setCastle(k, e.target.checked)} data-testid={`castle-${k}`} />
                        {label}
                      </label>
                    );
                  })}
                </div>
                <label className="mt-2 flex items-center gap-2 text-xs text-zinc-300">
                  <span className="font-semibold uppercase tracking-wide text-zinc-400">En passant</span>
                  <select
                    value={setup.ep ?? ""}
                    onChange={(e) => setSetup((s) => ({ ...s, ep: e.target.value || null }))}
                    disabled={!eps.length}
                    className="rounded bg-zinc-800 px-2 py-1 disabled:opacity-40"
                    data-testid="ep-select"
                  >
                    <option value="">none</option>
                    {eps.map((sq) => (
                      <option key={sq} value={sq}>
                        {sq}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="rounded-lg border border-zinc-800 p-2">
                <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-400">FEN</div>
                <div className="flex gap-2">
                  <input
                    value={fenText}
                    onChange={(e) => setFenText(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && loadFen()}
                    spellCheck={false}
                    className="min-w-0 flex-1 rounded bg-zinc-800 px-2 py-1 font-mono text-base sm:text-xs"
                    aria-label="FEN"
                    data-testid="fen-input"
                  />
                  <button className={btn} onClick={loadFen} disabled={fenText.trim() === setupFen} data-testid="fen-load">
                    Load
                  </button>
                  <button className={btn} onClick={copyFen} data-testid="fen-copy">
                    {copied ? "Copied" : "Copy"}
                  </button>
                </div>
                {fenError && <p className="mt-1 text-xs text-red-400">{fenError}</p>}
              </div>

              <div className="min-h-6" data-testid="validation" aria-live="polite">
                {valid ? (
                  <p className="text-sm text-green-400">✓ Position is valid.</p>
                ) : (
                  <ul className="space-y-0.5 text-sm text-red-400">
                    {errors.map((e) => (
                      <li key={e} data-testid="validation-error">
                        • {e}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <button
                onClick={calculate}
                disabled={!valid}
                className="rounded-lg bg-green-600 px-4 py-2.5 font-semibold text-white hover:bg-green-500 disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-400"
                data-testid="calculate"
              >
                Calculate best move
              </button>
            </>
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                <button className="rounded bg-green-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-green-500 disabled:opacity-40" onClick={() => best && playLine([best], 1)} disabled={!best || !!end} data-testid="play-best">
                  Play best move
                </button>
                <button className={btn} onClick={() => setMoves((m) => m.slice(0, -1))} disabled={!moves.length} data-testid="undo">
                  ↶ Undo
                </button>
                <button className={btn} onClick={() => setMoves([])} disabled={!moves.length} data-testid="reset-setup">
                  Reset to setup
                </button>
                <button className={btn} onClick={() => setOrientation((o) => (o === "white" ? "black" : "white"))} data-testid="flip">
                  ⇅ Flip
                </button>
                <button className={btn} onClick={() => {
                    setMode("edit");
                    showBoard();
                  }}
                  data-testid="back-to-editor">
                  ✎ Back to editor
                </button>
              </div>

              <div className="rounded-lg border border-zinc-800 p-2 text-sm" data-testid="calc-lines">
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Engine · top 3 lines</span>
                  <span className="font-mono text-xs text-zinc-500">{live ? `depth ${live.depth}` : end ? "" : "…"}</span>
                </div>
                {end ? (
                  <p className="flex h-[6.75rem] items-center justify-center text-base font-semibold text-amber-300">{gameEndText(end)}</p>
                ) : (
                  [0, 1, 2].map((i) => {
                    const l = lines[i];
                    return (
                      <div key={i} className="flex h-8 items-center gap-2 rounded px-1" data-testid={l ? "calc-line" : undefined}>
                        <span className={`w-14 shrink-0 rounded px-1 text-center font-mono text-xs font-bold ${i === 0 ? "bg-zinc-100 text-zinc-900" : "bg-zinc-700 text-zinc-100"}`}>
                          {l ? formatEval(l.ev) : "…"}
                        </span>
                        <div className="flex h-6 min-w-0 flex-1 flex-wrap items-center overflow-hidden">
                          {l?.tokens.map((t) => (
                            <span key={t.index} className="whitespace-nowrap">
                              {t.label && <span className="mr-0.5 text-zinc-500">{t.label}</span>}
                              <button
                                onClick={() => playLine(l.uci, t.index + 1)}
                                title="Play the line up to this move"
                                className={`mr-1 rounded px-0.5 font-mono hover:bg-zinc-700 ${t.index === 0 ? "font-semibold text-green-400" : "text-zinc-200"}`}
                              >
                                {t.san}
                              </button>
                            </span>
                          ))}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              <div className="rounded-lg border border-zinc-800 p-2 text-sm" data-testid="played-moves">
                <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-400">Moves from your setup</div>
                {played.length ? (
                  <div className="flex flex-wrap gap-x-1 font-mono">
                    {numberedLine(setupFen, played).map((t) => (
                      <span key={t.index} className="whitespace-nowrap">
                        {t.label && <span className="mr-0.5 text-zinc-500">{t.label}</span>}
                        <span className={t.index === played.length - 1 ? "rounded bg-zinc-700 px-0.5 text-zinc-50" : "text-zinc-300"}>{t.san}</span>
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-zinc-500">Make a move on the board (drag or tap), play the best move, or tap a move in a line.</p>
                )}
              </div>
            </>
          )}
        </section>
      </div>
      <Footer />
    </main>
  );
}
