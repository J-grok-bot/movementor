"use client";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Chess, type Square } from "chess.js";
import { formatEval, toWhiteEval, type Eval } from "@/lib/analysis";
import { loadOpeningBook, type OpeningBook } from "@/lib/openingBook";
import {
  continuations,
  findLine,
  inBook,
  loadOpeningTree,
  openingAt,
  playSans,
  searchOpenings,
  START_FEN,
  type OpeningTree,
} from "@/lib/openings";
import { runUserAnalysis } from "@/lib/engineManager";
import { AppNav } from "./AppNav";
import { EvalBar } from "./EvalBar";
import { Footer } from "./Footer";

const Chessboard = dynamic(
  () => import("react-chessboard").then((m) => m.Chessboard),
  {
    ssr: false,
    loading: () => (
      <div className="aspect-square w-full animate-pulse rounded bg-zinc-800" />
    ),
  },
);

type Walk = {
  title: string;
  eco: string;
  moves: string[];
  step: number;
  practice: boolean;
};
type Feedback = { ok: boolean; text: string } | null;

const numbered = (sans: string[], from = 0) =>
  sans.map((san, i) => {
    const ply = from + i;
    return {
      san,
      ply,
      label:
        ply % 2 === 0
          ? `${ply / 2 + 1}.`
          : i === 0
            ? `${Math.floor(ply / 2) + 1}...`
            : "",
    };
  });

export function OpeningsView() {
  const params = useSearchParams();
  const [tree, setTree] = useState<OpeningTree | null>(null);
  const [book, setBook] = useState<OpeningBook | null>(null);
  const [moves, setMoves] = useState<string[]>([]); // explorer moves
  const [walk, setWalk] = useState<Walk | null>(null);
  const [flipped, setFlipped] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Square | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [hint, setHint] = useState(false);
  const [showEval, setShowEval] = useState(false);
  const [ev, setEv] = useState<{
    fen: string;
    ev: Eval;
    best: string | null;
  } | null>(null);

  useEffect(() => {
    Promise.all([loadOpeningTree(), loadOpeningBook()]).then(([t, b]) => {
      setTree(t);
      setBook(b);
    });
  }, []);

  // Initial URL state: ?moves=e4,c5 (explore) | ?moves=…&walk=1&step=3&practice=1 | ?opening=<name>
  useEffect(() => {
    if (!tree) return;
    const ms = (params.get("moves") ?? "").split(/[,\s]+/).filter(Boolean);
    const name = params.get("opening");
    const step = Number(params.get("step") ?? 0);
    const practice = params.get("practice") === "1";
    if (name) {
      const i = findLine(tree, name);
      if (i >= 0) {
        const [eco, title, line] = tree.lines[i];
        setWalk({
          title,
          eco,
          moves: line.split(" "),
          step: Math.min(step, line.split(" ").length),
          practice,
        });
        return;
      }
    }
    const valid = playSans(ms).sans;
    if (params.get("walk") === "1" && valid.length && book) {
      const o = openingAt(book, playSans(valid).fens);
      setWalk({
        title: o?.name ?? "Custom line",
        eco: o?.eco ?? "",
        moves: valid,
        step: Math.min(step, valid.length),
        practice,
      });
    } else setMoves(valid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tree, book]);

  // Keep the URL shareable.
  useEffect(() => {
    if (!tree) return;
    const q = new URLSearchParams();
    if (walk) {
      q.set("moves", walk.moves.join(","));
      q.set("walk", "1");
      if (walk.step) q.set("step", String(walk.step));
      if (walk.practice) q.set("practice", "1");
    } else if (moves.length) q.set("moves", moves.join(","));
    const url = `/openings${q.size ? `?${q.toString().replace(/%2C/g, ",")}` : ""}`;
    if (url !== window.location.pathname + window.location.search)
      window.history.replaceState(null, "", url);
  }, [tree, walk, moves]);

  const shown = walk ? walk.moves.slice(0, walk.step) : moves;
  const played = useMemo(() => playSans(shown), [shown]);
  const fen = played.fens[played.fens.length - 1];
  const opening = book ? openingAt(book, played.fens) : null;
  const stillBook = book ? inBook(book, fen) : true;
  const conts = useMemo(
    () => (tree && book ? continuations(tree, book, fen) : []),
    [tree, book, fen],
  );
  const results = useMemo(
    () => (tree && query.trim() ? searchOpenings(tree, query, 25) : []),
    [tree, query],
  );
  const nextUci =
    walk && walk.step < walk.moves.length
      ? playSans(walk.moves.slice(0, walk.step + 1)).uci[walk.step]
      : null;

  // Optional engine eval of the current position.
  useEffect(() => {
    if (!showEval) return;
    let live = true;
    const t = setTimeout(() => {
      runUserAnalysis(1, (e) => e.evaluate(fen, 14))
        .then(
          (r) =>
            live &&
            setEv({
              fen,
              ev: toWhiteEval(r.score, fen.split(" ")[1] as "w" | "b"),
              best: r.bestMove,
            }),
        )
        .catch(() => undefined);
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [fen, showEval]);
  const curEval = showEval && ev?.fen === fen ? ev : null;

  const tryMove = useCallback(
    (from: string, to: string): boolean => {
      const c = new Chess(fen);
      let san: string;
      try {
        san = c.move({ from, to, promotion: "q" }).san;
      } catch {
        return false;
      }
      setSelected(null);
      if (walk) {
        if (!walk.practice) return false;
        const expected = walk.moves[walk.step];
        if (!expected) return false;
        if (san === expected) {
          setFeedback({ ok: true, text: `✓ ${san} is the book move.` });
          setHint(false);
          setWalk({ ...walk, step: walk.step + 1 });
          return true;
        }
        setFeedback({
          ok: false,
          text: `✗ ${san} isn't the move in this line. Try again${hint ? "" : " or tap Hint"}.`,
        });
        return false;
      }
      setMoves([...moves, san]);
      return true;
    },
    [fen, walk, moves, hint],
  );

  const onSquareClick = ({
    square,
    piece,
  }: {
    square: string;
    piece: { pieceType: string } | null;
  }) => {
    const sq = square as Square;
    const c = new Chess(fen);
    if (selected && selected !== sq && tryMove(selected, sq)) return;
    const own = piece && piece.pieceType[0] === c.turn();
    setSelected(own && selected !== sq ? sq : null);
  };

  const squareStyles = useMemo(() => {
    const st: Record<string, React.CSSProperties> = {};
    const last = played.uci[played.uci.length - 1];
    if (last) {
      st[last.slice(0, 2)] = { backgroundColor: "rgba(250, 204, 21, 0.35)" };
      st[last.slice(2, 4)] = { backgroundColor: "rgba(250, 204, 21, 0.5)" };
    }
    if (selected) {
      st[selected] = { backgroundColor: "rgba(59, 130, 246, 0.55)" };
      for (const m of new Chess(fen).moves({ square: selected, verbose: true }))
        st[m.to] = {
          ...st[m.to],
          background:
            "radial-gradient(circle, rgba(30,41,59,.45) 22%, transparent 24%)",
        };
    }
    return st;
  }, [played, selected, fen]);

  const arrows = useMemo(() => {
    const a: { startSquare: string; endSquare: string; color: string }[] = [];
    if (nextUci && (!walk?.practice || hint))
      a.push({
        startSquare: nextUci.slice(0, 2),
        endSquare: nextUci.slice(2, 4),
        color: "#22c55ecc",
      });
    if (curEval?.best && !walk)
      a.push({
        startSquare: curEval.best.slice(0, 2),
        endSquare: curEval.best.slice(2, 4),
        color: "#3b82f6aa",
      });
    return a;
  }, [nextUci, walk, hint, curEval]);

  const startWalk = (
    title: string,
    eco: string,
    ms: string[],
    practice = false,
  ) => {
    setWalk({ title, eco, moves: ms, step: 0, practice });
    setFeedback(null);
    setHint(false);
    setQuery("");
    setSelected(null);
  };
  const stepTo = (n: number) => {
    if (!walk) return;
    setWalk({ ...walk, step: Math.max(0, Math.min(walk.moves.length, n)) });
    setFeedback(null);
    setHint(false);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT") return;
      if (walk) {
        if (e.key === "ArrowLeft") stepTo(walk.step - 1);
        else if (e.key === "ArrowRight" && !walk.practice)
          stepTo(walk.step + 1);
        else return;
      } else if (e.key === "ArrowLeft" && moves.length)
        setMoves(moves.slice(0, -1));
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const btn =
    "rounded bg-zinc-700 px-3 py-1.5 text-sm hover:bg-zinc-600 disabled:opacity-40";
  const done = walk && walk.step >= walk.moves.length;

  return (
    <main className="mx-auto max-w-6xl p-3 sm:p-4" style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top, 0px))" }}>
      <header className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h1 className="flex items-center gap-2 text-xl font-bold sm:text-2xl">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo.svg"
            alt=""
            width={32}
            height={32}
            className="h-8 w-8"
          />
          <span className="max-[430px]:sr-only">MoveMentor</span>
          <AppNav className="ml-2" />
        </h1>
        <div className="relative w-full sm:w-80">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search openings, e.g. sicilian najdorf, london"
            className="w-full rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm"
            aria-label="Search openings"
            data-testid="opening-search"
          />
          {query.trim() && (
            <ul
              className="absolute inset-x-0 top-full z-40 mt-1 max-h-[60vh] overflow-y-auto rounded-lg border border-zinc-700 bg-zinc-900 shadow-xl"
              data-testid="search-results"
            >
              {results.length === 0 && (
                <li className="px-3 py-2 text-sm text-zinc-400">
                  No opening matches “{query}”.
                </li>
              )}
              {results.map((r) => (
                <li key={r.index}>
                  <button
                    onClick={() => startWalk(r.name, r.eco, r.moves)}
                    className="block w-full px-3 py-2 text-left hover:bg-zinc-800"
                    data-testid="search-result"
                  >
                    <span className="mr-2 font-mono text-xs text-zinc-400">
                      {r.eco}
                    </span>
                    <span className="text-sm font-semibold">{r.name}</span>
                    <span className="block truncate font-mono text-xs text-zinc-500">
                      {numbered(r.moves)
                        .map((t) => `${t.label}${t.san}`)
                        .join(" ")}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </header>

      <div className="flex flex-col gap-4 lg:flex-row">
        {/* Board */}
        <div className="w-full max-w-[560px] shrink-0">
          <div
            className="mb-2 min-h-12 rounded-lg bg-zinc-900 px-3 py-2"
            data-testid="opening-name"
          >
            {opening ? (
              <>
                <span className="mr-2 rounded bg-zinc-700 px-1.5 py-0.5 font-mono text-xs">
                  {opening.eco}
                </span>
                <span className="font-semibold">{opening.name}</span>
              </>
            ) : (
              <span className="text-zinc-400">Starting position</span>
            )}
            {!stillBook && (
              <span className="ml-2 text-xs text-amber-400">(out of book)</span>
            )}
          </div>
          <div className="flex gap-2">
            {showEval && <EvalBar ev={curEval?.ev ?? null} flipped={flipped} />}
            <div className="flex-1" data-testid="openings-board">
              <Chessboard
                options={{
                  id: "openings-board",
                  position: fen === START_FEN ? START_FEN : fen,
                  boardOrientation: flipped ? "black" : "white",
                  allowDragging: !walk || walk.practice,
                  onPieceDrop: ({ sourceSquare, targetSquare }) =>
                    !!targetSquare && tryMove(sourceSquare, targetSquare),
                  onSquareClick,
                  squareStyles,
                  arrows,
                  allowDrawingArrows: true,
                  animationDurationInMs: 150,
                  darkSquareStyle: { backgroundColor: "#769656" },
                  lightSquareStyle: { backgroundColor: "#eeeed2" },
                }}
              />
            </div>
          </div>
          {!walk && (
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                className={btn}
                onClick={() => setMoves(moves.slice(0, -1))}
                disabled={!moves.length}
                data-testid="undo"
              >
                ↶ Undo
              </button>
              <button
                className={btn}
                onClick={() => setMoves([])}
                disabled={!moves.length}
                data-testid="reset"
              >
                ⟲ Reset
              </button>
              <button
                className={btn}
                onClick={() => setFlipped((f) => !f)}
                data-testid="flip"
              >
                ⇅ Flip
              </button>
              <label className="ml-auto flex items-center gap-1.5 text-sm text-zinc-300">
                <input
                  type="checkbox"
                  checked={showEval}
                  onChange={(e) => setShowEval(e.target.checked)}
                  data-testid="eval-toggle"
                />
                Stockfish eval
                {curEval ? `: ${formatEval(curEval.ev)}` : showEval ? "…" : ""}
              </label>
            </div>
          )}
        </div>

        {/* Panel */}
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          {walk ? (
            <section
              className="rounded-lg border border-zinc-800 p-3"
              data-testid="walkthrough"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-xs uppercase tracking-wide text-zinc-400">
                    {walk.practice ? "Practice" : "Walkthrough"}
                  </div>
                  <h2 className="font-semibold">
                    {walk.eco && (
                      <span className="mr-2 font-mono text-xs text-zinc-400">
                        {walk.eco}
                      </span>
                    )}
                    {walk.title}
                  </h2>
                </div>
                <button
                  className="shrink-0 text-xs text-zinc-400 underline"
                  onClick={() => {
                    setMoves(walk.moves.slice(0, walk.step));
                    setWalk(null);
                    setFeedback(null);
                  }}
                  data-testid="exit-walk"
                >
                  Explore from here
                </button>
              </div>
              <div className="mt-2 flex gap-1 rounded-lg bg-zinc-900 p-1 text-sm">
                {[false, true].map((p) => (
                  <button
                    key={String(p)}
                    onClick={() => {
                      setWalk({
                        ...walk,
                        practice: p,
                        step: p ? 0 : walk.step,
                      });
                      setFeedback(null);
                      setHint(false);
                    }}
                    className={`flex-1 rounded-md py-1 ${walk.practice === p ? "bg-zinc-700 font-semibold" : "text-zinc-400"}`}
                    data-testid={p ? "mode-practice" : "mode-learn"}
                  >
                    {p ? "Practice" : "Learn"}
                  </button>
                ))}
              </div>
              <ol
                className="mt-3 flex flex-col gap-0.5 text-sm"
                data-testid="walk-steps"
              >
                {numbered(walk.moves).map((t, i) => {
                  const name = book
                    ? openingAt(book, playSans(walk.moves.slice(0, i + 1)).fens)
                    : null;
                  const prevName =
                    i > 0 && book
                      ? openingAt(book, playSans(walk.moves.slice(0, i)).fens)
                      : null;
                  const newName =
                    name && name.name !== prevName?.name ? name : null;
                  const hidden = walk.practice && i >= walk.step;
                  return (
                    <li key={i}>
                      <button
                        onClick={() => !walk.practice && stepTo(i + 1)}
                        className={`flex w-full items-baseline gap-2 rounded px-2 py-0.5 text-left ${
                          i + 1 === walk.step
                            ? "bg-blue-600/40"
                            : i < walk.step
                              ? ""
                              : "text-zinc-500"
                        }`}
                      >
                        <span className="w-8 shrink-0 text-right font-mono text-xs text-zinc-500">
                          {t.label || "…"}
                        </span>
                        <span className="w-14 shrink-0 font-mono font-semibold">
                          {hidden ? "?" : t.san}
                        </span>
                        {newName && !hidden && (
                          <span className="min-w-0 truncate text-xs text-sky-300">
                            {newName.name}
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ol>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  className={btn}
                  onClick={() => stepTo(0)}
                  disabled={walk.step === 0}
                  aria-label="Start"
                >
                  ⏮
                </button>
                <button
                  className={btn}
                  onClick={() => stepTo(walk.step - 1)}
                  disabled={walk.step === 0}
                  data-testid="walk-prev"
                >
                  ◀ Prev
                </button>
                {!walk.practice && (
                  <button
                    className={btn}
                    onClick={() => stepTo(walk.step + 1)}
                    disabled={!!done}
                    data-testid="walk-next"
                  >
                    Next ▶
                  </button>
                )}
                {walk.practice && !done && (
                  <button
                    className={btn}
                    onClick={() => {
                      setHint(true);
                      setFeedback(null);
                    }}
                    data-testid="hint"
                  >
                    💡 Hint
                  </button>
                )}
                <button className={btn} onClick={() => setFlipped((f) => !f)}>
                  ⇅ Flip
                </button>
                <span
                  className="ml-auto text-xs text-zinc-400"
                  data-testid="walk-counter"
                >
                  {walk.step}/{walk.moves.length}
                </span>
              </div>
              <p className="mt-2 min-h-5 text-sm" data-testid="walk-feedback">
                {done ? (
                  <span className="text-green-400">
                    ✓ Line complete{walk.practice ? ": well played!" : "."}
                  </span>
                ) : feedback ? (
                  <span
                    className={feedback.ok ? "text-green-400" : "text-red-400"}
                  >
                    {feedback.text}
                  </span>
                ) : walk.practice ? (
                  <span className="text-zinc-400">
                    Play {walk.step % 2 === 0 ? "White" : "Black"}&apos;s move{" "}
                    {Math.floor(walk.step / 2) + 1} on the board.
                    {hint && nextUci
                      ? ` Hint: move the piece on ${nextUci.slice(0, 2)}.`
                      : ""}
                  </span>
                ) : (
                  <span className="text-zinc-400">
                    The green arrow shows the next book move.
                  </span>
                )}
              </p>
            </section>
          ) : (
            <>
              <section
                className="rounded-lg border border-zinc-800 p-3"
                data-testid="explorer-moves"
              >
                <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-400">
                  Moves
                </div>
                {moves.length ? (
                  <div className="flex flex-wrap gap-x-1 font-mono text-sm">
                    {numbered(moves).map((t) => (
                      <span key={t.ply}>
                        {t.label && (
                          <span className="text-zinc-500">{t.label}</span>
                        )}
                        <button
                          className="rounded px-0.5 hover:bg-zinc-700"
                          onClick={() => setMoves(moves.slice(0, t.ply + 1))}
                        >
                          {t.san}
                        </button>
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-zinc-400">
                    Drag or tap pieces to play moves for both sides, or pick a
                    book move below.
                  </p>
                )}
                {moves.length > 0 && stillBook && (
                  <button
                    className="mt-2 text-xs text-sky-300 underline"
                    onClick={() =>
                      startWalk(
                        opening?.name ?? "Custom line",
                        opening?.eco ?? "",
                        moves,
                        true,
                      )
                    }
                    data-testid="practice-these"
                  >
                    Practice these moves
                  </button>
                )}
              </section>
              <section
                className="rounded-lg border border-zinc-800 p-3"
                data-testid="continuations"
              >
                <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-400">
                  Book moves {conts.length ? `(${conts.length})` : ""}
                </div>
                {conts.length === 0 && (
                  <p className="text-sm text-zinc-400">
                    {stillBook
                      ? "End of the book line."
                      : "This position isn't in the opening book."}
                  </p>
                )}
                <ul className="flex max-h-[28rem] flex-col overflow-y-auto">
                  {conts.map((c) => (
                    <li key={c.san}>
                      <button
                        onClick={() => setMoves([...moves, c.san])}
                        className="flex w-full items-baseline gap-2 rounded px-2 py-1 text-left hover:bg-zinc-800"
                        data-testid="continuation"
                      >
                        <span className="w-14 shrink-0 font-mono font-semibold text-green-400">
                          {c.san}
                        </span>
                        <span className="min-w-0 truncate text-sm">
                          {c.name}
                          {!c.exact && (
                            <span className="text-zinc-500"> …</span>
                          )}
                        </span>
                        <span className="ml-auto shrink-0 font-mono text-xs text-zinc-500">
                          {c.eco}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            </>
          )}
          <p className="text-xs text-zinc-500">
            Opening names from lichess-org/chess-openings (CC0). Positions are
            matched exactly, so transpositions are recognised.
          </p>
        </div>
      </div>
      <Footer />
    </main>
  );
}
